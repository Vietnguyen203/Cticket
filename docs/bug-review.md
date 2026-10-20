# Rà soát lỗi

> Nhận xét phát triển: *"Rà soát lỗi"*. Đợt rà: 20/10/2026, sau Phase 22 (`main` = `1152a9b`).
> Trạng thái: **xong**: 5 lỗi đã sửa, mỗi lỗi kèm test hồi quy (backend 393 test, web 73, E2E 20, đều đạt).
> Xử lý tiếp (20/10/2026, mục 5): các điểm trước đây "chấp nhận" hoặc "theo dõi" đã được xử lý (thư viện, E2E, hiệu năng). Backend 403 test, E2E 20 kịch bản, đều đạt.

## 1. Phạm vi và cách rà

| Bước | Làm gì | Công cụ |
|---|---|---|
| 1 | Lỗ hổng trong thư viện | `npm audit` (backend, web, E2E) |
| 2 | Đọc lại code theo module, ưu tiên chỗ có **tiền** và **tranh chấp**: thanh toán / VNPay, đơn hàng / giữ chỗ, hàng chờ, vé / soát vé, đăng nhập / 2FA | đọc code, đối chiếu tài liệu thiết kế |
| 3 | Các điểm vượt ngưỡng của load test Phase 22 | số đo trong `docs/testing.md` mục 4 |
| 4 | Các ca biên đã biết dễ lỗi: hết hạn giữ chỗ đúng lúc thanh toán, hoàn tiền hai lần, múi giờ, phân trang, web khi API lỗi / mất mạng | test tay, test tự động |
| 5 | Cấu hình production | `deploy/`, `docs/production-checklist.md` |

Mỗi lỗi được ghi ở mục 3:
- **mã**, **mức độ**, file, mô tả, cách tái hiện;
- **trạng thái**: đã sửa (kèm test hồi quy), hoặc chấp nhận (kèm lý do).

**Mức độ:**

| Mức | Nghĩa |
|---|---|
| **Cao** | sai tiền, bán trùng, lộ dữ liệu, vượt quyền |
| **Trung bình** | sai chức năng hoặc chậm rõ rệt khi đông người, có cách tránh |
| **Thấp** | hiển thị, thông báo, ca hiếm |

## 2. Thư viện (`npm audit`)

| Phần | Phụ thuộc production | Phụ thuộc dev |
|---|---|---|
| Backend | **0** | 19 cảnh báo mức trung bình, cùng một gốc: `sprintf-js` (DoS bằng chuỗi định dạng) trong chuỗi `jest` → `babel-plugin-istanbul` → `js-yaml` → `argparse` |
| Web | **0** | 0 |
| E2E | **0** | 0 |

~~**Chấp nhận:** `sprintf-js` chỉ dùng khi chạy test trên máy dev và CI, không có trong image production. "Bản sửa" npm gợi ý là hạ Jest xuống bản 25 (năm 2020), tệ hơn rủi ro.~~

**Đã sửa** (mục 5): ép thư viện con dùng `js-yaml` 4 (không còn `argparse` 1 / `sprintf-js`) bằng `overrides` trong `backend/package.json`, không phải hạ Jest. `npm audit`: backend **0** cảnh báo.

## 3. Lỗi tìm thấy

