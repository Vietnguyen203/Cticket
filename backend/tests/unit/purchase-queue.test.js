const { estimateWaitSeconds } = require('../../src/modules/purchase-queue/purchase-queue.service');

/** Phase 21: the rough wait shown on the waiting page. */
describe('estimateWaitSeconds', () => {
  test('groups of `capacity`, each about half a turn', () => {
    expect(estimateWaitSeconds({ place: 1, capacity: 100, sessionMinutes: 10 })).toBe(300);
    expect(estimateWaitSeconds({ place: 100, capacity: 100, sessionMinutes: 10 })).toBe(300);
    expect(estimateWaitSeconds({ place: 101, capacity: 100, sessionMinutes: 10 })).toBe(600);
    expect(estimateWaitSeconds({ place: 3, capacity: 1, sessionMinutes: 5 })).toBe(450);
  });

  test('nothing to wait for without a place', () => {
    expect(estimateWaitSeconds({ place: 0, capacity: 10, sessionMinutes: 10 })).toBe(0);
    expect(estimateWaitSeconds({ place: null, capacity: 10, sessionMinutes: 10 })).toBe(0);
  });
});
