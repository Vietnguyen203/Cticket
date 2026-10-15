# Kiểm thử

Dự án có 4 tầng kiểm thử, từ nhanh / hẹp tới chậm / rộng:

| Tầng | Công cụ | Số lượng | Chạy ở đâu | Thời gian |
|---|---|---|---|---|
| Unit + integration (backend) | Jest + Supertest, PostgreSQL và Redis thật | **302 test**, 27 file | máy dev, CI | ≈ 1–2 phút |
| Unit (web) | Vitest | **66 test**, 14 file | máy dev, CI | ≈ 2 giây |
| End-to-end (trình duyệt) | Playwright (Chromium, desktop + điện thoại) | **14 kịch bản** | máy dev, CI | ≈ 1 phút |
| Tải (load) | k6 | **4 kịch bản** | chạy tay | 1–5 phút / kịch bản |

Mỗi lần push hoặc mở pull request, **GitHub Actions** chạy 3 tầng đầu (`.github/workflows/ci.yml`). Load test chạy tay vì lâu và số đo phụ thuộc máy.

---

## 1. Backend: Jest

Test chạy trên **PostgreSQL và Redis thật** (không giả lập database), vì phần khó nhất của hệ thống là khóa dòng, transaction, ràng buộc và Lua script, những thứ chỉ kiểm chứng được trên hệ thống thật.

- Database riêng `etp_test` (tên bắt buộc kết thúc bằng `_test`, nếu không test từ chối chạy), Redis database 15.
- Trước mỗi lần chạy: xóa sạch schema, chạy migration **lên → xuống hết → lên lại** (chứng minh mọi migration đều gỡ được).
- **Không bao giờ gửi mail thật**: SMTP bị trỏ vào một cổng đóng, email trong test được bắt bằng hộp thư giả.
- Sau mỗi test đặt chỗ / thanh toán: kiểm tra **tồn kho khớp với đơn hàng** (`findInventoryMismatches`).

| Nhóm | File | Số test khai báo |
|---|---|---|
| Đăng ký, đăng nhập, OTP, refresh token xoay vòng, cookie | `auth`, `redis-auth` | 37 |
| Xác thực hai lớp: TOTP (test vector RFC 6238), mã hóa secret, đăng nhập 2 bước, mã khôi phục, refresh chặn phiên thiếu 2FA, admin đặt lại | `two-factor`, `totp` | 32 |
| Schema, ràng buộc DB, transaction | `schema`, `transaction`, `databaseErrors` | 31 |
| Sự kiện, suất, hạng vé, duyệt, danh mục, nhà tổ chức, địa điểm đề xuất | `events`, `catalog`, `organizers`, `venue-proposals` | 34 |
| Sơ đồ ghế, tồn kho, khóa / mở ghế | `inventory` | 16 |
| Giữ chỗ, đơn hàng, khóa Redis, gợi ý ghế | `orders`, `booking-redis` | 25 |
| Đổi / bỏ ghế trong đơn đang giữ (BKG-02) | `order-edit` | 15 |
| Thanh toán (idempotency), mã giảm giá, hoàn tiền | `payments` | 16 |
| Vé, QR, soát vé | `checkins` | 16 |
| WebSocket real-time | `websocket` | 12 |
| Hàng đợi BullMQ, email, hết hạn giữ chỗ | `queue` | 11 |
| Cache Redis | `cache` | 7 |
| Admin (người dùng, audit, cấp lại QR), phân quyền, báo cáo | `admin`, `rbac`, `reports` | 20 |
| Tải ảnh lên, health check, mã hóa | `uploads`, `health`, `crypto` | 16 |

### Test đồng thời (TEST-02)

Các tình huống "nhiều người cùng làm một việc tại cùng một thời điểm", bắn song song bằng `Promise.all`:

