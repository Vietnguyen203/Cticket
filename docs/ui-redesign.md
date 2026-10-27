# Làm mới giao diện web (UI/UX)

> Trạng thái: **đã làm** (20/10/2026). Nhánh `feature/ui-redesign`. Chỉ sửa web (`frontend/`), không sửa backend, database, đăng nhập, thanh toán hay logic giữ chỗ.
>
> **Tài liệu lịch sử.** Từ 27/10/2026, giao diện đổi sang tông **tím #7c3aed + nhấn hồng #ec4899** và có **giao diện tối**; bảng màu teal, `ink` làm nền tối và quầng sáng teal mô tả bên dưới **không còn đúng**. Nguồn sự thật hiện tại là [`DESIGN.md`](DESIGN.md) (token, thành phần, chuyển động, giao diện tối) và `frontend/src/index.css`. Phần audit, thứ tự làm và cách kiểm tra bên dưới vẫn giữ để biết lý do các quyết định.

## 1. Audit (20/10/2026)

**Hiện trạng kỹ thuật**
- React 19, React Router 8, TypeScript, Vite 8, **Tailwind CSS 4** (`@theme` trong `src/index.css`), axios. Không có thư viện UI hay icon.
- Thành phần dùng chung: `components/ui.tsx` (Button, TextField, Alert, Card, Spinner, FormPage), `Layout.tsx`, `EventCard`, `EventImage`; các trang quản trị dùng `admin/components.tsx`.
- Kiểm tra có sẵn: `npm run lint` (oxlint), `npm run typecheck`, `npm test` (Vitest, 73 test), `npm run build`; E2E Playwright ở `e2e/` (20 kịch bản, chọn phần tử theo nhãn / vai trò, nên **giữ nguyên chữ trên nút và nhãn** mà các kịch bản dùng).
- CSP của nginx chỉ cho font và style từ chính website: không dùng được Google Fonts.

**Vấn đề**

| Mức | Vấn đề | Ở đâu |
|---|---|---|
| **Cao** | Điện thoại: nút mua ("Chọn chỗ") nằm **dưới cả phần đánh giá** ở trang chi tiết, phải cuộn rất xa mới mua được | `EventDetailPage` |
| **Cao** | Không có hệ thống thiết kế: màu, bo góc, bóng, khoảng cách viết tay từng chỗ (`rounded-lg / xl / 2xl / 3xl`, `shadow-sm / md`), font hệ thống mặc định | toàn web |
| Trung bình | Biểu tượng là ký tự / emoji (`☰ ✕ ★`), không đồng bộ, không có biểu tượng ngày / địa điểm / vé | `Layout`, `EventCard`, trang chi tiết |
| Trung bình | Khối giới thiệu trang chủ là một mảng gradient chung chung, không giới thiệu sự kiện nào | `HomePage` |
| Trung bình | Thẻ sự kiện thiếu nhịp: ngày, tên, nơi diễn trộn lẫn; không thấy địa điểm cụ thể; ảnh phóng to khi rê chuột làm rung bố cục | `EventCard` |
| Trung bình | Trang danh sách: ô lọc dạng form thô (select mặc định), không có số kết quả, không có nút bỏ lọc, trạng thái rỗng sơ sài | `EventsPage` |
| Trung bình | Ô mật khẩu không có nút hiện / ẩn; không có vòng focus rõ ở nhiều nút / link tự làm | trang đăng nhập / đăng ký, `Layout` |
| Thấp | Thanh menu điện thoại mở bằng ký tự `☰`, không có lớp phủ, không đóng khi bấm ra ngoài | `Layout` |
| Thấp | Chân trang chỉ một dòng chữ nhỏ | `Layout` |
| Thấp | Ảnh thay thế (không có ảnh) dùng 5 gradient nhiều màu khác nhau | `utils/placeholder.ts` |

