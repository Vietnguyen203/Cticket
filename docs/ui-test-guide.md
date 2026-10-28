# Hướng dẫn test chức năng trên giao diện

> Bản 28/10/2026 (vé không hủy, không hoàn theo yêu cầu: chỉ hoàn khi sự kiện bị hủy, phiên 9 và 16; ô số tiền có dấu chấm hàng nghìn).
> Dùng để **test tay toàn bộ chức năng bằng cách thao tác trên web**, theo thứ tự, từ một hệ thống trống tới khi đã có đơn, vé, soát vé, đánh giá, hoàn tiền.
> Mỗi bước ghi mã test case tương ứng trong [`test-scenarios.md`](test-scenarios.md) (danh sách đầy đủ 113 case và test tự động bảo vệ từng case).

## 1. Cách dùng

- Làm **theo thứ tự các phiên**: phiên sau dùng dữ liệu phiên trước tạo ra. Cả bộ mất khoảng **2–3 giờ**; chỉ cần kiểm tra nhanh trước demo thì làm các bước có dấu ★ (khoảng 40 phút).
- Mỗi bước gồm:
  - **Thao tác**: chữ trong ngoặc kép là đúng chữ trên nút / nhãn / menu của giao diện;
  - **Kết quả mong đợi**: những gì phải thấy;
  - **KQ**: ghi **Đạt** hoặc **Lỗi** (bản Word có sẵn cột trống để điền).
- Gặp lỗi: chụp màn hình, ghi lại theo mẫu ở mục 4, rồi làm tiếp các bước không phụ thuộc vào bước lỗi.
- Cột đầu ghi số bước và mã test case, ví dụ `5.1 · BKG-01` là bước 1 của phiên 5, ứng với `TC-BKG-01`.

## 2. Chuẩn bị

### 2.1. Môi trường

1. Mở Docker Desktop. Ở thư mục gốc dự án (PowerShell):
   ```
   docker compose up -d --build
   ```
2. Các địa chỉ:

   | Địa chỉ | Dùng cho |
   |---|---|
   | http://localhost:8080 | Web, trên máy tính |
   | https://`<IP máy tính>`:8443 | Web trên điện thoại cùng Wi-Fi (bắt buộc HTTPS để dùng camera quét vé). Chứng chỉ tự ký: bấm "Nâng cao" → "Tiếp tục" lần đầu |
   | http://localhost:3001/health/ready | Kiểm tra API đang chạy: phải trả `"status":"ok"` |

   Lấy IP máy tính: `ipconfig` → dòng "IPv4 Address" của card Wi-Fi.

### 2.2. Email: stack này gửi email THẬT

Stack Docker trên máy dev gửi email qua Gmail thật (cấu hình `SMTP_*` trong `.env`). Vì vậy:

- Mọi tài khoản test dùng **email bạn đọc được**. Cách gọn nhất là **địa chỉ phụ của Gmail**: `ten+khacha@gmail.com`, `ten+khachb@gmail.com`… đều về chung hộp thư `ten@gmail.com`, nhưng hệ thống coi là các tài khoản khác nhau.
- **Không mua vé bằng tài khoản `admin@etp.local`**: địa chỉ này không có hộp thư, email xác nhận và vé PDF sẽ gửi vào chỗ không tồn tại.
- Không dùng email của người khác.

### 2.3. Tài khoản

| Vai | Email (ví dụ) | Tạo ở |
|---|---|---|
| Quản trị | `admin@etp.local` (có mọi vai trò) | có sẵn; mật khẩu: hỏi người quản lý dự án, **không ghi vào tài liệu** |
| Khách A | `ten+khacha@gmail.com` | phiên 1 |
| Khách B | `ten+khachb@gmail.com` | phiên 1 |
| Ban tổ chức | `ten+btc@gmail.com` | phiên 3 |
| Nhân viên soát vé | `ten+soatve@gmail.com` | phiên 10 |

Trên stack Docker ở máy dev, admin đăng nhập **không cần 2FA** (`.env` có `TWO_FACTOR_REQUIRED_ROLES=NONE` và `ALLOW_ADMIN_WITHOUT_2FA=true`). Trên production, admin bắt buộc 2FA (TC-AUTH-09).

Mật khẩu của các tài khoản test do người test tự đặt và tự giữ, không ghi vào tài liệu hay biên bản.

### 2.4. Trình duyệt và thiết bị

- Nhiều tài khoản cùng lúc cần **phiên đăng nhập riêng**: mỗi tài khoản một **hồ sơ Chrome** (Chrome → biểu tượng hồ sơ → "Thêm"), hoặc Chrome + Edge + một cửa sổ ẩn danh. Hai tab cùng một hồ sơ là cùng một tài khoản.
- Một **điện thoại** (phiên 10, phiên 15).
- Một ứng dụng xác thực trên điện thoại (Google Authenticator, Microsoft Authenticator…), nếu test 2FA (bước 1.8).
- Đồng hồ máy tính và điện thoại để **tự động đặt giờ** (lệch hơn 1 phút thì mã 2FA bị từ chối).

### 2.5. Dữ liệu dùng xuyên suốt

| Thứ | Giá trị | Tạo ở |
|---|---|---|
| Danh mục | `Hòa nhạc test` | 2.1 |
| Địa điểm | `Nhà hát Test`, TP. Hồ Chí Minh, **sức chứa 150**: **Khu A** ghế ngồi, hàng A–E, ghế 1–10 (50 ghế); **Khu đứng** 100 chỗ | 2.2–2.4 |
| Mã giảm giá | `TEST10`: giảm 10% | 2.5 |
| Sự kiện 1 | `Đêm nhạc Test <ngày>`: 1 suất **30 ngày sau**, hạng `VIP` 1.500.000 (ghế) và `Vé đứng` 300.000 | 3.4–3.12 |
| Sự kiện 2 | `Đêm soát vé <ngày>`: 1 suất bắt đầu **2 giờ sau lúc tạo**, chỉ `Vé đứng` **2 vé** | 3.13–3.15 |

