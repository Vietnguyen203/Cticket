# Phase 6 — Redis: OTP, giới hạn request, cache, khóa ghế nhanh, đăng xuất tức thì

> Trạng thái: **đã chốt và đã triển khai** (theo file `Danh_sach_chuc_nang.xlsx`, xem mục 10).
>
> Nguyên tắc xuyên suốt: **PostgreSQL vẫn là nguồn sự thật.** Redis chỉ là bộ nhớ tạm để chạy nhanh hơn và chịu tải tốt hơn.
> Mất toàn bộ dữ liệu Redis (khởi động lại, xóa nhầm) thì hệ thống **vẫn đúng**: không bán trùng, không sai tiền, không sai trạng thái đơn. Hệ quả tệ nhất chỉ là: mã OTP đang chờ bị mất (khách bấm gửi lại), cache phải tính lại, bộ đếm rate limit về 0, token đã đăng xuất dùng lại được tới khi hết hạn (tối đa 15 phút).

---

## 1. Phạm vi

| # | Hạng mục | Mã trong file | Vì sao cần |
|---|---|---|---|
| 1 | Hạ tầng: container Redis, client `ioredis`, `/health/ready` kiểm tra Redis | INF-01, INF-02 | Nền cho mọi thứ bên dưới. `ioredis` cũng là thư viện BullMQ dùng (Phase 9) |
| 2 | **Chuyển OTP sang Redis** | AUTH-10 | Mã sống 10 phút, xóa ngay khi dùng; Redis có TTL sẵn (đã thống nhất từ Phase 2) |
| 3 | **Giới hạn số request** | RL-01, AUTH-03 | Chặn dò mật khẩu, spam email OTP, bot đặt vé |
| 4 | **Cache** danh mục, sự kiện, suất diễn, bố cục địa điểm / sơ đồ ghế | CACHE-01, CACHE-02 | Lúc mở bán hàng nghìn người cùng tải một trang |
| 5 | **Khóa ghế nhanh** khi đặt vé + cờ "còn bao nhiêu" cho vé đứng | BKG-01 | Từ chối người đến sau trong ~1 ms, không giữ kết nối PostgreSQL |
| 6 | **Đăng xuất là access token mất hiệu lực ngay** (denylist theo `jti`) | AUTH-05 | File yêu cầu bắt buộc |
| 7 | **Sửa hồ sơ** `GET/PATCH /users/me` | USR-01 | File yêu cầu bắt buộc; chưa có ở Phase 2 |
| 8 | Chỉnh số theo file: refresh token **7 ngày**, tối đa **8 vé/đơn** | AUTH-03, BKG-03 | Đang là 30 ngày và 10 vé |

**Không làm ở Phase 6:** WebSocket (P7), BullMQ (P9), thêm / bỏ từng ghế trong đơn đang giữ (BKG-02, chờ quyết định).

---

## 2. Hạ tầng

**Docker** (thêm service `redis`):
```yaml
redis:
  image: redis:7.4-alpine
  command: redis-server --requirepass $REDIS_PASSWORD --maxmemory 256mb --maxmemory-policy noeviction --save "" --appendonly no
  ports: ["127.0.0.1:${REDIS_PORT:-6379}:6379"]   # chỉ máy của bạn truy cập được (để chạy test)
  healthcheck: redis-cli ping
```
- **Không lưu xuống đĩa**: dữ liệu đều có TTL và mất được (xem nguyên tắc ở đầu).
- `noeviction`: BullMQ (P9) bắt buộc chính sách này. Mọi key của Phase 6 đều có TTL nên bộ nhớ tự giải phóng.
- `REDIS_PASSWORD` nằm trong `.env` (**không commit**). Mọi key có tiền tố `etp:`.

**Code**: `src/redis/client.js` (một kết nối dùng chung, đóng khi tắt server), `src/redis/scripts.js` (các script Lua chạy nguyên tử).

**Test**: Redis thật ở **database số 15** (`TEST_REDIS_URL`); `globalSetup` xóa sạch DB 15 trước mỗi lần chạy, giống `etp_test`.

**`/health/ready`**: thêm `checks.redis`. Redis down → `status: "degraded"` nhưng **vẫn 200**, vì API vẫn phục vụ được hầu hết request (mục 3).

---

## 3. Khi Redis bị lỗi thì sao?

