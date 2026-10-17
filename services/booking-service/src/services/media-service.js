import { ApiError } from '../utils/errors.js';
import { detectMedia } from '../utils/media-type.js';

export const DEFAULT_MEDIA_LIMITS = {
  maxImageBytes: 5 * 1024 * 1024,
  maxVideoBytes: 30 * 1024 * 1024,
  maxPerRoom: 20
};

const megabytes = (bytes) => Math.round((bytes / 1024 / 1024) * 10) / 10;

export class MediaService {
  constructor(repository, storage, config = {}) {
    this.repository = repository;
    this.storage = storage;
    this.limits = {
      maxImageBytes: config.mediaMaxImageBytes ?? DEFAULT_MEDIA_LIMITS.maxImageBytes,
      maxVideoBytes: config.mediaMaxVideoBytes ?? DEFAULT_MEDIA_LIMITS.maxVideoBytes,
      maxPerRoom: config.mediaMaxPerRoom ?? DEFAULT_MEDIA_LIMITS.maxPerRoom
    };
  }

  assertEnabled() {
    if (!this.storage?.enabled) {
      throw new ApiError(
        503,
        'MEDIA_NOT_CONFIGURED',
        'Chưa cấu hình dịch vụ lưu trữ ảnh và video (Cloudinary)'
      );
    }
  }

  // Admin có thể xem media của cả phòng đang ngừng hoạt động.
  // Public mặc định chỉ xem media của phòng đang hoạt động.
  async list(roomId, { includeInactive = false } = {}) {
    const room = await this.repository.getRoom(roomId, includeInactive);
    if (!room) {
      throw new ApiError(404, 'ROOM_NOT_FOUND', 'Không tìm thấy phòng');
    }
    return this.repository.listMedia(roomId);
  }

  async upload(roomId, file, altText = '') {
    this.assertEnabled();

    if (!file?.buffer?.length) {
      throw new ApiError(400, 'FILE_REQUIRED', 'Cần gửi tệp ảnh hoặc video trong trường "file"');
    }

    const detected = detectMedia(file.buffer);
    if (!detected) {
      throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Chỉ nhận ảnh JPEG, PNG, WebP hoặc video MP4, WebM');
    }

    const maxBytes = detected.mediaType === 'image'
      ? this.limits.maxImageBytes
      : this.limits.maxVideoBytes;

    if (file.buffer.length > maxBytes) {
      throw new ApiError(
        413,
        'FILE_TOO_LARGE',
        `${detected.mediaType === 'image' ? 'Ảnh' : 'Video'} tối đa ${megabytes(maxBytes)} MB`
      );
    }

    if (!(await this.repository.getRoom(roomId, true))) {
      throw new ApiError(404, 'ROOM_NOT_FOUND', 'Không tìm thấy phòng');
    }

    const uploaded = await this.storage.upload({
      buffer: file.buffer,
      mediaType: detected.mediaType,
      roomId
    });

    let result;
    try {
      result = await this.repository.addMedia(
        roomId,
        { media_type: detected.mediaType, ...uploaded, alt_text: altText },
        this.limits.maxPerRoom
      );
    } catch (error) {
      await this.discard(uploaded.public_id, detected.mediaType);
      throw error;
    }

    if (result.outcome === 'OK') return result.media;

    await this.discard(uploaded.public_id, detected.mediaType);
    if (result.outcome === 'LIMIT_REACHED') {
      throw new ApiError(409, 'MEDIA_LIMIT_REACHED', `Mỗi phòng tối đa ${this.limits.maxPerRoom} ảnh và video`);
    }
    throw new ApiError(404, 'ROOM_NOT_FOUND', 'Không tìm thấy phòng');
  }

  // Chỉ cho phép sửa metadata; file trên Cloudinary không cần upload lại.
  async update(roomId, mediaId, data) {
    const room = await this.repository.getRoom(roomId, true);
    if (!room) throw new ApiError(404, 'ROOM_NOT_FOUND', 'Không tìm thấy phòng');

    const current = await this.repository.getMedia(roomId, mediaId);
    if (!current) throw new ApiError(404, 'MEDIA_NOT_FOUND', 'Không tìm thấy ảnh/video của phòng');

    // Nếu bỏ chọn ảnh bìa hiện tại, tự chọn ảnh khác nếu có để phòng không mất ảnh bìa.
    if (data.is_cover === false && current.is_cover) {
      const alternatives = (await this.repository.listMedia(roomId))
        .filter((item) => item.id !== mediaId && item.media_type === 'image');
      if (alternatives.length > 0) {
        const nextCover = alternatives[0];
        const coverResult = await this.repository.updateMedia(roomId, nextCover.id, { is_cover: true });
        this.assertUpdateOutcome(coverResult.outcome);
      }
    }

    const result = await this.repository.updateMedia(roomId, mediaId, data);
    this.assertUpdateOutcome(result.outcome);
    return result.media;
  }