Thêm ngày test vào tên (ví dụ `Đêm nhạc Test 22-10`) để phân biệt với dữ liệu khác và để dọn sau (mục 5).

---

## 3. Các phiên test

### Phiên 1. Tài khoản (khách)

Trình duyệt hồ sơ "Khách A".

| Bước | Thao tác | Kết quả mong đợi | KQ |
|---|---|---|---|
| 1.1 · AUTH-01 ★ | Mở http://localhost:8080 → "Đăng ký". Điền "Họ", "Tên", "Email" (`ten+khacha@…`), "Mật khẩu", "Nhập lại mật khẩu" → "Đăng ký" | Chuyển sang trang nhập mã; email "mã xác minh" 6 số tới hộp thư | |
| 1.2 · AUTH-01 ★ | Nhập mã vào "Mã xác minh" → "Xác minh" | Đã đăng nhập: tên của bạn ở góc phải đầu trang, có menu "Vé của tôi" | |
| 1.3 · AUTH-06 | Tải lại trang (F5) | Vẫn đăng nhập | |
| 1.4 · AUTH-06 | Bấm tên ở đầu trang → trang tài khoản → "Đăng xuất" | Đầu trang hiện lại "Đăng nhập" | |
| 1.5 · AUTH-03 ★ | "Đăng nhập" → đúng email, **sai** mật khẩu → "Đăng nhập" | Báo lỗi sai email hoặc mật khẩu; vẫn ở trang đăng nhập. Thử một email không tồn tại: thông báo **giống hệt** | |
| 1.6 · UI-06 | Ở ô "Mật khẩu", bấm biểu tượng con mắt | Mật khẩu hiện / ẩn; form không bị gửi | |
| 1.7 · AUTH-05 | "Quên mật khẩu?" → email Khách A → nhập mã trong email + mật khẩu mới | Đăng nhập được bằng mật khẩu mới; mật khẩu cũ không còn dùng được | |
| 1.8 · AUTH-07 | (Nếu có ứng dụng xác thực) Trang tài khoản → "Bật xác thực hai lớp" → "Mật khẩu hiện tại" → "Tiếp tục" → quét mã QR bằng ứng dụng → nhập "Mã xác thực" → đánh dấu "Tôi đã lưu các mã này ở nơi an toàn" → "Xong" | Trang tài khoản ghi "Đang bật từ … Còn 10 mã khôi phục."; có email báo vừa bật 2FA. **Chép 10 mã khôi phục ra giấy** | |
| 1.9 · AUTH-07 | Đăng xuất, đăng nhập lại | Sau mật khẩu, trang hỏi mã 6 số; nhập mã trong ứng dụng thì vào được | |
| 1.10 · AUTH-08 | Đăng xuất, đăng nhập lại; ở bước hỏi mã bấm "Không có điện thoại? Dùng mã khôi phục" → nhập một mã đã chép → "Xác nhận" | Vào được; trang tài khoản còn 9 mã; dùng lại đúng mã đó thì bị từ chối | |
| 1.11 · AUTH-01 ★ | Hồ sơ trình duyệt "Khách B": đăng ký `ten+khachb@…` như 1.1–1.2 | Khách B đăng nhập được | |
| 1.12 · AUTH-04 | (Tùy chọn, mất 15 phút khóa) Hồ sơ Khách B, đăng xuất: nhập sai mật khẩu **5 lần** liên tiếp, rồi nhập đúng | Lần thứ 5 báo bị khóa tạm; mật khẩu đúng cũng bị từ chối; có email báo bị khóa. Gỡ khóa: bước 13.3 (admin) hoặc "Quên mật khẩu?" | |

### Phiên 2. Quản trị chuẩn bị danh mục, địa điểm, mã giảm giá

Hồ sơ trình duyệt "Admin": đăng nhập `admin@etp.local`. Menu "Quản trị" ở đầu trang → menu bên trái.

| Bước | Thao tác | Kết quả mong đợi | KQ |
|---|---|---|---|
| 2.1 · ADM-04 ★ | "Danh mục" → "Tên danh mục mới": `Hòa nhạc test` → thêm | Danh mục có trong bảng, "Số sự kiện" = 0 | |
| 2.2 · ADM-04 ★ | "Địa điểm" → "Thêm địa điểm": "Tên địa điểm" `Nhà hát Test`, "Địa chỉ", "Thành phố" `TP. Hồ Chí Minh`, "Sức chứa (không bắt buộc)" `150` → "Tạo và thêm khu / ghế" | Mở trang chi tiết địa điểm, phần "Khu và ghế" chưa có khu nào; dòng "Các khu: 0 chỗ … / sức chứa 150" | |
| 2.3 · ADM-04 ★ | Phần thêm khu: "Tên khu" `Khu A`, "Mã khu" `A`, "Loại" "Khu ngồi (có ghế)" → "Thêm". Ở khu vừa tạo: "Thêm hàng ghế" `A-E`, "Từ ghế số" `1`, "Đến ghế số" `10` → "Sinh ghế" | Khu A có 5 hàng × 10 ghế = 50 ghế | |
| 2.4 · ADM-04 ★ | Thêm khu: "Tên khu" `Khu đứng`, "Mã khu" `GA`, "Loại" "Khu đứng", "Sức chứa" `100` → "Thêm". Thử thêm một khu đứng nữa `10` chỗ | Có khu đứng 100 chỗ; "Các khu: 150 chỗ (50 ghế + 100 đứng) / sức chứa 150 · còn thêm được 0"; khu 10 chỗ bị từ chối "Vượt sức chứa 150 của địa điểm…" | |
| 2.5 · ADM-05 ★ | "Mã giảm giá" → "Tạo mã giảm giá": "Mã (khách nhập)" `TEST10`, "Tên", "Kiểu giảm" "Phần trăm (%)", giảm `10`, "Bắt đầu (giờ VN)" hôm nay, "Hết hạn (giờ VN)" 2 tháng sau → "Tạo mã" | Mã ở trạng thái "Đang dùng", "Đã dùng" 0 | |

