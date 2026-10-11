# Phase 7 — WebSocket: sơ đồ ghế và thông báo theo thời gian thực (đã duyệt, đã triển khai)

> Mục tiêu: khách đang xem sơ đồ ghế thấy ghế đổi màu **ngay** khi người khác giữ / trả / khóa ghế, không phải tải lại trang; khách có đơn được báo ngay khi đơn hết hạn hoặc bị hủy.
>
> Nguyên tắc: **WebSocket chỉ là kênh thông báo, không phải nguồn sự thật.** Mọi thao tác (giữ ghế, hủy đơn…) vẫn đi qua REST API và PostgreSQL. Mất tin nhắn, rớt kết nối hay chạy nhiều bản API thì dữ liệu vẫn đúng; client chỉ cần tải lại sơ đồ ghế.

---

## 1. Phạm vi (theo file chức năng)

| Mã | Chức năng | Làm ở Phase 7 |
|---|---|---|
| WS-01 | Kết nối và xác thực | Kết nối `ws://…/ws`; khách vãng lai **xem được sơ đồ** không cần đăng nhập; đăng nhập bằng tin nhắn `AUTH` đầu tiên (**không đặt token trong URL**); heartbeat 30 giây |
| WS-02 | Theo dõi một suất diễn | `SUBSCRIBE` vào room `schedule:{id}` |
| WS-03 | Cập nhật ghế real-time | `SEAT_HELD`, `SEAT_RELEASED`, `SEAT_SOLD`, `SEAT_BLOCKED` + `INVENTORY_UPDATED` (số vé đứng còn lại); **phát sau commit**; có `version` để client bỏ tin cũ |
| WS-04 | Thông báo cá nhân | Room `user:{id}`: `ORDER_EXPIRED`, `ORDER_CANCELLED` ngay ở Phase 7. `PAYMENT_*`, `TICKET_ISSUED` dùng cùng cơ chế, được phát ở Phase 8 và 9 |
| WS-05 | Chạy nhiều bản API | Redis Pub/Sub: tin phát ở bản API này tới được client đang nối vào bản API khác |

`SEAT_SOLD` đã có trong giao thức nhưng chỉ được phát từ Phase 8 (khi thanh toán thành công).

---

## 2. Lựa chọn kỹ thuật

- **Thư viện `ws`** (WebSocket thuần) thay vì Socket.IO:
  - React Native có sẵn `WebSocket`, không cần cài thêm client nào.
  - Giao thức tự định nghĩa bằng JSON, đúng như file yêu cầu (`AUTH`, `SUBSCRIBE`).
  - Gắn vào chính HTTP server hiện có tại đường dẫn `/ws` (cùng cổng 3001; `app.js` đã chừa chỗ cho việc này từ Phase 1).
- **Không đặt token trong URL**: URL hay bị ghi vào log của proxy / server. Token gửi trong tin nhắn `AUTH` sau khi kết nối.
- **Heartbeat**: server gửi ping (khung ping chuẩn của WebSocket, React Native tự trả lời) mỗi 30 giây. Kết nối không trả lời trong 1 chu kỳ thì bị đóng, để không giữ kết nối "chết" (mất mạng điện thoại, tắt app).

---

## 3. Giao thức (tin nhắn JSON)

**Client → server**

| Tin nhắn | Ý nghĩa |
|---|---|
| `{ "type": "AUTH", "token": "<access token>" }` | Đăng nhập (tùy chọn). Gửi lại token mới khi token cũ sắp hết hạn |
| `{ "type": "SUBSCRIBE", "scheduleId": "…" }` | Theo dõi sơ đồ ghế của một suất (công khai, không cần AUTH) |
| `{ "type": "UNSUBSCRIBE", "scheduleId": "…" }` | Thôi theo dõi |

**Server → client**

| Tin nhắn | Khi nào |
|---|---|
| `{ "type": "WELCOME", "heartbeatSeconds": 30 }` | Ngay khi kết nối |
| `{ "type": "AUTH_OK", "userId": "…" }` / `{ "type": "ERROR", "code": "UNAUTHENTICATED" }` | Kết quả `AUTH` |
| `{ "type": "SUBSCRIBED", "scheduleId": "…" }` | Đã vào room. **Client tải sơ đồ ghế (REST) SAU khi nhận tin này**, rồi áp các tin cập nhật có `version` lớn hơn |
| `{ "type": "SEAT_HELD", "scheduleId": "…", "seats": [{ "seatId": "…", "status": "HELD", "version": 3 }] }` | Có người giữ ghế. `SEAT_RELEASED` / `SEAT_BLOCKED` / `SEAT_SOLD` cùng dạng |
| `{ "type": "INVENTORY_UPDATED", "scheduleId": "…", "ticketTypes": [{ "ticketTypeId": "…", "available": 48 }] }` | Số vé đứng còn lại đổi |
| `{ "type": "ORDER_EXPIRED" / "ORDER_CANCELLED", "orderId": "…", "reason": "…" }` | Chỉ gửi cho chủ đơn (room `user:{id}`) |
| `{ "type": "AUTH_EXPIRED" }` | Token hết hạn: rời room cá nhân (vẫn xem sơ đồ được); client gửi `AUTH` với token mới |
| `{ "type": "ERROR", "code": "…", "message": "…" }` | Tin nhắn sai dạng, suất không tồn tại / chưa mở bán, vượt giới hạn… |

