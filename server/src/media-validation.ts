import { fromBuffer, fromFile } from 'strtok3'
import { parseFromTokenizer, type IFormat } from 'music-metadata'
import { assertPublicUrl } from './stream.js'

export interface AudioInfo { duration?: number; mime?: string; lossless?: boolean; bits?: number }
function audioInfo(format: IFormat): AudioInfo {
  const container = (format.container ?? '').toLowerCase()
  const mime = container.includes('flac') ? 'audio/flac' : /m4a|mp4|isom|mpeg-4/.test(container) ? 'audio/mp4' :
    container.includes('mpeg') ? 'audio/mpeg' : container.includes('wave') ? 'audio/wav' :
    container.includes('ogg') ? 'audio/ogg' : 'application/octet-stream'
  return { duration: format.duration, mime, lossless: format.lossless, bits: format.bitsPerSample }
}
export function assertQuality(info: AudioInfo, quality: string): void {
  if ((quality === 'flac' || quality === 'flac24bit') && info.lossless === false) throw new Error('音源返回的有损音频与请求音质不符')
  if (quality === 'flac24bit' && info.bits && info.bits < 24) throw new Error('音源返回的音频未达到 Hi-Res 音质')
}
const PROBE_BYTES = 192 * 1024
const verified = new Map<string, { info: AudioInfo; expires: number }>()

export function assertComplete(info: AudioInfo, expected: number, requireDuration = false): void {
  const actual = info.duration
  if (!actual || !Number.isFinite(actual) || actual <= 0) {
    if (requireDuration) throw new Error('无法确认音频时长，跳过缓存')
    return
  }
  // Allow metadata rounding and different masters; reject previews and severe truncation.
  if (expected > 0 && actual < expected * .8 && expected - actual > 10) {
    throw new Error(`音频不完整（实际 ${Math.round(actual)} 秒，歌曲约 ${Math.round(expected)} 秒）`)
  }
}

export async function inspectFile(file: string): Promise<AudioInfo> {
  // Old cache extensions describe the requested quality, not the actual container.
  const tokenizer = await fromFile(file)
  tokenizer.fileInfo.path = undefined
  try {
    const { format } = await parseFromTokenizer(tokenizer, { duration: true, skipCovers: true, skipPostHeaders: true })
    return audioInfo(format)
  } finally { await tokenizer.close() }
}

/** Follow redirects only after validating each destination, including range probes. */
export async function fetchAudio(url: string, init: RequestInit = {}): Promise<Response> {
  let target = url
  for (let redirects = 0; redirects < 5; redirects++) {
    const safe = await assertPublicUrl(target)
    init.signal?.throwIfAborted()
    const response = await fetch(safe, { ...init, redirect: 'manual' })
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location')
      await response.body?.cancel()
      if (!location) throw new Error('音频重定向缺少地址')
      target = new URL(location, safe).href
      continue
    }
    return response
  }
  throw new Error('音频重定向次数过多')
}