### Phiên 3. Ban tổ chức tạo và đưa sự kiện lên bán

| Bước | Thao tác | Kết quả mong đợi | KQ |
|---|---|---|---|
| 3.1 · ORG-01 ★ | Hồ sơ trình duyệt "Ban tổ chức": đăng ký `ten+btc@…` (như 1.1–1.2) → chân trang hoặc trang tài khoản: "Trở thành ban tổ chức" → "Tên tổ chức / công ty" → "Gửi đăng ký" | "Đơn đã gửi, đang chờ quản trị viên duyệt." | |
| 3.2 · ORG-01 ★ | Admin: "Nhà tổ chức" → lọc "Chờ duyệt" → dòng của tổ chức vừa gửi → "Duyệt" | Trạng thái "Hoạt động" | |
| 3.3 · ORG-01 ★ | Ban tổ chức: tải lại trang đăng ký → "Cập nhật quyền ngay" | "Đã được duyệt: bạn có thể tạo sự kiện."; đầu trang có menu "Ban tổ chức" | |
| 3.4 · ORG-02 ★ | "Ban tổ chức" → "Tạo sự kiện": "Tên sự kiện" `Đêm nhạc Test <ngày>`, "Mô tả", chọn danh mục `Hòa nhạc test` → "Tạo và tiếp tục" | Sang thẻ "Buổi diễn & vé"; sự kiện ở trạng thái nháp; form không có ô chính sách hủy | |
| 3.5 · ORG-03 | Thẻ "Thông tin" → "Ảnh bìa": tải một ảnh **dọc** từ máy | Hộp thoại căn ảnh mở: kéo để dịch, thu phóng; "Hiện trọn ảnh" thì thấy cả ảnh trong khung 16:9 | |
| 3.6 · ORG-03 | "Dùng ảnh này" → "Lưu thông tin" | Ảnh mới hiện ở ô xem trước; "Đã lưu." | |
| 3.7 · ORG-04 | Đổi tên một file `.txt` thành `.png` rồi tải làm ảnh | Bị từ chối, báo file không phải ảnh | |
| 3.8 · ORG-05 ★ | Thẻ "Buổi diễn & vé" → "Buổi diễn": chọn địa điểm `Nhà hát Test — TP. Hồ Chí Minh`; "Ngày diễn" **30 ngày sau**, "Giờ bắt đầu" gõ `19:00` (24 giờ; gõ `1900` cũng được), "Giờ kết thúc" `21:00` (để trống = 3 tiếng sau) → "Lưu buổi diễn" | Dòng buổi diễn đã lưu; không có nút thêm buổi thứ hai (mỗi sự kiện một buổi diễn); phần "Nghệ sĩ khách mời" và thẻ hạng vé hiện bên dưới | |
| 3.9 · ORG-05 ★ | "Tổng số người tham dự": ô đã điền sẵn sức chứa của địa điểm; nhập `100` → "Lưu tổng" | Dòng "Sức chứa địa điểm: … · các khu: … chỗ"; "Đã xếp 0 / 100 người · … · còn lại 100"; bảng "Hạng vé theo khu của địa điểm" liệt kê các khu có sẵn | |
| 3.10 · ORG-05 ★ | Dòng "Khu A" (khu ngồi, 50 ghế): "Tên hạng" `VIP`, "Giá (VND)" gõ `1500000` (ô tự hiện `1.500.000`) → "Gán 50 ghế" | Dòng Khu A hiện "VIP · 1.500.000 ₫ · 50 ghế" và nút "Bỏ gán"; bảng hạng vé: VIP "Ghế ngồi · Khu A: hàng A–E"; "Đã xếp 50 / 100" | |
| 3.11 · ORG-05 ★ | Dòng "Khu đứng" (100 chỗ): "Tên hạng" `Vé đứng`, "Giá (VND)" `300000`, "Số vé" đã điền sẵn `50` (phần còn lại của tổng; khu chứa 100), thử sửa thành `100` rồi trả về `50` → "Gán" | Với 100: báo "Chỉ còn 50 người chưa xếp"; với 50: "Đã xếp 100 / 100 · còn lại 0"; danh sách "sẵn sàng gửi duyệt" ở đầu trang không còn mục đỏ | |
| 3.12 · ORG-06 ★ | "Gửi duyệt" → xác nhận "Gửi duyệt". Admin: "Sự kiện" → mở sự kiện → "Duyệt và mở bán" → xác nhận | Ban tổ chức thấy "Đã gửi duyệt." rồi "Chờ duyệt"; sau khi admin duyệt: "Đang bán" | |
| 3.13 · ORG-02 ★ | Ban tổ chức tạo **sự kiện 2**: `Đêm soát vé <ngày>`, danh mục `Hòa nhạc test`, chính sách mặc định → "Tạo và tiếp tục" | Sự kiện nháp | |
| 3.14 · ORG-05 ★ | "Buổi diễn": địa điểm `Nhà hát Test`; "Ngày diễn" hôm nay, "Giờ bắt đầu" = **2 giờ sau giờ hiện tại**, "Giờ kết thúc" để trống (3 tiếng sau) → "Lưu buổi diễn". "Tổng số người tham dự" `2` → "Lưu tổng"; dòng "Khu đứng": "Tên hạng" `Vé đứng`, "Giá (VND)" `200000`, "Số vé" **`2`** → "Gán" | Buổi diễn có 1 hạng vé, 2 vé; "Đã xếp 2 / 2" | |
| 3.15 · ORG-06 ★ | "Gửi duyệt"; admin "Duyệt và mở bán" | Sự kiện 2 "Đang bán". **Làm phiên 8 và 10 trong vòng 2 giờ tới** (suất đóng bán lúc bắt đầu) | |
| 3.16 · ORG-10 | (Tùy chọn) Tạo sự kiện nháp thứ 3, khi thêm suất chọn "Địa điểm mới" và đề xuất một địa điểm | Admin thấy địa điểm ở "Địa điểm" → "Chờ duyệt (ban tổ chức đề xuất)"; được duyệt cùng lúc với sự kiện | |

