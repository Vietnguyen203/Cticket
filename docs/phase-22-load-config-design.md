# Phase 22 — Giả lập tải: số người dùng cùng lúc cấu hình được

> Trạng thái: **đã làm** (duyệt cả 4 điểm ở mục 11). Kết quả đo: `docs/testing.md` mục 4. Khác thiết kế: mục 12.

## 1. Vấn đề

Nhận xét phát triển: *"Test giả lập về cấu hình số lượng người sử dụng cùng 1 thời điểm"*.

Dự án đã có 4 kịch bản k6 từ Phase 13 (duyệt sự kiện, sơ đồ ghế, tranh ghế, hỗn hợp). Nhưng **số người dùng ảo bị viết cứng trong từng file** (300, 200, 500, 200). Muốn thử 1.000 người phải sửa code, và không thể chạy liền nhiều mức để so sánh.

Phase 21 vừa thêm **hàng chờ mua vé** nhưng chưa có kịch bản tải nào cho nó. Chưa biết hàng chờ có chịu được hàng nghìn người cùng vào hay không, và có giữ đúng giới hạn N người mua cùng lúc khi bị dồn tải hay không.

## 2. Mục tiêu

1. Chọn **số người dùng cùng lúc** (và cách họ đến) **khi chạy lệnh**, không sửa code, cho cả 4 kịch bản cũ.
2. Kịch bản mới cho **hàng chờ mua vé**: hàng trăm đến hàng nghìn người cùng vào, chờ lượt, mua.
3. Sau mỗi lần chạy, **kiểm tra tự động**:
   - không ghế nào bán hai lần (như cũ);
   - **không lúc nào số người đang mua vượt N**.
4. **Chạy đo thật** ở 3 mức (200 / 500 / 1.000 người), ghi bảng kết quả.

## 3. Tham số khi chạy

Mọi kịch bản đọc thêm các biến `-e` của k6. Không truyền thì giữ đúng hành vi cũ, nên các số đo cũ vẫn so được.

| Biến | Ý nghĩa | Ví dụ |
|---|---|---|
| `VUS` | số người dùng ảo cùng lúc (mức cao nhất) | `-e VUS=1000` |
| `RAMP` | thời gian tăng từ 0 lên `VUS` | `-e RAMP=30s` |
| `DURATION` | thời gian giữ ở mức cao nhất | `-e DURATION=2m` |
| `SHAPE` | cách người dùng đến: `ramp` (tăng dần, mặc định), `spike` (tất cả cùng lúc), `steps` (bậc thang 25 / 50 / 75 / 100%) | `-e SHAPE=spike` |

Ví dụ:

```
k6 run -e VUS=1000 -e SHAPE=spike -e DURATION=1m loadtest/k6/contention.js
```

- Kịch bản **hỗn hợp** chia `VUS` theo tỉ lệ cũ: 70% duyệt, 20% xem sơ đồ, 10% mua.
- Phần dựng `stages` từ các biến nằm chung trong `loadtest/k6/profile.js`. Các kịch bản chỉ khai báo giá trị mặc định của mình.
- **Kiểm tra trước khi chạy**: `VUS` lớn hơn số tài khoản đã seed (với kịch bản cần mỗi người một tài khoản) thì k6 dừng ngay với thông báo rõ ràng, thay vì cho nhiều người dùng chung một giỏ hàng.

## 4. Dữ liệu mẫu theo quy mô (`loadtest/seed.mjs`)

- `LOAD_CUSTOMERS`: số tài khoản khách (đã có, mặc định 2.000). Cần ít nhất bằng `VUS`.
- **Mới:** một **sự kiện bật hàng chờ** riêng, với:
  - `LOAD_QUEUE_CAPACITY`: N người được mua cùng lúc (mặc định **50**);
  - 5 phút một lượt;
  - 20.000 vé đứng, để người cuối hàng vẫn còn vé mua.
- `data.json` ghi thêm id của sự kiện đó, N, và token của ban tổ chức (để đọc số liệu hàng chờ).

