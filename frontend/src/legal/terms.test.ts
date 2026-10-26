import { describe, expect, test } from 'vitest'
import { REFUND_POLICIES } from '../payments/refundPolicy'
import { ARTICLES, articleNumber, LEGAL_BASES, TERMS_VERSION } from './terms'

describe('the terms of sale', () => {
  test('anchors are unique, and the articles other pages and clauses name keep their numbers', () => {
    expect(new Set(ARTICLES.map((a) => a.id)).size).toBe(ARTICLES.length)
    // Clauses say "Điều 5, Điều 6, Điều 7, Điều 12": moving an article must update them.
    expect(articleNumber('huy-va-hoan-tien')).toBe(5)
    expect(articleNumber('ban-to-chuc-huy')).toBe(6)
    expect(articleNumber('bat-kha-khang')).toBe(7)
    expect(articleNumber('tranh-chap')).toBe(12)
  })

  test('every legal basis links to its full text', () => {
    for (const basis of LEGAL_BASES) expect(basis.url, basis.law).toMatch(/^https:\/\/thuvienphapluat\.vn\/van-ban\/.+\.aspx$/)
  })

  test('the version is a date (the backend accepts only the same string)', () => {
    expect(TERMS_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  test('every refund policy has its tiers, the earliest first, as the API computes them', () => {
    expect(REFUND_POLICIES.map((p) => [p.value, p.tiers.map((t) => t.percent)])).toEqual([
      ['NONE', []],
      ['STANDARD', [80, 50]],
      ['FLEXIBLE', [100, 50]],
    ])
  })
})
