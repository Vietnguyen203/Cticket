# Phase 12.4 — Báo cáo doanh thu và trang tổng quan (đã duyệt, đang triển khai)

> Mục tiêu: ban tổ chức biết sự kiện của mình **bán được bao nhiêu, còn bao nhiêu chỗ, bao nhiêu người đã vào**; admin thấy **toàn hệ thống theo ngày**, sự kiện nào bán chạy, bao nhiêu tiền đã hoàn. Xem bằng biểu đồ trên web, tải được file CSV để mở bằng Excel.
>
> Kế thừa Phase 12 (đã duyệt): doanh thu chỉ tính đơn **PAID / COMPLETED**, theo **ngày thanh toán, giờ Việt Nam**; quyền do backend quyết định (`report:read:own` cho organizer, `report:read:any` cho admin).

---

## 1. Phạm vi

| Mã | Ai xem | Nội dung |
|---|---|---|
| REP-01 | Organizer (sự kiện của mình), admin (mọi sự kiện) | Doanh thu, số vé bán theo **sự kiện → suất → hạng vé**, **tỷ lệ lấp đầy**, **số người đã vào cổng**, **mã giảm giá đã dùng**, đơn hoàn tiền, biểu đồ bán theo ngày |
| REP-01b | Organizer | Trang tổng quan "Sự kiện của tôi": mỗi sự kiện một dòng tóm tắt (doanh thu, vé bán / sức chứa, suất gần nhất) + tổng cộng |
| REP-02 | Admin | Báo cáo toàn hệ thống theo **khoảng ngày**: doanh thu và số vé theo ngày, **top sự kiện**, **đơn hoàn tiền** |
| DASH | Admin | Trang `/admin` thành **dashboard**: số liệu hôm nay / 7 ngày / 30 ngày, biểu đồ 30 ngày, top 5 sự kiện, việc đang chờ duyệt (đã có) |
| CSV | Cả hai | Nút "Tải CSV" ở mỗi bảng báo cáo |

**Không làm** ở bước này: báo cáo theo giờ trong ngày, so sánh kỳ trước / kỳ này, xuất PDF / Excel (.xlsx), gửi báo cáo qua email định kỳ, bảng tổng hợp sẵn (materialized view). Có thể bổ sung sau.

---

## 2. Định nghĩa số liệu (phần quan trọng nhất)

Mọi con số phải **giải thích được** và **khớp nhau** giữa các trang.

| Số liệu | Cách tính |
|---|---|
| **Đơn đã bán** | Đơn `PAID` hoặc `COMPLETED`. Đơn `REFUNDED`, `CANCELLED`, `EXPIRED`, đang giữ chỗ / đang thanh toán **không tính** |
| **Doanh thu gộp** | Tổng `subtotal` (giá vé trước giảm giá) của đơn đã bán |
| **Giảm giá** | Tổng `discount_amount` của đơn đã bán |
| **Doanh thu** (thực thu) | Tổng `total_amount` = gộp − giảm giá. Đây là con số chính trên mọi trang |
| **Vé đã bán** | Số vé (`tickets`) thuộc đơn đã bán, trạng thái `VALID` hoặc `USED` |
| **Ngày bán** | Ngày của `paid_at` **theo giờ Việt Nam** (UTC+7). Đơn trả lúc 23:30 ngày 1 (giờ VN) tính cho ngày 1, dù theo UTC là 16:30 |
| **Sức chứa** của hạng vé | Ghế ngồi: số ghế gán cho hạng vé đó ở suất đó; vé đứng: `capacity` |
| **Đang khóa** | Ghế bị ban tổ chức khóa / số vé đứng bị khóa (không bán được) |
| **Tỷ lệ lấp đầy** | Vé đã bán ÷ (sức chứa − đang khóa) |
| **Đã vào cổng** | Số lượt check-in (mỗi vé tối đa một lượt), tỷ lệ = đã vào ÷ vé đã bán |
| **Hoàn tiền** | Đơn `REFUNDED`: số đơn, số tiền (`refunds.amount`, hệ thống chỉ hoàn toàn bộ đơn), theo **ngày hoàn** (giờ VN) |
| **Mã giảm giá** | Theo từng mã: số đơn đã bán dùng mã, tổng tiền đã giảm |

Lưu ý rõ trong giao diện: một đơn **bị hoàn tiền sau đó** thì rút khỏi doanh thu của **ngày nó được trả tiền** (con số ngày cũ có thể giảm đi), và hiện ở cột "hoàn tiền" của **ngày hoàn**. Cách này đơn giản và khớp với "doanh thu = tiền đang giữ"; cách "sổ cái" (ghi âm vào ngày hoàn) cần bảng bút toán riêng, để sau.

