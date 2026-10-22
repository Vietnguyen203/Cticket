const crypto = require('node:crypto');
const env = require('../../config/env');

/**
 * VNPay gateway, API version 2.1.0 (Phase 17). Written from VNPay's sandbox
 * documentation:
 *   https://sandbox.vnpayment.vn/apis/docs/thanh-toan-pay/pay.html
 *   https://sandbox.vnpayment.vn/apis/docs/truy-van-hoan-tien/querydr&refund.html
 *
 * - Payment URL and the callbacks (IPN, Return URL): the vnp_* parameters,
 *   sorted by name, URL-encoded (space → "+"), joined with "&", signed with
 *   HMAC-SHA512(vnp_HashSecret).
 * - querydr / refund (JSON POST): HMAC-SHA512 of fixed fields joined with "|";
 *   VNPay's answers are signed the same way and checked before being read.
 * The secret is never logged; nothing here writes to the database.
 */
const VERSION = '2.1.0';
const LOCALE = 'vn';
const ORDER_TYPE = 'other';
const CURRENCY = 'VND';
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

const hmac = (data) => crypto.createHmac('sha512', env.VNPAY_HASH_SECRET).update(data, 'utf8').digest('hex');

function safeEqualHex(a, b) {
  const left = Buffer.from(String(a ?? '').toLowerCase(), 'utf8');
  const right = Buffer.from(String(b ?? '').toLowerCase(), 'utf8');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

/** yyyyMMddHHmmss in Vietnam time (GMT+7), whatever the server's time zone. */
function vnTime(date = new Date()) {
  return new Date(date.getTime() + VN_OFFSET_MS).toISOString().replace(/\D/g, '').slice(0, 14);
}

/** As PHP urlencode / VNPay's samples: encodeURIComponent with spaces as "+". */
const encode = (value) => encodeURIComponent(String(value)).replace(/%20/g, '+');

/** The signed string of a vnp_* parameter set: sorted by name, URL-encoded. */
function signedQuery(params) {
  return Object.keys(params)
    .sort()
    .map((key) => `${encode(key)}=${encode(params[key])}`)
    .join('&');
}

/** Order info as VNPay wants it: Vietnamese without accents, no special characters. */
function plainText(text) {
  return String(text)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^A-Za-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 255);
}

const RETURN_PATH = '/payments/vnpay/return';

/**
 * Where VNPay sends the customer back: the web app the payment was started
 * from (one of CORS_ORIGINS, never any other address: no open redirect), or
 * VNPAY_RETURN_URL. Coming back to ANOTHER web app (localhost:8080 after
 * paying from the dev server on :5173) looked like opening the site afresh,
 * which ends a session without "remember me": the buyer was logged out.
 */
function returnUrlFor(origin) {
  return origin && env.CORS_ORIGINS.includes(origin) ? `${origin}${RETURN_PATH}` : env.VNPAY_RETURN_URL;
}

/**
 * The URL that sends the customer to VNPay.
 * @param {{ txnRef: string, amount: number, orderInfo: string, ipAddr: string,
 *   createDate: string, expireDate: string, returnUrl?: string }} payment  amount in đồng
 */
function paymentUrl({ txnRef, amount, orderInfo, ipAddr, createDate, expireDate, returnUrl = env.VNPAY_RETURN_URL }) {
  const params = {
    vnp_Version: VERSION,
    vnp_Command: 'pay',
    vnp_TmnCode: env.VNPAY_TMN_CODE,
    vnp_Amount: String(amount * 100), // VNPay counts in 1/100 đồng
    vnp_CurrCode: CURRENCY,
    vnp_TxnRef: txnRef,
    vnp_OrderInfo: plainText(orderInfo),
    vnp_OrderType: ORDER_TYPE,
    vnp_Locale: LOCALE,
    vnp_ReturnUrl: returnUrl,
    vnp_IpAddr: ipAddr,
    vnp_CreateDate: createDate,
    vnp_ExpireDate: expireDate,
  };
  const query = signedQuery(params);
  return `${env.VNPAY_PAY_URL}?${query}&vnp_SecureHash=${hmac(query)}`;
}

