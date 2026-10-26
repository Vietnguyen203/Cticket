# Kiểm thử

Dự án có 4 tầng kiểm thử, từ nhanh / hẹp tới chậm / rộng:

| Tầng | Công cụ | Số lượng | Chạy ở đâu | Thời gian |
|---|---|---|---|---|
| Unit + integration (backend) | Jest + Supertest, PostgreSQL và Redis thật | **418 test**, 46 file | máy dev, CI | ≈ 1–2 phút |
| Unit (web) | Vitest | **125 test**, 24 file | máy dev, CI | ≈ 2 giây |
| End-to-end (trình duyệt) | Playwright (Chromium, desktop + điện thoại) | **27 kịch bản** | máy dev, CI | ≈ 1 phút |
| Tải (load) | k6 | **5 kịch bản**, số người dùng chọn khi chạy | chạy tay | 1–5 phút / kịch bản |

Danh sách kịch bản test theo chức năng (111 test case, gồm cả những case kiểm tra tay) và test tự động tương ứng: [`docs/test-scenarios.md`](test-scenarios.md). Test tay bằng thao tác trên web, từng bước theo thứ tự (115 bước, 15 phiên): [`docs/ui-test-guide.md`](ui-test-guide.md).

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
| **Khóa đăng nhập** (Phase 18.1): 5 lần sai → khóa, gấp đôi, email không tồn tại khóa y hệt, sai mã 2FA cũng tính, đặt lại mật khẩu / admin mở khóa | `login-lockout` | 7 |
| Xác thực hai lớp: TOTP (test vector RFC 6238), mã hóa secret, đăng nhập 2 bước, mã khôi phục, refresh chặn phiên thiếu 2FA, admin đặt lại | `two-factor`, `totp` | 32 |
| Schema, ràng buộc DB, transaction | `schema`, `transaction`, `databaseErrors` | 31 |
| Sự kiện, suất, hạng vé, duyệt, danh mục, nhà tổ chức, địa điểm đề xuất | `events`, `catalog`, `organizers`, `venue-proposals` | 34 |
| Sơ đồ ghế, tồn kho, khóa / mở ghế | `inventory` | 16 |
| Giữ chỗ, đơn hàng, khóa Redis, gợi ý ghế | `orders`, `booking-redis` | 25 |
| Đổi / bỏ ghế trong đơn đang giữ (BKG-02) | `order-edit` | 15 |
| Thanh toán (idempotency), mã giảm giá, hoàn tiền | `payments`, `payments-simulator-off` | 17 |
| **VNPay** (Phase 17, với một VNPay giả trong test): ký / kiểm chữ ký, URL thanh toán, IPN (mọi mã trả lời), Return URL hỏi lại VNPay, lượt thứ hai, tiền đến muộn và trả trùng → hoàn tự động, đối soát khi đơn hết giờ, hoàn tiền qua hàng đợi (thành công / thử lại / bị từ chối / admin gửi lại), hủy sự kiện; **đã thu tiền sau khi báo thất bại** (rà soát lỗi BUG-01) | `payments-vnpay`, `vnpay` | 30 |
| **Hủy đơn theo chính sách** (Phase 18.3): các mốc và ranh giới, số tiền khách đã thấy phải còn đúng, đã vào cổng, đơn 0đ, VNPay hoàn một phần (`03`), phí hủy trong báo cáo | `cancellation`, `refund-policy` | 11 |
| **Nhắc lịch** (Phase 18.2): cửa sổ 24 giờ / 2 giờ, không gửi trùng, người tắt nhắc, đơn mua sau mốc, đơn đã hoàn | `reminders` | 3 |
| **Danh sách chờ** (Phase 18.4): chỉ vào khi hết, mời đúng thứ tự và số lượng, chỗ đang dành không ai khác lấy được (vé đứng và ghế), hết 30 phút → người sau, suất ngừng bán → đóng | `waitlist` | 4 |
| **Đánh giá** (Phase 19): chỉ người đã vào cổng, sửa tại chỗ, hạn 60 ngày, điểm và phân bố, trả lời của đúng ban tổ chức, admin ẩn / hiện (audit), đối chiếu điểm, email mời đánh giá | `reviews` | 8 |
| Vé, QR, soát vé | `checkins` | 16 |
| **Cấu hình khởi động** (rà soát lỗi BUG-05): production bắt buộc 2FA cho admin, trừ khi bật rõ ràng cho stack Docker ở máy | `env` | 4 |
| **Hàng chờ mua vé** (Phase 21): tắt thì như cũ; N = 1 → người thứ hai chờ, giữ chỗ bị từ chối; thanh toán / hủy / hết hạn / hết lượt → người sau vào và được báo qua WebSocket; người mới không chen trước; vào lại không mất chỗ; lời mời danh sách chờ không cần lượt; tắt / tăng N; số liệu chỉ cho ban tổ chức; Redis lỗi → cho qua | `purchase-queue` (unit + tích hợp) | 17 |
| **Vé PDF** (Phase 20): nội dung trang, mã QR trong PDF đúng phiên bản, font có dấu; email xác nhận đính kèm, lỗi tạo PDF vẫn gửi email; tải PDF chỉ chủ đơn, đơn đã hoàn → 409; cấp lại QR → email kèm PDF mới | `ticket-pdf` (unit + tích hợp) | 6 |
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
| **IPN của VNPay và Return URL đến cùng lúc** | ghi nhận đúng 1 lần: 1 vé, 1 email |
| 4 lần sai mật khẩu cùng lúc cho một email (Phase 18.1) | đếm đủ 4, không lần nào mất |
| **2 lần khách hủy cùng một đơn cùng lúc** (Phase 18.3) | hoàn đúng 1 lần |
| Job nhắc lịch / job mời danh sách chờ chạy 2 bản cùng lúc (Phase 18) | không email trùng, không mời quá số chỗ trống |
| **200 người cùng vào hàng chờ mua vé, N = 10** (Phase 21) | đúng 10 người có lượt, vị trí 1..190 không trùng, không thiếu |
| **10 người đánh giá một sự kiện cùng lúc** (Phase 19) | số đánh giá và tổng điểm trên sự kiện đúng |
| 2 người cùng dùng lượt cuối của 1 mã giảm giá | đúng 1 người được |
| 2 admin cùng duyệt 1 sự kiện / 1 nhà tổ chức | 1 thành công, 1 xung đột |
| 2 admin cùng gỡ quyền admin của nhau | nền tảng vẫn còn ít nhất 1 admin |
| Đăng ký cùng một email cùng lúc | đúng 1 tài khoản |

