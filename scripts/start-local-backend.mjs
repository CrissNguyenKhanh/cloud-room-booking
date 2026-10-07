import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(repoRoot, '.env.local');

if (!existsSync(envFile)) {
  console.error('[local] Missing .env.local. Copy .env.local.example to .env.local and fill in the required values.');
  process.exit(1);
}

try {
  process.loadEnvFile(envFile);
} catch {
  console.error('[local] Could not load .env.local. Check that the file uses valid KEY=value entries.');
  process.exit(1);
}

const requiredVariables = [
  'FRONTEND_ORIGIN',
  'JWT_SECRET',
  'JWT_ISSUER',
  'JWT_AUDIENCE',
  'INTERNAL_SERVICE_KEY'
];
const missingVariables = requiredVariables.filter((name) => !process.env[name]?.trim());

const databaseUrls = {
  identity: process.env.IDENTITY_DATABASE_URL?.trim() || process.env.LOCAL_NEON_DATABASE_URL?.trim(),
  booking: process.env.BOOKING_DATABASE_URL?.trim() || process.env.LOCAL_NEON_DATABASE_URL?.trim(),
  notification: process.env.NOTIFICATION_DATABASE_URL?.trim() || process.env.LOCAL_NEON_DATABASE_URL?.trim()
};

for (const [service, databaseUrl] of Object.entries(databaseUrls)) {
  if (!databaseUrl) {
    missingVariables.push(
      `${service.toUpperCase()}_DATABASE_URL (or LOCAL_NEON_DATABASE_URL)`
    );
  }
}

if (missingVariables.length > 0) {
  console.error(`[local] Missing required variables in .env.local: ${missingVariables.join(', ')}`);
  process.exit(1);
}

const services = [
  {
    name: 'Identity',
    label: 'identity',
    directory: 'identity-service',
    port: '3001',
    env: { IDENTITY_DATABASE_URL: databaseUrls.identity }
  },
  {
    name: 'Notification',
    label: 'notification',
    directory: 'notification-service',
    port: '3003',
    env: { NOTIFICATION_DATABASE_URL: databaseUrls.notification }
  },
  {
    name: 'Booking',
    label: 'booking',
    directory: 'booking-service',
    port: '3002',
    env: {
      BOOKING_DATABASE_URL: databaseUrls.booking,
      IDENTITY_SERVICE_URL: 'http://localhost:3001',
      NOTIFICATION_SERVICE_URL: 'http://localhost:3003'
    }
  }
];

const children = new Map();
let shuttingDown = false;
let shutdownExitCode = 0;
let forceShutdownTimer;

function finishShutdownWhenReady() {
  if (shuttingDown && children.size === 0) {
    clearTimeout(forceShutdownTimer);
    process.exit(shutdownExitCode);
  }
}

function shutdown(exitCode) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  shutdownExitCode = exitCode;

  for (const child of children.values()) {
    child.kill('SIGTERM');
  }

  if (children.size === 0) {
    process.exit(shutdownExitCode);
  }

  forceShutdownTimer = setTimeout(() => {
    for (const child of children.values()) {
      child.kill('SIGKILL');
    }
  }, 5000);
}

for (const service of services) {
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: path.join(repoRoot, 'services', service.directory),
    env: {
      ...process.env,
      ...service.env,
      PORT: service.port
    },
    stdio: 'inherit'
  });

  children.set(service.label, child);

  child.on('error', (error) => {
    console.error(`[local] ${service.name} failed to start: ${error.message}`);
    shutdown(1);
  });

  child.on('close', (code, signal) => {
    children.delete(service.label);

    if (!shuttingDown) {
      const detail = signal ? `signal ${signal}` : `code ${code}`;
      console.error(`[local] ${service.name} exited unexpectedly (${detail}).`);
      shutdown(1);
    }

    finishShutdownWhenReady();
  });
}

console.log('[local] Identity     http://localhost:3001');
console.log('[local] Booking      http://localhost:3002');
console.log('[local] Notification http://localhost:3003');

process.on('SIGINT', () => {
  console.log('\n[local] Shutting down services...');
  shutdown(130);
});

process.on('SIGTERM', () => {
  console.log('\n[local] Shutting down services...');
  shutdown(143);
});
