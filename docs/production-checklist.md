# Danh sách kiểm tra khi lên production

> **Phase 16** đã tự động hóa phần lớn danh sách này cho một VPS (`deploy/`, sổ tay `docs/deployment.md`). Các mục đánh dấu **[tự động]** đã có sẵn trong cấu hình và script; các mục còn lại vẫn cần bạn làm hoặc kiểm tra.

Bản Docker trong repo là **môi trường phát triển / demo**: chứng chỉ tự ký, Mailpit, mật khẩu mẫu, thanh toán giả lập. Trước khi chạy với người dùng thật, đi hết danh sách này.

## 1. Bí mật

- [ ] `JWT_ACCESS_SECRET`, `OTP_SECRET`, `QR_SECRET`: chuỗi ngẫu nhiên **≥ 32 ký tự, khác nhau**, lưu trong nơi quản lý secret (không trong repo, không trong image). Tạo bằng `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`.
- [ ] Đổi `QR_SECRET` = **mọi mã QR đã phát hết hiệu lực** (khách phải mở lại vé để lấy QR mới) → chỉ đổi khi bị lộ.
- [ ] `TOTP_ENCRYPTION_KEY` (Phase 15): đúng **32 byte ngẫu nhiên, base64** (`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`). Nó mã hóa secret 2FA của mọi người dùng: **mất khóa = ai cũng phải thiết lập lại 2FA**, nên sao lưu cùng các secret khác; lộ khóa (cùng bản sao database) = tính được mã của mọi người → đổi khóa và đặt lại 2FA của tất cả.
- [ ] `POSTGRES_PASSWORD`, `REDIS_PASSWORD` mạnh và riêng cho production.
- [ ] Không dùng lại các secret **chỉ-để-test** trong `e2e/start-api.mjs` và `loadtest/docker-compose.yml`; không triển khai hai stack này.

## 2. Tài khoản

- [ ] Tạo admin bằng `npm run seed:admin` với `ADMIN_EMAIL` / `ADMIN_PASSWORD` riêng (script **từ chối** mật khẩu mặc định khi `NODE_ENV=production`).
- [ ] **Xác thực hai lớp** (Phase 15): admin đầu tiên quét QR ở lần đăng nhập đầu và **cất 10 mã khôi phục** ở nơi an toàn. `TWO_FACTOR_REQUIRED_ROLES` giữ `ADMIN` (không để trống). **Không** đặt `ADMIN_TOTP_SECRET` (chỉ cho môi trường test; script từ chối khi `NODE_ENV=production`).
- [ ] Nên có **ít nhất 2 admin**: một người mất điện thoại thì người kia "Đặt lại 2FA" trong trang Người dùng. Không còn ai: chạy `npm run 2fa:reset -- <email>` trong container API (có ghi audit log).
- [ ] Không có tài khoản thử (`admin@etp.local`, `webtest-*`, mật khẩu `admin`…) trong database production.

## 3. Mạng và HTTPS

- [x] **[tự động]** Chứng chỉ Let's Encrypt (Caddy lấy và gia hạn), chuyển hướng HTTP → HTTPS (`deploy/Caddyfile`).
- [x] **[tự động]** **HSTS** 1 năm, đặt ở Caddy (không có `includeSubDomains`: các tên miền con khác của bạn không bị ép HTTPS).
- [ ] `NODE_ENV=production` → cookie refresh có cờ `Secure` (đã mặc định; không đặt `REFRESH_COOKIE_SECURE=false`).
- [ ] `CORS_ORIGINS` = đúng các tên miền của web (dùng cho cả kiểm tra `Origin` của WebSocket).
- [x] **[tự động]** `TRUST_PROXY=2` trong `deploy/docker-compose.prod.yml` (Caddy + nginx). Đặt thêm load balancer / Cloudflare proxy phía trước thì tăng lên. Quy tắc chung: `TRUST_PROXY` = **số proxy** đứng trước API. Sai số này thì rate limit đếm sai người (quá ít: mọi người chung một IP; quá nhiều: khách giả được IP).
- [ ] Proxy / load balancer giữ kết nối rảnh **dưới 65 giây** (API giữ 65 s; xem `backend/src/server.js`), nếu không sẽ gặp lỗi 502 ngẫu nhiên.
- [ ] Camera của trang soát vé chỉ chạy trên HTTPS.

