import { createHash } from 'node:crypto';

export function bookingRequestHash(payload) {
  const canonical = JSON.stringify({
    booking_date: payload.booking_date,
    room_id: payload.room_id,
    slot_id: payload.slot_id
  });
  return createHash('sha256').update(canonical).digest('hex');
}
