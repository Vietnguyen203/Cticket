# Phase 13 — Kiểm thử: E2E, load test, CI (đã duyệt, đang triển khai)

> Mục tiêu: chứng minh hệ thống **chạy đúng từ đầu tới cuối trên trình duyệt**, **chịu được tải** (có con số cụ thể: throughput, p95, p99, tỷ lệ lỗi), **không bán trùng ghế khi bị tranh nhau**, và **tự kiểm tra mỗi lần push** lên GitHub.

---

## 1. Hiện trạng và phạm vi

Kế hoạch ban đầu (file Excel), Phase 13 "Kiểm thử" gồm 3 việc. Hai việc đầu **đã làm dần trong từng phase**:

| Mã | Nội dung | Hiện trạng |
|---|---|---|
| TEST-01 | Unit + integration test (Jest + Supertest) | **Đã có**: 243 test backend (auth, sự kiện, ghế, đặt chỗ, thanh toán, vé, check-in, cache, queue, WebSocket, admin, báo cáo), 58 test web (Vitest). Phase này thêm **báo cáo độ phủ** (coverage) và lấp chỗ trống nếu thấy |
| TEST-02 | Test đồng thời | **Đã có**: 100 người cùng giữ 1 ghế → đúng 1 thành công, 99 bị từ chối, **cả khi tắt Redis**; 50 người tranh 10 vé đứng cuối; 2 cổng quét cùng 1 vé cùng lúc → đúng 1 lần vào; kiểm tra tồn kho khớp sau mỗi test |
| TEST-03 | Load test k6: 4 kịch bản | **Chưa làm** → phần chính của phase này |

Thêm hai việc đã hứa ở các phase trước:

| Việc | Lý do |
|---|---|
| **E2E bằng Playwright** | Phase 11 hẹn: test giao diện tự động, kể cả cảnh 2 trình duyệt cùng xem sơ đồ ghế |
| **CI GitHub Actions** | Mỗi lần push / mở PR tự chạy toàn bộ test; không ai phải nhớ chạy tay |

**Không làm ở phase này** (để Phase 14 "Hardening, tài liệu"): viết lại README đầy đủ (DOC-01), rà soát bảo mật, tinh chỉnh truy vấn / pool (PERF-01). Helmet, giới hạn body, tắt máy an toàn (INF-06, INF-07) đã có từ các phase trước.

---

## 2. E2E bằng Playwright (bước 13.1)

### 2.1 Môi trường riêng, không đụng dữ liệu dev, không gửi mail thật

```
Playwright ──► Vite (cổng 5180) ──/api, /ws──► API Node (cổng 3100)
                                                 ├─ PostgreSQL: database riêng  etp_e2e  (tạo + migrate lại mỗi lần chạy)
                                                 ├─ Redis: database số 14 (xóa mỗi lần chạy)
                                                 └─ SMTP → Mailpit (Docker, cổng 1025) — đọc OTP qua API của Mailpit
```

- Playwright tự khởi động API và Vite (`webServer`), tự tắt khi xong. Chỉ cần Docker đang chạy `postgres`, `redis`, `mailpit`.
- API E2E ghi đè mọi cấu hình mail về **Mailpit**, dù `backend/.env` có Gmail thật. Bí mật JWT / OTP / QR dùng giá trị chỉ-để-test.
- `QUEUE_MODE=inline` (vé phát ngay khi thanh toán), tắt giới hạn tần suất (mọi request đến từ 127.0.0.1).
- Thư mục mới `e2e/` ở gốc dự án, có `package.json` riêng (chỉ Playwright), không làm nặng backend / frontend.
- Trình duyệt: **Chromium** (desktop) và **khổ điện thoại** cho trang soát vé. Camera không giả lập được → test dùng ô "dán mã".

### 2.2 Dữ liệu cho mỗi test

Dữ liệu nền (admin, nhà tổ chức đã duyệt, địa điểm có ghế, sự kiện đã đăng bán) tạo **bằng API** trong fixture cho nhanh và ổn định; **phần cần kiểm tra thì làm bằng giao diện**. Mỗi test dùng email / tên ngẫu nhiên nên chạy song song không đụng nhau.