| Chức năng | Redis lỗi thì | Lý do |
|---|---|---|
| Cache | Bỏ qua cache, đọc thẳng PostgreSQL | Chậm hơn nhưng vẫn đúng |
| Rate limit | **Cho qua** + log cảnh báo | Chặn hết request vì Redis lỗi còn tệ hơn; bcrypt và giới hạn 5 lần sai/mã OTP vẫn bảo vệ phía sau |
| Khóa ghế nhanh / cờ vé đứng | Bỏ qua, đi thẳng vào PostgreSQL như Phase 5 | PostgreSQL tự chống bán trùng |
| Denylist khi kiểm tra token | **Cho qua** + log | Token vẫn phải đúng chữ ký và còn hạn (tối đa 15 phút) |
| Denylist khi đăng xuất | Refresh token vẫn bị thu hồi trong PostgreSQL; chỉ access token sống tiếp tới khi hết hạn | Đăng xuất không bao giờ thất bại vì Redis |
| **OTP** | **`503 SERVICE_UNAVAILABLE`** | Mã chỉ nằm trong Redis. Không đoán bừa |

Mọi lệnh Redis có **timeout 200 ms** và không tự xếp hàng chờ khi mất kết nối, để một Redis chậm không kéo cả API chậm theo.

---

## 4. OTP trong Redis

| Key | Kiểu | TTL | Nội dung |
|---|---|---|---|
| `etp:otp:{purpose}:{userId}` | HASH | 600 s | `hash` (HMAC như hiện tại), `attempts` |
| `etp:otp:cooldown:{purpose}:{userId}` | STRING | 60 s | Chống bấm gửi liên tục |
| `etp:otp:hourly:{purpose}:{userId}` | counter | 3600 s (tính từ mã đầu tiên) | Tối đa 5 mã/giờ |

Hai **script Lua nguyên tử** (Redis chạy từng script một, không xen kẽ, nên không cần khóa dòng `users` như bản PostgreSQL):
- `otp_issue`: còn cooldown hoặc đã đủ 5 mã/giờ → 0. Ngược lại: đặt cooldown, tăng bộ đếm giờ, ghi mã mới (đè mã cũ) → 1.
- `otp_consume`: không có mã → 0. Đúng → **xóa key** (mỗi mã dùng 1 lần) → 1. Sai → tăng `attempts`, đủ 5 lần thì xóa key → 0.

**Phối hợp với PostgreSQL** (không chung transaction, nên thứ tự được chọn để lỗi giữa chừng không làm sai dữ liệu):
- *Đăng ký*: tạo user → **commit** → tạo mã trong Redis → gửi email. Redis lỗi ở bước 2: tài khoản đã có, khách bấm "gửi lại mã".
- *Xác thực*: `otp_consume` trước → đúng mã mới mở transaction kích hoạt / đổi mật khẩu. PostgreSQL lỗi ở bước 2: mã đã bị dùng, khách xin mã mới. Không bao giờ "kích hoạt mà chưa nhập đúng mã".
- API, mã lỗi, email **giữ nguyên**.

**Migration**: xóa các dòng OTP cũ trong `user_tokens` và **giữ bảng** (có trong schema gốc; dùng lại được cho link mời nhân viên sau này).

---

## 5. Giới hạn số request

**Thuật toán**: bộ đếm theo cửa sổ cố định, 1 script Lua (`INCR` + đặt TTL ở lần đầu, nguyên tử). Đơn giản, 1 lệnh Redis/request; sát ranh giới 2 cửa sổ có thể lọt gấp đôi trong chốc lát, chấp nhận được.

| API | Đếm theo | Giới hạn |
|---|---|---|
| `POST /auth/login` | IP | **5 / phút** (theo file) |
| `POST /auth/register` | IP | 10 / giờ |
| `POST /auth/otp` | IP | 10 / giờ (ngoài 1 mã/phút, 5 mã/giờ của từng tài khoản) |
| `POST /auth/otp/verify` | IP | 30 / 15 phút (ngoài 5 lần sai/mã) |
| `POST /auth/refresh` | IP | 60 / phút |
| `POST /schedules/:id/orders` | user | 10 / phút (chống bot) |
| Mọi API `/api/v1/*` ("API chung") | IP | 600 / phút (rộng tay vì nhiều người có thể chung một IP: wifi trường, công ty) |

- Khóa theo **IP**, không theo email: khóa theo email thì kẻ xấu nhập sai vài lần là khóa được tài khoản người khác đúng lúc mở bán.
- Vượt giới hạn → `429 RATE_LIMITED`, header `Retry-After` và `RateLimit-Limit / RateLimit-Remaining / RateLimit-Reset`.
- IP lấy từ `req.ip`. Chạy sau reverse proxy thì đặt `TRUST_PROXY` (biến môi trường mới), nếu không mọi người dùng chung IP của proxy.
- Bộ test chung **tắt** rate limit (hàng trăm request từ cùng 127.0.0.1); file test riêng bật lại.
- Bộ test chạy **tuần tự** (`maxWorkers: 1`): các file dùng chung Redis test, nên chạy song song thì file này làm mới cache của file kia.
- Môi trường test **luôn** trỏ SMTP vào một cổng đóng trên máy, để không bao giờ gửi email thật dù `.env` có cấu hình Gmail.

