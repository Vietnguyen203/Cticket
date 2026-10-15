# Phase 18: Khóa đăng nhập, nhắc lịch, hủy đơn có chính sách, danh sách chờ

Bốn phần độc lập, làm chung một phase vì cùng chạm vào đơn hàng, email và job nền. Mỗi phần có migration, API, web và test riêng; thứ tự làm: 18.1 → 18.2 → 18.3 → 18.4 (18.4 dùng việc "trả chỗ" của 18.3).

## 1. Mục tiêu

| Phần | Người dùng thấy gì |
|---|---|
| **18.1 Khóa đăng nhập tạm thời** | Sai mật khẩu 5 lần liền → email đó bị khóa đăng nhập 15 phút (lần sau lâu hơn), chủ tài khoản nhận email cảnh báo. Đặt lại mật khẩu hoặc admin mở khóa thì vào được ngay. |
| **18.2 Nhắc lịch** | Email + thông báo trong app **24 giờ** và **2 giờ** trước giờ diễn: sự kiện, giờ, địa điểm, số vé, link "Vé của tôi". Tắt được trong trang tài khoản. |
| **18.3 Hủy đơn có chính sách** | Ban tổ chức chọn chính sách hoàn cho sự kiện. Khách tự hủy đơn đã thanh toán, thấy trước số tiền được hoàn (ví dụ 80% nếu hủy trước 7 ngày); tiền về qua VNPay (hoàn một phần) hoặc ngay với giả lập; ghế mở bán lại. |
| **18.4 Danh sách chờ** | Hạng vé hết → nút "Báo tôi khi có vé". Có chỗ trống (đơn hết hạn, bị hủy, được hoàn…) → người đầu danh sách nhận email + thông báo, có 30 phút ưu tiên để đặt trước khi tới lượt người sau. |

---

## 2. 18.1 Khóa đăng nhập tạm thời

### Quy tắc
- Đếm lần **sai mật khẩu theo email** (đã chuẩn hóa chữ thường), **cả với email không tồn tại**: kẻ dò tài khoản thấy cùng một phản hồi, không đoán được email nào có thật.
- 5 lần sai liên tiếp → khóa **15 phút**. Mỗi 5 lần sai tiếp theo sau khi hết khóa → gấp đôi (30 phút, 1 giờ…), tối đa **24 giờ**.
- Đang khóa: `POST /auth/login` trả **429 `LOGIN_LOCKED`** kèm `retryAfterSeconds`, **không kiểm tra mật khẩu** (kể cả mật khẩu đúng), để không ai dùng lúc khóa để dò.
- Nhập sai **mã 2FA** (đã qua bước mật khẩu) cũng tính vào bộ đếm của email đó.
- Đăng nhập đúng → xóa bộ đếm.
- Mở khóa sớm:
  - **đặt lại mật khẩu** thành công (chứng minh giữ email);
  - **admin** bấm "Mở khóa đăng nhập" ở trang Người dùng (ghi audit).
- Lần khóa đầu tiên của một đợt → email cho chủ tài khoản (nếu email có thật): "Có người nhập sai mật khẩu nhiều lần… nếu không phải bạn, hãy đổi mật khẩu". Không gửi lại trong cùng đợt.
- Rate limit theo IP (5 lần/phút) giữ nguyên: nó chặn một máy thử nhiều email; khóa theo email chặn nhiều máy thử một email.

### Dữ liệu
Bảng `login_attempts` (không khóa ngoại tới `users`, vì có cả email không tồn tại):

| Cột | Ý nghĩa |
|---|---|
| `email_hash` (khóa chính) | HMAC-SHA256 của email (`OTP_SECRET`), không lưu email thô của người lạ |
| `failures` | số lần sai trong đợt hiện tại |
| `lock_level` | số lần đã bị khóa trong đợt (tính thời gian khóa) |
| `locked_until` | khóa tới khi nào |
| `last_failure_at` | đợt tự xóa sau 24 giờ không sai |