| Mã | Mức | Ở đâu | Lỗi | Đề xuất sửa | Trạng thái |
|---|---|---|---|---|---|
| **BUG-01** | **Cao** | `payments/vnpay.service.js` `applyGatewayResult`, `payments.repository.js` | VNPay báo **đã thu tiền** cho một lượt mà hệ thống đã ghi **FAILED** (ví dụ giao dịch bị VNPay tạm giữ vì nghi ngờ, mã 07, rồi mới thành công): hàm trả `ALREADY`, không làm gì. **Khách mất tiền mà không có vé, cũng không được hoàn**; nếu trả lại thì bị trừ hai lần. | Lượt FAILED mà được báo "đã trả": đơn còn chờ thanh toán thì ghi thành công và phát vé; không thì hoàn tiền như "tiền đến muộn". Kèm test. | **đã sửa**: lượt FAILED vẫn nhận "đã trả"; lượt mới hơn đang mở thì đóng lại (bị trừ tiền thì hoàn). 3 test trong `payments-vnpay.test.js`; thất bại khi bỏ bản sửa. |
| **BUG-02** | Thấp | `purchase-queue` + `vnpay.service.js` `startPayment` | Lượt hàng chờ chỉ kéo dài tới hạn của đơn. Khách còn đang trả tiền ở VNPay khi đơn quá hạn thì đơn vẫn mở (chờ đối soát, tới vài phút), nhưng lượt đã trao cho người sau: **có lúc N + 1 người đang mua**. Ghế vẫn an toàn (PostgreSQL quyết). | Mở lượt thanh toán VNPay thì kéo dài lượt hàng chờ thêm thời gian đối soát tối đa. Kèm test. | **đã sửa**: mở thanh toán VNPay → lượt kéo dài tới hạn của đơn + 11 phút. Test trong `purchase-queue.test.js`. |
| **BUG-03** | Trung bình (hiệu năng) | `purchase-queue.service.js` | Mỗi lần vào hàng / hỏi vị trí / giữ chỗ đều đọc cấu hình hàng chờ từ PostgreSQL. 1.000 người cùng bấm "vào hàng" → **p95 1,2 s** (load test Phase 22). | Nhớ cấu hình trong bộ nhớ của API vài giây (đổi cấu hình thì xóa ngay); đo lại bằng k6. | **đã sửa**: cấu hình nhớ 5 giây trong API (đổi cấu hình thì xóa ngay). k6, 1.000 người cùng vào: p95 **1.210 → 303 ms**, trung bình 507 → 132 ms, 0% lỗi. Test: 20 người cùng vào chỉ đọc cấu hình 1 lần. |
| **BUG-04** | Thấp | `frontend/src/api/client.ts` | Không có thời gian chờ tối đa: API treo (không trả lời cũng không ngắt) thì nút bấm **quay mãi**, không báo gì. | Thời gian chờ 30 giây (tải ảnh 60 giây), hết giờ thì báo "Máy chủ phản hồi quá lâu, thử lại". Kèm test. | **đã sửa**: chờ tối đa 30 giây (tải ảnh 60 giây), hết giờ báo "Máy chủ phản hồi quá lâu". Test trong `client.test.ts`. |
| **BUG-05** | Thấp (cấu hình) | `backend/src/config/env.js` | Production khởi động được dù `TWO_FACTOR_REQUIRED_ROLES` không có `ADMIN` (ví dụ chép nhầm `NONE` từ máy dev): **admin đăng nhập không cần 2FA** mà không ai biết. Chỉ có lời dặn trong comment. | Production thiếu `ADMIN` trong biến này thì từ chối khởi động, báo rõ lý do. Kèm test. | **đã sửa**: production thiếu `ADMIN` thì từ chối khởi động; stack Docker ở máy dev phải ghi rõ `ALLOW_ADMIN_WITHOUT_2FA=true` (in cảnh báo mỗi lần khởi động; file triển khai VPS không truyền biến này). 4 test trong `env.test.js`. |

Ghi chú về BUG-03: ở 1.000 người cùng bấm trong một giây, "vào hàng" vẫn p95 303 ms (ngưỡng 300). Phần còn lại là script Redis và Node.js xử lý dồn 1.000 yêu cầu trên một tiến trình; chạy nhiều bản API giảm tiếp (đã đo 3 bản: 0,36 s ngay cả trước khi sửa).

Ghi chú về E2E: một lần chạy toàn bộ trong lúc rà bị treo (các tiến trình Playwright đứng yên hơn 20 phút, không test nào báo lỗi); chạy lại ngay sau đó đạt 20/20 trong 1,2 phút. Chưa tái hiện được. Đã thêm chốt chặn (mục 5).

### Hiệu năng ghi nhận (giới hạn của 1 tiến trình API trên laptop): đã xử lý ở mục 5

