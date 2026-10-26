/**
 * The terms of sale ("Điều kiện giao dịch chung") shown at /dieu-khoan and
 * accepted at checkout. TERMS_VERSION must match backend/src/config/constants.js
 * TERMS_VERSION: a changed text gets a new version in both places, so a buyer
 * whose page still shows the old text is asked to read the new one.
 */
export const TERMS_VERSION = '2026-10-26'
export const TERMS_EFFECTIVE_DATE = '26/10/2026'

export interface LegalBasis {
  law: string
  articles?: string
}

/** "Căn cứ": the laws the terms rest on, as in a Vietnamese contract's preamble. */
export const LEGAL_BASES: LegalBasis[] = [
  {
    law: 'Hiến pháp nước Cộng hòa xã hội chủ nghĩa Việt Nam năm 2013 (sửa đổi, bổ sung năm 2025)',
    articles:
      'Điều 21 (quyền bất khả xâm phạm về đời sống riêng tư, bí mật cá nhân), Điều 32 (quyền sở hữu thu nhập hợp pháp, tài sản), Điều 33 (quyền tự do kinh doanh trong những ngành nghề pháp luật không cấm)',
  },
  {
    law: 'Bộ luật Dân sự số 91/2015/QH13',
    articles:
      'Điều 3 (nguyên tắc tự do, tự nguyện cam kết, thỏa thuận; thiện chí, trung thực), Điều 385 (hợp đồng), Điều 405 (hợp đồng theo mẫu), Điều 406 (giao kết hợp đồng có điều kiện giao dịch chung), khoản 1 Điều 156 và khoản 2 Điều 351 (sự kiện bất khả kháng)',
  },
  {
    law: 'Luật Bảo vệ quyền lợi người tiêu dùng số 19/2023/QH15 và Nghị định số 55/2024/NĐ-CP hướng dẫn thi hành',
    articles: 'các quy định về hợp đồng theo mẫu, điều kiện giao dịch chung (Điều 23) và giao dịch với người tiêu dùng',
  },
  { law: 'Luật Giao dịch điện tử số 20/2023/QH15', articles: 'giá trị pháp lý của thông điệp dữ liệu và hợp đồng điện tử' },
  { law: 'Luật Thương mại điện tử số 122/2025/QH15' },
  { law: 'Luật Bảo vệ dữ liệu cá nhân số 91/2025/QH15' },
]

export interface Article {
  /** Anchor on the page: /dieu-khoan#<id> */
  id: string
  title: string
  clauses: string[]
  /** Rendered after the clauses (the refund tiers table). */
  extra?: 'refund-tiers'
}