### 2.3 Các kịch bản (khoảng 8 test)

| # | Kịch bản | Kiểm tra |
|---|---|---|
| 1 | **Đăng ký** → lấy OTP trong Mailpit → xác minh → đã đăng nhập; **đăng xuất**; đăng nhập lại | Luồng tài khoản, cookie refresh httpOnly (JS không đọc được) |
| 2 | **Mua vé**: chọn 2 ghế + 1 vé đứng → giữ chỗ → mã giảm giá sai rồi đúng → thanh toán bị từ chối → thanh toán lại thành công → "Vé của tôi" có 3 vé, mở vé thấy QR | Luồng mua chính, số tiền, idempotency |
| 3 | **Real-time** (2 trình duyệt): A và B cùng mở sơ đồ ghế; A giữ ghế → B thấy ghế đó đổi màu **không cần tải lại**; ghế B đang chọn bị người khác giữ thì tự bỏ chọn và báo | WebSocket |
| 4 | **Hết giờ giữ chỗ**: đơn giữ chỗ hết hạn → trang đơn báo hết hạn, ghế trở lại trống | Đếm ngược theo giờ server |
| 5 | **Ban tổ chức → admin**: tạo sự kiện, suất diễn, hạng vé, gán ghế, gửi duyệt (giao diện) → admin duyệt → sự kiện hiện ở trang chủ | Các trang quản trị |
| 6 | **Soát vé** (khổ điện thoại): nhân viên chọn suất → dán mã vé → màn xanh "Mời vào" → dán lại → màn đỏ "Vé đã được sử dụng" → lịch sử có 1 lượt | Trang nhân viên |
| 7 | **Hoàn tiền + báo cáo**: admin hoàn tiền một đơn → vé hết hiệu lực; báo cáo sự kiện của ban tổ chức đổi đúng (doanh thu giảm, hoàn tiền tăng) | Admin, báo cáo |
| 8 | **Phân quyền**: khách vào `/admin` → 403; ban tổ chức không mở được báo cáo sự kiện của người khác | Giao diện chặn đúng (API vẫn tự chặn) |

Lỗi → Playwright lưu **ảnh chụp, video và trace** để xem lại từng bước.

Chạy: `cd e2e && npm test` (hoặc `npm run test:ui` để xem trực quan).

---

## 3. Load test bằng k6 (bước 13.2, TEST-03)

### 3.1 Chạy trên bản Docker giống production, dữ liệu riêng

- File `loadtest/docker-compose.loadtest.yml` (ghép thêm vào compose chính): `api-load` + `worker-load` cùng image với `api` / `worker`, nhưng dùng **database riêng `etp_load`** và **Redis database 2**, cổng **3200**, mail về Mailpit, **tắt giới hạn tần suất** (k6 gửi mọi request từ một IP; giới hạn tần suất đã có test riêng). Dữ liệu dev không bị ảnh hưởng.
- Script `seed` tạo dữ liệu tải: 1 sự kiện lớn (địa điểm **2.000 ghế** + **5.000 vé đứng**), thêm khoảng 50 sự kiện khác để trang danh sách có dữ liệu, **2.000 khách** kèm access token (ghi ra file trong thư mục bị git bỏ qua). Token sống 15 phút nên seed ngay trước khi chạy.
- k6 đã có sẵn trên máy (v2.2). Kết quả lưu JSON + tóm tắt trong `docs/`.

### 3.2 Bốn kịch bản (theo kế hoạch)

| # | Kịch bản | Mô phỏng | Tải |
|---|---|---|---|
| 1 | **Duyệt** | Trang chủ, danh sách, tìm kiếm, chi tiết sự kiện (người chưa đăng nhập; có cache Redis) | tăng dần tới 300 người dùng ảo (VU) |
| 2 | **Xem sơ đồ ghế** | Tải sơ đồ 2.000 ghế + tình trạng còn chỗ | tới 200 VU |
| 3 | **Tranh ghế** | 500 VU cùng lúc giữ ghế trong 50 ghế "hot" → phần lớn bị từ chối 409 (là đúng); sau đó **kiểm tra không ghế nào bán hai lần** và tồn kho khớp | 500 VU, đợt dồn dập |
| 4 | **Hỗn hợp** | 70% duyệt, 20% xem sơ đồ, 10% mua trọn vẹn (giữ chỗ → checkout → thanh toán, có Idempotency-Key) | 200 VU trong 5 phút |

