# Kịch bản test

> Nhận xét phát triển: *"Chuẩn bị kịch bản test"*. Bản 20/10/2026, ứng với `main` = `4bec1cd`; cập nhật 22/10/2026 (TC-ORG-11 → 15).
> Muốn làm từng bước trên giao diện theo thứ tự: [`ui-test-guide.md`](ui-test-guide.md).
> Dùng để **test tay trước khi demo / bàn giao**, và để biết mỗi chức năng đã có **test tự động** nào bảo vệ.

## 1. Cách dùng tài liệu

- Mỗi test case có **mã** `TC-<NHÓM>-<số>`, **ưu tiên** và cột **Tự động**: file test đang kiểm tra cùng hành vi, chạy được bằng lệnh.
  - **P1**: luồng chính, phải đạt trước mọi lần demo.
  - **P2**: chức năng phụ quan trọng.
  - **P3**: ca biên, giao diện.
- **"—"** ở cột Tự động: chỉ kiểm tra được bằng tay (cần điện thoại thật, email thật, VNPay sandbox thật…).
- Khi test tay, ghi **Đạt / Lỗi** vào cột "KQ" (bản in / bản Word). Lỗi thì ghi thêm bước tái hiện và ảnh chụp.

Ký hiệu file test tự động:

| Viết tắt | Nghĩa | Chạy |
|---|---|---|
| `BE:x` | `backend/tests/integration/x.test.js` (unit: `backend/tests/unit/x.test.js`, ghi `BE-unit:x`) | `cd backend` → `npm test` |
| `WEB:x` | `frontend/src/**/x.test.ts` | `cd frontend` → `npm test` |
| `E2E:x` | `e2e/tests/x.spec.ts` (trình duyệt thật) | `cd e2e` → `npm test` |
| `K6:x` | `loadtest/k6/x.js` (tải) | xem `docs/testing.md` mục 4 |

## 2. Chuẩn bị môi trường

1. Docker Desktop đang chạy. Ở thư mục gốc dự án:
   ```
   docker compose up -d --build
   ```
   Web ở http://localhost:8080, API ở http://localhost:3001.
2. **Email**: stack Docker trên máy dev gửi email **thật** qua Gmail (cấu hình `SMTP_*` trong `.env`). Đăng ký tài khoản test bằng **email của chính bạn** để nhận mã OTP và vé. Stack E2E dùng Mailpit (không gửi ra ngoài).
3. **Tài khoản**:
   - Admin: `admin@etp.local` (tạo bằng `npm run seed:admin`; có mọi vai trò). Trên stack Docker ở máy dev, admin đăng nhập không cần 2FA vì `.env` có `TWO_FACTOR_REQUIRED_ROLES=NONE` và `ALLOW_ADMIN_WITHOUT_2FA=true`. Mật khẩu: xem `.env` / người quản lý dự án, **không ghi vào tài liệu**.
   - Khách, ban tổ chức, nhân viên soát vé: tự đăng ký trong lúc test (TC-AUTH-01, TC-ORG-01, TC-CHK-01).
4. **Dữ liệu mẫu**: một sự kiện **đang bán** có cả khu ghế ngồi và vé đứng (làm theo TC-ORG-02 → TC-ORG-06), giờ diễn ít nhất 8 ngày sau (để thử các mốc hoàn tiền).
5. **Thanh toán**: nút "Giả lập thanh toán" (bật trên máy dev); VNPay sandbox với thẻ test NCB của VNPay (TC-PAY-05 → 07).
6. **Thiết bị**: một máy tính (Chrome) và một điện thoại (quét QR ở cổng, giao diện mobile). Hai trình duyệt (thường + ẩn danh) cho các ca 2 người.

---

## 3. Đăng ký, đăng nhập, bảo mật tài khoản (AUTH)

