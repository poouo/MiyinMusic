import type { Song } from './types.js'
import type { UserLibrary } from './library.js'
import { providers } from './providers/index.js'
import { getNewSongs } from './discover.js'

export function preferenceSeeds(library: Pick<UserLibrary, 'favorites' | 'history'>) {
  const scores = new Map<string, { platform: Song['platform']; name: string; score: number; reason: string }>()
  for (const [songs, weight, reason] of [[library.favorites.slice(0, 100).map(entry => entry.song), 3, '你喜欢'], [library.history.slice(0, 50).map(entry => entry.song), 1, '你最近听过']] as const) {
    for (const song of songs) for (const name of song.singer.split(/[、,&/]/).map(value => value.trim()).filter(Boolean).slice(0, 4)) {
      const key = song.platform + ':' + name
      const item = scores.get(key) ?? { platform: song.platform, name, score: 0, reason }
      item.score += weight; scores.set(key, item)
    }
  }
  return [...scores.values()].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).slice(0, 3)
}
const cache = new Map<string, { until: number; result: { song: Song; reason: string }[] }>()
export async function recommendations(library: UserLibrary | null, owner: string) {
  const seeds = library ? preferenceSeeds(library) : []
  const key = owner + ':' + JSON.stringify(seeds) + ':' + library?.favorites.map(entry => entry.song.platform + entry.song.songmid).join(',')
  const cached = cache.get(key)
  if (cached && cached.until > Date.now()) return cached.result
  const seen = new Set(library?.favorites.map(entry => entry.song.platform + '_' + entry.song.songmid))
  const groups = await Promise.all(seeds.map(async seed => {
    try {
      const result = await providers[seed.platform].search(seed.name, 1, 30)
      return result.list.filter(song => song.singer.split(/[、,&/]/).some(name => name.trim() === seed.name)).map(song => ({ song, reason: `${seed.reason} ${seed.name}` }))
    } catch { return [] }
  }))
  const result: { song: Song; reason: string }[] = []
  for (let index = 0; index < 30 && result.length < 20; index++) for (const group of groups) {
    const entry = group[index]; if (!entry) continue
    const key = entry.song.platform + '_' + entry.song.songmid
    if (seen.has(key)) continue
    seen.add(key); result.push(entry)
    if (result.length === 20) break
  }
  if (!result.length) for (const song of await getNewSongs(12).catch(() => [])) result.push({ song, reason: seeds.length ? '偏好候选暂不可用，看看新歌' : '还没有听歌偏好，先听新歌' })
  if (cache.size >= 128) cache.delete(cache.keys().next().value!)
  cache.set(key, { until: Date.now() + 120000, result })
  return result
}
