import { z } from 'zod';
import { ApiError } from '../utils/errors.js';

const registerSchema = z.object({
  email: z.email(), password: z.string().min(8).max(72), full_name: z.string().trim().min(2).max(100)
}).strict();
const loginSchema = z.object({ email: z.email(), password: z.string().min(1).max(72) }).strict();
const statusSchema = z.object({ status: z.enum(['ACTIVE', 'LOCKED']) }).strict();
const idSchema = z.uuid();

export function createIdentityController(service, repository) {
  return {
    register: async (req, res) => res.status(201).json({ data: await service.register(registerSchema.parse(req.body)) }),
    login: async (req, res) => res.json({ data: await service.login(loginSchema.parse(req.body)) }),
    me: async (req, res) => {
      const user = await repository.findPublicById(req.user.id);
      if (!user) throw new ApiError(404, 'USER_NOT_FOUND', 'Không tìm thấy người dùng');
      res.json({ data: user });
    },
    list: async (_req, res) => res.json({ data: await repository.list() }),
    updateStatus: async (req, res) => {
      const user = await repository.updateStatus(idSchema.parse(req.params.id), statusSchema.parse(req.body).status);
      if (!user) throw new ApiError(404, 'USER_NOT_FOUND', 'Không tìm thấy người dùng');
      res.json({ data: user });
    },
    internalStatus: async (req, res) => {
      const user = await repository.findPublicById(idSchema.parse(req.params.id));
      if (!user) throw new ApiError(404, 'USER_NOT_FOUND', 'Không tìm thấy người dùng');
      res.json({ data: { id: user.id, role: user.role, status: user.status } });
    }
  };
}
