export const MAX_NIGHTS = 30;
export const CHECK_IN_HOUR = 14; // giờ nhận phòng chuẩn (giờ Việt Nam)
export const CANCEL_BEFORE_HOURS = 24; // chỉ được hủy trước giờ nhận phòng ít nhất 24 giờ

const VIETNAM_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit'
});

// Ngày hôm nay theo giờ Việt Nam, dạng YYYY-MM-DD (không dùng ngày UTC).
export function todayInVietnam(now = new Date()) {
  return VIETNAM_DATE.format(now);
}

// Số đêm giữa hai ngày YYYY-MM-DD; ngày trả phòng không tính là một đêm.
export function nightsBetween(checkIn, checkOut) {
  return Math.round((Date.parse(checkOut) - Date.parse(checkIn)) / 86400000);
}

// Cộng/trừ ngày cho chuỗi YYYY-MM-DD.
export function addDays(date, days) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

// Thời điểm muộn nhất được hủy: 24 giờ trước 14:00 (giờ Việt Nam) của ngày nhận phòng.
export function cancellationDeadline(checkInDate) {
  const hour = String(CHECK_IN_HOUR).padStart(2, '0');
  const checkInAt = Date.parse(`${checkInDate}T${hour}:00:00+07:00`);
  return new Date(checkInAt - CANCEL_BEFORE_HOURS * 3600000);
}

export function canCancel(checkInDate, now = new Date()) {
  return now.getTime() <= cancellationDeadline(checkInDate).getTime();
}

// Các ngày (đêm) bị đặt trong cửa sổ [from, to) từ danh sách khoảng đã đặt.
export function bookedNights(ranges, from, to) {
  const nights = new Set();
  for (const range of ranges) {
    let day = range.check_in_date > from ? range.check_in_date : from;
    const end = range.check_out_date < to ? range.check_out_date : to;
    while (day < end) { nights.add(day); day = addDays(day, 1); }
  }
  return [...nights].sort();
}

// Các khoảng ngày còn trống nằm trong [checkIn, checkOut) sau khi trừ các khoảng đã đặt.
// Ví dụ: muốn 10-15, đã đặt 12-14 => [10-12, 14-15].
export function freeRanges(checkIn, checkOut, booked) {
  const sorted = [...booked].sort((a, b) => (a.check_in_date < b.check_in_date ? -1 : a.check_in_date > b.check_in_date ? 1 : 0));
  const result = [];
  let cursor = checkIn;
  for (const range of sorted) {
    if (range.check_out_date <= cursor) continue;
    if (range.check_in_date > cursor) {
      result.push({ check_in: cursor, check_out: range.check_in_date < checkOut ? range.check_in_date : checkOut });
    }
    if (range.check_out_date > cursor) cursor = range.check_out_date;
    if (cursor >= checkOut) break;
  }
  if (cursor < checkOut) result.push({ check_in: cursor, check_out: checkOut });
  return result.filter((range) => range.check_in < range.check_out);
}