- Lưu trong **PostgreSQL**, không phải Redis: Redis hỏng thì hệ thống bỏ qua (fail-open), khóa sẽ mất tác dụng đúng lúc dễ bị tấn công.
- Cập nhật bằng một câu `INSERT … ON CONFLICT DO UPDATE` (nhiều request song song không làm sai bộ đếm).
- Job bảo trì hằng ngày xóa các dòng cũ hơn 24 giờ.

### Rủi ro đã biết
Ai biết email của bạn có thể cố tình khóa bạn (sai mật khẩu 5 lần). Khóa chỉ tạm thời, đặt lại mật khẩu mở được ngay, và rate limit theo IP làm việc này chậm. Đây là đánh đổi chuẩn của tính năng khóa tài khoản.

---

## 3. 18.2 Nhắc lịch

### Quy tắc
- Gửi cho người mua mỗi **đơn đã thanh toán** còn ít nhất một vé **còn hiệu lực**, suất diễn chưa bị hủy:
  - **24 giờ** trước giờ diễn, nếu đơn được trả **trước** mốc đó (mua sau thì đã có email xác nhận rồi);
  - **2 giờ** trước giờ diễn, nếu đơn được trả trước mốc 2 giờ.
- Một đơn nhận mỗi loại nhắc **đúng một lần**: bảng `order_reminders (order_id, kind)` khóa chính kép, ghi trước khi gửi trong cùng transaction; job chạy lại hay chạy song song cũng không gửi trùng.
- Gửi gì:
  - **email**: tên sự kiện, giờ (giờ Việt Nam), địa điểm và địa chỉ, số vé và mã vé, "Cổng mở từ …" (khung soát vé hiện có), link "Vé của tôi";
  - **thông báo trong app** (có sẵn từ Phase 9, đẩy qua WebSocket).
- Người dùng **tắt được** trong trang tài khoản: cột `users.event_reminders` (mặc định bật). Tắt thì không gửi cả email lẫn thông báo nhắc; email xác nhận, hoàn tiền… vẫn gửi.
- Job bảo trì `send-reminders` mỗi **5 phút**: tìm suất diễn trong cửa sổ, mỗi lượt tối đa 500 đơn, đưa từng email vào hàng đợi `emails` (thử lại sẵn có).
- Suất bị hoãn giờ (đổi `start_at`) sau khi đã nhắc: không nhắc lại. Ghi trong giới hạn.

---

## 4. 18.3 Hủy đơn có chính sách hoàn tiền

### Chính sách
Ban tổ chức chọn **một chính sách cho mỗi sự kiện**, trong trang chỉnh sửa sự kiện (đổi được cả sau khi đã bán; đơn đã mua áp dụng chính sách **lúc khách hủy**, trang sự kiện ghi rõ). Chính sách là các mẫu cố định trong code, không cho tự gõ % (tránh nhập sai và dễ hiển thị):

| Chính sách | Hủy trước giờ diễn | Hoàn |
|---|---|---|
| **Không hoàn** (mặc định, cũng là của mọi sự kiện cũ) | — | Khách không tự hủy được |
| **Tiêu chuẩn** | ≥ 7 ngày | 80% |
| | 3 – 7 ngày | 50% |
| | < 3 ngày | Không hủy được |
| **Linh hoạt** | ≥ 48 giờ | 100% |
| | 24 – 48 giờ | 50% |
| | < 24 giờ | Không hủy được |

- Số tiền hoàn = **% × số tiền khách đã trả** (sau giảm giá), làm tròn xuống tới 1.000đ. Phần còn lại là **phí hủy** ban tổ chức giữ.
- Admin hoàn tiền (PAY-05) và hủy sự kiện / suất vẫn **hoàn 100%** như cũ, không theo chính sách.

### Điều kiện khách tự hủy
- Đơn của chính họ, trạng thái **PAID**.
- Sự kiện đang bán, suất diễn chưa bị hủy, **chưa tới giờ diễn**, đang trong mốc được hoàn.
- **Chưa vé nào vào cổng**.
- Đơn 0đ (mã giảm 100%): hủy được, không có tiền hoàn.
- Lượt mã giảm giá đã dùng **không trả lại** (tránh lạm dụng mua, dùng mã, rồi hủy).

