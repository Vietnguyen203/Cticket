/** Delay (ms) for the n-th item of a list that rises in: quick, capped so long lists do not lag. */
export const stagger = (index: number, step = 60, max = 360) => Math.min(index * step, max)