---

## 6. Cache (cache-aside)

| Dữ liệu | TTL | Làm mới khi |
|---|---|---|
| Danh mục | **1 giờ** | Danh mục thay đổi |
| Danh sách sự kiện công khai (theo từng bộ lọc) | 60 giây | Sự kiện / suất / hạng vé / danh mục / địa điểm thay đổi |
| Chi tiết sự kiện công khai (theo id và theo slug) | **10 phút** | như trên |
| Suất diễn của một sự kiện | 10 phút | như trên |
| Bố cục địa điểm (khu, ghế, tọa độ) | **1 giờ** | Khu / ghế của địa điểm thay đổi |
| Bố cục sơ đồ ghế của một suất (ghế, hạng vé, giá) | 1 giờ | Không đổi sau khi đăng (giá và sơ đồ đã bị khóa ở Phase 4) |

- **Làm mới bằng số phiên bản** (CACHE-02): key có dạng `etp:cache:catalog:v{N}:…`. Mỗi thay đổi (sau commit) chỉ tăng `N`; key cũ không ai đọc nữa và tự hết hạn. Không phải đi tìm và xóa từng tổ hợp bộ lọc.
- **Trạng thái ghế và số vé còn lại luôn đọc từ PostgreSQL** (đúng ghi chú SEAT-01: "layout từ cache + trạng thái từ DB"). Truy vấn này nhẹ (có index) và phải luôn mới.
- **Chỉ cache dữ liệu công khai.** Organizer xem bản nháp của mình, admin, tham số `mine` / `status`: luôn đọc thẳng PostgreSQL.
- **Chống dồn request**: khi key hết hạn đúng lúc nhiều request cùng tới, trong một tiến trình chỉ **một** request đọc PostgreSQL, các request còn lại chờ kết quả đó.
- Bước tăng phiên bản thất bại (Redis lỗi) thì cache cũ tối đa bằng TTL. Chấp nhận được vì **đặt vé luôn kiểm tra lại trong PostgreSQL**.

---

## 7. Khóa ghế nhanh khi đặt vé

Vấn đề của Phase 5 khi tải rất cao: hàng nghìn request cùng ghế A01 đều vào PostgreSQL, mỗi request **giữ một kết nối** trong lúc chờ khóa dòng. Pool chỉ có 20 kết nối nên người đặt ghế **khác** cũng phải chờ theo.

**Khóa "đang có người đặt" ngắn hạn trong Redis** (`SET NX` theo file):
```
1. Lua seat_lock: với MỌI ghế yêu cầu, SET etp:seatlock:{scheduleId}:{seatId} = {requestId} NX PX 5000
   - all-or-nothing: một ghế đang bị khóa → không khóa ghế nào
   → 409 SEATS_UNAVAILABLE, status "LOCKED" (đang có người đặt, thử lại sau vài giây). Không đụng PostgreSQL.
2. Luồng Phase 5 (Tx 1 + Tx 2): PostgreSQL vẫn quyết định cuối cùng.
3. finally: Lua seat_unlock xóa khóa, CHỈ khi giá trị vẫn là requestId của mình.
```
- **Vì sao chỉ 5 giây, không giữ suốt 10 phút?** Khóa dài phải được xóa đúng lúc khi đơn bị hủy / hết hạn; xóa hụt một lần (Redis lỗi) là ghế trống mà không ai đặt được suốt 10 phút. Khóa ngắn phủ đúng lúc tranh chấp nặng nhất; sau khi đơn commit, request đến sau thấy ghế `HELD` ngay trong PostgreSQL, không phải chờ.
- Khóa hết hạn trước khi transaction xong → request khác lọt vào PostgreSQL → PostgreSQL vẫn chặn đúng.

**Vé đứng: cờ "còn bao nhiêu"**: khi PostgreSQL báo `INSUFFICIENT_INVENTORY`, ghi `etp:ga-left:{ticketTypeId} = số còn lại` (TTL 3 s). Request sau xin nhiều hơn số đó → từ chối ngay. Cờ **không bị xóa** khi có vé được trả mà chỉ tự hết hạn: như vậy không phải sửa mọi đường trả vé (hủy, hết hạn, hủy sự kiện, mở khóa), đổi lại cờ có thể sai tối đa 3 giây.

**Thứ tự trong `POST /schedules/:id/orders`**: rate limit → khóa ghế Redis / cờ vé đứng → Phase 5 → mở khóa.

