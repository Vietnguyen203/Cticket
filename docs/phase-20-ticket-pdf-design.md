# Phase 20: Vé PDF trong email

Hiện nay email xác nhận chỉ ghi mã vé ("TKT-… — Hạng S"). Muốn có mã QR, khách phải mở mục **Vé của tôi** trong app. Phase này thêm **vé PDF có mã QR**: đính kèm trong email và tải được trên web, để khách có vé ngay trong hộp thư, in ra được, hoặc mở khi điện thoại mất mạng ở cổng.

## 1. Mục tiêu

| Ai | Thấy gì |
|---|---|
| **Khách** | Email "Xác nhận đơn …" có file đính kèm **`Ve-ETP-…pdf`**: mỗi vé một trang, có mã QR lớn. |
| **Khách (web)** | Nút **"Tải vé PDF"** ở trang đơn hàng (cả đơn) và trang một vé (vé đó). |
| **Nhân viên soát vé** | Quét QR trên giấy hoặc trên file PDF như quét trong app (cùng mã QR, không đổi gì ở phía soát vé). |

## 2. Một trang vé có gì

Khổ **A5 đứng** (in vừa nửa tờ A4, xem tốt trên điện thoại):

- tên nền tảng (dải màu ở đầu trang);
- **tên sự kiện**, **giờ diễn** (giờ Việt Nam), **địa điểm và địa chỉ**;
- **ghế** (ví dụ "Khu A - A01") hoặc **hạng vé đứng #số thứ tự**, tên hạng vé;
- **mã QR lớn** (khoảng 6 cm) và mã vé (TKT-…) in bên dưới;
- mã đơn, tên người mua;
- dòng nhắc:
  - "Cổng mở từ HH:mm";
  - "Mỗi vé vào cổng một lần";
  - "Không chia sẻ ảnh mã QR".

## 3. Quy tắc

- **Tạo khi cần, không lưu file.**
  - Mã QR có phiên bản (Phase 10): admin "Cấp lại QR" thì mã cũ hết hiệu lực. File lưu sẵn sẽ chứa mã cũ.
  - Mỗi lần gửi email hay tải về, server tạo PDF mới từ dữ liệu hiện tại (vài chục ms cho 8 vé).
- **Chỉ vé còn hiệu lực** (`VALID`) mới có trong PDF. Đơn đã hoàn tiền hoặc vé đã hủy: không có nút tải, API trả 409.
- **Chỉ chủ vé** tải được (người khác nhận 404, như API vé hiện có).
- **Vé được cấp lại QR**: email báo cấp lại QR (nếu có) đính kèm PDF mới. Hiện việc cấp lại chưa gửi email, nên phase này **thêm email "Mã QR mới của vé …"** có đính kèm PDF.
- **Email**:
  - PDF gắn vào email xác nhận, gửi sau khi vé được phát (job `order-confirmed` hiện có).
  - Tạo PDF lỗi (rất hiếm) thì **vẫn gửi email không đính kèm** và ghi log, vì không để khách mất email xác nhận vì lỗi PDF.
- Font **có dấu tiếng Việt**: nhúng font **Be Vietnam Pro** (giấy phép SIL OFL, dùng tự do) vào PDF. Font mặc định của thư viện PDF không có dấu tiếng Việt.

## 4. Kỹ thuật

- Thư viện: **PDFKit**.
  - Thuần JavaScript, nhẹ, không cần trình duyệt.
  - Cách khác là Puppeteer (in HTML ra PDF qua Chromium) đẹp hơn với HTML, nhưng image nặng hơn khoảng 300 MB và tốn RAM. Không đáng với một trang vé.
- Mã QR: thư viện `qrcode` có sẵn (đang dùng cho 2FA), xuất ảnh PNG đưa vào PDF.
- Module `tickets` thêm `ticket-pdf.js` dùng chung cho email và API.
- File font đặt ở `backend/assets/fonts/` (khoảng 300 KB, hai kiểu Regular và Bold), có trong image Docker.

## 5. API

| Endpoint | Ai | Trả về |
|---|---|---|
| `GET /orders/:id/tickets.pdf` | chủ đơn | PDF mọi vé còn hiệu lực của đơn (`Content-Disposition: attachment; filename="Ve-ETP-….pdf"`) |
| `GET /tickets/:id/ticket.pdf` | chủ vé | PDF một vé |

## 6. Web