**Không phải vấn đề giao diện, ghi lại làm đề xuất:** danh sách sự kiện không có **giá "từ … đ"** vì API danh sách không trả về giá (cần thêm vào backend; ngoài phạm vi lần này).

## 2. Hướng thiết kế

- **Nền sáng, sạch, một màu nhấn**: giữ màu thương hiệu **teal** (đã dùng trên vé PDF, email, favicon) nhưng làm đậm và chuẩn hóa thành thang 50–950. Đi kèm màu **mực đậm** (`ink`, gần đen xanh) cho chữ, thanh tiêu đề trang chủ và chân trang, tạo cảm giác cao cấp mà không cần gradient.
- **Font Be Vietnam Pro** (tự phục vụ qua `@fontsource/be-vietnam-pro`, phù hợp CSP), cùng font với vé PDF; dấu tiếng Việt chuẩn.
- **Ảnh sự kiện là trung tâm**: thẻ ảnh 16:9 cố định, trang chi tiết có ảnh bìa lớn với thông tin chính đè lên phần dưới ảnh.
- **Ít bo góc hơn, đồng bộ**: 3 mức (nhỏ 8px cho ô nhập / nút, vừa 12px cho thẻ, lớn 16px cho khối lớn). Một kiểu bóng cho thẻ, một kiểu cho lớp nổi.
- **Biểu tượng SVG** tự vẽ trong một file (`components/icons.tsx`, nét 1.75px, 24×24), không thêm thư viện.
- **Chuyển động nhẹ**: 150–200 ms cho hover / focus; không phóng to ảnh, không hiệu ứng thừa; tôn trọng `prefers-reduced-motion`.

## 3. Design tokens (`src/index.css`, `@theme`)