## 5. Kịch bản mới `loadtest/k6/queue.js`

Mô phỏng **giờ mở bán** của một sự kiện đông khách. Mỗi người dùng ảo là một khách thật (một tài khoản riêng), đi đúng như trên web:

1. Vào hàng chờ (`POST /events/:id/queue`). Nếu dùng `-e SPREAD=30s` thì người đến rải đều trong 30 giây, không thì tất cả đến cùng một lúc.
2. Đang chờ thì hỏi vị trí **mỗi 3 giây** (`GET /events/:id/queue`), giống trang chờ trên web.
3. Tới lượt → "chọn vé" (nghỉ `THINK` giây, mặc định 5–15) → giữ chỗ vé đứng → checkout → thanh toán (giả lập).
4. Thanh toán xong thì lượt tự trả cho người sau, như trên web.

Một người dùng ảo bên cạnh, đóng vai **ban tổ chức**, đọc số liệu hàng chờ mỗi giây.

**Số đo:**

| Số đo | Ý nghĩa |
|---|---|
| `queue_wait` | thời gian từ lúc vào hàng tới lúc được vào (trung bình, p95, lâu nhất) |
| `queue_admitted`, `purchases_completed` | số người được vào, số người mua xong |
| `queue_active_seen` | số người đang mua mà ban tổ chức thấy; **ngưỡng: lớn nhất ≤ N** |
| `http_req_duration` theo từng API | vào hàng, hỏi vị trí, giữ chỗ, thanh toán |

**Ngưỡng đạt** (k6 báo lỗi nếu vượt):
- lỗi HTTP < 1%;
- p95 vào hàng và hỏi vị trí < 300 ms;
- p95 giữ chỗ và thanh toán < 800 ms;
- `queue_active_seen` lớn nhất ≤ N;
- mọi người đều được vào.

## 6. Kiểm tra sau khi chạy (`loadtest/verify.mjs`)

Thêm một kiểm tra độc lập với Redis, tính lại **từ dữ liệu đơn hàng trong PostgreSQL**:
- Mỗi đơn của sự kiện có hàng chờ là một khoảng thời gian "đang mua": từ lúc tạo tới lúc thanh toán, hủy hoặc hết hạn.
- Đếm số khoảng chồng lên nhau nhiều nhất cùng một lúc (SQL window function).
- Kết quả **phải ≤ N**.

Hai kiểm tra bổ trợ nhau: số liệu Redis (lúc chạy) và số liệu đơn hàng (sau khi chạy). Nếu hàng chờ có lỗi để lọt người, ít nhất một trong hai sẽ bắt được.

## 7. Chạy đo và ghi kết quả

Máy đo như các lần trước (laptop i5-12500H, 24 GB, Docker Desktop, k6 chạy cùng máy).

| Kịch bản | Mức tải | Bản API |
|---|---|---|
| `queue.js` (N = 50, tất cả đến cùng lúc) | 200 / 500 / 1.000 người | 1 và 3 |
| `contention.js` (tranh 50 ghế) | 200 / 500 / 1.000 người | 1 |
| `mixed.js` | 200 / 500 / 1.000 người | 1 |

- Ghi vào `docs/testing.md` mục 4: request/giây, p95, lỗi, thời gian chờ trong hàng, `verify.mjs` đạt hay không.
- File kết quả thô lưu ở `loadtest/results/`.
- Mức nào **không đạt ngưỡng** thì ghi rõ chỗ nghẽn (CPU API, kết nối PostgreSQL, Redis…), không giấu. Đó là giới hạn của một máy laptop, sẽ là đầu vào cho bước rà soát lỗi.

## 8. Không làm

- Không chạy k6 trên máy khác hay trên cloud: chỉ đo trên laptop như Phase 13.
- Không thêm biểu đồ thời gian thực (Grafana / InfluxDB). Kết quả là bản tóm tắt cuối của k6 cộng file JSON.
- Không đổi code backend, trừ khi lần đo phát hiện lỗi. Khi đó sửa riêng, kèm test.

