# Phase 5 — Đặt chỗ & đơn hàng (đã duyệt, đã triển khai)

> Mục tiêu: khách **giữ chỗ** (ghế số và/hoặc vé đứng) → có **đơn HELD** với đồng hồ đếm ngược → tự **hết hạn** hoặc **hủy** thì trả chỗ về kho.
> Phase này chứng minh **chỉ riêng PostgreSQL đã chặn được bán trùng**. Redis (Phase 6), WebSocket (Phase 7), thanh toán (Phase 8), phát hành vé QR + BullMQ (Phase 9) gắn vào sau, **không phải sửa lại** luồng giữ chỗ.

---

## 1. Hành vi CTicket áp dụng (từ khảo sát Phase 4)

| Nguồn | Hành vi | Áp dụng ở Phase 5 |
|---|---|---|
| V1 | Chọn hạng + số lượng **hoặc** chọn ghế → "Tiếp tục" → thông tin người nhận → thanh toán | `POST /schedules/:id/orders` nhận ghế và/hoặc số lượng GA trong **một** đơn |
| V7 | Giới hạn vé mỗi giao dịch (SAO 10, K-Star 6) | `ticket_types.max_per_order` (đã có từ P4) + trần **10 vé/đơn** toàn hệ thống |
| V8 | **10 phút** chọn vé + **10 phút** thanh toán | Đơn `HELD` hết hạn sau 10 phút (cấu hình `HOLD_TTL_MINUTES`); bước thanh toán (P8) gia hạn thêm 10 phút khi chuyển `PAYMENT_PENDING` |
| V13 | Không double-booking | Khóa dòng + conditional update + CHECK (mục 5) |
| V15 | Sau thanh toán không đổi vé | Đơn HELD **không sửa được**; muốn chọn lại thì hủy và đặt lại |

Chưa kiểm chứng được và giữ nguyên giả định cũ: A1 (giữ chỗ suốt lúc chọn và thanh toán), A2 (thời gian giữ do hệ thống cấu hình).

---

## 2. Phạm vi

**Làm trong Phase 5**
1. Migration nới `order_items` / `tickets` cho vé GA (đã cam kết ở mục 4.2 thiết kế Phase 4).
2. Tạo đơn giữ chỗ: ghế số (theo `seatIds`) + GA (theo `ticketTypeId` + `quantity`), có thể trộn trong một đơn.
3. Xem đơn của tôi / chi tiết đơn (còn bao nhiêu giây), admin xem mọi đơn.
4. Khách hủy đơn HELD → trả chỗ.
5. Hết hạn: **lazy** (khi đọc/đặt chạm vào đơn quá hạn) + **sweeper chạy trong tiến trình** mỗi 30 giây (`FOR UPDATE SKIP LOCKED`, an toàn khi chạy nhiều bản API). Phase 9 thay bằng job trễ của BullMQ.
6. Hủy sự kiện hoặc hủy một suất (đã có ở P3) → tự hủy mọi đơn HELD của sự kiện / suất đó, trả chỗ (`cancel_reason` = `EVENT_CANCELLED` / `SCHEDULE_CANCELLED`).
7. Script đối soát kho (`npm run inventory:check`): đếm lại kho từ đơn hàng và so với bộ đếm. Dùng trong test, và sau này trong k6 (P13).

**Không làm (phase sau)**: thanh toán & trạng thái `PAYMENT_PENDING/PAID` (P8), mã giảm giá (đề xuất P8, xem câu hỏi 5), Redis (P6), push realtime (P7), phát hành vé + email (P9), hệ thống tự xếp ghế "best available" (A3, câu hỏi 4), waiting room / presale (A5).

---

## 3. Thay đổi database (1 migration)