| Nhóm | Token |
|---|---|
| Màu thương hiệu | `brand-50 … brand-950` (teal), chính: `brand-700` |
| Mực / chữ | `ink` (#0b1b24) cho chữ đậm và khối tối; chữ phụ `slate-600`, chữ mờ `slate-500` |
| Nền | trang `canvas` (#f6f8f9), bề mặt trắng, viền `line` (#e3e8ec) |
| Trạng thái | thành công emerald, cảnh báo amber, lỗi red, thông tin sky (chỉ dùng cho thông báo / huy hiệu) |
| Chữ | Be Vietnam Pro; thang `xs 12 / sm 14 / base 16 / lg 18 / xl 20 / 2xl 24 / 3xl 30 / 4xl 36 / 5xl 48`; đậm 400 / 500 / 600 / 700 |
| Bo góc | `radius-control` 8px, `radius-card` 12px, `radius-panel` 16px |
| Bóng | `shadow-card` (rất nhẹ), `shadow-raised` (menu, thanh dưới) |
| Khung | nội dung tối đa 1200px, lề 16px (điện thoại) / 24px |
| Điểm ngắt | mặc định Tailwind: sm 640, md 768, lg 1024, xl 1280 |
| Focus | vòng `brand-600` 2px, lệch 2px, chỉ khi dùng bàn phím (`focus-visible`) |

## 4. Thành phần dùng chung

- `ui.tsx` làm lại (giữ tên và props cũ để không vỡ trang quản trị): `Button` (thêm cỡ, biến thể `outline`), `TextField` (thêm biểu tượng đầu), **`PasswordField`** (hiện / ẩn), `Select`, `Alert` (có biểu tượng), `Card`, `Badge`, `Skeleton`, `EmptyState`, `ErrorState`, `PageHeader`.
- `icons.tsx`: search, calendar, clock, map-pin, ticket, user, menu, close, star, chevron, arrow-right, check, alert, info, eye / eye-off, filter, x-circle.
- `EventCard` mới, `SearchBar`, `CategoryChips`, `Layout` (thanh tiêu đề, menu tài khoản, ngăn kéo điện thoại, chân trang).
- **Không thêm** hệ thống toast: web dùng thông báo ngay tại chỗ (`Alert`), đủ rõ và đã được test E2E.

## 5. Thứ tự làm

1. Design tokens, font, biểu tượng, thành phần dùng chung, `Layout`.
2. Trang chủ.
3. Danh sách / tìm kiếm sự kiện.
4. Chi tiết sự kiện (thanh mua cố định trên điện thoại).
5. Chọn chỗ (sơ đồ ghế / vé đứng): chỉ giao diện, giữ nguyên logic giữ chỗ.
6. Đơn hàng, thanh toán, kết quả VNPay: chỉ giao diện, trạng thái lấy từ API như cũ.
7. Vé của tôi, đơn hàng của tôi, vé chi tiết.
8. Đăng nhập, đăng ký, quên mật khẩu, tài khoản.
9. Các trang khác dùng thành phần chung nên tự đẹp hơn; không sửa riêng trang quản trị lần này.

## 6. Kiểm tra

`npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, E2E Playwright (20 kịch bản), xem tay ở 375px / 768px / 1280px trong trình duyệt.

## 7. Kết quả

**Đã làm**
- Design tokens trong `src/index.css`; font Be Vietnam Pro tự phục vụ (`@fontsource/be-vietnam-pro`, dependency mới duy nhất); vòng focus thống nhất; tôn trọng `prefers-reduced-motion`; ô tích chọn theo màu thương hiệu.
- Thành phần: `ui.tsx` (thêm `PasswordField`, `SelectField`, `Badge`, `EmptyState`, `ErrorState`, `Skeleton`, `PageHeader`, cỡ nút, `Alert` có biểu tượng; giữ tên / props cũ), `icons.tsx` (24 biểu tượng SVG), `SearchBar`, `CategoryChips`, `DateBlock`, `EventCard`, `EventImage` (một kiểu ảnh thay thế), `Layout` (thanh tiêu đề, menu điện thoại đóng khi đổi trang / bấm ngoài / Esc, link "Bỏ qua menu", chân trang).
- Trang: trang chủ (khối giới thiệu tối với ô tìm kiếm và **sự kiện nổi bật**), danh sách (bộ lọc gọn, dải danh mục, số kết quả, "Xóa bộ lọc", trạng thái rỗng), **chi tiết sự kiện** (thông tin chính, **giá từ** tính từ giá thật của suất đang bán, lịch diễn đứng ngay sau thông tin trên điện thoại, **thanh mua cố định** ở đáy điện thoại), chọn chỗ (dải sân khấu, ghế to hơn, **khung tóm tắt dính đáy** trên điện thoại, sửa tràn ngang), đơn hàng (2 cột, khung hành động dính), kết quả VNPay, vé của tôi, đơn hàng của tôi, **vé dạng cuống vé**, mật khẩu hiện / ẩn ở đăng nhập, đăng ký, quên mật khẩu, 2FA.
- Trạng thái thanh toán vẫn chỉ lấy từ API (đơn, lượt thanh toán), không đổi logic giữ chỗ / thanh toán.

**E2E**: 3 bộ chọn cập nhật vì chữ hiển thị đổi có chủ đích: `'← Vé của tôi'` (mũi tên chữ → biểu tượng), `'★ Đánh giá sự kiện'` (ngôi sao chữ → biểu tượng), link "Vé của tôi" trong thanh tiêu đề (chân trang cũng có link này).

**Còn lại**
- Phần đánh giá (`EventReviews`, `Stars`) và các trang ban tổ chức / quản trị / soát vé chỉ hưởng thành phần chung, chưa làm riêng.
- Danh sách sự kiện chưa có "giá từ" (API danh sách không trả giá: cần thêm ở backend).
- Bundle JS 672 kB (trước 640 kB); cảnh báo "> 500 kB" đã có từ trước: nên tách trang quản trị / quét vé thành chunk riêng (`import()`).

## 8. Chuyển động (nhánh `feature/ui-motion`)

Nguyên tắc: ngắn (150–600 ms), có mục đích (thứ tự xuất hiện, phản hồi khi bấm, trạng thái đang chạy), không vòng lặp gây rối mắt; **tắt hết khi hệ điều hành bật "giảm chuyển động"** (`prefers-reduced-motion`). Không thêm thư viện: keyframes trong `@theme` của `index.css`, `components/Reveal.tsx` (IntersectionObserver), `utils/motion.ts`.

| Ở đâu | Hiệu ứng |
|---|---|
| Mọi trang | trang mới hiện dần (0,35 s); thanh tiêu đề có bóng khi cuộn; menu điện thoại trượt xuống, lớp phủ mờ dần |
| Nút, chip | nhấn co nhẹ (98%); nút chính nhích lên khi rê chuột |
| Thông báo, trạng thái rỗng | hiện dần / trồi lên |
| Khung chờ tải | vệt sáng quét ngang thay cho nhấp nháy |
| Trang chủ | quầng sáng teal trôi rất chậm sau khối giới thiệu; tiêu đề, mô tả, ô tìm kiếm trồi lên lần lượt; sự kiện nổi bật phóng nhẹ vào |
| Thẻ sự kiện | trồi lên lần lượt khi cuộn tới; rê chuột: thẻ nhích lên, ảnh phóng 4% |
| Chi tiết sự kiện | ảnh phóng nhẹ vào, thông tin trồi lên; thanh mua trên điện thoại trượt từ đáy lên; mũi tên "Chọn chỗ" nhích khi rê |
| Chọn chỗ | ghế vừa chọn "nảy" một lần; chấm xanh "Cập nhật trực tiếp" tỏa sóng; ghế trống nhích lên khi rê |
| Đơn hàng | phút cuối của đồng hồ giữ chỗ nhấp nháy nhẹ |
| Vé | vé phóng nhẹ vào, mã QR hiện dần |
| Hàng chờ mua vé | vệt sáng chạy trên thanh tiến độ |

Bundle JS +3 kB. Lint, typecheck, 75 test web, build, 20 E2E đạt.

## 9. Căn chỉnh ảnh sự kiện trước khi tải lên

Vấn đề: ảnh tải lên có tỉ lệ bất kỳ, giao diện hiển thị theo khung 16:9 và cắt giữa, nên ảnh vuông kiểu logo bị mất chữ ("X-OR" thành "-O").

- Chọn ảnh từ máy (JPEG / PNG / WebP, tới 20 MB) → hộp **"Căn chỉnh ảnh"** (`components/ImageCropDialog.tsx`, thẻ `<dialog>`: bẫy focus, Esc để hủy): khung đúng 16:9, **kéo** (chuột / chạm / phím mũi tên), **thu phóng** (thanh trượt, phím + / −), nút **"Lấp đầy khung"** và **"Hiện trọn ảnh"**; phần trống lấp bằng **nền mờ từ chính ảnh**, trắng hoặc tối; lưới 1/3 để căn; **xem trước thẻ sự kiện** với tên thật.
- "Dùng ảnh này": canvas vẽ đúng khung đang thấy ở **1600 × 900, JPEG** (nhỏ hơn 5 MB) rồi mới tải lên: API và cách lưu không đổi.
- Ảnh đã tải lên trước (đường dẫn `/api/v1/uploads/…`) có nút **"Căn chỉnh lại"**.
- Hình học thuần ở `utils/imageCrop.ts` (6 test): khung chỉ hở khi chọn hiện trọn ảnh, kéo dừng ở mép, thu phóng giữ nguyên điểm giữa.
- Nhãn ô ảnh đổi thành "khung 16:9" (trước ghi 1920×640, không còn đúng với giao diện mới).
- Đã thử trên stack E2E bằng kịch bản tạm (ảnh vuông → "Hiện trọn ảnh" → ảnh lưu đúng 1600 × 900; hộp vừa màn hình điện thoại).