---

## 8. Đăng xuất tức thì (AUTH-05) và hồ sơ (USR-01)

**Denylist** (access token vẫn là JWT, chỉ thêm 1 lần đọc Redis cho mỗi request có đăng nhập):

| Key | TTL | Ý nghĩa |
|---|---|---|
| `etp:deny:jti:{jti}` | thời gian còn lại của token | Token này đã đăng xuất |
| `etp:deny:user:{userId}` | 15 phút (= tuổi thọ access token) | Mọi token phát **trước** thời điểm này bị từ chối (đặt lại mật khẩu; sau này: khóa tài khoản, đổi quyền) |

- `POST /auth/logout`: như cũ thu hồi refresh token; **thêm**: nếu request kèm access token hợp lệ thì đưa `jti` của nó vào denylist.
- `authenticate`: sau khi kiểm tra chữ ký, đọc 2 key trên bằng **một** lệnh `MGET`; trúng → `401 TOKEN_REVOKED`.
- Đặt lại mật khẩu: ngoài thu hồi mọi refresh token, ghi `deny:user` để các access token đang dùng ở thiết bị khác cũng mất hiệu lực ngay.

**Hồ sơ**: `GET /users/me` (như `/auth/me`) và `PATCH /users/me` sửa `firstName`, `lastName`, `phone` (số điện thoại trùng → `409 PHONE_TAKEN`). Email và mật khẩu không sửa ở đây.

---

## 9. Kiểm thử bắt buộc

- **OTP**: toàn bộ test auth hiện có pass với OTP trong Redis; mã dùng 1 lần; sai 5 lần thì mã bị hủy; 2 request xác thực cùng lúc với mã đúng → đúng 1 thành công; Redis lỗi → `503`.
- **Rate limit**: request thứ N+1 → `429` có `Retry-After`; IP khác không bị ảnh hưởng; Redis lỗi → vẫn cho qua.
- **Cache**: lần đọc thứ hai không chạm PostgreSQL; sửa / đổi trạng thái sự kiện → lần đọc sau thấy dữ liệu mới; bản nháp không bao giờ lọt vào cache công khai; giữ ghế xong → sơ đồ ghế thấy `HELD` ngay.
- **Khóa ghế** (TEST-02): **100 người cùng ghế → đúng 1 đơn**, cả khi **Redis đang bật** và khi **Redis bị tắt**; khóa của request A hết hạn không bị request B xóa nhầm.
- **Đăng xuất**: sau logout, access token cũ nhận `401 TOKEN_REVOKED`; đặt lại mật khẩu → token ở thiết bị khác cũng bị từ chối.
- Mọi test đồng thời của Phase 5 vẫn pass; `inventory:check` vẫn 0 lệch.

---

## 10. Quyết định đã chốt

| # | Câu hỏi | Chốt |
|---|---|---|
| 1 | Redis lỗi | Cache / rate limit / khóa ghế / kiểm tra denylist cho qua; OTP trả `503` |
| 2 | Rate limit | Theo file: đăng nhập 5 lần/phút/IP; các API khác như bảng mục 5 |
| 3 | Khóa ghế trong Redis | 5 giây ("đang có người đặt"), PostgreSQL quyết định cuối |
| 4 | Cache | Theo file: danh mục 1 giờ, chi tiết sự kiện 10 phút, bố cục 1 giờ; trạng thái ghế luôn đọc từ DB |
| 5 | Bảng `user_tokens` | Giữ bảng, chỉ xóa dữ liệu OTP cũ |
| 6 | Denylist JWT | **Làm ở Phase 6** (file ghi bắt buộc) |
| 7 | Hồ sơ, refresh token, vé/đơn | `PATCH /users/me`; refresh token 7 ngày; tối đa 8 vé/đơn (theo file) |
| 8 | Thêm / bỏ từng ghế trong đơn (BKG-02) | **Chưa làm**, chờ bạn quyết định (đổi mô hình đặt chỗ đã chốt ở Phase 5) |

## 11. Ước lượng

| Hạng mục | Giờ |
|---|---|
| Hạ tầng Redis (Docker, client, health, test setup) | 2 |
| OTP sang Redis + migration + sửa test auth | 4 |
| Rate limit | 4 |
| Cache (phiên bản, chống dồn request, các API) | 5 |
| Khóa ghế nhanh + cờ vé đứng | 4 |
| Denylist + hồ sơ + chỉnh số theo file | 4 |
| Test (gồm Redis bật / tắt, 100 request) | 5 |
| Postman + tài liệu | 2 |
| **Tổng** | **≈ 30 giờ** |
