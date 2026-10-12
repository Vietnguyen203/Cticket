# Phase 9 — Hàng đợi BullMQ, worker, phát hành vé, email (đã duyệt, đã triển khai)

> Mục tiêu: những việc **không cần làm ngay trong request** (gửi email, phát hành vé, hết hạn đơn, thông báo) chuyển sang một **tiến trình worker** riêng, chạy qua hàng đợi có thử lại. API trả lời nhanh hơn, và một lỗi tạm thời (SMTP chập chờn, Redis khởi động lại) không làm mất việc.
>
> Nguyên tắc: **job phải chạy lại được nhiều lần mà kết quả không đổi** (idempotent). Hàng đợi có thể chạy một job 2 lần (worker chết giữa chừng, thử lại sau lỗi), nên dữ liệu được bảo vệ bằng unique / compare-and-set trong PostgreSQL, giống mọi phase trước.

---

## 1. Phạm vi (theo file chức năng)

| Mã | Chức năng | Hàng đợi |
|---|---|---|
| Q-01 | Phát hành vé sau khi thanh toán: mỗi ghế 1 vé, vé đứng N vé | `tickets` |
| Q-02 | Gửi email: OTP, xác nhận đơn kèm vé, hoàn tiền; thử lại với thời gian chờ tăng dần | `emails` |
| Q-03 | Hết hạn đơn **đúng giờ**: job hẹn giờ cho từng đơn + sweeper dự phòng (`SKIP LOCKED`) | `holds` |
| Q-04 | Đối soát mỗi phút: đơn `PAID` mà chưa có vé → phát hành lại (lấp lỗ hổng giữa commit và lúc đưa job vào hàng đợi) | `maintenance` |
| Q-05 | Thông báo trong app: ghi bảng `notifications` + đẩy qua WebSocket | `notifications` |
| INF-02, INF-07 | Container `worker` trong Docker; tắt worker an toàn (chờ job đang chạy xong) | |
| (Phase 3 đã hứa) | Sau buổi diễn: suất và sự kiện → `FINISHED`, đơn `PAID` → `COMPLETED` | `maintenance` (câu hỏi 6) |
| NOT-01 | Xem danh sách thông báo, đánh dấu đã đọc | File xếp Phase 12, đề xuất làm luôn (câu hỏi 7) |

**Không làm**: hiển thị QR và check-in (Phase 10; nhưng mã QR được sinh sẵn lúc phát hành vé, xem mục 4), Bull Board (Phase 12), cổng thanh toán thật.

---

## 2. Kiến trúc

```
  API (nhiều bản)                     Redis                       Worker (1+ bản)
  ───────────────                     ─────                       ───────────────
  thanh toán xong ─commit─► enqueue ─► etp:bull:tickets ────────► phát hành vé ─► enqueue email + thông báo
  đăng ký / quên MK ──────► enqueue ─► etp:bull:emails  ────────► Nodemailer (thử lại 5 lần)
  giữ chỗ / checkout ─────► enqueue ─► etp:bull:holds (hẹn giờ) ► hết hạn đơn đúng giờ
                                       etp:bull:maintenance ────► mỗi phút: đối soát vé, sweeper dự phòng,
                                                                  mỗi 10 phút: kết thúc suất / sự kiện
```
- **BullMQ** (dùng `ioredis` có sẵn; Redis đã đặt `noeviction` từ Phase 6 đúng cho việc này).
- **Worker là tiến trình riêng** (`src/worker.js`), cùng image Docker với API, service `worker` trong `docker-compose.yml`. API chỉ **đưa job vào** hàng đợi. Muốn xử lý nhanh hơn thì tăng số bản worker, không đụng API.
- **Đưa job vào sau commit** (dùng `afterCommit` của Phase 7): rollback thì không có job nào.
- Sweeper 30 giây trong API (Phase 5) **chuyển sang worker** thành job lặp mỗi phút, chỉ còn là lưới an toàn.

**Nếu enqueue thất bại** (Redis lỗi ngay sau commit): đơn đã `PAID` nhưng job phát hành vé bị mất. Job đối soát mỗi phút (Q-04) tìm đúng các đơn này và phát hành lại. Không bao giờ có đơn đã trả tiền mà không có vé lâu hơn ~1 phút sau khi Redis hoạt động lại.

---

## 3. Từng hàng đợi

