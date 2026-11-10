import type { IncomingMessage, ServerResponse } from 'node:http'
import { HttpError } from './errors.js'
import net from 'node:net'

export function sendJson(res: ServerResponse, status: number, data: unknown): void {
  const body = Buffer.from(JSON.stringify(data))
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
  })
  res.end(body)
}

export function sendError(res: ServerResponse, status: number, message: string, code?: string): void {
  sendJson(res, status, { error: { message, code: code ?? 'error' } })
}

export function readBody(req: IncomingMessage, limit = 512 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) {
        reject(new HttpError(413, '请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

export async function readJson<T = Record<string, unknown>>(req: IncomingMessage, limit?: number): Promise<T> {
  const text = await readBody(req, limit)
  if (!text.trim()) return {} as T
  try {
    return JSON.parse(text) as T
  } catch {
    throw new HttpError(400, '请求体不是合法的 JSON')
  }
}

export function parseCookies(req: IncomingMessage): Record<string, string> {
  const header = req.headers.cookie
  const out: Record<string, string> = {}
  if (!header) return out
  for (const part of header.split(';')) {
    const index = part.indexOf('=')
    if (index < 0) continue
    const key = part.slice(0, index).trim()
    const value = part.slice(index + 1).trim()
    if (key) out[key] = decodeURIComponent(value)
  }
  return out
}

export function clientIp(req: IncomingMessage): string {
  const normalize = (ip: string) => ip.toLowerCase().replace(/^::ffff:(?=\d+\.)/, '')
  const remote = normalize(req.socket.remoteAddress ?? '')
  // Forwarded headers are authoritative only when every intervening proxy is trusted.
  const trusted = new net.BlockList()
  for (const entry of (process.env.MIYIN_TRUSTED_PROXIES ?? '').split(',').map(value => value.trim()).filter(Boolean)) {
    try {
      const [address, prefix] = entry.split('/')
      const family = net.isIP(address)
      if (!family) continue
      if (prefix === undefined) trusted.addAddress(address, family === 4 ? 'ipv4' : 'ipv6')
      else trusted.addSubnet(address, Number(prefix), family === 4 ? 'ipv4' : 'ipv6')
    } catch { /* Invalid proxy entries grant no trust. */ }
  }
  const isTrusted = (ip: string) => {
    const family = net.isIP(ip)
    return !!family && trusted.check(ip, family === 4 ? 'ipv4' : 'ipv6')
  }
  const forwarded = req.headers['x-forwarded-for']
  if (!isTrusted(remote) || typeof forwarded !== 'string' || forwarded.length > 2048) return remote || 'unknown'
  const chain = [...forwarded.split(',').map(value => normalize(value.trim())), remote]
  if (chain.some(ip => !net.isIP(ip))) return remote || 'unknown'
  let index = chain.length - 1
  while (index > 0 && isTrusted(chain[index])) index--
  return chain[index]
}

export function bearerToken(req: IncomingMessage): string | null {
  const header = req.headers.authorization
  if (typeof header === 'string' && header.startsWith('Bearer ')) return header.slice(7).trim()
  return null
}

export function setCookie(res: ServerResponse, name: string, value: string, maxAgeSeconds: number): void {
  const parts = [
    name + '=' + encodeURIComponent(value),
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=' + maxAgeSeconds,
  ]
  appendHeader(res, 'Set-Cookie', parts.join('; '))
}

export function clearCookie(res: ServerResponse, name: string): void {
  appendHeader(res, 'Set-Cookie', name + '=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0')
}

function appendHeader(res: ServerResponse, name: string, value: string): void {
  const current = res.getHeader(name)
  if (current === undefined) {
    res.setHeader(name, value)
  } else if (Array.isArray(current)) {
    res.setHeader(name, [...current, value])
  } else {
    res.setHeader(name, [String(current), value])
  }
}

export function notFound(res: ServerResponse): void {
  sendError(res, 404, '接口不存在', 'not_found')
}
