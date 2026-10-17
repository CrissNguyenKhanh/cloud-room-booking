-- 003: ảnh và video tham khảo của phòng. File thật lưu trên Cloudinary, bảng này chỉ lưu URL và thông tin mô tả.
CREATE TABLE booking.room_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES booking.rooms(id) ON DELETE CASCADE,
  media_type text NOT NULL CHECK (media_type IN ('image', 'video')),
  url text NOT NULL,
  thumbnail_url text,
  public_id text NOT NULL,
  format text,
  bytes bigint CHECK (bytes >= 0),
  width integer CHECK (width > 0),
  height integer CHECK (height > 0),
  duration_seconds double precision CHECK (duration_seconds >= 0),
  alt_text text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0,
  is_cover boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- public_id dùng để xóa file trên Cloudinary nên không được trùng trong cùng loại media.
  CONSTRAINT room_media_public_id_key UNIQUE (media_type, public_id),
  -- Chỉ ảnh mới được làm ảnh bìa.
  CONSTRAINT room_media_cover_is_image CHECK (NOT is_cover OR media_type = 'image')
);

-- Mỗi phòng tối đa một ảnh bìa.
CREATE UNIQUE INDEX room_media_one_cover_uidx ON booking.room_media (room_id) WHERE is_cover;
CREATE INDEX room_media_room_order_idx ON booking.room_media (room_id, sort_order, created_at);