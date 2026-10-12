# Phase 8 — Checkout, mã giảm giá, thanh toán giả lập, hoàn tiền (đã duyệt, đã triển khai)

> Mục tiêu: khách đang giữ chỗ (đơn `HELD`) → **checkout** (áp mã giảm giá, chốt giá) → **thanh toán** → đơn `PAID`, ghế `SOLD`. Bấm "Thanh toán" 2 lần hay mạng chập chờn gửi lại request thì **không bao giờ bị trừ tiền 2 lần**. Admin hoàn tiền được.
>
> Cổng thanh toán là **giả lập** (theo file: "chọn kết quả SUCCESS hoặc FAILED để test"). Schema đã chừa sẵn chỗ cho cổng thật (VNPay / MoMo) ở phase sau.

---

## 1. Phạm vi (theo file chức năng)

| Mã | Chức năng | Ghi chú |
|---|---|---|
| ORD-03 | Checkout: áp mã, chốt giá, chuyển `PAYMENT_PENDING` | Dời từ Phase 5 sang đây (đã chốt ở Phase 5) |
| PAY-01 | Thanh toán giả lập, header **`Idempotency-Key` bắt buộc** | |
| PAY-02 | Chống thanh toán trùng: gửi lại cùng request → trả đúng kết quả cũ | `INSERT … ON CONFLICT` + unique index (đã có) |
| PAY-03 | Xem một lần thanh toán | |
| PAY-04 | Thanh toán lỗi → đơn `PAYMENT_FAILED` vẫn giữ ghế, thử lại tới khi hết hạn | |
| PAY-05 | Hoàn tiền: đơn và thanh toán `REFUNDED`, ghế trở lại `AVAILABLE` | Một transaction, có audit |
| PRO-01, 02, 03 | Kiểm tra mã, admin quản lý mã, giới hạn lượt dùng | File xếp ở Phase 12, nhưng checkout cần mã giảm giá nên **đề xuất làm luôn** (câu hỏi 4) |
| EVT-08 | Hủy sự kiện → hoàn tiền mọi đơn đã thanh toán | Phần "hủy đơn đang giữ" đã có từ Phase 5 (câu hỏi 5) |
| WS-03, WS-04 | `SEAT_SOLD`; `ORDER_PAID`, `PAYMENT_SUCCEEDED`, `PAYMENT_FAILED`, `ORDER_REFUNDED` | Dùng cơ chế "phát sau commit" của Phase 7 |

**Không làm**: phát hành vé + email xác nhận (Phase 9: đơn `PAID` sẽ được worker phát hành vé), cổng thanh toán thật, hoàn tiền một phần.

---

## 2. Máy trạng thái đơn (mở rộng Phase 5)

```
HELD ──checkout──► PAYMENT_PENDING ──thanh toán OK──► PAID ──hoàn tiền──► REFUNDED
 │                    │       ▲                         │
 │                    │       └──thử lại──┐             └──(Phase 9) sau buổi diễn──► COMPLETED
 │                    └──thanh toán lỗi──► PAYMENT_FAILED ──thanh toán OK──► PAID
 │                                           │
 └── hủy / hết hạn / hủy suất, sự kiện ──────┴──► CANCELLED / EXPIRED  (trả chỗ + trả lượt mã giảm giá)
```
- **Checkout gia hạn giữ chỗ thêm 10 phút** để thanh toán (CTicket: 10 phút chọn vé + 10 phút thanh toán, V8). Chỉ gia hạn một lần.
- Ba trạng thái `HELD`, `PAYMENT_PENDING`, `PAYMENT_FAILED` đều **đang giữ chỗ**: hết hạn thì trả chỗ, khách hủy được. Sweeper và "hết hạn lười" của Phase 5 được mở rộng cho cả ba.
- Mọi chuyển trạng thái vẫn là compare-and-set và khóa dòng đơn `FOR UPDATE`. **Thanh toán và sweeper cùng lúc** thì chỉ một bên thắng: sweeper dùng `SKIP LOCKED` nên bỏ qua đơn đang được thanh toán; thanh toán đến sau khi đơn đã hết hạn thì nhận `409 ORDER_EXPIRED` và **không có tiền nào bị trừ**, vì cổng giả lập quyết định ngay trong transaction.