```
order_items
  schedule_seat_id  NOT NULL → NULL        -- dòng GA không có ghế
  seat_id           NOT NULL → NULL
  seat_label        NOT NULL → NULL
  ticket_type_id    NULL → NOT NULL
  + FK (ticket_type_id, schedule_id) → ticket_types(id, schedule_id)   -- hạng vé phải của đúng suất
  + CHECK chk_order_items_kind:
        (schedule_seat_id IS NOT NULL AND seat_id IS NOT NULL AND seat_label IS NOT NULL AND quantity = 1)
     OR (schedule_seat_id IS NULL AND seat_id IS NULL AND quantity >= 1)
  + UNIQUE INDEX uq_order_items_ga_line (order_id, ticket_type_id) WHERE schedule_seat_id IS NULL
        -- mỗi đơn chỉ 1 dòng GA cho mỗi hạng vé (cộng dồn số lượng, không tách dòng)

tickets   (dùng ở P9, nới ngay để không phải migration lại)
  schedule_seat_id  NOT NULL → NULL
  + admission_no int NOT NULL DEFAULT 1    -- vé thứ 1..N của một dòng GA
  - UNIQUE (order_item_id)  → + UNIQUE (order_item_id, admission_no)   -- phát hành lại vẫn idempotent
  (uq_tickets_live_seat giữ nguyên: Postgres bỏ qua NULL trong unique index)

orders
  + cancel_reason text                     -- "USER_CANCELLED", "EVENT_CANCELLED", ...
  + CHECK chk_orders_cancelled: (status = 'CANCELLED') = (cancelled_at IS NOT NULL)
```

Mọi FK nhiều cột hiện có vẫn đúng: `MATCH SIMPLE` không kiểm tra khi `schedule_seat_id` NULL, còn `chk_order_items_kind` bảo đảm dòng ghế số luôn đủ cả 3 cột.

`order_code`: dạng `ETP-261009-7KQ2XM` (ngày + 6 ký tự base32 ngẫu nhiên, bỏ các ký tự dễ nhầm như 0/O, 1/I). Unique có sẵn; nếu trùng thì sinh lại (tối đa 3 lần).

---

## 4. Máy trạng thái đơn (phần thuộc Phase 5)

```
            ┌──── khách hủy ──────► CANCELLED (cancel_reason = USER_CANCELLED)
 (tạo) ──► HELD ── hết 10 phút ──► EXPIRED
            └──── event / suất bị hủy ──► CANCELLED (EVENT_CANCELLED / SCHEDULE_CANCELLED)
            └──── admin hủy ──────► CANCELLED (ADMIN_CANCELLED, có audit)
            └──── (P8) bắt đầu thanh toán ──► PAYMENT_PENDING …
```
- Mọi chuyển trạng thái là compare-and-set: `UPDATE orders SET status = … WHERE id = $1 AND status = 'HELD'`. Hai tiến trình (sweeper và khách bấm hủy) cùng chạy thì chỉ **một** bên thắng; bên thua không trả chỗ lần hai.
- Trả chỗ nằm **trong cùng transaction** với việc đổi trạng thái đơn: ghế `HELD → AVAILABLE` (theo `held_by_order_id`), GA `held_quantity -= quantity`.
- Unique `uq_orders_active_cart` (đã có) ⇒ mỗi khách có tối đa **1 đơn đang mở / suất**.

---

## 5. Chống bán trùng & race condition

**Thứ tự khóa toàn hệ thống** (mở rộng thứ tự của P4, tránh deadlock):
`events → event_schedules → orders → schedule_seats (theo seat_id, giống khóa ghế ở P4) → ga_inventory (theo ticket_type_id)`

### 5.1 Tạo đơn — 2 transaction ngắn
**Tx 1 – dọn hộ (lazy expiry):** tìm các đơn quá hạn đang giữ những ghế được yêu cầu và hết hạn chúng trước (dùng chung hàm với sweeper). Nhờ vậy ghế mà `availability` báo "còn", vì hold cũ đã quá hạn, thì đặt được ngay, không phải chờ sweeper.

