import { z } from 'zod';
import { ApiError } from '../utils/errors.js';

const uuid = z.uuid();
const bookingSchema = z.object({
  room_id: uuid,
  slot_id: uuid,
  booking_date: z.iso.date().refine((value) => value >= new Date().toISOString().slice(0, 10), 'Ngày đặt không được ở quá khứ')
}).strict();
const cancelSchema = z.object({ reason: z.string().trim().min(2).max(300) }).strict();
const roomCreateSchema = z.object({
  name: z.string().trim().min(2).max(100), capacity: z.number().int().positive().max(1000),
  equipment: z.array(z.string().trim().min(1).max(100)).max(100).default([]), active: z.boolean().default(true)
}).strict();
const roomUpdateSchema = roomCreateSchema.partial().refine((value) => Object.keys(value).length > 0, 'Cần ít nhất một trường cập nhật');
const idempotencySchema = z.string().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/);

export function createBookingController({ bookingService, repository, dispatcher }) {
  async function dispatchAfterCommit(eventId, requestId) {
    if (!eventId) return;
    try { await dispatcher.dispatchById(eventId, requestId); }
    catch (error) {
      console.error(JSON.stringify({ timestamp: new Date().toISOString(), service: 'booking-service', request_id: requestId,
        level: 'error', event: 'outbox_immediate_dispatch_failed', message: error.message }));
    }
  }
  return {
    listRooms: async (_req, res) => res.json({ data: await repository.listRooms() }),
    getRoom: async (req, res) => {
      const room = await repository.getRoom(uuid.parse(req.params.id));
      if (!room) throw new ApiError(404, 'ROOM_NOT_FOUND', 'Không tìm thấy phòng');
      res.json({ data: room });
    },
    availability: async (req, res) => {
      const query = z.object({ room_id: uuid, date: z.iso.date() }).parse(req.query);
      const room = await repository.getRoom(query.room_id);
      if (!room) throw new ApiError(404, 'ROOM_NOT_FOUND', 'Không tìm thấy phòng');
      res.json({ data: { room, date: query.date, slots: await repository.availability(query.room_id, query.date) } });
    },
    createBooking: async (req, res) => {
      const key = idempotencySchema.parse(req.get('Idempotency-Key'));
      const result = await bookingService.create(req.user.id, bookingSchema.parse(req.body), key, req.requestId);
      await dispatchAfterCommit(result.eventId, req.requestId);
      if (result.replayed) res.set('Idempotency-Replayed', 'true');
      res.status(result.replayed ? 200 : 201).json({ data: result.booking });
    },
    myBookings: async (req, res) => res.json({ data: await repository.listMine(req.user.id) }),
    cancelMine: async (req, res) => {
      const result = await bookingService.cancel(uuid.parse(req.params.id), req.user, cancelSchema.parse(req.body).reason, false);
      await dispatchAfterCommit(result.eventId, req.requestId);
      res.json({ data: result.booking });
    },
    createRoom: async (req, res) => res.status(201).json({ data: await repository.createRoom(roomCreateSchema.parse(req.body)) }),
    updateRoom: async (req, res) => {
      const room = await repository.updateRoom(uuid.parse(req.params.id), roomUpdateSchema.parse(req.body));
      if (!room) throw new ApiError(404, 'ROOM_NOT_FOUND', 'Không tìm thấy phòng');
      res.json({ data: room });
    },
    listBookings: async (_req, res) => res.json({ data: await repository.listBookings() }),
    cancelAdmin: async (req, res) => {
      const result = await bookingService.cancel(uuid.parse(req.params.id), req.user, cancelSchema.parse(req.body).reason, true);
      await dispatchAfterCommit(result.eventId, req.requestId);
      res.json({ data: result.booking });
    },
    listOutbox: async (_req, res) => res.json({ data: await repository.listOutbox() }),
    retryOutbox: async (req, res) => res.json({ data: await dispatcher.retryBatch(req.requestId) })
  };
}
