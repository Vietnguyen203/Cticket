# Phase 23 — Theo dõi hệ thống

> Trạng thái: **đã làm** (duyệt cả 4 điểm ở mục 10). Khác thiết kế: mục 11.

## 1. Vấn đề

Hệ thống đã có:

- log JSON một dòng cho mỗi request, có `X-Request-Id`, che mật khẩu và token (`utils/logger.js`, `middleware/requestLogger.js`);
- `/health/live` và `/health/ready`; tài liệu deploy gợi ý UptimeRobot gọi `/health/ready` để báo khi web sập.

Còn thiếu: không có **số đo** nào (API chậm hay nhanh, bao nhiêu request lỗi, job nền có bị dồn không, worker còn chạy không, hoàn tiền VNPay có bị kẹt không…). Muốn biết thì phải đọc log bằng tay. Không có **cảnh báo**: worker chết hay email không gửi được thì không ai biết, cho tới khi khách phàn nàn. Lỗi JavaScript trên trình duyệt của khách thì máy chủ không bao giờ thấy.

## 2. Phạm vi

Đã chọn khi hỏi:

- **Trang "Tình trạng hệ thống" trong khu quản trị**, không thêm container (Prometheus / Grafana): nhẹ cho một VPS, không phải bảo vệ thêm trang nào.
- **Cảnh báo qua email** cho admin khi vượt ngưỡng.
- **Lỗi JavaScript của web** được gửi về API (không dùng dịch vụ ngoài, CSP giữ nguyên).

Không làm: lưu log tập trung (Loki, ELK), tracing phân tán, số đo lâu hơn 24 giờ, giám sát khi **cả máy chủ** sập (máy chủ sập thì không tự báo được: vẫn cần UptimeRobot từ bên ngoài, như `docs/deployment.md`).

## 3. Số đo nào

| Nhóm | Số đo | Lấy từ |
|---|---|---|
| **API** | số request / phút; tỉ lệ lỗi 5xx; số 4xx, số 429 (bị giới hạn tần suất); độ trễ p50 / p95; 5 đường dẫn chậm nhất (theo p95) | middleware đo mỗi request |
| **Cơ sở dữ liệu** | lên / xuống, thời gian ping; kết nối của pool: tổng / rảnh / đang chờ | `pool` của `pg` |
| **Redis** | lên / xuống, thời gian ping, bộ nhớ đang dùng | `PING`, `INFO memory` |
| **Job nền** (BullMQ) | mỗi hàng đợi: đang chờ / đang chạy / hẹn giờ / lỗi; job chờ lâu nhất bao lâu; **worker còn sống** (nhịp tim mỗi 30 giây) | `getJobCounts`, khóa nhịp tim trên Redis |
| **Real-time** | số kết nối WebSocket đang mở (cộng mọi tiến trình API) | `hub.connections` |
| **Nghiệp vụ** | thanh toán lỗi trong 1 giờ; hoàn tiền VNPay `FAILED`, hoặc `PENDING` quá 1 giờ; đơn `PAYMENT_PENDING` quá hạn chưa xử lý; người đang chờ trong hàng chờ mua vé | truy vấn PostgreSQL, Redis |
| **Máy chủ** | dung lượng ổ đĩa còn trống (thư mục ảnh tải lên); bộ nhớ và thời gian chạy của tiến trình API | `fs.statfs`, `process.memoryUsage` |
| **Web** | số lỗi JavaScript / phút; các lỗi gần nhất, gộp theo nội dung | mục 6 |

## 4. Đo request: nhiều tiến trình, một kết quả

API có thể chạy nhiều tiến trình (`API_WORKERS`) và nhiều bản (stack đo tải), nên số đo không giữ trong bộ nhớ của một tiến trình mà gộp trên **Redis**:

- Middleware `metrics` (ngay sau `requestLogger`) đếm trong bộ nhớ: số request theo nhóm mã trạng thái, và **histogram độ trễ** với các mốc cố định (25, 50, 100, 250, 500, 1.000, 2.500, 5.000 ms, trên 5 giây), theo **mẫu đường dẫn** (`/events/:id`, không phải id thật, để không nổ số khóa).
- Mỗi 10 giây, mỗi tiến trình đẩy phần đếm được lên Redis trong **một** lệnh pipeline (`HINCRBY` vào khóa của phút đó, `etp:metrics:m:<phút>`), hết hạn sau 25 giờ.
- p50 / p95 tính lại từ histogram (sai số trong phạm vi một mốc: đủ để thấy "chậm hẳn đi").
- `/health/*` không được đếm (như log).
- Redis lỗi: bỏ qua số đo, không làm request chậm hay lỗi (như hàng chờ mua vé).

