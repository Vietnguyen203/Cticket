# Phase 12 — Trang quản trị cho admin và ban tổ chức (đã duyệt, đang triển khai)

> Mục tiêu: admin và organizer **làm việc trên web** thay vì Postman: duyệt nhà tổ chức, dựng địa điểm và sơ đồ ghế, tạo sự kiện, suất diễn, hạng vé, gửi duyệt và duyệt, quản lý người dùng, đơn hàng, hoàn tiền, mã giảm giá, xem audit log và doanh thu.
>
> Theo yêu cầu của bạn, phần này làm **trước** các bước còn lại của Phase 11 (11.2 mua vé, 11.3 thanh toán, 11.4 soát vé); làm xong Phase 12 thì quay lại Phase 11.
>
> Nguyên tắc: **quyền do backend quyết định**. Web chỉ ẩn những menu người dùng không có quyền cho gọn; mọi API vẫn kiểm tra quyền như các phase trước (RBAC, "của mình" hay "của mọi người").

---

## 1. Phạm vi

### Đã có API (Phase 2–10), chỉ cần làm giao diện

| Ai | Chức năng | API có sẵn |
|---|---|---|
| Admin | Duyệt / từ chối / tạm khóa nhà tổ chức | `GET /organizers`, `PATCH /organizers/:id/status` |
| Admin | Danh mục | `GET/POST/PATCH/DELETE /categories` |
| Admin | Địa điểm, khu, sinh ghế, xem sơ đồ | `/venues`, `/venues/:id/zones`, `/zones/:id/seats/bulk`, `/venues/:id/layout` |
| Admin | Duyệt / từ chối / hủy sự kiện (hủy thì hoàn tiền tất cả, EVT-08) | `GET /events?status=PENDING_APPROVAL`, `PATCH /events/:id/status` |
| Admin | Tra cứu đơn (ORD-05), hoàn tiền | `GET /orders?all=true&…`, `POST /payments/:id/refund` |
| Admin | Mã giảm giá (PRO-02) | `GET/POST/PATCH /promotions` |
| Khách | Đăng ký làm nhà tổ chức | `POST /organizers`, `GET /organizers/me` |
| Organizer | Sự kiện của tôi: tạo, sửa, xóa nháp, gửi duyệt, rút lại, hủy | `/events?mine=true`, `POST/PATCH/DELETE /events`, `PATCH /events/:id/status` |
| Organizer | Suất diễn | `POST /events/:id/schedules`, `PATCH/DELETE /schedules/:id` |
| Organizer | Hạng vé (ghế ngồi / vé đứng), gán hàng ghế cho hạng vé | `/schedules/:id/ticket-types`, `/ticket-types/:id`, `GET/PUT /schedules/:id/seat-plan` |
| Organizer | Khóa / mở ghế (SEAT-02) | `POST /schedules/:id/inventory/block` |
| Organizer | Nhân viên soát vé, thống kê check-in | `/events/:id/staff`, `/schedules/:id/check-in-stats` |

### Cần thêm API (backend)

| Mã | Chức năng | API mới |
|---|---|---|
| USR-03 | Danh sách người dùng: tìm theo email / tên, lọc theo role, trạng thái | `GET /admin/users` |
| USR-04 | Khóa / mở khóa tài khoản (khóa thì **đăng xuất ngay** mọi thiết bị) | `PATCH /admin/users/:id/status` |
| USR-05 | Gán role (ORGANIZER, STAFF, ADMIN) | `PUT /admin/users/:id/roles` |
| AUD-02 | Tra cứu audit log theo đối tượng, người làm, hành động, khoảng ngày | `GET /admin/audit-logs` |
| REP-01 | Doanh thu sự kiện của tôi: số vé bán, doanh thu theo suất và hạng vé | `GET /organizer/events/:id/sales` |
| REP-02 | Báo cáo toàn hệ thống theo khoảng ngày (theo ngày, theo sự kiện) | `GET /admin/reports/sales` |
| TKT-03 | Cấp lại QR khi khách báo lộ mã (QR cũ hết hiệu lực ngay) | `POST /admin/tickets/:id/reissue-qr` |

**Không làm ở phase này**: đánh giá sự kiện (REV-01, mức "Mở rộng"), Bull Board (Q-06: giao diện xem job lỗi; cần thêm lớp bảo vệ riêng, để Phase 14). (Tải ảnh lên: ban đầu để sau, đã làm thêm theo yêu cầu, xem mục 8.)

