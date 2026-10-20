/**
 * Fitting a picture into the 16:9 frame events are shown in (cards, event
 * page), before upload. Pure geometry, in frame units (the frame is FRAME_W ×
 * FRAME_H whatever its size on screen): the dialog draws with it and the
 * canvas crops with it, so what is seen is what is uploaded.
 *
 * zoom 1 = the picture covers the frame (cropped on one side); below 1 down to
 * containZoom = the whole picture is visible (empty bands are filled by the
 * background); up to MAX_ZOOM = closer.
 */

export const FRAME_W = 1600
export const FRAME_H = 900
export const MAX_ZOOM = 3

export interface Fit {
  zoom: number
  /** Position of the picture's top-left corner in the frame (may be negative: cropped). */
  x: number
  y: number
}

export interface Placement {
  x: number
  y: number
  width: number
  height: number
}

/** How much smaller than "cover" the picture is when it is entirely visible (≤ 1). */
export function containZoom(imageW: number, imageH: number): number {
  const cover = Math.max(FRAME_W / imageW, FRAME_H / imageH)
  const contain = Math.min(FRAME_W / imageW, FRAME_H / imageH)
  return contain / cover
}

function size(imageW: number, imageH: number, zoom: number) {
  const scale = Math.max(FRAME_W / imageW, FRAME_H / imageH) * zoom
  return { width: imageW * scale, height: imageH * scale }
}

/**
 * Keep the picture where it makes sense: when it is bigger than the frame on
 * an axis, no empty band on that axis; when smaller, it stays inside the frame.
 */
function clampAxis(position: number, drawn: number, frame: number) {
  const low = Math.min(0, frame - drawn)
  const high = Math.max(0, frame - drawn)
  return Math.min(high, Math.max(low, position))
}

export function clampZoom(zoom: number, imageW: number, imageH: number) {
  return Math.min(MAX_ZOOM, Math.max(containZoom(imageW, imageH), zoom))
}

/** The picture centred at `zoom` (the starting point, and after "Lấp đầy" / "Hiện trọn ảnh"). */
export function centered(imageW: number, imageH: number, zoom = 1): Fit {
  const z = clampZoom(zoom, imageW, imageH)
  const { width, height } = size(imageW, imageH, z)
  return { zoom: z, x: (FRAME_W - width) / 2, y: (FRAME_H - height) / 2 }
}

export function placement(imageW: number, imageH: number, fit: Fit): Placement {
  const { width, height } = size(imageW, imageH, fit.zoom)
  return { x: clampAxis(fit.x, width, FRAME_W), y: clampAxis(fit.y, height, FRAME_H), width, height }
}

/** Dragged by (dx, dy) frame units. */
export function moveBy(imageW: number, imageH: number, fit: Fit, dx: number, dy: number): Fit {
  const moved = placement(imageW, imageH, { ...fit, x: fit.x + dx, y: fit.y + dy })
  return { zoom: fit.zoom, x: moved.x, y: moved.y }
}

/** A new zoom, keeping the point at the centre of the frame where it was. */
export function zoomTo(imageW: number, imageH: number, fit: Fit, zoom: number): Fit {
  const z = clampZoom(zoom, imageW, imageH)
  const before = placement(imageW, imageH, fit)
  const after = size(imageW, imageH, z)
  // The picture point under the frame centre, as a fraction of the picture.
  const fx = (FRAME_W / 2 - before.x) / before.width
  const fy = (FRAME_H / 2 - before.y) / before.height
  const next = placement(imageW, imageH, { zoom: z, x: FRAME_W / 2 - fx * after.width, y: FRAME_H / 2 - fy * after.height })
  return { zoom: z, x: next.x, y: next.y }
}

/** Does the picture leave empty bands (then the background shows)? */
export function hasGaps(p: Placement): boolean {
  return p.x > 0.5 || p.y > 0.5 || p.x + p.width < FRAME_W - 0.5 || p.y + p.height < FRAME_H - 0.5
}
