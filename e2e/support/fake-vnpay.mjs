/**
 * Phase 17: a fake VNPay for the E2E stack (never the real sandbox).
 *
 *   GET  /paymentv2/vpcpay.html   the payment page: checks our signature, shows
 *                                 "Thanh toán" / "Hủy giao dịch"
 *   GET  /pay                     the customer's choice: VNPay's IPN to the API
 *                                 (server to server), then the browser goes back
 *                                 to vnp_ReturnUrl, both signed like VNPay does
 *   POST /merchant_webapi/api/transaction   querydr / refund, signed answers
 *
 * Signing is written again here from VNPay's documentation, not taken from
 * the backend: two implementations that agree are a test of each other.
 */
import { createHmac } from 'node:crypto'
import http from 'node:http'

const encode = (value) => encodeURIComponent(String(value)).replace(/%20/g, '+')
const signedQuery = (params) =>
  Object.keys(params)
    .sort()
    .map((key) => `${encode(key)}=${encode(params[key])}`)
    .join('&')

const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
const vnTime = (date = new Date()) => new Date(date.getTime() + 7 * 3600_000).toISOString().replace(/\D/g, '').slice(0, 14)

/**
 * @param {{ port: number, tmnCode: string, secret: string, ipnUrl: string }} options
 */
export function startFakeVnpay({ port, tmnCode, secret, ipnUrl }) {
  const hmac = (data) => createHmac('sha512', secret).update(data, 'utf8').digest('hex')
  const signFields = (values) => hmac(values.map((v) => (v === undefined || v === null ? '' : String(v))).join('|'))
  /** txnRef → { amount (×100), status: '00' | '02', transactionNo, payDate } */
  const transactions = new Map()
  let serial = Date.now()

  function verified(searchParams) {
    const params = {}
    for (const [key, value] of searchParams) if (key.startsWith('vnp_') && key !== 'vnp_SecureHash') params[key] = value
    return { params, valid: hmac(signedQuery(params)) === searchParams.get('vnp_SecureHash') }
  }

  function page(res, status, body) {
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(`<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>VNPay giả (E2E)</title></head>
<body style="font-family:sans-serif;max-width:480px;margin:40px auto">${body}</body></html>`)
  }

  function payPage(res, url) {
    const { params, valid } = verified(url.searchParams)
    if (!valid || params.vnp_TmnCode !== tmnCode) return page(res, 400, '<h1>Sai chữ ký</h1>') // VNPay: code 70
    const amount = Number(params.vnp_Amount) / 100
    return page(
      res,
      200,
      `<h1>Cổng VNPay giả</h1>
<p>${escapeHtml(params.vnp_OrderInfo)}</p>
<p>Số tiền: <strong>${amount.toLocaleString('vi-VN')} VND</strong></p>
<form action="/pay" method="get">
  <input type="hidden" name="q" value="${escapeHtml(url.search.slice(1))}">
  <button name="result" value="00">Thanh toán</button>
  <button name="result" value="24">Hủy giao dịch</button>
</form>`,
    )
  }

  async function pay(res, url) {
    const original = new URLSearchParams(url.searchParams.get('q') ?? '')
    const { params: request, valid } = verified(original)
    if (!valid) return page(res, 400, '<h1>Sai chữ ký</h1>')
    const paid = url.searchParams.get('result') === '00'
    const transactionNo = paid ? String(serial++) : '0'
    const payDate = vnTime()
    transactions.set(request.vnp_TxnRef, { amount: request.vnp_Amount, status: paid ? '00' : '02', transactionNo, payDate })

    const result = {
      vnp_Amount: request.vnp_Amount,
      vnp_BankCode: 'NCB',
      vnp_BankTranNo: paid ? `VNP${transactionNo}` : '',
      vnp_CardType: 'ATM',
      vnp_OrderInfo: request.vnp_OrderInfo,
      vnp_PayDate: payDate,
      vnp_ResponseCode: paid ? '00' : '24',
      vnp_TmnCode: tmnCode,
      vnp_TransactionNo: transactionNo,
      vnp_TransactionStatus: paid ? '00' : '02',
      vnp_TxnRef: request.vnp_TxnRef,
    }
    const query = `${signedQuery(result)}&vnp_SecureHash=${hmac(signedQuery(result))}`
    // Like VNPay: the IPN first (the API answers {RspCode}), then the customer goes back.
    try {
      await fetch(`${ipnUrl}?${query}`)
    } catch {
      // the API decides from querydr when the customer is back
    }
    res.writeHead(302, { Location: `${request.vnp_ReturnUrl}?${query}` })
    res.end()
  }

  function api(body) {
    const tx = transactions.get(body.vnp_TxnRef)
    if (body.vnp_Command === 'querydr') {
      if (!tx) return { vnp_ResponseCode: '91', vnp_Message: 'Not found' }
      const data = {
        vnp_ResponseId: String(serial++),
        vnp_Command: 'querydr',
        vnp_ResponseCode: '00',
        vnp_Message: 'QueryDR Success',
        vnp_TmnCode: tmnCode,
        vnp_TxnRef: body.vnp_TxnRef,
        vnp_Amount: tx.amount,
        vnp_BankCode: 'NCB',
        vnp_PayDate: tx.payDate,
        vnp_TransactionNo: tx.transactionNo,
        vnp_TransactionType: '01',
        vnp_TransactionStatus: tx.status,
        vnp_OrderInfo: body.vnp_OrderInfo,
        vnp_PromotionCode: '',
        vnp_PromotionAmount: '',
      }
      data.vnp_SecureHash = signFields([
        data.vnp_ResponseId, data.vnp_Command, data.vnp_ResponseCode, data.vnp_Message, data.vnp_TmnCode, data.vnp_TxnRef,
        data.vnp_Amount, data.vnp_BankCode, data.vnp_PayDate, data.vnp_TransactionNo, data.vnp_TransactionType,
        data.vnp_TransactionStatus, data.vnp_OrderInfo, data.vnp_PromotionCode, data.vnp_PromotionAmount,
      ])
      return data
    }
    if (body.vnp_Command === 'refund') {
      const data = {
        vnp_ResponseId: String(serial++),
        vnp_Command: 'refund',
        vnp_ResponseCode: tx?.status === '00' ? '00' : '91',
        vnp_Message: 'Refund',
        vnp_TmnCode: tmnCode,
        vnp_TxnRef: body.vnp_TxnRef,
        vnp_Amount: body.vnp_Amount,
        vnp_BankCode: 'NCB',
        vnp_PayDate: vnTime(),
        vnp_TransactionNo: String(serial++),
        vnp_TransactionType: body.vnp_TransactionType,
        vnp_TransactionStatus: '05',
        vnp_OrderInfo: body.vnp_OrderInfo,
      }
      data.vnp_SecureHash = signFields([
        data.vnp_ResponseId, data.vnp_Command, data.vnp_ResponseCode, data.vnp_Message, data.vnp_TmnCode, data.vnp_TxnRef,
        data.vnp_Amount, data.vnp_BankCode, data.vnp_PayDate, data.vnp_TransactionNo, data.vnp_TransactionType,
        data.vnp_TransactionStatus, data.vnp_OrderInfo,
      ])
      return data
    }
    return { vnp_ResponseCode: '99', vnp_Message: 'Unknown command' }
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`)
    if (req.method === 'GET' && url.pathname === '/paymentv2/vpcpay.html') return payPage(res, url)
    if (req.method === 'GET' && url.pathname === '/pay') return void pay(res, url)
    if (req.method === 'POST' && url.pathname === '/merchant_webapi/api/transaction') {
      let raw = ''
      req.on('data', (chunk) => {
        raw += chunk
      })
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(api(JSON.parse(raw))))
      })
      return undefined
    }
    res.writeHead(404).end()
    return undefined
  })
  // No host: IPv4 and IPv6 ("localhost" may be either), like the API.
  return new Promise((resolve) => server.listen(port, () => resolve(server)))
}
