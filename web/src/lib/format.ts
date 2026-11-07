export function formatDuration(seconds?: number | null): string {
  const total = Math.round(Number(seconds) || 0)
  if (total <= 0) return '--:--'
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0')
  return m + ':' + String(s).padStart(2, '0')
}

export function formatCount(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return '0'
  if (count >= 100000000) return (count / 100000000).toFixed(1).replace(/\.0$/, '') + ' 亿'
  if (count >= 10000) return (count / 10000).toFixed(1).replace(/\.0$/, '') + ' 万'
  return String(count)
}

const TIME_TAG = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g

export interface ParsedLine {
  time: number
  text: string
}

export function parseLyric(raw: string): ParsedLine[] {
  if (!raw) return []
  const lines: ParsedLine[] = []
  for (const line of raw.replace(/\r\n?/g, '\n').split('\n')) {
    TIME_TAG.lastIndex = 0
    const times: number[] = []
    let match: RegExpExecArray | null
    let end = 0
    while ((match = TIME_TAG.exec(line))) {
      const m = Number(match[1])
      const s = Number(match[2])
      const frac = match[3] ? Number('0.' + match[3]) : 0
      times.push(m * 60 + s + frac)
      end = TIME_TAG.lastIndex
    }
    if (!times.length) continue
    const text = line.slice(end).replace(/<[^>]*>/g, '').trim()
    if (!text) continue
    for (const time of times) lines.push({ time, text })
  }
  return lines.sort((a, b) => a.time - b.time)
}

/** 合并翻译歌词，返回 Map<时间, 译文> */
export function parseTranslation(raw: string): Map<string, string> {
  const map = new Map<string, string>()
  if (!raw) return map
  for (const line of parseLyric(raw)) {
    map.set(line.time.toFixed(2), line.text)
  }
  return map
}

export function initials(name: string): string {
  const trimmed = (name || '').trim()
  if (!trimmed) return '♪'
  return Array.from(trimmed)[0].toUpperCase()
}

export function timeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp
  if (diff < 60_000) return '刚刚'
  if (diff < 3600_000) return Math.floor(diff / 60_000) + ' 分钟前'
  if (diff < 86400_000) return Math.floor(diff / 3600_000) + ' 小时前'
  if (diff < 30 * 86400_000) return Math.floor(diff / 86400_000) + ' 天前'
  return new Date(timestamp).toLocaleDateString('zh-CN')
}

export function coverSeed(key: string): number {
  let hash = 0
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) | 0
  return Math.abs(hash) % 360
}