| Hàng đợi | Job | Số lần thử | Chờ giữa các lần | Chống chạy trùng |
|---|---|---|---|---|
| `tickets` | `issue` (orderId) | 10 | 5 s, tăng gấp đôi | `jobId = issue:{orderId}`; unique `(order_item_id, admission_no)` |
| `emails` | `otp`, `order-confirmed`, `order-refunded` | 5 | 10 s, tăng gấp đôi | `jobId` theo đơn (`order-confirmed:{orderId}`) giữ 24 giờ |
| `holds` | `expire` (orderId), chạy lúc `expires_at` | 3 | 5 s | `jobId = expire:{orderId}`; `lockDueOrder` (Phase 5) chỉ hết hạn đơn đã quá giờ |
| `notifications` | `notify` (userId, loại, nội dung) | 5 | 5 s | ghi một dòng, đẩy WebSocket sau commit |
| `maintenance` | `reconcile-tickets`, `sweep-holds` (mỗi phút), `finish-shows` (mỗi 10 phút) | 1 | | job lặp lại do BullMQ quản lý, chỉ một bản worker chạy mỗi lần |

- **Hết hạn đúng giờ**: job `expire` được hẹn đúng `expires_at`. Checkout gia hạn thêm 10 phút → khi job chạy mà đơn chưa tới hạn, job **tự hẹn lại** theo hạn mới (không cần tìm và xóa job cũ). Tin `SEAT_RELEASED` / `ORDER_EXPIRED` giờ phát đúng giờ, không trễ tới 30 giây như Phase 7.
- **Job thất bại hết số lần thử** được giữ lại 7 ngày để xem lỗi (Bull Board ở Phase 12), riêng job email OTP bị xóa sau 1 giờ (xem mục 5).
- **Email xác nhận đơn được gửi sau khi phát hành vé xong** (kèm danh sách mã vé), không phải ngay khi thanh toán.

---

## 4. Phát hành vé (Q-01)

```
1. Khóa đơn (FOR UPDATE). Chỉ phát hành cho đơn PAID; đơn đã REFUNDED / COMPLETED → bỏ qua.
2. Từ order_items: dòng ghế số → 1 vé; dòng vé đứng số lượng N → vé admission_no 1..N.
3. INSERT tickets … ON CONFLICT (order_item_id, admission_no) DO NOTHING
   → chạy lại (thử lại, đối soát) không bao giờ sinh vé thứ hai.
4. Sau commit: email xác nhận kèm mã vé + thông báo "Vé đã sẵn sàng" (TICKET_ISSUED qua WebSocket).
```
- Lớp chặn cuối đã có từ Phase 1: `uq_tickets_live_seat` (một ghế của một suất chỉ có một vé còn hiệu lực).
- **Mã vé** `TKT-XXXXXXXXXX` (ngẫu nhiên, không có ký tự dễ nhầm) để khách đọc cho nhân viên khi cần.
- **Mã QR (chuẩn bị cho Phase 10)**: nội dung QR = `id vé + phiên bản + chữ ký HMAC` bằng khóa bí mật mới `QR_SECRET`. QR **không chứa thông tin cá nhân**, không làm giả được nếu không có khóa, và tạo lại được bất cứ lúc nào nên DB chỉ lưu **băm** của nó (`qr_token_hash` đã có). Thêm cột `qr_version` để Phase 12 "cấp lại QR" (TKT-03) chỉ cần tăng số này là QR cũ hết hiệu lực.
- Hoàn tiền (Phase 8) đã chuyển vé sang `REFUNDED`. Hoàn tiền xảy ra **trước** khi worker kịp phát hành: bước 1 thấy đơn không còn `PAID` nên không phát hành.
- `GET /orders/:id` có thêm danh sách vé (mã vé, ghế, trạng thái). API "Vé của tôi" và QR ở Phase 10.

---

## 5. Email qua hàng đợi (Q-02)

- `mailer.sendMail` giữ nguyên. Các chỗ đang gửi trực tiếp (OTP) đổi sang **đưa job vào hàng đợi**; request không còn phải chờ SMTP.
- **Mã OTP nằm trong dữ liệu job** (trong Redis) cho tới khi gửi xong: job xóa ngay khi thành công, và bị xóa sau 1 giờ nếu thất bại hết số lần thử (mã đó cũng đã hết hạn sau 10 phút). Mã không bao giờ được ghi vào log.
- Email mới: **xác nhận đơn kèm danh sách vé**, **hoàn tiền**. Có cả bản text và HTML như email OTP.
- Không gửi được sau 5 lần (SMTP sai cấu hình, địa chỉ không tồn tại) → job thất bại được giữ lại để xem; không ảnh hưởng gì tới đơn hay vé.

---

## 6. Thông báo trong app (Q-05, NOT-01)

| Khi nào | Loại |
|---|---|
| Vé đã phát hành | `TICKET_ISSUED` |
| Đơn hết hạn / bị hủy (kể cả do hủy sự kiện) | `ORDER_EXPIRED` / `ORDER_CANCELLED` |
| Đã hoàn tiền | `ORDER_REFUNDED` |

- Worker ghi một dòng `notifications` (bảng đã có) rồi đẩy tin `NOTIFICATION` vào room `user:{id}` (WebSocket Phase 7).
- `GET /notifications` (của tôi, mới nhất trước, đếm số chưa đọc), `PATCH /notifications/:id/read`, `POST /notifications/read-all`.

