# Local development

Sao chép `.env.example` thành `.env`, thay placeholder, rồi chạy `docker compose up --build`. Không commit `.env`. Có thể chạy riêng từng service bằng `npm ci`, `npm run migrate`, `npm run seed` (nếu có), `npm start`.