| Mã | Kịch bản | Tiền điều kiện | Các bước | Kết quả mong đợi | Ưu tiên | Tự động |
|---|---|---|---|---|---|---|
| TC-AUTH-01 | Đăng ký và xác minh email | Chưa có tài khoản | Đăng ký → nhận email mã 6 số → nhập mã | Đăng nhập luôn; menu có "Vé của tôi"; tải lại trang vẫn đăng nhập | P1 | E2E:auth, BE:auth |
| TC-AUTH-02 | Nhập sai mã OTP | Vừa đăng ký | Nhập sai mã 5 lần | Báo mã sai; lần thứ 5 mã bị hủy, phải xin mã mới (tối đa 5 mã / giờ, cách nhau 60 giây) | P2 | BE:auth, BE:redis-auth |
| TC-AUTH-03 | Đăng nhập sai mật khẩu | Có tài khoản | Nhập sai mật khẩu | Báo "sai email hoặc mật khẩu" (giống hệt khi email không tồn tại); không có phiên | P1 | E2E:auth, BE:auth |
| TC-AUTH-04 | Khóa đăng nhập sau 5 lần sai | Có tài khoản | Sai mật khẩu 5 lần liên tiếp → thử lại đúng mật khẩu | Bị khóa 15 phút (lần khóa sau gấp đôi, tối đa 24 giờ); email báo bị khóa; đúng mật khẩu cũng bị từ chối trong lúc khóa | P1 | BE:login-lockout |
| TC-AUTH-05 | Quên mật khẩu | Có tài khoản | "Quên mật khẩu?" → mã email → mật khẩu mới | Đăng nhập được bằng mật khẩu mới; mọi thiết bị khác bị đăng xuất; khóa đăng nhập (nếu có) được gỡ | P1 | BE:auth, BE:login-lockout |
| TC-AUTH-06 | Ghi nhớ đăng nhập / đăng xuất | Đã đăng nhập | Đóng trình duyệt, mở lại; rồi bấm "Đăng xuất" | Có "Ghi nhớ" thì vẫn đăng nhập (7 ngày); đăng xuất thì token cũ không dùng được nữa | P2 | E2E:auth, BE:auth |
| TC-AUTH-07 | Khách tự bật 2FA | Đã đăng nhập | Tài khoản → Xác thực hai lớp → quét QR bằng Google Authenticator → nhập mã → lưu 10 mã khôi phục → đăng xuất, đăng nhập lại | Lần sau hỏi mã 6 số sau mật khẩu; mã sai 5 lần thì phải đăng nhập lại | P1 | E2E:two-factor, BE:two-factor |
| TC-AUTH-08 | Đăng nhập bằng mã khôi phục | 2FA đang bật | Ở bước nhập mã, dùng một mã khôi phục | Vào được; mã đó không dùng lại được; số mã còn lại giảm 1 | P2 | E2E:two-factor, BE:two-factor |
| TC-AUTH-09 | Admin bắt buộc 2FA (production) | Server production, admin mới | Đăng nhập lần đầu | Bị buộc thiết lập 2FA trước khi vào trang quản trị | P1 | E2E:two-factor, BE:two-factor, BE-unit:env |
| TC-AUTH-10 | Đồng hồ máy lệch | Điện thoại / máy tính lệch giờ > 1 phút | Nhập mã 2FA | Mã bị từ chối: chỉnh lại giờ tự động của máy (lỗi đã gặp trên máy dev) | P3 | — |

## 4. Tìm và xem sự kiện (CAT)

| Mã | Kịch bản | Tiền điều kiện | Các bước | Kết quả mong đợi | Ưu tiên | Tự động |
|---|---|---|---|---|---|---|
| TC-CAT-01 | Trang chủ | Có sự kiện đang bán | Mở trang chủ | Có sự kiện nổi bật, dải danh mục, lưới "Sắp diễn ra" (ngày, tên, thành phố) | P1 | E2E:booking |
| TC-CAT-02 | Tìm theo từ khóa | — | Gõ một phần tên sự kiện → Tìm | Chỉ hiện sự kiện khớp; dòng "N sự kiện cho …" đúng | P1 | BE:events, BE:catalog |
| TC-CAT-03 | Lọc thành phố và danh mục | — | Nhập thành phố; bấm một danh mục; "Xóa bộ lọc" | Kết quả lọc đúng; bộ lọc nằm trên URL (gửi link cho người khác thấy cùng kết quả); "Xóa bộ lọc" về lại tất cả | P2 | BE:events |
| TC-CAT-04 | Không có kết quả | — | Tìm một từ không có | "Không có sự kiện nào phù hợp" và nút "Xem tất cả sự kiện" | P3 | — |
| TC-CAT-05 | Chi tiết sự kiện | Sự kiện đang bán | Mở sự kiện | Ảnh, tên, thời gian, địa điểm, ban tổ chức, "Giá vé từ …" (giá thấp nhất còn vé của suất đang bán), lịch diễn có giá từng hạng, chính sách hủy | P1 | E2E:booking, E2E:cancel-waitlist |
| TC-CAT-06 | Chi tiết trên điện thoại | Điện thoại | Mở sự kiện, cuộn xuống | Lịch diễn nằm ngay sau thông tin chính; thanh "Chọn suất diễn" cố định ở đáy | P2 | — |
| TC-CAT-07 | Sự kiện chưa đăng / không tồn tại | — | Mở link sự kiện nháp của người khác, hoặc link sai | "Không tìm thấy sự kiện" (không lộ là có tồn tại) | P2 | E2E:permissions, BE:events |

## 5. Chọn chỗ và giữ chỗ (BKG)

