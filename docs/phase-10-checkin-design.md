# Phase 10 — Vé của tôi, mã QR, check-in (đã duyệt, đã triển khai)

> Mục tiêu: khách mở "Vé của tôi", đưa **mã QR** ở cổng; nhân viên quét, server kiểm tra rồi cho vào. **Một vé chỉ vào được một lần**, kể cả khi hai cổng quét cùng lúc. Ban tổ chức thấy số người đã vào theo thời gian thực.
>
> Sau phase này, luồng chính hoàn chỉnh: tìm sự kiện → chọn ghế → thanh toán → nhận vé → **vào cổng**. Đủ API cho app React Native (Phase 11).

---

## 1. Phạm vi (theo file chức năng)

| Mã | Chức năng | API |
|---|---|---|
| TKT-01 | Vé của tôi | `GET /tickets` |
| TKT-02 | Hiển thị mã QR (chữ ký HMAC, không chứa thông tin cá nhân) | `GET /tickets/:id` (kèm nội dung QR), `GET /tickets/:id/qr.png` |
| CHK-01 | Quét QR check-in: kiểm tra chữ ký, suất diễn, trạng thái vé → `USED` | `POST /check-ins` |
| CHK-02 | Lịch sử check-in của một suất | `GET /schedules/:id/check-ins` |
| CHK-03 | Thống kê đã vào / tổng số vé, cập nhật real-time | `GET /schedules/:id/check-in-stats` + tin `CHECK_IN_SUCCESS` |
| TEST-02 (phần còn lại) | **2 nhân viên quét cùng một vé cùng lúc → đúng 1 thành công** | |
| (cần cho CHK-01) | Organizer gán nhân viên cho sự kiện của mình (quyền `staff:assign:own` đã có từ Phase 1) | `POST/GET/DELETE /events/:id/staff`, `GET /staff/events` |

**Không làm**: cấp lại QR (TKT-03, Phase 12; cột `qr_version` đã có sẵn), quét khi mất mạng (app lưu tạm rồi gửi sau), app quét (Phase 11).

---

## 2. Mã QR

Đã chốt ở Phase 9: nội dung QR = `"<id vé>.<qr_version>.<HMAC-SHA256(QR_SECRET, id vé.qr_version)>"`.
- **Không có thông tin cá nhân**: chỉ có id vé. Nhặt được ảnh QR cũng không biết vé của ai.
- **Không làm giả được**: sửa một ký tự thì chữ ký sai. Không có `QR_SECRET` thì không tạo được QR hợp lệ.
- **Không cần lưu**: server tính lại được bất cứ lúc nào. DB chỉ có `qr_token_hash` để đối chiếu lúc quét (cột đã có, unique).
- `GET /tickets/:id` (chỉ chủ vé) trả `qrToken` để app tự vẽ QR. `GET /tickets/:id/qr.png` trả sẵn ảnh PNG (cho email, trang web đơn giản). Vé không còn hiệu lực (`REFUNDED`, `CANCELLED`) thì **không trả QR** (`qrToken: null`, ảnh PNG → `409 TICKET_NOT_VALID`).
- Cả hai trả header `Cache-Control: no-store`: nội dung QR là "chìa khóa" vào cổng, không để trình duyệt / proxy lưu lại.
- Người khác xem vé của mình → `404` (không xác nhận vé có tồn tại).

---

## 3. Check-in (CHK-01)

`POST /check-ins` (quyền `checkin:create`), body `{ "qrToken": "...", "scheduleId": "<suất nhân viên đang trực>", "deviceId": "cổng-A-01" }`:

