import { ApiError } from '../utils/errors.js';
export class NotificationService {
  constructor(repository) { this.repository = repository; }
  receive(event) { return this.repository.create(event); }
  list(userId) { return this.repository.listByUser(userId); }
  async markRead(id, userId) {
    const result = await this.repository.markRead(id, userId);
    if (!result) throw new ApiError(404, 'NOTIFICATION_NOT_FOUND', 'Không tìm thấy thông báo');
    return result;
  }
}
