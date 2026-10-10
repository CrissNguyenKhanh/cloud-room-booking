import { ApiError } from '../utils/errors.js';

function formatBookingDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
  return `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}`;
}

function trimmedString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function callerText(value, fallback) {
  return trimmedString(value) ? value : fallback;
}

function hasAdminRole(actor) {
  return typeof actor?.role === 'string' && actor.role.toUpperCase() === 'ADMIN';
}

function buildCreatedAdminMessage({ bookingCode, roomName, checkInDate, checkOutDate }) {
  const subject = bookingCode ? `Đơn ${bookingCode} vừa được tạo` : 'Có đơn đặt phòng mới';
  const room = roomName ? ` cho phòng ${roomName}` : '';
  const stay = checkInDate && checkOutDate ? ` từ ${checkInDate} đến ${checkOutDate}` : '';
  return `${subject}${room}${stay}.`;
}

function buildCancelledAdminMessage({ bookingCode, roomName, reason }) {
  const subject = bookingCode
    ? `Đơn ${bookingCode}${roomName ? ` cho phòng ${roomName}` : ''}`
    : roomName ? `Đặt phòng cho phòng ${roomName}` : 'Đặt phòng';
  return `${subject} đã được khách hủy.${reason ? ` Lý do: ${reason}` : ''}`;
}

function isAdminVisibleEvent(event, payload) {
  if (event.event_type === 'BOOKING_CREATED') return true;
  return event.event_type === 'BOOKING_CANCELLED'
    && trimmedString(payload.cancelled_by).toUpperCase() === 'USER';
}

function notificationForActor(notification, actor) {
  if (!hasAdminRole(actor) || !notification.admin_visible) return notification;
  const payload = { ...notification.payload };
  return {
    ...notification,
    payload: {
      ...payload,
      title: callerText(payload.admin_title, payload.title),
      message: callerText(payload.admin_message, payload.message)
    }
  };
}

export function buildNotificationPayload(event) {
  const payload = { ...event.payload };

  if (event.event_type === 'BOOKING_CREATED') {
    const bookingDate = formatBookingDate(payload.booking_date);
    const checkInDate = formatBookingDate(payload.check_in_date);
    const checkOutDate = formatBookingDate(payload.check_out_date);
    const bookingCode = trimmedString(payload.booking_code);
    const roomName = trimmedString(payload.room_name);
    let generatedMessage = 'Đặt phòng của bạn đã được xác nhận.';

    if (bookingDate) {
      generatedMessage = `Đặt phòng của bạn ngày ${bookingDate} đã được xác nhận.`;
    } else if (checkInDate && checkOutDate) {
      generatedMessage = roomName
        ? `Phòng ${roomName} đã được xác nhận từ ${checkInDate} đến ${checkOutDate}.`
        : `Đặt phòng của bạn đã được xác nhận từ ${checkInDate} đến ${checkOutDate}.`;
    }

    return {
      ...payload,
      title: payload.title ?? 'Đặt phòng thành công',
      message: payload.message ?? generatedMessage,
      admin_title: callerText(payload.admin_title, 'Có đơn đặt phòng mới'),
      admin_message: callerText(payload.admin_message, buildCreatedAdminMessage({
        bookingCode,
        roomName,
        checkInDate,
        checkOutDate
      }))
    };
  }

  if (event.event_type === 'BOOKING_CANCELLED') {
    const reason = trimmedString(payload.reason);
    const bookingCode = trimmedString(payload.booking_code);
    const roomName = trimmedString(payload.room_name);
    let generatedMessage = 'Đặt phòng của bạn đã được hủy.';

    if (reason) {
      if (bookingCode) generatedMessage = `Đơn ${bookingCode} đã được hủy. Lý do: ${reason}`;
      else if (roomName) generatedMessage = `Phòng ${roomName} đã được hủy. Lý do: ${reason}`;
      else generatedMessage = `Đặt phòng của bạn đã được hủy. Lý do: ${reason}`;
    }

    const notificationPayload = {
      ...payload,
      title: payload.title ?? 'Đặt phòng đã bị hủy',
      message: payload.message ?? generatedMessage
    };
    if (trimmedString(payload.cancelled_by).toUpperCase() === 'USER') {
      notificationPayload.admin_title = callerText(payload.admin_title, 'Khách đã hủy đặt phòng');
      notificationPayload.admin_message = callerText(payload.admin_message, buildCancelledAdminMessage({
        bookingCode,
        roomName,
        reason
      }));
    }
    return notificationPayload;
  }

  return payload;
}

export class NotificationService {
  constructor(repository) { this.repository = repository; }
  receive(event) {
    const payload = buildNotificationPayload(event);
    return this.repository.create({
      ...event,
      payload,
      adminVisible: isAdminVisibleEvent(event, payload)
    });
  }
  async list(actor) {
    const notifications = hasAdminRole(actor)
      ? await this.repository.listForAdmin(actor.id)
      : await this.repository.listByUser(actor.id);
    return notifications.map((notification) => notificationForActor(notification, actor));
  }
  async markRead(id, actor) {
    const result = hasAdminRole(actor)
      ? await this.repository.markReadByAdmin(id, actor.id)
      : await this.repository.markRead(id, actor.id);
    if (!result) throw new ApiError(404, 'NOTIFICATION_NOT_FOUND', 'Không tìm thấy thông báo');
    return notificationForActor(result, actor);
  }
}