- **Một tin cho mỗi transaction**: khóa 50 ghế cùng lúc → 1 tin `SEAT_BLOCKED` chứa 50 ghế, không phải 50 tin.
- **`version` chống tin cũ**: mỗi lần dòng `schedule_seats` đổi, trigger `bump_version` (có từ Phase 1) tăng `version`. Tin đến trễ / sai thứ tự (có version nhỏ hơn cái client đang có) thì client bỏ qua. Sơ đồ ghế REST đã trả `version` từ Phase 4.
- **Rớt kết nối và kết nối lại**: tin phát ra lúc client mất kết nối sẽ không được gửi lại. Khi kết nối lại, client `SUBSCRIBE` lại rồi tải lại sơ đồ ghế.

---

## 4. "Phát sau commit"

Nếu phát tin trong lúc transaction còn chạy rồi transaction bị rollback, client sẽ thấy một ghế "đã giữ" mà thực ra vẫn trống. Vì vậy:

- `withTransaction` có thêm `client.afterCommit(fn)`: đoạn code ở **bất kỳ đâu** trong transaction (kể cả hàm trả chỗ dùng chung khi hủy sự kiện) đăng ký việc cần phát. Chỉ khi `COMMIT` thành công thì các việc đó mới chạy. Rollback thì bỏ hết.
- Lỗi khi phát tin chỉ được ghi log, **không bao giờ** làm request thất bại (đơn đã giữ xong rồi).
- Các câu lệnh đổi trạng thái ghế / bộ đếm vé đứng trả về `seat_id`, `version` và số vé còn lại (`RETURNING`) để có sẵn dữ liệu cho tin nhắn, không cần truy vấn thêm.

| Thao tác (sau commit) | Tin phát ra |
|---|---|
| Giữ chỗ (`POST /schedules/:id/orders`) | `SEAT_HELD` (ghế số) + `INVENTORY_UPDATED` (vé đứng) |
| Khách hủy, đơn hết hạn (sweeper / lười), hủy suất, hủy sự kiện | `SEAT_RELEASED` + `INVENTORY_UPDATED` vào room suất diễn; `ORDER_CANCELLED` / `ORDER_EXPIRED` cho chủ đơn |
| Khóa / mở ghế, giữ / trả vé đứng cho nhà tài trợ | `SEAT_BLOCKED` / `SEAT_RELEASED` + `INVENTORY_UPDATED` |
| Thanh toán thành công (Phase 8) | `SEAT_SOLD` + `ORDER_PAID`, `PAYMENT_*` |

Ghi chú: một đơn quá hạn được hiển thị là "trống" ngay trong sơ đồ ghế REST (hết hạn lười, Phase 5), nhưng tin `SEAT_RELEASED` chỉ phát khi đơn thực sự được trả chỗ (sweeper chạy mỗi 30 giây, hoặc có người đặt / xem đơn). Phase 9 dùng job hẹn giờ của BullMQ để phát đúng lúc.

---

## 5. Nhiều bản API (WS-05)

```
API #1: giữ ghế → commit → PUBLISH etp:realtime {room, message} ──► Redis
                                                                     │
API #1 (subscriber) ◄────────────────────────────────────────────────┤
API #2 (subscriber) ◄────────────────────────────────────────────────┘
mỗi bản gửi tin cho các socket của mình đang ở room đó
```
- Mỗi bản API có **một kết nối Redis riêng để subscribe** (Redis bắt buộc kết nối subscribe không được dùng cho lệnh khác).
- Dùng **một kênh chung** `etp:realtime`, mỗi bản tự lọc theo room của các socket mình đang giữ. Đơn giản, đủ cho quy mô dự án. Nếu sau này lớn, có thể chia kênh theo suất diễn.
- **Redis lỗi**: không publish được thì bản API giao trực tiếp cho socket **của chính nó** (client ở bản khác lỡ tin đó). Không có lỗi nào lan tới request.

---

## 6. Bảo vệ

| Giới hạn | Giá trị | Lý do |
|---|---|---|
| Kích thước 1 tin nhắn client gửi | 4 KB | Chặn gửi dữ liệu rác cỡ lớn |
| Số suất theo dõi cùng lúc / kết nối | 5 | Một màn hình chỉ cần 1–2 suất |
| Số tin client gửi | 20 tin / 10 giây / kết nối, vượt thì đóng kết nối (mã 1008) | Chặn spam |
| Số kết nối / IP / bản API | 20 | Một nhà, một văn phòng vẫn đủ; chặn mở hàng nghìn kết nối từ một máy |
| Origin | Trình duyệt phải có Origin nằm trong `CORS_ORIGINS`; app di động (không gửi Origin) được phép | Chống trang web lạ mượn trình duyệt người dùng để kết nối |
| `SUBSCRIBE` | Chỉ suất đã mở bán, thuộc sự kiện công khai | Không lộ suất của sự kiện nháp |
| Token | Kiểm tra chữ ký, hạn, **denylist** (đăng xuất ở Phase 6) như REST | Đăng xuất là mất luôn thông báo cá nhân |

