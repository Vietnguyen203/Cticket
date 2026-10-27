const nodemailer = require('nodemailer');

jest.mock('nodemailer', () => {
  const sendMail = jest.fn().mockResolvedValue({});
  return { createTransport: jest.fn(() => ({ sendMail })), sendMail };
});

const { sendMail } = require('../../src/mail/mailer');

// The services' tests mock this module, so only here is it seen what reaches SMTP.
describe('sendMail', () => {
  beforeEach(() => nodemailer.sendMail.mockClear());

  test('passes the attachments on (the ticket PDF of the confirmation email)', async () => {
    const pdf = { filename: 'Ve-ETP-1.pdf', content: Buffer.from('%PDF-'), contentType: 'application/pdf' };
    await sendMail({ to: 'a@example.test', subject: 'S', text: 'T', html: '<p>T</p>', attachments: [pdf] });
    expect(nodemailer.sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'a@example.test', attachments: [pdf] }));
  });

  test('the html part goes in the brand frame; the plain text stays as written', async () => {
    await sendMail({ to: 'a@example.test', subject: 'Xác nhận đơn <ETP-1>', text: 'Chữ thuần', html: '<p>Nội dung</p>' });
    const sent = nodemailer.sendMail.mock.calls[0][0];
    expect(sent.text).toBe('Chữ thuần');
    expect(sent.html).toContain('<p>Nội dung</p>');
    expect(sent.html).toContain('#7c3aed'); // the brand band
    expect(sent.html).toContain('<title>Xác nhận đơn &lt;ETP-1&gt;</title>'); // the subject, escaped
  });

  test('sends without attachments when there are none', async () => {
    await sendMail({ to: 'a@example.test', subject: 'S', text: 'T', html: '<p>T</p>' });
    expect(nodemailer.sendMail).toHaveBeenCalledWith(expect.objectContaining({ attachments: [] }));
  });
});
