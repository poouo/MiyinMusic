import { QUALITIES, type Quality } from './types.js'

/** Preserve explicit preferences. In particular, standard playback must not upgrade to lossless. */
export function qualityOrder(input: unknown, strict = false): Quality[] {
  const list = Array.isArray(input) ? input : []
  const order = [...new Set(list.filter((q): q is Quality => QUALITIES.includes(q as Quality)))]
  if (strict) return order
  return order.length ? order : ['320k', '128k']
}
