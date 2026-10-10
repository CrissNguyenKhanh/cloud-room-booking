import { createServer } from 'node:http';
import { loadConfig } from './config/env.js';
import { createPool } from './config/database.js';
import { createApp } from './app.js';
import { createNotificationWebSocket } from './realtime/notification-websocket.js';

const config = loadConfig();
const pool = createPool(config);
const server = createServer();
const realtime = createNotificationWebSocket({ server, config });
const app = createApp({ pool, config, realtime });
server.on('request', app);
server.listen(config.port, '0.0.0.0', () => console.log(JSON.stringify({
  timestamp: new Date().toISOString(),
  service: config.serviceName,
  event: 'started',
  port: config.port
})));

let shuttingDown = false;
const closeHttpServer = () => new Promise((resolve, reject) => {
  server.close((error) => error ? reject(error) : resolve());
});
const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await realtime.close();
    await closeHttpServer();
    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error(JSON.stringify({
      timestamp: new Date().toISOString(),
      service: config.serviceName,
      event: 'shutdown_failed',
      errorType: error instanceof Error ? error.name : 'UnknownError'
    }));
    process.exit(1);
  }
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
