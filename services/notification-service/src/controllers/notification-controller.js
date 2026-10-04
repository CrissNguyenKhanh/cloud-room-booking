import { z } from 'zod';
const eventSchema = z.object({ event_id: z.uuid(), event_type: z.enum(['BOOKING_CREATED', 'BOOKING_CANCELLED']),
  aggregate_id: z.uuid(), user_id: z.uuid(), payload: z.record(z.string(), z.unknown()), occurred_at: z.string().optional() }).strict();
const uuid = z.uuid();
export const createNotificationController = (service) => ({
  receive: async (req, res) => { const result = await service.receive(eventSchema.parse(req.body)); res.status(result.created ? 201 : 200).json({ data: result.notification }); },
  list: async (req, res) => res.json({ data: await service.list(req.user.id) }),
  markRead: async (req, res) => res.json({ data: await service.markRead(uuid.parse(req.params.id), req.user.id) })
});