---

## 2. Giao diện

- Nằm trong **chính web của Phase 11** (`frontend/`), dưới `/admin/*` và `/organizer/*`, bố cục riêng: **thanh menu bên trái** (thu gọn thành nút menu trên điện thoại), nội dung bên phải.
- Menu hiện theo **quyền** của tài khoản (`permissions` từ `GET /users/me`), ví dụ có `organizer:manage` mới thấy "Nhà tổ chức". Header của web có thêm nút **"Quản trị"** / **"Ban tổ chức"** khi có quyền tương ứng.
- Mỗi trang danh sách: ô tìm kiếm, bộ lọc trạng thái, phân trang, nút hành động; thao tác nguy hiểm (hủy sự kiện, khóa tài khoản, hoàn tiền) phải **xác nhận** và nhập **lý do** (backend bắt buộc lý do ở các thao tác này).
- Không thêm thư viện form / bảng / biểu đồ: dùng form có kiểm soát như 11.1, bảng HTML + Tailwind, biểu đồ doanh thu vẽ bằng cột CSS đơn giản.
- **Giờ nhập ở form là giờ Việt Nam** (ô `datetime-local`), web đổi sang ISO `+07:00` trước khi gửi; hiển thị cũng theo giờ Việt Nam, dù máy người dùng đặt múi giờ khác.

### Trang admin (`/admin`)

| Trang | Nội dung |
|---|---|
| Tổng quan | Việc cần làm (sự kiện chờ duyệt, nhà tổ chức chờ duyệt), doanh thu 7 ngày, số vé bán |
| Duyệt sự kiện | Danh sách theo trạng thái; xem chi tiết (suất, hạng vé, sơ đồ ghế) → **Duyệt** / **Từ chối** (lý do) / **Hủy** (lý do, hoàn tiền tất cả) |
| Nhà tổ chức | Đơn đăng ký → Duyệt / Từ chối / Tạm khóa |
| Địa điểm | Danh sách, tạo / sửa; khu ngồi / khu đứng; **sinh ghế theo hàng** (A1–A10…); xem sơ đồ |
| Danh mục | Thêm, sửa, xóa (không xóa được danh mục đang dùng) |
| Người dùng | Tìm, lọc; khóa / mở khóa; gán role |
| Đơn hàng | Lọc theo trạng thái, suất diễn; xem chi tiết, thanh toán, vé; **hoàn tiền** |
| Mã giảm giá | Tạo / sửa: phần trăm hoặc số tiền, giảm tối đa, đơn tối thiểu, giới hạn lượt (tổng và mỗi người), thời hạn, tạm dừng |
| Audit log | Lọc theo đối tượng / người làm / hành động / ngày; xem giá trị cũ → mới |
| Báo cáo | Doanh thu theo ngày và theo sự kiện trong khoảng ngày chọn |

### Trang ban tổ chức (`/organizer`)

| Trang | Nội dung |
|---|---|
| Đăng ký làm nhà tổ chức | Khách điền tên tổ chức, mã số thuế…; xem trạng thái đơn (chờ duyệt / đã duyệt / bị từ chối) |
| Sự kiện của tôi | Danh sách theo trạng thái, tạo sự kiện mới |
| Sửa sự kiện (dạng các bước) | 1. Thông tin (tên, mô tả, ảnh, danh mục, độ tuổi) → 2. Suất diễn (địa điểm, giờ diễn, giờ mở / đóng bán) → 3. Hạng vé (ghế ngồi hoặc vé đứng, giá, tối đa / đơn) → 4. **Gán hàng ghế cho hạng vé** trên sơ đồ → 5. **Gửi duyệt** (web kiểm tra trước những gì backend sẽ đòi: có suất sắp diễn, mọi ghế đã có hạng vé…) |
| Sau khi đăng | Khóa / mở ghế trên sơ đồ (kèm lý do), nhân viên soát vé, thống kê check-in, **doanh thu** (REP-01), hủy sự kiện |

---

## 3. API mới (backend)

### 3.1 Người dùng (USR-03, 04, 05)

