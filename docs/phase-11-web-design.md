# Phase 11 — Web cho khách hàng và nhân viên soát vé (đã duyệt, đã triển khai)

> Mục tiêu: một trang web (chạy tốt cả trên điện thoại) đi hết luồng chính bằng API đã có:
> tìm sự kiện → chọn suất → **chọn ghế, thấy ghế người khác giữ ngay lập tức** → thanh toán → xem vé, mã QR → **nhân viên quét QR ở cổng bằng camera điện thoại**.
>
> Đặc tả gốc ghi React Native; theo quyết định của bạn, Phase 11 **làm web thay cho app**. Các chức năng APP-C01…S03 giữ nguyên, chỉ đổi nền tảng (file chức năng sẽ cập nhật "React Native" → "Web"). API không đổi, sau này làm app vẫn dùng lại được.
>
> Nguyên tắc giữ nguyên: **backend là nguồn sự thật**. Web không tự tính giá, không tự quyết ghế còn hay hết; WebSocket chỉ để màn hình cập nhật nhanh, mất kết nối thì tải lại từ REST.

---

## 1. Phạm vi

| Mã | Chức năng | Trang |
|---|---|---|
| APP-C01 | Đăng nhập, đăng ký | Đăng nhập, Đăng ký, Nhập mã OTP xác minh email, Quên mật khẩu (API có sẵn từ Phase 2) |
| APP-C02 | Khám phá sự kiện | Trang chủ, Tìm kiếm (từ khóa, danh mục, thành phố, ngày), Chi tiết sự kiện |
| APP-C03 | Chọn suất và chọn ghế | Chọn suất, **Sơ đồ ghế real-time** (WebSocket, tự kết nối lại), chọn số vé đứng |
| APP-C04 | Checkout và thanh toán | Xác nhận đơn + mã giảm giá, **đồng hồ đếm ngược hạn giữ ghế**, Thanh toán (giả lập) |
| APP-C05 | Đơn hàng và vé | Lịch sử đơn, Chi tiết đơn, Vé của tôi, Mã QR của vé |
| APP-C06 | Hồ sơ | Xem / sửa hồ sơ, Đăng xuất |
| APP-S01 | Nhân viên: chọn sự kiện | Sự kiện mình được gán → chọn suất → đặt tên cổng |
| APP-S02 | Nhân viên: quét QR, xem kết quả | Camera quét QR, kết quả xanh / đỏ kèm lý do |
| APP-S03 | Nhân viên: lịch sử check-in | Lịch sử + số đã vào / tổng (cập nhật real-time) |

**Không làm ở phase này**: trang quản trị cho admin / organizer (Phase 12, sẽ thêm vào **chính web này**), xem vé khi mất mạng (PWA), SEO / render phía server.

---

## 2. Công nghệ

| Phần | Chọn | Lý do |
|---|---|---|
| Khung | **Vite + React 19 + TypeScript**, dạng SPA | Trang chạy hoàn toàn trên trình duyệt, gọi API. Không dùng Next.js: không cần SEO, render phía server thêm một server Node nữa mà không giúp gì cho mục tiêu backend |
| Điều hướng | **React Router** (chế độ SPA) | Phổ biến nhất, đủ dùng |
| Gọi API | **Axios** | Như đặc tả. Interceptor gắn token, tự refresh |
| Giao diện | **Tailwind CSS** | Làm giao diện responsive (điện thoại / máy tính) nhanh, không phải viết nhiều file CSS |
| Quét QR | Camera trình duyệt (`getUserMedia`) + **`BarcodeDetector`** | API chuẩn của trình duyệt, Chrome Android có sẵn. Trình duyệt chưa có (Chrome trên Windows, Firefox, Safari) dùng **`barcode-detector`** (bản bù cùng API, đang được bảo trì); file `.wasm` của nó tự phục vụ từ web, không tải từ CDN |
| Ảnh QR | Ảnh PNG từ `GET /tickets/:id/qr.png` (Phase 10) | Tải bằng Axios kèm token rồi hiển thị (thẻ `<img>` không gửi được header `Authorization`). Không thêm thư viện vẽ QR |
| Trạng thái | React Context (đăng nhập) + vài hook nhỏ tự viết | Không thêm Redux / TanStack Query; tự viết để hiểu rõ loading / lỗi / tải lại |
| Test | **Vitest** cho phần logic | Xem mục 11 |

