# API contract

Tất cả API trả JSON và lỗi theo `{ "error": { "code": "...", "message": "..." }, "request_id": "..." }`.

| Service | Method | Endpoint | Auth |
|---|---|---|---|
| Identity | POST | `/api/v1/auth/register` | Public |
| Identity | POST | `/api/v1/auth/login` | Public |
| Identity | GET | `/api/v1/users/me` | JWT |
| Identity | GET/PATCH | `/api/v1/admin/users...` | JWT ADMIN |
| Identity | GET | `/internal/v1/users/:id/status` | X-Service-Key |
| Booking | GET | `/api/v1/rooms`, `/api/v1/availability` | Public |
| Booking | POST/GET | `/api/v1/bookings`, `/api/v1/bookings/me` | JWT |
| Booking | POST | `/api/v1/bookings/:id/cancel` | JWT owner |
| Booking | Various | `/api/v1/admin/*` | JWT ADMIN |
| Notification | POST | `/internal/v1/events` | X-Service-Key |
| Notification | GET/PATCH | `/api/v1/notifications...` | JWT owner |

`POST /api/v1/bookings` bắt buộc có `Idempotency-Key`; conflict phòng/ca hoặc tái sử dụng key sai payload trả `409`.