- `GET /admin/users?q=&role=&status=&page=&pageSize=` (quyền `user:manage`): email, tên, số điện thoại, trạng thái, các role, ngày tạo. **Không bao giờ** trả mật khẩu băm.
- `PATCH /admin/users/:id/status` `{ status: ACTIVE | SUSPENDED, reason }`:
  - Khóa → **thu hồi mọi refresh token** và đưa user vào denylist (Phase 6): access token đang dùng hết hiệu lực ngay, không phải chờ 15 phút.
  - Không tự khóa chính mình. Audit log.
- `PUT /admin/users/:id/roles` `{ roles: [...] }` (thay cả danh sách):
  - Luôn giữ `CUSTOMER`. Không tự bỏ role `ADMIN` của chính mình, và hệ thống **luôn còn ít nhất một admin** (khóa dòng các admin để hai admin không cùng gỡ nhau một lúc).
  - Role mới có hiệu lực ở lần refresh token sau (giống Phase 10). Gỡ role thì thu hồi phiên để quyền mất ngay. Audit log (role cũ → mới).

### 3.2 Audit log (AUD-02)

`GET /admin/audit-logs?entityType=&entityId=&userId=&action=&from=&to=&page=` (quyền `audit:read`): mới nhất trước, kèm email người làm. Bảng `audit_logs` đã chặn UPDATE / DELETE từ Phase 1, nên đây chỉ là đọc.

### 3.3 Doanh thu (REP-01, REP-02)

- **Doanh thu** = tổng tiền các đơn **PAID / COMPLETED** (đơn đã hoàn tiền không tính), tính theo **ngày thanh toán, giờ Việt Nam**; số vé = vé đã phát hành của các đơn đó.
- `GET /organizer/events/:id/sales` (organizer chủ sự kiện `report:read:own`, hoặc admin): theo suất → theo hạng vé: vé bán / tổng, doanh thu, số đơn hoàn tiền.
- `GET /admin/reports/sales?from=&to=` (`report:read:any`): theo ngày và top sự kiện; khoảng tối đa 366 ngày.
- Truy vấn tổng hợp thẳng trên PostgreSQL (có index `orders (status, paid_at)` nếu cần, thêm bằng migration). Chưa cần bảng tổng hợp sẵn ở quy mô này.

### 3.4 Cấp lại QR (TKT-03)

`POST /admin/tickets/:id/reissue-qr` (`order:manage`): vé `VALID` → `qr_version + 1`, băm QR mới; QR cũ bị từ chối khi quét (`QR_INVALID`, đúng như Phase 10 đã chuẩn bị). Khóa dòng vé như lúc check-in, nên không đè lên một lượt quét đang diễn ra. Audit log.

---

## 4. Kiểm thử

- **Backend** (Jest, như các phase trước): người dùng (tìm, khóa → token cũ bị từ chối ngay, gán role, không gỡ được admin cuối cùng kể cả khi hai admin cùng gỡ nhau), audit log (lọc), doanh thu (đơn hoàn tiền không tính, theo giờ Việt Nam), cấp lại QR (QR cũ không vào được, QR mới vào được). Toàn bộ test cũ vẫn pass.
- **Web** (Vitest): đổi giờ Việt Nam ↔ ISO, menu theo quyền, kiểm tra trước khi gửi duyệt.
- **Test tay**: kịch bản đi hết bằng web, không dùng Postman: khách đăng ký làm nhà tổ chức → admin duyệt → organizer tạo sự kiện, suất, hạng vé, gán ghế, gửi duyệt → admin duyệt → sự kiện hiện ở trang chủ; khóa user; hoàn tiền; xem doanh thu.

---

## 5. Làm theo 4 bước

| Bước | Nội dung |
|---|---|
| 12.1 | Khung trang quản trị (menu theo quyền), duyệt nhà tổ chức, danh mục, địa điểm + khu + sinh ghế, duyệt / từ chối / hủy sự kiện |
| 12.2 | Ban tổ chức: đăng ký, sự kiện của tôi, các bước tạo sự kiện (thông tin, suất, hạng vé, gán ghế, gửi duyệt), khóa ghế, nhân viên, thống kê check-in |
| 12.3 | Người dùng (API mới), đơn hàng + hoàn tiền + cấp lại QR (API mới), mã giảm giá, audit log (API mới) |
| 12.4 | Doanh thu (API mới) cho organizer và admin, trang tổng quan |

Mỗi bước: bạn chạy thử trên web rồi commit.