  // Thay file của một media hiện có nhưng giữ nguyên mediaId.
  // Upload file mới -> cập nhật DB -> xóa file cũ, theo đúng thứ tự an toàn.
  async replaceFile(roomId, mediaId, file, altText) {
    this.assertEnabled();

    if (!file?.buffer?.length) {
      throw new ApiError(400, 'FILE_REQUIRED', 'Cần gửi tệp ảnh hoặc video trong trường "file"');
    }

    const detected = detectMedia(file.buffer);
    if (!detected) {
      throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Chỉ nhận ảnh JPEG, PNG, WebP hoặc video MP4, WebM');
    }

    const maxBytes = detected.mediaType === 'image'
      ? this.limits.maxImageBytes
      : this.limits.maxVideoBytes;
    if (file.buffer.length > maxBytes) {
      throw new ApiError(
        413,
        'FILE_TOO_LARGE',
        `${detected.mediaType === 'image' ? 'Ảnh' : 'Video'} tối đa ${megabytes(maxBytes)} MB`
      );
    }

    if (!(await this.repository.getRoom(roomId, true))) {
      throw new ApiError(404, 'ROOM_NOT_FOUND', 'Không tìm thấy phòng');
    }
    const current = await this.repository.getMedia(roomId, mediaId);
    if (!current) {
      throw new ApiError(404, 'MEDIA_NOT_FOUND', 'Không tìm thấy ảnh/video của phòng');
    }

    // Upload trước để file cũ vẫn hoạt động nếu Cloudinary upload thất bại.
    const uploaded = await this.storage.upload({
      buffer: file.buffer,
      mediaType: detected.mediaType,
      roomId
    });

    let result;
    try {
      result = await this.repository.replaceMediaFile(roomId, mediaId, {
        media_type: detected.mediaType,
        ...uploaded,
        ...(altText !== undefined ? { alt_text: altText } : {})
      });
    } catch (error) {
      await this.discard(uploaded.public_id, detected.mediaType);
      throw error;
    }

    if (result.outcome !== 'OK') {
      await this.discard(uploaded.public_id, detected.mediaType);
      if (result.outcome === 'ROOM_NOT_FOUND') {
        throw new ApiError(404, 'ROOM_NOT_FOUND', 'Không tìm thấy phòng');
      }
      if (result.outcome === 'MEDIA_NOT_FOUND') {
        throw new ApiError(404, 'MEDIA_NOT_FOUND', 'Không tìm thấy ảnh/video của phòng');
      }
      throw new ApiError(500, 'MEDIA_REPLACE_FAILED', 'Không thể thay file ảnh/video');
    }

    // Chỉ xóa file cũ sau khi DB đã trỏ sang file mới.
    const cleanupSucceeded = await this.discard(result.previous.public_id, result.previous.media_type);
    return {
      media: result.media,
      storage_cleanup_pending: !cleanupSucceeded
    };
  }

  assertUpdateOutcome(outcome) {
    if (outcome === 'OK') return;
    if (outcome === 'ROOM_NOT_FOUND') throw new ApiError(404, 'ROOM_NOT_FOUND', 'Không tìm thấy phòng');
    if (outcome === 'MEDIA_NOT_FOUND') throw new ApiError(404, 'MEDIA_NOT_FOUND', 'Không tìm thấy ảnh/video của phòng');
    if (outcome === 'NOT_IMAGE') throw new ApiError(422, 'COVER_MUST_BE_IMAGE', 'Chỉ có thể chọn ảnh làm ảnh bìa, không thể chọn video');
    throw new ApiError(500, 'MEDIA_UPDATE_FAILED', 'Không thể cập nhật ảnh/video');
  }

  // Xóa metadata trong DB rồi xóa file tương ứng trên Cloudinary.
  // Nếu Cloudinary tạm lỗi, trả kết quả đã xóa khỏi DB kèm storage_cleanup_pending=true.
  async delete(roomId, mediaId) {
    this.assertEnabled();
    const room = await this.repository.getRoom(roomId, true);
    if (!room) throw new ApiError(404, 'ROOM_NOT_FOUND', 'Không tìm thấy phòng');

    const result = await this.repository.deleteMedia(roomId, mediaId);
    if (result.outcome === 'ROOM_NOT_FOUND') throw new ApiError(404, 'ROOM_NOT_FOUND', 'Không tìm thấy phòng');
    if (result.outcome === 'MEDIA_NOT_FOUND') throw new ApiError(404, 'MEDIA_NOT_FOUND', 'Không tìm thấy ảnh/video của phòng');
    if (result.outcome !== 'OK') throw new ApiError(500, 'MEDIA_DELETE_FAILED', 'Không thể xóa ảnh/video');

    const cleanupSucceeded = await this.discard(result.media.public_id, result.media.media_type);
    return { media: result.media, storage_cleanup_pending: !cleanupSucceeded };
  }

  async discard(publicId, mediaType) {
    if (!publicId || !this.storage?.enabled) return false;
    try {
      await this.storage.destroy(publicId, mediaType);
      return true;
    } catch (error) {
      console.error(JSON.stringify({
        timestamp: new Date().toISOString(),
        service: 'booking-service',
        level: 'error',
        event: 'media_discard_failed',
        public_id: publicId,
        media_type: mediaType,
        message: error.message
      }));
      return false;
    }
  }
}