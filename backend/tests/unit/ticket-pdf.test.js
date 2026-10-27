const { renderTicketsPdf, pageContent, maskCode } = require('../../src/modules/tickets/ticket-pdf');
const { qrToken, parseQrToken } = require('../../src/modules/tickets/qr');

/** Phase 20: the ticket PDF. */
const base = {
  order_code: 'ETP-261016-ABCDEF',
  first_name: 'Việt',
  last_name: 'Nguyễn',
  event_title: 'Đêm nhạc mùa thu',
  start_at: new Date('2026-10-20T13:00:00Z'), // 20:00 in Vietnam
  venue_name: 'Cung Điền Kinh Mỹ Đình',
  venue_address: 'Lê Đức Thọ',
  venue_city: 'Hà Nội',
  ticket_type_name: 'Hạng VIP',
  qr_version: 1,
};
const seat = { ...base, id: '11111111-2222-4333-8444-555555555555', ticket_code: 'TKT-AAAAAAAAAA', seat_label: 'Khu A - A01', admission_no: 1 };
const standing = { ...base, id: '11111111-2222-4333-8444-666666666666', ticket_code: 'TKT-BBBBBBBBBB', seat_label: null, ticket_type_name: 'Vé đứng', admission_no: 2 };

describe('ticket PDF', () => {
  test('a page says what, when, where, which place, and carries the ticket’s current QR', () => {
    const page = pageContent(seat);
    expect(page).toMatchObject({ title: 'Đêm nhạc mùa thu', place: 'Ghế Khu A - A01', ticketType: 'Hạng VIP', code: 'TKT-••••••AAAA' }); // the middle hidden
    expect(page.when).toContain('20:00');
    expect(page.where).toBe('Cung Điền Kinh Mỹ Đình — Lê Đức Thọ, Hà Nội');
    expect(page.footer).toEqual(['Đơn ETP-••••••-••CDEF · Nguyễn Việt']);
    expect(page.notes[0]).toBe('Cổng soát vé mở từ 17:00.'); // 3 hours before
    expect(page.qrToken).toBe(qrToken(seat.id, 1));
    expect(parseQrToken(page.qrToken)).toEqual({ ticketId: seat.id, version: 1 }); // what the gate reads
    expect(pageContent({ ...seat, qr_version: 2 }).qrToken).not.toBe(page.qrToken); // a re-issued QR prints the new code
    expect(pageContent(standing).place).toBe('Vé số 2');
  });

  test('codes keep their prefix and last 4 characters, the rest is hidden', () => {
    expect(maskCode('TKT-8QLET9GGXZ')).toBe('TKT-••••••GGXZ');
    expect(maskCode('ETP-261027-V9VQUM')).toBe('ETP-••••••-••VQUM');
  });

  test('a real PDF, one page per ticket, with the Vietnamese font embedded', async () => {
    const pdf = await renderTicketsPdf([seat, standing], { compress: false });
    const text = pdf.toString('latin1');
    expect(text.startsWith('%PDF-')).toBe(true);
    expect(text.match(/\/Type \/Page\b/g)).toHaveLength(2);
    expect(text).toContain('BeVietnamPro');
    await expect(renderTicketsPdf([])).rejects.toThrow('No ticket');
  });
});