**Nhánh git**: phần web đang ở nhánh `feature/phase-11-web` (đã commit 11.1; phần đầu 11.2 đang làm dở: client WebSocket, bộ gộp sơ đồ ghế, trang chủ có danh sách sự kiện, đã có test). Đề xuất: commit phần dở đó, tạo nhánh `feature/phase-12-admin` từ đó để làm Phase 12; xong Phase 12 bạn merge vào `main`, rồi tiếp tục 11.2 trên nhánh mới từ `main`.

---

## 6. Ước lượng

| Hạng mục | Giờ |
|---|---|
| 12.1: khung, nhà tổ chức, danh mục, địa điểm / khu / ghế, duyệt sự kiện | 14 |
| 12.2: các trang ban tổ chức (form nhiều bước, gán ghế, khóa ghế, nhân viên) | 20 |
| 12.3: API người dùng + audit + cấp lại QR (8) và các trang (11) | 19 |
| 12.4: API doanh thu (6) và trang báo cáo, tổng quan (5) | 11 |
| Test + tài liệu | 6 |
| **Tổng** | **≈ 70 giờ** (file: Phase 12 = 48h chỉ tính API; phần giao diện là thêm) |

---

## 7. Cần quyết định khi review

1. Trang quản trị nằm **trong cùng web** (`/admin`, `/organizer`, menu bên trái, hiện theo quyền), không làm một web riêng. Đồng ý?
2. **Phạm vi** như mục 1: có làm 7 API mới (người dùng, audit, doanh thu, cấp lại QR); **không** làm đánh giá sự kiện, Bull Board, tải ảnh lên. Đồng ý?
3. **Khóa tài khoản = đăng xuất ngay** mọi thiết bị; **luôn còn ít nhất một admin**, admin không tự khóa / tự gỡ quyền admin của mình. Đồng ý?
4. **Doanh thu** chỉ tính đơn PAID / COMPLETED, theo ngày thanh toán giờ Việt Nam. Đồng ý?
5. Giờ trong form là **giờ Việt Nam**. Đồng ý?
6. Ảnh sự kiện nhập bằng **đường dẫn** (chưa có tải ảnh lên). Đồng ý?
7. **Làm theo 4 bước** ở mục 5, mỗi bước bạn test rồi commit; **nhánh git** như mục 5. Đồng ý?

Đã duyệt cả 7 điểm.

---

## 8. Ghi chú triển khai

### Bước 12.1 (xong): khung quản trị, nhà tổ chức, danh mục, địa điểm, duyệt sự kiện

- `frontend/src/admin/`: menu theo quyền (`permissions.ts`), khung trang (`AdminLayout`), chặn trang theo quyền (`RequirePermission`: chưa đăng nhập → trang đăng nhập; không có quyền → 403), các thành phần chung (bảng, nhãn trạng thái, tab, phân trang, hộp xác nhận có lý do bằng `<dialog>`).
- Trang: Tổng quan (số việc chờ), Duyệt sự kiện (danh sách theo trạng thái, xem hạng vé và số ghế đã gán từng suất, duyệt / từ chối / hủy), Nhà tổ chức (duyệt / từ chối / tạm khóa / mở lại), Địa điểm (tạo, sửa, ngừng dùng; thêm khu ngồi / khu đứng; sinh ghế theo hàng, ví dụ "A-E" từ ghế 1 tới 20), Danh mục (thêm, sửa, xóa).
- Đăng nhập xong, web tải hồ sơ đầy đủ (`/users/me`) để có danh sách quyền.
- Không cần sửa backend ở bước này.
- Test web: 33 (thêm đọc hàng ghế "A-C, F", menu theo quyền).
- Đã thử trên trình duyệt (API tạm gửi mail vào Mailpit): thêm / sửa / xóa danh mục, xóa danh mục đang dùng bị chặn; tạo địa điểm, khu, 20 ghế, hàng nhập sai và ghế trùng bị báo lỗi; duyệt một đơn nhà tổ chức; sự kiện thử bị từ chối (bắt buộc lý do) → gửi lại → duyệt → hiện ở trang chủ; tài khoản không có quyền thấy 403, chưa đăng nhập bị chuyển sang trang đăng nhập.

### Bước 12.2 (xong): trang ban tổ chức

