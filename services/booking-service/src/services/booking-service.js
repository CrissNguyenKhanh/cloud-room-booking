import { randomUUID } from 'node:crypto';
import { ApiError } from '../utils/errors.js';
import { bookingRequestHash } from '../utils/request-hash.js';
import { addDays, bookedNights, canCancel, freeRanges, nightsBetween, todayInVietnam } from '../utils/stay.js';

const withoutHash = ({ request_hash: _hash, ...booking }) => booking;

export class BookingService {
  constructor(repository, identityClient, clock = () => new Date()) {
    this.repository = repository; this.identityClient = identityClient; this.clock = clock;
  }

  // ---------- Phòng ----------
  async searchRooms(query) {
    const hasStay = Boolean(query.check_in && query.check_out);
    const nights = hasStay ? nightsBetween(query.check_in, query.check_out) : null;
    const { rooms, total } = await this.repository.searchRooms({
      checkIn: query.check_in, checkOut: query.check_out, guests: query.guests, roomType: query.room_type,
      minPrice: query.min_price, maxPrice: query.max_price, page: query.page, limit: query.limit
    });
    const data = hasStay
      ? rooms.map((room) => ({ ...room, nights, total_price: room.price_per_night * nights, available: true }))
      : rooms;
    const meta = { page: query.page, limit: query.limit, total };
    if (hasStay) Object.assign(meta, { check_in: query.check_in, check_out: query.check_out, nights });
    return { data, meta };
  }

  async getRoomDetail(id, { check_in: checkIn, check_out: checkOut }) {
    const room = await this.repository.getRoom(id);
    if (!room) throw new ApiError(404, 'ROOM_NOT_FOUND', 'Không tìm thấy phòng');
    if (!checkIn || !checkOut) return room;
    const nights = nightsBetween(checkIn, checkOut);
    const available = await this.repository.isRoomAvailable(id, checkIn, checkOut);
    return { ...room, stay: { check_in: checkIn, check_out: checkOut, nights, total_price: room.price_per_night * nights, available } };
  }

  // Lịch phòng cho date picker: những ngày (đêm) đã có người đặt trong cửa sổ [from, to).
  async getUnavailableDates(roomId, { from, to }) {
    const room = await this.repository.getRoom(roomId);
    if (!room) throw new ApiError(404, 'ROOM_NOT_FOUND', 'Không tìm thấy phòng');
    const start = from ?? todayInVietnam(this.clock());
    const end = to ?? addDays(start, 90);
    const ranges = await this.repository.listBookedRanges(roomId, start, end);
    return {
      room_id: roomId, from: start, to: end,
      booked_ranges: ranges.map((range) => ({ check_in: range.check_in_date, check_out: range.check_out_date })),
      unavailable_dates: bookedNights(ranges, start, end)
    };
  }

  // Gợi ý khi khoảng ngày khách chọn không còn phòng: các khoảng con còn trống của chính phòng đó
  // (ví dụ muốn 10-15 nhưng chỉ 10-12 và 14-15 còn trống) và các phòng khác còn trống đủ khoảng ngày.
  async getAlternatives(roomId, { check_in: checkIn, check_out: checkOut, guests }) {
    const room = await this.repository.getRoom(roomId);
    if (!room) throw new ApiError(404, 'ROOM_NOT_FOUND', 'Không tìm thấy phòng');
    const nights = nightsBetween(checkIn, checkOut);
    const ranges = await this.repository.listBookedRanges(roomId, checkIn, checkOut);
    const available = ranges.length === 0;
    const priced = (range) => {
      const count = nightsBetween(range.check_in, range.check_out);
      return { ...range, nights: count, total_price: room.price_per_night * count };
    };
    const requested = { check_in: checkIn, check_out: checkOut, nights, total_price: room.price_per_night * nights, available };
    if (available) return { requested, same_room_ranges: [], other_rooms: [] };

    const { rooms } = await this.repository.searchRooms({
      checkIn, checkOut, guests: guests ?? room.capacity, page: 1, limit: 6
    });
    return {
      requested,
      same_room_ranges: freeRanges(checkIn, checkOut, ranges).map(priced),
      other_rooms: rooms.filter((other) => other.id !== roomId).slice(0, 5)
        .map((other) => ({ ...other, nights, total_price: other.price_per_night * nights, available: true }))
    };
  }

