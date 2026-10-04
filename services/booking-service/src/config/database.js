import pg from 'pg';

export function createPool(config) {
  return new pg.Pool({
    connectionString: config.databaseUrl, max: 15, connectionTimeoutMillis: 3000, idleTimeoutMillis: 30000,
    ssl: config.databaseUrl.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined
  });
}
