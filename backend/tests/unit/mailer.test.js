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

  test('sends without attachments when there are none', async () => {
    await sendMail({ to: 'a@example.test', subject: 'S', text: 'T', html: '<p>T</p>' });
    expect(nodemailer.sendMail).toHaveBeenCalledWith(expect.objectContaining({ attachments: [] }));
  });
});
