# Phase 14 — Hardening và tài liệu (đã duyệt, đang triển khai)

> Mục tiêu: dự án **an toàn khi chạy thật**, **nhanh ở những chỗ đã đo thấy chậm**, và **người khác mở repo là hiểu và chạy được trong vài phút** (README, kiến trúc, ảnh chụp) — đây cũng là thứ người phỏng vấn nhìn đầu tiên.

---

## 1. Rà soát hiện trạng (đã làm trước khi viết thiết kế)

| Hạng mục (kế hoạch) | Hiện trạng |
|---|---|
| INF-06 Bảo mật HTTP | Đã có: Helmet, CORS theo danh sách, giới hạn body JSON 100 KB (ảnh 5 MB, kiểm tra theo nội dung file), zod kiểm tra mọi input, SQL luôn dùng tham số, rate limit theo IP, cookie refresh httpOnly + SameSite=Strict, RBAC ở mọi API |
| INF-07 Tắt máy an toàn | Đã có: SIGTERM → đóng WebSocket, chờ request đang chạy, đóng queue / PostgreSQL / Redis, có hẹn giờ ép thoát; worker chờ job chạy xong; lỗi không bắt được → ghi log và khởi động lại sạch |
| PERF-01 Tối ưu truy vấn | Một phần: index cho báo cáo (Phase 12.4), gợi ý ghế trong Redis + gzip (Phase 13.2) |
| DOC-01 README, kiến trúc | **Chưa có**: `README.md` vẫn là bản trống của commit đầu tiên |

**Vấn đề tìm thấy khi rà soát:**

1. **Rate limit bị chia chung cho mọi người trong bản Docker.** API hỗ trợ `TRUST_PROXY` nhưng `docker-compose.yml` không bật. Mọi request đi qua nginx `web`, nên API thấy **tất cả người dùng có cùng một IP** (của nginx): một người gửi nhiều request là mọi người khác cũng bị chặn 429.
2. **nginx `web` không gửi header bảo mật nào** cho trang web (không có Content-Security-Policy, chống nhúng iframe, Referrer-Policy, quyền camera…). Helmet chỉ bảo vệ phản hồi của API, không bảo vệ trang HTML.
3. **Dependency chỉ dùng khi phát triển** có 22 lỗ hổng (3 mức high, qua `nodemon` → `chokidar` → `braces`; `jest` mức moderate). Dependency chạy production: **0 lỗ hổng**; frontend, e2e: 0.
4. **Không có secret nào lọt vào Git** (đã quét toàn bộ lịch sử; Postman chỉ có email mẫu và mật khẩu admin mặc định của dev). `.env` được bỏ qua đúng.
5. Vài chú thích đã lỗi thời (nhắc "app React Native", "sau này có WebSocket").
6. Load test (13.2): API vẫn tốn ~80% CPU để dựng lại JSON sơ đồ 2.000 ghế ở mỗi request.

---

## 2. Bước 14.1 — Bảo mật

| # | Việc | Chi tiết |
|---|---|---|
| 1 | **`TRUST_PROXY=1`** cho API trong `docker-compose.yml` | Express lấy IP thật của khách từ `X-Forwarded-For` mà nginx thêm vào (chỉ tin **1** proxy, nên khách không giả IP được bằng cách tự gửi header). Test: 2 IP khác nhau qua nginx có rate limit riêng |
| 2 | **Header bảo mật ở nginx `web`** | `Content-Security-Policy` (chỉ chạy script của chính trang; ảnh cho phép `https:` vì ảnh sự kiện có thể là link ngoài; WebSocket cùng origin), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `frame-ancestors 'none'` (chống clickjacking), `Permissions-Policy: camera=(self)` (chỉ trang của mình dùng camera, cho máy quét vé). **HSTS chưa bật** vì cổng 8443 dùng chứng chỉ tự ký; ghi vào danh sách việc khi lên production |
| 3 | **Cập nhật dependency phát triển** | Nâng `nodemon`, `jest` lên bản đã vá; chạy lại toàn bộ test |
| 4 | **CI kiểm tra lỗ hổng** | Thêm bước `npm audit --omit=dev --audit-level=high` cho backend và web: CI fail nếu dependency **chạy production** có lỗ hổng mức high |
| 5 | **Danh sách kiểm tra khi lên production** | Tài liệu `docs/production-checklist.md`: secret mạnh và riêng, `CORS_ORIGINS`, `TRUST_PROXY`, chứng chỉ thật + HSTS, đổi mật khẩu admin mặc định, tắt Mailpit, sao lưu PostgreSQL, giới hạn kết nối DB theo số bản API… |
| 6 | Dọn chú thích lỗi thời | |