| Tình huống | Kết quả mong đợi |
|---|---|
| **100 người cùng giữ 1 ghế** | đúng **1** người được, 99 bị từ chối `SEATS_UNAVAILABLE` |
| Như trên nhưng **tắt Redis** | vẫn đúng 1 người được (PostgreSQL tự quyết) |
| 50 người cùng giữ 1 ghế (test từ Phase 5) | đúng 1 |
| 50 người tranh 10 vé đứng cuối cùng | đúng 10 người được |
| **20 người cùng thêm 1 ghế vào đơn đang giữ của mình** (có và không có Redis) | đúng 1 người được |
| 5 lần đăng nhập cùng nhập **một mã 2FA** cùng lúc | đúng 1 phiên; mã đã dùng không dùng lại được |
| Sửa đơn và checkout cùng một đơn cùng lúc | đơn được chốt giá đúng bằng những gì nó đang giữ |
| 2 người đổi chéo ghế cho nhau cùng lúc (10 cặp) | không deadlock, cả hai bị từ chối gọn gàng |
| 10 lần khóa 15 vé đứng cùng lúc khi còn 70 | không bao giờ vượt sức chứa |
| **2 cổng quét cùng 1 vé cùng lúc** | đúng 1 lần vào |
| Cùng một `Idempotency-Key` gửi 5 lần cùng lúc | 1 lần thanh toán, 5 câu trả lời giống hệt |
| 2 lần thanh toán 1 đơn với 2 key khác nhau | 1 thành công, 1 `ORDER_ALREADY_PAID` |
| 2 người cùng dùng lượt cuối của 1 mã giảm giá | đúng 1 người được |
| 2 admin cùng duyệt 1 sự kiện / 1 nhà tổ chức | 1 thành công, 1 xung đột |
| 2 admin cùng gỡ quyền admin của nhau | nền tảng vẫn còn ít nhất 1 admin |
| Đăng ký cùng một email cùng lúc | đúng 1 tài khoản |

### Độ phủ code

`npm run test:coverage` (báo cáo HTML ở `backend/coverage/index.html`):

| Statements | Branches | Functions | Lines |
|---|---|---|---|
| **93,5%** | **83,7%** | **94,2%** | **95,2%** |

CI **fail** nếu tụt dưới 90% / 80% / 90% / 90%. Phần thấp: `server.js` và `worker.js` (file khởi động tiến trình, Jest không chạy; E2E và load test chạy chúng).

### Chạy

```
cd backend
npm test
npm run test:coverage
```

Cần Docker đang chạy `postgres` và `redis`; `TEST_DATABASE_URL`, `TEST_REDIS_URL` trong `backend/.env` (xem `backend/.env.example`).

---

## 2. Web: Vitest

Phần logic không cần trình duyệt: gộp cập nhật sơ đồ ghế real-time (phiên bản, ghế bị người khác lấy, chế độ sửa đơn đang giữ), client WebSocket (kết nối lại, đăng nhập lại khi token hết hạn), refresh token chỉ chạy một lần cho nhiều request và nhiều tab, giờ server, giờ Việt Nam, kết quả quét vé, kiểm tra trước khi gửi duyệt, quyền menu, CSV (BOM, chống CSV injection), số trên biểu đồ.

```
cd frontend
npm test
npm run typecheck
npm run lint
```

---

## 3. End-to-end: Playwright

Trình duyệt thật chạy các luồng chính trên giao diện. Môi trường riêng, **không đụng dữ liệu dev, không gửi mail thật**: database `etp_e2e` (tạo lại mỗi lần chạy), Redis database 14, mail về Mailpit (đọc mã OTP qua API của Mailpit), API cổng 3100 và Vite cổng 5180 do Playwright tự bật / tắt.

Admin bắt buộc xác thực hai lớp (Phase 15): admin của môi trường E2E được tạo với một secret TOTP biết trước, test tự tính mã như ứng dụng trên điện thoại (`e2e/support/totp.ts`). Mỗi mã chỉ dùng được một lần cho mỗi tài khoản, nên mỗi test đăng nhập bằng **một bản sao admin của riêng nó** (`createAdminAccount` trong `e2e/support/db.ts`); các test chạy song song không bao giờ dùng mất mã của nhau.

| Kịch bản | Kiểm tra gì |
|---|---|
| Đăng ký → mã trong Mailpit → đăng nhập → tải lại → đăng xuất → đăng nhập lại | cookie refresh httpOnly + SameSite=Strict, không token trong localStorage |
| Sai mật khẩu | báo lỗi, không có phiên |
| Mua 2 ghế + 1 vé đứng | mã giảm giá sai rồi đúng, thẻ bị từ chối rồi trả lại, 3 vé có QR |
| **2 trình duyệt cùng xem sơ đồ** | A giữ ghế → B thấy đổi màu ngay, ghế B đang chọn bị bỏ kèm thông báo |
| Giữ chỗ hết hạn | đơn báo hết hạn, ghế trở lại trống |
| **Đổi ghế trong đơn đang giữ** (BKG-02) | quay lại sơ đồ từ trang đơn, đổi 1 ghế, bỏ 1 ghế ở trang đơn; trình duyệt thứ hai thấy từng thay đổi |
| **Ban tổ chức tạo sự kiện hoàn toàn bằng giao diện** → admin duyệt → khách thấy và chọn ghế | các form quản trị |
| Soát vé trên **điện thoại** | vào 1 lần, quét lại bị từ chối, lịch sử |
| Admin hoàn tiền | vé hết hiệu lực, báo cáo doanh thu của ban tổ chức đổi đúng |
| **Xác thực hai lớp** (2 test) | admin mới bị buộc thiết lập (đọc khóa trên trang, tính mã như điện thoại), lưu mã khôi phục, đăng nhập lại bằng mã khôi phục; khách tự bật ở trang tài khoản rồi đăng nhập bằng mã |
| Phân quyền (3 test) | khách không vào được trang admin; ban tổ chức không mở được sự kiện của người khác; chưa đăng nhập → trang đăng nhập rồi quay lại |