/**
 * Check a callback from VNPay (IPN or Return URL query string).
 * @returns {{ valid: boolean, params: Record<string, string> }} the vnp_* values (without the hash)
 */
function verifyCallback(query) {
  const params = {};
  for (const [key, value] of Object.entries(query ?? {})) {
    if (key.startsWith('vnp_') && key !== 'vnp_SecureHash' && key !== 'vnp_SecureHashType' && typeof value === 'string') {
      params[key] = value;
    }
  }
  const valid = typeof query?.vnp_SecureHash === 'string' && safeEqualHex(hmac(signedQuery(params)), query.vnp_SecureHash);
  return { valid, params };
}

/**
 * What a payment's verified data says. vnp_TransactionStatus is the state of
 * the transaction (00 = paid). The reason shown to the customer is the
 * callback's vnp_ResponseCode (24 cancelled, 51 no funds…); a querydr
 * answer's vnp_ResponseCode only says the query worked, so there the
 * transaction status is the reason.
 * @param {Record<string, string>} data
 * @param {{ fromQuery?: boolean }} [options]
 */
function outcomeOf(data, { fromQuery = false } = {}) {
  const status = data.vnp_TransactionStatus ?? data.vnp_ResponseCode;
  return {
    paid: status === '00',
    responseCode: fromQuery ? status : data.vnp_ResponseCode,
    amount: Number(data.vnp_Amount) / 100,
    // "0" when no transaction was made at VNPay (e.g. the customer cancelled): not an id.
    transactionNo: data.vnp_TransactionNo && data.vnp_TransactionNo !== '0' ? data.vnp_TransactionNo : null,
    bankCode: data.vnp_BankCode || null,
  };
}

// --- server-to-server API (querydr, refund) ----------------------------------

class VnpayUnavailableError extends Error {}

async function post(body) {
  let response;
  try {
    response = await fetch(env.VNPAY_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(env.VNPAY_TIMEOUT_MS),
    });
  } catch (err) {
    throw new VnpayUnavailableError(`VNPay API unreachable: ${err.message}`, { cause: err });
  }
  if (!response.ok) throw new VnpayUnavailableError(`VNPay API answered HTTP ${response.status}`);
  return response.json();
}

const field = (value) => (value === undefined || value === null ? '' : String(value));
const joined = (values) => values.map(field).join('|');

/** A request id VNPay has not seen today (alphanumeric, ≤ 32). */
const requestId = () => crypto.randomUUID().replace(/-/g, '');

/**
 * querydr: what VNPay knows about one payment.
 * @returns {Promise<{ state: 'PAID'|'FAILED'|'OPEN'|'NOT_FOUND', outcome?: object, data: object }>}
 * @throws VnpayUnavailableError when VNPay cannot be asked (network, bad signature, rate limit)
 */
async function queryTransaction({ txnRef, transactionDate }) {
  const request = {
    vnp_RequestId: requestId(),
    vnp_Version: VERSION,
    vnp_Command: 'querydr',
    vnp_TmnCode: env.VNPAY_TMN_CODE,
    vnp_TxnRef: txnRef,
    vnp_OrderInfo: plainText(`Truy van giao dich ${txnRef}`),
    vnp_TransactionDate: transactionDate,
    vnp_CreateDate: vnTime(),
    vnp_IpAddr: env.VNPAY_SERVER_IP,
  };
  request.vnp_SecureHash = hmac(
    joined([
      request.vnp_RequestId, request.vnp_Version, request.vnp_Command, request.vnp_TmnCode, request.vnp_TxnRef,
      request.vnp_TransactionDate, request.vnp_CreateDate, request.vnp_IpAddr, request.vnp_OrderInfo,
    ]),
  );
  const data = await post(request);

  if (data.vnp_ResponseCode === '91') return { state: 'NOT_FOUND', data }; // the customer never paid
  const signature = joined([
    data.vnp_ResponseId, data.vnp_Command, data.vnp_ResponseCode, data.vnp_Message, data.vnp_TmnCode, data.vnp_TxnRef,
    data.vnp_Amount, data.vnp_BankCode, data.vnp_PayDate, data.vnp_TransactionNo, data.vnp_TransactionType,
    data.vnp_TransactionStatus, data.vnp_OrderInfo, data.vnp_PromotionCode, data.vnp_PromotionAmount,
  ]);
  if (data.vnp_ResponseCode !== '00' || !safeEqualHex(hmac(signature), data.vnp_SecureHash)) {
    // 94 = asked too often, 97 / 99 / a wrong signature: no answer to trust.
    throw new VnpayUnavailableError(`VNPay querydr gave no usable answer (code ${field(data.vnp_ResponseCode)})`);
  }
  const outcome = outcomeOf(data, { fromQuery: true });
  if (outcome.paid) return { state: 'PAID', outcome, data };
  return { state: data.vnp_TransactionStatus === '01' ? 'OPEN' : 'FAILED', outcome, data };
}

