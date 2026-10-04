import { loadConfig } from '../src/config/env.js';
import { createPool } from '../src/config/database.js';
const config = loadConfig();
const pool = createPool(config);
const rooms = [
  ['Phòng Họp A', 8, ['TV', 'Whiteboard']],
  ['Phòng Họp B', 16, ['Projector', 'Video conference']],
  ['Phòng Học C', 32, ['Projector', 'Speakers', 'Whiteboard']]
];
const slots = [['SLOT-1', '08:00', '10:00'], ['SLOT-2', '10:15', '12:15'], ['SLOT-3', '13:30', '15:30'], ['SLOT-4', '15:45', '17:45']];
try {
  for (const [name, capacity, equipment] of rooms) await pool.query(
    `INSERT INTO booking.rooms (name, capacity, equipment) VALUES ($1, $2, $3)
     ON CONFLICT (name) DO UPDATE SET capacity = EXCLUDED.capacity, equipment = EXCLUDED.equipment, updated_at = now()`,
    [name, capacity, JSON.stringify(equipment)]);
  for (const [code, start, end] of slots) await pool.query(
    `INSERT INTO booking.slots (code, start_time, end_time) VALUES ($1, $2, $3)
     ON CONFLICT (code) DO UPDATE SET start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time`, [code, start, end]);
  console.log(JSON.stringify({ service: config.serviceName, event: 'seed_complete', rooms: rooms.length, slots: slots.length }));
} finally { await pool.end(); }
