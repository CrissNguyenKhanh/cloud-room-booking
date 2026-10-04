export class UserRepository {
  constructor(pool) { this.pool = pool; }

  async create({ email, passwordHash, fullName }) {
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO identity.users (email, password_hash, full_name)
         VALUES ($1, $2, $3)
         RETURNING id, email, full_name, role, status, created_at, updated_at`,
        [email, passwordHash, fullName]
      );
      return rows[0];
    } catch (error) {
      if (error.code === '23505') return null;
      throw error;
    }
  }

  async findByEmail(email) {
    const { rows } = await this.pool.query(
      `SELECT id, email, password_hash, full_name, role, status, created_at, updated_at
       FROM identity.users WHERE email = $1`, [email]
    );
    return rows[0] || null;
  }

  async findPublicById(id) {
    const { rows } = await this.pool.query(
      `SELECT id, email, full_name, role, status, created_at, updated_at
       FROM identity.users WHERE id = $1`, [id]
    );
    return rows[0] || null;
  }

  async list() {
    const { rows } = await this.pool.query(
      `SELECT id, email, full_name, role, status, created_at, updated_at
       FROM identity.users ORDER BY created_at DESC`
    );
    return rows;
  }

  async updateStatus(id, status) {
    const { rows } = await this.pool.query(
      `UPDATE identity.users SET status = $2, updated_at = now() WHERE id = $1
       RETURNING id, email, full_name, role, status, created_at, updated_at`, [id, status]
    );
    return rows[0] || null;
  }
}
