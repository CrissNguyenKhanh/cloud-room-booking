import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { ApiError } from '../utils/errors.js';

export class IdentityService {
  constructor(repository, config) {
    this.repository = repository;
    this.config = config;
  }

  async register({ email, password, full_name }) {
    const normalizedEmail = email.trim().toLowerCase();
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await this.repository.create({ email: normalizedEmail, passwordHash, fullName: full_name.trim() });
    if (!user) throw new ApiError(409, 'EMAIL_ALREADY_EXISTS', 'Email đã được sử dụng');
    return user;
  }

  async login({ email, password }) {
    const user = await this.repository.findByEmail(email.trim().toLowerCase());
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      throw new ApiError(401, 'INVALID_CREDENTIALS', 'Email hoặc mật khẩu không đúng');
    }
    if (user.status !== 'ACTIVE') throw new ApiError(403, 'ACCOUNT_LOCKED', 'Tài khoản đã bị khóa');
    const token = jwt.sign({ role: user.role, status: user.status }, this.config.jwtSecret, {
      algorithm: 'HS256', subject: user.id, issuer: this.config.jwtIssuer,
      audience: this.config.jwtAudience, expiresIn: this.config.jwtExpiresIn
    });
    return { access_token: token, token_type: 'Bearer', expires_in: this.config.jwtExpiresIn };
  }
}