| Mã | Kịch bản | Tiền điều kiện | Các bước | Kết quả mong đợi | Ưu tiên | Tự động |
|---|---|---|---|---|---|---|
| TC-BKG-01 | Giữ ghế ngồi và vé đứng | Khách đã đăng nhập | Chọn 2 ghế trên sơ đồ + 1 vé đứng → "Giữ chỗ (10 phút)" | Sang trang đơn: đồng hồ đếm ngược 10:00, đúng 3 vé, tổng tiền đúng | P1 | E2E:booking, BE:orders |
| TC-BKG-02 | Sơ đồ cập nhật trực tiếp | 2 trình duyệt, 2 khách | A giữ một ghế mà B đang xem | Ghế đổi màu ngay trên màn hình B (không tải lại); nếu B đang chọn ghế đó thì bị bỏ ra kèm thông báo | P1 | E2E:booking, BE:websocket |
| TC-BKG-03 | Hai người tranh một ghế | 2 khách | Cùng chọn một ghế và bấm giữ gần như cùng lúc | Đúng 1 người giữ được; người kia báo ghế không còn và chọn lại được | P1 | BE:orders, BE:booking-redis, K6:contention |
| TC-BKG-04 | Giới hạn số vé | — | Chọn hơn 8 vé, hoặc quá giới hạn của một hạng vé | Bị từ chối kèm lý do; không giữ vé nào | P2 | BE:orders |
| TC-BKG-05 | Hết giờ giữ chỗ | Đơn đang giữ | Chờ quá 10 phút (hoặc đổi giờ trong DB khi test) | Đơn báo "Đã hết thời gian giữ chỗ"; ghế trở lại trống cho người khác | P1 | E2E:booking, BE:queue |
| TC-BKG-06 | Đổi / bỏ ghế trong đơn đang giữ | Đơn đang giữ 2 ghế | Từ trang đơn "Đổi / thêm ghế" → đổi 1 ghế; ở trang đơn bỏ 1 ghế | Đơn cập nhật, thời gian giữ không đổi; ghế bỏ ra mở bán lại ngay; người khác thấy thay đổi trực tiếp | P2 | E2E:order-edit, BE:order-edit |
| TC-BKG-07 | Đã có đơn mở ở suất này | Đơn đang giữ | Giữ thêm chỗ ở cùng suất | Báo đã có đơn chưa hoàn tất, có link mở đơn đó | P2 | BE:orders |
| TC-BKG-08 | Ngoài giờ mở bán | Suất chưa mở / đã đóng bán | Mở trang sự kiện | Nhãn "Chưa mở bán" / "Đã đóng bán"; không có nút chọn chỗ | P2 | BE:orders, BE:events |
| TC-BKG-09 | Chọn chỗ trên điện thoại | Điện thoại | Chọn ghế | Hàng ghế cuộn ngang trong khung, trang không tràn; khung "Bạn đã chọn" và nút giữ chỗ dính ở đáy | P2 | — |

## 6. Hàng chờ mua vé (QUE)

| Mã | Kịch bản | Tiền điều kiện | Các bước | Kết quả mong đợi | Ưu tiên | Tự động |
|---|---|---|---|---|---|---|
| TC-QUE-01 | Bật hàng chờ | Ban tổ chức, sự kiện đang bán | Thẻ "Hàng chờ mua vé" → bật, số người = 1 → Lưu | Lưu được (kể cả khi đang bán); hiện "đang mua 0 / 1"; có ghi audit | P1 | E2E:queue, BE:purchase-queue |
| TC-QUE-02 | 2 người vào, 1 người mua, 1 người chờ | Hàng chờ N = 1, 2 khách, 2 trình duyệt | A rồi B mở trang chọn chỗ | A: "Đến lượt bạn mua vé… còn mm:ss"; B: "Bạn đang trong hàng chờ", vị trí 1, "Bạn là người tiếp theo" | P1 | E2E:queue, BE:purchase-queue |
| TC-QUE-03 | Người sau tự được vào | Như TC-QUE-02 | A giữ chỗ và thanh toán | Trang của B (không tải lại) tự hiện sơ đồ ghế trong vài giây; B giữ chỗ được | P1 | E2E:queue, BE:purchase-queue |
| TC-QUE-04 | Chưa tới lượt mà cố giữ chỗ | B đang chờ | Gọi API giữ chỗ trực tiếp (Postman) | 409 `QUEUE_TURN_REQUIRED` | P2 | BE:purchase-queue |
| TC-QUE-05 | Tải lại trang không mất chỗ | B đang chờ ở vị trí 1 | Tải lại trang / đóng mở tab | Vẫn vị trí 1 | P2 | BE:purchase-queue |
| TC-QUE-06 | Rời hàng / hết lượt | Đang chờ / đang có lượt | B bấm "Rời hàng chờ"; hoặc A để hết thời gian lượt mà không giữ chỗ | Người tiếp theo được vào | P2 | BE:purchase-queue |
| TC-QUE-07 | Người mới không chen hàng | A có lượt, B chờ | Lượt của A hết đúng lúc C mới vào | B được vào, C xếp sau B | P2 | BE:purchase-queue |
| TC-QUE-08 | Tắt hàng chờ | Đang có người chờ | Ban tổ chức tắt hàng chờ | Mọi người vào thẳng trang chọn chỗ | P2 | BE:purchase-queue |
| TC-QUE-09 | Đang trả qua VNPay khi đơn quá hạn | Hàng chờ N = 1, A đang ở trang VNPay | Để đơn quá hạn | Lượt của A vẫn giữ tới khi VNPay được hỏi xong; không có 2 người cùng mua (rà soát lỗi BUG-02) | P3 | BE:purchase-queue |
| TC-QUE-10 | Đông người | — | Chạy k6 1.000 người, N = 50 | Không lúc nào quá 50 người đang mua; ai cũng được vào và mua được; 0% lỗi | P2 | K6:queue, BE:purchase-queue (200 người cùng vào) |

## 7. Thanh toán (PAY)