### Độ phủ code

`npm run test:coverage` (báo cáo HTML ở `backend/coverage/index.html`):

| Statements | Branches | Functions | Lines |
|---|---|---|---|
| **93,8%** | **82,8%** | **95,1%** | **95,9%** |

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

Phần logic không cần trình duyệt: lý do VNPay từ chối (theo mã), gộp cập nhật sơ đồ ghế real-time (phiên bản, ghế bị người khác lấy, chế độ sửa đơn đang giữ), client WebSocket (kết nối lại, đăng nhập lại khi token hết hạn), refresh token chỉ chạy một lần cho nhiều request và nhiều tab, giờ server, giờ Việt Nam, kết quả quét vé, kiểm tra trước khi gửi duyệt, quyền menu, CSV (BOM, chống CSV injection), số trên biểu đồ.

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
| **Trả qua VNPay** (Phase 17) | trình duyệt sang trang của một VNPay giả (`e2e/support/fake-vnpay.mjs`, kiểm chữ ký của URL), hủy → về trang kết quả với lý do; trả lại → IPN tới API, về thẳng trang đơn, có vé |
| **Hủy đơn theo chính sách** (Phase 18.3) | trang sự kiện ghi chính sách; trang đơn hiện số được hoàn và phí; hủy → đơn hoàn tiền, mục Hoàn tiền "Đã hoàn" |
| **Danh sách chờ** (Phase 18.4) | hết vé → "Báo tôi khi có vé"; người khác trả vé → lời mời (job chạy trong API của E2E mỗi 2 giây); vé đang dành không ai khác giữ được; đặt từ trang Danh sách chờ |
| **Đánh giá** (Phase 19) | người đã vào cổng đi từ "Vé của tôi" tới trang sự kiện, chấm sao và viết; ban tổ chức trả lời ngay trên trang; admin ẩn → điểm trung bình đổi, người viết thấy lý do |
| **Hàng chờ mua vé** (Phase 21) | ban tổ chức bật hàng chờ N = 1 trên trang sự kiện; A có lượt, B thấy "vị trí 1"; A thanh toán → trang của B (không tải lại) tự hiện sơ đồ ghế, B giữ chỗ được; số người đang mua / đang chờ trên trang ban tổ chức |
| **Tải vé PDF** (Phase 20) | nút "Tải vé PDF" ở trang đơn và trang vé tải về đúng tên file, nội dung là PDF |
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

