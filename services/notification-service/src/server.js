import { loadConfig } from './config/env.js';
import { createPool } from './config/database.js';
import { createApp } from './app.js';
const config = loadConfig(); const pool = createPool(config); const app = createApp({ pool, config });
const server = app.listen(config.port, '0.0.0.0', () => console.log(JSON.stringify({ timestamp: new Date().toISOString(), service: config.serviceName, event: 'started', port: config.port })));
const shutdown = () => server.close(async () => { await pool.end(); process.exit(0); });
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
