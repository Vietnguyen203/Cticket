# Phase 19: Đánh giá sự kiện

Bảng `reviews` có từ Phase 1 (1–5 sao, một đánh giá cho mỗi người và mỗi sự kiện, gắn với đơn của chính người đó) và quyền `review:create` đã cấp cho khách hàng, nhưng chưa có API hay trang nào dùng. Phase này làm cho xong.

## 1. Mục tiêu

| Ai | Thấy gì |
|---|---|
| **Khách đã đi xem** | Sau khi vé được soát ở cổng: chấm 1–5 sao, viết nhận xét. Sửa hoặc xóa đánh giá của mình. Một ngày sau buổi diễn nhận email "Bạn thấy buổi diễn thế nào?". |
| **Mọi người xem trang sự kiện** | Điểm trung bình, số đánh giá, biểu đồ 5 → 1 sao, danh sách đánh giá (mới nhất / điểm cao / điểm thấp), nhãn "Đã đi xem". Thẻ sự kiện ở trang danh sách có ★ trung bình. |
| **Ban tổ chức** | Xem đánh giá các sự kiện của mình, **trả lời công khai** mỗi đánh giá một lần (sửa được). |
| **Admin** | Trang **Đánh giá**: lọc theo sự kiện / số sao / trạng thái; **ẩn** đánh giá vi phạm (bắt buộc lý do, ghi audit), hiện lại khi cần. |

## 2. Ai được đánh giá

- Có **đơn đã thanh toán** (PAID hoặc COMPLETED) của sự kiện đó, **và ít nhất một vé của đơn đã được soát ở cổng** (`USED`). Đúng với quyền `review:create` ("Review attended events"): chỉ người thật sự đến xem.
- Sự kiện không bị hủy.
- Hạn viết / sửa: tới **60 ngày** sau khi suất diễn kết thúc. Sau đó đánh giá vẫn hiện, chỉ không sửa được (xóa vẫn được).
- Mỗi người **một đánh giá cho mỗi sự kiện** (ràng buộc `UNIQUE (user_id, event_id)` có sẵn). Đi xem nhiều suất của cùng sự kiện vẫn chỉ một đánh giá.
- Đơn sau đó bị hoàn tiền: đánh giá vẫn giữ, vì người đó đã đến xem thật.

## 3. Nội dung và kiểm duyệt

- **Số sao** 1–5 (bắt buộc). **Nhận xét** không bắt buộc, tối đa 2.000 ký tự, chỉ chữ thường (web hiển thị dạng văn bản, không HTML).
- **Đăng ngay** (`PUBLISHED`), kiểm duyệt sau: không bắt khách chờ admin duyệt, vì người viết đã được xác minh là người đi xem.
- Admin **ẩn** (`HIDDEN`) kèm lý do. Đánh giá ẩn:
  - không tính vào điểm trung bình;
  - người viết vẫn thấy, kèm dòng "Đã bị ẩn: <lý do>";
  - không sửa được (tránh sửa để lách).

  Admin hiện lại được. Mỗi lần ẩn / hiện ghi audit.
- Lọc nhẹ khi gửi: chặn nhận xét chứa link (`http`, `www.`) để tránh spam quảng cáo; rate limit 10 lần gửi / giờ / người.
- Trạng thái `PENDING` và `REJECTED` có sẵn trong enum nhưng không dùng (giữ nguyên enum, không đổi kiểu).

## 4. Ban tổ chức trả lời

- Mỗi đánh giá **một câu trả lời** công khai (tối đa 1.000 ký tự), sửa hoặc xóa được. Hiện ngay dưới đánh giá, kèm tên ban tổ chức.
- Chỉ ban tổ chức **của sự kiện đó** (hoặc admin). Không trả lời được đánh giá đang bị ẩn.
- Người viết nhận thông báo trong app: "Ban tổ chức đã trả lời đánh giá của bạn".

## 5. Điểm trung bình