**Tx 2 – giữ chỗ:**
1. `SELECT … FROM events / event_schedules … FOR SHARE`: nhiều khách đặt song song không chặn nhau, nhưng **hủy sự kiện / hủy suất / khóa ghế** (`FOR UPDATE`) phải chờ, nên không có đơn mới lọt vào sự kiện vừa hủy. Kiểm tra: event `PUBLISHED`, suất `SCHEDULED`, đã sinh kho, thời điểm hiện tại nằm trong cửa sổ bán `[sales_start_at, sales_end_at)`.
2. `INSERT orders (HELD, expires_at = now() + TTL)` **trước** khi đụng vào kho. Nếu vi phạm `uq_orders_active_cart` thì trả `409 ACTIVE_ORDER_EXISTS` kèm `details.orderId`. Vì đơn được tạo trước, khách **bấm 2 lần** thì request thứ hai chờ ở unique index rồi nhận `ACTIVE_ORDER_EXISTS`, không tranh ghế với chính mình.
3. Ghế: `SELECT … FROM schedule_seats WHERE schedule_id = $1 AND seat_id = ANY($2) ORDER BY seat_id FOR UPDATE`. **Tất cả** phải `AVAILABLE` và thuộc hạng vé `ACTIVE`, nếu không thì `409 SEATS_UNAVAILABLE` kèm danh sách `[{ seatId, status }]` (all-or-nothing, không giữ một nửa).
4. GA (sắp theo `ticket_type_id`): `UPDATE ga_inventory SET held_quantity = held_quantity + $n WHERE ticket_type_id = $1 AND capacity - held - sold - blocked >= $n`. Không có dòng nào đổi ⇒ `409 INSUFFICIENT_INVENTORY`.
5. `UPDATE schedule_seats SET status = 'HELD', held_by_order_id, hold_expires_at`; `INSERT order_items` với **giá chụp lại** (ghế: `schedule_seats.price`; GA: `ticket_types.price`).
6. Tổng tiền tính trong SQL (`subtotal = sum(order_items.total_amount)`); `chk_orders_total` và `chk_order_items_total` là lớp chặn cuối.

**Lớp bảo vệ cuối ở DB** (kể cả khi code có bug): `chk_schedule_seats_state` (ghế không thể vừa HELD vừa SOLD), `chk_ga_inventory_capacity`, `uq_orders_active_cart`, `uq_tickets_live_seat`, các FK nhiều cột.

### 5.2 Sweeper
```
mỗi 30 giây:
  SELECT id FROM orders
  WHERE status = 'HELD' AND expires_at < now()
  ORDER BY expires_at LIMIT 100
  FOR UPDATE SKIP LOCKED
  → mỗi đơn: CAS HELD→EXPIRED + trả ghế + trả GA (cùng transaction)
```
`SKIP LOCKED` cho phép nhiều bản API chạy sweeper cùng lúc mà không xử lý trùng. Trong test, sweeper bị tắt và được gọi tay qua hàm `expireDueOrders()`.

### 5.3 Vì sao chưa dùng Redis
Redis ở P6 chỉ để **từ chối nhanh** (ghế: `SET NX PX`; GA: bộ đếm sơ bộ). Quyết định cuối vẫn là bước 2–3 ở trên. P5 đo được hiệu năng "chỉ DB" để P13 so sánh trước và sau khi có Redis.

---

## 6. Hợp đồng API

| Method | Đường dẫn | Quyền | Mô tả |
|---|---|---|---|
| POST | `/schedules/:id/orders` | `booking:create` | Body: `{ seatIds?: uuid[], items?: [{ ticketTypeId, quantity }] }` (ít nhất một trong hai). → `201 { order }` gồm `orderCode`, `status: HELD`, `expiresAt`, `items[]`, `subtotal`, `totalAmount` |
| GET | `/orders` | `order:read:own` (của tôi) / `order:manage` (tất cả, lọc `scheduleId`, `status`) | Phân trang như P3 |
| GET | `/orders/:id` | chủ đơn hoặc `order:manage` | Kèm `remainingSeconds`. Đơn HELD quá hạn được hết hạn ngay khi đọc (lazy) |
| POST | `/orders/:id/cancel` | chủ đơn (`order:cancel:own`) hoặc `order:manage` | Chỉ khi `HELD` → `CANCELLED` + trả chỗ. Gọi lại lần 2 → `409 INVALID_STATE_TRANSITION`. Đơn đã quá giờ → chuyển `EXPIRED` (được lưu) rồi trả `409 ORDER_EXPIRED`. Admin hủy đơn của người khác → có audit `ORDER_CANCELLED` |

Đơn của người khác → **404** (không tiết lộ đơn có tồn tại hay không, giống event ở P3).

**Mã lỗi mới**

| Mã | HTTP | Khi nào |
|---|---|---|
| `ACTIVE_ORDER_EXISTS` | 409 | Đã có đơn đang mở ở suất này (`details.orderId`) |
| `ORDER_EXPIRED` | 409 | Hủy một đơn đã quá giờ giữ chỗ |
| `SEATS_UNAVAILABLE` | 409 | Có ghế không còn trống (`details.seats: [{ seatId, status }]`) |
| `INSUFFICIENT_INVENTORY` | 409 | (đã có) GA không đủ số lượng |
| `SALES_NOT_OPEN` / `SALES_CLOSED` | 422 | Ngoài cửa sổ bán, hoặc sự kiện / suất đã bị hủy |
| `TICKET_TYPE_UNAVAILABLE` | 422 | Hạng vé `INACTIVE` / không thuộc suất / sai kiểu (gửi `quantity` cho hạng ghế số) |
| `ORDER_LIMIT_EXCEEDED` | 422 | Vượt `max_per_order` của hạng vé hoặc trần 10 vé/đơn |

