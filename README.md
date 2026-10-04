# Cloud Room Booking Backend

Monorepo backend cho đồ án đặt phòng học/phòng họp. Ba microservice triển khai độc lập, giao tiếp HTTP và sở hữu schema PostgreSQL riêng; frontend nằm ở repository khác.

## Thành phần

- `identity-service`: đăng ký, đăng nhập, JWT và quản trị người dùng.
- `booking-service`: phòng, ca, booking, idempotency và transactional outbox.
- `notification-service`: nhận event nội bộ và lưu thông báo theo người dùng.

## Chạy bằng Docker Compose

Yêu cầu: Docker Desktop và Docker Compose.

```powershell
Copy-Item .env.example .env
# Thay các giá trị JWT_SECRET, INTERNAL_SERVICE_KEY và mật khẩu local trong .env
docker compose up --build
docker compose ps
.\scripts\smoke-test.ps1
```

Dừng hệ thống bằng `docker compose down`; lệnh này không xóa volume. Các cổng host là Identity `3001`, Booking `3002`, Notification `3003`; bên trong container mọi service dùng cổng `3000`.

## Chạy từng service

Đặt URL database tương ứng về PostgreSQL có thể truy cập từ máy host, sau đó chạy trong thư mục service:

```powershell
npm ci
npm run migrate
npm run seed # Identity và Booking
npm start
npm test
```

Các biến bắt buộc và placeholder nằm trong `.env.example`. Seed admin chỉ chạy khi có `SEED_ADMIN_EMAIL` và `SEED_ADMIN_PASSWORD`. Xem `docs/` cho kiến trúc, API, database và triển khai Render/Neon.

## Cấu trúc

```text
services/{identity-service,booking-service,notification-service}
infra/postgres/init
scripts
docs
.github/workflows
```

Nếu `/ready` lỗi, kiểm tra database URL, schema/role và log PostgreSQL. Nếu CORS lỗi, đặt chính xác `FRONTEND_ORIGIN`; không dùng wildcard cho API xác thực.
