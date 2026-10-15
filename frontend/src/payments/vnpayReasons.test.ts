import { describe, expect, test } from 'vitest'
import { vnpayReason } from './vnpayReasons'

describe('VNPay reasons', () => {
  test('known codes read as a sentence for the customer', () => {
    expect(vnpayReason('24')).toBe('Bạn đã hủy giao dịch trên VNPay.')
    expect(vnpayReason('51')).toBe('Tài khoản không đủ số dư.')
    expect(vnpayReason('02')).toBe('Giao dịch không thành công.') // after asking VNPay again
  })

  test('an unknown code keeps the code (for support); none at all gets the general sentence', () => {
    expect(vnpayReason('99')).toBe('VNPay không thực hiện được giao dịch. (mã 99)')
    expect(vnpayReason(null)).toBe('VNPay không thực hiện được giao dịch.')
    expect(vnpayReason(undefined)).toBe('VNPay không thực hiện được giao dịch.')
  })
})
