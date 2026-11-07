import type { Quality } from '../types.js'

const QUALITY_RANK: Record<Quality, number> = { flac24bit: 4, flac: 3, '320k': 2, '128k': 1 }

export function sortQualities(list: Quality[]): Quality[] {
  return Array.from(new Set(list)).sort((a, b) => QUALITY_RANK[b] - QUALITY_RANK[a])
}

export function text(value: unknown): string {
  if (value == null) return ''
  return String(value).trim()
}

export function toSeconds(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0
}

/** 从 "mm:ss" 或毫秒数转换为秒 */
export function parseInterval(value: unknown): number {
  if (typeof value === 'number') return value > 1000 ? Math.round(value / 1000) : Math.round(value)
  const str = text(value)
  if (!str) return 0
  if (/^\d+$/.test(str)) {
    const n = Number(str)
    return n > 1000 ? Math.round(n / 1000) : n
  }
  const parts = str.split(':').map((p) => Number(p) || 0)
  let total = 0
  for (const part of parts) total = total * 60 + part
  return Math.round(total)
}

export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '00:00'
  const total = Math.round(seconds)
  const m = Math.floor(total / 60)
  const s = total % 60
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0')
}

/** 毫秒 -> [mm:ss.xx] */
export function lrcTime(ms: number): string {
  const total = Math.max(0, Math.round(ms))
  const m = Math.floor(total / 60000)
  const s = Math.floor((total % 60000) / 1000)
  const cs = Math.floor((total % 1000) / 10)
  return '[' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0') + '.' + String(cs).padStart(2, '0') + ']'
}

export function stripWordTags(line: string): string {
  return line.replace(/<[^>]*>/g, '').replace(/\(\d+,\d+(?:,\d+)?\)/g, '')
}

/** 规范化歌词文本：统一换行、去掉逐字标记、裁剪空行 */
export function normalizeLrc(input: string): string {
  if (!input) return ''
  const lines = input.replace(/\r\n?/g, '\n').split('\n')
  const out: string[] = []
  for (const raw of lines) {
    const line = stripWordTags(raw).trimEnd()
    if (!line) continue
    if (/^\[\d{1,2}:\d{1,2}(?:[.:]\d{1,3})?\]/.test(line) || /^\[[a-zA-Z]+:/.test(line)) {
      out.push(line)
    }
  }
  return out.join('\n')
}

/** 把 LRC 文本拆成 [时间, 文本] 数组 */
export interface LrcLine {
  time: number
  text: string
}

export function parseLrc(input: string): LrcLine[] {
  if (!input) return []
  const result: LrcLine[] = []
  for (const raw of input.replace(/\r\n?/g, '\n').split('\n')) {
    const re = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g
    let match: RegExpExecArray | null
    const times: number[] = []
    let lastIndex = 0
    while ((match = re.exec(raw))) {
      const m = Number(match[1])
      const s = Number(match[2])
      const frac = match[3] ? Number('0.' + match[3]) : 0
      times.push(m * 60 + s + frac)
      lastIndex = re.lastIndex
    }
    if (!times.length) continue
    const content = raw.slice(lastIndex).replace(/<[^>]*>/g, '').trim()
    if (!content) continue
    for (const time of times) result.push({ time, text: content })
  }
  return result.sort((a, b) => a.time - b.time)
}

/** 解析酷我 N_MINFO / MINFO 中的音质信息 */
export function parseKwMinfo(minfo: string): Quality[] {
  const result: Quality[] = []
  if (!minfo) return result
  for (const segment of minfo.split(';')) {
    const m = /bitrate:(\d+),format:([a-zA-Z0-9]+)/.exec(segment)
    if (!m) continue
    const bitrate = Number(m[1])
    const format = m[2].toLowerCase()
    if (format === 'mp3') {
      if (bitrate >= 320) result.push('320k')
      else if (bitrate >= 128) result.push('128k')
    } else if (format === 'flac') {
      if (bitrate > 2000) continue
      result.push('flac')
    }
  }
  return sortQualities(result)
}

const KRC_KEY = Buffer.from([0x40, 0x47, 0x61, 0x77, 0x5e, 0x32, 0x74, 0x47, 0x51, 0x36, 0x31, 0x2d, 0xce, 0xd2, 0x6e, 0x69])

/** KRC 内容（base64）-> KRC 明文 XML 风格文本 */
export function decodeKrcContent(base64: string, inflate: (buf: Buffer) => Buffer): string {
  const raw = Buffer.from(base64, 'base64')
  if (raw.length <= 4) return ''
  const body = raw.subarray(4)
  const out = Buffer.alloc(body.length)
  for (let i = 0; i < body.length; i++) out[i] = body[i] ^ KRC_KEY[i % KRC_KEY.length]
  try {
    return inflate(out).toString('utf8')
  } catch {
    return ''
  }
}

/** KRC 明文 -> 普通 LRC */
export function krcToLrc(krc: string): string {
  if (!krc) return ''
  const out: string[] = []
  for (const raw of krc.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const meta = /^\[([a-zA-Z]+):(.*)\]$/.exec(line)
    if (meta) {
      out.push('[' + meta[1] + ':' + meta[2] + ']')
      continue
    }
    const m = /^\[(\d+),(\d+)\](.*)$/.exec(line)
    if (!m) continue
    const start = Number(m[1])
    const words = m[3].replace(/<\d+,\d+,\d+>/g, '').replace(/<\d+,\d+>/g, '')
    out.push(lrcTime(start) + words)
  }
  return out.join('\n')
}

export function clampLimit(limit: unknown, fallback = 30, max = 100): number {
  const n = Number(limit)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.min(Math.floor(n), max)
}

export function clampPage(page: unknown): number {
  const n = Number(page)
  if (!Number.isFinite(n) || n <= 0) return 1
  return Math.floor(n)
}