- Lưu **tổng điểm và số đánh giá** (chỉ các đánh giá `PUBLISHED`) ngay trên bảng `events`: `rating_count`, `rating_sum`. Cập nhật **trong cùng transaction** với việc viết / sửa / xóa / ẩn / hiện, có khóa dòng sự kiện trước (đúng thứ tự khóa hiện có: events trước).
- Lý do không tính lại mỗi lần đọc: trang danh sách sự kiện cần ★ cho 20 thẻ một lúc và được cache. Cột có sẵn thì chỉ cần đọc, không phải gom nhóm.
- Trang danh sách được cache (Redis) nên ★ ở thẻ có thể chậm vài phút; trang chi tiết đọc số mới nhất.
- Job bảo trì hằng đêm **đối chiếu** hai cột này với bảng `reviews` và sửa nếu lệch, giống job kiểm tra tồn kho.

## 6. Email mời đánh giá

- Một email **khoảng 24 giờ sau khi suất diễn kết thúc** cho người có vé đã soát, chưa đánh giá sự kiện đó, và không tắt "Nhắc lịch" (dùng chung công tắc của Phase 18.2).
- Dùng lại cơ chế của nhắc lịch: bảng `order_reminders` thêm loại `REVIEW`, nên mỗi đơn chỉ nhận một lần.

## 7. Dữ liệu (migration)

- `reviews` thêm:
  - `organizer_reply`, `organizer_replied_at`;
  - `hidden_reason`, `moderated_by`, `moderated_at`;
  - chỉ mục `(event_id, created_at)` cho danh sách đánh giá `PUBLISHED`.
- `events` thêm `rating_count int NOT NULL DEFAULT 0`, `rating_sum int NOT NULL DEFAULT 0`, kèm ràng buộc không âm.
- `order_reminders.kind` cho phép thêm `REVIEW`.

## 8. API

| Ai | Endpoint |
|---|---|
| Ai cũng được | `GET /events/:idOrSlug/reviews?sort=newest\|highest\|lowest&rating=&page=`: tóm tắt (trung bình, số lượng, phân bố 5 → 1) và một trang đánh giá |
| Khách | `GET /events/:id/reviews/mine`: đánh giá của tôi, cùng việc tôi có được viết không (`canReview`, `reason`) |
| Khách | `PUT /events/:id/reviews/mine` (viết hoặc sửa: idempotent), `DELETE /events/:id/reviews/mine` |
| Ban tổ chức / admin | `PUT /reviews/:id/reply`, `DELETE /reviews/:id/reply` |
| Admin | `GET /admin/reviews` (lọc), `POST /admin/reviews/:id/hide` `{ reason }`, `POST /admin/reviews/:id/unhide` |

Danh sách sự kiện và chi tiết sự kiện có thêm `rating: { average, count }`.

## 9. Web

| Trang | Thay đổi |
|---|---|
| Trang sự kiện | Khối **Đánh giá**: ★ trung bình, số đánh giá, thanh 5 → 1 sao, sắp xếp / lọc theo sao, danh sách có phân trang, nhãn "Đã đi xem", câu trả lời của ban tổ chức. Người được viết thì thấy form chọn sao và nhận xét; đã viết thì thấy đánh giá của mình với nút Sửa / Xóa. |
| Thẻ sự kiện (danh sách) | ★ 4,6 (128) khi có đánh giá |
| Vé của tôi | Vé đã vào cổng có nút "Đánh giá sự kiện" |
| Ban tổ chức | Tab **Đánh giá** trong trang sự kiện: danh sách, nút trả lời |
| Admin | Trang mới **Đánh giá**: bảng lọc, nút Ẩn (hỏi lý do) / Hiện lại |

## 10. Kiểm thử

- **Quyền viết**: chưa vào cổng → từ chối; đã vào cổng → viết được; quá 60 ngày → không sửa được; sự kiện bị hủy; người khác không sửa / xóa được.
- **Điểm**:
  - viết / sửa sao / xóa / ẩn / hiện → `rating_count` và `rating_sum` luôn đúng;
  - **20 người đánh giá cùng lúc** → tổng đúng;
  - job đối chiếu sửa được số bị lệch.
- **Danh sách**:
  - sắp xếp, lọc theo sao, phân trang;
  - đánh giá ẩn không hiện với người khác nhưng người viết vẫn thấy.
- **Trả lời**: đúng ban tổ chức, sai ban tổ chức (404), đánh giá đang ẩn; thông báo cho người viết.
- **Chặn**: link trong nhận xét, rate limit.
- **Email mời đánh giá**: đúng thời điểm, đúng người, không gửi trùng, người đã đánh giá không nhận.
- **E2E**: khách đã vào cổng viết đánh giá → hiện trên trang sự kiện kèm ★ → ban tổ chức trả lời → admin ẩn → điểm trung bình đổi.

