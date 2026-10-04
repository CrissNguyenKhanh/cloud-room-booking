# Resilience

Booking dùng timeout cho Identity/Notification, constraint database cho concurrent request, idempotency lưu bền vững và transactional outbox. Delivery lỗi tạm thời được retry theo batch hữu hạn với backoff; lỗi cố định hoặc vượt số lần thử chuyển `FAILED`. Hệ thống là at-least-once, không tuyên bố exactly-once. Notification deduplicate theo `event_id`.
