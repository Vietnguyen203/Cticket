# BKG-02: Thêm / bớt ghế trong đơn đang giữ (đã duyệt, đã triển khai)

## 1. Bối cảnh

- Bảng yêu cầu:
  - **BKG-01** "Chạm vào ghế là giữ ngay 10 phút, thêm vào đơn HELD".
  - **BKG-02** "Bỏ chọn một ghế đang giữ" (`DELETE /bookings/:orderId/seats/:seatId`, "Lua so khớp chủ khóa trước khi xóa").
- Phase 5 đã chốt: mỗi khách **1 đơn đang mở / suất**, đơn tạo một lần với toàn bộ ghế, **muốn đổi ghế thì hủy đơn rồi đặt lại**. Phase 11 giữ cách đó cho web: chọn ghế trên sơ đồ, bấm "Giữ chỗ".
- Hệ quả hiện nay: khách đã giữ A05–A06 mà muốn đổi sang A07 thì phải hủy đơn. A05–A06 được nhả, **người khác có thể lấy mất** trong lúc khách đặt lại. Không bớt được 1 ghế khi bạn đi cùng không đi nữa.

## 2. Phạm vi

| # | Việc | Ghi chú |
|---|---|---|
| 1 | **API sửa đơn đang giữ**: thêm ghế, bỏ ghế, đổi số vé đứng, trong **một transaction**, được cả hoặc không gì cả | Chỉ đơn `HELD` của chính mình |
| 2 | **API bỏ một ghế** (BKG-02 đúng như bảng yêu cầu) | Dùng chung lõi với mục 1 |
| 3 | Web: **sơ đồ ghế ở chế độ "sửa đơn"** khi khách đang có đơn giữ chỗ của suất đó; trang đơn có nút **"Bỏ"** từng ghế và **"Đổi / thêm ghế"** | |
| 4 | Test backend (có test tranh chấp), Vitest cho reducer, 1 kịch bản E2E; cập nhật README, Postman | |

**Không đổi**: luồng chọn ghế → "Giữ chỗ" (vẫn là cách tạo đơn), thời gian giữ 10 phút, checkout, thanh toán, mã giảm giá (vẫn áp lúc checkout).

## 3. API

### 3.1 `PUT /api/v1/orders/:id/items`: đặt lại nội dung đơn

Body **giống hệt lúc tạo đơn**: nội dung **cuối cùng** mong muốn, không phải phần chênh lệch.

```json
{ "seatIds": ["<A06>", "<A07>"], "items": [{ "ticketTypeId": "<Đứng>", "quantity": 1 }] }
```

- Server so với đơn hiện tại:
  - Ghế mới → giữ.
  - Ghế không còn trong danh sách → nhả.
  - Vé đứng → tăng / giảm theo số mới. Loại vé đứng không có trong `items` → bỏ.
- **Vì sao gửi nội dung cuối cùng mà không gửi "thêm X, bớt Y"**: `PUT` như vậy **idempotent**. Mạng chập chờn, gửi lại cùng request thì kết quả vẫn y nguyên. Còn "thêm 2 vé đứng" gửi hai lần sẽ thành 4.
- Không có gì thay đổi → trả về đơn như cũ (200), không đụng tồn kho.
- Trả về: đơn sau khi sửa (cùng dạng `GET /orders/:id`).

### 3.2 `DELETE /api/v1/orders/:id/seats/:seatId`: bỏ một ghế (BKG-02)

- Tương đương `PUT` với danh sách ghế hiện tại trừ đi ghế đó; vé đứng giữ nguyên.
- Ghế không có trong đơn → `404`.

### 3.3 Luật