Thư mục mới **`frontend/`** ở gốc repo, cạnh `backend/`.

---

## 3. Cấu trúc thư mục

```
frontend/
  index.html
  vite.config.ts             proxy /api và /ws → API (mục 5)
  Dockerfile, nginx.conf     build tĩnh + nginx (mục 10)
  src/
    main.tsx, App.tsx        AuthProvider + Router
    config.ts
    api/
      client.ts              axios: gắn token, tự refresh, chuẩn hóa lỗi
      errors.ts              ApiError { status, code, message, details } + câu tiếng Việt cho từng mã lỗi
      auth.ts events.ts orders.ts payments.ts tickets.ts checkins.ts users.ts
      types.ts               kiểu dữ liệu trả về (viết tay theo API)
    auth/
      AuthContext.tsx        user, roles, login, logout, register
      refresh.ts             refresh một lần tại một thời điểm, giữa các tab (mục 5)
    realtime/
      RealtimeClient.ts      kết nối, AUTH, SUBSCRIBE, tự nối lại
      useScheduleSeats.ts    sơ đồ ghế = REST + tin WebSocket
      seatMapReducer.ts      gộp tin cập nhật theo version (hàm thuần, có test)
    pages/
      auth/        Login, Register, VerifyEmail, ForgotPassword
      customer/    Home, Search, EventDetail, SeatSelect, Checkout, Payment, Orders, OrderDetail, MyTickets, TicketQr, Profile
      staff/       StaffEvents, Scanner, CheckInHistory
    components/    Layout, Button, ErrorView, Countdown, SeatGrid, EventCard, QrScanner…
    utils/         format tiền / ngày giờ, useCountdown, serverClock, uuid
```

---

## 4. Một web, hai khu

- Mọi tài khoản đều là khách hàng: **Trang chủ · Tìm kiếm · Vé của tôi · Đơn hàng · Tài khoản**.
- Tài khoản có role **STAFF** (organizer gán ở Phase 10) thấy thêm mục **Soát vé** (`/staff`): chọn sự kiện → chọn suất → nhập tên cổng → quét.
- Role đọc từ access token (JWT đã có `roles`). Trang Soát vé vẫn bị backend kiểm tra quyền; ẩn menu chỉ để gọn giao diện, không phải để bảo mật.
- **Ưu tiên điện thoại** (mobile-first): nhân viên soát vé dùng điện thoại, khách cũng hay mua trên điện thoại.

---

## 5. Đăng nhập và token trên trình duyệt (APP-C01, phần cần quyết định)

### 5.1 Để token ở đâu?

| Cách | Ưu | Nhược |
|---|---|---|
| `localStorage` | Đơn giản, không sửa backend | **Script độc (XSS) đọc được** → lấy được refresh token dùng 7 ngày |
| Chỉ trong bộ nhớ | XSS khó lấy | Tải lại trang là mất, phải đăng nhập lại |
| **Cookie `httpOnly`** (đề xuất) | **JavaScript không đọc được**, kể cả script độc; tự gửi kèm khi gọi `/auth/refresh` | Phải sửa backend một chút; phải chống CSRF |

**Đề xuất**: access token (15 phút) chỉ để **trong bộ nhớ**; refresh token (7 ngày) trong **cookie httpOnly**. Tải lại trang → web gọi `/auth/refresh`, cookie tự đi kèm → có access token mới.

**Sửa backend (bật theo yêu cầu, không ảnh hưởng Postman / test cũ)**: request đăng nhập / refresh / đăng xuất có header `X-Auth-Transport: cookie` thì server:
- đặt `Set-Cookie: etp_refresh=…; HttpOnly; SameSite=Strict; Path=/api/v1/auth; Max-Age=7 ngày` (+ `Secure` khi chạy production),
- **không** trả `refreshToken` trong body (nếu trả, script độc đọc được response là mất tác dụng),
- `/auth/refresh` và `/auth/logout` đọc refresh token từ cookie khi body không có; đăng xuất thì xóa cookie.

Không có header đó: giữ nguyên như Phase 2 (token trong body).

**Chống CSRF** (trang lạ lừa trình duyệt gọi `/auth/refresh` bằng cookie của nạn nhân): `SameSite=Strict` (cookie không được gửi khi request xuất phát từ trang web khác) **và** bắt buộc header `X-Auth-Transport` (form HTML của trang lạ không tự thêm header được; `fetch` khác nguồn có header lạ thì trình duyệt phải hỏi trước (preflight) và server không cho phép).