| Mã | Kịch bản | Tiền điều kiện | Các bước | Kết quả mong đợi | Ưu tiên | Tự động |
|---|---|---|---|---|---|---|
| TC-PAY-01 | Mã giảm giá | Đơn đang giữ, có mã của admin | Nhập mã sai → "Áp dụng"; rồi mã đúng | Mã sai: báo lý do (hết hạn, hết lượt…); mã đúng: hiện số tiền giảm, tổng mới | P1 | E2E:booking, BE:payments |
| TC-PAY-02 | Thanh toán giả lập thành công | Đơn đang giữ | "Tiếp tục thanh toán" → "Giả lập thanh toán thành công" | "Thanh toán thành công!"; đơn "Đã thanh toán"; vé có QR xuất hiện; email xác nhận kèm vé PDF | P1 | E2E:booking, BE:payments, BE:ticket-pdf |
| TC-PAY-03 | Thẻ bị từ chối | Đơn chờ thanh toán | "Giả lập thẻ bị từ chối" rồi thanh toán lại | Báo "Thanh toán bị từ chối. Ghế vẫn được giữ"; thanh toán lại được | P1 | E2E:booking, BE:payments |
| TC-PAY-04 | Bấm thanh toán hai lần | Đơn chờ thanh toán | Bấm nhanh 2 lần / mạng chập chờn | Chỉ trừ tiền 1 lần (Idempotency-Key) | P1 | BE:payments |
| TC-PAY-05 | VNPay thành công | VNPay sandbox đã cấu hình | "Thanh toán … qua VNPay" → thẻ NCB test → OTP | Quay về trang đơn **của đúng web đã bắt đầu thanh toán**, vẫn đăng nhập (không bị đăng xuất), đơn đã thanh toán, có vé | P1 | E2E:vnpay, BE:payments-vnpay |
| TC-PAY-06 | Hủy ở trang VNPay | — | Vào VNPay rồi bấm hủy | Trang kết quả: "Thanh toán chưa thành công: Bạn đã hủy giao dịch trên VNPay."; thanh toán lại được | P1 | E2E:vnpay, BE:payments-vnpay |
| TC-PAY-07 | IPN (VNPay gọi server) | Tunnel public tới API, IPN URL đã khai báo ở VNPay | Thanh toán, đóng tab trước khi VNPay chuyển về | Đơn vẫn thành đã thanh toán nhờ IPN; IPN lặp lại không phát vé trùng | P2 | BE:payments-vnpay |
| TC-PAY-08 | Tiền đến muộn | Lượt VNPay đang mở | Đơn hết hạn / bị hủy rồi VNPay mới báo đã trả | Tiền được **hoàn tự động**, email báo khách; ghế không bị bán cho đơn cũ | P2 | BE:payments-vnpay |
| TC-PAY-09 | Đã thu tiền sau khi báo thất bại | Lượt bị ghi thất bại (07) | VNPay báo thành công sau đó | Đơn còn chờ trả → thành đã thanh toán; không thì hoàn tiền (rà soát lỗi BUG-01) | P3 | BE:payments-vnpay |
| TC-PAY-10 | Chữ ký sai / số tiền sai | — | Gửi IPN giả (`npm run vnpay:ipn` sửa tham số) | Bị từ chối (97 / 04); đơn không đổi | P2 | BE:payments-vnpay, BE-unit:vnpay |
| TC-PAY-11 | Đơn 0 đồng | Mã giảm 100% | Áp mã → "Tiếp tục thanh toán" | Đơn thành đã thanh toán ngay, có vé, không qua cổng thanh toán | P3 | BE:payments |

## 8. Hủy đơn và hoàn tiền (REF)

| Mã | Kịch bản | Tiền điều kiện | Các bước | Kết quả mong đợi | Ưu tiên | Tự động |
|---|---|---|---|---|---|---|
| TC-REF-01 | Khách hủy theo chính sách Tiêu chuẩn | Sự kiện chính sách "Tiêu chuẩn", còn ≥ 7 ngày | Trang đơn → xem số được hoàn → xác nhận hủy | Hoàn 80% (từ 3 đến 7 ngày: 50%, dưới 3 ngày: không hủy được); phần còn lại là phí; vé hết hiệu lực; mục Hoàn tiền "Đã hoàn" | P1 | E2E:cancel-waitlist, BE:cancellation, BE-unit:refund-policy |
| TC-REF-02 | Chính sách Linh hoạt / Không hoàn | — | Như trên với 2 chính sách còn lại | Linh hoạt: ≥ 48 giờ 100%, ≥ 24 giờ 50%; Không hoàn: không có nút hủy | P2 | BE:cancellation, BE-unit:refund-policy |
| TC-REF-03 | Mốc hoàn tiền đổi trong lúc xem | Đang xem số được hoàn, mốc vừa qua | Bấm hủy | Không hủy; báo điều kiện đã đổi kèm số tiền mới | P3 | BE:cancellation |
| TC-REF-04 | Đã vào cổng thì không hủy được | Vé đã quét | Xem trang đơn | Không cho hủy, ghi lý do | P2 | BE:cancellation |
| TC-REF-05 | Admin hoàn tiền | Đơn đã thanh toán | Admin → Đơn hàng → "Hoàn tiền" | Vé hết hiệu lực; báo cáo doanh thu ban tổ chức chuyển sang mục hoàn tiền; có audit | P1 | E2E:refund-report, BE:payments |
| TC-REF-06 | Hủy cả sự kiện | Sự kiện có đơn đã trả và đơn đang giữ | Ban tổ chức "Hủy sự kiện" (nhập lý do) | Đơn đang giữ bị hủy, đơn đã trả được hoàn hết; khách nhận email | P2 | BE:events, BE:payments-vnpay |
| TC-REF-07 | VNPay từ chối hoàn | — | (Test tự động mô phỏng) | Hoàn tiền "Thất bại", admin gửi lại được | P3 | BE:payments-vnpay |