Tiền là số nguyên VND (bigint trong DB), API trả về **số** (an toàn tới 9 triệu tỷ).

---

## 3. API mới (backend, module `reports`)

Tất cả chỉ **đọc**, tính trực tiếp bằng SQL tổng hợp trên PostgreSQL. Ngày gửi lên / trả về dạng `YYYY-MM-DD` theo giờ Việt Nam; ngày không có đơn vẫn có trong kết quả (giá trị 0) để vẽ biểu đồ liền mạch (`generate_series`).

### 3.1 `GET /api/v1/reports/events/:id/sales` (REP-01)

Quyền: `report:read:own` **và là chủ sự kiện**, hoặc `report:read:any`. Không phải chủ → **404** (không lộ sự kiện của người khác, như các API "của mình" trước đây).

```json
{
  "event": { "id": "…", "title": "…", "status": "PUBLISHED" },
  "totals": { "orders": 12, "tickets": 30, "gross": 15000000, "discount": 300000, "revenue": 14700000,
              "capacity": 200, "blocked": 4, "fillRate": 0.153, "checkedIn": 18,
              "refunds": { "orders": 1, "amount": 500000 } },
  "schedules": [
    { "id": "…", "startAt": "…", "venueName": "…", "status": "SCHEDULED",
      "totals": { "…cùng các trường như trên…" },
      "ticketTypes": [
        { "id": "…", "name": "VIP", "price": 500000, "mode": "RESERVED",
          "capacity": 40, "blocked": 2, "sold": 20, "fillRate": 0.526, "revenue": 9800000, "checkedIn": 12 }
      ] }
  ],
  "promotions": [ { "code": "WEB12TEST", "name": "…", "orders": 3, "discount": 300000 } ],
  "daily": [ { "date": "2026-10-01", "orders": 2, "tickets": 5, "revenue": 2500000, "refunds": 0 } ]
}
```

`daily` chạy từ ngày có đơn đầu tiên (hoặc ngày mở bán) tới hôm nay / ngày diễn cuối, tối đa 366 ngày.

Doanh thu theo **hạng vé**: cộng `order_items.total_amount` (giá trước giảm); phần giảm giá tính trên **cả đơn** nên chỉ có ở mức suất / sự kiện. Bảng hạng vé ghi rõ "trước giảm giá".

### 3.2 `GET /api/v1/reports/my-events` (REP-01b)

Quyền: `report:read:own`. Các sự kiện của organizer đang đăng nhập (mọi trạng thái trừ đã xóa), mỗi sự kiện: trạng thái, suất gần nhất, vé bán / sức chứa, doanh thu, hoàn tiền; kèm dòng tổng. Không phân trang (một organizer có vài chục sự kiện); quá 200 sự kiện thì trả 200 sự kiện mới nhất và báo `truncated: true`.

### 3.3 `GET /api/v1/reports/sales?from=&to=` (REP-02)

Quyền: `report:read:any`. `from`, `to` bắt buộc, `from ≤ to`, khoảng tối đa **366 ngày**, không quá hôm nay.

```json
{
  "range": { "from": "2026-09-14", "to": "2026-10-13" },
  "totals": { "orders": 120, "tickets": 310, "gross": …, "discount": …, "revenue": …,
              "refunds": { "orders": 4, "amount": … }, "buyers": 95 },
  "daily": [ { "date": "…", "orders": …, "tickets": …, "revenue": …, "refunds": … } ],
  "topEvents": [ { "id": "…", "title": "…", "organizerName": "…", "orders": …, "tickets": …, "revenue": … } ],
  "byOrganizer": [ { "id": "…", "name": "…", "orders": …, "revenue": … } ]
}
```

`topEvents`: 10 sự kiện doanh thu cao nhất trong khoảng; `byOrganizer`: doanh thu theo nhà tổ chức (để đối soát).

### 3.4 `GET /api/v1/reports/overview` (DASH)

Quyền: `report:read:any`. Số liệu cho dashboard trong **một** lần gọi: doanh thu, đơn, vé của **hôm nay / 7 ngày / 30 ngày**; `daily` 30 ngày; top 5 sự kiện 30 ngày; số sự kiện đang bán, người dùng mới 7 ngày; hoàn tiền 30 ngày.

### 3.5 Hiệu năng

