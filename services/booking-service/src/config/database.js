import pg from 'pg';

pg.types.setTypeParser(1082, (value) => value);

export function createPool(config) {
  return new pg.Pool({
    connectionString: config.databaseUrl, max: 15,
    connectionTimeoutMillis: config.databaseConnectionTimeoutMs, idleTimeoutMillis: 30000,
    ssl: config.databaseUrl.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined
  });
}
