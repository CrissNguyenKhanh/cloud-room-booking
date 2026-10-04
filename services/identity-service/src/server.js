import { loadConfig } from './config/env.js';
import { createPool } from './config/database.js';
import { createApp } from './app.js';

const config = loadConfig();
const pool = createPool(config);
const app = createApp({ pool, config });
const server = app.listen(config.port, '0.0.0.0', () => {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), service: config.serviceName, event: 'started', port: config.port }));
});

async function shutdown(signal) {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), service: config.serviceName, event: 'shutdown', signal }));
  server.close(async () => { await pool.end(); process.exit(0); });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