Tắt server (`SIGTERM`): đóng mọi socket với mã 1001 ("server đang khởi động lại") để client tự kết nối lại sang bản khác.

---

## 7. Kiểm thử bắt buộc

- Khách vãng lai `SUBSCRIBE` → người khác giữ ghế qua REST → nhận đúng 1 tin `SEAT_HELD` chứa ghế đó, `version` tăng.
- Giữ ghế **thất bại** (ghế đã bị giữ, rollback) → **không** có tin nào.
- Hủy đơn / đơn hết hạn (chạy sweeper) / hủy suất → `SEAT_RELEASED` + `INVENTORY_UPDATED`; chủ đơn nhận `ORDER_EXPIRED` / `ORDER_CANCELLED`, người khác không nhận.
- Khóa 10 ghế → 1 tin chứa 10 ghế.
- `AUTH` với token sai / đã đăng xuất → `ERROR`; không có `AUTH` vẫn xem sơ đồ được; `SUBSCRIBE` suất của sự kiện nháp → `ERROR`.
- **Hai bản API** dùng chung Redis: giữ ghế ở bản 1 → client nối vào bản 2 nhận được tin.
- Redis lỗi → giữ ghế vẫn thành công, client cùng bản vẫn nhận tin.
- Heartbeat: client không trả lời ping bị đóng kết nối; vượt giới hạn tin nhắn / số suất → bị chặn.
- Toàn bộ test cũ vẫn pass.

**Test bằng tay**: Postman có sẵn loại request WebSocket (New → WebSocket). Tài liệu sẽ kèm các tin nhắn mẫu để dán vào. Mở một tab theo dõi suất diễn, tab khác đặt / hủy vé bằng collection Phase 5, rồi xem tin nhắn hiện ra.

---

## 8. Test bằng tay với Postman

Postman có sẵn loại request WebSocket (không lưu được trong file collection JSON, nên tạo tay một lần):

1. Chạy collection **ETP — Booking (Phase 5)** tới hết folder 2 (đã có một suất đang bán). Mở tab **Variables** của collection, copy giá trị `scheduleId` và `userToken`.
2. **New → WebSocket**, URL `ws://localhost:3001/ws`, bấm **Connect**. Nhận được `WELCOME`.
3. Ô **Message**, dán rồi bấm **Send**:
   ```json
   { "type": "SUBSCRIBE", "scheduleId": "<dán scheduleId>" }
   ```
   Nhận `SUBSCRIBED`.
4. (Tùy chọn) nhận thông báo cá nhân:
   ```json
   { "type": "AUTH", "token": "<dán userToken>" }
   ```
   Nhận `AUTH_OK`.
5. Quay lại collection Phase 5, chạy **"Giữ 2 ghế VIP + 2 vé đứng"** → tab WebSocket hiện ngay `SEAT_HELD` (2 ghế) và `INVENTORY_UPDATED` (vé đứng còn 48). Chạy **"Hủy đơn"** → `SEAT_RELEASED`, `INVENTORY_UPDATED`, và `ORDER_CANCELLED` (nếu đã AUTH).

Nếu Postman báo lỗi 403 khi Connect: xóa header `Origin` trong tab Headers của request WebSocket (server chỉ cho trình duyệt từ các website trong `CORS_ORIGINS`).

---

## 9. Ước lượng

| Hạng mục | Giờ |
|---|---|
| WebSocket server: kết nối, heartbeat, `AUTH`, giới hạn, tắt an toàn (WS-01) | 6 |
| Room suất diễn, `SUBSCRIBE` (WS-02) | 3 |
| `afterCommit` + phát tin ghế / tồn kho từ các luồng hiện có (WS-03) | 7 |
| Thông báo cá nhân (WS-04) | 3 |
| Redis Pub/Sub nhiều bản API (WS-05) | 4 |
| Test + hướng dẫn test bằng Postman | 4 |
| **Tổng** | **≈ 27 giờ** (file ước lượng 27 giờ) |

---

## 10. Quyết định khi review

Đã duyệt cả 5 điểm dưới đây.


1. Dùng **`ws` + giao thức JSON tự định nghĩa** (không dùng Socket.IO). Đồng ý?
2. Khách **không cần đăng nhập** vẫn theo dõi được sơ đồ ghế; thông báo cá nhân thì phải `AUTH`. Đồng ý?
3. Các con số giới hạn ở mục 6 (5 suất / kết nối, 20 tin / 10 giây, 20 kết nối / IP). Đồng ý?
4. **Một kênh Redis chung** cho mọi bản API (mục 5). Đồng ý?
5. Đơn hết hạn: tin `SEAT_RELEASED` có thể trễ tối đa ~30 giây (chờ sweeper) cho tới Phase 9. Đồng ý?