## 9. Danh sách chờ khi hết vé (WTL)

| Mã | Kịch bản | Tiền điều kiện | Các bước | Kết quả mong đợi | Ưu tiên | Tự động |
|---|---|---|---|---|---|---|
| TC-WTL-01 | Vào danh sách chờ | Một hạng vé đã hết | "Báo tôi khi có vé" | "Đã vào danh sách chờ, bạn đứng thứ N"; có ở trang "Danh sách chờ" | P2 | E2E:cancel-waitlist, BE:waitlist |
| TC-WTL-02 | Được mời khi có vé trả lại | Như trên | Người khác hủy / hết hạn đơn | Người chờ sớm nhất nhận email + thông báo; vé được giữ riêng 30 phút; đặt được từ lời mời | P2 | E2E:cancel-waitlist, BE:waitlist |
| TC-WTL-03 | Người khác không lấy được vé đang dành | Đang có lời mời | Khách khác cố giữ đúng số vé đó | Bị từ chối "đang được giữ cho người trong danh sách chờ" | P2 | BE:waitlist |
| TC-WTL-04 | Lời mời hết hạn | Có lời mời | Không đặt trong 30 phút | Vé chuyển cho người chờ tiếp theo | P3 | BE:waitlist |

## 10. Vé, mã QR, vé PDF (TKT)

| Mã | Kịch bản | Tiền điều kiện | Các bước | Kết quả mong đợi | Ưu tiên | Tự động |
|---|---|---|---|---|---|---|
| TC-TKT-01 | Xem vé và mã QR | Có vé | "Vé của tôi" → mở một vé | Vé dạng cuống vé: sự kiện, giờ, chỗ, trạng thái "Còn hiệu lực", mã QR, mã vé | P1 | E2E:booking |
| TC-TKT-02 | Tải vé PDF | Có vé | "Tải vé PDF" ở trang đơn (cả đơn) và trang vé (một vé) | File `Ve-<mã>.pdf`, mỗi vé một trang, tiếng Việt có dấu, mã QR quét được | P1 | E2E:ticket-pdf, BE:ticket-pdf |
| TC-TKT-03 | Email xác nhận kèm PDF | Vừa thanh toán | Mở email | Có file PDF đính kèm | P1 | BE:ticket-pdf |
| TC-TKT-04 | Cấp lại mã QR | Admin, vé còn hiệu lực | Admin cấp lại QR → quét mã cũ | Mã cũ bị từ chối; khách nhận email kèm PDF mới | P2 | BE:admin, BE:ticket-pdf |
| TC-TKT-05 | Không xem được vé người khác | 2 khách | Mở link vé / PDF của người khác | 404 | P2 | BE:ticket-pdf, BE:checkins |
| TC-TKT-06 | Nhắc lịch | Có vé, suất sắp diễn | (Chờ hoặc test tự động) | Email nhắc 24 giờ và 2 giờ trước giờ diễn, mỗi lần đúng một email; tắt được trong tài khoản | P3 | BE:reminders |

## 11. Soát vé ở cổng (CHK)

| Mã | Kịch bản | Tiền điều kiện | Các bước | Kết quả mong đợi | Ưu tiên | Tự động |
|---|---|---|---|---|---|---|
| TC-CHK-01 | Gán nhân viên soát vé | Ban tổ chức, tài khoản nhân viên | Tab "Nhân viên soát vé" → thêm email | Nhân viên thấy sự kiện ở trang "Soát vé" (chưa gán thì không thấy) | P1 | BE:checkins |
| TC-CHK-02 | Quét vé hợp lệ bằng điện thoại | Cổng đã mở (từ 3 giờ trước giờ diễn), HTTPS hoặc localhost | Mở trang quét → camera → quét QR | Màn hình xanh "Mời vào", số đã vào tăng ở mọi máy quét | P1 | E2E:staff.mobile, BE:checkins, WEB:scanResult |
| TC-CHK-03 | Quét lại vé đã vào | Vé vừa quét | Quét lại | Màn hình đỏ: đã vào lúc nào, ở cổng nào | P1 | E2E:staff.mobile, BE:checkins |
| TC-CHK-04 | Hai cổng quét cùng lúc | 2 máy | Quét cùng một vé cùng lúc | Đúng 1 lần vào | P2 | BE:checkins |
| TC-CHK-05 | Sai suất / vé đã hoàn / chưa mở cổng | — | Quét vé suất khác, vé đã hoàn, hoặc trước giờ mở cổng | Từ chối kèm lý do rõ | P2 | BE:checkins |
| TC-CHK-06 | Lịch sử soát vé | Đã quét vài vé | Mở lịch sử | Danh sách lượt vào, đúng cổng và giờ | P3 | E2E:staff.mobile |

## 12. Đánh giá sự kiện (REV)