---

## 3. Bước 14.2 — Hiệu năng

| # | Việc | Chi tiết |
|---|---|---|
| 1 | **Sơ đồ ghế: giữ sẵn phần bố cục đã dựng trong bộ nhớ của tiến trình** | Bố cục (vị trí ghế, hạng vé, giá) hầu như không đổi; hiện mỗi request lại đọc 470 KB từ Redis, parse JSON, ghép trạng thái ghế rồi dựng lại JSON. Giữ bản đã parse trong bộ nhớ (theo phiên bản, hết hạn khi ban tổ chức đổi cấu hình) và chỉ ghép trạng thái ghế mới nhất. **Đo lại bằng k6** (kịch bản sơ đồ ghế): chỉ giữ thay đổi nếu thật sự nhanh hơn |
| 2 | **EXPLAIN ANALYZE các truy vấn nóng** | Danh sách / tìm kiếm sự kiện, sơ đồ ghế, giữ chỗ, vé của tôi, soát vé — trên dữ liệu load test (2.000 ghế, ~20.000 đơn). Thêm index nếu thấy quét cả bảng ở chỗ đáng lẽ dùng index |
| 3 | **Hướng dẫn cỡ pool kết nối** | Mỗi bản API mở tối đa `PG_POOL_MAX` kết nối (mặc định 20); số bản × pool + worker phải nhỏ hơn `max_connections` của PostgreSQL. Ghi vào checklist production |

---

## 4. Bước 14.3 — Tài liệu

| # | Tài liệu | Nội dung |
|---|---|---|
| 1 | **`README.md`** (viết lại) | Giới thiệu ngắn; tính năng chính; **ảnh chụp màn hình**; sơ đồ kiến trúc; công nghệ; **chạy nhanh bằng Docker** (từng lệnh, có lưu ý cho Windows PowerShell); chạy khi phát triển; tài khoản thử; cách chạy test (link `docs/testing.md`); kết quả load test; danh sách tài liệu thiết kế theo phase; **badge CI**; giới hạn đã biết |
| 2 | **`docs/architecture.md`** | Các module và ranh giới; **luồng đặt chỗ** (khóa Redis → transaction PostgreSQL → sau commit: WebSocket, hàng đợi); cách chống bán trùng ghế; real-time; xác thực (access token trong bộ nhớ, refresh token cookie httpOnly, xoay vòng + phát hiện dùng lại); hàng đợi và worker; cache và khi Redis hỏng. Sơ đồ bằng **Mermaid** (GitHub tự vẽ) |
| 3 | **Ảnh chụp màn hình tự động** | Một script Playwright (trong `e2e/`) dựng dữ liệu mẫu trên môi trường E2E rồi chụp ~8 trang (trang chủ, sơ đồ ghế, thanh toán, vé QR, soát vé trên điện thoại, dashboard admin, báo cáo doanh thu, trang ban tổ chức) vào `docs/images/`. Chạy lại được bất cứ lúc nào giao diện đổi; không chụp dữ liệu thật |
| 4 | **Rà `.env.example`** (gốc và backend) | Đủ mọi biến đang dùng (`TRUST_PROXY`, `REDIS_COMMAND_TIMEOUT_MS`, `JWT_ACCESS_TTL_SECONDS`…), có chú thích; không có giá trị thật |

---

## 5. Không làm ở phase này

BKG-02 (thêm / bớt ghế trong đơn đang giữ), cổng thanh toán thật, triển khai lên cloud, xác thực hai lớp (2FA), khóa tài khoản sau nhiều lần sai mật khẩu (đã có rate limit theo IP). Ghi vào mục "Hướng phát triển" của README.

---

## 6. Ước lượng