| Luật | Lỗi |
|---|---|
| Chỉ **người mua** sửa đơn của mình (admin không sửa hộ, giống checkout) | `404` (không xác nhận đơn có tồn tại) |
| Chỉ đơn **`HELD`**. `PAYMENT_PENDING` / `PAYMENT_FAILED` đã chốt giá và có thể đã dùng mã giảm giá → muốn đổi thì hủy đơn | `409 INVALID_STATE_TRANSITION` |
| Đơn đã hết giờ → nhả như hết hạn (commit), rồi báo | `409 ORDER_EXPIRED` |
| **Đồng hồ giữ chỗ không gia hạn**: ghế thêm vào hết hạn cùng lúc với đơn (`expires_at` giữ nguyên). Nếu không, khách có thể giữ ghế mãi bằng cách thêm / bớt liên tục | |
| Đơn phải còn **ít nhất 1 vé**. Muốn bỏ hết thì "Hủy giữ chỗ" | `422 ORDER_CANNOT_BE_EMPTY` (mã mới) |
| Tối đa **8 vé / đơn** và `max_per_order` của từng hạng vé, đếm trên **nội dung cuối cùng** sau khi đã khóa dòng đơn (BKG-03: "khóa dòng orders trước khi đếm") | `422 ORDER_LIMIT_EXCEEDED` |
| **Thêm** ghế / vé thì suất phải đang mở bán, hạng vé đang bán. **Bỏ** thì luôn được (kể cả khi đã hết giờ bán hoặc hạng vé tạm dừng) | `SALES_CLOSED`, `TICKET_TYPE_UNAVAILABLE` |
| Ghế thêm vào đã có người giữ / đã bán | `409 SEATS_UNAVAILABLE` (kèm danh sách ghế, như lúc tạo đơn) |
| Vé đứng không đủ | `409 INSUFFICIENT_INVENTORY` |
| Giá: ghế / vé **giữ nguyên giá lúc giữ**; ghế mới lấy giá hiện tại; tăng số vé đứng của một hạng đã có thì tính theo giá đã chốt của dòng đó | |

## 4. Bên trong: không bán trùng, không deadlock

Cùng ba lớp như lúc tạo đơn (`docs/architecture.md` mục 3), chỉ áp cho **phần thêm vào**:

1. **Redis (lọc nhanh)**, chỉ cho ghế / vé **thêm mới**:
   - Gợi ý "ghế đã có người lấy", gợi ý "vé đứng còn N".
   - Khóa ghế ngắn hạn `SET NX` có chủ khóa. Khi xong, script Lua chỉ xóa khóa **nếu vẫn đúng chủ**: đây chính là "Lua so khớp chủ khóa" của BKG-02, đã có từ Phase 6.
   - Ghế **bỏ ra**: xóa gợi ý "ghế đã có người lấy" **sau commit**, để người khác giữ được ngay.
2. **Nhả đơn quá hạn của suất** (BKG-05) trước khi thêm, như lúc tạo đơn.
3. **Transaction PostgreSQL**, thứ tự khóa như mọi luồng khác:
   1. sự kiện + suất `FOR SHARE` (chỉ khi có thêm: chặn thêm ghế lúc sự kiện đang bị hủy);
   2. **dòng đơn `FOR UPDATE`**: sửa đơn, checkout, thanh toán, hủy, hết hạn của cùng một đơn xếp hàng nối tiếp nhau;
   3. tính lại phần chênh lệch **từ dữ liệu đã khóa** (không tin bước kiểm tra ngoài transaction);
   4. **ghế thêm + ghế bỏ trong cùng một lượt khóa, sắp theo `seat_id`**: hai khách đổi chéo ghế cho nhau thì xếp hàng chứ không deadlock;
   5. bộ đếm vé đứng theo `ticket_type_id`;
   6. cập nhật có điều kiện (`AVAILABLE → HELD`, `HELD bởi đơn này → AVAILABLE`), thêm / xóa dòng đơn, tính lại tổng tiền bằng SQL.
4. **Ràng buộc DB**:
   - Các ràng buộc sẵn có (ghế chỉ một trạng thái, `UNIQUE (order_id, schedule_seat_id)`).
   - **`UNIQUE (order_id, ticket_type_id)` cho dòng vé đứng** (partial index `uq_order_items_ga_line`, hóa ra đã có từ migration vé đứng). Mỗi hạng vé đứng chỉ một dòng trong đơn, sửa số lượng không bao giờ tạo dòng thứ hai.
5. **Sau commit**:
   - WebSocket cho người đang xem sơ đồ: `SEAT_HELD` (ghế thêm), `SEAT_RELEASED` (ghế bỏ), `INVENTORY_UPDATED` (vé đứng).
   - Kênh riêng của khách: tin mới **`ORDER_UPDATED`**, để tab khác đang mở trang đơn tự tải lại.

Rate limit riêng **`order-edit`: 30 lần / phút / người**. Rate limit đặt chỗ hiện tại là 10 / phút, nhỏ quá cho việc chỉnh vài lần.

## 5. Web

### 5.1 Sơ đồ ghế: chế độ "sửa đơn"

Khi khách đã đăng nhập và đang có đơn `HELD` của suất này (`GET /orders?scheduleId=…`):