| Mã | Kịch bản | Tiền điều kiện | Các bước | Kết quả mong đợi | Ưu tiên | Tự động |
|---|---|---|---|---|---|---|
| TC-REV-01 | Chỉ người đã vào cổng mới đánh giá | Vé đã quét | "Vé của tôi" → "Đánh giá sự kiện" → chấm sao, viết | Đánh giá hiện với nhãn "Đã đi xem"; điểm trung bình cập nhật | P2 | E2E:reviews, BE:reviews |
| TC-REV-02 | Chưa đi xem thì không đánh giá được | Chưa có vé đã quét | Thử đánh giá | Không có ô viết / API từ chối | P2 | BE:reviews |
| TC-REV-03 | Ban tổ chức trả lời, admin ẩn | Có đánh giá | Ban tổ chức trả lời; admin ẩn kèm lý do | Trả lời hiện công khai; bị ẩn thì điểm trung bình đổi, người viết thấy lý do | P2 | E2E:reviews, BE:reviews |
| TC-REV-04 | Hết hạn sửa | Quá 60 ngày sau suất diễn | Sửa đánh giá | Bị từ chối | P3 | BE:reviews |

## 13. Ban tổ chức (ORG)

| Mã | Kịch bản | Tiền điều kiện | Các bước | Kết quả mong đợi | Ưu tiên | Tự động |
|---|---|---|---|---|---|---|
| TC-ORG-01 | Đăng ký làm ban tổ chức | Khách | "Trở thành ban tổ chức" → admin duyệt | Có menu "Ban tổ chức" sau khi được duyệt | P1 | BE:organizers |
| TC-ORG-02 | Tạo sự kiện | Ban tổ chức | Tạo sự kiện (tên, mô tả, danh mục, ảnh) | Sự kiện nháp | P1 | E2E:organizer, BE:events |
| TC-ORG-03 | Ảnh sự kiện: xem trước và căn chỉnh | Đang sửa sự kiện | "Tải ảnh từ máy" → kéo / thu phóng → "Hiện trọn ảnh" → "Dùng ảnh này" → "Lưu thông tin" | Thẻ xem trước giống kết quả; ảnh lưu 1600 × 900; "Căn chỉnh lại" làm được với ảnh đã tải | P2 | WEB:imageCrop, BE:uploads |
| TC-ORG-04 | Tải file không phải ảnh | — | Đổi tên file .html thành .png rồi tải | Bị từ chối | P2 | BE:uploads |
| TC-ORG-05 | Buổi diễn, hạng vé theo khu | Sự kiện nháp | Tab "Buổi diễn & vé": lưu buổi diễn (địa điểm, ngày, giờ 24 giờ); lưu tổng số người tham dự; gán hạng cho từng khu có sẵn (khu ngồi: toàn bộ ghế; khu đứng: số vé) | Danh sách kiểm tra "sẵn sàng gửi duyệt" ở đầu trang không còn mục đỏ | P1 | E2E:organizer, BE:inventory, WEB:readiness, WEB:allocation |
| TC-ORG-06 | Gửi duyệt → admin duyệt → mở bán | Đủ điều kiện | "Gửi duyệt"; admin "Duyệt và mở bán" | Sự kiện xuất hiện công khai, chọn chỗ được | P1 | E2E:organizer, BE:events |
| TC-ORG-07 | Sửa khi đang bán | Sự kiện đang bán | Sửa mô tả / ảnh / chính sách hủy / hàng chờ | Lưu được, kể cả sự kiện không có danh mục; tên, giờ, danh mục bị khóa; "Có thay đổi chưa lưu" khi chưa lưu | P2 | BE:events |
| TC-ORG-08 | Báo cáo bán hàng | Có đơn | Tab "Doanh thu" | Số vé, doanh thu, hoàn tiền, phí hủy đúng | P2 | E2E:refund-report, BE:reports, WEB:reports |
| TC-ORG-09 | Xóa sự kiện | Sự kiện có đơn | "Xóa" → gõ lại đúng tên | Chỉ xóa khi gõ đúng tên; có audit | P3 | BE:event-deletion |
| TC-ORG-10 | Đề xuất địa điểm mới | — | Đề xuất địa điểm khi tạo suất | Admin duyệt sự kiện thì địa điểm được duyệt theo | P3 | BE:venue-proposals |
| TC-ORG-11 | Nghệ sĩ khách mời | Sự kiện nháp hoặc đang bán | Thẻ "Nghệ sĩ khách mời": "+ Thêm nghệ sĩ", nhập tên, xóa một ô; "Lưu danh sách nghệ sĩ" | Trang sự kiện có mục "Nghệ sĩ khách mời" (các thẻ tên, đúng thứ tự nhập, tên trùng chỉ một lần); không sửa được khi đang chờ duyệt | P2 | E2E:lineup, BE:event-lineup, WEB:lineup |
| TC-ORG-12 | Địa điểm chưa có ghế | Suất ở địa điểm có khu ngồi nhưng chưa "Sinh ghế" | Mở thẻ "Suất diễn & vé" | Báo rõ địa điểm chưa có ghế và cách xử lý; địa điểm mình đề xuất thì thêm ghế ngay tại chỗ; hạng "Ghế ngồi" không chọn được; **vé đứng bắt buộc chọn khu đứng** (không còn "không gắn khu"; địa điểm chưa có khu đứng thì không thêm được vé đứng, API cũng từ chối); "Xong, dùng địa điểm này" chỉ bấm được khi địa điểm đã có ghế hoặc khu đứng | P2 | E2E:event-setup, WEB:setup, WEB:readiness |
| TC-ORG-13 | Nút bị khóa nói lý do; giờ 24 giờ | Đang tạo sự kiện / suất | Bỏ trống danh mục; gõ giờ `25`, rồi `1930` | "Còn thiếu: …" cạnh nút; giờ sai báo "Giờ theo 24 giờ…", `1930` thành `19:30` | P2 | E2E:event-setup, WEB:missing, WEB:dateTimeParts |
| TC-ORG-14 | Một sự kiện, một buổi diễn | Sự kiện đã có buổi diễn | Tìm cách thêm buổi thứ hai; gọi API thêm suất | Không có nút thêm; API trả 422 `EVENT_HAS_SCHEDULE`; muốn đổi ngày thì sửa ngày giờ của buổi diễn | P2 | BE:events, E2E:event-setup |
| TC-ORG-15 | Tổng người tham dự → gán hạng cho các khu có sẵn | Buổi diễn đã có | Tổng (mặc định = sức chứa địa điểm); ở bảng "Hạng vé theo khu": gán hạng + giá cho khu ngồi ("Gán N ghế") và khu đứng (số vé ≤ sức chứa khu); "Bỏ gán" | Khu ngồi nhận toàn bộ ghế trống của khu, bảng ghi "Khu A: hàng A–E"; "Đã xếp X / Y · còn lại Z"; vượt tổng hoặc vượt chỗ của khu bị báo ngay, API trả 422 `CAPACITY_EXCEEDED` | P1 | E2E:organizer, E2E:event-setup, BE:schedule-capacity, WEB:allocation |

