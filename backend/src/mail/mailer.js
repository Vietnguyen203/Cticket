const nodemailer = require('nodemailer');
const env = require('../config/env');
const { brandedLayout } = require('./templates');

let transporter;

// Created lazily so that importing this module (e.g. in tests) opens no SMTP connection.
function getTransporter() {
  transporter ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  });
  return transporter;
}

/**
 * Send one email over SMTP.
 * Phase 2 calls this directly; Phase 9 moves the call into a BullMQ worker so
 * HTTP requests never wait for SMTP. Callers depend only on this function.
 *
 * `attachments` (Phase 20: the tickets as a PDF) go to nodemailer as they are.
 * The html part is put in the brand frame (templates.js brandedLayout), the same
 * for every email; the plain-text part stays as written.
 *
 * @param {{ to: string, subject: string, text: string, html: string,
 *   attachments?: Array<{ filename: string, content: Buffer, contentType: string }> }} message
 */
async function sendMail({ to, subject, text, html, attachments = [] }) {
  await getTransporter().sendMail({ from: env.MAIL_FROM, to, subject, text, html: brandedLayout({ subject, html }), attachments });
}

/** Connect and authenticate to the SMTP server without sending anything. */
async function verifyConnection() {
  await getTransporter().verify();
}

module.exports = { sendMail, verifyConnection };
