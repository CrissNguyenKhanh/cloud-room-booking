import { z } from 'zod';
import { ApiError } from '../utils/errors.js';
import { MAX_NIGHTS, addDays, nightsBetween, todayInVietnam } from '../utils/stay.js';

const MAX_CALENDAR_DAYS = 366;
const uuid = z.uuid();

// Body đặt phòng: dùng check_in_date / check_out_date (trùng tên cột DB).
const bookingSchema = z.object({
  room_id: uuid,
  check_in_date: z.iso.date(),
  check_out_date: z.iso.date(),
  guests: z.number().int().min(1).max(20)
}).strict().superRefine((value, ctx) => {
  if (value.check_in_date < todayInVietnam()) {
    ctx.addIssue({ code: 'custom', path: ['check_in_date'], message: 'Ngày nhận phòng không được ở quá khứ' });
  }
  const nights = nightsBetween(value.check_in_date, value.check_out_date);
  if (nights < 1) {
    ctx.addIssue({ code: 'custom', path: ['check_out_date'], message: 'Ngày trả phòng phải sau ngày nhận phòng' });
  } else if (nights > MAX_NIGHTS) {
    ctx.addIssue({ code: 'custom', path: ['check_out_date'], message: `Tối đa ${MAX_NIGHTS} đêm mỗi lần đặt` });
  }
});

// Query tìm phòng / xem phòng: dùng check_in / check_out.
function validateStay(value, ctx) {
  if (!value.check_in && !value.check_out) return;
  if (!value.check_in || !value.check_out) {
    ctx.addIssue({ code: 'custom', path: [value.check_in ? 'check_out' : 'check_in'], message: 'Cần cung cấp cả check_in và check_out' });
    return;
  }
  if (value.check_in < todayInVietnam()) ctx.addIssue({ code: 'custom', path: ['check_in'], message: 'Ngày nhận phòng không được ở quá khứ' });
  const nights = nightsBetween(value.check_in, value.check_out);
  if (nights < 1) ctx.addIssue({ code: 'custom', path: ['check_out'], message: 'Ngày trả phòng phải sau ngày nhận phòng' });
  else if (nights > MAX_NIGHTS) ctx.addIssue({ code: 'custom', path: ['check_out'], message: `Tối đa ${MAX_NIGHTS} đêm mỗi lần đặt` });
}
const stayQuerySchema = z.object({ check_in: z.iso.date().optional(), check_out: z.iso.date().optional() }).superRefine(validateStay);
const searchQuerySchema = z.object({
  check_in: z.iso.date().optional(), check_out: z.iso.date().optional(),
  guests: z.coerce.number().int().min(1).max(20).optional(),
  room_type: z.string().trim().toLowerCase().min(1).max(50).optional(),
  min_price: z.coerce.number().int().min(0).optional(), max_price: z.coerce.number().int().min(0).optional(),
  page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(50).default(12)
}).superRefine(validateStay)
  .refine((value) => value.min_price === undefined || value.max_price === undefined || value.min_price <= value.max_price,
    { path: ['max_price'], message: 'max_price phải lớn hơn hoặc bằng min_price' });

// Gợi ý ngày thay thế: bắt buộc có cả check_in và check_out.
const alternativesQuerySchema = z.object({
  check_in: z.iso.date(), check_out: z.iso.date(), guests: z.coerce.number().int().min(1).max(20).optional()
}).superRefine(validateStay);

// Lịch ngày kín của một phòng (mặc định: hôm nay + 90 ngày).
const unavailableQuerySchema = z.object({ from: z.iso.date().optional(), to: z.iso.date().optional() })
  .superRefine((value, ctx) => {
    const from = value.from ?? todayInVietnam();
    const to = value.to ?? addDays(from, 90);
    const days = nightsBetween(from, to);
    if (days < 1) ctx.addIssue({ code: 'custom', path: ['to'], message: 'to phải sau from' });
    else if (days > MAX_CALENDAR_DAYS) ctx.addIssue({ code: 'custom', path: ['to'], message: `Tối đa ${MAX_CALENDAR_DAYS} ngày mỗi lần xem lịch` });
  });

const myBookingsQuerySchema = z.object({
  status: z.string().trim().toUpperCase().pipe(z.enum(['CONFIRMED', 'CANCELLED'])).optional(),
  when: z.string().trim().toLowerCase().pipe(z.enum(['upcoming', 'past'])).optional(),
  page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(50).default(10)
});
const adminBookingsQuerySchema = z.object({
  status: z.string().trim().toUpperCase().pipe(z.enum(['CONFIRMED', 'CANCELLED'])).optional(),
  room_id: uuid.optional(), user_id: uuid.optional(),
  page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(20)
});