async function range(url: string, start: number, signal: AbortSignal) {
  const response = await fetchAudio(url, {
    headers: { Range: `bytes=${start}-${start + PROBE_BYTES - 1}`, 'User-Agent': 'Mozilla/5.0', 'Accept-Encoding': 'identity' }, signal,
  })
  try {
    if (!response.ok) throw new Error('音频上游 HTTP ' + response.status)
    if (/json|html|text\//i.test(response.headers.get('content-type') ?? '')) throw new Error('上游返回了非音频内容')
    if (start > 0 && response.status !== 206) return { bytes: Buffer.alloc(0), size: 0 }
    const size = Number(response.headers.get('content-range')?.split('/')[1]) ||
      (response.status === 200 ? Number(response.headers.get('content-length')) : 0)
    const reader = response.body?.getReader()
    if (!reader) throw new Error('音频响应为空')
    const chunks: Buffer[] = []
    let length = 0
    try {
      while (length < PROBE_BYTES) {
        const { value, done } = await reader.read()
        if (done) break
        const chunk = Buffer.from(value.subarray(0, PROBE_BYTES - length))
        chunks.push(chunk); length += chunk.length
      }
    } finally { await reader.cancel().catch(() => {}) }
    if (!length) throw new Error('音频响应为空')
    return { bytes: Buffer.concat(chunks), size }
  } catch (error) {
    await response.body?.cancel().catch(() => {})
    throw error
  }
}

function movieDuration(bytes: Buffer): number | undefined {
  for (let offset = 0; offset + 8 <= bytes.length;) {
    const size = bytes.readUInt32BE(offset), kind = bytes.toString('ascii', offset + 4, offset + 8)
    if (size < 8) break
    if (kind === 'moov') return movieDuration(bytes.subarray(offset + 8, Math.min(offset + size, bytes.length)))
    if (kind === 'mvhd' && offset + 40 <= bytes.length) {
      const v1 = bytes[offset + 8] === 1
      const scale = bytes.readUInt32BE(offset + (v1 ? 28 : 20))
      const ticks = v1 ? Number(bytes.readBigUInt64BE(offset + 32)) : bytes.readUInt32BE(offset + 24)
      return scale > 0 ? ticks / scale : undefined
    }
    offset += size
  }
}

/** Small bounded range reads, never download a complete track to start playback. */
export async function probeAudio(url: string, signal: AbortSignal): Promise<AudioInfo> {
  const hit = verified.get(url)
  if (hit && hit.expires > Date.now()) return hit.info
  const timeout = AbortSignal.any([signal, AbortSignal.timeout(2500)])
  const { bytes, size } = await range(url, 0, timeout)
  let info: AudioInfo = {}
  let detected: IFormat | undefined
  try {
    const tokenizer = fromBuffer(bytes)
    tokenizer.supportsRandomAccess = () => false
    // Buffer tokenizers normally substitute the supplied buffer length. A range
    // is only a prefix; CBR/WAVE duration must use the complete response size.
    tokenizer.fileInfo.size = size || bytes.length
    const { format } = await parseFromTokenizer(tokenizer, {
      skipCovers: true, skipPostHeaders: true,
      observer: event => { if (event.tag.type === 'format') { detected = event.metadata.format; info = audioInfo(detected) } },
    })
    info = audioInfo(format)
  } catch { /* Some containers store metadata after the audio payload. */ }
  // The parser identifies CBR after several consistent MPEG frames. With no
  // ID3 tags it may seek the unavailable tail before finalizing its estimate.
  if (!info.duration && detected?.codecProfile === 'CBR' && detected.bitrate && size) {
    let offset = 0
    while (offset + 10 <= bytes.length && bytes.toString('ascii', offset, offset + 3) === 'ID3') {
      const n = bytes.subarray(offset + 6, offset + 10)
      offset += 10 + ((n[0] & 127) * 2097152 + (n[1] & 127) * 16384 + (n[2] & 127) * 128 + (n[3] & 127))
    }
    info.duration = (size - offset) * 8 / detected.bitrate
  }
  if (!info.duration && bytes.toString('ascii', 4, 8) === 'ftyp') {
    info.mime = 'audio/mp4'
    info.duration = movieDuration(bytes)
    // Jump over mdat using box lengths rather than downloading its contents.
    for (let offset = 0; !info.duration && offset + 8 <= bytes.length;) {
      const boxSize = bytes.readUInt32BE(offset)
      if (boxSize < 8) break
      offset += boxSize
      if (offset >= bytes.length && offset < size) {
        info.duration = movieDuration((await range(url, offset, timeout)).bytes)
        break
      }
    }
  }
  signal.throwIfAborted()
  if (verified.size >= 1000) verified.delete(verified.keys().next().value!)
  verified.set(url, { info, expires: Date.now() + 240000 })
  return info
}