---

## 3. Checkout và mã giảm giá

`POST /orders/:id/checkout` body `{ "promotionCode": "SALE10" }` (mã là tùy chọn):
1. Khóa đơn (`FOR UPDATE`): phải là của mình, đang `HELD`, chưa hết hạn.
2. Nếu có mã: **khóa dòng mã** (`FOR UPDATE`) rồi kiểm tra: đang `ACTIVE`, trong thời hạn, đơn đạt `min_order_amount`, còn lượt (`used_count < usage_limit`), khách chưa vượt `per_user_limit`.
3. Tính giảm giá **ở backend**: phần trăm (làm tròn xuống, tối đa `max_discount`) hoặc số tiền cố định (không quá tạm tính). `total_amount = subtotal − discount` (CHECK `chk_orders_total` đã có).
4. **Giữ lượt dùng mã ngay lúc checkout**: `UPDATE promotions SET used_count = used_count + 1 WHERE … AND used_count < usage_limit` + một dòng `promotion_usages`. Đơn hết hạn / bị hủy khi chưa trả tiền → trả lại lượt (trong cùng transaction trả chỗ).
5. Đơn → `PAYMENT_PENDING`, `expires_at` (và `hold_expires_at` của các ghế) = bây giờ + 10 phút.

**Hai khách dùng lượt cuối cùng của mã cùng lúc (PRO-03)**: dòng mã bị khóa và câu `UPDATE` có điều kiện, nên đúng một người được; người kia nhận `422 PROMOTION_INVALID` (lý do `USAGE_LIMIT`). `chk_promotions_used_count` (đã có) là lớp chặn cuối.

**Đơn 0đ** (mã giảm 100%): không có gì để thanh toán (`amount > 0` là CHECK của bảng payments), nên đơn chuyển thẳng `PAID` ngay khi checkout (câu hỏi 6).

API mã giảm giá:

| Method | Đường dẫn | Quyền | Mô tả |
|---|---|---|---|
| POST | `/promotions/validate` | đăng nhập | `{ code, orderId }` → xem trước giảm bao nhiêu, **không** dùng lượt (PRO-01) |
| POST | `/promotions` | `promotion:manage` | Tạo mã: phần trăm / cố định, giảm tối đa, đơn tối thiểu, tổng lượt, lượt mỗi người, thời hạn (PRO-02) |
| GET | `/promotions` | `promotion:manage` | Danh sách, lọc trạng thái |
| PATCH | `/promotions/:id` | `promotion:manage` | Sửa tên, giới hạn, thời hạn, `status` (tạm dừng). Không đổi được loại giảm và giá trị khi mã đã có người dùng |

---

## 4. Thanh toán và chống trừ tiền 2 lần (PAY-01, 02, 04)

`POST /payments`, header `Idempotency-Key: <chuỗi ngẫu nhiên app sinh cho mỗi lần bấm Thanh toán>`, body `{ "orderId": "…", "simulate": "SUCCESS" | "FAILED" }`.

