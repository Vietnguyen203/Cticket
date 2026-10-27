const fs = require('node:fs');
const path = require('node:path');
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const { CHECKIN } = require('../../config/constants');
const { qrToken } = require('./qr');

/**
 * Phase 20: tickets as a PDF (one A5 page per ticket, with its QR code), for
 * the confirmation email and the "Tải vé PDF" buttons. Made on demand, never
 * stored: a re-issued QR (Phase 10) must never be printed from an old file.
 * See docs/phase-20-ticket-pdf-design.md.
 */

const FONT_DIR = path.join(__dirname, '..', '..', '..', 'assets', 'fonts');
// Vietnamese diacritics (the built-in PDF fonts have none). Read once: parsing
// them from disk for every PDF was most of the time spent.
let fonts = null;
const loadFonts = () =>
  (fonts ??= {
    regular: fs.readFileSync(path.join(FONT_DIR, 'BeVietnamPro-Regular.ttf')),
    bold: fs.readFileSync(path.join(FONT_DIR, 'BeVietnamPro-Bold.ttf')),
  });
// The web's colours (frontend/src/index.css): brand violet, the pink accent line, ink text.
const BRAND = '#7c3aed';
const ACCENT = '#ec4899';
const INK = '#160f2e';
const MUTED = '#475569';
const QR_SIZE = 170; // points: ≈ 6 cm
const MARGIN = 36;

const vnDateTime = (date) =>
  new Date(date).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'full', timeStyle: 'short' });
const vnTime = (date) =>
  new Date(date).toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit' });

/**
 * What one page says (pure: tested without reading the PDF, whose text is
 * stored as glyph ids of the embedded font).
 * @param {object} row  a ticket with its order, buyer, show and place (tickets.repository pdfTickets)
 */
function pageContent(row) {
  const gatesOpenAt = new Date(new Date(row.start_at).getTime() - CHECKIN.OPENS_MINUTES_BEFORE_START * 60_000);
  const buyer = [row.last_name, row.first_name].filter(Boolean).join(' ');
  return {
    title: row.event_title,
    when: vnDateTime(row.start_at),
    where: `${row.venue_name} — ${row.venue_address}, ${row.venue_city}`,
    place: row.seat_label ? `Ghế ${row.seat_label}` : `Vé số ${row.admission_no}`, // the type is the line below
    ticketType: row.ticket_type_name,
    code: row.ticket_code,
    qrToken: qrToken(row.id, row.qr_version),
    footer: [`Đơn ${row.order_code}${buyer ? ` · ${buyer}` : ''}`],
    notes: [
      `Cổng soát vé mở từ ${vnTime(gatesOpenAt)}.`,
      'Mỗi vé vào cổng một lần. Không chia sẻ ảnh mã QR.',
    ],
  };
}

/**
 * The QR as vector squares (no PNG: sharper when printed, and encoding 8
 * images was half the time of an 8-ticket PDF). One quiet module around it.
 */
function drawQr(doc, token, x, y, size) {
  const { modules } = QRCode.create(token, { errorCorrectionLevel: 'M' });
  const cells = modules.size + 2;
  const cell = size / cells;
  doc.save().rect(x, y, size, size).fill('#ffffff').fillColor('#000000');
  for (let row = 0; row < modules.size; row += 1) {
    for (let col = 0; col < modules.size; col += 1) {
      if (modules.get(row, col)) doc.rect(x + (col + 1) * cell, y + (row + 1) * cell, cell + 0.05, cell + 0.05);
    }
  }
  doc.fill().restore();
}

/** @returns {Promise<Buffer>} the PDF; `compress: false` only for tests. */
async function renderTicketsPdf(rows, { compress = true, title = 'Vé ETP' } = {}) {
  if (rows.length === 0) throw new Error('No ticket to print');
  const doc = new PDFDocument({ size: 'A5', margin: MARGIN, autoFirstPage: false, compress, info: { Title: title, Author: 'ETP Tickets' } });
  const { regular, bold } = loadFonts();
  doc.registerFont('regular', regular);
  doc.registerFont('bold', bold);
  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));
  const done = new Promise((resolve, reject) => {
    doc.on('end', resolve);
    doc.on('error', reject);
  });

  for (const row of rows) {
    const page = pageContent(row);
    doc.addPage();
    const width = doc.page.width - 2 * MARGIN;

    doc.rect(0, 0, doc.page.width, 44).fill(BRAND);
    doc.rect(0, 44, doc.page.width, 3).fill(ACCENT);
    doc.fillColor('#ffffff').font('bold').fontSize(14).text('ETP Tickets', MARGIN, 15, { width, lineBreak: false });
    doc.fillColor(INK).font('bold').fontSize(17).text(page.title, MARGIN, 64, { width });
    doc.moveDown(0.3).font('regular').fontSize(10.5).fillColor(MUTED).text(page.when, { width });
    doc.text(page.where, { width });

    doc.moveDown(0.8).font('bold').fontSize(14).fillColor(INK).text(page.place, { width, align: 'center' });
    doc.font('regular').fontSize(10).fillColor(MUTED).text(page.ticketType, { width, align: 'center' });

    const qrTop = doc.y + 12;
    drawQr(doc, page.qrToken, (doc.page.width - QR_SIZE) / 2, qrTop, QR_SIZE);
    doc.font('bold').fontSize(13).fillColor(INK).text(page.code, MARGIN, qrTop + QR_SIZE + 8, { width, align: 'center' });

    doc.moveDown(1).font('regular').fontSize(9.5).fillColor(MUTED);
    for (const line of page.footer) doc.text(line, { width, align: 'center' });
    doc.moveDown(0.5);
    for (const line of page.notes) doc.text(line, { width, align: 'center' });
  }

  doc.end();
  await done;
  return Buffer.concat(chunks);
}

module.exports = { renderTicketsPdf, pageContent };
