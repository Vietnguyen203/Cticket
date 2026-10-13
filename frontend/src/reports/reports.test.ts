import { describe, expect, test } from 'vitest'
import { toCsv } from './csv'
import { niceScale, percent, shortDate, shortVnd } from './numbers'

describe('CSV', () => {
  test('BOM, CRLF, quotes only when needed, numbers as plain integers', () => {
    const csv = toCsv([
      ['Sự kiện', 'Doanh thu'],
      ['Đêm nhạc "Mùa thu", Hà Nội', 4950000],
      [null, 0],
    ])
    expect(csv).toBe('﻿Sự kiện,Doanh thu\r\n"Đêm nhạc ""Mùa thu"", Hà Nội",4950000\r\n,0\r\n')
  })

  test('a text cell that Excel would run as a formula is neutralised', () => {
    expect(toCsv([['=HYPERLINK("http://evil")', '+1', '-2', '@SUM(A1)', 'An toàn']])).toBe(
      '﻿"\'=HYPERLINK(""http://evil"")",\'+1,\'-2,\'@SUM(A1),An toàn\r\n',
    )
    // negative NUMBERS stay numbers
    expect(toCsv([[-5]])).toBe('﻿-5\r\n')
  })
})

describe('chart numbers', () => {
  test('short money', () => {
    expect(shortVnd(0)).toBe('0')
    expect(shortVnd(350_000)).toBe('350 N')
    expect(shortVnd(1_250_000)).toBe('1,3 tr')
    expect(shortVnd(2_500_000_000)).toBe('2,5 tỷ')
  })

  test('a round top and 4 equal steps', () => {
    expect(niceScale(4_950_000)).toEqual({ top: 5_000_000, ticks: [0, 1_250_000, 2_500_000, 3_750_000, 5_000_000] })
    expect(niceScale(2_100_000).top).toBe(2_500_000)
    expect(niceScale(1_000_000).top).toBe(1_000_000)
    expect(niceScale(0).top).toBe(1)
  })

  test('percent and dates', () => {
    expect(percent(0.222)).toBe('22,2%')
    expect(percent(null)).toBe('—')
    expect(shortDate('2026-10-03')).toBe('03/10')
  })
})

describe('report days', () => {
  test('today is the Vietnamese day: 17:00 UTC is already tomorrow', async () => {
    const { vnToday } = await import('./dates')
    expect(vnToday(Date.parse('2026-03-01T16:59:00Z'))).toBe('2026-03-01')
    expect(vnToday(Date.parse('2026-03-01T17:00:00Z'))).toBe('2026-03-02')
  })

  test('quick ranges', async () => {
    const { presetRange } = await import('./dates')
    expect(presetRange('7d', '2026-03-02')).toEqual({ from: '2026-02-24', to: '2026-03-02' })
    expect(presetRange('month', '2026-03-02')).toEqual({ from: '2026-03-01', to: '2026-03-02' })
    expect(presetRange('lastMonth', '2026-03-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' })
  })
})
