import pg from "pg";

// DATE trả về chuỗi 'YYYY-MM-DD' (mặc định pg đổi thành Date và lệch theo múi giờ).
pg.types.setTypeParser(1082, (value) => value);
// BIGINT (total_price) trả về number thay vì chuỗi.
pg.types.setTypeParser(20, (value) => Number(value));

export function createPool(config) {
  return new pg.Pool({
    connectionString: config.databaseUrl,
    max: 15,
    connectionTimeoutMillis: config.databaseConnectionTimeoutMs,
    idleTimeoutMillis: 30000,
    ssl: config.databaseUrl.includes("sslmode=require")
      ? { rejectUnauthorized: false }
      : undefined,
  });
}
