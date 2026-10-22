import { describe, expect, test } from 'vitest'
import { missingForEvent, missingForSchedule } from './missing'

const open = { title: false, categoryIds: false }

describe('missingForEvent', () => {
  test('a new event needs a title and a category', () => {
    expect(missingForEvent({ title: ' ', categoryIds: [] }, open)).toEqual(['tên sự kiện', 'ít nhất một danh mục'])
    expect(missingForEvent({ title: 'Đêm nhạc', categoryIds: ['c1'] }, open)).toEqual([])
  })

  test('a published event keeps its title and categories: they are not asked for (some older ones have none)', () => {
    expect(missingForEvent({ title: 'Đêm nhạc', categoryIds: [] }, { title: true, categoryIds: true })).toEqual([])
  })
})

describe('missingForSchedule', () => {
  test('names each missing part; the end time is optional', () => {
    expect(missingForSchedule({ venueId: '', date: '', start: '', end: '' }, false)).toEqual(['địa điểm', 'ngày diễn', 'giờ bắt đầu (HH:mm, 24 giờ)'])
    expect(missingForSchedule({ venueId: 'v1', date: '2026-11-20', start: '19:30', end: '' }, false)).toEqual([])
  })

  test('a typed time must be a 24-hour time', () => {
    expect(missingForSchedule({ venueId: 'v1', date: '2026-11-20', start: '25:00', end: '24:30' }, false)).toEqual([
      'giờ bắt đầu (HH:mm, 24 giờ)',
      'giờ kết thúc đúng dạng HH:mm (hoặc để trống)',
    ])
  })

  test('a new venue being entered must be finished first', () => {
    expect(missingForSchedule({ venueId: '', date: '2026-11-20', start: '19:00', end: '' }, true)).toEqual([
      'bấm "Xong, dùng địa điểm này" ở phần địa điểm mới',
    ])
  })
})