| Điểm | Số đo (Phase 22) | Vì sao chấp nhận |
|---|---|---|
| Tranh ghế 1.000 người / 50 ghế, 1 bản API: hủy đơn p95 4,5 s, giữ ghế p95 854 ms | 0% lỗi, không bán trùng | Hàng trăm người cùng khóa đúng 50 dòng ghế; 1 tiến trình đã bão hòa (≈ 1.150 request/giây). Chạy nhiều bản API đã đo được nhanh hơn (Phase 13: hủy đơn từ 3,4 s xuống 1 s). Thực tế, sự kiện đông người thì bật **hàng chờ** (Phase 21) để chỉ N người tranh cùng lúc. |
| Hỗn hợp 1.000 người: sơ đồ ghế p95 307 ms (ngưỡng 300) | 0% lỗi | Vượt 2%, cùng nguyên nhân CPU. |

## 4. Đã rà, không thấy lỗi

| Phần | Đã kiểm tra |
|---|---|
| Thanh toán / VNPay | chữ ký IPN và Return URL (so sánh an toàn thời gian), số tiền so với lượt, khóa đơn trước lượt, IPN đến hai lần, đơn hết hạn khi đang trả (job dọn đơn bỏ qua đơn còn lượt VNPay, đối soát trước), hoàn tiền qua hàng đợi, hủy theo chính sách (khách phải xác nhận đúng số tiền đã thấy) |
| Đơn hàng | thứ tự khóa (sự kiện → suất → đơn → ghế → vé đứng), hết hạn kiểm tra trong giao dịch, sửa / hủy đơn, chống bấm hai lần (`uq_orders_active_cart`) |
| Đăng nhập | token làm mới dùng một lần + phát hiện dùng lại, OTP dùng một lần, đặt lại mật khẩu thu hồi mọi phiên, admin khóa tài khoản / đổi vai trò thu hồi ngay, cùng một lỗi cho "sai email" và "sai mật khẩu" |
| Quyền | đơn, vé, PDF, số liệu hàng chờ: người khác nhận 404 (không lộ là có tồn tại) |
| Tải ảnh | kiểm tra loại theo byte thật, tên ngẫu nhiên, không nhận SVG, `nosniff`; link ảnh chỉ `http(s)` hoặc ảnh đã tải lên |
| Giới hạn tần suất | đăng ký, OTP, đăng nhập, 2FA, giữ chỗ, sửa đơn, tải ảnh, đánh giá, hàng chờ; giới hạn chung 600 request/phút |
| Múi giờ | mọi chỗ định dạng ngày giờ (email, PDF, thông báo) ghi rõ `Asia/Ho_Chi_Minh` |
| Bí mật | JWT / OTP / QR ≥ 32 ký tự, khóa TOTP đúng 32 byte, thanh toán giả lập tắt mặc định trên production |

## 5. Xử lý tiếp (20/10/2026)

| Điểm | Làm gì | Kết quả |
|---|---|---|
| `sprintf-js` (thư viện dev) | `overrides` trong `backend/package.json`: thư viện con của Jest (`@istanbuljs/load-nyc-config`) dùng `js-yaml` 4 thay cho bản 3 (bản 3 kéo theo `argparse` 1 → `sprintf-js`). API của `js-yaml` 4 mà thư viện đó gọi (`load`) không đổi. | `npm audit` backend: 19 → **0**. 403 test và độ phủ đều đạt. |
| E2E treo một lần | `globalTimeout` trong `e2e/playwright.config.ts`: cả lần chạy quá 10 phút (CI 20 phút) thì dừng và báo test nào đang chạy, thay vì đứng im. | Treo (nếu có lần sau) thành lỗi rõ ràng, có tên test. |
| Kịch bản ban tổ chức (E2E) lỗi 1 lần rồi đạt 4 lần | Project `warmup` chạy trước mọi kịch bản (`e2e/tests/warmup.setup.ts`): mở trang chủ, danh sách sự kiện, đăng nhập, để Vite biên dịch xong trước khi các kịch bản bắt đầu đếm giờ. | Toàn bộ 21/21 (20 kịch bản + warmup) đạt trong 1,5 phút; riêng kịch bản ban tổ chức lặp 5 lần, đạt cả 5. |
| Hiệu năng ở 1.000 người (BUG-03 còn 303 ms; tranh ghế; sơ đồ ghế) | **Nhiều tiến trình API trong một container**: biến `API_WORKERS` (số, hoặc `auto` = số nhân CPU). `src/server.js` là điểm khởi động; khi `API_WORKERS` > 1 thì tạo các tiến trình con dùng chung cổng (module `cluster` của Node.js, `src/api-cluster.js`); mỗi tiến trình là một API đầy đủ (`src/api-process.js`). Không phải đổi gì khác: phiên, giới hạn tần suất, hàng chờ, bộ nhớ đệm nằm ở Redis / PostgreSQL; WebSocket giữa các tiến trình chuyển qua Redis pub/sub như khi chạy nhiều container. | Xem bảng dưới. |