### 5.2 Cùng một nguồn (origin)

Trình duyệt chỉ thấy **một địa chỉ** cho cả web và API:
- Khi dev: Vite (`http://localhost:5173`) chuyển tiếp `/api/*` và `/ws` sang API `localhost:3001`.
- Trong Docker: nginx phục vụ web và chuyển tiếp `/api`, `/ws` sang container `api` (mục 10).

Nhờ vậy không cần CORS, cookie đơn giản. Chỉ cần thêm địa chỉ web vào `CORS_ORIGINS` (sửa `.env`, không sửa code): WebSocket kiểm tra header `Origin` (Phase 7) và trình duyệt luôn gửi `Origin`.

### 5.3 Refresh: chỉ một lần tại một thời điểm, kể cả giữa các tab

Backend **xoay vòng refresh token** (Phase 2): mỗi lần refresh, token cũ bị thu hồi; ai dùng lại token cũ bị coi là **token bị đánh cắp** → thu hồi cả phiên (`REFRESH_TOKEN_REUSED`), người dùng bị đăng xuất. Hai trường hợp dễ dính:
- **Trong một tab**: trang Chi tiết đơn gọi 3 API song song, cả 3 nhận `401 TOKEN_EXPIRED`. Nếu mỗi cái tự refresh → lần thứ hai dùng lại token cũ → bị đăng xuất. Cách làm: request đầu tạo một promise refresh, các request khác **chờ chung promise đó** rồi gửi lại.
- **Giữa các tab**: cookie dùng chung cho mọi tab. Mở 2 tab cùng lúc, cả hai cùng refresh bằng cùng một cookie → tab chậm hơn bị coi là dùng lại token cũ. Cách làm: **Web Locks API** (`navigator.locks`): chỉ một tab refresh tại một thời điểm, tab sau chờ xong rồi mới gửi (lúc đó cookie đã là token mới).

Đăng xuất ở một tab → báo các tab khác (`BroadcastChannel`) để cùng đăng xuất.

### 5.4 Các trang

- **Đăng ký**: form → `POST /auth/register` → nhập OTP 6 số (gửi lại sau 60 giây) → `POST /auth/otp/verify` → tự đăng nhập bằng mật khẩu vừa nhập (chỉ giữ trong bộ nhớ của trang).
- **Quên mật khẩu**: email → OTP + mật khẩu mới (API Phase 2).
- Lỗi hiện bằng câu tiếng Việt theo `error.code`; lỗi validate hiện dưới từng ô nhập (`details[].field`). Trang cần đăng nhập → chuyển tới Đăng nhập, xong quay lại đúng trang đang xem.

---

## 6. Sơ đồ ghế real-time (APP-C03, phần khó nhất)

**Nguồn dữ liệu**: `GET /schedules/:id/seat-map` (trạng thái + `version` từng ghế) + WebSocket room `schedule:{id}`.

```
Mở trang sơ đồ ghế:
  1. Kết nối WebSocket (/ws), SUBSCRIBE scheduleId
  2. Sau khi SUBSCRIBED: tải seat-map qua REST   ← tải SAU khi đăng ký, để không lọt tin nào ở giữa
  3. Tin SEAT_HELD / SEAT_RELEASED / SEAT_SOLD / SEAT_BLOCKED:
       chỉ áp dụng nếu version mới > version đang có (tin đến trễ / trùng bị bỏ qua)
     INVENTORY_UPDATED: cập nhật số vé đứng còn lại
Mất kết nối → tự nối lại: chờ 1s, 2s, 4s… tối đa 30s (+ ngẫu nhiên, để hàng nghìn trình duyệt không nối lại cùng một giây)
           → SUBSCRIBE lại → TẢI LẠI seat-map (tin trong lúc mất kết nối đã mất)
Tab bị ẩn lâu / máy ngủ / mất mạng rồi có lại (sự kiện visibilitychange, online) → kiểm tra kết nối, tải lại
```

