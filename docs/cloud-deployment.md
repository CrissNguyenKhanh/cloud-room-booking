# Cloud deployment

Tạo ba Render Web Service, mỗi service dùng root directory và Dockerfile tương ứng dưới `services/`. Cấu hình toàn bộ biến trong `.env.example`; URL Neon phải bật TLS (`sslmode=require`). Chạy migration trước khi nhận traffic, đặt `FRONTEND_ORIGIN` bằng URL Cloudflare Pages, rồi kiểm tra `/health` và `/ready`. Không lưu secret trong GitHub. Khi lỗi, rollback Render về commit ổn định gần nhất.