### Phiên 4. Tìm và xem sự kiện

Hồ sơ "Khách A".

| Bước | Thao tác | Kết quả mong đợi | KQ |
|---|---|---|---|
| 4.1 · CAT-01 ★ | Trang chủ | Có sự kiện nổi bật, dải danh mục, lưới sự kiện sắp diễn ra (ngày, tên, thành phố), có `Đêm nhạc Test` | |
| 4.2 · CAT-02 ★ | Ô tìm kiếm: gõ `Đêm nhạc Test` → tìm | Chỉ hiện sự kiện khớp; dòng "N sự kiện cho …" đúng | |
| 4.3 · CAT-03 | Lọc thành phố `TP. Hồ Chí Minh`, bấm danh mục `Hòa nhạc test`; chép URL sang tab khác; rồi "Xóa bộ lọc" | Kết quả lọc đúng; tab kia (cùng URL) cho cùng kết quả; "Xóa bộ lọc" về lại tất cả | |
| 4.4 · CAT-04 | Tìm `khongcosukiennay` | "Không có sự kiện nào phù hợp" và nút "Xem tất cả sự kiện" | |
| 4.5 · CAT-05 ★ | Mở `Đêm nhạc Test` | Ảnh bìa, tên, thời gian, địa điểm, ban tổ chức, "Giá vé từ 300.000", lịch diễn có giá từng hạng, khung "Vé không hủy, không hoàn" (hủy sự kiện thì hoàn 100% tự động) | |
| 4.6 · CAT-07 | Mở `http://localhost:8080/events/khong-ton-tai` | "Không tìm thấy sự kiện" | |

### Phiên 5. Mua vé: giữ chỗ, mã giảm giá, thanh toán, vé

Hai hồ sơ: "Khách A" và "Khách B", để **cạnh nhau** trên màn hình.

| Bước | Thao tác | Kết quả mong đợi | KQ |
|---|---|---|---|
| 5.1 · BKG-02 ★ | Cả A và B mở `Đêm nhạc Test` → "Chọn chỗ" | Sơ đồ 50 ghế, chữ "Cập nhật trực tiếp" | |
| 5.2 · BKG-02 ★ | B bấm chọn ghế **A03** (chưa giữ) | Ghế A03 được đánh dấu ở phía B | |
| 5.3 · BKG-01 ★ | A chọn **A03**, **A04**, rồi "Thêm Vé đứng" 1 vé → "Giữ chỗ (10 phút)" | A sang trang đơn: "Ghế được giữ cho bạn trong" mm:ss đếm ngược; 3 vé; "Tổng cộng" **3.300.000** | |
| 5.4 · BKG-02 ★ | Nhìn trang của B (không tải lại) | A03, A04 đổi màu "đang có người giữ"; B nhận thông báo "Ghế A03 vừa có người khác giữ, đã bỏ khỏi lựa chọn của bạn." | |
| 5.5 · BKG-07 | A quay lại trang chọn chỗ của suất này, chọn thêm 1 ghế → giữ chỗ | Báo đã có đơn chưa hoàn tất ở suất này, có link mở đơn đó | |
| 5.6 · PAY-01 ★ | Ở trang đơn của A: "Mã giảm giá" `SAIMA99` → "Áp dụng" | Báo lỗi, tổng không đổi | |
| 5.7 · PAY-01 ★ | "Mã giảm giá" `TEST10` → "Áp dụng" | "Mã TEST10: giảm 330.000"; "Tổng cộng" **2.970.000** | |
| 5.8 · PAY-03 ★ | Nút "Tiếp tục thanh toán" mờ cho tới khi tích "Tôi đã đọc và đồng ý Điều kiện giao dịch chung"; tích → "Tiếp tục thanh toán" → "Giả lập thẻ bị từ chối" | "Thanh toán bị từ chối. Ghế vẫn được giữ…"; đồng hồ vẫn chạy | |
| 5.9 · PAY-02 ★ | "Giả lập thanh toán thành công" | "Thanh toán thành công!"; 3 vé, mỗi vé có link "Xem QR" | |
| 5.10 · TKT-03 ★ | Mở hộp thư của A | Email xác nhận đơn, có file PDF vé đính kèm | |
| 5.11 · TKT-01 ★ | "Xem QR" một vé | Vé dạng cuống vé: sự kiện, giờ, chỗ, "Còn hiệu lực", mã QR, mã vé `TKT-…` | |
| 5.12 · TKT-02 ★ | "Tải vé PDF" ở trang vé, rồi ở trang đơn | File `Ve-TKT-….pdf` (1 vé) và `Ve-<mã đơn>.pdf` (3 trang); tiếng Việt đủ dấu; quét QR trong PDF bằng điện thoại ra một chuỗi mã | |
| 5.13 · TKT-01 | "Vé của tôi" | 3 vé của `Đêm nhạc Test` | |
| 5.14 · BKG-03 | A và B cùng chọn ghế **B05**, đếm "1, 2, 3" rồi cùng bấm "Giữ chỗ (10 phút)" | Đúng 1 người giữ được; người kia báo ghế không còn và chọn lại được | |

