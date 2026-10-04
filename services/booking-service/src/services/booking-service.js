import { ApiError } from '../utils/errors.js';
import { bookingRequestHash } from '../utils/request-hash.js';

export class BookingService {
  constructor(repository, identityClient) { this.repository = repository; this.identityClient = identityClient; }

  async create(userId, payload, idempotencyKey, requestId) {
    await this.identityClient.assertActive(userId, requestId);
    const requestHash = bookingRequestHash(payload);
    try {
      return await this.repository.transaction(async (db) => {
        const existing = await this.repository.findIdempotent(db, userId, idempotencyKey, true);
        if (existing) {
          if (existing.request_hash !== requestHash) throw new ApiError(409, 'IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key đã được dùng với nội dung khác');
          return { booking: existing, replayed: true, eventId: null };
        }
        const [room, slot] = await Promise.all([
          this.repository.findActiveRoom(db, payload.room_id), this.repository.findActiveSlot(db, payload.slot_id)
        ]);
        if (!room) throw new ApiError(404, 'ROOM_NOT_FOUND', 'Không tìm thấy phòng đang hoạt động');
        if (!slot) throw new ApiError(404, 'SLOT_NOT_FOUND', 'Không tìm thấy ca đang hoạt động');
        const booking = await this.repository.insertBooking(db, { roomId: payload.room_id, slotId: payload.slot_id,
          bookingDate: payload.booking_date, userId, idempotencyKey, requestHash });
        const event = await this.repository.insertOutbox(db, { eventType: 'BOOKING_CREATED', aggregateId: booking.id,
          userId, payload: { booking_id: booking.id, room_id: booking.room_id, slot_id: booking.slot_id, booking_date: booking.booking_date } });
        return { booking, replayed: false, eventId: event.event_id };
      });
    } catch (error) {
      if (error.code === '23505') {
        const existing = await this.repository.findIdempotent(this.repository.pool, userId, idempotencyKey, false);
        if (existing) {
          if (existing.request_hash === requestHash) return { booking: existing, replayed: true, eventId: null };
          throw new ApiError(409, 'IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key đã được dùng với nội dung khác');
        }
        throw new ApiError(409, 'ROOM_SLOT_CONFLICT', 'Phòng đã được đặt trong ca này');
      }
      throw error;
    }
  }

  async cancel(id, actor, reason, admin = false) {
    return this.repository.transaction(async (db) => {
      const booking = await this.repository.findBooking(db, id);
      if (!booking || (!admin && booking.user_id !== actor.id)) throw new ApiError(404, 'BOOKING_NOT_FOUND', 'Không tìm thấy lịch đặt');
      if (booking.status === 'CANCELLED') return { booking, eventId: null, replayed: true };
      const cancelled = await this.repository.markCancelled(db, id, reason);
      const event = await this.repository.insertOutbox(db, { eventType: 'BOOKING_CANCELLED', aggregateId: id,
        userId: booking.user_id, payload: { booking_id: id, reason } });
      return { booking: cancelled, eventId: event.event_id, replayed: false };
    });
  }
}
