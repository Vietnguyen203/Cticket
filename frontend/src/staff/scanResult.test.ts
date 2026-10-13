import { describe, expect, test } from 'vitest'
import { ApiError } from '../api/errors'
import { createScanGate, toScanOutcome } from './scanResult'

const fail = (code: string, details?: unknown) => toScanOutcome({ ok: false, error: new ApiError(409, code, code, details) })

describe('scan outcome', () => {
  test('green: what to check, and the count', () => {
    const outcome = toScanOutcome({
      ok: true,
      data: {
        checkIn: { id: 'c', checkedInAt: '2026-11-07T12:05:00Z', deviceId: 'A' },
        ticket: { id: 't', code: 'TKT-ABC', ticketTypeName: 'VIP', seatLabel: 'Khu A - A05', admissionNo: 1, status: 'USED' },
        event: { id: 'e', title: 'Show' },
        schedule: { id: 's', startAt: '2026-11-07T12:30:00Z' },
        stats: { total: 120, checkedIn: 37 },
      },
    })
    expect(outcome).toEqual({ ok: true, title: 'Mời vào', lines: ['VIP · Khu A - A05', 'TKT-ABC', 'Đã vào 37 / 120'] })
  })

  test('red with the reason the API gives', () => {
    const used = fail('TICKET_ALREADY_USED', { checkedInAt: '2026-11-07T12:05:00Z', deviceId: 'Cổng A', staffName: 'Lan' })
    expect(used.ok).toBe(false)
    expect(used.title).toBe('Vé đã được sử dụng')
    expect(used.lines).toEqual(['Đã vào lúc 19:05', 'Tại: Cổng A', 'Nhân viên: Lan'])
    expect(fail('TICKET_NOT_VALID', { status: 'REFUNDED' }).lines).toEqual(['Vé đã được hoàn tiền.'])
    expect(fail('QR_INVALID').title).toBe('Mã QR không hợp lệ')
    expect(fail('SOMETHING_ELSE').title).toBe('Không kiểm tra được vé')
  })
})

describe('scan gate', () => {
  test('the same code is handled once per 3 seconds; another code at once', () => {
    const gate = createScanGate(3000)
    expect(gate.accept('A', 0)).toBe(true)
    expect(gate.accept('A', 1000)).toBe(false)
    expect(gate.accept('B', 1100)).toBe(true)
    expect(gate.accept('A', 1200)).toBe(true)
    expect(gate.accept('A', 3000)).toBe(false)
    expect(gate.accept('A', 4300)).toBe(true)
  })
})