```
1. Tách QR, kiểm tra chữ ký (so sánh an toàn về thời gian) → sai: 422 QR_INVALID
2. Khóa dòng vé FOR UPDATE (theo id trong QR); băm QR phải khớp qr_token_hash
   (khớp đúng phiên bản hiện tại: QR cũ sau khi "cấp lại" bị từ chối)    → không khớp: 422 QR_INVALID
3. Nhân viên phải được gán cho sự kiện của vé (event_staff) hoặc là admin  → 403 FORBIDDEN
4. Vé phải thuộc suất đang trực                                          → 422 WRONG_SCHEDULE (kèm tên suất đúng)
5. Suất đang trong giờ check-in (từ 3 giờ trước giờ diễn tới khi kết thúc) → 422 CHECKIN_NOT_OPEN / CHECKIN_CLOSED
6. Trạng thái vé:
     USED              → 409 TICKET_ALREADY_USED (kèm giờ vào, cổng, nhân viên đã quét)
     REFUNDED/CANCELLED → 409 TICKET_NOT_VALID
     VALID             → INSERT check_ins + UPDATE tickets SET status = 'USED' WHERE status = 'VALID'
7. Sau commit: đếm lại số đã vào (thấy cả lượt quét vừa xong ở cổng khác), trả trong response
   và gửi CHECK_IN_SUCCESS tới nhân viên và ban tổ chức của sự kiện
```
- **Hai cổng quét cùng một vé cùng lúc**: request thứ hai chờ khóa dòng vé, rồi thấy vé đã `USED` → `409 TICKET_ALREADY_USED`. Lớp chặn cuối ở DB: `check_ins.UNIQUE(ticket_id)` (có từ Phase 1).
- Response thành công cho nhân viên đủ để đối chiếu: hạng vé, ghế (hoặc "vé đứng #2"), mã vé. **Không** trả tên, email, số điện thoại người mua.

---

## 4. Lịch sử và thống kê (CHK-02, CHK-03)

- `GET /schedules/:id/check-ins`: mới nhất trước, phân trang: mã vé, hạng vé, ghế, giờ vào, cổng, nhân viên quét.
- `GET /schedules/:id/check-in-stats`: `{ total, checkedIn, byTicketType: [{ ticketTypeName, total, checkedIn }] }` (`total` = vé còn hiệu lực + đã dùng).
- Ai xem được: nhân viên được gán, organizer chủ sự kiện, admin.
- **Real-time**: mỗi lần check-in thành công, tin `CHECK_IN_SUCCESS` (số đã vào / tổng) được gửi vào room cá nhân `user:{id}` (WebSocket Phase 7) của các nhân viên được gán và của organizer. Không tạo room công khai mới: số người đã vào là dữ liệu nội bộ.

---

## 5. Gán nhân viên cho sự kiện

| API | Quyền | Mô tả |
|---|---|---|
| `POST /events/:id/staff` | organizer chủ sự kiện (`staff:assign:own`) hoặc admin | Body `{ email }`. Người đó phải có tài khoản `ACTIVE`. **Tự được cấp role `STAFF`** nếu chưa có (đăng nhập lại hoặc refresh token để nhận quyền), có audit |
| `GET /events/:id/staff` | như trên | Danh sách nhân viên của sự kiện |
| `DELETE /events/:id/staff/:userId` | như trên | Gỡ khỏi sự kiện (giữ role `STAFF`, vì có thể đang trực sự kiện khác) |
| `GET /staff/events` | nhân viên | Các sự kiện mình được gán, kèm suất sắp / đang diễn (màn "Chọn sự kiện" của app staff, APP-S01) |

Role `STAFF` chỉ mở được API check-in; **quét vé của sự kiện nào phải được gán vào sự kiện đó** (`event_staff`). Admin quét được mọi sự kiện.

---

## 6. Thay đổi nhỏ khác

- **Không hoàn tiền đơn đã có vé check-in** (khách đã vào xem): `POST /payments/:id/refund` → `409 PAYMENT_NOT_REFUNDABLE`. Hủy cả sự kiện thì vẫn hoàn tiền tất cả (câu hỏi 6).
- **Không cần migration**: `event_staff`, `check_ins`, `tickets.used_at`, index `tickets (schedule_id, status)` đã có từ Phase 1.
- Thêm thư viện `qrcode` (sinh ảnh PNG).
- Mã lỗi mới: `QR_INVALID`, `WRONG_SCHEDULE`, `CHECKIN_NOT_OPEN`, `CHECKIN_CLOSED` (422), `TICKET_ALREADY_USED`, `TICKET_NOT_VALID` (409), `STAFF_USER_NOT_FOUND` (422).

---

## 7. Kiểm thử bắt buộc

- **2 nhân viên quét cùng một vé cùng lúc → đúng 1 thành công**, người kia nhận `TICKET_ALREADY_USED` (TEST-02).
- QR bị sửa 1 ký tự / tự tạo không có khóa → `QR_INVALID`; QR của phiên bản cũ (tăng `qr_version`) → `QR_INVALID`.
- Vé của suất khác, nhân viên chưa được gán, ngoài giờ check-in, vé đã hoàn tiền → đúng mã lỗi; không có dòng `check_ins` nào được ghi.
- Vé của tôi: chỉ thấy vé của mình; QR / ảnh PNG chỉ chủ vé xem được; vé đã hoàn tiền không có QR.
- Thống kê đúng sau mỗi lần quét; nhân viên và organizer nhận `CHECK_IN_SUCCESS`, khách hàng thì không.
- Gán nhân viên: organizer khác không gán được vào sự kiện không phải của mình; người được gán có role `STAFF`.
- Đơn có vé đã check-in thì không hoàn tiền được.
- Toàn bộ test cũ vẫn pass.