## 14. Quản trị (ADM)

| Mã | Kịch bản | Tiền điều kiện | Các bước | Kết quả mong đợi | Ưu tiên | Tự động |
|---|---|---|---|---|---|---|
| TC-ADM-01 | Khóa tài khoản | Admin | Người dùng → khóa một khách | Khách bị đăng xuất ngay mọi nơi, không đăng nhập lại được | P1 | BE:admin |
| TC-ADM-02 | Đổi vai trò | Admin | Gán / gỡ vai trò | Có hiệu lực ngay (phiên cũ bị thu hồi); không gỡ được admin cuối cùng | P2 | BE:admin, BE:rbac |
| TC-ADM-03 | Mở khóa đăng nhập, đặt lại 2FA | Tài khoản đang bị khóa / mất điện thoại | Admin mở khóa; đặt lại 2FA | Đăng nhập lại được; có audit | P2 | BE:login-lockout, BE:two-factor |
| TC-ADM-04 | Danh mục, địa điểm, sơ đồ ghế | Admin | Tạo / sửa danh mục, địa điểm, khu, ghế | Hiện đúng ở form ban tổ chức | P2 | BE:catalog, BE:inventory |
| TC-ADM-05 | Mã giảm giá | Admin | Tạo mã % và mã số tiền, giới hạn lượt | Áp dụng đúng (TC-PAY-01); hết lượt thì báo | P2 | BE:payments |
| TC-ADM-06 | Nhật ký (audit) và báo cáo | Admin | Mở Nhật ký, Báo cáo | Có các hành động quan trọng (duyệt, hoàn tiền, đổi cấu hình hàng chờ…); số liệu báo cáo khớp | P3 | BE:reports, BE:admin |
| TC-ADM-07 | Sức chứa địa điểm là giới hạn | Địa điểm có sức chứa | Thêm khu đứng / sinh ghế vượt sức chứa; hạ sức chứa dưới tổng các khu; ban tổ chức nhập tổng người tham dự lớn hơn sức chứa | Dòng "Các khu: X chỗ / sức chứa Y · còn thêm được Z"; vượt thì bị từ chối kèm số liệu (422 `VENUE_CAPACITY_EXCEEDED`) | P2 | E2E:venue-capacity, BE:venue-capacity, WEB:venueCapacity |

## 15. Phân quyền và bảo mật (SEC)

| Mã | Kịch bản | Tiền điều kiện | Các bước | Kết quả mong đợi | Ưu tiên | Tự động |
|---|---|---|---|---|---|---|
| TC-SEC-01 | Khách vào trang quản trị | Khách | Mở `/admin` | Không có menu quản trị; trang báo không có quyền | P1 | E2E:permissions, BE:rbac, WEB:permissions |
| TC-SEC-02 | Ban tổ chức mở sự kiện người khác | Ban tổ chức | Mở link sửa sự kiện của ban tổ chức khác | 404 | P1 | E2E:permissions, BE:events |
| TC-SEC-03 | Chưa đăng nhập | — | Mở "Vé của tôi" | Chuyển tới đăng nhập, xong quay lại đúng trang | P2 | E2E:permissions |
| TC-SEC-04 | Giới hạn tần suất | — | Gửi liên tục quá giới hạn (đăng nhập 5 / phút, giữ chỗ 10 / phút…) | 429, có `Retry-After` | P2 | BE:auth |
| TC-SEC-05 | Token bị đánh cắp dùng lại | — | Dùng lại refresh token cũ | Cả phiên bị thu hồi | P2 | BE:auth |
| TC-SEC-06 | Cấu hình production | Server | Khởi động với `TWO_FACTOR_REQUIRED_ROLES=NONE` | Từ chối khởi động (trừ khi ghi rõ `ALLOW_ADMIN_WITHOUT_2FA=true`) | P3 | BE-unit:env |

## 16. Giao diện, trải nghiệm (UI)

