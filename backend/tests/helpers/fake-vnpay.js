const http = require('node:http');
const vnpay = require('../../src/modules/payments/vnpay');

/**
 * VNPay's querydr / refund API as a small local server (Phase 17 tests), on
 * the port VNPAY_API_URL points to (tests/setup/env.js). It checks each
 * request's checksum and signs its answers like VNPay does.
 *
 * Tests decide what "VNPay" knows:
 *   fake.paid(txnRef, amount)    a successful payment (querydr → 00 / 00)
 *   fake.open(txnRef, amount)    not finished yet     (querydr → 00 / 01)
 *   fake.failed(txnRef, amount)  a failed payment     (querydr → 00 / 02)
 *   unknown txnRef               never paid           (querydr → 91)
 *   fake.state.refundCode        answer to refunds (default '00')
 *   fake.state.down = true       HTTP 503 to everything
 */
const PORT = Number(new URL(process.env.VNPAY_API_URL).port);

// Transaction numbers are unique in the database (payments, refunds), across test runs too.
let serial = Date.now();
const nextTransactionNo = () => String(serial++);

function startFakeVnpay() {
  const state = { transactions: new Map(), refundCode: '00', down: false, requests: [] };

  function answerQuery(body) {
    const tx = state.transactions.get(body.vnp_TxnRef);
    if (!tx) return { vnp_ResponseId: 'r1', vnp_Command: 'querydr', vnp_ResponseCode: '91', vnp_Message: 'Not found' };
    const data = {
      vnp_ResponseId: `q${Date.now()}`,
      vnp_Command: 'querydr',
      vnp_ResponseCode: '00',
      vnp_Message: 'QueryDR Success',
      vnp_TmnCode: body.vnp_TmnCode,
      vnp_TxnRef: body.vnp_TxnRef,
      vnp_Amount: String(tx.amount * 100),
      vnp_BankCode: 'NCB',
      vnp_PayDate: '20261015103500',
      vnp_TransactionNo: tx.transactionNo,
      vnp_TransactionType: '01',
      vnp_TransactionStatus: tx.status,
      vnp_OrderInfo: body.vnp_OrderInfo,
      vnp_PromotionCode: '',
      vnp_PromotionAmount: '',
    };
    data.vnp_SecureHash = vnpay.signFields([
      data.vnp_ResponseId, data.vnp_Command, data.vnp_ResponseCode, data.vnp_Message, data.vnp_TmnCode, data.vnp_TxnRef,
      data.vnp_Amount, data.vnp_BankCode, data.vnp_PayDate, data.vnp_TransactionNo, data.vnp_TransactionType,
      data.vnp_TransactionStatus, data.vnp_OrderInfo, data.vnp_PromotionCode, data.vnp_PromotionAmount,
    ]);
    return data;
  }

  function answerRefund(body) {
    const data = {
      vnp_ResponseId: `f${Date.now()}`,
      vnp_Command: 'refund',
      vnp_ResponseCode: state.refundCode,
      vnp_Message: state.refundCode === '00' ? 'Refund success' : 'Refund refused',
      vnp_TmnCode: body.vnp_TmnCode,
      vnp_TxnRef: body.vnp_TxnRef,
      vnp_Amount: body.vnp_Amount,
      vnp_BankCode: 'NCB',
      vnp_PayDate: '20261015110000',
      vnp_TransactionNo: nextTransactionNo(),
      vnp_TransactionType: body.vnp_TransactionType,
      vnp_TransactionStatus: '05',
      vnp_OrderInfo: body.vnp_OrderInfo,
    };
    data.vnp_SecureHash = vnpay.signFields([
      data.vnp_ResponseId, data.vnp_Command, data.vnp_ResponseCode, data.vnp_Message, data.vnp_TmnCode, data.vnp_TxnRef,
      data.vnp_Amount, data.vnp_BankCode, data.vnp_PayDate, data.vnp_TransactionNo, data.vnp_TransactionType,
      data.vnp_TransactionStatus, data.vnp_OrderInfo,
    ]);
    return data;
  }

  /** The checksum the merchant must have sent (VNPay's documented field order). */
  function requestIsSigned(body) {
    const fields =
      body.vnp_Command === 'refund'
        ? [body.vnp_RequestId, body.vnp_Version, body.vnp_Command, body.vnp_TmnCode, body.vnp_TransactionType, body.vnp_TxnRef,
            body.vnp_Amount, body.vnp_TransactionNo, body.vnp_TransactionDate, body.vnp_CreateBy, body.vnp_CreateDate,
            body.vnp_IpAddr, body.vnp_OrderInfo]
        : [body.vnp_RequestId, body.vnp_Version, body.vnp_Command, body.vnp_TmnCode, body.vnp_TxnRef,
            body.vnp_TransactionDate, body.vnp_CreateDate, body.vnp_IpAddr, body.vnp_OrderInfo];
    return vnpay.signFields(fields) === body.vnp_SecureHash;
  }

  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      if (state.down) {
        res.writeHead(503).end();
        return;
      }
      const body = JSON.parse(raw);
      state.requests.push(body);
      const answer = !requestIsSigned(body)
        ? { vnp_ResponseCode: '97', vnp_Message: 'Invalid checksum' }
        : body.vnp_Command === 'refund'
          ? answerRefund(body)
          : answerQuery(body);
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(answer));
    });
  });

  const know = (status) => (txnRef, amount, transactionNo = nextTransactionNo()) => {
    state.transactions.set(txnRef, { status, amount, transactionNo });
  };

  return new Promise((resolve) => {
    server.listen(PORT, '127.0.0.1', () =>
      resolve({
        state,
        paid: know('00'),
        open: know('01'),
        failed: know('02'),
        refundsSent: () => state.requests.filter((r) => r.vnp_Command === 'refund'),
        reset() {
          state.transactions.clear();
          state.requests.length = 0;
          state.refundCode = '00';
          state.down = false;
        },
        close: () => new Promise((done) => server.close(done)),
      }),
    );
  });
}

/** IPN / Return URL parameters as VNPay sends them: vnp_* plus their signature. */
function signedCallback(params) {
  return { ...params, vnp_SecureHash: vnpay.sign(vnpay.signedQuery(params)) };
}

module.exports = { startFakeVnpay, signedCallback, nextTransactionNo };