Trước các kịch bản, project `warmup` (`e2e/tests/warmup.setup.ts`) mở vài trang để Vite biên dịch xong. Cả lần chạy quá 10 phút (CI 20 phút) thì dừng và báo test đang chạy (`globalTimeout`), không đứng im.

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

**Đo lại sau Phase 19** (15/10/2026, cùng máy, 1 bản API), vì Phase 18 thêm kiểm tra danh sách chờ vào luồng giữ chỗ: không chậm đi.
- Hỗn hợp: giữ chỗ p95 **44 ms** (trước 71 ms), thanh toán p95 **33 ms** (trước 52 ms), 2.839 lượt mua, 0% lỗi.
- Tranh ghế: giữ ghế p95 327 ms (trước 313 ms), 1.266 request/giây (trước 1.002), 0% lỗi.
- Hủy đơn khi 500 người tranh 50 ghế với 1 bản API vẫn p95 ≈ 3,5 s, như trước; 3 bản API giảm còn ≈ 1 s.

### Số người dùng cùng lúc cấu hình được (Phase 22)

Mọi kịch bản nhận số người dùng ảo khi chạy, không phải sửa code (`loadtest/k6/profile.js`):

| Biến | Ý nghĩa | Mặc định |
|---|---|---|
| `VUS` | số người dùng ảo cùng lúc | số cũ của từng kịch bản (300 / 200 / 500 / 200; hàng chờ 500) |
| `RAMP` | thời gian tăng từ 0 lên `VUS` | như cũ |
| `DURATION` | thời gian giữ ở mức cao nhất | như cũ |
| `SHAPE` | `ramp` (tăng dần), `spike` (tất cả cùng lúc), `steps` (25 / 50 / 75 / 100%) | `ramp` |

Kịch bản thứ 5 **`queue.js`** mô phỏng giờ mở bán với **hàng chờ mua vé** (Phase 21):
- mỗi người dùng ảo là một khách: vào hàng, hỏi vị trí mỗi 3 giây, tới lượt thì chọn vé 5–15 giây rồi giữ chỗ và thanh toán;
- một người dùng ảo "ban tổ chức" đọc số người đang mua mỗi giây. Ngưỡng: lớn nhất ≤ N;
- tham số thêm: `SPREAD` (rải người đến trong khoảng thời gian này), `THINK`, `MAX_WAIT`.

```
LOAD_CUSTOMERS=1000 node loadtest/seed.mjs            # đủ tài khoản cho VUS; LOAD_QUEUE_CAPACITY=N (mặc định 50)
k6 run -e VUS=1000 -e SHAPE=spike -e DURATION=1m loadtest/k6/contention.js
k6 run -e VUS=1000 loadtest/k6/queue.js
node loadtest/verify.mjs
```

**Trên Windows nên chạy k6 trong mạng Docker.** Chạy k6 trên máy rồi gọi `localhost:3200` thì ở 500–1.000 người, 3,5–4,4% kết nối bị chính Docker Desktop từ chối (`connectex: ... actively refused`) trước khi tới API. Trong mạng Docker, cùng tải đó cho 0% lỗi:

```
docker run --rm --network etp_default -v "%CD%/loadtest:/loadtest" -e API_URL=http://load-lb:3200/api/v1 grafana/k6:2.2.0 run -e VUS=1000 /loadtest/k6/queue.js
```

(PowerShell: thay `%CD%` bằng `${PWD}`.)

**Kết quả** (19/10/2026, cùng laptop; k6 trong mạng Docker; 1 bản API trừ khi ghi khác; mỗi người dùng ảo một tài khoản):

