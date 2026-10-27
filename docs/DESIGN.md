# DESIGN.md: ETP Tickets

Hệ thống thiết kế của web app, viết theo định dạng DESIGN.md (Google Stitch, các mục như [awesome-design-md](https://github.com/VoltAgent/awesome-design-md) và [open-design](https://github.com/nexu-io/open-design)) để người và trợ lý AI làm giao diện mới ra đúng "giọng" của ETP. Nguồn sự thật là code: token ở `frontend/src/index.css` (`@theme`), thành phần ở `frontend/src/components/ui.tsx`. Đổi token thì sửa cả hai chỗ.

Lịch sử và lý do các quyết định: [`ui-redesign.md`](ui-redesign.md).

---

## 1. Không khí và tinh thần

- **Sôi động nhưng đáng tin**: sàn vé sự kiện (hòa nhạc, lễ hội), nên rực rỡ ở ảnh và điểm nhấn, còn phần mua và tiền thì rõ ràng, yên tâm.
- **Tím thương hiệu + một điểm nhấn hồng** (chỉ cho thứ cần nổi: "Nổi bật", "Sắp hết vé", giới hạn tuổi). Mảng tối **night** (hero, poster sự kiện, chân trang, đầu vé), nền **canvas** sáng hơi tím. Màu đặc, **không** gradient tím–hồng, không neon; gradient chỉ dùng để làm tối ảnh dưới chữ.
- **Hai giao diện**: sáng và tối, mặc định theo máy, người dùng chọn được (mục 2).
- **Mật độ vừa phải**: trang khách thoáng (thẻ lớn, ảnh sự kiện), trang quản trị dày hơn (bảng), cùng token.
- **Tiếng Việt đủ dấu là chữ chính**: font Be Vietnam Pro, thử mọi nhãn với dấu chồng (ặ, ỗ, ữ).

## 2. Bảng màu và vai trò

| Tên token | Hex | Dùng cho |
|---|---|---|
| `brand-700` | `#7c3aed` | Nút chính, link, trạng thái đang chọn (tương phản 5,7:1 với chữ trắng) |
| `brand-800` / `brand-900` | `#6d28d9` / `#5b21b6` | Hover / nhấn của nút chính |
| `brand-50` / `brand-100` | `#f8f5ff` / `#f1ebff` | Nền nhạt của mục đang chọn, vùng chọn chữ |
| `brand-600` | `#8b5cf6` | Viền focus (bàn phím) |
| `brand-300` | `#d0bcfd` | Chữ / icon nhấn trên mảng tối |
| `accent-500` | `#ec4899` | Điểm nhấn hồng: "Nổi bật", "Sắp hết vé", giới hạn tuổi, gạch đầu dải "Sắp hết vé" |
| `ink` | `#160f2e` | Chữ chính |
| `night` / `night-soft` | `#0f0a1f` / `#1d1535` | Mảng luôn tối: băng chuyền trang chủ, poster sự kiện, chân trang, đầu vé |
| `surface` | `#ffffff` | Nền thẻ, ô nhập, header |
| `canvas` | `#faf8ff` | Nền trang |
| `line` | `#ece8f6` | Đường kẻ, viền thẻ |
| `slate-600` / `slate-500` | Tailwind | Chữ phụ / chú thích (tối thiểu `slate-500` trên nền trắng: tương phản ≥ 4,5:1) |
| `slate-400` | Tailwind | **Chỉ** icon trang trí, placeholder, chữ trên nền tối |

Màu trạng thái (huy hiệu, thông báo): xanh lá = thành công / đang bán; hổ phách = chờ / cảnh báo; đỏ = lỗi / hủy / tạm khóa; xanh dương = thông tin; xám = nháp / đã xóa. **Không truyền nghĩa bằng màu một mình**: huy hiệu luôn có chữ.

**Giao diện tối** (`.dark` trên `<html>`, do `src/theme/theme.ts` đặt; `public/theme-init.js` đặt trước khi vẽ để không chớp trắng): **cùng tên lớp, giá trị khác**. `surface` → `#161128`, `canvas` → `#0c0818`, `ink` → chữ sáng `#f1eff8`; thang `slate` lật ngược (chữ sáng, nền tối); nền nhạt của huy hiệu / thông báo tối lại, chữ của chúng sáng lên. Mảng `night` giữ màu xám của giao diện sáng. Vì vậy: nền thẻ là `bg-surface` (không `bg-white`), mảng luôn tối là `bg-night` (không `bg-ink`); chỉ khung **mã QR** giữ nền trắng thật (máy quét cần tương phản). Nút trên header chuyển Sáng → Tối → Theo máy.

## 3. Chữ

- Font: **Be Vietnam Pro** (tự host, CSP không cho host ngoài), dự phòng `system-ui`.
- Thang chữ (Tailwind): tiêu đề trang `text-2xl` / `sm:text-3xl` đậm; hero `text-3xl` / `sm:text-5xl`; tiêu đề thẻ `text-base` đậm; thân `text-sm`–`text-base`; chú thích `text-xs`.
- Tiêu đề `tracking-tight`; thân chữ `leading-relaxed`.
- Ô nhập luôn **16px trên điện thoại** (`text-base sm:text-sm`): nhỏ hơn thì iPhone tự phóng to trang.
- Số tiền, giờ, đếm ngược: **chữ số cùng bề rộng** (`tabular-nums`, có sẵn cho `table` và `[role=timer]`). Không bao giờ cắt bớt số tiền hay ngày.

## 4. Thành phần

| Thành phần | Quy tắc |
|---|---|
| **Button** (`ui.tsx`) | `primary` (brand-700), `secondary` (trắng, viền), `danger` (đỏ, chỉ cho hành động phá hủy), `ghost`, `dark`. Cao tối thiểu 36 / 44 / 48 px (sm / md / lg); nhãn dài xuống dòng, không bị cắt. Nhấn: `scale(0.97)`. Đang chạy: spinner + giữ nhãn |
| **Link trông như nút** | Cùng màu, cùng cao với Button, thêm lớp `pressable` để có phản hồi khi nhấn |
| **Card** | Nền trắng, viền `line`, `shadow-card`, bo `radius-card` (12px), đệm 20–24px |
| **TextField / Select** | Nhãn ở trên (không chỉ placeholder), lỗi đỏ ở dưới kèm icon, gợi ý xám; cao 44px |
| **Alert** | 4 tông: error (role=alert), success, info, warning; có icon; hiện bằng fade |
| **Huy hiệu trạng thái** | Chữ tiếng Việt + màu (mục 2), bo tròn hẳn |
| **Dialog xác nhận** | Tiêu đề nói việc sẽ xảy ra; nút nguy hiểm màu đỏ; hành động không hoàn tác được phải nói rõ |
| **Menu** | Mục đang ở: nền `brand-50`, chữ `brand-800`. Link mở tab mới có icon ↗ và chữ ẩn "(mở tab mới)" |
| **Thẻ sự kiện** (`EventCard`) | Ảnh 16:9, danh mục góc trái, nhãn "Sắp hết vé" (hồng) / "Hết vé" (tối) góc phải, khối ngày, tên, thành phố, "Từ … ₫" màu thương hiệu |
| **Băng chuyền** (`HeroCarousel`) | Trang chủ, tối đa 5 sự kiện có ảnh; chuyển mờ dần 500ms; tự chuyển 6s nhưng dừng khi rê chuột / focus / tab ẩn / bấm "Tạm dừng" / giảm chuyển động; mũi tên, chấm, phím ←→ |
| **Các bước mua** (`CheckoutSteps`) | Chọn chỗ → Thanh toán → Nhận vé, trên sơ đồ ghế và trang đơn; bước đang làm có `aria-current="step"` |

## 5. Bố cục

- Khung nội dung `max-w-6xl` (trang khách), `max-w-2xl`–`3xl` (form, tài khoản, đơn), lề `px-4 sm:px-6`.
- Khoảng cách theo thang 4px của Tailwind; giữa các thẻ `space-y-4`–`6`.
- Kiểm tra ở **375, 768, 1024, 1440 px**: không trang nào cuộn ngang; menu 8 mục (admin đủ quyền) vẫn vừa từ 1024px.
- Thanh cố định ở đáy điện thoại dùng `safe-bottom` (chừa thanh home của iPhone).

## 6. Chiều sâu

- Hai mức bóng: `shadow-card` (thẻ nằm trên nền) và `shadow-raised` (đang nổi: hover, menu, thanh dính).
- Ưu tiên bóng mờ trong suốt hơn viền đậm để tạo chiều sâu; viền `line` chỉ để tách vùng.
- Header dính có bóng chỉ khi trang đã cuộn.

## 7. Chuyển động

Theo các quy tắc của [emilkowalski/skills](https://github.com/emilkowalski/skills) (`emil-design-eng`, `mobile-native`):

- **Đường cong**: `--ease-out` = `cubic-bezier(0.23, 1, 0.32, 1)` cho mọi thứ xuất hiện và khi nhấn; `--ease-drawer` = `cubic-bezier(0.32, 0.72, 0, 1)` cho bảng trượt từ mép; không bao giờ `ease-in`.
- **Thời lượng**: nhấn nút 150–160ms; chuyển trang 180ms (xảy ra mỗi lần bấm, nên gần như không thấy); dialog, thẻ 250ms; bảng trượt 300ms; chỉ màn đầu trang chủ (hiếm) được dài hơn (tiêu đề hiện từng chữ, 600ms).
- **Chỉ animate `transform` / `opacity`** (và `filter: blur` nhẹ cho tiêu đề). Không animate `width`, `height`, `margin`.
- **Không bắt đầu từ `scale(0)`**: từ `scale(0.96)` + mờ.
- **Lặp lại nhiều lần một ngày thì không trang trí** (soát vé, chọn ghế): chỉ phản hồi khi nhấn.
- **Giảm chuyển động** (`prefers-reduced-motion`): bỏ di chuyển, phóng to, vòng lặp; giữ fade ngắn để người dùng vẫn biết có gì vừa hiện.
- **Hover chỉ cho chuột**: Tailwind 4 đã gói `hover:` trong `@media (hover: hover)`, chạm trên điện thoại không bị "kẹt hover".

## 8. Điện thoại và cảm ứng

- `viewport-fit=cover` + `env(safe-area-inset-*)`; `theme-color` trắng khớp header.
- Không chớp màu khi chạm (`-webkit-tap-highlight-color: transparent`), không chờ 300ms (`touch-action: manipulation`), nhấn giữ nút không bôi chọn chữ.
- Ô nhập 16px; `type` / `inputmode` / `autocomplete` đúng từng ô (email, tel, mật khẩu, mã OTP).
- Vùng chạm tối thiểu 44px cho nút; ngoại lệ có chủ ý: ghế trên sơ đồ (32–36px, sơ đồ dày), có `aria-label` đầy đủ.
- Mọi thứ bấm được có con trỏ bàn tay; mọi thứ có focus nhìn thấy được khi dùng bàn phím.

## 9. Nên / không nên (cho người và trợ lý AI)

**Nên**
- Dùng token (`brand-700`, `ink`, `line`, `shadow-card`…), không viết hex trong component.
- Mỗi màn có đủ trạng thái: đang tải (skeleton), trống (EmptyState có hướng dẫn), lỗi (ErrorState có "Thử lại"), thành công.
- Viết chữ cho người dùng: nói việc sẽ xảy ra và việc cần làm ("Chưa xóa được tài khoản: bạn còn vé…" + link).
- Thử dữ liệu xấu nhất: tên rất dài, email không có chỗ ngắt, 0 / 1 / 1.000 mục, số tiền lớn.

**Không nên**
- Emoji làm icon (dùng bộ icon SVG trong `components/icons.tsx`).
- Gradient tím / hồng, neon, nền động nặng (shader, hạt) ở trang mua vé.
- Cắt bớt số tiền, ngày, mã đơn; truyền nghĩa chỉ bằng màu.
- Hiệu ứng cho thao tác lặp lại liên tục; hiệu ứng chặn người dùng thao tác.
- Thêm thư viện hiệu ứng cho một chi tiết nhỏ: viết bằng CSS như `components/BlurText.tsx`.

**Gợi ý câu lệnh cho trợ lý AI**: "Làm trang X cho ETP Tickets theo `docs/DESIGN.md`: dùng `Card`, `Button`, `TextField`, `Alert` trong `components/ui.tsx`, token trong `index.css`, đủ trạng thái tải / trống / lỗi, kiểm tra ở 375px và 1024px."

## 10. Nguồn tham khảo

Đánh giá ngày 27/10/2026. Nguyên tắc: **không thêm thư viện runtime**; chỉ lấy quy tắc và cách làm, viết lại bằng token và thành phần của dự án.

| Nguồn | Giấy phép | Dùng thế nào |
|---|---|---|
| [emilkowalski/skills](https://github.com/emilkowalski/skills) | MIT | 4 skill chép tay vào `.claude/skills/` (chỉ là markdown): `emil-design-eng`, `review-animations`, `mobile-native`, `break-ui`; giấy phép ở `.claude/skills/LICENSE-emilkowalski-skills.md`. Quy tắc chuyển động (mục 7) và điện thoại (mục 8) lấy từ đây |
| [ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) | MIT | Chỉ tham khảo checklist UX (tương phản, focus, giảm chuyển động, các bề ngang cần thử). **Không** dùng gợi ý font của nó: Google Fonts trái CSP `font-src 'self'` |
| [awesome-design-md](https://github.com/VoltAgent/awesome-design-md) | MIT | Định dạng 9 mục của file này. **Không** chép DESIGN.md của thương hiệu khác |
| [open-design](https://github.com/nexu-io/open-design) | Apache-2.0 | Không dùng: là ứng dụng thiết kế riêng (Next.js, Electron), không nhúng được vào web này |
| [React Bits](https://github.com/DavidHDev/react-bits) | MIT + Commons Clause | **Không chép mã** (Commons Clause cấm phân phối lại chính các component; repo này công khai), không thêm `motion`. Chỉ học ý tưởng, tự viết bằng CSS: `components/BlurText.tsx` |

Mọi thứ thêm vào phải chạy được với CSP production (`frontend/docker/security-headers.conf`): không script inline, không thẻ `<style>` chèn lúc chạy, không font / CDN bên ngoài. Vite dev không áp CSP: thử trên bản Docker.
