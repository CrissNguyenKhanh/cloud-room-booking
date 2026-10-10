import pg from "pg";
export const createPool = (config) =>
  new pg.Pool({
    connectionString: config.databaseUrl,
    max: 10,
    connectionTimeoutMillis: config.databaseConnectionTimeoutMs,
    ssl: config.databaseUrl.includes("sslmode=require")
      ? { rejectUnauthorized: false }
      : undefined,
  });