### API
- `GET /orders/:id/cancellation` → `{ allowed, reason?, policy, percent, refundAmount, fee, tierEndsAt }`. `tierEndsAt` = lúc mốc hiện tại hết, web hiện "Hủy trước … để được hoàn 80%".
- `POST /orders/:id/cancellation` với body `{ refundAmount }` = số khách đã thấy. Server tính lại; **khác** (vừa qua mốc) → **409 `REFUND_TERMS_CHANGED`** kèm số mới, web hỏi lại. Không bao giờ hoàn khác số khách đã đồng ý.
- Trong **một transaction**, khóa đơn trước như mọi nơi:
  - đơn → `REFUNDED`, vé → `REFUNDED`, ghế / vé đứng mở bán lại (dùng lại `refundLockedOrder`);
  - dòng `refunds` với **số tiền một phần** và lý do "Khách hủy (chính sách Tiêu chuẩn, 80%)";
  - audit `ORDER_CANCELLED_BY_CUSTOMER`;
  - email "Đã hủy đơn, hoàn X đ, phí hủy Y đ".
- Tiền:
  - **giả lập** → hoàn ngay;
  - **VNPay** → hàng đợi `payments` như Phase 17, nhưng **hoàn một phần** (`vnp_TransactionType = 03`) khi số tiền nhỏ hơn số đã trả, hoàn toàn phần (`02`) khi bằng.

### Báo cáo doanh thu
Hiện nay đơn bị hoàn **ra khỏi doanh thu** của ngày trả tiền và **hiện ở mục hoàn tiền** của ngày hoàn. Với hoàn một phần, phần phí hủy là tiền ban tổ chức thật sự giữ, nên:
- thêm chỉ số **"Phí hủy"** = tổng tiền các đơn bị hủy − tổng tiền đã hoàn của chúng, tính vào **ngày hủy**;
- **doanh thu = tiền đơn đã bán + phí hủy**;
- báo cáo của ban tổ chức, admin và file CSV đều có cột mới. Admin hoàn 100% thì phí hủy = 0, số liệu cũ không đổi.

---

## 5. 18.4 Danh sách chờ

### Đăng ký
- Trên trang chọn chỗ, hạng vé **hết chỗ** (không còn chỗ trống, kể cả chỗ đang được giữ) có nút **"Báo tôi khi có vé"**: chọn số lượng muốn mua (1 tới giới hạn mỗi đơn của hạng).
- Mỗi người **một đăng ký đang chờ cho mỗi hạng vé** của một suất; xem và rời danh sách ở trang mới **"Danh sách chờ"** (menu tài khoản).
- Chỉ đăng ký được khi suất đang mở bán.

### Mời người đang chờ (job `offer-waitlist`, mỗi phút)
Với mỗi hạng vé có người chờ:
1. **Chỗ trống** = số ghế / vé đứng đang bán được của hạng.
2. **Chỗ đã mời** = tổng số lượng của những người đang trong **30 phút ưu tiên**.
3. Còn dư → mời tiếp những người chờ **sớm nhất** sao cho tổng số lượng không vượt chỗ dư; người muốn nhiều hơn số chỗ dư thì người sau được mời trước (không để một người chặn cả danh sách).
4. Mời = đăng ký chuyển `OFFERED`, `offer_expires_at = now + 30 phút`, email + thông báo trong app: "Đã có N vé hạng X cho …, bạn được ưu tiên đặt tới HH:mm".

Ưu tiên được giữ thế nào: trong 30 phút đó, **những chỗ đã mời không bán cho người khác**. Khi giữ chỗ, server tính `chỗ trống − chỗ đã mời cho người khác`; không đủ thì người ngoài danh sách nhận "Vé đang dành cho người trong danh sách chờ, thử lại sau". Sơ đồ ghế hiện những chỗ đó là **"Đang dành cho danh sách chờ"** (hạng vé đứng: số còn lại trừ đi chỗ đã mời).