/** Refund codes VNPay will never accept on a retry. */
const FINAL_REFUSALS = new Set(['02', '03', '91', '95', '97']);

/**
 * Refund of a successful payment: all of it, or part of it (`partial`).
 * @returns {Promise<{ state: 'DONE'|'REFUSED', responseCode: string, message: string, refundTransactionNo: string|null, data: object }>}
 * @throws VnpayUnavailableError for a temporary failure (the caller retries)
 */
async function refund({ txnRef, amount, transactionNo, transactionDate, createdBy, partial = false }) {
  const request = {
    vnp_RequestId: requestId(),
    vnp_Version: VERSION,
    vnp_Command: 'refund',
    vnp_TmnCode: env.VNPAY_TMN_CODE,
    vnp_TransactionType: partial ? '03' : '02', // 03 = part of the payment (Phase 18.3), 02 = all of it
    vnp_TxnRef: txnRef,
    vnp_Amount: String(amount * 100),
    vnp_OrderInfo: plainText(`Hoan tien giao dich ${txnRef}`),
    vnp_TransactionNo: transactionNo ?? '',
    vnp_TransactionDate: transactionDate,
    vnp_CreateBy: plainText(createdBy).replace(/ /g, '').slice(0, 245) || 'system', // a user id without dashes
    vnp_CreateDate: vnTime(),
    vnp_IpAddr: env.VNPAY_SERVER_IP,
  };
  request.vnp_SecureHash = hmac(
    joined([
      request.vnp_RequestId, request.vnp_Version, request.vnp_Command, request.vnp_TmnCode, request.vnp_TransactionType,
      request.vnp_TxnRef, request.vnp_Amount, request.vnp_TransactionNo, request.vnp_TransactionDate,
      request.vnp_CreateBy, request.vnp_CreateDate, request.vnp_IpAddr, request.vnp_OrderInfo,
    ]),
  );
  const data = await post(request);
  const code = field(data.vnp_ResponseCode);
  const result = { responseCode: code, message: field(data.vnp_Message), refundTransactionNo: data.vnp_TransactionNo || null, data };

  // 94: a refund of this payment is already being processed by VNPay.
  if (code === '00' || code === '94') {
    const signature = joined([
      data.vnp_ResponseId, data.vnp_Command, data.vnp_ResponseCode, data.vnp_Message, data.vnp_TmnCode, data.vnp_TxnRef,
      data.vnp_Amount, data.vnp_BankCode, data.vnp_PayDate, data.vnp_TransactionNo, data.vnp_TransactionType,
      data.vnp_TransactionStatus, data.vnp_OrderInfo,
    ]);
    if (code === '00' && !safeEqualHex(hmac(signature), data.vnp_SecureHash)) {
      throw new VnpayUnavailableError('VNPay refund answer has a wrong signature');
    }
    return { ...result, state: 'DONE' };
  }
  if (FINAL_REFUSALS.has(code)) return { ...result, state: 'REFUSED' };
  throw new VnpayUnavailableError(`VNPay refund failed for now (code ${code})`);
}

module.exports = {
  VERSION,
  vnTime,
  signedQuery,
  plainText,
  paymentUrl,
  returnUrlFor,
  verifyCallback,
  outcomeOf,
  queryTransaction,
  refund,
  VnpayUnavailableError,
  // For the tests' fake VNPay and the IPN script: sign like VNPay does.
  sign: (query) => hmac(query),
  signFields: (values) => hmac(joined(values)),
};