### Phiên 6. Đổi ghế trong đơn, hết giờ giữ chỗ

| Bước | Thao tác | Kết quả mong đợi | KQ |
|---|---|---|---|
| 6.1 · BKG-06 | Người đang giữ B05 ở bước 5.14 (gọi là X; người kia là Y) mở đơn đó → "Đổi / thêm ghế". Y mở sơ đồ cùng suất, để yên | Trang "Đổi ghế", ghế B05 đang được chọn sẵn | |
| 6.2 · BKG-06 | X bỏ B05, chọn B06 và B07 | Ô "Thay đổi": "Thêm: B06, B07", "Bỏ: B05" | |
| 6.3 · BKG-06 | "Cập nhật đơn" | Về đúng đơn cũ: B06, B07; đồng hồ giữ chỗ **không** bị đặt lại | |
| 6.4 · BKG-06 | Ở trang đơn, bấm nút bỏ ghế của B07 | Đơn còn B06; không còn nút bỏ (vì chỉ còn 1 vé: dùng "Hủy giữ chỗ") | |
| 6.5 · BKG-06 | Nhìn sơ đồ của Y (không tải lại) | B05, B07 trống lại; B06 "đang có người giữ" | |
| 6.6 · BKG-05 | X **không thanh toán**, chờ hết 10 phút, rồi tải lại trang đơn | "Đã hết thời gian giữ chỗ, ghế đã được mở bán lại."; không còn nút "Tiếp tục thanh toán"; trên sơ đồ B06 trống lại | |

### Phiên 7. Hàng chờ mua vé (1 người mua, 1 người chờ)

Hồ sơ "Ban tổ chức", "Khách A", "Khách B". Không ai đang có đơn giữ chỗ ở sự kiện 1.

| Bước | Thao tác | Kết quả mong đợi | KQ |
|---|---|---|---|
| 7.1 · QUE-01 ★ | Ban tổ chức: "Sự kiện của tôi" → `Đêm nhạc Test` → thẻ "Thông tin" → khung "Hàng chờ mua vé": đánh dấu "Bật hàng chờ", "Số người được mua cùng lúc" `1` → "Lưu hàng chờ" | Lưu được dù sự kiện đang bán; dòng số liệu "đang mua 0 / 1" | |
| 7.2 · QUE-02 ★ | **A** mở trang chọn chỗ của sự kiện 1 | "Đến lượt bạn mua vé" kèm thời gian lượt còn lại; sơ đồ ghế hiện bình thường | |
| 7.3 · QUE-02 ★ | **B** mở trang chọn chỗ (sau A) | "Bạn đang trong hàng chờ mua vé", vị trí **1**, "Bạn là người tiếp theo"; không có sơ đồ ghế | |
| 7.4 · QUE-05 | B tải lại trang | Vẫn vị trí 1 | |
| 7.5 · QUE-01 | Ban tổ chức: thẻ "Doanh thu" | "đang mua 1 / 1", "đang chờ 1" (cập nhật sau vài giây) | |
| 7.6 · QUE-03 ★ | A giữ ghế **C01** → "Tiếp tục thanh toán" → "Giả lập thanh toán thành công" | A có vé. Trong vài giây, trang của B (**không tải lại**) tự chuyển sang "Đến lượt bạn mua vé" và hiện sơ đồ | |
| 7.7 · QUE-03 ★ | B giữ ghế **C02** | Sang trang đơn, đồng hồ giữ chỗ chạy | |
| 7.8 · QUE-06 | B "Hủy giữ chỗ"; A mở lại trang chọn chỗ (A vào lượt); B mở lại trang chọn chỗ (B chờ), rồi bấm "Rời hàng chờ" | B rời hàng; số liệu của ban tổ chức: đang chờ 0 | |
| 7.9 · QUE-08 ★ | Ban tổ chức bỏ "Bật hàng chờ" → "Lưu hàng chờ". B mở lại trang chọn chỗ | B vào thẳng sơ đồ, không còn hàng chờ | |

### Phiên 8. Danh sách chờ khi hết vé (sự kiện 2)

Sự kiện 2 chỉ có 2 vé đứng.

| Bước | Thao tác | Kết quả mong đợi | KQ |
|---|---|---|---|
| 8.1 · WTL-01 ★ | **A** mở `Đêm soát vé` → "Chọn chỗ" → thêm **2** vé đứng → "Giữ chỗ (10 phút)". **Không thanh toán** | Đơn giữ 2 vé | |
| 8.2 · WTL-01 ★ | **B** mở trang chọn chỗ của `Đêm soát vé` | "Hết vé? Vào danh sách chờ" | |
| 8.3 · WTL-01 ★ | B → "Báo tôi khi có vé" | "Đã vào danh sách chờ, bạn đứng thứ 1."; menu "Danh sách chờ" có mục này | |
| 8.4 · WTL-02 ★ | A mở đơn → "Hủy giữ chỗ" | Đơn của A bị hủy | |
| 8.5 · WTL-02 ★ | Chờ **tối đa 1–2 phút** (job mời chạy mỗi phút). B: "Danh sách chờ" → tải lại | "Có vé cho bạn" (vé được giữ riêng 30 phút); B nhận email mời | |
| 8.6 · WTL-03 | A mở lại trang chọn chỗ của `Đêm soát vé`, thử giữ vé | Không giữ được: vé đang được dành cho người trong danh sách chờ | |
| 8.7 · WTL-02 ★ | B → "Đặt ngay" → thêm 2 vé đứng → "Giữ chỗ (10 phút)" → "Tiếp tục thanh toán" → "Giả lập thanh toán thành công" | B có 2 vé `Đêm soát vé`; "Danh sách chờ" ghi "Đã đặt" | |

