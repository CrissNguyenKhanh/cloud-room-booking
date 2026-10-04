import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config/env.js';
import { createPool } from '../src/config/database.js';

const config = loadConfig();
const pool = createPool(config);
const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../db/migrations');
try {
  await pool.query('CREATE SCHEMA IF NOT EXISTS booking');
  await pool.query(`CREATE TABLE IF NOT EXISTS booking.schema_migrations
    (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  for (const file of (await fs.readdir(dir)).filter((name) => name.endsWith('.sql')).sort()) {
    if ((await pool.query('SELECT 1 FROM booking.schema_migrations WHERE version = $1', [file])).rowCount) continue;
    const client = await pool.connect();
    try {
      await client.query('BEGIN'); await client.query(await fs.readFile(path.join(dir, file), 'utf8'));
      await client.query('INSERT INTO booking.schema_migrations (version) VALUES ($1)', [file]); await client.query('COMMIT');
      console.log(JSON.stringify({ service: config.serviceName, event: 'migration_applied', version: file }));
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
} finally { await pool.end(); }