| Mã | Kịch bản | Tiền điều kiện | Các bước | Kết quả mong đợi | Ưu tiên | Tự động |
|---|---|---|---|---|---|---|
| TC-UI-01 | Điện thoại 375px | Điện thoại / DevTools | Đi hết luồng mua vé | Không trang nào tràn ngang; nút dễ bấm; menu mở bằng nút biểu tượng menu, đóng khi chuyển trang / bấm ra ngoài / Esc | P1 | — |
| TC-UI-02 | Dùng bằng bàn phím | Máy tính | Tab qua trang chủ, chọn chỗ, form đăng nhập | Thấy rõ vòng focus; "Bỏ qua menu" ở đầu trang; chọn ghế bằng phím được | P3 | — |
| TC-UI-03 | Giảm chuyển động | Bật "Reduce motion" trong hệ điều hành | Mở trang chủ | Không còn hiệu ứng chuyển động; nội dung hiện ngay | P3 | — |
| TC-UI-04 | Mất mạng / máy chủ chậm | — | Tắt mạng rồi bấm một nút; hoặc API treo | "Không kết nối được máy chủ…"; quá 30 giây: "Máy chủ phản hồi quá lâu…"; không quay mãi | P2 | WEB:client |
| TC-UI-05 | Giờ hiển thị | Máy để múi giờ khác | Xem giờ diễn, đồng hồ giữ chỗ | Luôn là giờ Việt Nam; đồng hồ theo giờ server | P3 | WEB:format, WEB:vnTime, WEB:serverClock |
| TC-UI-06 | Hiện / ẩn mật khẩu | Form đăng nhập | Bấm biểu tượng con mắt | Hiện / ẩn mật khẩu, không gửi form | P3 | — |

## 17. Tải và đồng thời (LOAD)

| Mã | Kịch bản | Tiền điều kiện | Các bước | Kết quả mong đợi | Ưu tiên | Tự động |
|---|---|---|---|---|---|---|
| TC-LOAD-01 | 100 người giữ 1 ghế | — | Test tự động | Đúng 1 người được (kể cả khi tắt Redis) | P1 | BE:booking-redis, BE:orders |
| TC-LOAD-02 | Số người dùng cùng lúc cấu hình được | Stack load test | `k6 run -e VUS=… -e SHAPE=…` cho 5 kịch bản | Đạt ngưỡng ghi trong `docs/testing.md`; 0% lỗi | P2 | K6:browse, K6:seatmap, K6:contention, K6:mixed, K6:queue |
| TC-LOAD-03 | Dữ liệu sau khi chạy tải | Sau mọi lần chạy k6 | `node loadtest/verify.mjs` | Không ghế nào bán hai lần, tồn kho khớp, vé phát đủ, hàng chờ không vượt N | P1 | `loadtest/verify.mjs` |

---

## 18. Checklist nhanh trước khi demo (khoảng 20 phút)

Chạy đúng thứ tự, mỗi dòng là một test case P1 ở trên:

1. `docker compose up -d --build`; mở http://localhost:8080 trên máy tính và điện thoại.
2. TC-AUTH-01: đăng ký khách bằng email thật, nhận mã.
3. TC-CAT-01, TC-CAT-05: trang chủ, chi tiết sự kiện, "Giá vé từ".
4. TC-BKG-01, TC-BKG-02: giữ 2 ghế + 1 vé đứng; trình duyệt thứ hai thấy ghế đổi màu.
5. TC-PAY-01, TC-PAY-02: mã giảm giá, thanh toán giả lập; nhận email có PDF (TC-TKT-03).
6. TC-TKT-01, TC-TKT-02: xem QR, tải PDF.
7. TC-CHK-02, TC-CHK-03: điện thoại quét vé: xanh rồi đỏ.
8. TC-QUE-02, TC-QUE-03: bật hàng chờ N = 1, hai người, người sau tự vào.
9. TC-REF-01: hủy đơn theo chính sách, thấy hoàn tiền.
10. TC-SEC-01: tài khoản khách không vào được trang quản trị.

Toàn bộ test tự động (trước khi bàn giao):

```
cd backend && npm run test:coverage
cd frontend && npm run lint && npm run typecheck && npm test && npm run build
cd e2e && npm test
```

## 19. Tổng hợp độ phủ

| Nhóm | Số test case | Có test tự động | Chỉ test tay |
|---|---|---|---|
| AUTH | 10 | 9 | 1 |
| CAT | 7 | 5 | 2 |
| BKG | 9 | 8 | 1 |
| QUE | 10 | 10 | 0 |
| PAY | 11 | 11 | 0 |
| REF | 7 | 7 | 0 |
| WTL | 4 | 4 | 0 |
| TKT | 6 | 6 | 0 |
| CHK | 6 | 6 | 0 |
| REV | 4 | 4 | 0 |
| ORG | 15 | 15 | 0 |
| ADM | 7 | 7 | 0 |
| SEC | 6 | 6 | 0 |
| UI | 6 | 2 | 4 |
| LOAD | 3 | 3 | 0 |
| **Tổng** | **111** | **103** | **8** |

Test tự động hiện có: backend 418 test, web 125 test, E2E 27 kịch bản, k6 5 kịch bản (chi tiết `docs/testing.md`). Những ca "chỉ test tay" cần thiết bị hoặc dịch vụ thật (điện thoại, đồng hồ máy, cài đặt hệ điều hành) hoặc là cảm nhận giao diện.