### Phiên 9. Không hủy vé, không hoàn tiền theo yêu cầu

Vé đã trả không hủy, không hoàn theo yêu cầu của khách hay admin; tiền chỉ được hoàn khi sự kiện hoặc suất diễn bị hủy (phiên 16).

| Bước | Thao tác | Kết quả mong đợi | KQ |
|---|---|---|---|
| 9.1 · REF-01 ★ | A mở đơn đã trả ở bước 7.6 (1 ghế VIP C01) | Đơn "Đã thanh toán"; **không** có nút hủy đơn hay hoàn tiền | |
| 9.2 · REF-09 | Trang `Đêm nhạc Test` → khung "Vé không hủy, không hoàn" → "Điều kiện hoàn tiền" | Mở /dieu-khoan đúng "Điều 5. Không hủy vé, hoàn tiền khi sự kiện bị hủy" | |
| 9.3 · REF-01 | B mở đơn `Đêm soát vé` | Không có nút hủy đơn | |
| 9.4 · REF-02 ★ | Admin: "Đơn hàng" → mở đơn 3 vé của A (bước 5.9) | Mục "Thanh toán" **không** có nút "Hoàn tiền"; đơn vẫn "Đã thanh toán", 3 vé còn QR | |
| 9.5 · ORG-08 ★ | Ban tổ chức: `Đêm nhạc Test` → thẻ "Doanh thu" | "Doanh thu" và "Vé đã bán" gồm các đơn đã trả của A (bước 5.9 và 7.6); "Hoàn tiền" chưa có đơn nào | |

### Phiên 10. Soát vé ở cổng (điện thoại)

Cổng mở từ **3 giờ trước giờ diễn**: sự kiện 2 (bắt đầu khoảng 2 giờ sau bước 3.14) đã mở cổng.