## 11. Ước lượng

| Việc | Giờ |
|---|---|
| Migration, API viết / sửa / xóa, quyền, cập nhật điểm | 4 |
| Danh sách, tóm tắt, ★ trên danh sách sự kiện, job đối chiếu | 3 |
| Trả lời của ban tổ chức, ẩn / hiện của admin, thông báo | 3 |
| Email mời đánh giá | 1 |
| Web (trang sự kiện, vé, ban tổ chức, admin) | 5 |
| Test, E2E, tài liệu, Postman | 3 |
| **Tổng** | **≈ 19 giờ** |

## 12. Cần quyết định khi review

1. **Chỉ người đã vào cổng** (vé `USED`) mới được đánh giá. Cách khác: mọi người có đơn đã thanh toán, sau khi suất diễn bắt đầu. Đồng ý chỉ người đã vào cổng?
2. **Đăng ngay, admin ẩn sau** (không duyệt trước). Đồng ý?
3. **Ban tổ chức được trả lời công khai** mỗi đánh giá một lần. Đồng ý?
4. **Viết / sửa trong 60 ngày** sau buổi diễn. Đồng ý, hay muốn mốc khác?
5. **Email mời đánh giá** 24 giờ sau buổi diễn, dùng chung công tắc "Nhắc lịch". Đồng ý?
6. **Không làm**: ảnh trong đánh giá, nút "hữu ích", khách báo cáo đánh giá xấu (admin tự xem danh sách), đánh giá theo từng suất diễn. Đồng ý?

## 13. Ghi chú triển khai

Đã duyệt cả 6 điểm như đề xuất.

- **Backend**: module `reviews` (repository, service, routes, schemas).
  - Mọi thao tác thay đổi đánh giá (viết, sửa, xóa, ẩn, hiện) đều **khóa dòng sự kiện trước** rồi mới cộng / trừ `rating_count` và `rating_sum`.
  - Một đánh giá chỉ được tính vào điểm khi đang ở trạng thái `PUBLISHED`. Mỗi lần đổi, phần tính lại là hiệu "trước / sau", nên sửa số sao, ẩn hay hiện đều đúng.
- **Quyền**:
  - `review:create` (khách) để viết;
  - quyền mới `review:manage` (chỉ ADMIN, thêm bằng migration) để ẩn / hiện;
  - trả lời: ban tổ chức sở hữu sự kiện hoặc người quản lý mọi sự kiện. Người khác nhận 404, như mọi tài nguyên "của riêng".
- **Job đối chiếu điểm**: tìm sự kiện có số lệch (đọc không khóa), rồi với từng sự kiện **khóa dòng sự kiện trước** rồi mới đếm lại.
  - Bản đầu viết một câu `UPDATE … FROM (đếm lại)` cho tất cả sự kiện. Câu đó có thể ghi đè một đánh giá vừa được viết bằng số cũ.
  - Đã sửa trước khi chạy test.
- **Email mời đánh giá**: chạy chung job `send-reminders`, loại `REVIEW` trong `order_reminders`.
  - Mỗi người nhận một email cho mỗi sự kiện, kể cả khi có nhiều đơn.
  - Gửi trong 7 ngày kể từ mốc 24 giờ sau buổi diễn.
- **Khác thiết kế**: ban tổ chức trả lời **ngay trên trang sự kiện công khai**, không có tab riêng trong khu ban tổ chức.
  - API danh sách trả `canReply` cho người xem là ban tổ chức của sự kiện hoặc admin, nên một trang dùng chung cho mọi người.
  - Trang admin Đánh giá vẫn có, với link sang trang sự kiện.
- **Web**:
  - Khối Đánh giá trên trang sự kiện: điểm, thanh 5 → 1 sao (bấm để lọc), sắp xếp, phân trang, form của tôi, câu trả lời của ban tổ chức.
  - ★ trên thẻ sự kiện và dưới tên sự kiện.
  - Link "★ Đánh giá sự kiện" ở vé đã vào cổng.
  - Trang admin **Đánh giá**.
- **Kiểm thử**: backend 8 test tích hợp (có test 10 người đánh giá cùng lúc), E2E 1 kịch bản (khách viết → ban tổ chức trả lời → admin ẩn).