- Đầu trang: **"Bạn đang giữ đơn ABC123 · còn 07:42 · Mở đơn"**.
- Lựa chọn ban đầu = ghế và vé đứng **của đơn**. Ghế của mình hiện là "Bạn chọn" (dù trên sơ đồ chung đang là "có người giữ"). Chạm để bỏ, chạm ghế trống để thêm, đổi số vé đứng như bình thường; **chưa gửi gì cho server**.
- Khung bên phải:
  - Danh sách sau khi đổi.
  - Phần chênh lệch: **"Thêm: A07 · Bỏ: A05"**.
  - Tạm tính.
  - Nút **"Cập nhật đơn"** (tắt khi không có thay đổi, hoặc khi bỏ hết: kèm dòng "Muốn bỏ hết thì Hủy giữ chỗ ở trang đơn").
- Bấm "Cập nhật đơn" → `PUT`, xong chuyển về trang đơn.
  - Ghế vừa bị người khác lấy → báo như lúc giữ chỗ.
  - Đơn của mình không đổi gì, ghế cũ **vẫn là của mình**.
- Ghế của mình đổi trạng thái qua WebSocket (do chính mình sửa ở tab khác) **không** bị báo "vừa có người khác giữ".
- Có đơn `PAYMENT_PENDING` / `PAYMENT_FAILED` → không vào chế độ sửa. Hiện **"Bạn có đơn đang chờ thanh toán · Mở đơn"** (thay cho lỗi `ACTIVE_ORDER_EXISTS` chỉ hiện sau khi bấm).

### 5.2 Trang đơn (khi `HELD`)

- Mỗi dòng ghế có nút **"Bỏ"** (`DELETE`). Còn 1 vé thì nút ẩn (dùng "Hủy giữ chỗ").
- Nút **"Đổi / thêm ghế"** → sơ đồ ghế ở chế độ sửa đơn.
- Đơn đổi (kể cả từ tab khác qua `ORDER_UPDATED`) → tải lại. Xem trước mã giảm giá bị xóa, vì tạm tính đã khác.

## 6. Kiểm thử

**Backend (Jest, DB + Redis thật)**
- Thêm ghế:
  - Ghế chuyển `HELD` bởi đơn này, hết hạn cùng đơn.
  - Tổng tiền đúng.
  - `expires_at` không đổi.
  - Có `SEAT_HELD`, `ORDER_UPDATED`.
- Bỏ ghế:
  - Ghế `AVAILABLE`, dòng đơn biến mất.
  - Gợi ý Redis bị xóa → người khác giữ được ngay.
- Đổi ghế (thêm + bỏ cùng lúc).
- Tăng / giảm / bỏ vé đứng (bộ đếm đúng).
- Gửi lại cùng `PUT` → không đổi gì.
- Luật:
  - Quá 8 vé (tính cả vé cũ), quá `max_per_order`.
  - Bỏ hết.
  - Đơn `PAYMENT_PENDING`.
  - Đơn đã hết giờ → `ORDER_EXPIRED` và ghế được nhả.
  - Đơn của người khác → 404.
  - Ghế không có trong đơn → 404.
  - Hạng vé tạm dừng: không thêm được, bỏ được.
- **Tranh chấp**:
  - 20 khách cùng thêm 1 ghế vào đơn của mình → đúng 1 người được.
  - Sửa đơn và checkout cùng lúc → hoặc checkout với tổng mới, hoặc sửa bị từ chối; không bao giờ trả tiền cho nội dung khác với đơn.
  - Hai khách đổi chéo ghế cho nhau cùng lúc → không deadlock.
  - Sau mỗi test, `inventory:check` không thấy lệch.
- Redis tắt: vẫn đúng (PostgreSQL quyết định).

**Web (Vitest)**: reducer ở chế độ sửa đơn (lựa chọn ban đầu, phần chênh lệch, ghế của mình không bị coi là "người khác lấy").

**E2E (Playwright)**:
- Khách giữ A05, quay lại sơ đồ, thêm A06, bỏ A05, cập nhật.
- Trang đơn chỉ còn A06.
- Trình duyệt thứ hai đang xem sơ đồ thấy A05 trống lại, A06 có người giữ.

## 7. Ước lượng

| Việc | Giờ |
|---|---|
| Backend (service, repository, migration, route, rate limit) | 5 |
| Web (sơ đồ ghế chế độ sửa, trang đơn) | 5 |
| Test backend + Vitest + E2E | 3 |
| README, Postman | 1 |
| **Tổng** | **≈ 14 giờ** (bảng yêu cầu ước 4 giờ cho riêng phần "bỏ ghế"; phần thêm ghế và giao diện là phần còn lại) |