---

## 7. Sau buổi diễn (đề xuất, câu hỏi 6)

Job `finish-shows` mỗi 10 phút:
- Suất `SCHEDULED` đã qua `end_at` → `FINISHED`.
- Sự kiện `PUBLISHED` mà mọi suất đều đã kết thúc / bị hủy → `FINISHED` (máy trạng thái Phase 3 đã chừa trạng thái này, ghi chú "background job Phase 9").
- Đơn `PAID` của suất đã kết thúc → `COMPLETED` (hết thời gian hoàn tiền thông thường).
- Làm mới cache danh mục sự kiện (Phase 6).

---

## 8. Database

Một migration:
- `tickets.qr_version int NOT NULL DEFAULT 1`.
- Index `idx_notifications_user_id_unread ON notifications (user_id) WHERE read_at IS NULL` (đếm thông báo chưa đọc).

Biến môi trường mới: `QR_SECRET` (bắt buộc, ≥ 32 ký tự, như `JWT_ACCESS_SECRET`), `WORKER_CONCURRENCY` (mặc định 5).

---

## 9. Kiểm thử bắt buộc

- Thanh toán → worker phát hành đúng số vé (2 ghế + 3 vé đứng = 5 vé); chạy lại job phát hành 3 lần → vẫn 5 vé.
- **Mất job** (giả lập Redis lỗi lúc enqueue) → job đối soát phát hành vé cho đơn đó.
- Hoàn tiền trước khi worker chạy → không phát hành; hoàn tiền sau → vé `REFUNDED`.
- Email: SMTP lỗi 2 lần rồi được → gửi đúng **1** email ở lần thử thứ 3; lỗi mãi → job `failed`, đơn và vé không bị ảnh hưởng.
- Hết hạn đúng giờ: đơn hết hạn ngay khi tới `expires_at` (không chờ sweeper); đơn đã checkout (được gia hạn) thì job tự hẹn lại, không hết hạn sớm.
- Thông báo: được ghi vào bảng, tới đúng người qua WebSocket; đọc / đánh dấu đã đọc.
- Tắt worker khi đang có job → job chạy xong rồi mới thoát.
- **Bộ test hiện có**: email OTP trong test đang được đọc ngay sau khi đăng ký. Trong môi trường test, hàng đợi chạy **ngay trong tiến trình** (`QUEUE_MODE=inline`) để các test đó không phải chờ worker; các test của Phase 9 dùng BullMQ thật với worker thật.

---

## 10. Ước lượng

| Hạng mục | Giờ |
|---|---|
| Hạ tầng hàng đợi: BullMQ, `worker.js`, Docker, tắt an toàn, chế độ inline cho test | 5 |
| Phát hành vé + mã vé + chuẩn bị QR (Q-01) | 6 |
| Email qua hàng đợi + 2 mẫu email mới (Q-02) | 6 |
| Hết hạn đúng giờ + sweeper chuyển sang worker (Q-03) | 5 |
| Đối soát vé (Q-04) | 2 |
| Thông báo + API thông báo (Q-05, NOT-01) | 4 |
| Kết thúc suất / sự kiện (câu hỏi 6) | 2 |
| Test + Postman + tài liệu | 6 |
| **Tổng** | **≈ 36 giờ** (file: Phase 9 = 30h, cộng NOT-01 3h và việc kết thúc suất) |

---

## 11. Quyết định khi review

Đã duyệt cả 8 điểm.


1. Dùng **BullMQ** với một tiến trình **worker riêng** (container `worker`), chạy tất cả hàng đợi ở mục 3. Đồng ý?
2. Trong **test**, hàng đợi chạy ngay trong tiến trình (`QUEUE_MODE=inline`); test riêng của Phase 9 dùng BullMQ thật. Đồng ý?
3. **Mã OTP nằm trong dữ liệu job** (Redis) cho tới khi gửi xong, xóa ngay sau đó (thất bại: xóa sau 1 giờ). Đồng ý?
4. **Hết hạn đơn**: job hẹn giờ cho từng đơn + sweeper mỗi phút trong worker làm lưới an toàn. Đồng ý?
5. **Hủy sự kiện vẫn hoàn tiền ngay trong transaction** như Phase 8 (cổng giả lập trả lời tức thì); khi có cổng thật mới chuyển qua hàng đợi. Đồng ý?
6. Làm luôn job **kết thúc suất / sự kiện** (FINISHED) và đơn `COMPLETED` sau buổi diễn. Đồng ý?
7. Làm luôn **API thông báo** (NOT-01, file xếp Phase 12 "Mở rộng"). Đồng ý?
8. Sinh sẵn **mã QR có chữ ký** (khóa mới `QR_SECRET`, cột `qr_version`) ngay lúc phát hành vé; hiển thị và check-in ở Phase 10. Đồng ý?
