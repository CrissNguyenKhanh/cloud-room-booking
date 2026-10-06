import { ApiError } from '../utils/errors.js';

function formatBookingDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
  return `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}`;
}

export function buildNotificationPayload(event) {
  const payload = { ...event.payload };

  if (event.event_type === 'BOOKING_CREATED') {
    const bookingDate = formatBookingDate(payload.booking_date);
    return {
      ...payload,
      title: payload.title ?? 'Đặt phòng thành công',
      message: payload.message ?? (bookingDate
        ? `Đặt phòng của bạn ngày ${bookingDate} đã được xác nhận.`
        : 'Đặt phòng của bạn đã được xác nhận.')
    };
  }

  if (event.event_type === 'BOOKING_CANCELLED') {
    const reason = typeof payload.reason === 'string' ? payload.reason.trim() : '';
    return {
      ...payload,
      title: payload.title ?? 'Đặt phòng đã bị hủy',
      message: payload.message ?? (reason
        ? `Đặt phòng của bạn đã được hủy. Lý do: ${reason}`
        : 'Đặt phòng của bạn đã được hủy.')
    };
  }

  return payload;
}

export class NotificationService {
  constructor(repository) { this.repository = repository; }
  receive(event) {
    return this.repository.create({ ...event, payload: buildNotificationPayload(event) });
  }
  list(userId) { return this.repository.listByUser(userId); }
  async markRead(id, userId) {
    const result = await this.repository.markRead(id, userId);
    if (!result) throw new ApiError(404, 'NOTIFICATION_NOT_FOUND', 'Không tìm thấy thông báo');
    return result;
  }
}