- Ghế vẽ theo **hàng** (`rowLabel`, sắp theo `seatNumber`), màu theo trạng thái: còn trống (màu theo hạng vé, kèm chú thích giá), đang chọn, người khác đang giữ, đã bán, bị khóa. Khu đứng: chọn số lượng, hiện "còn N vé".
- **Chọn ghế** chỉ là chọn trên máy mình. Bấm **"Giữ chỗ"** → `POST /schedules/:id/orders` → server giữ ghế 10 phút → **mọi người khác đang xem thấy ghế đổi sang "đang giữ" ngay** (đúng ví dụ trong đặc tả: A giữ A01, màn hình B đổi A01 ngay).
- Ghế mình đang chọn bị người khác giữ trước (tin `SEAT_HELD` tới) → tự bỏ chọn + báo "Ghế A01 vừa có người giữ". Bấm Giữ chỗ mà ghế vừa hết (`SEATS_UNAVAILABLE`) → báo, tải lại sơ đồ.
- 8 vé / đơn và `maxPerOrder` kiểm tra luôn trên web cho nhanh, **server vẫn là bên quyết định**.
- Đã có đơn đang giữ ở suất này (`ACTIVE_ORDER_EXISTS`) → đưa tới đơn đó.
- **Token của WebSocket**: gửi `AUTH` bằng access token (để nhận tin cá nhân: đơn hết hạn, thanh toán, vé đã phát hành, CHECK_IN_SUCCESS). Server báo `AUTH_EXPIRED` → web refresh rồi gửi lại `AUTH`.

---

## 7. Checkout và thanh toán (APP-C04)

- **Xác nhận đơn**: ghế / vé, giá do **server tính** (đặc tả: không tin giá phía client gửi), ô mã giảm giá (`POST /promotions/validate` để xem trước), nút Checkout (`POST /orders/:id/checkout`).
- **Đồng hồ đếm ngược** tới `expiresAt`. Đồng hồ máy người dùng có thể sai vài phút, nên web tính **độ lệch với giờ server** từ header `Date` của response và đếm theo giờ server. Hết giờ (hoặc nhận tin `ORDER_EXPIRED`) → báo "Hết thời gian giữ chỗ", về sơ đồ ghế. Đóng trang giữa chừng thì đơn vẫn giữ tới hết hạn, mở lại từ trang Đơn hàng.
- **Thanh toán giả lập**: 2 nút **"Thanh toán"** và **"Giả lập thẻ bị từ chối"** (`simulate: FAILED`; thanh toán lại được như Phase 8).
- **Idempotency-Key**: tạo **một key cho mỗi lần bấm Thanh toán**; mạng lỗi mà gửi lại thì **dùng lại đúng key đó** → server trả lại kết quả cũ, không trừ tiền hai lần. Nút bị khóa trong lúc chờ. (Key sinh bằng `crypto.getRandomValues`, chạy được cả khi không có HTTPS.)
- Thành công → "Đặt vé thành công"; vé hiện khi worker phát hành xong (tin `TICKET_ISSUED`).

---

## 8. Đơn hàng, vé, QR, hồ sơ (APP-C05, APP-C06)

- **Đơn hàng**: `GET /orders` (phân trang, lọc trạng thái), `GET /orders/:id`; đơn đang giữ có nút tiếp tục thanh toán / hủy.
- **Vé của tôi**: `GET /tickets`, chia "Sắp diễn" / "Đã qua"; trạng thái Còn hiệu lực / Đã sử dụng / Đã hoàn tiền.
- **Mã QR**: ảnh từ `qr.png`, mã vé `TKT-…` bên dưới, nút tải ảnh về. Vé đã hoàn tiền không có QR (server chặn từ Phase 10).
- **Hồ sơ**: `GET/PATCH /users/me` (tên, số điện thoại), Đăng xuất.

---

## 9. Trang nhân viên (APP-S01..S03)

```
Soát vé → GET /staff/events → chọn sự kiện → chọn suất → nhập tên cổng (nhớ trên máy này) → Camera
Đọc được QR → POST /check-ins { qrToken, scheduleId, deviceId: "<tên cổng>" }
  201 → XANH: hạng vé, ghế / "vé đứng #2", mã vé, số đã vào / tổng; tiếng bíp + rung (Android)
  409 TICKET_ALREADY_USED → ĐỎ: "Vé đã vào lúc 19:05, cổng A, nhân viên …"
  422 QR_INVALID / WRONG_SCHEDULE (kèm suất đúng) / CHECKIN_NOT_OPEN / CHECKIN_CLOSED, 409 TICKET_NOT_VALID → ĐỎ kèm lý do
  403 → "Bạn không còn được gán cho sự kiện này"
→ tự quét tiếp sau 2–3 giây
```