## 9. Test

- Kịch bản k6 không có unit test. Ngoài các con số đo được, còn kiểm tra bằng:
  - `k6 inspect` cho từng file với vài bộ tham số (dựng `stages` đúng, báo lỗi khi `VUS` vượt số tài khoản);
  - một lần chạy nhỏ (`VUS=20`) phải qua mọi ngưỡng và `verify.mjs`.
- Hàm dựng `stages` viết thuần, không phụ thuộc k6, nên có test Node nhỏ (`node --test`) cho các trường hợp `ramp` / `spike` / `steps` và mặc định.

## 10. Ước lượng

| Việc | Giờ |
|---|---|
| `profile.js`, áp vào 4 kịch bản cũ, kiểm tra số tài khoản | 1 |
| Seed sự kiện có hàng chờ, `queue.js`, số liệu ban tổ chức | 2 |
| Kiểm tra trùng lặp thời gian trong `verify.mjs` | 0,5 |
| Chạy đo 3 mức, ghi kết quả, tài liệu | 1,5 |
| **Tổng** | **≈ 5 giờ** |

## 11. Cần quyết định khi review

1. Tham số `VUS` / `RAMP` / `DURATION` / `SHAPE` như mục 3. Đồng ý?
2. Kịch bản hàng chờ mặc định: **N = 50, tất cả đến cùng lúc**, mỗi người "chọn vé" 5–15 giây. Đồng ý?
3. Đo **200 / 500 / 1.000** người. Có muốn thử thêm mức cao hơn (ví dụ 2.000) không? Trên laptop có thể chạm giới hạn của máy, không phải của hệ thống.
4. Mức nào không đạt ngưỡng thì **ghi lại, không sửa ngay** trong phase này. Việc sửa đưa sang bước rà soát lỗi. Đồng ý?

## 12. Ghi chú triển khai

- **k6 chạy trong mạng Docker** (image `grafana/k6`), gọi thẳng `load-lb:3200`. Chạy k6 trên Windows rồi đi qua cổng `localhost:3200` thì ở 500–1.000 người, 3,5–4,4% kết nối bị từ chối ngay ở máy (`connectex: ... actively refused`). Lỗi đó do cơ chế chuyển cổng của Docker Desktop không nhận kịp hàng trăm kết nối mở cùng lúc, không phải do API: trong mạng Docker, cùng tải đó cho 0% lỗi. Hai cách chạy đều có trong `docs/testing.md`.
- **Hai lỗi của chính script đo**, tìm ra nhờ lần đo đầu:
  - người dùng ảo "ban tổ chức" được đánh số chung với người mua, nên với đúng 1.000 tài khoản, một người mua không có token (401 suốt 15 phút, "không bao giờ được vào"). Sửa: đánh số theo lượt chạy của kịch bản người mua (`exec.scenario.iterationInTest`);
  - lần vào hàng đầu tiên lỗi kết nối thì người dùng ảo cứ hỏi vị trí mãi. Sửa: chưa vào được hàng thì vào lại, như trang web.
- **Dữ liệu cạn qua nhiều lần chạy**: 5.000 vé đứng của sự kiện lớn hết sau vài lần chạy hỗn hợp, nên lượt mua giảm (bị từ chối hợp lệ). Mỗi loạt đo nên bắt đầu bằng `node loadtest/seed.mjs`.
- **Token của người dùng ảo sống 2 giờ** kể từ lúc seed: loạt đo dài hơn thì seed lại.
- **Kiểm tra trùng lặp thời gian** (`verify.mjs`) đếm đơn mở cùng lúc, luôn ≤ số lượt (người có lượt nhưng còn đang chọn vé chưa có đơn). Số người có lượt thật thì do ban tổ chức đọc trong lúc chạy (`queue_active_seen`).
- `profile.js` có test Node (`node --test loadtest/k6/profile.test.js`, 7 test). `loadtest/k6/package.json` chỉ để Node đọc file dưới dạng ES module; k6 bỏ qua nó.