- **Đăng ký làm nhà tổ chức** (`/organizer/apply`, lối vào ở trang Tài khoản): gửi đơn, xem trạng thái; được duyệt thì nút "Cập nhật quyền ngay" lấy token mới (role ORGANIZER) không cần đăng nhập lại.
- **Sự kiện của tôi** (`/organizer`) và **trình sửa sự kiện** (`/organizer/events/:id`), 3 tab:
  - *Thông tin*: nháp sửa được hết; đang bán chỉ sửa mô tả và ảnh (đúng luật backend); chờ duyệt phải rút lại mới sửa.
  - *Suất diễn & vé*: thêm suất (giờ nhập là giờ Việt Nam), sửa giờ, xóa suất; thêm / xóa hạng vé (ghế ngồi, hoặc vé đứng gắn khu đứng); **gán hàng ghế cho hạng vé** (chọn theo từng hàng hoặc cả khu; hàng có nhiều hạng được giữ nguyên). Khi đang bán: hủy suất, **khóa / mở ghế** trên sơ đồ (kèm lý do), số đã check-in.
  - *Nhân viên soát vé*: thêm theo email, gỡ.
- **Kiểm tra trước khi gửi duyệt** (`organizer/readiness.ts`): đúng các điều backend kiểm tra (có suất sắp diễn, mỗi suất có hạng vé, hạng ghế ngồi có ghế); ghế chưa gán hạng chỉ là cảnh báo. Nút "Gửi duyệt" tắt khi còn thiếu.
- Nút "Ban tổ chức" trên header chỉ hiện với role ORGANIZER (admin có mọi quyền nhưng không có hồ sơ nhà tổ chức).
- Không cần sửa backend. Test web: 42 (thêm giờ Việt Nam ↔ ISO, kiểm tra gửi duyệt, chuyển gán ghế theo hàng ↔ API, link ban tổ chức).
- Đã thử trên trình duyệt (API tạm, Mailpit): tạo sự kiện mới hoàn toàn bằng web → suất 19:30 hiển thị đúng → hạng VIP + vé đứng → gán hàng A cho VIP → danh sách kiểm tra cập nhật → gửi duyệt → (admin duyệt) → khóa 2 ghế, mở 1 ghế → sửa mô tả khi đang bán → thêm / gỡ nhân viên (email không tồn tại bị báo lỗi) → một khách đăng ký làm nhà tổ chức, được duyệt.

#### Bổ sung sau khi test 12.2 (theo yêu cầu)

- **Giờ dạng 24 giờ, không có giây**: ô `datetime-local` theo định dạng của Windows (SA/CH), nên thay bằng `DateTimeField`: ô ngày + chọn giờ 00–23 + phút (bước 5).
- **Organizer nhập địa điểm mới, admin duyệt** (bạn chọn cách "Organizer gửi, admin duyệt"):
  - Migration `20261013100001000_venue-proposals`: trạng thái `PENDING` cho địa điểm, cột `created_by_organizer_id`, quyền mới `venue:propose` (ORGANIZER, ADMIN).
  - `POST /venues`: admin tạo → `ACTIVE`; organizer tạo → `PENDING`. Địa điểm `PENDING` chỉ người đề xuất (và admin) thấy; người đề xuất thêm khu / sinh ghế được cho tới khi được duyệt, sau đó chỉ admin sửa.
  - Suất diễn dùng được địa điểm `PENDING` của chính ban tổ chức đó.
  - **Duyệt sự kiện duyệt luôn các địa điểm `PENDING`** của nó trong cùng transaction (audit `VENUE_APPROVED`); địa điểm bị từ chối (`INACTIVE`) chặn việc duyệt (`VENUE_NOT_AVAILABLE`). Admin cũng duyệt / từ chối riêng ở trang Địa điểm (tab "Chờ duyệt").
  - Web: trong form thêm suất có "+ Nhập địa điểm mới…" (tên, địa chỉ, rồi khu và ghế); trang duyệt sự kiện cảnh báo địa điểm chờ duyệt.
  - Test backend: `venue-proposals.test.js` (5 test). Toàn bộ: 221 test pass.