- **Camera trên trình duyệt chỉ chạy ở HTTPS hoặc `localhost`** (quy định của trình duyệt). Máy tính có webcam: `http://localhost:5173` dùng được ngay. Điện thoại: chạy web bằng **HTTPS với chứng chỉ tự ký** khi dev (lệnh `npm run dev:https`, điện thoại bấm "vẫn tiếp tục" một lần); bản Docker cũng có cổng HTTPS.
- **Ô dán mã thủ công**: dán nội dung QR khi camera lỗi, và để test trên máy không có camera.
- **Chống quét lặp**: camera đọc cùng một QR nhiều lần mỗi giây → dừng quét khi đang gửi, bỏ qua mã vừa quét trong 3 giây. (Nếu vẫn lọt, server chỉ cho vào một lần: Phase 10.)
- **Lịch sử + thống kê**: `GET /schedules/:id/check-ins`, `GET /schedules/:id/check-in-stats`; số đã vào cập nhật ngay nhờ tin `CHECK_IN_SUCCESS`.

---

## 10. Thay đổi backend và Docker

1. **Refresh token qua cookie httpOnly** (mục 5.1), bật bằng header `X-Auth-Transport: cookie`. Có test: cookie được đặt đúng thuộc tính, body không có refresh token, refresh / logout bằng cookie, thiếu header thì không dùng cookie, luồng cũ (body) không đổi.
2. **Cấu hình**: `CORS_ORIGINS` thêm địa chỉ web (chỉ sửa `.env`).
3. **Docker**: thêm service **`web`**: build web thành file tĩnh, **nginx** phục vụ và chuyển tiếp `/api`, `/ws` sang `api` (cổng 8080; HTTPS tự ký ở 8443 để điện thoại dùng camera). Đặc tả để container frontend là tùy chọn; với web thì nên có, vì đó là cách chạy giống production.

Không cần API mới: mọi trang dùng API đã có từ Phase 2–10.

---

## 11. Chạy và kiểm thử

**Chạy khi dev**: Docker (api, worker…) như cũ + `cd frontend && npm run dev` → `http://localhost:5173`.
Thử real-time: **một cửa sổ thường + một cửa sổ ẩn danh** (hai người dùng khác nhau; hai tab cùng cửa sổ là cùng một tài khoản).

**Test tự động** (Vitest, `npm test` trong `frontend/`), cho phần logic dễ sai:
- Refresh: 3 request cùng nhận 401 → chỉ 1 lần gọi `/auth/refresh`, cả 3 gửi lại thành công; refresh lỗi → đăng xuất; khóa giữa các tab được dùng.
- Gộp tin sơ đồ ghế: tin cũ (version thấp) bị bỏ qua; ghế đang chọn bị người khác giữ thì bỏ chọn.
- WebSocket nối lại: thời gian chờ tăng dần, gửi lại AUTH + SUBSCRIBE, tải lại seat-map.
- Đếm ngược theo giờ server; Idempotency-Key giữ nguyên khi gửi lại.
- Backend: test cho chế độ cookie (mục 10). Toàn bộ test cũ vẫn pass.

**Không làm ở phase này**: test giao diện tự động / E2E. Đề xuất để **Phase 13 (Testing)**: Playwright mở 2 trình duyệt, cùng giữ một ghế, kiểm tra trình duyệt kia đổi màu ngay (rất hợp để demo).

**Kịch bản test tay chính** (mình gửi khi xong mỗi bước): A giữ ghế → B thấy đổi màu ngay; tắt mạng rồi bật lại → sơ đồ tự đúng lại; thanh toán thành công / bị từ chối; hết giờ giữ chỗ; tải lại trang vẫn đăng nhập; 2 tab không bị đăng xuất; quét vé hợp lệ / quét lại / vé suất khác / QR bị sửa.

---

## 12. Làm theo 4 bước

Mỗi bước xong bạn chạy thử trên trình duyệt rồi commit (cùng nhánh `feature/phase-11-web`):

