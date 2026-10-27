import { describe, expect, test } from 'vitest'
import type { EventSummary } from '../api/types'
import { citiesOf, stockOf } from './stock'

describe('the stock badge of an event card', () => {
  test('sold out, almost (a fifth or 10 or fewer left), or nothing to say', () => {
    expect(stockOf({ total: 120, left: 0 })).toBe('SOLD_OUT')
    expect(stockOf({ total: 1000, left: 200 })).toBe('LOW')
    expect(stockOf({ total: 1000, left: 201 })).toBe(null)
    expect(stockOf({ total: 30, left: 10 })).toBe('LOW')
    expect(stockOf({ total: 120, left: 117 })).toBe(null)
  })

  test('no places counted (nothing on sale yet): no badge', () => {
    expect(stockOf(null)).toBe(null)
    expect(stockOf(undefined)).toBe(null)
    expect(stockOf({ total: 0, left: 0 })).toBe(null)
  })
})

describe('cities of the home page', () => {
  test('counted across events, most first, then by name', () => {
    const events = [{ cities: ['Hà Nội'] }, { cities: ['Đà Lạt', 'Hà Nội'] }, { cities: ['Cần Thơ'] }] as EventSummary[]
    expect(citiesOf(events)).toEqual([
      ['Hà Nội', 2],
      ['Cần Thơ', 1],
      ['Đà Lạt', 1],
    ])
  })
})