---

## 8. Ước lượng

| Hạng mục | Giờ |
|---|---|
| Vé của tôi + chi tiết + ảnh QR (TKT-01, TKT-02) | 5 |
| Gán nhân viên + danh sách sự kiện của nhân viên | 4 |
| Check-in: kiểm tra QR, khóa dòng, các trường hợp lỗi (CHK-01) | 7 |
| Lịch sử + thống kê + tin real-time (CHK-02, CHK-03) | 4 |
| Test (gồm 2 cổng quét cùng lúc) | 5 |
| Postman + tài liệu | 2 |
| **Tổng** | **≈ 27 giờ** (file: Phase 10 = 21h, chưa tính phần gán nhân viên) |

---

## 9. Cần quyết định khi review

1. **QR**: API trả nội dung QR cho app tự vẽ, kèm thêm endpoint ảnh PNG (thêm thư viện `qrcode`). Đồng ý?
2. **Giờ check-in**: từ **3 giờ trước giờ diễn** tới khi suất kết thúc. Đồng ý?
3. **Quét lỗi trả mã lỗi HTTP** (409 / 422 kèm lý do, ví dụ "đã vào lúc 19:05 ở cổng A"), giống phần còn lại của API. Đồng ý?
4. **Organizer gán nhân viên bằng email**, người đó **tự được cấp role `STAFF`**; nhân viên chỉ quét được sự kiện mình được gán (admin quét được tất cả). Đồng ý?
5. **Thống kê real-time** gửi vào room cá nhân của nhân viên và organizer, không tạo room công khai. Đồng ý?
6. **Không cho hoàn tiền đơn đã có vé check-in**; hủy cả sự kiện thì vẫn hoàn tiền hết. Đồng ý?

Đã duyệt cả 6 điểm.

---

## 10. Ghi chú triển khai

- **File mới**: `modules/tickets/tickets.{schemas,controller,routes}.js`, `modules/checkins/*`, `modules/events/staff.{repository,service,schemas,controller}.js`. Không có migration.
- **QR** (`tickets/qr.js` → `parseQrToken`): kiểm tra dạng `<uuid>.<số>.<64 hex>` rồi so chữ ký bằng `timingSafeEqual`. Lúc quét còn so băm của QR với `qr_token_hash`, nên QR của phiên bản cũ bị từ chối dù chữ ký đúng.
- **Khóa**: check-in chỉ khóa dòng vé (`FOR UPDATE OF t`). Hoàn tiền theo yêu cầu khóa đơn rồi khóa **các vé của đơn** trước khi kiểm tra `USED`. Một cổng quét đúng lúc admin hoàn tiền thì một trong hai chờ bên kia: hoặc vé vào được và đơn không hoàn được, hoặc đơn hoàn xong và vé `TICKET_NOT_VALID`.
- **Hủy sự kiện** sau khi đã có người vào: đơn vẫn `REFUNDED`, vé đã dùng giữ `USED` (lịch sử đúng sự thật), các vé còn lại `REFUNDED`.
- **Thống kê real-time**: đếm sau COMMIT. Nếu bước này lỗi, lượt check-in vẫn được lưu, chỉ mất tin cập nhật (`stats: null` trong response).
- **Gán nhân viên**: role `STAFF` có hiệu lực ở **access token tiếp theo** (refresh hoặc đăng nhập lại). Không gán được vào sự kiện `CANCELLED` / `FINISHED`.
- **Sửa thêm**: `orders.service.loadOrder` chạy 3 câu truy vấn bằng `Promise.all` trên cùng một connection của transaction (pg báo deprecated, pg@9 sẽ bỏ). Đã chuyển sang chạy lần lượt.
- **Kiểm thử**: `tests/integration/checkins.test.js` (16 test, gồm 10 lượt quét song song cùng một vé). Toàn bộ: 212 test pass.
- **Postman**: `postman/etp-checkin.postman_collection.json` (43 request). Bước 5 gán chính tài khoản organizer làm nhân viên để demo, nên tài khoản đó có thêm role `STAFF`.