| Bước | Giờ |
|---|---|
| 14.1 Bảo mật | 6 |
| 14.2 Hiệu năng (có đo lại) | 6 |
| 14.3 README, kiến trúc, ảnh chụp, `.env.example` | 11 |
| **Tổng** | **≈ 23 giờ** (kế hoạch Phase 14: 23 giờ) |

Mỗi bước bạn thử rồi commit, nhánh `feature/phase-14-hardening` (đã tạo từ `main`).

---

## 7. Cần quyết định khi review

1. **Phạm vi** như mục 2–4; BKG-02 và các mục ở mục 5 để sau. Đồng ý?
2. **`TRUST_PROXY=1`** và **header bảo mật ở nginx** (CSP cho phép ảnh `https:` từ nơi khác vì ảnh sự kiện có thể là link ngoài; chưa bật HSTS vì chứng chỉ tự ký). Đồng ý?
3. **Nâng `nodemon` / `jest`** và thêm bước **`npm audit`** (chỉ dependency production, mức high) vào CI. Đồng ý?
4. **Tối ưu sơ đồ ghế** bằng bộ nhớ trong tiến trình, **chỉ giữ nếu đo thấy nhanh hơn**. Đồng ý?
5. **README viết bằng tiếng Việt**, có một đoạn tóm tắt ngắn bằng tiếng Anh ở đầu (cho người đọc không biết tiếng Việt)? Hay chỉ tiếng Việt / chỉ tiếng Anh?
6. **Ảnh chụp màn hình tạo bằng script Playwright** (dữ liệu mẫu, chạy lại được) và commit vào `docs/images/`. Đồng ý?
7. **3 bước** 14.1 → 14.2 → 14.3, mỗi bước test rồi commit. Đồng ý?

Đã duyệt (bạn nhắn "phase 14"); điểm 5 theo đề xuất: README tiếng Việt, có đoạn tóm tắt tiếng Anh ở đầu.

---

## 8. Ghi chú triển khai

### Bước 14.1 (xong): bảo mật

- **`TRUST_PROXY=1`** cho `api` trong `docker-compose.yml`; nginx `web` thêm `X-Forwarded-For` cho cả `/ws`. Kiểm tra: khóa rate limit trong Redis là IP của người truy cập (`172.18.0.1`, máy host) thay vì IP của nginx (`172.18.0.6`); request tự gửi `X-Forwarded-For: 6.6.6.6` **không** giả được IP.
- **Header bảo mật** (`frontend/docker/security-headers.conf`, gắn vào các location phục vụ trang): CSP (`script-src 'self' 'wasm-unsafe-eval'`, ảnh `https:` / `data:` / `blob:`, `connect-src` cùng host cho API và WebSocket, `frame-ancestors 'none'`, `object-src 'none'`), `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy: camera=(self)`. Kiểm tra trên trình duyệt (`localhost:8080`): đi qua trang chủ, sơ đồ ghế (WebSocket chạy), dashboard admin (biểu đồ), doanh thu, danh mục, ban tổ chức, soát vé → **0 vi phạm CSP**; WebAssembly biên dịch được; `eval` và **script chèn vào trang bị chặn** (giảm hậu quả nếu có XSS). HSTS để cho production (chứng chỉ tự ký).
- **Dependency**: `nodemon`, `jest`, `braces` đã là bản mới nhất, các lỗ hổng **chưa có bản vá**. Gỡ `nodemon` (Node 24 có sẵn `node --watch`; `npm run dev` = `node --watch-path=src src/server.js`) → hết 3 lỗ hổng high. Còn 19 lỗ hổng moderate trong chuỗi `jest` (chỉ chạy test, không có trong image production, chưa có bản vá) — chấp nhận. Dependency production: 0.
- **CI**: thêm `npm audit --omit=dev --audit-level=high` cho backend và web.
- **`docs/production-checklist.md`**: bí mật, tài khoản, HTTPS / HSTS / `TRUST_PROXY` / keep-alive, email, sao lưu (Redis không lưu đĩa: vé và đơn tự lành nhờ job bảo trì, email đang chờ có thể mất), sức chứa kết nối DB, quan sát, cập nhật dependency, cổng thanh toán thật.
- Dọn chú thích lỗi thời trong `app.js`.
- Test: backend 253 pass.
