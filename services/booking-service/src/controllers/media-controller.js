import multer from 'multer';
import { z } from 'zod';
import { ApiError } from '../utils/errors.js';

const uuid = z.uuid();

const uploadBodySchema = z.object({
  alt_text: z.string().trim().max(200).default('')
}).strict();

const updateBodySchema = z.object({
  alt_text: z.string().trim().max(200).optional(),
  sort_order: z.number().int().min(1).max(10000).optional(),
  is_cover: z.boolean().optional()
}).strict().refine((value) => Object.keys(value).length > 0, {
  message: 'Cần cung cấp ít nhất một trường: alt_text, sort_order hoặc is_cover'
});

const replaceFileBodySchema = z.object({
  alt_text: z.string().trim().max(200).optional()
}).strict();

function translateUploadError(error) {
  if (error instanceof ApiError) return error;
  if (error?.code === 'LIMIT_FILE_SIZE') {
    return new ApiError(413, 'FILE_TOO_LARGE', 'Tệp vượt quá dung lượng cho phép');
  }
  if (error?.code === 'LIMIT_UNEXPECTED_FILE') {
    return new ApiError(400, 'INVALID_FILE_FIELD', 'Tệp phải được gửi trong trường "file"');
  }
  return new ApiError(400, 'INVALID_UPLOAD', 'Yêu cầu tải lên không hợp lệ');
}

function publicMedia(media) {
  // Chỉ đưa các trường cần cho giao diện khách; không lộ public_id nội bộ Cloudinary.
  return {
    id: media.id,
    room_id: media.room_id,
    media_type: media.media_type,
    url: media.url,
    thumbnail_url: media.thumbnail_url,
    format: media.format,
    bytes: media.bytes,
    width: media.width,
    height: media.height,
    duration_seconds: media.duration_seconds,
    alt_text: media.alt_text,
    sort_order: media.sort_order,
    is_cover: media.is_cover,
    created_at: media.created_at,
    updated_at: media.updated_at
  };
}

export function createMediaController({ mediaService }) {
  const maxBytes = Math.max(
    mediaService.limits.maxImageBytes,
    mediaService.limits.maxVideoBytes
  );

  const parser = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxBytes, files: 1, fields: 5, parts: 6 }
  }).single('file');

  const parseUpload = (req, res) => new Promise((resolve, reject) => {
    parser(req, res, (error) => (
      error ? reject(translateUploadError(error)) : resolve()
    ));
  });

  return {
    // Public: chỉ trả media của phòng đang hoạt động.
    listPublicMedia: async (req, res) => {
      const roomId = uuid.parse(req.params.id);
      const media = await mediaService.list(roomId);
      res.json({ data: media.map(publicMedia) });
    },

    // Admin: xem media kể cả khi phòng đã ngừng hoạt động.
    listMedia: async (req, res) => {
      const roomId = uuid.parse(req.params.id);
      const media = await mediaService.list(roomId, { includeInactive: true });
      res.json({ data: media });
    },

    uploadMedia: async (req, res) => {
      const roomId = uuid.parse(req.params.id);
      mediaService.assertEnabled();

      await parseUpload(req, res);

      const body = uploadBodySchema.parse({
        alt_text: req.body?.alt_text
      });

      const media = await mediaService.upload(roomId, req.file, body.alt_text);
      res.status(201).json({ data: media });
    },

    // Thay file Cloudinary nhưng giữ nguyên mediaId.
    replaceMediaFile: async (req, res) => {
      const roomId = uuid.parse(req.params.id);
      const mediaId = uuid.parse(req.params.mediaId);

      mediaService.assertEnabled();
      await parseUpload(req, res);

      const body = replaceFileBodySchema.parse(
        req.body?.alt_text === undefined
          ? {}
          : { alt_text: req.body.alt_text }
      );

      const result = await mediaService.replaceFile(
        roomId,
        mediaId,
        req.file,
        body.alt_text
      );

      res.json({
        data: result.media,
        storage_cleanup_pending: result.storage_cleanup_pending
      });
    },

    updateMedia: async (req, res) => {
      const roomId = uuid.parse(req.params.id);
      const mediaId = uuid.parse(req.params.mediaId);
      const body = updateBodySchema.parse(req.body);

      const media = await mediaService.update(roomId, mediaId, body);
      res.json({ data: media });
    },

    deleteMedia: async (req, res) => {
      const roomId = uuid.parse(req.params.id);
      const mediaId = uuid.parse(req.params.mediaId);

      const result = await mediaService.delete(roomId, mediaId);

      res.json({
        data: { id: result.media.id, deleted: true },
        storage_cleanup_pending: result.storage_cleanup_pending
      });
    }
  };
}