- Trang đơn (đơn đã thanh toán, có vé): nút **"Tải vé PDF"** cạnh danh sách vé.
- Trang một vé: nút **"Tải vé PDF"** dưới mã QR.
- Tải bằng request có đăng nhập (không mở link trực tiếp được, vì cần token), rồi lưu file.

## 7. Kiểm thử

- **Unit**:
  - PDF hợp lệ (`%PDF-`), số trang bằng số vé;
  - có chữ tiếng Việt có dấu (tạo PDF không nén để tìm chữ trong file);
  - ảnh QR trong PDF chứa đúng mã của vé.
- **Tích hợp**:
  - email xác nhận có đính kèm `Ve-ETP-….pdf`, đúng số trang;
  - tải PDF của đơn / của vé: chủ được, người khác 404;
  - đơn đã hoàn → 409;
  - cấp lại QR → email có PDF mới, mã QR mới trong PDF khác mã cũ;
  - lỗi tạo PDF → email vẫn được gửi, không đính kèm.
- **E2E**: khách bấm "Tải vé PDF" ở trang đơn → nhận được file PDF.
- Đo nhanh thời gian tạo PDF 8 vé.

## 8. Ước lượng

| Việc | Giờ |
|---|---|
| Tạo PDF (bố cục, font, QR), test unit | 3 |
| Đính kèm email xác nhận, email cấp lại QR | 2 |
| API tải PDF, quyền | 1 |
| Web (2 nút tải) | 1 |
| Test tích hợp, E2E, tài liệu | 2 |
| **Tổng** | **≈ 9 giờ** |

## 9. Cần quyết định khi review

1. **PDFKit** (nhẹ, thuần JavaScript) thay vì Puppeteer / Chromium. Đồng ý?
2. **Khổ A5 đứng**, mỗi vé một trang. Hay muốn khổ A4 hoặc dạng vé ngang?
3. Font **Be Vietnam Pro** (OFL). Hay muốn font khác (ví dụ Noto Sans)?
4. **Không lưu file**, tạo lại mỗi lần gửi hoặc tải (luôn đúng mã QR mới nhất). Đồng ý?
5. **Thêm email khi admin cấp lại QR** (kèm PDF mới). Đồng ý?
6. **Không làm**: Apple Wallet / Google Wallet, vé có ảnh bìa sự kiện, gửi lại email vé theo yêu cầu (khách tải ở web). Đồng ý?

## 10. Ghi chú triển khai

Đã duyệt cả 6 điểm ở mục 9. Khác thiết kế ban đầu:

- **Mã QR vẽ bằng hình vuông vector** (`QRCode.create(...).modules`), không chèn ảnh PNG. Lý do: in ra sắc nét ở mọi cỡ, và mã hóa 8 ảnh PNG chiếm khoảng một nửa thời gian tạo PDF. Đo trên máy dev: **PDF 8 vé ≈ 32 ms, 52 KB** (trước đó ≈ 250 ms).
- Font được đọc từ đĩa một lần rồi giữ trong bộ nhớ (`assets/fonts`, được `COPY` vào image Docker).
- Test unit không đọc chữ trong PDF (PDFKit lưu chữ dưới dạng mã glyph của font nhúng): nội dung mỗi trang được tách thành hàm thuần `pageContent(row)` và kiểm tra ở đó; PDF thì kiểm tra phần đầu `%PDF-`, số trang và font được nhúng.

File chính:

| File | Nội dung |
|---|---|
| `backend/src/modules/tickets/ticket-pdf.js` | `renderTicketsPdf`, `pageContent` |
| `backend/src/modules/tickets/tickets.service.js` | `orderPdfOfMine`, `ticketPdfOfMine`, `pdfAttachment` (lỗi → `null`, email vẫn gửi), `sendQrReissuedEmail` |
| `backend/src/modules/tickets/tickets.routes.js` | `GET /tickets/:id/ticket.pdf`, `GET /orders/:id/tickets.pdf` |
| `backend/src/queue/processors.js` | đính kèm PDF vào email xác nhận; job email `ticket-qr-reissued` |
| `frontend/src/api/tickets.ts`, `OrderPage.tsx`, `TicketPage.tsx` | nút "Tải vé PDF" |
| `backend/tests/unit/ticket-pdf.test.js`, `backend/tests/integration/ticket-pdf.test.js`, `e2e/tests/ticket-pdf.spec.ts` | test |