Có thể thêm (nếu còn thời gian): **500 kết nối WebSocket** cùng xem sơ đồ trong lúc kịch bản 3 chạy, đo độ trễ từ lúc giữ ghế tới lúc người xem nhận tin.

### 3.3 Đo gì, đạt thế nào là ổn

- Đo: **số request/giây**, **p50 / p95 / p99** thời gian phản hồi, **tỷ lệ lỗi** (409 / 422 có chủ đích **không** tính là lỗi), CPU / RAM của container (`docker stats`).
- Ngưỡng đề xuất (k6 `thresholds`, vượt là kịch bản **fail**):
  - Duyệt, xem sơ đồ: p95 < **300 ms**, lỗi < **1%**
  - Giữ chỗ / thanh toán: p95 < **800 ms**, lỗi (ngoài 409) < **1%**
  - Tranh ghế: **0 ghế bán trùng**, tồn kho khớp (`npm run inventory:check`)
- Nếu không đạt: tìm nút thắt (pool kết nối, truy vấn chậm, CPU), sửa, đo lại, ghi cả số trước / sau vào tài liệu.
- **Lưu ý trung thực**: chạy trên laptop (i5-12500H, 24 GB, Docker Desktop / WSL2), k6 và server **chung một máy** → con số chỉ để so sánh và tìm nút thắt, không phải năng lực production.

---

## 4. CI bằng GitHub Actions (bước 13.3)

`.github/workflows/ci.yml`, chạy khi push và khi mở pull request:

| Job | Làm gì |
|---|---|
| `backend` | PostgreSQL 17 + Redis 7.4 (service container) → `npm ci` → toàn bộ Jest (migrate lên / xuống / lên như khi chạy ở máy) + coverage |
| `web` | `npm ci` → typecheck → lint → Vitest → build |
| `e2e` | PostgreSQL + Redis + Mailpit → cài Chromium → Playwright; lỗi thì tải lên ảnh / video / trace để xem |

- Bí mật trong CI là **giá trị giả chỉ để test** ghi thẳng trong workflow (không phải secret thật); không job nào gửi mail ra ngoài.
- Load test **không** chạy trong CI (lâu, kết quả phụ thuộc máy); chạy tay khi cần.
- Badge trạng thái CI để dành cho README ở Phase 14.

---

## 5. Báo cáo kiểm thử

`docs/testing.md`: cách chạy từng loại test; bảng các test đồng thời (TEST-02) và kết quả; độ phủ code (coverage) của backend; kết quả load test (bảng số liệu, nhận xét nút thắt, những gì đã sửa); kết quả E2E. Đây cũng là tài liệu dùng khi phỏng vấn.

---

## 6. Ước lượng

| Bước | Nội dung | Giờ |
|---|---|---|
| 13.1 | E2E: môi trường riêng, fixture, 8 kịch bản | 12 |
| 13.2 | Load test: compose riêng, seed, 4 kịch bản k6, chạy, tìm và sửa nút thắt, ghi kết quả | 12 |
| 13.3 | CI 3 job + coverage + `docs/testing.md` | 5 |
| **Tổng** | | **≈ 29 giờ** (kế hoạch Phase 13: 30 giờ) |

Mỗi bước: bạn chạy thử rồi commit, như các phase trước.

---

## 7. Cần quyết định khi review

