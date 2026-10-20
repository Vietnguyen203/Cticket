# Rà soát lỗi

> Nhận xét phát triển: *"Rà soát lỗi"*. Đợt rà: 20/10/2026, sau Phase 22 (`main` = `1152a9b`).
> Trạng thái: **xong**: 5 lỗi đã sửa, mỗi lỗi kèm test hồi quy (backend 393 test, web 73, E2E 20, đều đạt).

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

**Chấp nhận:** `sprintf-js` chỉ dùng khi chạy test trên máy dev và CI, không có trong image production. Không có dữ liệu ngoài nào đi vào nó. "Bản sửa" npm gợi ý là hạ Jest xuống bản 25 (năm 2020), tệ hơn rủi ro. Sẽ hết khi Jest cập nhật thư viện con.

## 3. Lỗi tìm thấy

| Mã | Mức | Ở đâu | Lỗi | Đề xuất sửa | Trạng thái |
|---|---|---|---|---|---|
| **BUG-01** | **Cao** | `payments/vnpay.service.js` `applyGatewayResult`, `payments.repository.js` | VNPay báo **đã thu tiền** cho một lượt mà hệ thống đã ghi **FAILED** (ví dụ giao dịch bị VNPay tạm giữ vì nghi ngờ, mã 07, rồi mới thành công): hàm trả `ALREADY`, không làm gì. **Khách mất tiền mà không có vé, cũng không được hoàn**; nếu trả lại thì bị trừ hai lần. | Lượt FAILED mà được báo "đã trả": đơn còn chờ thanh toán thì ghi thành công và phát vé; không thì hoàn tiền như "tiền đến muộn". Kèm test. | **đã sửa**: lượt FAILED vẫn nhận "đã trả"; lượt mới hơn đang mở thì đóng lại (bị trừ tiền thì hoàn). 3 test trong `payments-vnpay.test.js`; thất bại khi bỏ bản sửa. |
| **BUG-02** | Thấp | `purchase-queue` + `vnpay.service.js` `startPayment` | Lượt hàng chờ chỉ kéo dài tới hạn của đơn. Khách còn đang trả tiền ở VNPay khi đơn quá hạn thì đơn vẫn mở (chờ đối soát, tới vài phút), nhưng lượt đã trao cho người sau: **có lúc N + 1 người đang mua**. Ghế vẫn an toàn (PostgreSQL quyết). | Mở lượt thanh toán VNPay thì kéo dài lượt hàng chờ thêm thời gian đối soát tối đa. Kèm test. | **đã sửa**: mở thanh toán VNPay → lượt kéo dài tới hạn của đơn + 11 phút. Test trong `purchase-queue.test.js`. |
| **BUG-03** | Trung bình (hiệu năng) | `purchase-queue.service.js` | Mỗi lần vào hàng / hỏi vị trí / giữ chỗ đều đọc cấu hình hàng chờ từ PostgreSQL. 1.000 người cùng bấm "vào hàng" → **p95 1,2 s** (load test Phase 22). | Nhớ cấu hình trong bộ nhớ của API vài giây (đổi cấu hình thì xóa ngay); đo lại bằng k6. | **đã sửa**: cấu hình nhớ 5 giây trong API (đổi cấu hình thì xóa ngay). k6, 1.000 người cùng vào: p95 **1.210 → 303 ms**, trung bình 507 → 132 ms, 0% lỗi. Test: 20 người cùng vào chỉ đọc cấu hình 1 lần. |
| **BUG-04** | Thấp | `frontend/src/api/client.ts` | Không có thời gian chờ tối đa: API treo (không trả lời cũng không ngắt) thì nút bấm **quay mãi**, không báo gì. | Thời gian chờ 30 giây (tải ảnh 60 giây), hết giờ thì báo "Máy chủ phản hồi quá lâu, thử lại". Kèm test. | **đã sửa**: chờ tối đa 30 giây (tải ảnh 60 giây), hết giờ báo "Máy chủ phản hồi quá lâu". Test trong `client.test.ts`. |
| **BUG-05** | Thấp (cấu hình) | `backend/src/config/env.js` | Production khởi động được dù `TWO_FACTOR_REQUIRED_ROLES` không có `ADMIN` (ví dụ chép nhầm `NONE` từ máy dev): **admin đăng nhập không cần 2FA** mà không ai biết. Chỉ có lời dặn trong comment. | Production thiếu `ADMIN` trong biến này thì từ chối khởi động, báo rõ lý do. Kèm test. | **đã sửa**: production thiếu `ADMIN` thì từ chối khởi động; stack Docker ở máy dev phải ghi rõ `ALLOW_ADMIN_WITHOUT_2FA=true` (in cảnh báo mỗi lần khởi động; file triển khai VPS không truyền biến này). 4 test trong `env.test.js`. |

Ghi chú về BUG-03: ở 1.000 người cùng bấm trong một giây, "vào hàng" vẫn p95 303 ms (ngưỡng 300). Phần còn lại là script Redis và Node.js xử lý dồn 1.000 yêu cầu trên một tiến trình; chạy nhiều bản API giảm tiếp (đã đo 3 bản: 0,36 s ngay cả trước khi sửa).

Ghi chú về E2E: một lần chạy toàn bộ trong lúc rà bị treo (các tiến trình Playwright đứng yên hơn 20 phút, không test nào báo lỗi); chạy lại ngay sau đó đạt 20/20 trong 1,2 phút. Chưa tái hiện được, nên ghi lại để theo dõi.

### Hiệu năng ghi nhận, chấp nhận (giới hạn của 1 tiến trình API trên laptop)

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
