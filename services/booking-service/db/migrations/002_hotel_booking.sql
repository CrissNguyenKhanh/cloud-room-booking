-- 002: chuyển Booking từ mô hình "ngày + ca" sang đặt phòng khách sạn theo khoảng ngày.
-- Yêu cầu: extension btree_gist phải được tạo trước bởi tài khoản admin (xem hướng dẫn trong PR).
-- Cảnh báo: migration này XÓA dữ liệu demo của mô hình cũ (bookings và rooms phòng họp)
-- vì không thể quy đổi lịch theo ca sang khoảng ngày.
CREATE EXTENSION IF NOT EXISTS btree_gist;

DELETE FROM booking.bookings;
DELETE FROM booking.rooms;

ALTER TABLE booking.rooms
  ADD COLUMN room_number text NOT NULL,
  ADD COLUMN room_type text NOT NULL,
  ADD COLUMN price_per_night integer NOT NULL CHECK (price_per_night >= 0),
  ADD COLUMN size_sqm integer CHECK (size_sqm > 0),
  ADD COLUMN bed_type text NOT NULL DEFAULT '',
  ADD COLUMN view_label text NOT NULL DEFAULT '',
  ADD COLUMN floor integer,
  ADD COLUMN featured boolean NOT NULL DEFAULT false,
  ADD COLUMN description text NOT NULL DEFAULT '',
  ADD COLUMN palette jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD CONSTRAINT rooms_room_number_key UNIQUE (room_number);

DROP INDEX IF EXISTS booking.bookings_room_date_slot_confirmed_uidx;

ALTER TABLE booking.bookings
  DROP COLUMN booking_date,
  DROP COLUMN slot_id,
  ADD COLUMN booking_code text NOT NULL,
  ADD COLUMN check_in_date date NOT NULL,
  ADD COLUMN check_out_date date NOT NULL,
  ADD COLUMN guests integer NOT NULL CHECK (guests > 0),
  ADD COLUMN nights integer NOT NULL CHECK (nights > 0),
  ADD COLUMN price_per_night integer NOT NULL CHECK (price_per_night >= 0),
  ADD COLUMN total_price bigint NOT NULL CHECK (total_price >= 0),
  ADD CONSTRAINT bookings_booking_code_key UNIQUE (booking_code),
  ADD CONSTRAINT bookings_dates_order CHECK (check_out_date > check_in_date),
  ADD CONSTRAINT bookings_nights_match CHECK (nights = check_out_date - check_in_date);

-- Chống đặt chồng ngày trên cùng một phòng. Khoảng [check_in, check_out) nên khách này
-- trả phòng đúng ngày khách khác nhận phòng vẫn hợp lệ. Vi phạm báo SQLSTATE 23P01.
ALTER TABLE booking.bookings
  ADD CONSTRAINT bookings_no_overlap
  EXCLUDE USING gist (room_id WITH =, daterange(check_in_date, check_out_date, '[)') WITH &&)
  WHERE (status = 'CONFIRMED');

CREATE INDEX bookings_user_checkin_idx ON booking.bookings (user_id, check_in_date DESC);

DROP TABLE booking.slots;