- Người được mời **đặt chỗ** (giữ chỗ thành công trong suất đó, đúng hạng) → đăng ký `BOOKED`.
- Hết 30 phút không đặt → `EXPIRED`, chỗ trở lại cho người tiếp theo ở lượt job sau.
- Suất ngừng bán / bị hủy / đã diễn → mọi đăng ký `CLOSED`.
- Tất cả chạy trong một transaction, khóa theo thứ tự hiện có (suất → …), nên hai bản worker chạy cùng lúc không mời trùng.

### Dữ liệu
Bảng `waitlist_entries`:
- `id`, `user_id`, `schedule_id`, `ticket_type_id`, `quantity`, `status` (`WAITING` / `OFFERED` / `BOOKED` / `EXPIRED` / `CANCELLED` / `CLOSED`);
- `offered_at`, `offer_expires_at`, `created_at`;
- duy nhất `(user_id, ticket_type_id)` khi `status IN ('WAITING', 'OFFERED')`.

### Vì sao mời bằng job mỗi phút, không bắt từng chỗ trả lại
Chỗ được trả lại ở rất nhiều nơi: hết hạn giữ chỗ, khách hủy, admin hoàn tiền, hủy đơn có chính sách, bỏ ghế khỏi đơn (BKG-02), ban tổ chức mở khóa ghế, tiền VNPay đến muộn. Gắn hook vào từng chỗ dễ sót. Job đếm lại **chỗ trống thật** mỗi phút nên không bao giờ sót. Chậm nhất 1 phút là chấp nhận được với danh sách chờ.

---

## 6. Web

| Trang | Thay đổi |
|---|---|
| Đăng nhập | Thông báo "Đăng nhập tạm khóa, thử lại sau N phút, hoặc đặt lại mật khẩu" |
| Admin → Người dùng | Cột / nhãn "Đang khóa đăng nhập", nút **Mở khóa đăng nhập** |
| Tài khoản | Công tắc "Email nhắc lịch trước giờ diễn" |
| Ban tổ chức → Sửa sự kiện | Chọn chính sách hoàn (có bảng mốc ngay dưới) |
| Trang sự kiện | Dòng "Chính sách hủy: …" |
| Trang đơn (đã thanh toán) | Khung "Hủy đơn": số được hoàn, phí, hạn của mốc hiện tại, nút **Hủy đơn và hoàn tiền** (hộp xác nhận) |
| Trang chọn chỗ | Hạng hết chỗ → **Báo tôi khi có vé**; chỗ "dành cho danh sách chờ" có màu / chú thích riêng |
| Mới: Danh sách chờ | Các đăng ký, trạng thái, hạn ưu tiên + nút "Đặt ngay", nút rời danh sách |
| Báo cáo | Cột / chỉ số "Phí hủy" |

## 7. Kiểm thử

- **18.1**:
  - 5 lần sai → khóa;
  - đang khóa thì mật khẩu đúng cũng bị từ chối;
  - email không tồn tại cũng bị khóa y hệt;
  - thời gian khóa tăng dần;
  - đặt lại mật khẩu / admin mở khóa;
  - sai mã 2FA được đếm;
  - email cảnh báo một lần;
  - 20 lần sai song song → bộ đếm đúng.
- **18.2**:
  - cửa sổ 24 giờ / 2 giờ;
  - đơn mua sau mốc không nhận;
  - không gửi trùng khi job chạy 2 lần cùng lúc;
  - người tắt nhắc;
  - đơn đã hoàn / suất bị hủy không nhận.
- **18.3**:
  - đủ các mốc của 2 chính sách và đúng ranh giới mốc;
  - làm tròn;
  - chưa vào cổng;
  - `REFUND_TERMS_CHANGED`;
  - VNPay hoàn một phần (`03`) với VNPay giả;
  - đơn 0đ;
  - báo cáo có phí hủy;
  - **2 lần hủy cùng lúc → hoàn đúng 1 lần**.
