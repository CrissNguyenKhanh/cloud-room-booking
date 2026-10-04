# Database design

PostgreSQL local dùng ba schema: `identity`, `booking`, `notification`. Bảng và index được định nghĩa trong `services/*/db/migrations`. `booking.bookings` có unique partial index cho booking `CONFIRMED`; outbox và notification dùng UUID event để hỗ trợ giao nhận at-least-once và chống trùng.