E2E đã tìm ra 2 lỗi giao diện (trang chỉnh sửa mở được sự kiện của nhà tổ chức khác; một ô nhập không gắn nhãn) và 1 điểm yếu khi máy quá tải (mã OTP chỉ nằm trong Redis) — xem `docs/phase-13-testing-design.md`, mục 8.

### Chạy

```
cd e2e
npm install
npx playwright install chromium
npm test
```

`npx playwright install chromium` chỉ cần một lần cho mỗi máy. `npm run test:ui` để xem từng bước, `npm run report` để mở báo cáo HTML. Lỗi → ảnh chụp, video và trace trong `e2e/test-results/`. Cần Docker đang chạy `postgres`, `redis`, `mailpit`. Windows PowerShell 5.1: dùng `;` thay cho `&&` khi gộp lệnh.

---

## 4. Load test: k6

Stack riêng chạy **image production** của API và worker (database `etp_load`, Redis database 2, cổng 3200, có thể chạy nhiều bản API sau nginx). Kết quả trên laptop i5-12500H, 24 GB, Docker Desktop; k6 chạy cùng máy.

| Kịch bản | Tải | Request/giây | p95 | Lỗi |
|---|---|---|---|---|
| Duyệt sự kiện | 300 người dùng ảo | 392 | 5,7 ms | 0% |
| Sơ đồ 2.000 ghế (gzip) | 200 | 95 | 63 ms | 0% |
| Tranh ghế: 500 người, 50 ghế | 500 | ≈ 1.100 | giữ ghế 250–370 ms; hủy đơn 1,0 s (3 bản API) – 3,4 s (1 bản) | 0% |
| Hỗn hợp 5 phút (70% duyệt, 20% sơ đồ, 10% mua) | 200 | 283 | giữ chỗ 71 ms, thanh toán 52 ms | 0% |

**Không ghế nào bị bán hai lần** sau mọi lần chạy (`node loadtest/verify.mjs`). Load test dẫn tới 4 cải tiến: giữ kết nối 65 giây sau proxy (sửa lỗi 502), "gợi ý ghế đã có người lấy" trong Redis (PostgreSQL bớt 22–30% CPU), gzip ở nginx (sơ đồ ghế 470 → 70 KB), chạy nhiều bản API (hủy đơn nhanh hơn 6 lần). Chi tiết, số đo trước / sau và cách chạy: `docs/phase-13-testing-design.md`, mục 8 (bước 13.2).

```
docker compose --env-file .env -f loadtest/docker-compose.yml up -d --build
node loadtest/seed.mjs
k6 run loadtest/k6/contention.js
node loadtest/verify.mjs
docker compose --env-file .env -f loadtest/docker-compose.yml down
```

---

## 5. CI (GitHub Actions)

`.github/workflows/ci.yml`, mỗi lần push / pull request:

| Job | Làm gì |
|---|---|
| **Backend (Jest)** | PostgreSQL 17 + Redis 7.4 (service container) → `npm ci` → toàn bộ Jest có độ phủ (fail nếu dưới ngưỡng); tóm tắt độ phủ hiện trên trang kết quả; tải lên báo cáo HTML |
| **Web** | `npm ci` → typecheck → lint → Vitest → build |
| **End-to-end** | PostgreSQL + Redis + Mailpit → cài Chromium → typecheck test → Playwright; lỗi thì tải lên ảnh / video / trace |
| **Production stack** (Phase 16) | `shellcheck` các script → `init-env.sh` (secret ngẫu nhiên) → `deploy.sh` dựng đúng stack của VPS sau Caddy, tên miền `etp.localhost` → `smoke.sh` (health, CSP / HSTS, API, HTTP → HTTPS, WebSocket) → sao lưu → `restore.sh check` |

Mật khẩu / bí mật trong workflow là giá trị dùng một lần cho database của máy CI, không phải secret thật; không job nào gửi mail ra ngoài. Lần chạy mới trên cùng nhánh hủy lần chạy cũ (`concurrency`).
