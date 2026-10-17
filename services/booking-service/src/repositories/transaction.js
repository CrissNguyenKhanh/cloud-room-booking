// Chạy một nhóm câu lệnh trong một transaction (BEGIN / COMMIT, lỗi thì ROLLBACK).
export async function runInTransaction(pool, work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
