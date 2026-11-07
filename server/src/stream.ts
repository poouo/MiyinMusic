import type { IncomingMessage, ServerResponse } from 'node:http'
import dns from 'node:dns/promises'
import net from 'node:net'
import { logger } from './log.js'

const log = logger('proxy')

const ALLOWED_IMAGE_TYPES = /^image\//
const MAX_REDIRECTS = 3

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number)
    const [a, b] = parts
    if (a === 10 || a === 127 || a === 0) return true
    if (a === 169 && b === 254) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 100 && b >= 64 && b <= 127) return true
    return false
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase()
    return lower === '::1' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80')
  }
  return true
}

/** 阻止访问内网地址，避免被当作探测内网的跳板 */
export async function assertPublicUrl(input: string): Promise<URL> {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new Error('地址无效')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('只支持 http/https 地址')
  if (url.username || url.password) throw new Error('地址不合法')
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.local')) throw new Error('地址不合法')
  if (net.isIP(host) && isPrivateIp(host)) throw new Error('地址不合法')
  if (!net.isIP(host)) {
    try {
      const records = await dns.lookup(host, { all: true })
      if (!records.length) throw new Error('域名解析失败')
      if (records.some((r) => isPrivateIp(r.address))) throw new Error('地址不合法')
    } catch (err) {
      if (err instanceof Error && err.message === '地址不合法') throw err
      throw new Error('域名解析失败')
    }
  }
  return url
}

function decodeTarget(encoded: string): string {
  try {
    return Buffer.from(encoded, 'base64url').toString('utf8')
  } catch {
    return ''
  }
}

export interface ProxyOptions {
  /** 只允许图片 */
  imageOnly?: boolean
  maxBytes?: number
  /** 缓存秒数 */
  cacheSeconds?: number
  timeoutMs?: number
  /** 作为附件下载时的文件名 */
  attachment?: string
  /** 是否透传 Range（下载时不需要） */
  allowRange?: boolean
}

/** 音频流代理：透传 Range，让 <audio> 可以拖动进度条 */
export async function proxyStream(
  req: IncomingMessage,
  res: ServerResponse,
  target: string,
  options: ProxyOptions = {},
): Promise<void> {
  if (!target) {
    res.writeHead(400).end('missing url')
    return
  }
  let url: URL
  try {
    url = await assertPublicUrl(target)
  } catch (err) {
    res.writeHead(400).end('invalid url')
    return
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 20000)
  // 注意：只能用 res 的 close 判断客户端断开，req 的 close 在请求体读完后就会触发
  res.on('close', () => {
    if (!res.writableFinished) controller.abort()
  })

  const headers: Record<string, string> = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: '*/*',
  }
  const range = options.allowRange === false ? undefined : req.headers.range
  if (range) headers.Range = range
  const referer = req.headers['x-proxy-referer']
  if (typeof referer === 'string' && referer) headers.Referer = referer

  let upstream: Response
  try {
    upstream = await fetch(url, { headers, signal: controller.signal, redirect: 'follow' })
  } catch (err) {
    clearTimeout(timer)
    if (!res.headersSent) res.writeHead(502).end('upstream error')
    return
  }

  if (options.imageOnly && upstream.ok) {
    const type = upstream.headers.get('content-type') ?? ''
    if (!ALLOWED_IMAGE_TYPES.test(type)) {
      clearTimeout(timer)
      upstream.body?.cancel().catch(() => undefined)
      res.writeHead(415).end('not an image')
      return
    }
  }

  const rawType = (upstream.headers.get('content-type') ?? '').toLowerCase()
  const looksBroken =
    upstream.status >= 400 ||
    (!options.imageOnly && (rawType.includes('json') || rawType.includes('html') || rawType.includes('text/plain')))
  if (looksBroken) {
    clearTimeout(timer)
    upstream.body?.cancel().catch(() => undefined)
    log.warn('音频上游返回不可播放内容：', url.host, upstream.status, rawType || 'unknown')
    if (!res.headersSent) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('音频暂时不可用')
    }
    return
  }

  const contentType = upstream.headers.get('content-type') ?? (options.imageOnly ? 'image/jpeg' : 'audio/mpeg')
  const outHeaders: Record<string, string> = {
    'Content-Type': contentType,
    'Accept-Ranges': 'bytes',
    'Cache-Control': options.cacheSeconds ? 'public, max-age=' + options.cacheSeconds : 'no-store',
  }
  if (options.attachment) {
    const ascii = options.attachment.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
    outHeaders['Content-Disposition'] =
      'attachment; filename="' + ascii + '"; filename*=UTF-8\'\'' + encodeURIComponent(options.attachment)
  }
  const length = upstream.headers.get('content-length')
  if (length) outHeaders['Content-Length'] = length
  const contentRange = upstream.headers.get('content-range')
  if (contentRange) outHeaders['Content-Range'] = contentRange
  const etag = upstream.headers.get('etag')
  if (etag) outHeaders.ETag = etag

  res.writeHead(upstream.status === 206 ? 206 : upstream.status, outHeaders)

  if (!upstream.body) {
    clearTimeout(timer)
    res.end()
    return
  }

  try {
    const reader = upstream.body.getReader()
    let sent = 0
    const maxBytes = options.maxBytes ?? 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      sent += value.length
      if (maxBytes && sent > maxBytes) {
        log.warn('响应超出大小限制，已截断：', url.host)
        break
      }
      if (!res.write(Buffer.from(value))) {
        await new Promise<void>((resolve) => res.once('drain', () => resolve()))
      }
    }
  } catch (err) {
    if (!res.writableEnded) res.end()
  } finally {
    clearTimeout(timer)
    upstream.body?.cancel().catch(() => undefined)
    if (!res.writableEnded) res.end()
  }
}

export { decodeTarget }