| Bước | Nội dung | Mã |
|---|---|---|
| 11.1 | Khởi tạo Vite + React + TS + Tailwind, khung trang, gọi API, đăng nhập / đăng ký / OTP / quên mật khẩu, refresh token (backend: cookie httpOnly), hồ sơ | C01, C06 |
| 11.2 | Trang chủ, tìm kiếm, chi tiết sự kiện, chọn suất, **sơ đồ ghế real-time**, giữ chỗ | C02, C03 |
| 11.3 | Checkout, đếm ngược, thanh toán, đơn hàng, vé của tôi, mã QR | C04, C05 |
| 11.4 | Trang nhân viên: chọn sự kiện, quét QR, kết quả, lịch sử + thống kê real-time; service `web` (nginx) trong Docker | S01–S03 |

---

## 13. Ước lượng

| Hạng mục | Giờ |
|---|---|
| Khởi tạo, khung trang, gọi API, xử lý lỗi; đăng nhập / đăng ký / OTP / quên mật khẩu, refresh giữa các tab (C01) | 12 |
| Backend: refresh token qua cookie httpOnly + test | 4 |
| Trang chủ, tìm kiếm, chi tiết (C02) | 10 |
| Chọn suất + sơ đồ ghế + WebSocket + nối lại (C03) | 16 |
| Checkout, đếm ngược, thanh toán (C04) | 9 |
| Đơn hàng, vé, QR (C05) | 8 |
| Hồ sơ (C06) | 3 |
| Nhân viên: chọn sự kiện (S01), quét + kết quả (S02), lịch sử (S03) | 19 |
| Docker: service `web` (nginx, HTTPS tự ký) | 2 |
| Test logic + tài liệu | 6 |
| **Tổng** | **≈ 89 giờ** (file: Phase 11 = 90h cho React Native) |

---

## 14. Cần quyết định khi review

1. **Web SPA: Vite + React 19 + TypeScript + React Router + Axios** (không Next.js). Đồng ý?
2. **Tailwind CSS** cho giao diện. Đồng ý?
3. **Một web hai khu**: khách hàng và `/staff` (chỉ hiện với role STAFF), giao diện ưu tiên điện thoại. Đồng ý?
4. **Refresh token trong cookie httpOnly**, access token trong bộ nhớ (backend sửa phần auth, bật bằng header nên Postman / test cũ không đổi). Hay đơn giản hơn: để trong `localStorage` (không sửa backend, kém an toàn hơn)?
5. **Một nguồn cho web và API**: proxy của Vite khi dev, nginx (service `web`) trong Docker. Đồng ý?
6. **Giữ ghế khi bấm "Giữ chỗ"** (API hiện tại); giữ ngay từng ghế khi chạm cần BKG-02, để sau. Đồng ý?
7. **Quét QR bằng camera trình duyệt** (`BarcodeDetector` + bản bù `barcode-detector`), có ô dán mã thủ công; điện thoại cần HTTPS tự ký khi dev. Đồng ý?
8. **Thanh toán giả lập** 2 nút: thành công / thẻ bị từ chối. Đồng ý?
9. **Không thêm thư viện quản lý trạng thái**; **Vitest cho phần logic**, E2E (Playwright) để Phase 13. Đồng ý?
10. **Làm theo 4 bước** ở mục 12, mỗi bước bạn chạy thử rồi commit. Đồng ý?

Đã duyệt cả 10 điểm (điểm 4: cookie httpOnly).

---

## 15. Ghi chú triển khai

### Bước 11.1 (xong): khung web, đăng nhập, hồ sơ

