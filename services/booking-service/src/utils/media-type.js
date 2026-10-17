// Nhận diện loại file từ nội dung (magic bytes). Không tin Content-Type hay đuôi file do client gửi.
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// Các brand của MP4/MOV. HEIC, AVIF cũng dùng "ftyp" nên không được nhận nhầm là video.
const VIDEO_BRANDS = new Set(['isom', 'iso2', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'M4V ', 'qt  ', 'MSNV', 'dash', '3gp4', '3gp5']);

export function detectMedia(buffer) {
  if (!buffer || buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { mediaType: 'image', mime: 'image/jpeg' };
  if (buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return { mediaType: 'image', mime: 'image/png' };
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return { mediaType: 'image', mime: 'image/webp' };
  if (buffer.toString('ascii', 4, 8) === 'ftyp' && VIDEO_BRANDS.has(buffer.toString('ascii', 8, 12))) return { mediaType: 'video', mime: 'video/mp4' };
  if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) return { mediaType: 'video', mime: 'video/webm' };
  return null;
}