| Kịch bản | Người cùng lúc | Request/giây | p95 | Lỗi | Ghi chú |
|---|---|---|---|---|---|
| **Hàng chờ** N = 50, tất cả đến cùng lúc | 200 | 37 | vào hàng 121 ms; hỏi vị trí 20 ms; giữ chỗ 39 ms; thanh toán 20 ms | 0% | chờ trung bình 17 s, lâu nhất 39 s; 200/200 mua được |
| | 500 | 86 | vào hàng 230 ms; hỏi vị trí 73 ms; giữ chỗ 36 ms | 0% | chờ trung bình 51 s, lâu nhất 1 ph 49 s; 500/500 |
| | 1.000 | 170 | **vào hàng 1,21 s** ✗; hỏi vị trí 38 ms; giữ chỗ 37 ms; thanh toán 24 ms | 0% | chờ trung bình 1 ph 47 s, lâu nhất 3 ph 42 s; 1.000/1.000 |
| | 1.000, **3 bản API** | 168 | **vào hàng 361 ms**; hỏi vị trí 20 ms; giữ chỗ 37 ms | 0% | như trên |
| **Tranh ghế** 50 ghế, tất cả đến cùng lúc | 200 | 677 | giữ ghế 79 ms; hủy 206 ms | 0% | |
| | 500 | 1.156 | giữ ghế 496 ms; **hủy 1,19 s** ✗ | 0% | |
| | 1.000 | 1.143 | **giữ ghế 854 ms** ✗; **hủy 4,5 s** ✗ | 0% | 1 bản API đã bão hòa (≈ 1.150 request/giây) |
| **Hỗn hợp** 70 / 20 / 10, 2 phút | 200 | 242 | giữ chỗ 34 ms; thanh toán 22 ms | 0% | 1.400 lượt mua |
| | 500 | 603 | giữ chỗ 75 ms; thanh toán 70 ms | 0% | 2.695 lượt mua |
| | 1.000 | 1.164 | giữ chỗ 727 ms; thanh toán 725 ms; **sơ đồ ghế 307 ms** ✗ | 0% | 4.283 lượt mua |

✗: vượt ngưỡng của kịch bản (p95 < 300 ms cho đọc / vào hàng, < 800 ms cho giữ chỗ / thanh toán / hủy).

- **Hàng chờ giữ đúng giới hạn ở mọi mức:** số người đang mua lớn nhất đúng 50 (ban tổ chức đọc mỗi giây), và tính lại từ đơn hàng (`verify.mjs`) không lúc nào quá 50. Mọi người đều được vào theo thứ tự và mua được vé, 0% lỗi.
- **Không ghế nào bán hai lần, tồn kho và vé phát ra khớp** sau toàn bộ các lần chạy (`verify.mjs`).
- **Giới hạn của 1 tiến trình API trên laptop:**
  - khoảng 1.150 request/giây;
  - ở 1.000 người, độ trễ tăng mà không có lỗi. Riêng lúc 1.000 người cùng bấm "vào hàng" trong một khoảnh khắc, p95 lên 1,2 s;
  - chạy 3 bản API thì giảm còn 0,36 s. Đây là hướng mở rộng đã thiết kế: Node.js dùng một nhân CPU cho mỗi tiến trình.

  Các điểm vượt ngưỡng được ghi lại để xử lý ở bước rà soát lỗi (ví dụ: lưu cấu hình hàng chờ trong bộ nhớ đệm thay vì đọc PostgreSQL ở mỗi lần vào hàng).
- **Đã xử lý ở bug review** (`docs/bug-review.md` mục 5): nhiều tiến trình API trong một container (`API_WORKERS`; stack đo tải: `LOAD_API_WORKERS=4`). Với 4 tiến trình, 1.000 người: vào hàng p95 197 ms, tranh ghế 3.549 request/giây (giữ ghế 75 ms, hủy 1,03 s), hỗn hợp: sơ đồ ghế 56 ms, giữ chỗ 164 ms, thanh toán 195 ms; 0% lỗi, không bán trùng.
- Kết quả thô nằm ở `loadtest/results/` trên máy chạy đo (không đưa vào git: `--summary-export` JSON và bản tóm tắt k6). Chi tiết và các lỗi của chính script đo tìm ra trong lúc đo: `docs/phase-22-load-config-design.md`, mục 12.

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