- **Backend** (`modules/auth/refresh-cookie.js`): cookie `etp_refresh` (`HttpOnly`, `SameSite=Strict`, `Path=/api/v1/auth`, 7 ngày, `Secure` khi production; đổi bằng `REFRESH_COOKIE_SECURE`). Refresh thất bại ở chế độ cookie thì xóa luôn cookie. Đăng xuất không cần cookie vẫn thu hồi được access token. Thêm 4 test; toàn bộ 216 test pass.
- `CORS_ORIGINS`: `backend/.env.example` và `docker-compose.yml` (service `api`) có sẵn `http://localhost:5173`, `http://localhost:8080`, `https://localhost:8443`.
- **Web** (`frontend/`): Vite 8, React 19, TypeScript 6, React Router 8, Axios, Tailwind 4, Vitest 5. Trang: Đăng nhập, Đăng ký, Xác minh email, Quên mật khẩu, Tài khoản. Email chuyển giữa các trang bằng `state` của router, không đưa lên URL; mật khẩu vừa đăng ký chỉ giữ trong bộ nhớ để tự đăng nhập sau khi xác minh.
- **Thử thật trên trình duyệt** (API tạm gửi mail vào Mailpit, không gửi mail thật): đăng ký → OTP → tự đăng nhập; `document.cookie` rỗng (cookie httpOnly), `localStorage` trống; tải lại trang vẫn đăng nhập (1 lần refresh); đăng xuất ở một tab thì tab kia cũng đăng xuất; quên mật khẩu → đăng nhập lại.
- **Kiểm chứng lý do dùng Web Locks**: 2 lần refresh cùng lúc bằng cùng cookie → lần 2 nhận `REFRESH_TOKEN_REUSED` (cả phiên bị thu hồi); bọc trong `navigator.locks` → cả hai đều thành công.
- Test web (Vitest, 11 test): refresh chạy một lần cho nhiều request, refresh bị từ chối thì kết thúc phiên, mất mạng không đăng xuất, có dùng Web Lock, chỉ thử lại một lần, không refresh quanh `/auth/*`, refresh trước khi token hết hạn, lỗi mạng / lỗi validate ra tiếng Việt.

### Bước 11.2 + 11.3 (xong): mua vé, thanh toán, vé QR

(Làm sau Phase 12.1–12.3 theo yêu cầu.)

- **Sự kiện**: `/events` (tìm kiếm), `/events/:slug` (lịch diễn, giá, trạng thái bán, nút "Chọn chỗ").
- **Chọn chỗ** `/events/:slug/schedules/:id`: sơ đồ ghế theo hàng, màu theo hạng vé; vé đứng chọn số lượng; nhãn "Cập nhật trực tiếp / Đang kết nối lại"; ghế đang chọn bị người khác giữ thì tự bỏ chọn và báo; giới hạn 8 vé / đơn và tối đa mỗi hạng; "Giữ chỗ" → đơn HELD 10 phút (lỗi ghế vừa hết thì tải lại sơ đồ; đã có đơn đang giữ thì có link tới đơn đó).
- **Đơn hàng** `/orders/:id`: đồng hồ đếm ngược **theo giờ server** (độ lệch tính từ header `Date` của mỗi response); mã giảm giá (xem trước, lý do từ chối bằng tiếng Việt); "Tiếp tục thanh toán" (checkout); thanh toán giả lập "Thanh toán" / "Giả lập thẻ bị từ chối" với **Idempotency-Key mới cho mỗi lần bấm, dùng lại đúng key nếu mạng lỗi và gửi lại**; tự tải lại khi có tin WebSocket về đơn (hết hạn, đã thanh toán, vé đã phát hành) hoặc hết giờ; hủy đơn.
- **Đơn hàng của tôi** `/orders`, **Vé của tôi** `/tickets` (sắp diễn / đã qua), **Vé** `/tickets/:id` (ảnh QR tải bằng token → object URL, tải ảnh về, mã vé).
- Test web: thêm đồng hồ server (48 test).
- Đã thử trên trình duyệt (API tạm, Mailpit): một người khác giữ A03, A04 qua API → trên web hai ghế đổi màu ngay, A03 đang chọn bị bỏ và có thông báo; mua A05, A06 + 1 vé đứng → mã sai bị báo "Mã không tồn tại" → mã WEB12TEST giảm 100.000đ (15%, trần 100.000đ) → checkout → thẻ bị từ chối → thanh toán lại thành công → 3 vé, xem QR.
- Lưu ý khi dev: WebSocket kiểm tra `Origin`; web chạy ở cổng khác 5173 thì phải thêm vào `CORS_ORIGINS` của API.


### Bước 11.4 (xong): trang nhân viên soát vé, Docker `web`

