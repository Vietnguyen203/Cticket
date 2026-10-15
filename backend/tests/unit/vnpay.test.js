const crypto = require('node:crypto');
const vnpay = require('../../src/modules/payments/vnpay');

const SECRET = process.env.VNPAY_HASH_SECRET;
const hmac = (data) => crypto.createHmac('sha512', SECRET).update(data).digest('hex');

describe('VNPay signing (pay, IPN, Return URL)', () => {
  test('parameters sorted by name, URL-encoded with spaces as "+", HMAC-SHA512', () => {
    const query = vnpay.signedQuery({ vnp_TxnRef: 'abc', vnp_Amount: '1000000', vnp_OrderInfo: 'Thanh toan don ETP 1' });
    expect(query).toBe('vnp_Amount=1000000&vnp_OrderInfo=Thanh+toan+don+ETP+1&vnp_TxnRef=abc');
  });

  test('the payment URL: every required parameter, amount × 100, signed', () => {
    const url = new URL(
      vnpay.paymentUrl({
        txnRef: 'a1b2c3',
        amount: 2_500_000,
        orderInfo: 'Thanh toán đơn ETP-261015-ABCDEF',
        ipAddr: '113.160.92.202',
        createDate: '20261015103000',
        expireDate: '20261015104800',
      }),
    );
    expect(`${url.origin}${url.pathname}`).toBe('https://sandbox.vnpayment.vn/paymentv2/vpcpay.html');
    const params = Object.fromEntries(url.searchParams);
    expect(params).toMatchObject({
      vnp_Version: '2.1.0',
      vnp_Command: 'pay',
      vnp_TmnCode: 'TESTTMN1',
      vnp_Amount: '250000000',
      vnp_CurrCode: 'VND',
      vnp_TxnRef: 'a1b2c3',
      vnp_OrderInfo: 'Thanh toan don ETP 261015 ABCDEF', // no accents, no special characters
      vnp_OrderType: 'other',
      vnp_Locale: 'vn',
      vnp_ReturnUrl: 'http://localhost:5173/payments/vnpay/return',
      vnp_IpAddr: '113.160.92.202',
      vnp_CreateDate: '20261015103000',
      vnp_ExpireDate: '20261015104800',
    });
    const { vnp_SecureHash: hash, ...signed } = params;
    expect(hash).toBe(hmac(vnpay.signedQuery(signed)));
    expect(vnpay.verifyCallback(params).valid).toBe(true); // what VNPay checks, we can check too
  });

  test('a callback: valid as sent; one changed character, a missing hash or another secret → invalid', () => {
    const params = { vnp_Amount: '250000000', vnp_ResponseCode: '00', vnp_TransactionStatus: '00', vnp_TxnRef: 'a1b2c3' };
    const signed = { ...params, vnp_SecureHash: hmac(vnpay.signedQuery(params)), vnp_SecureHashType: 'HmacSHA512' };
    expect(vnpay.verifyCallback(signed)).toEqual({ valid: true, params });
    expect(vnpay.verifyCallback({ ...signed, vnp_SecureHash: signed.vnp_SecureHash.toUpperCase() }).valid).toBe(true);
    expect(vnpay.verifyCallback({ ...signed, vnp_Amount: '250000001' }).valid).toBe(false);
    expect(vnpay.verifyCallback(params).valid).toBe(false);
    expect(vnpay.verifyCallback({ ...params, vnp_SecureHash: 'x'.repeat(128) }).valid).toBe(false);
    // Parameters that are not VNPay's are ignored; a repeated one (array) is never trusted.
    expect(vnpay.verifyCallback({ ...signed, utm_source: 'mail' }).valid).toBe(true);
    expect(vnpay.verifyCallback({ ...signed, vnp_TxnRef: ['a1b2c3', 'other'] }).valid).toBe(false);
  });

  test('outcome: paid only with transaction status 00; the reason is the response code', () => {
    expect(vnpay.outcomeOf({ vnp_ResponseCode: '00', vnp_TransactionStatus: '00', vnp_Amount: '250000000' })).toMatchObject({
      paid: true,
      amount: 2_500_000,
    });
    expect(
      vnpay.outcomeOf({ vnp_ResponseCode: '24', vnp_TransactionStatus: '02', vnp_Amount: '100', vnp_TransactionNo: '0' }),
    ).toEqual(expect.objectContaining({ paid: false, responseCode: '24', transactionNo: null })); // "0": no transaction at VNPay
    // querydr: the response code only says the query worked.
    expect(vnpay.outcomeOf({ vnp_ResponseCode: '00', vnp_TransactionStatus: '02' }, { fromQuery: true }).responseCode).toBe('02');
  });
});

describe('VNPay details', () => {
  test('times are Vietnam time (GMT+7), yyyyMMddHHmmss', () => {
    expect(vnpay.vnTime(new Date('2026-10-15T03:30:05Z'))).toBe('20261015103005');
    expect(vnpay.vnTime(new Date('2026-12-31T20:00:00Z'))).toBe('20270101030000'); // next day in Vietnam
  });

  test('order info: Vietnamese without accents, no special characters, at most 255', () => {
    expect(vnpay.plainText('Thanh toán đơn #ETP-1 (Đà Lạt)')).toBe('Thanh toan don ETP 1 Da Lat');
    expect(vnpay.plainText('x'.repeat(300))).toHaveLength(255);
  });
});