1. **Phạm vi**: coi TEST-01, TEST-02 là đã xong (chỉ thêm coverage); làm mới **E2E Playwright**, **load test k6**, **CI**; README đầy đủ để Phase 14. Đồng ý?
2. **E2E chạy trên môi trường riêng** (database `etp_e2e`, Redis số 14, Mailpit; Playwright tự bật API + Vite), không đụng dữ liệu dev, không gửi mail thật; Chromium + khổ điện thoại. Đồng ý?
3. **8 kịch bản E2E** như mục 2.3 (dữ liệu nền tạo bằng API, phần cần kiểm tra làm bằng giao diện). Đồng ý?
4. **Load test trên bản Docker** với database `etp_load` riêng, **tắt giới hạn tần suất chỉ cho API load test**. Đồng ý?
5. **4 kịch bản và ngưỡng** như mục 3.2, 3.3 (WebSocket là phần thêm nếu còn thời gian). Đồng ý?
6. **CI GitHub Actions** 3 job (backend, web, e2e), không chạy load test trong CI. Đồng ý?
7. **3 bước** 13.1 → 13.2 → 13.3, mỗi bước test rồi commit, nhánh `feature/phase-13-e2e` (đã tạo từ `main`). Đồng ý?

Đã duyệt cả 7 điểm.

---

## 8. Ghi chú triển khai

### Bước 13.1 (xong): E2E bằng Playwright

- Thư mục `e2e/` (Playwright 1.64, TypeScript). `npm test` tự làm hết: `start-api.mjs` xóa và tạo lại database `etp_e2e`, chạy migration, xóa Redis database 14, tạo admin E2E, rồi bật API cổng 3100 (mail về Mailpit, bí mật chỉ-để-test, `QUEUE_MODE=inline`); Vite cổng 5180. Địa chỉ PostgreSQL / Redis lấy từ `TEST_DATABASE_URL` / `TEST_REDIS_URL` trong `backend/.env` (chỉ đọc đúng 2 biến này, không đọc cấu hình mail), hoặc `E2E_DATABASE_URL` / `E2E_REDIS_URL` (CI).
- **11 test** (desktop Chromium + 1 test khổ điện thoại Pixel 7): đăng ký → OTP trong Mailpit → đăng nhập, cookie refresh httpOnly + SameSite=Strict, tải lại vẫn đăng nhập, đăng xuất / đăng nhập lại; sai mật khẩu; mua 2 ghế + 1 vé đứng (mã sai rồi đúng, thẻ bị từ chối rồi thanh toán lại, 3 vé có QR); **2 trình duyệt real-time**; giữ chỗ hết hạn; **ban tổ chức tạo sự kiện hoàn toàn bằng giao diện** (thông tin, suất, 2 hạng vé, gán ghế, gửi duyệt) → admin duyệt → khách tìm thấy và chọn ghế; soát vé trên điện thoại (vào, quét lại bị từ chối, lịch sử); admin hoàn tiền → vé hết hiệu lực, báo cáo của ban tổ chức đổi đúng; 3 test phân quyền.
- **Chạy**: Docker bật `postgres`, `redis`, `mailpit`; lần đầu `cd e2e`, `npm install`, `npx playwright install chromium` (tải trình duyệt, ~300 MB, một lần cho mỗi máy); sau đó `npm test` (hoặc `npm run test:ui` để xem từng bước, `npm run report` xem báo cáo HTML). Trên Windows PowerShell 5.1 dùng `;` thay cho `&&`.
- Chạy song song 4 luồng ≈ 45 giây (máy bạn: 11 passed trong 41,8 giây); chạy thử **lặp 3 lần × 6 luồng: 33/33 pass**. Lỗi → ảnh chụp, video, trace trong `e2e/test-results/`.
- **E2E tìm ra 3 vấn đề, đã sửa / xử lý**:
  1. **Trang chỉnh sửa sự kiện mở được sự kiện đã đăng bán của nhà tổ chức khác** (hiện cả nút "Hủy sự kiện"). API vẫn chặn mọi thay đổi (404) nên không mất dữ liệu; nguyên nhân: `GET /events/:id` là API công khai. Sửa: trang editor kiểm tra sự kiện thuộc nhà tổ chức đang đăng nhập, nếu không thì báo "không tìm thấy" (`api/organizer.ts`).
  2. **Ô "Tên cổng" ở trang soát vé không gắn với nhãn** (trình đọc màn hình không đọc được tên ô). Sửa tận gốc trong `TextField`: tự sinh id (`useId`) khi không có `id` / `name`.
  3. **Redis trả lời chậm hơn 200 ms khi máy quá tải** (6 trình duyệt + Vite + API + Docker trên laptop): cache, giới hạn tần suất, khóa ghế tự chạy tiếp không có Redis đúng thiết kế, nhưng **mã OTP chỉ nằm trong Redis nên trả 503**. Môi trường E2E đặt `REDIS_COMMAND_TIMEOUT_MS=1000`; mặc định 200 ms của production **chưa đổi**, sẽ đo độ trễ Redis dưới tải ở bước 13.2 rồi quyết định.

