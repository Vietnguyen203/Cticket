const { refundTerms } = require('../../src/modules/payments/refund-policy');

const HOUR = 60 * 60 * 1000;
const now = new Date('2026-10-15T03:00:00Z');
const startIn = (hours) => new Date(now.getTime() + hours * HOUR);
const terms = (policy, hours, paidAmount = 2_000_000) => refundTerms({ policy, startAt: startIn(hours), paidAmount, now });

describe('refund policy tiers (Phase 18.3)', () => {
  test('Tiêu chuẩn: ≥ 7 days 80%, 3–7 days 50%, then no cancelling; each tier includes its boundary', () => {
    expect(terms('STANDARD', 30 * 24)).toMatchObject({ allowed: true, percent: 80, refundAmount: 1_600_000, fee: 400_000 });
    expect(terms('STANDARD', 7 * 24)).toMatchObject({ percent: 80 });
    expect(terms('STANDARD', 7 * 24 - 0.001)).toMatchObject({ percent: 50, refundAmount: 1_000_000, fee: 1_000_000 });
    expect(terms('STANDARD', 3 * 24)).toMatchObject({ percent: 50 });
    expect(terms('STANDARD', 3 * 24 - 0.001)).toEqual({ allowed: false, reason: 'TOO_LATE' });
  });

  test('Linh hoạt: ≥ 48 h everything back, 24–48 h half, then no cancelling', () => {
    expect(terms('FLEXIBLE', 48)).toMatchObject({ percent: 100, refundAmount: 2_000_000, fee: 0 });
    expect(terms('FLEXIBLE', 30)).toMatchObject({ percent: 50 });
    expect(terms('FLEXIBLE', 23)).toEqual({ allowed: false, reason: 'TOO_LATE' });
  });

  test('Không hoàn (and an unknown policy): never', () => {
    expect(terms('NONE', 1000)).toEqual({ allowed: false, reason: 'NO_REFUND_POLICY' });
    expect(terms('WHATEVER', 1000)).toEqual({ allowed: false, reason: 'NO_REFUND_POLICY' });
  });

  test('rounded down to the đồng; the tier ends when the next one starts; a 0đ order', () => {
    expect(terms('STANDARD', 10 * 24, 99_999)).toMatchObject({ refundAmount: 79_999, fee: 20_000 });
    expect(terms('STANDARD', 10 * 24).tierEndsAt).toEqual(startIn(10 * 24 - 7 * 24));
    expect(terms('STANDARD', 10 * 24, 0)).toMatchObject({ allowed: true, refundAmount: 0, fee: 0 });
  });
});