// Khách: lý do không bắt buộc. Admin: bắt buộc nhập lý do.
const reasonField = z.string().trim().min(2).max(300);
const cancelSchema = z.object({ reason: reasonField.default('Khách hủy đặt phòng') }).strict();
const adminCancelSchema = z.object({ reason: reasonField }).strict();

const roomCreateSchema = z.object({
  room_number: z.string().trim().min(1).max(20),
  name: z.string().trim().min(2).max(100),
  room_type: z.string().trim().toLowerCase().min(1).max(50),
  price_per_night: z.number().int().min(0).max(1_000_000_000),
  capacity: z.number().int().positive().max(1000),
  size_sqm: z.number().int().positive().max(10000).optional(),
  bed_type: z.string().trim().max(100).default(''),
  view_label: z.string().trim().max(100).default(''),
  floor: z.number().int().min(0).max(200).optional(),
  featured: z.boolean().default(false),
  description: z.string().trim().max(2000).default(''),
  palette: z.array(z.string().trim().min(1).max(20)).max(10).default([]),
  equipment: z.array(z.string().trim().min(1).max(100)).max(100).default([]),
  active: z.boolean().default(true)
}).strict();
const roomUpdateSchema = z.object(Object.fromEntries(
  Object.entries(roomCreateSchema.shape).map(([key, schema]) => [key, schema.unwrap ? schema.unwrap().optional() : schema.optional()])
)).strict().refine((value) => Object.keys(value).length > 0, 'Cần ít nhất một trường cập nhật');
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
    // ----- Phòng (công khai) -----
    listRooms: async (_req, res) => res.json({ data: await repository.listRooms() }),
    searchRooms: async (req, res) => res.json(await bookingService.searchRooms(searchQuerySchema.parse(req.query))),
    getRoom: async (req, res) => {
      const room = await bookingService.getRoomDetail(uuid.parse(req.params.id), stayQuerySchema.parse(req.query));
      res.json({ data: room });
    },
    unavailableDates: async (req, res) => {
      const data = await bookingService.getUnavailableDates(uuid.parse(req.params.id), unavailableQuerySchema.parse(req.query));
      res.json({ data });
    },
    alternatives: async (req, res) => {
      const data = await bookingService.getAlternatives(uuid.parse(req.params.id), alternativesQuerySchema.parse(req.query));
      res.json({ data });
    },

    // ----- Đặt phòng (khách) -----
    createBooking: async (req, res) => {
      const key = idempotencySchema.parse(req.get('Idempotency-Key'));
      const result = await bookingService.create(req.user.id, bookingSchema.parse(req.body), key, req.requestId);
      await dispatchAfterCommit(result.eventId, req.requestId);
      if (result.replayed) res.set('Idempotency-Replayed', 'true');
      res.status(result.replayed ? 200 : 201).json({ data: result.booking });
    },
    myBookings: async (req, res) => res.json(await bookingService.listMine(req.user.id, myBookingsQuerySchema.parse(req.query))),
    getMyBooking: async (req, res) => res.json({ data: await bookingService.getMine(uuid.parse(req.params.id), req.user) }),
    cancelMine: async (req, res) => {
      const result = await bookingService.cancel(uuid.parse(req.params.id), req.user, cancelSchema.parse(req.body ?? {}).reason, false);
      await dispatchAfterCommit(result.eventId, req.requestId);
      res.json({ data: result.booking });
    },

    // ----- Admin -----
    listAdminRooms: async (_req, res) => {
      res.json({ data: await repository.listRooms({ includeInactive: true }) });
    },
    createRoom: async (req, res) => res.status(201).json({ data: await bookingService.createRoom(roomCreateSchema.parse(req.body)) }),
    updateRoom: async (req, res) => {
      res.json({ data: await bookingService.updateRoom(uuid.parse(req.params.id), roomUpdateSchema.parse(req.body)) });
    },
    listBookings: async (req, res) => res.json(await bookingService.listAllBookings(adminBookingsQuerySchema.parse(req.query))),
    cancelAdmin: async (req, res) => {
      const result = await bookingService.cancel(uuid.parse(req.params.id), req.user, adminCancelSchema.parse(req.body).reason, true);
      await dispatchAfterCommit(result.eventId, req.requestId);
      res.json({ data: result.booking });
    },
    listOutbox: async (_req, res) => res.json({ data: await repository.listOutbox() }),
    retryOutbox: async (req, res) => res.json({ data: await dispatcher.retryBatch(req.requestId) })
  };
}