```
1. Có payment với (user, key) rồi?
     ├─ có, cùng nội dung (hash SHA-256 của body)  → trả lại ĐÚNG kết quả cũ, header Idempotent-Replayed: true
     └─ có, khác nội dung                           → 422 IDEMPOTENCY_KEY_REUSED
2. Transaction:
     khóa đơn FOR UPDATE → phải PAYMENT_PENDING / PAYMENT_FAILED, chưa hết hạn, số tiền = total_amount (backend tính)
     INSERT payment (PENDING) ON CONFLICT (user_id, idempotency_key) DO NOTHING
        └─ không chèn được (một request trùng key vừa xong) → sau commit đọc và trả payment đó
     cổng giả lập quyết định:
        SUCCESS → payment SUCCESS; đơn PAID; ghế HELD→SOLD; vé đứng held→sold
        FAILED  → payment FAILED (failure_code CARD_DECLINED); đơn PAYMENT_FAILED, vẫn giữ chỗ → thử lại với key MỚI
3. Sau commit: SEAT_SOLD (room suất diễn); PAYMENT_SUCCEEDED / PAYMENT_FAILED, ORDER_PAID (chủ đơn)
```
- **Unique `(user_id, idempotency_key)`** (đã có): bấm 2 lần, hoặc app gửi lại vì mạng chập → cùng key → một payment duy nhất.
- **Unique `uq_payments_order_active`** (đã có, `PENDING` / `SUCCESS`): kể cả 2 key khác nhau cho cùng một đơn thì cũng chỉ một lần thành công; lần sau nhận `409 ORDER_ALREADY_PAID`.
- Thiếu header → `400 IDEMPOTENCY_KEY_REQUIRED`. Key: 8–255 ký tự.
- `GET /payments/:id` (PAY-03): chủ đơn hoặc `payment:manage`. `GET /orders/:id` có thêm danh sách các lần thanh toán.
- Trường `simulate` chỉ tồn tại vì cổng là giả lập. Với cổng thật, kết quả đến từ webhook của cổng, đã chừa sẵn `provider` + unique `provider_transaction_id` để webhook gửi lại nhiều lần vẫn chỉ xử lý một lần.

---

## 5. Hoàn tiền (PAY-05, EVT-08)

`POST /payments/:id/refund` (quyền `refund:create`), body `{ "reason": "…" }` (bắt buộc), **một transaction**:
- Khóa đơn và payment; payment phải `SUCCESS`, đơn phải `PAID`.
- Ghi `refunds` (`SUCCESS` ngay, vì giả lập); unique `uq_refunds_payment_active` (đã có) chặn hoàn 2 lần.
- Payment và đơn → `REFUNDED`; ghế `SOLD → AVAILABLE`; vé đứng `sold − n`; vé (nếu đã phát hành ở Phase 9) → `REFUNDED`.
- Audit `PAYMENT_REFUNDED` (người làm, lý do, số tiền). Sau commit: `SEAT_RELEASED`, `INVENTORY_UPDATED`, `ORDER_REFUNDED` cho chủ đơn.
- Chỉ hoàn **toàn phần** (giả định A4 của Phase 4). Lượt dùng mã giảm giá **không** được trả lại khi hoàn tiền.

**Hủy sự kiện (EVT-08)**: trong cùng transaction hủy sự kiện, ngoài hủy đơn đang giữ (đã có), **hoàn tiền mọi đơn `PAID`** theo đúng các bước trên (`reason` = lý do hủy). Với cổng giả lập việc này tức thì; Phase 9 sẽ chuyển sang hàng đợi để dùng được với cổng thật (gọi API ra ngoài không được nằm trong transaction).

---

## 6. Database

Không cần bảng mới. Một migration nhỏ:
- `orders.checked_out_at timestamptz`: biết đơn đã checkout (và đã được gia hạn) chưa.
- Index `idx_promotion_usages_promotion_id_user_id` (đã có) phục vụ đếm lượt mỗi người.
- Script đối soát `inventory:check` thêm hai kiểm tra: ghế `SOLD` phải thuộc một đơn `PAID / COMPLETED` có dòng cho ghế đó, và ngược lại; `promotions.used_count` = số dòng `promotion_usages` của mã.

Mã lỗi mới: `IDEMPOTENCY_KEY_REQUIRED` (400), `IDEMPOTENCY_KEY_REUSED` (422), `ORDER_NOT_PAYABLE` (409), `ORDER_ALREADY_PAID` (409), `PROMOTION_INVALID` (422, kèm lý do), `PROMOTION_CODE_TAKEN` (409), `PAYMENT_NOT_REFUNDABLE` (409).