- **Tải ảnh sự kiện từ máy tính** (theo yêu cầu):
  - `POST /api/v1/uploads/images`: thân request là chính file ảnh (`express.raw`, không thêm thư viện), tối đa 5 MB, 30 ảnh / giờ / người; người sửa được sự kiện / địa điểm mới được tải.
  - **Loại file đọc từ các byte đầu** (JPEG, PNG, WebP), không tin tên file hay header: trang HTML đổi đuôi .png bị từ chối, SVG (có thể chứa script) không nhận. Tên file ngẫu nhiên (UUID).
  - Phục vụ lại tại `/api/v1/uploads/images/<uuid>.<ext>` với `X-Content-Type-Options: nosniff`, cache 1 năm (file không bao giờ bị sửa). Cùng nguồn với web nên Vite / nginx không phải cấu hình thêm.
  - `bannerUrl` / `thumbnailUrl` nhận link `https://…` hoặc đường dẫn ảnh đã tải lên (không nhận đường dẫn khác của site).
  - Docker: volume `uploads` cho service `api`; khi dev chạy ngoài Docker: `backend/uploads/` (đã bỏ khỏi git). Test ghi vào thư mục tạm.
  - Web: ô ảnh có nút **"Tải ảnh từ máy"** + xem trước; ảnh lỗi thì hiện nền màu thay vì ảnh vỡ.
  - Chưa làm: xóa ảnh không còn dùng, thu nhỏ / nén ảnh, lưu lên S3 (Phase 14).
  - Test backend: `uploads.test.js` (5 test). Toàn bộ: 226 test pass.

### Bước 12.3 (xong): người dùng, đơn hàng, mã giảm giá, audit log

- **API mới** (module `admin`, mount `/api/v1/admin`; module riêng vì `auth` đã phụ thuộc `users`, thêm vào `users` sẽ tạo vòng phụ thuộc):
  - `GET /admin/users` (tìm email / tên, lọc role, trạng thái; không bao giờ trả mật khẩu băm).
  - `PATCH /admin/users/:id/status`: khóa (bắt buộc lý do) → thu hồi mọi refresh token + denylist mọi access token **ngay** (chế độ nghiêm ngặt: cả token tạo trong giây hiện tại); mở khóa → `ACTIVE` (hoặc `PENDING_VERIFICATION` nếu chưa xác minh email).
  - `PUT /admin/users/:id/roles`: luôn giữ `CUSTOMER`; bỏ quyền thì đăng xuất ngay, thêm quyền có hiệu lực lần refresh sau; không tự khóa / tự gỡ quyền admin của mình (`CANNOT_CHANGE_SELF`); **luôn còn ít nhất 1 admin** (`LAST_ADMIN`): khóa các dòng role ADMIN, nên 2 admin gỡ quyền nhau cùng lúc chỉ 1 người thành công (có test).
  - `GET /admin/audit-logs` (+ `/actions`): lọc theo đối tượng, id, người làm, hành động, khoảng ngày.
  - `POST /admin/tickets/:id/reissue-qr` (TKT-03): khóa dòng vé như lúc check-in, tăng `qr_version`; QR cũ hết hiệu lực; vé đã dùng / hoàn tiền thì `TICKET_NOT_REISSUABLE`.
  - `GET /orders?all=true&q=…`: tìm đơn theo mã đơn hoặc email người mua; đơn có `buyerEmail`.
  - Test: `admin.test.js` (8 test). Toàn bộ: 234 test pass.
- **Trang admin mới**: Người dùng (tìm, phân quyền, khóa / mở khóa), Đơn hàng (lọc trạng thái, tìm; chi tiết: dòng vé, thanh toán + **hoàn tiền**, vé + **cấp lại QR**), Mã giảm giá (tạo / sửa: %, số tiền, giảm tối đa, đơn tối thiểu, lượt dùng, thời hạn, tạm dừng), Audit log (lọc, xem giá trị cũ → mới).
- Đã thử trên trình duyệt (API tạm, Mailpit): tìm đơn theo email → cấp lại QR → hoàn tiền (vé chuyển "Đã hoàn tiền"); cấp quyền Soát vé → khóa (bắt buộc lý do) → mở khóa; audit log hiện đủ 3 thao tác; tạo mã giảm giá 15% tối đa 100.000đ.
- **Đăng xuất khi đóng tab** (theo yêu cầu): ô "Ghi nhớ đăng nhập (7 ngày)" ở trang đăng nhập, mặc định không tick.
  - Không ghi nhớ: refresh cookie là cookie phiên (không có `Max-Age`); mở lại web sau khi đã đóng mọi tab (không phải tải lại, không còn tab nào khác trả lời qua `BroadcastChannel`) thì web gọi logout, thu hồi luôn phiên trên server.
  - Ghi nhớ: login gửi `remember: true`, các lần refresh gửi `X-Auth-Remember: 1` → cookie 7 ngày.
  - Giới hạn: trình duyệt bật "khôi phục phiên trước" có thể giữ lại cookie phiên và tab.


