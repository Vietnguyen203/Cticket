/**
 * Development only (Phase 17): send VNPay's IPN for one attempt to a local
 * API, signed with VNPAY_HASH_SECRET, as VNPay's server would. To try the IPN
 * path without a tunnel (docs/phase-17-vnpay-design.md, section 6).
 *
 *   npm run vnpay:ipn -- <paymentId>                 paid (00)
 *   npm run vnpay:ipn -- <paymentId> 24              the customer cancelled
 *   npm run vnpay:ipn -- <paymentId> 00 http://localhost:3000   another API address
 *
 * The payment id is in the order (GET /orders/:id → payments) or the
 * database. No money moves: "paid" here is a test of this application only,
 * so it is refused with NODE_ENV=production (only VNPay calls a real server).
 */
const env = require('../config/env');
const { closePool, pool } = require('../database/pool');
const vnpay = require('../modules/payments/vnpay');

const DEFAULT_API_URL = 'http://localhost:3001'; // the Docker API (API_PORT)

async function sendIpn(paymentId, responseCode = '00', apiUrl = DEFAULT_API_URL) {
  if (env.NODE_ENV === 'production') throw new Error('Refused with NODE_ENV=production: only VNPay sends IPNs to a real server');
  if (!env.VNPAY_ENABLED) throw new Error('VNPAY_TMN_CODE and VNPAY_HASH_SECRET are not set (backend/.env)');
  if (!/^\d{2}$/.test(responseCode)) throw new Error(`A VNPay response code is 2 digits (00 paid, 24 cancelled…), not "${responseCode}"`);

  const { rows } = await pool.query(`SELECT provider_ref, amount FROM payments WHERE id = $1 AND provider = 'VNPAY'`, [paymentId]);
  if (!rows[0]) throw new Error(`No VNPay payment with the id ${paymentId}`);
  const paid = responseCode === '00';
  const transactionNo = paid ? String(Date.now()) : '0';
  const params = {
    vnp_Amount: String(rows[0].amount * 100),
    vnp_BankCode: 'NCB',
    vnp_BankTranNo: paid ? `VNP${transactionNo}` : '',
    vnp_CardType: 'ATM',
    vnp_OrderInfo: 'IPN gui tu npm run vnpay ipn',
    vnp_PayDate: vnpay.vnTime(),
    vnp_ResponseCode: responseCode,
    vnp_TmnCode: env.VNPAY_TMN_CODE,
    vnp_TransactionNo: transactionNo,
    vnp_TransactionStatus: paid ? '00' : '02',
    vnp_TxnRef: rows[0].provider_ref,
  };
  const query = vnpay.signedQuery(params);
  const res = await fetch(`${apiUrl}/api/v1/payments/vnpay/ipn?${query}&vnp_SecureHash=${vnpay.sign(query)}`);
  return res.json();
}

if (require.main === module) {
  const [paymentId, responseCode, apiUrl] = process.argv.slice(2);
  if (!paymentId) {
    console.error('Usage: npm run vnpay:ipn -- <paymentId> [responseCode=00] [apiUrl=http://localhost:3001]');
    process.exitCode = 1;
  } else {
    sendIpn(paymentId, responseCode, apiUrl)
      // VNPay's codes: 00 confirmed, 02 already confirmed, 01 not found, 04 wrong amount, 97 signature, 99 error.
      .then((answer) => console.log('The API answered:', answer))
      .catch((err) => {
        console.error(err.message);
        process.exitCode = 1;
      })
      .finally(() => closePool());
  }
}

module.exports = { sendIpn };