export const ARTICLES: Article[] = [
  {
    id: 'giai-thich',
    title: 'Giải thích từ ngữ',
    clauses: [
      '"ETP" là nền tảng bán vé sự kiện ETP Tickets, cung cấp dịch vụ trung gian: đăng bán vé, giữ chỗ, nhận thanh toán, phát vé điện tử và soát vé.',
      '"Ban tổ chức" là tổ chức, cá nhân được ETP duyệt hồ sơ, tổ chức sự kiện và chịu trách nhiệm về nội dung, chất lượng sự kiện. Tên Ban tổ chức hiển thị trên trang của từng sự kiện.',
      '"Khách hàng" là người đặt mua vé trên ETP; là người tiêu dùng theo Luật Bảo vệ quyền lợi người tiêu dùng khi mua vé cho nhu cầu cá nhân, gia đình.',
      '"Đơn hàng" là yêu cầu mua một hoặc nhiều vé của một suất diễn; "Vé" là vé điện tử có mã QR, mỗi vé cho một người vào cửa một lần.',
      '"Chính sách hủy" là mức hoàn tiền khi Khách hàng tự hủy đơn, do Ban tổ chức chọn cho từng sự kiện trong các mức nêu tại Điều 5.',
    ],
  },
  {
    id: 'giao-ket',
    title: 'Phạm vi áp dụng và giao kết hợp đồng',
    clauses: [
      'Điều kiện giao dịch chung này áp dụng cho mọi đơn hàng mua vé trên ETP và được công khai tại trang này để Khách hàng đọc trước khi mua (Điều 406 Bộ luật Dân sự 2015).',
      'Hợp đồng mua vé là hợp đồng điện tử, gồm: thông tin đơn hàng (sự kiện, suất diễn, chỗ ngồi, giá), Chính sách hủy của sự kiện tại thời điểm thanh toán, và Điều kiện giao dịch chung này. Hợp đồng điện tử có giá trị pháp lý như hợp đồng bằng văn bản theo Luật Giao dịch điện tử 2023.',
      'Hợp đồng được giao kết khi Khách hàng đánh dấu "Tôi đã đọc và đồng ý Điều kiện giao dịch chung" và bấm "Tiếp tục thanh toán"; có hiệu lực khi thanh toán thành công. ETP lưu trên đơn hàng phiên bản Điều kiện giao dịch chung, thời điểm Khách hàng đồng ý và Chính sách hủy áp dụng, làm căn cứ khi có tranh chấp.',
      'Điều khoản nào chưa rõ ràng được giải thích theo hướng có lợi cho Khách hàng (khoản 2 Điều 405 Bộ luật Dân sự 2015). Điều khoản nào miễn trách nhiệm của ETP hoặc Ban tổ chức, tăng trách nhiệm hoặc loại bỏ quyền lợi chính đáng của Khách hàng thì không có hiệu lực (khoản 3 Điều 406 Bộ luật Dân sự 2015).',
    ],
  },
  {
    id: 'dat-va-thanh-toan',
    title: 'Đặt chỗ, giữ chỗ và thanh toán',
    clauses: [
      'Khách hàng chọn ghế (hoặc số lượng vé đứng) và giữ chỗ. Chỗ được giữ trong 10 phút; một đơn có tối đa 8 vé và không vượt mức tối đa của từng hạng vé.',
      'Giá vé niêm yết bằng đồng Việt Nam trên trang sự kiện. Mã giảm giá (nếu có) được áp dụng trước khi thanh toán; số tiền phải trả hiển thị rõ trước khi Khách hàng xác nhận.',
      'Thanh toán qua cổng VNPay. Sau khi bấm "Tiếp tục thanh toán", Khách hàng có 10 phút để hoàn tất; quá thời gian, đơn hết hạn và chỗ được mở bán lại.',
      'Nếu tiền được trừ sau khi đơn đã hết hạn hoặc bị trừ hai lần, ETP tự động hoàn lại toàn bộ khoản tiền đó và báo qua email.',
    ],
  },
  {
    id: 've-dien-tu',
    title: 'Vé điện tử và vào cửa',
    clauses: [
      'Khi thanh toán thành công, Khách hàng nhận vé có mã QR tại mục "Vé của tôi" và qua email xác nhận (kèm file PDF).',
      'Mỗi mã QR chỉ dùng để vào cửa một lần. Khách hàng tự bảo quản mã QR; ETP và Ban tổ chức không chịu trách nhiệm khi mã bị người khác sử dụng trước do Khách hàng để lộ. Khi nghi ngờ lộ mã, Khách hàng liên hệ để được cấp lại mã QR mới (mã cũ hết hiệu lực).',
      'Khách hàng tuân thủ quy định của địa điểm và Ban tổ chức (giờ vào cửa, độ tuổi, vật dụng mang theo). Ban tổ chức có quyền từ chối vào cửa nếu vé không hợp lệ.',
    ],
  },
  {
    id: 'huy-va-hoan-tien',
    title: 'Khách hàng hủy đơn và hoàn tiền',
    clauses: [
      'Mỗi sự kiện áp dụng một trong ba Chính sách hủy dưới đây, hiển thị trên trang sự kiện trước khi mua. Mốc thời gian tính theo giờ bắt đầu suất diễn (giờ Việt Nam).',
      'Khách hàng tự hủy đơn đã thanh toán tại trang đơn hàng; số tiền được hoàn và phí hủy được hiển thị trước khi xác nhận. Phần không được hoàn là phí hủy, thuộc về Ban tổ chức theo thỏa thuận tại hợp đồng này.',
      'Chính sách hủy áp dụng cho đơn hàng là chính sách tại thời điểm thanh toán. Ban tổ chức đổi sang chính sách khác sau đó thì đơn hàng đã mua vẫn giữ chính sách cũ, trừ khi chính sách mới có lợi hơn cho Khách hàng.',
      'Không hủy được: đơn có vé đã vào cửa; suất diễn đã qua mốc hủy cuối cùng; sự kiện chọn "Không hoàn" (trừ các trường hợp tại Điều 6 và Điều 7).',
      'Tiền được hoàn về phương thức thanh toán ban đầu; thời gian tiền về tài khoản tùy ngân hàng (thường 1–15 ngày làm việc). Lượt dùng mã giảm giá không được trả lại.',
    ],
    extra: 'refund-tiers',
  },
  {
    id: 'ban-to-chuc-huy',
    title: 'Sự kiện bị hủy, hoãn hoặc thay đổi',
    clauses: [
      'Ban tổ chức hoặc ETP hủy sự kiện hoặc suất diễn: mọi đơn đã thanh toán được hoàn 100% số tiền đã trả, tự động, không phụ thuộc Chính sách hủy, và Khách hàng được báo qua email.',
      'Sự kiện bị hoãn sang thời gian khác, đổi địa điểm hoặc thay đổi nội dung chính (nghệ sĩ chính, chương trình): Ban tổ chức thông báo cho Khách hàng. Khách hàng không đồng ý với thay đổi có quyền yêu cầu hủy đơn và được hoàn 100% số tiền đã trả.',
    ],
  },
  {
    id: 'bat-kha-khang',
    title: 'Sự kiện bất khả kháng',
    clauses: [
      'Sự kiện bất khả kháng là sự kiện xảy ra một cách khách quan, không thể lường trước và không thể khắc phục được dù đã áp dụng mọi biện pháp cần thiết (khoản 1 Điều 156 Bộ luật Dân sự 2015), ví dụ thiên tai, dịch bệnh, quyết định của cơ quan nhà nước có thẩm quyền.',
      'Bên không thực hiện được nghĩa vụ do sự kiện bất khả kháng không phải bồi thường thiệt hại (khoản 2 Điều 351 Bộ luật Dân sự 2015). Tuy vậy, khi sự kiện không diễn ra vì bất khả kháng, Khách hàng vẫn được hoàn 100% giá vé đã trả như Điều 6.',
    ],
  },
  {
    id: 'quyen-khach-hang',
    title: 'Quyền và nghĩa vụ của Khách hàng',
    clauses: [
      'Được cung cấp thông tin đầy đủ, chính xác về sự kiện, giá vé, Chính sách hủy trước khi mua; được nhận vé đúng như đơn hàng đã thanh toán.',
      'Được hủy đơn và hoàn tiền theo Điều 5, Điều 6, Điều 7; được khiếu nại và yêu cầu giải quyết theo Điều 12.',
      'Cung cấp thông tin tài khoản chính xác; không mua vé để bán lại trái phép, không dùng công cụ tự động để giữ chỗ hàng loạt; bảo quản tài khoản và mã QR.',
      'Đánh giá sự kiện trung thực, không đăng nội dung vi phạm pháp luật, xúc phạm người khác; ETP có quyền ẩn đánh giá vi phạm và nêu lý do.',
    ],
  },
  {
    id: 'quyen-ban-to-chuc',
    title: 'Quyền và nghĩa vụ của Ban tổ chức và ETP',
    clauses: [
      'Ban tổ chức chịu trách nhiệm tổ chức sự kiện đúng thông tin đã công bố và có giấy phép theo quy định; thực hiện hoàn tiền theo Chính sách hủy và Điều 6.',
      'ETP thực hiện đúng quy trình đặt chỗ, thanh toán, phát vé, hoàn tiền; bảo đảm mỗi chỗ ngồi chỉ được bán một lần; giải quyết khiếu nại về giao dịch trên nền tảng.',
      'ETP có quyền tạm khóa tài khoản có dấu hiệu gian lận (ví dụ dùng mã QR giả, giữ chỗ hàng loạt) và thông báo lý do cho người bị khóa.',
    ],
  },
  {
    id: 'du-lieu-ca-nhan',
    title: 'Bảo vệ dữ liệu cá nhân',
    clauses: [
      'ETP thu thập họ tên, email, số điện thoại (nếu có) và lịch sử mua vé chỉ để thực hiện hợp đồng: giữ chỗ, thanh toán, gửi vé và thông báo, soát vé, hoàn tiền; tôn trọng quyền về đời sống riêng tư, bí mật cá nhân (Điều 21 Hiến pháp 2013).',
      'ETP không bán dữ liệu cá nhân của Khách hàng. Ban tổ chức chỉ nhận thông tin cần cho việc tổ chức và soát vé sự kiện của mình. Việc xử lý dữ liệu tuân thủ Luật Bảo vệ dữ liệu cá nhân 2025.',
      'Thông tin thẻ, tài khoản ngân hàng do VNPay xử lý; ETP không lưu số thẻ của Khách hàng.',
    ],
  },
  {
    id: 'cham-dut',
    title: 'Chấm dứt hợp đồng',
    clauses: [
      'Hợp đồng chấm dứt khi: vé đã được sử dụng và sự kiện kết thúc; đơn hàng được hủy và hoàn tiền theo Điều 5, Điều 6, Điều 7; hoặc đơn hết hạn trước khi thanh toán.',
    ],
  },
  {
    id: 'tranh-chap',
    title: 'Khiếu nại và giải quyết tranh chấp',
    clauses: [
      'Khách hàng gửi khiếu nại tới ETP hoặc Ban tổ chức, kèm mã đơn hàng. ETP tiếp nhận, phối hợp với Ban tổ chức và trả lời trong thời hạn theo quy định của pháp luật về bảo vệ quyền lợi người tiêu dùng.',
      'Tranh chấp được giải quyết trước hết bằng thương lượng; không thương lượng được thì các bên có thể hòa giải, đề nghị cơ quan quản lý nhà nước về bảo vệ quyền lợi người tiêu dùng hỗ trợ, hoặc khởi kiện tại Tòa án có thẩm quyền của Việt Nam.',
      'Hợp đồng được điều chỉnh bởi pháp luật Việt Nam. Ngôn ngữ của hợp đồng là tiếng Việt.',
    ],
  },
  {
    id: 'hieu-luc',
    title: 'Hiệu lực và sửa đổi',
    clauses: [
      `Điều kiện giao dịch chung này có hiệu lực từ ngày ${TERMS_EFFECTIVE_DATE} (phiên bản ${TERMS_VERSION}).`,
      'ETP có thể sửa đổi Điều kiện giao dịch chung; bản mới được công bố tại trang này và áp dụng cho đơn hàng thanh toán sau thời điểm công bố. Đơn hàng đã thanh toán tiếp tục theo phiên bản Khách hàng đã đồng ý, trừ khi bản mới có lợi hơn cho Khách hàng.',
    ],
  },
]

/** "Điều N" of an article, by its anchor (links from other pages name the article). */
export function articleNumber(id: string): number {
  return ARTICLES.findIndex((a) => a.id === id) + 1
}