  // ---------- Đặt phòng ----------
  async create(userId, payload, idempotencyKey, requestId) {
    await this.identityClient.assertActive(userId, requestId);
    const requestHash = bookingRequestHash(payload);
    try {
      return await this.repository.transaction(async (db) => {
        const existing = await this.repository.findIdempotent(db, userId, idempotencyKey, true);
        if (existing) {
          if (existing.request_hash !== requestHash) throw new ApiError(409, 'IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key đã được dùng với nội dung khác');
          return { booking: withoutHash(existing), replayed: true, eventId: null };
        }

        const room = await this.repository.findActiveRoom(db, payload.room_id);
        if (!room) throw new ApiError(404, 'ROOM_NOT_FOUND', 'Không tìm thấy phòng đang hoạt động');
        if (payload.guests > room.capacity) {
          throw new ApiError(400, 'GUESTS_EXCEED_CAPACITY', 'Số khách vượt quá sức chứa của phòng');
        }

        const nights = nightsBetween(payload.check_in_date, payload.check_out_date);
        const bookingCode = `BK-${randomUUID().replaceAll('-', '').slice(0, 16).toUpperCase()}`;
        const booking = await this.repository.insertBooking(db, {
          roomId: payload.room_id,
          userId,
          checkInDate: payload.check_in_date,
          checkOutDate: payload.check_out_date,
          guests: payload.guests,
          nights,
          pricePerNight: room.price_per_night,
          totalPrice: room.price_per_night * nights,
          bookingCode,
          idempotencyKey,
          requestHash
        });
        const event = await this.repository.insertOutbox(db, {
          eventType: 'BOOKING_CREATED',
          aggregateId: booking.id,
          userId,
          payload: {
            booking_id: booking.id,
            booking_code: booking.booking_code,
            room_id: booking.room_id,
            room_name: booking.room_name,
            check_in_date: booking.check_in_date,
            check_out_date: booking.check_out_date,
            guests: booking.guests,
            nights: booking.nights,
            total_price: booking.total_price
          }
        });
        return { booking, replayed: false, eventId: event.event_id };
      });
    } catch (error) {
      if (error.code === '23505') {
        const existing = await this.repository.findIdempotent(this.repository.pool, userId, idempotencyKey, false);
        if (existing) {
          if (existing.request_hash === requestHash) return { booking: withoutHash(existing), replayed: true, eventId: null };
          throw new ApiError(409, 'IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key đã được dùng với nội dung khác');
        }
        throw error;
      }
      if (error.code === '23P01') {
        throw new ApiError(409, 'ROOM_UNAVAILABLE', 'Phòng đã được đặt trong khoảng thời gian này');
      }
      throw error;
    }
  }

  async listMine(userId, query) {
    const { bookings, total } = await this.repository.listMine(userId, { ...query, today: todayInVietnam(this.clock()) });
    return { data: bookings, meta: { page: query.page, limit: query.limit, total } };
  }

  async getMine(id, actor) {
    const booking = await this.repository.getBookingView(this.repository.pool, id);
    if (!booking || booking.user_id !== actor.id) throw new ApiError(404, 'BOOKING_NOT_FOUND', 'Không tìm thấy lịch đặt');
    return { ...booking, can_cancel: booking.status === 'CONFIRMED' && canCancel(booking.check_in_date, this.clock()) };
  }

  // Khách chỉ được hủy trước giờ nhận phòng (14:00) ít nhất 24 giờ; admin hủy bất cứ lúc nào.
  async cancel(id, actor, reason, admin = false) {
    return this.repository.transaction(async (db) => {
      const booking = await this.repository.findBooking(db, id);
      if (!booking || (!admin && booking.user_id !== actor.id)) throw new ApiError(404, 'BOOKING_NOT_FOUND', 'Không tìm thấy lịch đặt');
      if (booking.status === 'CANCELLED') {
        return { booking: await this.repository.getBookingView(db, id), eventId: null, replayed: true };
      }
      if (!admin && !canCancel(booking.check_in_date, this.clock())) {
        throw new ApiError(409, 'CANCELLATION_WINDOW_PASSED', 'Chỉ được hủy trước giờ nhận phòng ít nhất 24 giờ');
      }
      const cancelled = await this.repository.markCancelled(db, id, reason);
      const event = await this.repository.insertOutbox(db, { eventType: 'BOOKING_CANCELLED', aggregateId: id,
        userId: booking.user_id, payload: { booking_id: id, booking_code: booking.booking_code, room_id: booking.room_id,
          check_in_date: booking.check_in_date, check_out_date: booking.check_out_date, reason, cancelled_by: admin ? 'ADMIN' : 'USER' } });
      return { booking: cancelled, eventId: event.event_id, replayed: false };
    });
  }

  // ---------- Admin ----------
  async listAllBookings(query) {
    const { bookings, total } = await this.repository.listBookings({
      status: query.status,
      roomId: query.room_id,
      userId: query.user_id,
      page: query.page,
      limit: query.limit
    });
    return { data: bookings, meta: { page: query.page, limit: query.limit, total } };
  }
  async createRoom(data) {
    try { return await this.repository.createRoom(data); } catch (error) { throw this.mapRoomError(error); }
  }
  async updateRoom(id, data) {
    let room;
    try { room = await this.repository.updateRoom(id, data); } catch (error) { throw this.mapRoomError(error); }
    if (!room) throw new ApiError(404, 'ROOM_NOT_FOUND', 'Không tìm thấy phòng');
    return room;
  }
  mapRoomError(error) {
    if (error.code === '23505') return new ApiError(409, 'ROOM_ALREADY_EXISTS', 'Số phòng hoặc tên phòng đã tồn tại');
    return error;
  }
}