## 5. Cảnh báo

Một vòng kiểm tra **mỗi phút**, chạy trong **tiến trình API** (không phải worker: "worker chết" là điều quan trọng nhất cần báo). Nhiều tiến trình thì chỉ một tiến trình kiểm tra mỗi phút (khóa `SET NX EX 55` trên Redis).

| Quy tắc | Ngưỡng mặc định |
|---|---|
| Tỉ lệ lỗi 5xx | > 5% trong 5 phút (khi có ít nhất 20 request) |
| API chậm | p95 > 2 giây trong 5 phút |
| Cơ sở dữ liệu / Redis không trả lời | 2 lần liên tiếp |
| Worker không chạy | không có nhịp tim quá 2 phút |
| Job nền dồn | một hàng đợi có > 500 job chờ, hoặc job chờ lâu nhất > 5 phút |
| Job lỗi | > 10 job lỗi trong 1 giờ (phát vé, email, thông báo, hoàn tiền) |
| Hoàn tiền VNPay kẹt | có khoản `FAILED`, hoặc `PENDING` quá 1 giờ |
| Ổ đĩa | còn dưới 10% |
| Lỗi web tăng vọt | > 50 lỗi JavaScript trong 10 phút |

- Một cảnh báo có hai trạng thái: **đang xảy ra** và **đã hết**. Email gửi khi bắt đầu, **nhắc lại sau 30 phút** nếu vẫn còn, và một email khi đã hết. Không gửi lặp mỗi phút.
- Email gửi **thẳng qua SMTP** từ tiến trình API, không qua hàng đợi `emails`: nếu worker chết thì hàng đợi cũng không chạy.
- Người nhận: mọi tài khoản đang hoạt động có quyền mới `system:monitor` (vai trò ADMIN có sẵn). Biến `ALERT_EMAILS` (không bắt buộc) thêm địa chỉ khác, ví dụ hộp thư trực.
- Lịch sử cảnh báo (7 ngày) hiện trên trang theo dõi.

## 6. Lỗi JavaScript của web

- Web bắt `window.onerror`, `unhandledrejection` và lỗi khi vẽ trang. Hiện chưa có chỗ bắt lỗi khi vẽ (lỗi đó làm trắng trang): thêm `errorElement` của React Router, hiện trang "Đã có lỗi, tải lại trang" thay vì trang trắng. Các lỗi này được gửi về `POST /api/v1/client-errors` bằng `navigator.sendBeacon` (không chặn trang; `connect-src 'self'` của CSP vẫn đúng).
- Nội dung gửi: thông điệp (≤ 500 ký tự), stack (≤ 4.000 ký tự), **đường dẫn trang không có query string**, trình duyệt, phiên bản web. **Không** gửi userId, email, IP hay nội dung form.
- Mỗi trang gửi tối đa 5 lỗi, bỏ lỗi trùng; API giới hạn 30 lỗi / phút / IP (dùng `rateLimit` có sẵn). Không cần đăng nhập (lỗi có thể xảy ra trước khi đăng nhập).
- Lưu trên Redis, gộp theo "dấu vân tay" (thông điệp + dòng đầu của stack): số lần, lần đầu, lần cuối, một trang ví dụ. Giữ 7 ngày, tối đa 200 nhóm.

## 7. API và web

- `GET /api/v1/admin/system`: ảnh chụp hiện tại (các bảng ở mục 3) và các cảnh báo đang xảy ra.
- `GET /api/v1/admin/system/series?minutes=60`: số request, lỗi, p95 theo từng phút (tối đa 24 giờ), để vẽ biểu đồ.
- `GET /api/v1/admin/system/client-errors`: các nhóm lỗi web, mới nhất trước.
- Cả ba cần quyền `system:monitor` (migration thêm quyền và gán cho ADMIN).

Trang **"Tình trạng hệ thống"** (`/admin/system`, menu quản trị):

- Dòng trạng thái chung ở đầu: xanh "Hoạt động bình thường", vàng "Có cảnh báo", đỏ khi cơ sở dữ liệu / worker không chạy.
- Thẻ số liệu: request / phút, tỉ lệ lỗi, p95, kết nối WebSocket, job chờ, ổ đĩa, mỗi thẻ có màu theo ngưỡng.
- Biểu đồ 60 phút (request, lỗi, p95), SVG tự vẽ như biểu đồ doanh thu sẵn có (không thêm thư viện).
- Bảng hàng đợi, bảng đường dẫn chậm nhất, danh sách cảnh báo (đang có / gần đây), danh sách lỗi web.
- Tự cập nhật mỗi 15 giây, dừng khi tab bị ẩn. Có trạng thái đang tải / lỗi / trống, dùng được trên điện thoại, chế độ tối.