| Bước | Thao tác | Kết quả mong đợi | KQ |
|---|---|---|---|
| 10.1 · CHK-01 ★ | Trên **điện thoại** (https://`<IP>`:8443): đăng ký `ten+soatve@…` (như 1.1–1.2), mở menu ("Menu") | **Không** có mục "Soát vé" | |
| 10.2 · CHK-01 ★ | Ban tổ chức: `Đêm soát vé` → thẻ "Nhân viên soát vé" → "Email tài khoản nhân viên" `ten+soatve@…` → "Thêm nhân viên" | Có trong danh sách | |
| 10.3 · CHK-01 ★ | Điện thoại tải lại → "Menu" → "Soát vé" | Thấy `Đêm soát vé` (không thấy sự kiện 1) | |
| 10.4 · CHK-02 ★ | "Tên cổng của máy này" `Cổng 1` → "Quét vé" ở `Đêm soát vé` → cho phép dùng camera | Trang quét: "Cổng: Cổng 1", camera bật | |
| 10.5 · CHK-02 ★ | Máy tính, hồ sơ B: "Vé của tôi" → mở vé thứ nhất của `Đêm soát vé` (mã QR lên màn hình). Đưa điện thoại quét | Màn hình **xanh** "Mời vào", mã vé, "Đã vào 1 / 2" | |
| 10.6 · CHK-03 ★ | Chạm để quét tiếp, quét lại **đúng vé đó** (sau 3 giây) | Màn hình **đỏ** "Vé đã được sử dụng", lúc nào, "Tại: Cổng 1" | |
| 10.7 · CHK-05 | Mở file PDF đã tải ở bước 5.12 (vé sự kiện 1 của A) và quét mã QR trong đó | Màn hình đỏ kèm lý do (vé không thuộc suất này) | |
| 10.8 · CHK-06 | Mở lịch sử soát vé | "Đã vào 1 / 2 vé"; dòng của vé, đúng cổng và giờ | |
| 10.9 · CHK-04 | (Nếu có 2 điện thoại) Hai máy cùng quét vé thứ hai của B cùng lúc | Đúng 1 máy "Mời vào", máy kia "đã sử dụng"; số "Đã vào" giống nhau trên cả hai | |

Không có điện thoại: mở https://localhost:8443 trên máy tính có webcam để quét, và mở mã QR trên một máy khác.

### Phiên 11. Đánh giá sự kiện

| Bước | Thao tác | Kết quả mong đợi | KQ |
|---|---|---|---|
| 11.1 · REV-02 | A mở `Đêm soát vé` (A không có vé đã vào cổng) | Phần đánh giá không có ô viết | |
| 11.2 · REV-01 ★ | B: "Vé của tôi" → vé `Đêm soát vé` đã quét → "Đánh giá sự kiện" → "Viết đánh giá" → chọn **4 sao** → "Nhận xét" → "Gửi đánh giá" | Đánh giá hiện với nhãn "Đã đi xem"; "1 đánh giá", điểm 4 | |
| 11.3 · REV-03 ★ | Ban tổ chức mở trang `Đêm soát vé` → "Trả lời" → "Câu trả lời của ban tổ chức" → "Gửi trả lời" | Câu trả lời hiện công khai dưới đánh giá | |
| 11.4 · REV-03 ★ | Admin: "Đánh giá" → dòng `Đêm soát vé` → "Ẩn" → nhập lý do → "Ẩn đánh giá" | "Đã ẩn: <lý do>"; B tải lại trang: "Đánh giá này đã bị quản trị viên ẩn: <lý do>", "0 đánh giá" | |

### Phiên 12. Ban tổ chức sửa sự kiện đang bán

| Bước | Thao tác | Kết quả mong đợi | KQ |
|---|---|---|---|
| 12.1 · ORG-07 ★ | `Đêm nhạc Test` → "Thông tin": sửa mô tả, **chưa lưu** | "Có thay đổi chưa lưu." | |
| 12.2 · ORG-07 ★ | "Lưu thông tin" | "Đã lưu."; trang sự kiện công khai hiện mô tả mới | |
| 12.3 · ORG-07 | Xem các ô tên, danh mục, giờ suất diễn | Bị khóa khi sự kiện đang bán | |
| 12.4 · ORG-07 | Thẻ "Thông tin": tìm chính sách hủy | Không có ô chọn chính sách hủy; chỉ có link "Xem Điều kiện giao dịch chung (Điều 5, Điều 6)" (mở tab mới) | |
| 12.5 · BKG-08 | Thẻ "Buổi diễn & vé" → "Đóng bán" suất của sự kiện 1; khách mở trang sự kiện; rồi "Mở bán" lại | Khách thấy "Đã đóng bán", không có nút chọn chỗ; mở bán lại thì có | |
| 12.6 · ORG-11 ★ | Thẻ "Thông tin" → "Nghệ sĩ khách mời": ô 1 `Hà Anh Tuấn`; "+ Thêm nghệ sĩ": `Phương Linh`; "Lưu danh sách nghệ sĩ". Mở trang sự kiện công khai | "Đã lưu danh sách nghệ sĩ."; trang sự kiện có mục "Nghệ sĩ khách mời" với 2 tên | |
| 12.7 · SEC-02 ★ | Chép URL trang sửa sự kiện (`/organizer/events/…`), mở bằng hồ sơ **Khách A** | Không mở được (không có quyền / không tìm thấy) | |

### Phiên 13. Quản trị

| Bước | Thao tác | Kết quả mong đợi | KQ |
|---|---|---|---|
| 13.1 · ADM-06 | "Tổng quan", "Doanh thu" | Số liệu có các đơn vừa tạo | |
| 13.2 · ADM-01 ★ | "Người dùng" → tìm Khách B → "Xóa tài khoản" → "Lý do" → "Xóa tài khoản". Nhìn trình duyệt của B, bấm một trang bất kỳ | B bị đăng xuất ngay; đăng nhập lại bị từ chối ("đã bị quản trị viên xóa"); dòng của B: "Đã xóa · khôi phục được" | |
| 13.3 · ADM-01 ★ | Admin "Khôi phục" Khách B (nếu B bị khóa đăng nhập ở 1.12: "Mở khóa đăng nhập") | B đăng nhập lại được, đơn và vé vẫn còn | |
| 13.4 · ADM-02 | "Phân quyền" Khách A → đánh dấu "Soát vé" → "Lưu"; A bấm sang trang khác | Có hiệu lực ngay: phiên cũ của A bị thu hồi, A phải đăng nhập lại và thấy menu "Soát vé". Gỡ lại vai trò sau khi xem | |
| 13.5 · ADM-03 | (Nếu đã làm 1.8) "Đặt lại 2FA" Khách A | A đăng nhập lại chỉ cần mật khẩu; có email báo | |
| 13.6 · ADM-06 | "Audit log" | Có các hành động: duyệt nhà tổ chức, duyệt sự kiện, đổi cấu hình hàng chờ, xóa / khôi phục tài khoản, đổi vai trò | |
| 13.7 · ADM-08 | Tạo thêm một tài khoản khách C (chưa mua gì) → admin "Xóa vĩnh viễn" C → "Lý do" → xác nhận | Dòng của C: "Đã xóa vĩnh viễn", tên "Người dùng đã xóa"; C không đăng nhập được; email của C đăng ký lại được. Thử "Xóa vĩnh viễn" Khách A (còn vé chưa diễn): bị từ chối kèm lý do | |
| 13.8 · MON-01 | "Tình trạng hệ thống" | Dòng trạng thái chung; số request, lỗi, p95; thành phần, job nền; tự cập nhật | |

### Phiên 14. Phân quyền

| Bước | Thao tác | Kết quả mong đợi | KQ |
|---|---|---|---|
| 14.1 · SEC-01 ★ | Hồ sơ Khách A: không có menu "Quản trị"; gõ `http://localhost:8080/admin/reports` | "Bạn không có quyền xem trang này" | |
| 14.2 · SEC-03 ★ | Cửa sổ ẩn danh (chưa đăng nhập): mở `http://localhost:8080/tickets` | Chuyển tới trang đăng nhập; đăng nhập xong quay lại đúng "Vé của tôi" | |
| 14.3 · TKT-05 | Chép URL trang vé của B (`/tickets/…`), mở bằng hồ sơ A | Không xem được (không tìm thấy) | |

### Phiên 15. Giao diện

| Bước | Thao tác | Kết quả mong đợi | KQ |
|---|---|---|---|
| 15.1 · UI-01 ★ | Điện thoại (hoặc Chrome F12 → biểu tượng điện thoại, 375 px): trang chủ → sự kiện → chọn chỗ → đơn | Không trang nào cuộn ngang; sơ đồ ghế cuộn trong khung; khung "Bạn đã chọn" và nút giữ chỗ dính ở đáy | |
| 15.2 · UI-01 | Mở "Menu" rồi bấm ra ngoài / phím Esc / chuyển trang | Menu đóng | |
| 15.3 · CAT-06 | Điện thoại: trang sự kiện | Lịch diễn ngay sau thông tin chính; thanh "Chọn suất diễn" cố định ở đáy | |
| 15.4 · UI-02 | Máy tính, chỉ dùng phím Tab / Enter / Space: trang chủ, đăng nhập, chọn một ghế | Thấy rõ khung focus; đầu trang có "Bỏ qua menu"; chọn ghế được bằng phím | |
| 15.5 · UI-04 | F12 → Network → "Offline", bấm một nút cần API | "Không kết nối được máy chủ…", nút không quay mãi. Bật lại "No throttling" | |
| 15.6 · UI-03 | (Tùy chọn) Windows: Settings → Accessibility → Visual effects → tắt "Animation effects"; mở trang chủ | Không còn hiệu ứng chuyển động, nội dung hiện ngay | |

### Phiên 16. Hủy sự kiện, hoàn tiền (làm cuối cùng)

Hủy sự kiện 1 thì mọi đơn đã trả của nó được hoàn, nên làm sau tất cả các phiên khác. Mỗi khách có đơn nhận email báo hoàn tiền (email thật).

| Bước | Thao tác | Kết quả mong đợi | KQ |
|---|---|---|---|
| 16.1 · REF-06 | Ban tổ chức: `Đêm nhạc Test` → "Hủy sự kiện" → "Lý do" `Thử hủy sự kiện` → "Hủy sự kiện" | Sự kiện "Đã hủy"; trang sự kiện công khai không còn nút chọn chỗ | |
| 16.2 · REF-06 | A: "Đơn hàng" → đơn 3 vé (bước 5.9) và đơn C01 (bước 7.6) | Cả hai "Đã hoàn tiền", mục "Hoàn tiền" ghi đủ 100% số đã trả; "Vé của tôi": các vé không còn QR; A nhận email "Đã hoàn tiền đơn …" | |
| 16.3 · ORG-08 | Ban tổ chức: thẻ "Doanh thu"; admin: "Audit log" | "Hoàn tiền" bằng tổng các đơn đã trả, "Vé đã bán" về 0; audit có hủy sự kiện và hoàn tiền từng đơn | |

### Phần không làm được trên stack này

| Mã | Vì sao | Cách test |
|---|---|---|
| TC-PAY-05 → 07 (VNPay) | Cần cấu hình VNPay sandbox trong `.env` (và tunnel cho IPN) | README mục "Thử thanh toán VNPay (sandbox)"; thẻ test NCB |
| TC-AUTH-09 (admin bắt buộc 2FA) | `.env` máy dev tắt yêu cầu này | Test tự động `E2E:two-factor`; hoặc bỏ 2 dòng 2FA trong `.env` rồi `docker compose up -d` |
| TC-TKT-06 (email nhắc 24 giờ / 2 giờ) | Phải chờ tới đúng mốc trước giờ diễn | Test tự động `BE:reminders` |
| TC-LOAD-* | Cần stack đo tải riêng | `docs/testing.md` mục 4 |

---

## 4. Mẫu ghi lỗi

```
Mã lỗi: UI-<ngày>-<số>       Bước: 5.7 · TC-PAY-01
Môi trường: localhost:8080, Chrome <phiên bản>, Windows / điện thoại <tên máy>
Tài khoản: Khách A (không ghi mật khẩu)
Các bước tái hiện: 1. … 2. … 3. …
Mong đợi: …
Thực tế: …
Ảnh chụp / video: …
Mức độ: Cao (sai tiền, bán trùng, lộ dữ liệu) / Trung bình (sai chức năng) / Thấp (hiển thị)
```

## 5. Sau khi test

- Dữ liệu test (tài khoản, sự kiện, đơn) nằm trong database dev. Muốn xóa sự kiện test: ban tổ chức hoặc admin mở sự kiện → "Xóa" → gõ lại đúng tên sự kiện (TC-ORG-09). Tài khoản test thì admin "Khóa".
- Tắt xác thực hai lớp của các tài khoản test (trang tài khoản → "Tắt"), xóa các mục tương ứng trong ứng dụng xác thực.
- Không đưa ảnh chụp có email thật của người test lên nơi công khai.

## 6. Tổng hợp kết quả

| Phiên | Số bước | Đạt | Lỗi | Ghi chú |
|---|---|---|---|---|
| 1. Tài khoản | 12 | | | |
| 2. Quản trị chuẩn bị | 5 | | | |
| 3. Ban tổ chức tạo sự kiện | 16 | | | |
| 4. Tìm và xem | 6 | | | |
| 5. Mua vé | 14 | | | |
| 6. Đổi ghế, hết giờ | 6 | | | |
| 7. Hàng chờ | 9 | | | |
| 8. Danh sách chờ | 7 | | | |
| 9. Không hủy, không hoàn | 5 | | | |
| 10. Soát vé | 9 | | | |
| 11. Đánh giá | 4 | | | |
| 12. Sửa sự kiện đang bán | 7 | | | |
| 13. Quản trị | 8 | | | |
| 14. Phân quyền | 3 | | | |
| 15. Giao diện | 6 | | | |
| 16. Hủy sự kiện, hoàn tiền | 3 | | | |
| **Tổng** | **120** | | | |

Người test: ………… Ngày: ………… Phiên bản (`git log -1 --format=%h`): …………