---

## 7. Kiểm thử bắt buộc

- Checkout không mã / có mã (phần trăm có trần, cố định); mỗi lý do mã không hợp lệ; giá luôn do backend tính.
- **2 khách cùng dùng lượt cuối của mã** → đúng 1 người được; `used_count` không vượt giới hạn.
- **Cùng `Idempotency-Key` gửi 5 lần đồng thời** → đúng 1 payment, 5 response giống hệt nhau; cùng key khác body → `422`.
- **2 key khác nhau cùng lúc cho một đơn** → đúng 1 `SUCCESS`, lần kia `409 ORDER_ALREADY_PAID`.
- Thanh toán `FAILED` → đơn vẫn giữ ghế → thử lại với key mới → `PAID` (PAY-04). Hết hạn khi đang `PAYMENT_FAILED` → trả chỗ **và trả lượt mã**.
- Thanh toán đua với sweeper trên đơn vừa hết hạn → hoặc `PAID`, hoặc `EXPIRED` + `409`, không bao giờ cả hai.
- Hoàn tiền: ghế trống lại, bộ đếm vé đứng đúng, audit; hoàn lần 2 → `409`. Hủy sự kiện có đơn đã trả tiền → tất cả `REFUNDED`.
- WebSocket: người xem sơ đồ nhận `SEAT_SOLD`; chủ đơn nhận `PAYMENT_SUCCEEDED` / `ORDER_PAID`.
- `inventory:check` 0 lệch sau mọi test; toàn bộ test cũ vẫn pass.

---

## 8. Ước lượng

| Hạng mục | Giờ |
|---|---|
| Migration + mở rộng máy trạng thái (sweeper, hủy, hết hạn cho 3 trạng thái giữ chỗ) | 3 |
| Checkout + áp mã + giữ / trả lượt mã (ORD-03, PRO-03) | 7 |
| API mã giảm giá: kiểm tra, quản lý (PRO-01, PRO-02) | 4 |
| Thanh toán idempotent + thử lại (PAY-01..04) | 8 |
| Hoàn tiền + hủy sự kiện hoàn tiền (PAY-05, EVT-08) | 5 |
| Tin WebSocket + đối soát kho | 2 |
| Test (gồm các kịch bản đồng thời) | 7 |
| Postman + tài liệu | 3 |
| **Tổng** | **≈ 39 giờ** (file: Phase 8 = 24h + ORD-03 7h + PRO-01..03 9h = 40h) |

---

## 9. Quyết định khi review

Đã duyệt cả 7 điểm. Câu 7: mã giảm giá dùng chung cho mọi sự kiện.


1. **Cổng thanh toán giả lập** đồng bộ, chọn kết quả bằng `simulate: SUCCESS | FAILED`; cổng thật (VNPay / MoMo: chuyển hướng + webhook) để sau. Đồng ý?
2. **Checkout gia hạn giữ chỗ thêm 10 phút** để thanh toán (một lần duy nhất). Đồng ý?
3. **Giữ lượt mã giảm giá ngay lúc checkout**, trả lại nếu đơn hết hạn / bị hủy khi chưa thanh toán; **không** trả lại khi hoàn tiền. Đồng ý?
4. **Làm luôn PRO-01..03** (kiểm tra mã, admin quản lý mã, giới hạn lượt) ở Phase 8 thay vì Phase 12. Đồng ý?
5. **Hủy sự kiện hoàn tiền ngay** các đơn đã thanh toán, trong cùng transaction (Phase 9 chuyển sang hàng đợi). Đồng ý?
6. **Đơn 0đ** (mã giảm 100%) → `PAID` ngay khi checkout, không tạo payment. Đồng ý?
7. Mã giảm giá **dùng cho mọi sự kiện** (bảng `promotions` hiện không gắn với sự kiện nào). Hay bạn muốn mã chỉ áp dụng cho một sự kiện (thêm cột `event_id`)?