- **18.4**:
  - đăng ký khi hết chỗ / từ chối khi còn chỗ;
  - mời đúng thứ tự và số lượng;
  - người ngoài không lấy được chỗ đang dành;
  - hết 30 phút → người tiếp theo;
  - đặt chỗ → `BOOKED`;
  - suất ngừng bán → `CLOSED`;
  - 2 worker cùng mời không trùng.
- **E2E**:
  - khách hủy đơn theo chính sách Tiêu chuẩn và thấy số hoàn;
  - người B đăng ký chờ, người A hủy đơn, B nhận lời mời và đặt được.

## 8. Ước lượng

| Phần | Giờ |
|---|---|
| 18.1 Khóa đăng nhập (migration, auth, admin, web, test) | 5 |
| 18.2 Nhắc lịch (migration, job, email, cài đặt, test) | 5 |
| 18.3 Hủy có chính sách (chính sách, API, VNPay hoàn một phần, báo cáo, web, test) | 10 |
| 18.4 Danh sách chờ (migration, job mời, giữ chỗ ưu tiên, sơ đồ ghế, web, test) | 12 |
| E2E, tài liệu, Postman | 4 |
| **Tổng** | **≈ 36 giờ** |

## 9. Cần quyết định khi review

1. **Khóa theo email, cả email không tồn tại; 5 lần → 15 phút, gấp đôi, tối đa 24 giờ; đang khóa thì không kiểm tra mật khẩu.** Đồng ý?
2. **Nhắc 24 giờ và 2 giờ**, email + thông báo trong app, người dùng tắt được. Đồng ý?
3. **Chính sách là 3 mẫu cố định** (Không hoàn / Tiêu chuẩn / Linh hoạt), ban tổ chức chọn theo sự kiện, đơn cũ theo chính sách lúc hủy. Hay muốn ban tổ chức tự đặt % và mốc?
4. **Phí hủy tính vào doanh thu** ở ngày hủy. Đồng ý?
5. **Không trả lại lượt mã giảm giá** khi khách tự hủy. Đồng ý?
6. **Danh sách chờ có 30 phút ưu tiên thật** (chỗ được giữ cho người được mời, sơ đồ ghế hiện "đang dành"). Cách đơn giản hơn: chỉ báo tin, ai nhanh người đó được. Chọn cái nào?
7. **Không làm**: chuyển nhượng vé, tự động đặt hộ người chờ, hoàn một phần do admin chọn %. Đồng ý?

## 10. Ghi chú triển khai

Đã duyệt cả 7 điểm như đề xuất.

### 18.1 Khóa đăng nhập
- `auth/login-guard.js`: bảng `login_attempts`, khóa chính là HMAC của email.
  - Đếm lần sai bằng **một câu** `INSERT … ON CONFLICT DO UPDATE` chỉ dùng giá trị của chính dòng bị khóa. Bản đầu dùng CTE đọc trước nên có thể đếm mất khi nhiều lần sai cùng lúc; đã sửa trước khi chạy test, test 4 lần sai đồng thời giữ cho chuyện này không quay lại.
  - Lần sai thứ 5 trả luôn `LOGIN_LOCKED` (429, có `retryAfterSeconds`), không đợi lần thứ 6.
- Chỉ đăng nhập **trọn vẹn** mới xóa bộ đếm. Mật khẩu đúng nhưng còn chờ mã 2FA thì chưa: kẻ biết mật khẩu không thể dùng mật khẩu đúng để reset bộ đếm rồi đoán mã tiếp.
- Mở khóa: đặt lại mật khẩu thành công, hoặc `POST /admin/users/:id/login-unlock` (audit `LOGIN_UNLOCKED`). Danh sách người dùng của admin có `loginLockedUntil`.
- Job `purge-login-attempts` mỗi giờ.
- Hai test cũ đổi theo quy tắc mới:
  - lần sai mã 2FA thứ 5 giờ là `LOGIN_LOCKED`;
  - test rate limit theo IP dùng email khác nhau mỗi lần.