- Thêm index bằng migration: `orders (paid_at) WHERE status IN ('PAID','COMPLETED')` (lọc theo khoảng ngày), `refunds (completed_at) WHERE status = 'SUCCESS'`. Các truy vấn theo sự kiện đã có index `order_items`, `tickets (schedule_id, status)`.
- **Không cache** ở bước này: số liệu cần mới (vừa bán xong mở báo cáo phải thấy), dữ liệu dự án nhỏ. Kiểm tra bằng `EXPLAIN ANALYZE` với dữ liệu giả ~100.000 đơn; nếu một báo cáo chậm hơn ~300 ms thì thêm cache Redis 60 giây (đã có sẵn cơ chế cache Phase 6).
- Giới hạn tần suất: dùng giới hạn chung của API.

---

## 4. Giao diện web

### 4.1 Organizer

- **`/organizer` (Sự kiện của tôi)**: thêm 3 ô số liệu ở đầu (doanh thu, vé đã bán, sự kiện đang bán) và cột "Đã bán / Sức chứa", "Doanh thu" trong danh sách.
- **Trang sự kiện → tab "Doanh thu"** (sự kiện đã đăng / đã kết thúc):
  - Ô số liệu: doanh thu, vé bán, lấp đầy %, đã vào cổng, hoàn tiền.
  - Biểu đồ cột **doanh thu theo ngày** (di chuột / chạm vào cột để xem số).
  - Bảng **theo suất → hạng vé**: đã bán / sức chứa, thanh lấp đầy, doanh thu, đã vào cổng.
  - Bảng **mã giảm giá đã dùng**.
  - Nút **Tải CSV** cho bảng hạng vé và bảng theo ngày.

### 4.2 Admin

- **`/admin` (Tổng quan) thành dashboard**: ô số liệu hôm nay / 7 ngày / 30 ngày (doanh thu, đơn, vé), biểu đồ 30 ngày, top 5 sự kiện, hoàn tiền 30 ngày, và các việc chờ duyệt đang có.
- **`/admin/reports` (mục menu mới "Doanh thu")**: chọn khoảng ngày (có nút nhanh: 7 ngày, 30 ngày, tháng này, tháng trước), ô số liệu, biểu đồ theo ngày (doanh thu + hoàn tiền), bảng top sự kiện (bấm vào → báo cáo REP-01 của sự kiện đó), bảng theo nhà tổ chức, nút Tải CSV.
- Admin mở được trang doanh thu của **bất kỳ sự kiện** (`/admin/reports/events/:id`), dùng chung component với organizer.

### 4.3 Biểu đồ và CSV

- **Biểu đồ tự vẽ bằng SVG** (component `BarChart` nhỏ, khoảng 100 dòng), **không thêm thư viện** biểu đồ (Recharts / Chart.js nặng 50–200 KB). Chỉ cần cột theo ngày + đường / cột hoàn tiền, trục tiền rút gọn ("1,2 tr", "350 N"), tooltip khi chạm.
- **CSV tạo ngay trên trình duyệt** từ dữ liệu đã tải (không cần API riêng, không phải xử lý token khi tải file): UTF-8 có **BOM** để Excel đọc đúng tiếng Việt, dấu phẩy, số tiền là số nguyên (không định dạng) để tính toán được, tên file như `doanh-thu_2026-09-14_2026-10-13.csv`. Ô bắt đầu bằng `=`, `+`, `-`, `@` được thêm dấu `'` phía trước (chống **CSV injection**: tên sự kiện do người dùng nhập, Excel có thể chạy như công thức).

---

## 5. Kiểm thử

- **Backend (Jest)**, khoảng 12 test:
  - Chỉ đơn PAID / COMPLETED được tính; đơn REFUNDED rút khỏi doanh thu và hiện ở hoàn tiền; đơn HELD / EXPIRED / CANCELLED không tính.
  - **Ranh giới ngày giờ VN**: đơn trả 16:59 UTC và 17:00 UTC rơi vào hai ngày khác nhau.
  - Gộp / giảm giá / thực thu khớp nhau; mã giảm giá đếm đúng.
  - Tỷ lệ lấp đầy trừ ghế đang khóa; vé đứng và ghế ngồi; đã vào cổng.
  - Ngày không có đơn vẫn có trong `daily` (giá trị 0).
  - Organizer xem sự kiện của người khác → 404; khách hàng → 403; admin xem được mọi sự kiện.
  - Khoảng ngày sai / quá 366 ngày → 400.
  - Tổng của `daily` = `totals`; tổng các hạng vé = tổng suất (ràng buộc khớp số).
- **Web (Vitest)**: tạo CSV (BOM, dấu ngoặc kép, chống injection), rút gọn số tiền trục biểu đồ, tính thang trục.
- **Thử tay trên trình duyệt**: mua vài vé (có mã giảm giá) → xem báo cáo organizer → hoàn tiền một đơn → số liệu đổi đúng; admin xem dashboard, khoảng ngày, tải CSV mở bằng Excel.

---

## 6. Ước lượng

