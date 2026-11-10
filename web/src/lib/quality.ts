import type { Quality } from './types'

export const QUALITY_ORDER: Quality[] = ['flac24bit', 'flac', '320k', '128k']

/** Platform metadata is not always ordered. */
export function highestQuality(available?: Quality[]): Quality | null {
  return QUALITY_ORDER.find(quality => available?.includes(quality)) ?? null
}