## 8. Cần quyết định khi review

1. **Cách sửa: chọn xong rồi bấm "Cập nhật đơn"** (đề xuất).
   - Cách khác là đúng nguyên văn BKG-01: **chạm là giữ ngay**, mỗi lần chạm một request, chạm lần đầu thì tạo đơn và bắt đầu đếm 10 phút.
   - Đề xuất cách thứ nhất vì:
     - giữ nguyên trải nghiệm đã làm ở Phase 11;
     - một lần cập nhật được cả hoặc không gì cả, không có cảnh nửa ghế đã đổi nửa chưa;
     - ít request (ít đụng rate limit, nhẹ cho server lúc mở bán);
     - đồng hồ không chạy khi khách còn đang ngắm sơ đồ.

   Đồng ý?
2. **Đồng hồ không gia hạn** khi thêm ghế. Đồng ý?
3. **Chỉ đơn `HELD`** mới sửa được. Đã bấm "Tiếp tục thanh toán" thì phải hủy đơn để đổi. Đồng ý?
4. **Không cho bỏ hết**: vé cuối cùng thì dùng "Hủy giữ chỗ". Đồng ý?
5. **Vé đứng cũng sửa được số lượng** (không chỉ ghế). Đồng ý?
6. **Chỉ người mua** sửa đơn; admin vẫn chỉ hủy / hoàn tiền như hiện tại. Đồng ý?

**Đã duyệt**: cả 6 điểm như đề xuất.

## 9. Ghi chú triển khai

- **API**: `PUT /api/v1/orders/:id/items`, `DELETE /api/v1/orders/:id/seats/:seatId`, rate limit `order-edit` 30 / phút / người. Mã lỗi mới `ORDER_CANNOT_BE_EMPTY` (422), tin WebSocket mới `ORDER_UPDATED`.
- **Code**:
  - `orders.service.js`, mục "Editing a held order": `editOrder` (xem trước + Redis) → `applyEdit` (transaction).
  - `updateOrderItems` và `removeSeat` chỉ khác nhau ở cách tính nội dung mong muốn từ nội dung hiện tại. `removeSeat` tính trên dữ liệu đã khóa, nên "ghế không có trong đơn" cũng được quyết định trong transaction.
- **Không cần migration**: ràng buộc một dòng / hạng vé đứng đã có (`uq_order_items_ga_line`).
- **Sửa thêm khi làm**:
  - Hạn giữ của ghế (`hold_expires_at`) trước đây được gửi từ JavaScript (`Date`, chính xác tới mili giây) nên lệch vài micro giây so với `orders.expires_at`. Lúc tạo đơn cũng vậy.
  - Giờ `holdSeats` chép thẳng từ dòng đơn trong SQL; test kiểm tra ghế thêm vào hết hạn **đúng bằng** hạn của đơn.
- **Lỗi bắt được nhờ test**: `UPDATE … SET quantity = $3, total_amount = unit_price * $3` → PostgreSQL suy ra `$3` vừa là `int` vừa là `bigint` ("inconsistent types deduced for parameter"); sửa bằng `$3::int`.
- **Web**:
  - `seatMapReducer` có `editing` (đơn đang sửa), `isMine`, `gaLeftFor`, `editChanges`. Ghế của mình đang `HELD` trên sơ đồ chung nhưng vẫn chọn / bỏ được. Vé đứng của đơn được cộng vào số còn lại cho chính mình.
  - `SeatSelectPage` tìm đơn đang mở của suất (`GET /orders?scheduleId=`). Đơn `HELD` → chế độ "Đổi ghế"; đơn chờ thanh toán → báo và khóa nút giữ chỗ.
  - `OrderPage` có nút "Bỏ" từng ghế và link "Đổi / thêm ghế". Xem trước mã giảm giá tự ẩn khi tạm tính đổi.
- **Postman**: thư mục "3b. Đổi ghế trong đơn đang giữ (BKG-02)" trong `postman/etp-booking.postman_collection.json`.
- **Kiểm thử**:
  - Backend **269 test** (thêm 15 trong `order-edit.test.js`, có 4 test tranh chấp).
  - Web **63 test** (thêm 5).
  - E2E **12 kịch bản** (thêm `order-edit.spec.ts`).
  - Độ phủ dòng 94,8%.