### Bước 13.2 (xong): load test bằng k6

**Cách chạy** (từ thư mục gốc, stack dev đang chạy; Windows PowerShell dùng `;` thay cho `&&`):

```
docker compose --env-file .env -f loadtest/docker-compose.yml up -d --build   # stack riêng: etp_load, Redis db 2, cổng 3200
node loadtest/seed.mjs                                                          # dữ liệu: 2.000 ghế + 5.000 vé đứng, 51 sự kiện, 2.000 khách (token 2 giờ)
k6 run loadtest/k6/browse.js        # 1. duyệt        (≈ 3,5 phút)
k6 run loadtest/k6/seatmap.js       # 2. sơ đồ ghế    (≈ 3 phút)
k6 run loadtest/k6/contention.js    # 3. tranh ghế    (≈ 1 phút)
k6 run loadtest/k6/mixed.js         # 4. hỗn hợp      (5 phút)
node loadtest/verify.mjs            # dữ liệu còn đúng không (không ghế nào thuộc 2 đơn, tồn kho khớp)
docker compose --env-file .env -f loadtest/docker-compose.yml down             # tắt (dữ liệu etp_load vẫn giữ)
```

`LOAD_API_REPLICAS=3` chạy 3 bản API sau nginx (`load-lb`, round robin; khởi động lại `load-lb` sau khi đổi số bản).

**Máy đo**: laptop i5-12500H (12 nhân / 16 luồng), 24 GB, Windows 11 + Docker Desktop (WSL2); k6, API, PostgreSQL, Redis **chung một máy** → số liệu để so sánh và tìm nút thắt, không phải năng lực production.

**Kết quả** (1 bản API, cấu hình như production; "VU" = người dùng ảo, có thời gian nghĩ 1–5 giây giữa các thao tác):

| Kịch bản | Tải | Request/giây | p95 | p99 | Lỗi | Ngưỡng |
|---|---|---|---|---|---|---|
| 1. Duyệt (danh sách, tìm kiếm, chi tiết) | 300 VU | 392 | 5,7 ms | 9,2 ms | 0% | đạt (< 300 ms) |
| 2. Sơ đồ 2.000 ghế + còn chỗ (không nén) | 200 VU | 95 | 90 ms / 67 ms | 191 ms | 0% | đạt |
| 2b. Như trên, **có gzip ở nginx** | 200 VU | 95 | 63 ms / 45 ms | 102 ms | 0% | đạt |
| 3. Tranh ghế: 500 người, 50 ghế, 1 phút | 500 VU | 1.000–1.250 | giữ ghế 249–313 ms; **hủy đơn 3,4 s** | | 0% | giữ ghế đạt; hủy đơn **chưa đạt** (< 800 ms) |
| 3b. Như trên, **3 bản API** + gợi ý ghế | 500 VU | 1.250 | giữ ghế 372 ms; hủy đơn **1,04 s** | 0,8 s / 1,3 s | 0% | hủy đơn vẫn chưa đạt |
| 4. Hỗn hợp: 70% duyệt, 20% sơ đồ, 10% mua | 200 VU, 5 phút | 283 | duyệt 14 ms, sơ đồ 37 ms, giữ chỗ 71 ms, thanh toán 52 ms | 69 ms (tất cả) | 0% | **đạt hết**; 2.819 lượt mua, 3.953 vé phát đủ |

**Tính đúng** (sau mọi lần chạy, `verify.mjs`): **không ghế nào thuộc hai đơn**, tồn kho ghế và vé đứng khớp từng đơn, số vé phát ra = số chỗ đã trả tiền. Riêng kịch bản tranh ghế: hơn 16.000 lượt giữ ghế thành công rồi hủy, hàng trăm nghìn lượt bị từ chối 409 đúng.