| Hạng mục | Giờ |
|---|---|
| API: 4 endpoint, truy vấn tổng hợp, migration index, test | 7 |
| Web: BarChart, CSV, trang doanh thu sự kiện, dashboard admin, trang báo cáo admin, cột mới ở "Sự kiện của tôi" | 7 |
| Dữ liệu giả để đo tốc độ, tài liệu | 2 |
| **Tổng** | **≈ 16 giờ** (kế hoạch Phase 12 ước 11 giờ; thêm phần mã giảm giá, CSV, dashboard) |

Làm thành **một bước** (API rồi web), test xong commit.

---

## 7. Cần quyết định khi review

1. **Định nghĩa số liệu** như mục 2: con số chính là **thực thu (sau giảm giá)**, có hiện thêm gộp và giảm giá; đơn hoàn tiền rút khỏi ngày bán và hiện ở ngày hoàn. Đồng ý?
2. **Tỷ lệ lấp đầy** = vé bán ÷ (sức chứa − chỗ đang khóa). Đồng ý?
3. Doanh thu **theo hạng vé** tính **trước giảm giá** (giảm giá áp cho cả đơn, không chia nhỏ về từng vé). Đồng ý?
4. **Biểu đồ tự vẽ SVG**, không thêm thư viện. Đồng ý?
5. **CSV tạo trên trình duyệt** (UTF-8 BOM, chống CSV injection), không làm .xlsx / PDF. Đồng ý?
6. **Không cache**, tính trực tiếp + thêm 2 index; chỉ thêm cache nếu đo thấy chậm. Đồng ý?
7. `/admin` trở thành **dashboard**, thêm menu **"Doanh thu"** (`/admin/reports`); organizer xem ở **tab "Doanh thu"** trong trang sự kiện và cột mới ở "Sự kiện của tôi". Đồng ý?
8. Làm **một bước**, nhánh `feature/phase-12-reports` (đã tạo từ `main`). Đồng ý?

Đã duyệt cả 8 điểm.

---

## 8. Ghi chú triển khai (xong)

- **Backend** (module `reports`): `GET /api/v1/reports/events/:id/sales`, `/reports/my-events`, `/reports/sales?from=&to=`, `/reports/overview`. Migration `20261014100001000_report-indexes`: index một phần `orders (paid_at)` cho đơn đã bán và `refunds (completed_at)` cho hoàn tiền thành công. Đơn vị ngày và khoảng ngày xử lý trong `vn-date.js`.
- **Khác bản thiết kế một chút**:
  - "Vé đã bán" = tổng số lượng trong các dòng của đơn đã bán (bằng số vé được phát hành), để con số có ngay khi thanh toán, không phải chờ worker phát vé xong.
  - Biểu đồ sự kiện hiện **ít nhất 14 ngày** gần nhất (sự kiện mới bán một ngày không chỉ có một cột).
  - Biểu đồ vẽ bằng **thẻ HTML + CSS** (cột flex) thay vì SVG: chữ trên trục không bị co lại trên điện thoại; vẫn không thêm thư viện.
- **Web**: `/admin` có thêm phần doanh thu (hôm nay / 7 / 30 ngày, biểu đồ 30 ngày, bán chạy 30 ngày); menu **Doanh thu** `/admin/reports` (chọn khoảng ngày, nút nhanh, top sự kiện, theo nhà tổ chức, CSV); `/admin/reports/events/:id`; organizer: tab **Doanh thu** trong trang sự kiện (đang bán / đã diễn / đã hủy), "Sự kiện của tôi" có 4 ô tổng và cột "Đã bán / chỗ", "Doanh thu" (bấm vào mở tab Doanh thu).
- **Test**: backend 8 test mới (tổng 243 pass); web 7 test mới (CSV, số rút gọn, thang trục, ngày giờ VN, khoảng nhanh; tổng 58 pass).
- **Đo tốc độ** (100.000 đơn giả trong một transaction rồi rollback): doanh thu theo ngày 366 ngày 68 ms, 30 ngày 29 ms, bán theo hạng vé của sự kiện có 100.000 đơn 72 ms → chưa cần cache.
- **Thử trên trình duyệt** (Docker, `http://localhost:8080`): dashboard admin khớp với DB (hôm nay 3 đơn 5.570.000đ, hoàn 1 đơn; 7 ngày 6 đơn 11.570.000đ); báo cáo "Hòa nhạc tạo trên Web 12.2": gộp 2.650.000đ − giảm 100.000đ (WEB12TEST), 1 ghế khóa, 3/3 đã vào cổng, hoàn 1 đơn 500.000đ; organizer `webtest-org12` thấy 2 sự kiện của mình, tab Doanh thu, giao diện điện thoại.
