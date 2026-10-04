import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { loadConfig } from '../src/config/env.js';
import { createPool } from '../src/config/database.js';

const config = loadConfig();
const pool = createPool(config);
const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.SEED_ADMIN_PASSWORD;

try {
  if (!email || !password) {
    console.log(JSON.stringify({ service: config.serviceName, event: 'admin_seed_skipped', reason: 'SEED_ADMIN_EMAIL or SEED_ADMIN_PASSWORD is empty' }));
  } else {
    z.email().parse(email);
    z.string().min(12).max(72).parse(password);
    const passwordHash = await bcrypt.hash(password, 12);
    await pool.query(
      `INSERT INTO identity.users (email, password_hash, full_name, role)
       VALUES ($1, $2, 'System Administrator', 'ADMIN')
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = 'ADMIN', updated_at = now()`,
      [email, passwordHash]
    );
    console.log(JSON.stringify({ service: config.serviceName, event: 'admin_seeded', email }));
  }
} finally { await pool.end(); }
