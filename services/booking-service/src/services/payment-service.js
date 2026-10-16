import { ApiError } from '../utils/errors.js';

const PROVIDER = 'MOCK';
const CURRENCY = 'VND';

export class PaymentService {
  constructor(repository, provider) {
    this.repository = repository;
    this.provider = provider;
  }

  async create(userId, bookingId, idempotencyKey, providerName = PROVIDER) {
    if (providerName !== PROVIDER) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Nhà cung cấp thanh toán không hợp lệ');
    }

    let prepared;
    try {
      prepared = await this.prepare(userId, bookingId, idempotencyKey);
    } catch (error) {
      if (error.code !== '23505') throw error;
      prepared = await this.resolveUniqueConflict(userId, bookingId, idempotencyKey, error);
    }

    if (!prepared.created) return prepared;

    let outcome;
    try {
      outcome = await this.provider.charge({
        paymentId: prepared.payment.id,
        bookingCode: prepared.bookingCode,
        amount: prepared.payment.amount,
        currency: prepared.payment.currency
      });
    } catch (error) {
      outcome = { success: false, failureReason: error?.message || 'Mock payment provider failed' };
    }

    const payment = await this.finalize(
      bookingId,
      prepared.payment.id,
      outcome
    );

    return { payment, created: true, replayed: false };
  }

  async prepare(userId, bookingId, idempotencyKey) {
    return this.repository.transaction(async (db) => {
      const booking = await this.getPayableBooking(db, bookingId, userId);
      const existing = await this.repository.findPaymentByIdempotency(db, userId, idempotencyKey, true);
      if (existing) return this.resolveExisting(existing, bookingId);

      const active = await this.repository.findActivePayment(db, bookingId, true);
      if (active) return { payment: active, created: false, replayed: false };

      const payment = await this.repository.insertPendingPayment(db, {
        bookingId,
        userId,
        provider: PROVIDER,
        amount: booking.total_price,
        currency: CURRENCY,
        idempotencyKey
      });
      return { payment, bookingCode: booking.booking_code, created: true, replayed: false };
    });
  }

  async resolveUniqueConflict(userId, bookingId, idempotencyKey, originalError) {
    return this.repository.transaction(async (db) => {
      const booking = await this.getPayableBooking(db, bookingId, userId);
      const existing = await this.repository.findPaymentByIdempotency(db, userId, idempotencyKey, true);
      if (existing) return this.resolveExisting(existing, bookingId);
      const active = await this.repository.findActivePayment(db, booking.id, true);
      if (active) return { payment: active, created: false, replayed: false };
      throw originalError;
    });
  }

  async getLatest(userId, bookingId) {
    const booking = await this.repository.getBookingView(this.repository.pool, bookingId);
    if (!booking || booking.user_id !== userId) {
      throw new ApiError(404, 'BOOKING_NOT_FOUND', 'Không tìm thấy lịch đặt');
    }
    return this.repository.getLatestPayment(this.repository.pool, bookingId);
  }

  async finalize(bookingId, paymentId, outcome) {
    return this.repository.transaction(async (db) => {
      const booking = await this.repository.findBookingForPayment(db, bookingId);
      if (outcome?.success && outcome.transactionId && booking?.status !== 'CANCELLED') {
        return this.repository.markPaymentSucceeded(db, paymentId, outcome.transactionId);
      }
      const reason = booking?.status === 'CANCELLED'
        ? 'Booking was cancelled before payment completed'
        : String(outcome?.failureReason || 'Mock payment provider failed').slice(0, 500);
      return this.repository.markPaymentFailed(db, paymentId, reason);
    });
  }

  async getPayableBooking(db, bookingId, userId) {
    const booking = await this.repository.findBookingForPayment(db, bookingId);
    if (!booking || booking.user_id !== userId) {
      throw new ApiError(404, 'BOOKING_NOT_FOUND', 'Không tìm thấy lịch đặt');
    }
    if (booking.status === 'CANCELLED') {
      throw new ApiError(409, 'BOOKING_NOT_PAYABLE', 'Đặt phòng đã hủy không thể thanh toán');
    }
    if (booking.total_price <= 0) {
      throw new ApiError(409, 'BOOKING_NOT_PAYABLE', 'Đặt phòng không có số tiền hợp lệ để thanh toán');
    }
    return booking;
  }

  resolveExisting(payment, bookingId) {
    if (payment.booking_id !== bookingId) {
      throw new ApiError(409, 'IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key đã được dùng cho đặt phòng khác');
    }
    return { payment, created: false, replayed: true };
  }
}