**Chi tiết của `API_WORKERS`:**
- `PG_POOL_MAX` vẫn là số kết nối PostgreSQL **của cả container**, chia đều cho các tiến trình (ít nhất 2 mỗi tiến trình). Công thức `max_connections` trong checklist production không đổi.
- Một tiến trình con chết thì 1 giây sau có tiến trình mới thay. Chết quá 5 lần trong 1 phút thì cả container dừng (Docker khởi động lại, có log để người vận hành thấy).
- SIGTERM / SIGINT được chuyển cho mọi tiến trình con; mỗi tiến trình tắt êm như trước (đóng WebSocket, chờ request đang chạy, đóng pool). Đo trên Docker: `docker stop` xong trong 0,9 giây, mã thoát 0.
- Mặc định `1` (như trước) cho máy dev; file triển khai VPS dùng `2`; stack đo tải `LOAD_API_WORKERS`.
- Test: 9 unit test (`tests/unit/api-cluster.test.js`: số tiến trình, chia pool, đọc biến, thay tiến trình chết, dừng khi chết liên tục, chuyển tín hiệu, ép thoát khi treo); 1 test tích hợp (`tests/integration/api-cluster.test.js`) khởi động thật `node src/server.js` với 2 tiến trình, kiểm tra 2 PID khác nhau, mỗi tiến trình pool 5, trả lời request, tắt êm.

**Đo lại** (k6 trong mạng Docker, cùng laptop, **1 container API, 4 tiến trình**, so với 1 tiến trình đo ở Phase 22 / BUG-03):

| Kịch bản (1.000 người) | 1 tiến trình | 4 tiến trình | Ngưỡng |
|---|---|---|---|
| Hàng chờ: vào hàng p95 | 303 ms | **197 ms** ✓ | 300 ms |
| Tranh ghế: request/giây | 1.143 | **3.549** | |
| Tranh ghế: giữ ghế p95 | 854 ms | **75 ms** ✓ | 800 ms |
| Tranh ghế: hủy đơn p95 | 4,5 s | **1,03 s** ✗ | 800 ms |
| Hỗn hợp: sơ đồ ghế p95 | 307 ms | **56 ms** ✓ | 300 ms |
| Hỗn hợp: giữ chỗ / thanh toán p95 | 727 / 725 ms | **164 / 195 ms** ✓ | 800 ms |

Mọi lần chạy 0% lỗi, không ghế nào bán hai lần, vé phát ra khớp số chỗ đã trả, hàng chờ không lúc nào quá N (`verify.mjs`).

**Còn lại, ghi nhận:**
- **Hủy đơn khi 1.000 người cùng tranh 50 ghế: p95 1,03 s** (giảm 4,4 lần nhưng vẫn trên ngưỡng 800 ms). Phần còn lại không còn là CPU: đó là thời gian chờ khóa trên đúng 50 dòng ghế trong PostgreSQL, vì hàng trăm giao dịch cùng xếp hàng trên cùng các dòng đó. Đây là cách chống bán trùng có chủ đích. Thực tế, sự kiện đông người thì bật **hàng chờ** (Phase 21) để chỉ N người cùng tranh; khi đó giữ chỗ p95 khoảng 35 ms.
- **Khởi động lạnh:** đợt 1.000 người ập vào **ngay sau khi container vừa bật** thì "vào hàng" p95 khoảng 1,1 s (lần đầu, mỗi tiến trình còn đang biên dịch code và mở kết nối). Lần sau là 197 ms. Khi triển khai, không nên khởi động lại API ngay trước giờ mở bán.