## 4. Email

- [ ] SMTP của dịch vụ gửi mail (có SPF, DKIM cho tên miền), không dùng Gmail cá nhân; bỏ Mailpit.
- [ ] `MAIL_FROM` dùng tên miền của mình.

## 5. Dữ liệu và sao lưu

- [x] **[tự động]** Sao lưu PostgreSQL + ảnh hằng đêm và trước mỗi lần deploy (container `backup`); `restore.sh check` để thử khôi phục (CI chạy mỗi lần push). **Bạn làm**: chạy thử khôi phục mỗi tháng, bật bản sao ngoài máy chủ (`docs/deployment.md` mục 7).
- [x] **[tự động]** Sao lưu thư mục ảnh tải lên (volume `uploads`). Chạy **nhiều máy chủ API** thì chuyển ảnh sang kho chung (S3 hoặc tương đương): mỗi máy có ổ đĩa riêng.
- [ ] Redis đang chạy không lưu xuống đĩa (dữ liệu có hạn sống; PostgreSQL là nguồn gốc). Khi Redis khởi động lại: **vé thiếu và đơn quá hạn tự được xử lý lại** (job `reconcile-tickets` mỗi phút, `sweep-holds`), nhưng **email / thông báo đang chờ gửi có thể mất**. Cần chắc chắn không mất email → bật AOF (`--appendonly yes`): **[tự động]** đã bật trong `deploy/docker-compose.prod.yml`.

## 6. Sức chứa

- [ ] `max_connections` của PostgreSQL ≥ (số bản API × `PG_POOL_MAX`) + (số worker × `PG_POOL_MAX`) + migration + dư ~20%. Mặc định `PG_POOL_MAX=20`; PostgreSQL mặc định 100 kết nối → tối đa ~3 bản API + 1 worker với cấu hình mặc định.
- [ ] Một tiến trình Node.js dùng 1 nhân CPU cho JavaScript: tải lớn → nhiều bản API sau load balancer (load test Phase 13: hủy đơn khi tranh ghế nhanh hơn 6 lần với 3 bản). WebSocket đồng bộ giữa các bản qua Redis pub/sub, worker chạy song song qua BullMQ.
- [ ] `RATE_LIMIT_ENABLED` để mặc định (`true`).

## 7. Quan sát

- [x] **[tự động]** Healthcheck Docker và `deploy.sh` dùng `/health/ready` (đủ PostgreSQL; Redis hỏng → `degraded` nhưng vẫn phục vụ); nginx mở `/health/live`, `/health/ready` ra ngoài cho dịch vụ theo dõi (`docs/deployment.md` mục 10).
- [ ] Gom log JSON (pino) về một chỗ; log không chứa token / mật khẩu (query string bị bỏ khỏi log, dữ liệu job không được log).
- [ ] Cảnh báo: tỷ lệ 5xx, p95 thời gian phản hồi, Redis `degraded`, hàng đợi job tồn đọng, dung lượng đĩa PostgreSQL.

## 8. Phần mềm

- [ ] CI xanh (backend, web, E2E; `npm audit` của dependency production).
- [ ] Bật cập nhật dependency tự động (Dependabot / Renovate).
- [ ] Image build lại khi có bản vá Node.js / nginx / PostgreSQL.

## 9. Thanh toán

- [ ] Cổng thanh toán hiện là **giả lập**. Thay bằng cổng thật: tạo giao dịch phía server, nhận kết quả qua **webhook có kiểm tra chữ ký**, giữ `Idempotency-Key` như hiện tại, đối soát định kỳ.
