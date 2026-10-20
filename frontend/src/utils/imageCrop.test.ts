import { describe, expect, test } from 'vitest'
import { FRAME_H, FRAME_W, centered, containZoom, hasGaps, moveBy, placement, zoomTo } from './imageCrop'

// A square logo (like "X-OR") and a wide banner.
const SQUARE = [1000, 1000] as const
const WIDE = [3200, 900] as const

describe('fitting a picture into the 16:9 frame', () => {
  test('zoom 1 covers the frame, centred, cropping the long side', () => {
    const p = placement(...SQUARE, centered(...SQUARE))
    expect(p.width).toBe(FRAME_W)
    expect(p.height).toBe(FRAME_W) // the square is as wide as the frame
    expect(p.y).toBe((FRAME_H - FRAME_W) / 2) // top and bottom cropped equally
    expect(hasGaps(p)).toBe(false)
  })

  test('"show all": the whole picture fits, with bands at the sides', () => {
    const z = containZoom(...SQUARE)
    expect(z).toBeCloseTo(FRAME_H / FRAME_W)
    const p = placement(...SQUARE, centered(...SQUARE, z))
    expect(p.height).toBeCloseTo(FRAME_H)
    expect(p.x).toBeCloseTo((FRAME_W - FRAME_H) / 2)
    expect(hasGaps(p)).toBe(true)
  })

  test('zoom never goes below "show all" nor above 3', () => {
    expect(centered(...SQUARE, 0.1).zoom).toBeCloseTo(containZoom(...SQUARE))
    expect(centered(...SQUARE, 10).zoom).toBe(3)
  })

  test('dragging stops at the edges: a covering picture never uncovers the frame', () => {
    const start = centered(...WIDE) // wider than the frame: can move sideways only
    const farLeft = placement(...WIDE, moveBy(...WIDE, start, -10_000, 0))
    expect(farLeft.x).toBe(FRAME_W - farLeft.width)
    const farRight = placement(...WIDE, moveBy(...WIDE, start, 10_000, 500))
    expect(farRight.x).toBe(0)
    expect(farRight.y).toBe(0) // exactly as tall as the frame: no vertical move
    expect(hasGaps(farLeft) || hasGaps(farRight)).toBe(false)
  })

  test('a picture smaller than the frame stays inside it', () => {
    const fit = centered(...SQUARE, containZoom(...SQUARE))
    const p = placement(...SQUARE, moveBy(...SQUARE, fit, 5_000, 0))
    expect(p.x + p.width).toBeCloseTo(FRAME_W)
  })

  test('zooming keeps the point at the centre of the frame in place', () => {
    const fit = moveBy(...WIDE, centered(...WIDE), -400, 0)
    const before = placement(...WIDE, fit)
    const centreOnPicture = (FRAME_W / 2 - before.x) / before.width
    const after = placement(...WIDE, zoomTo(...WIDE, fit, 2))
    expect((FRAME_W / 2 - after.x) / after.width).toBeCloseTo(centreOnPicture)
  })
})