- **Menu "Soát vé"** hiện khi tài khoản có vai trò STAFF. Các trang được chặn bằng quyền: `/staff` và lịch sử cần `checkin:read`, trang quét cần `checkin:create` (API vẫn kiểm tra lại mọi lần gọi).
- **`/staff`** (APP-S01): các sự kiện mình được thêm vào đội soát vé và các suất chưa kết thúc. Ô "Tên cổng của máy này" (vd. "Cổng A") lưu trong `localStorage` của máy (chỉ cho tiện, không phải bí mật) và gửi lên làm `deviceId` của mỗi lượt quét.
- **`/staff/scan/:scheduleId`** (APP-S02, S03):
  - Camera sau (`getUserMedia`, `facingMode: environment`), đọc 4 lần/giây. Dùng `BarcodeDetector` có sẵn của trình duyệt (Android Chrome, Safari mới); nơi không có (Chrome trên Windows, Firefox) thì tải bản thay thế `barcode-detector` (ZXing WASM, ~1 MB, chỉ tải khi mở trang quét).
  - Cùng một mã đứng trước camera nhiều khung hình → chỉ gửi **một lần trong 3 giây** (`createScanGate`); trong lúc kiểm tra và lúc hiện kết quả thì tạm dừng đọc.
  - Kết quả **phủ toàn màn hình** 2,5 giây: xanh "Mời vào" + hạng vé, ghế, mã vé, "Đã vào x / y"; đỏ kèm lý do: vé đã dùng (lúc nào, ở cổng nào, nhân viên nào), sai suất, chưa tới giờ / đã hết giờ soát vé, vé không còn hiệu lực, QR không hợp lệ, không có quyền. Kèm tiếng bíp (WebAudio) và rung (điện thoại). Chạm để quét tiếp ngay.
  - Bộ đếm "đã vào / tổng" cập nhật **real-time** khi cổng khác quét (tin `CHECK_IN_SUCCESS` vào phòng riêng của nhân viên).
  - Không mở được camera (không phải HTTPS, bị chặn quyền, máy không có camera) → hiện hướng dẫn; luôn có ô **dán mã** (máy quét cầm tay dạng bàn phím cũng gõ vào ô này).
- **`/staff/history/:scheduleId`** (CHK-02, CHK-03): đã vào x / y, thanh tiến độ theo từng hạng vé; danh sách lượt vào mới nhất trước (giờ, vé, cổng, nhân viên), phân trang.
- **Docker**: service `web` (`frontend/Dockerfile`: build bằng Node rồi chạy nginx). nginx phục vụ file build và chuyển `/api`, `/ws` sang `api:3000` (một origin, giống Vite khi dev). `http://localhost:8080` cho máy tính, `https://<ip-máy-tính>:8443` cho điện thoại (camera cần HTTPS). Chứng chỉ **tự ký** tạo lúc container chạy lần đầu, lưu trong volume `webcerts` (điện thoại cảnh báo một lần, chọn tiếp tục). Chỉ dùng cho dev, không dùng production. File build có hash được cache 1 năm, `index.html` không cache.
- **Lưu ý điện thoại**: WebSocket kiểm tra `Origin`, nên thêm `https://<ip-máy-tính>:8443` vào `CORS_ORIGINS` trong `.env` (nếu không, quét vẫn được nhưng bộ đếm chỉ tự cập nhật sau mỗi lượt quét của chính máy đó). Cookie refresh có cờ `Secure` khi production, nên trên điện thoại dùng địa chỉ https.
- Test web: kết quả quét (vào / vé đã dùng / sai suất / lỗi khác) và chống gửi trùng (51 test).
- Đã thử trên trình duyệt qua nginx (`http://localhost:8080`): chọn suất, đặt tên cổng; dán mã vé hợp lệ → "Mời vào", 1/3; dán lại → "Vé đã được sử dụng" kèm giờ, cổng, nhân viên; mã sai → "Mã QR không hợp lệ"; một "Cổng B" quét qua API → bộ đếm 1/3 → 2/3 ngay (WebSocket qua nginx); trang lịch sử đúng. Bộ giải mã thay thế (WASM) đọc đúng ảnh QR của vé (70 ms). 
- **Thử trên iPhone** (Safari, `https://<ip>:8443`): camera mở được, bộ đọc thay thế đọc QR trên màn hình máy tính; vé hợp lệ → "Mời vào" (lưu cổng "Cổng A"), quét lại → "Vé đã được sử dụng"; vé của sự kiện khác → "Vé không phải của sự kiện này" (API trả `FORBIDDEN` vì nhân viên không thuộc sự kiện của vé). Lưu ý: ứng dụng quét mã có sẵn của điện thoại chỉ thấy một chuỗi (QR không chứa link), phải quét bằng trang web.
- Sửa thêm khi thử: trên điện thoại menu bị tràn ngang (khuất "Ban tổ chức", "Soát vé") → nút ☰ mở danh sách các mục.