### 18.2 Nhắc lịch
- Module `reminders`, job `send-reminders` mỗi 5 phút. Một câu SQL vừa chọn đơn đến hạn vừa ghi `order_reminders` (`ON CONFLICT DO NOTHING`), nên không bao giờ gửi trùng.
- Job email kiểm tra lại trước khi gửi: đơn bị hoàn, suất bị hủy hay người dùng vừa tắt nhắc thì bỏ.
- Cài đặt: `PATCH /users/me { eventReminders }`, công tắc ở trang Tài khoản.

### 18.3 Hủy đơn có chính sách
- Bảng mốc ở `REFUND_POLICY_TIERS` (constants). Hàm thuần `refund-policy.js` dùng chung cho xem trước, hủy và test.
- **Khác thiết kế**: số tiền hoàn làm tròn xuống tới **đồng**, không phải 1.000đ. Lý do: với giá nhỏ, làm tròn tới 1.000đ có thể ra 0 (không có gì để hoàn) và phức tạp hơn mà không lợi gì.
- API `GET` và `POST /orders/:id/cancellation` nằm trong module `payments`, gắn thêm vào `/orders`.
- Hoàn tiền dùng lại `refundLockedOrder` với số tiền một phần.
  - VNPay: `vnp_TransactionType = 03` khi hoàn một phần.
  - Email "Đã hoàn tiền" ghi số đã hoàn và phí hủy.
  - Thông báo trong app ghi số đã hoàn.
- Báo cáo:
  - `cancellationFees` = tổng tiền đơn − tiền hoàn, tính vào doanh thu ở ngày hủy (theo sự kiện, theo ngày, toàn hệ thống, sự kiện của ban tổ chức);
  - CSV có thêm cột;
  - bảng xếp hạng sự kiện / ban tổ chức vẫn chỉ tính tiền bán.
- Sửa sự kiện đang bán: thêm `refundPolicy` vào danh sách được sửa.

### 18.4 Danh sách chờ
- Module `waitlist`, job `offer-waitlist` mỗi phút.
- Giữ chỗ theo **số lượng**, không theo ghế cụ thể. Một lượt giữ chỗ (hoặc sửa đơn BKG-02) có hạng vé đang có người chờ thì:
  - lấy khóa theo hạng vé (`pg_advisory_xact_lock`) **sau** khóa ghế;
  - kiểm tra `chỗ trống − số mình lấy ≥ chỗ đang giữ cho người khác`;
  - không đủ thì trả `WAITLIST_RESERVED`.
- Job mời lấy cùng khóa đó nhưng không khóa dòng tồn kho nào, nên hai bên không chờ nhau thành vòng. Hạng vé không có ai chờ thì không tốn khóa.
- **Khác thiết kế (sơ đồ ghế)**: không tô màu riêng từng ghế "đang dành", vì chỗ được giữ theo số lượng chứ không gắn với ghế cụ thể.
  - API sơ đồ ghế và API tồn kho trừ sẵn chỗ đang giữ cho **người khác** (`available`) và trả thêm `waitlistKept`.
  - Trang chọn chỗ ghi "N vé đang được giữ cho người trong danh sách chờ".
  - Số vé đứng cập nhật trực tiếp qua WebSocket chưa trừ phần này; lúc giữ chỗ server vẫn chặn.
- Người được mời giữ chỗ thành công thì đăng ký thành `BOOKED`, trong cùng giao dịch giữ chỗ.
- Stack E2E không có worker, nên API của E2E tự chạy job mời mỗi 2 giây (`e2e/start-api.mjs`).

### Kiểm thử
- Backend **355 test** (thêm 25):
  - 7 khóa đăng nhập;
  - 3 nhắc lịch;
  - 7 hủy đơn tích hợp và 4 unit bảng mốc;
  - 4 danh sách chờ.
- Web 68 test.
- E2E **17 kịch bản** (thêm 2: hủy đơn theo chính sách, danh sách chờ).
- Độ phủ dòng 95,6%.
- Postman: `etp-payments` có thêm thư mục 9 (khách tự hủy đơn) và 10 (danh sách chờ).