#### Bổ sung sau Phase 13: tài khoản admin dùng được mọi chức năng

- **Chỉ vai trò Quản trị (ADMIN)** có 11 quyền quản trị (`event:manage:any`, `report:read:any`, `user:manage`, …). Admin cấp được vai trò Quản trị cho người khác (đã hỏi và chốt); hệ thống luôn giữ ít nhất một admin.
- **Admin sửa được sự kiện của mọi nhà tổ chức**: nút "Chỉnh sửa" và "Doanh thu" ở trang duyệt sự kiện; trang chỉnh sửa cho phép người có `event:manage:any` (nhà tổ chức thường vẫn chỉ mở được sự kiện của mình).
- **Trang Soát vé của admin liệt kê mọi sự kiện đang mở** (admin vốn được soát vé ở mọi sự kiện); nhân viên thường vẫn chỉ thấy sự kiện được giao.
- **Admin nâng tài khoản lên Ban tổ chức ở trang Người dùng = có luôn hồ sơ nhà tổ chức dùng được**: tạo hồ sơ (tên theo họ tên người đó) nếu chưa có, duyệt / kích hoạt nếu đang chờ, bị từ chối hoặc bị khóa; audit `ORGANIZER_CREATED` / `ORGANIZER_APPROVED`. Thứ tự khóa thống nhất **users → organizers** (cả lúc duyệt nhà tổ chức) để hai admin làm cùng lúc không bị deadlock. Hộp thoại phân quyền giải thích từng vai trò.
- **Sửa danh mục** (theo yêu cầu): trang Quản trị → Danh mục có hộp thoại sửa **tên và mô tả**; slug là mã nội bộ nên **không hiển thị**, và **luôn sinh từ tên** ("Âm nhạc" → `am-nhac`) khi tạo và mỗi khi đổi tên; API không nhận slug do người gọi gửi (bị bỏ qua) (trùng tên với danh mục khác → "Đã có danh mục trùng tên"); cột **số sự kiện** của mỗi danh mục (`GET /categories/usage`, chỉ admin, tính cả sự kiện nháp). **Xóa được mọi danh mục** (đã chốt): danh mục đang dùng được gỡ khỏi các sự kiện trước (sự kiện chỉ có danh mục đó sẽ không còn danh mục nào cho tới khi ban tổ chức chọn lại), cùng một transaction, khóa dòng danh mục trước; audit `CATEGORY_DELETED` (số sự kiện bị gỡ); hộp thoại xóa ghi rõ số sự kiện bị ảnh hưởng. Form sự kiện có link "Quản lý danh mục ↗" (tab mới) và "Tải lại danh sách" cho admin.
- **Xóa concert** (theo yêu cầu; đã chốt "xóa hẳn tất cả", admin và ban tổ chức của sự kiện): xóa được sự kiện ở **mọi trạng thái**, cùng mọi thứ nó đã bán — lượt soát vé, vé, hoàn tiền, thanh toán, lượt dùng mã giảm giá (trả lại cho mã), đánh giá, đơn hàng, ghế, vé đứng, suất diễn (`orders/order-purge.js`, con trước cha, trong một transaction; khóa dòng sự kiện trước, không khóa trước các suất để tránh deadlock với lượt soát vé đang chạy). `GET /events/:id/deletion-summary` cho biết sẽ mất gì; `DELETE /events/:id` cần `confirmTitle` đúng tên sự kiện (trừ bản nháp chưa có đơn) → nếu không: 422 `DELETE_CONFIRMATION_REQUIRED`. Audit `EVENT_DELETED` kèm số đơn, vé, doanh thu đã xóa. Giao diện: nút "Xóa" ở trang sự kiện (mọi trạng thái) và trang duyệt sự kiện của admin; hộp thoại liệt kê những gì sẽ mất, nhắc dùng "Hủy sự kiện" nếu muốn hoàn tiền cho khách, và chỉ cho bấm "Xóa vĩnh viễn" khi gõ đúng tên.
- Test: +7 (backend 253 pass), E2E 11/11.