**Nút thắt tìm được và đã làm gì**:

1. **Một tiến trình Node.js đầy 1 nhân CPU ở khoảng 1.000 request/giây** (tranh ghế). PostgreSQL không phải nguyên nhân: không truy vấn nào chờ khóa, mọi kết nối ở trạng thái `ClientRead` (chờ Node). Hủy đơn cần ~10 lượt hỏi DB, mỗi lượt xếp hàng sau hàng trăm request khác → 2–3 giây. Tắt log request: **không đổi** (log không phải thủ phạm). **3 bản API sau nginx**: hủy đơn trung vị 2,65 s → 0,42 s. Kiến trúc đã sẵn sàng scale ngang (WebSocket qua Redis pub/sub, worker BullMQ, khóa ghế ở Redis + PostgreSQL).
2. **Lỗi khi đặt API sau nginx giữ kết nối (keep-alive)**: Node đóng kết nối rảnh sau 5 giây, nginx gửi request vào đúng kết nối vừa đóng → "connection reset" → nginx coi API chết 10 giây → 502. **Sửa trong `server.js`**: `keepAliveTimeout` 65 s (> 60 s của nginx / load balancer cloud), `headersTimeout` 66 s.
3. **Mỗi lượt bấm vào ghế đã có người giữ vẫn mở một transaction và khóa dòng ghế** chỉ để trả 409; hủy đơn phải chờ khóa đó. **Thêm "gợi ý ghế đã có người lấy" trong Redis** (3 giây, như gợi ý "hết vé đứng" có từ Phase 6; Redis chỉ từ chối, không bao giờ tự chấp nhận; xóa ngay sau khi commit lúc ghế được trả lại; Redis hỏng thì bỏ qua). Đo lại: CPU PostgreSQL giảm 22–30% (63% → 44% với 1 bản; 179% → 140% với 3 bản), hủy đơn p95 1,58 → 1,04 s và p99 2,0 → 1,3 s (3 bản). Thêm 3 test Jest.
4. **Sơ đồ 2.000 ghế là 470 KB JSON không nén**: **bật gzip ở nginx** (`frontend/docker/nginx.conf`, cả JS / CSS): 470 KB → 70 KB, p95 90 → 63 ms, lưu lượng giảm 6 lần. Còn lại: API vẫn dựng lại JSON sơ đồ mỗi lần (CPU 80%) → hướng tiếp theo nếu cần: lưu sẵn chuỗi JSON đã dựng / ETag.
5. **Docker**: hai stack dùng chung mạng, service cùng tên `api` → DNS của Docker trả về **cả API dev lẫn API load test**, nginx chia tải sang API dev (sai database → 401). Đổi tên toàn bộ service load test thành `load-*`.
6. Docker Desktop trên Windows từ chối một phần khi 500 kết nối mở **cùng một lúc** (lỗi ở tầng chuyển tiếp cổng, API không nhận được) → kịch bản tăng dần 500 người trong 5 giây (sát thực tế hơn).

**Redis dưới tải** (câu hỏi từ bước 13.1): chỉ trong kịch bản tranh ghế (API đầy CPU), 322 lệnh Redis vượt 200 ms (~0,1%): kiểm tra token bị thu hồi, khóa ghế, gợi ý ghế, cache. Tất cả **chạy tiếp không cần Redis đúng thiết kế, 0 request lỗi**; Redis chỉ dùng 15–35% CPU, độ trễ đến từ vòng lặp sự kiện của Node bị quá tải. **Giữ mặc định 200 ms**; cách giảm là thêm bản API, không phải nới timeout.

**Chưa đạt, ghi nhận**: hủy đơn p95 < 800 ms trong kịch bản tranh ghế cực đoan (500 người, mỗi người bấm 3–5 lần/giây vào cùng 50 ghế). Với 3 bản API đạt 1,04 s; trên máy có nhiều nhân hơn / nhiều máy, thêm bản API sẽ tiếp tục giảm. Các kịch bản sát thực tế (1, 2, 4) đạt hết với 1 bản API.