## 8. Test

- **Unit:** p50 / p95 từ histogram; gộp đường dẫn theo mẫu; từng quy tắc cảnh báo (đúng ngưỡng, dưới ngưỡng, nhắc lại sau 30 phút, báo hết); dấu vân tay lỗi web.
- **Tích hợp** (`monitoring.test.js`):
  - request được đếm, 5xx và 429 được tính đúng, `/health` không bị đếm;
  - nhiều "tiến trình" đẩy số đo cùng lúc thì cộng đúng;
  - cảnh báo: tạo lỗi 5xx vượt ngưỡng → đúng một email; vẫn còn → không gửi lại trong 30 phút; hết → email "đã hết";
  - worker không có nhịp tim → cảnh báo, kể cả khi hàng đợi không chạy;
  - lỗi web: dữ liệu sai bị từ chối, query string bị bỏ, quá giới hạn → 429, lỗi trùng được gộp;
  - không có quyền `system:monitor` → 403; Redis lỗi → API vẫn trả lời bình thường.
- **Web** (Vitest): ngưỡng → màu thẻ; bộ gửi lỗi (tối đa 5, bỏ trùng, bỏ query string).
- **E2E:** admin mở "Tình trạng hệ thống", thấy số request tăng sau vài thao tác; một lỗi JavaScript cố ý trên trang thử hiện trong danh sách lỗi web.

## 9. Ước lượng

| Việc | Giờ |
|---|---|
| Đo request, đẩy lên Redis, histogram | 2 |
| Số đo DB, Redis, hàng đợi, nhịp tim worker, WebSocket, nghiệp vụ, ổ đĩa | 2 |
| Cảnh báo (quy tắc, trạng thái, email thẳng) | 2,5 |
| Lỗi web (API + bộ gửi phía web) | 1,5 |
| Trang theo dõi | 2,5 |
| Test, tài liệu (`docs/deployment.md`, README, test-scenarios) | 2 |
| **Tổng** | **≈ 12,5** |

## 10. Cần quyết định khi review

1. **Ngưỡng cảnh báo** ở mục 5: dùng các số mặc định này (đổi được bằng biến môi trường về sau)?
2. **Người nhận cảnh báo:** mọi admin, cộng thêm `ALERT_EMAILS` nếu có. Đồng ý?
3. **Thời gian giữ:** số đo 24 giờ, lỗi web và lịch sử cảnh báo 7 ngày, chỉ trên Redis (mất khi Redis bị xóa sạch). Đủ chưa?
4. **API nhận lỗi web không cần đăng nhập** (có giới hạn tần suất, không lưu dữ liệu cá nhân). Đồng ý?

## 11. Ghi chú triển khai

- Code: `backend/src/modules/monitoring/` (`metrics.js` đếm và đẩy lên Redis, `histogram.js`, `system-status.js` gom số liệu, `alerts.js` quy tắc và email, `client-errors.js`), migration `20261028100001000_system-monitor.sql` (quyền `system:monitor`), web `frontend/src/pages/admin/SystemPage.tsx`, `frontend/src/utils/clientErrors.ts`, `frontend/src/pages/RouteErrorPage.tsx`.
- Tên đường dẫn lấy theo mẫu khi Express khớp route; request không khớp route nào (404) chỉ được đếm vào tổng, không có tên.
- "Job lỗi" chỉ đếm lần thử **cuối cùng** của một job (lần thử lại không tính), cả ở chế độ inline.
- Chế độ `QUEUE_MODE=inline` (test, E2E): không có worker riêng, trang ghi "Chạy ngay trong API" và quy tắc "Worker không chạy" không áp dụng.
- Ổ đĩa đo tại thư mục `UPLOAD_DIR` (trên VPS: volume ảnh tải lên, cùng ổ dữ liệu).
- "Phiên bản web" của lỗi JavaScript lấy từ `VITE_RELEASE` lúc build (không đặt thì để trống).
- Khi cơ sở dữ liệu không trả lời, cảnh báo gửi tới danh sách admin đọc được lần gần nhất và `ALERT_EMAILS`. Nên đặt `ALERT_EMAILS` trên VPS.
- `MONITORING_ALERTS=false` tắt vòng kiểm tra cảnh báo (số liệu và trang vẫn chạy). Stack E2E và stack đo tải đặt `false`: khi chạy thử, máy test có ổ đĩa gần đầy đã làm cảnh báo gửi email cùng lúc tới mọi admin thử nghiệm và làm chậm Mailpit. Email cảnh báo được gửi lần lượt, không gửi dồn một lúc.
