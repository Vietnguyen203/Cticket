import { describe, expect, test } from 'vitest'
import { initialsOf } from './initials'

describe('avatar initials of a guest artist', () => {
  test('first and last word; one word gives one letter; spaces and case do not matter', () => {
    expect(initialsOf('Hà Anh Tuấn')).toBe('HT')
    expect(initialsOf('  đen  ')).toBe('Đ')
    expect(initialsOf('Dàn nhạc Giao hưởng Việt Nam')).toBe('DN')
    expect(initialsOf('Đặng Thị Ngọc Hân')).toBe('ĐH')
    expect(initialsOf('Jo')).toBe('J')
    expect(initialsOf('J')).toBe('J')
  })

  test('Chinese characters: the first one', () => {
    expect(initialsOf('王菲')).toBe('王')
  })

  test('emoji and symbols are no initials', () => {
    expect(initialsOf('🎸 Ban nhạc Ngũ Cung')).toBe('BC')
    expect(initialsOf('Dàn nhạc (Sun Symphony Orchestra)')).toBe('DO') // the bracket is skipped, not a letter
    expect(initialsOf('🎸🎹')).toBe('🎸') // no letter at all: the first character
  })

  test('name suffixes are left out', () => {
    expect(initialsOf('Christopher Alexander Montgomery III')).toBe('CM')
    expect(initialsOf('Martin Luther King Jr.')).toBe('MK')
    expect(initialsOf('Ólafur Arnalds')).toBe('ÓA')
  })
})
