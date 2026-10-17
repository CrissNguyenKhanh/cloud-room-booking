import { v2 as cloudinary } from 'cloudinary';
import { ApiError } from '../utils/errors.js';

const THUMBNAIL = { width: 480, height: 320, crop: 'fill' };

function logFailure(event, error, extra = {}) {
  console.error(JSON.stringify({ timestamp: new Date().toISOString(), service: 'booking-service', level: 'error',
    event, message: error?.message, http_code: error?.http_code, ...extra }));
}

function describe(result, mediaType) {
  // Ảnh: thumbnail cắt vừa khung. Video: ảnh đại diện (poster) lấy từ khung hình đầu.
  const thumbnailUrl = mediaType === 'video'
    ? cloudinary.url(result.public_id, { secure: true, resource_type: 'video', format: 'jpg', version: result.version, transformation: [THUMBNAIL] })
    : cloudinary.url(result.public_id, { secure: true, resource_type: 'image', version: result.version,
      transformation: [{ ...THUMBNAIL, quality: 'auto', fetch_format: 'auto' }] });
  return {
    url: result.secure_url, thumbnail_url: thumbnailUrl, public_id: result.public_id, format: result.format ?? null,
    bytes: result.bytes ?? null, width: result.width ?? null, height: result.height ?? null,
    duration_seconds: typeof result.duration === 'number' ? result.duration : null
  };
}

// Trả { enabled: false } khi chưa có khóa Cloudinary. Tests thay bằng đối tượng giả cùng giao diện.
export function createMediaStorage(config) {
  const settings = config.cloudinary;
  if (!settings) return { enabled: false };
  cloudinary.config({ cloud_name: settings.cloudName, api_key: settings.apiKey, api_secret: settings.apiSecret, secure: true });
  return {
    enabled: true,
    // Trả { url, thumbnail_url, public_id, format, bytes, width, height, duration_seconds }
    upload: ({ buffer, mediaType, roomId }) => new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream({
        resource_type: mediaType, folder: `${settings.folder}/rooms/${roomId}`, unique_filename: true, overwrite: false, timeout: 60000
      }, (error, result) => {
        if (error || !result) {
          logFailure('media_upload_failed', error);
          return reject(new ApiError(502, 'MEDIA_UPLOAD_FAILED', 'Không thể tải tệp lên dịch vụ lưu trữ'));
        }
        resolve(describe(result, mediaType));
      });
      stream.end(buffer);
    }),
    destroy: async (publicId, mediaType) => {
      const result = await cloudinary.uploader.destroy(publicId, { resource_type: mediaType, invalidate: true });
      // "not found" nghĩa là file đã không còn, coi như xóa xong.
      if (result.result !== 'ok' && result.result !== 'not found') throw new Error(`Cloudinary destroy: ${result.result}`);
    }
  };
}