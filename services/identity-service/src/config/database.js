import pg from 'pg';

export function createPool(config) {
  return new pg.Pool({
    connectionString: config.databaseUrl,
    max: 10,
    connectionTimeoutMillis: config.databaseConnectionTimeoutMs,
    idleTimeoutMillis: 30000,
    ssl: config.databaseUrl.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined
  });
}
