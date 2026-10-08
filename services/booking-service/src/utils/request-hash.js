import { createHash } from 'node:crypto';

export function bookingRequestHash(payload) {
  const canonical = JSON.stringify({
    room_id: payload.room_id,
    check_in_date: payload.check_in_date,
    check_out_date: payload.check_out_date,
    guests: payload.guests
  });
  return createHash('sha256').update(canonical).digest('hex');
}