---

## 7. Kiểm thử bắt buộc

**Đồng thời (quan trọng nhất)**
- 50 khách cùng giữ **ghế A01** → đúng 1 đơn thành công, 49 nhận `SEATS_UNAVAILABLE`.
- 50 khách cùng giữ 1 vé GA khi chỉ còn 10 → đúng 10 thành công; `held_quantity = 10`.
- Hai khách giữ chéo `[A01, A02]` và `[A02, A01]` cùng lúc → không deadlock, đúng 1 bên thắng.
- 1 khách bấm "đặt" 5 lần cùng lúc → 1 đơn, 4 lần nhận `ACTIVE_ORDER_EXISTS`.
- Sweeper và khách bấm hủy cùng lúc trên một đơn → chỉ một bên thắng; bộ đếm GA không bị trừ hai lần.
- 2 sweeper chạy song song → mỗi đơn hết hạn đúng một lần.

**Nghiệp vụ**
- Hết hạn → ghế về AVAILABLE, GA được trả; đơn mới đặt lại được.
- Ghế BLOCKED, ghế của suất khác, hạng vé INACTIVE, ngoài cửa sổ bán, vượt `max_per_order` → bị từ chối, **không** để lại hold nào.
- Đơn trộn ghế + GA: tổng tiền đúng, giá chụp lại không đổi khi hạng vé bị sửa sau đó.
- Hủy sự kiện / hủy một suất → các đơn HELD chuyển CANCELLED, chỗ được trả.
- Khách khác xem / hủy đơn của tôi → 404.

**Đối soát**: sau mỗi test đồng thời, `inventory:check` phải báo 0 lệch (`held_quantity` = tổng `quantity` của các đơn đang mở; số ghế HELD = số dòng ghế của các đơn đang mở).

---

## 8. Ước lượng

| Hạng mục | Giờ |
|---|---|
| Migration `order_items` / `tickets` / `orders` + sửa fixture cũ | 3 |
| Tạo đơn (2 transaction, kiểm tra, chụp giá, mã đơn) | 6 |
| Trả chỗ dùng chung: hủy / hết hạn / hủy sự kiện + sweeper | 4 |
| API đọc đơn (của tôi, admin, chi tiết) | 2 |
| Script đối soát kho | 1 |
| Test (gồm 6 kịch bản đồng thời) | 5 |
| Postman Phase 5 + cập nhật tài liệu | 2 |
| **Tổng** | **≈ 23 giờ** |

---

## 9. Cần quyết định khi review

1. **Thời gian giữ 10 phút**, không gia hạn ở P5 (P8 gia hạn thêm 10 phút khi bắt đầu thanh toán, khớp V8). Đồng ý?
2. **Mỗi khách 1 đơn đang mở / suất**. Muốn đổi ghế thì hủy đơn rồi đặt lại, không có API sửa đơn. Đồng ý?
3. **Giới hạn**: `max_per_order` theo hạng vé + trần 10 vé/đơn. **Chưa** giới hạn tổng số vé mỗi tài khoản được mua cho một sự kiện (chống phe vé, làm cùng presale sau). Đồng ý?
4. **Hạng ngồi "hệ thống tự xếp ghế"** (A3/V6): đề xuất **lùi sang sau P8**. P5 chỉ hỗ trợ khách tự chọn ghế. Đồng ý?
5. **Mã giảm giá**: đề xuất làm ở **P8** cùng bước thanh toán (áp mã vào đơn HELD trước khi trả tiền), vì `used_count` chỉ nên tăng khi thanh toán thành công. Đồng ý?
6. Khóa `FOR SHARE` trên event/suất khi đặt (đúng nghiệp vụ hủy sự kiện, đổi lại có chút chi phí khi tải cao). P13 sẽ đo; nếu thành nút thắt thì đổi sang kiểm tra trạng thái kèm dọn hậu kỳ. Đồng ý?
