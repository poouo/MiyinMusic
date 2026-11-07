import { logger } from './log.js'

const log = logger('http')

export interface RequestOptions {
  method?: string
  headers?: Record<string, string>
  /** 对象会被 JSON 序列化 */
  body?: unknown
  /** 会以 application/x-www-form-urlencoded 发送 */
  form?: Record<string, unknown>
  timeoutMs?: number
  retries?: number
  binary?: boolean
  redirect?: 'follow' | 'error' | 'manual'
  signal?: AbortSignal
}

export interface ClientResponse {
  status: number
  ok: boolean
  headers: Headers
  buffer: Buffer
  text: string
  json: any
}

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

function encodeForm(form: Record<string, unknown>): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(form)) {
    if (v == null) continue
    p.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v))
  }
  return p.toString()
}

/** 宽松 JSON 解析：兼容单引号、非法控制字符、JSONP 包裹 */
export function parseJsonLoose<T = any>(input: string): T | null {
  if (!input) return null
  const text = input.trim()
  try {
    return JSON.parse(text) as T
  } catch {
    /* ignore */
  }
  // 去掉 JSONP 包裹
  const jsonp = /^[\w$.]+\(([\s\S]*)\)\s*;?$/.exec(text)
  if (jsonp) {
    try {
      return JSON.parse(jsonp[1]) as T
    } catch {
      /* ignore */
    }
  }
  // 单引号 -> 双引号
  const fixed = text
    .replace(/\r?\n/g, ' ')
    .replace(/\t/g, ' ')
    .replace(/'((?:[^'\\]|\\.)*)'/g, (_m, inner: string) => JSON.stringify(inner.replace(/\\'/g, "'")))
    .replace(/,([\s}\]])/g, '$1')
  try {
    return JSON.parse(fixed) as T
  } catch {
    return null
  }
}

export async function request(url: string, options: RequestOptions = {}): Promise<ClientResponse> {
  const retries = options.retries ?? 1
  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await once(url, options)
    } catch (err) {
      lastError = err
      if (options.signal?.aborted) throw err
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 180 * (attempt + 1)))
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

async function once(url: string, options: RequestOptions): Promise<ClientResponse> {
  const timeoutMs = options.timeoutMs ?? 15000
  const controller = new AbortController()
  const onAbort = () => controller.abort()
  options.signal?.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs)

  const headers: Record<string, string> = { 'User-Agent': DEFAULT_UA, ...options.headers }
  let body: string | undefined
  if (options.body !== undefined) {
    if (typeof options.body === 'string') body = options.body
    else {
      body = JSON.stringify(options.body)
      if (!hasHeader(headers, 'content-type')) headers['Content-Type'] = 'application/json'
    }
  } else if (options.form) {
    body = encodeForm(options.form)
    if (!hasHeader(headers, 'content-type')) headers['Content-Type'] = 'application/x-www-form-urlencoded'
  }

  const started = Date.now()
  try {
    const res = await fetch(url, {
      method: options.method ?? (body ? 'POST' : 'GET'),
      headers,
      body,
      signal: controller.signal,
      redirect: options.redirect ?? 'follow',
    })
    const buffer = Buffer.from(await res.arrayBuffer())
    const text = buffer.toString('utf8')
    const response: ClientResponse = {
      status: res.status,
      ok: res.ok,
      headers: res.headers,
      buffer,
      text,
      json: null,
    }
    const type = res.headers.get('content-type') ?? ''
    if (type.includes('json') || /^[\s]*[[{]/.test(text)) {
      response.json = parseJsonLoose(text)
    }
    if (process.env.MIYIN_DEBUG === '1') {
      log.debug((options.method ?? 'GET'), url, res.status, Date.now() - started + 'ms')
    }
    return response
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', onAbort)
  }
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  const lower = name.toLowerCase()
  return Object.keys(headers).some((k) => k.toLowerCase() === lower)
}

export function decodeHtmlEntities(text: string): string {
  if (!text) return ''
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, code: string) => String.fromCharCode(parseInt(code, 16)))
}

/** 秒 -> mm:ss */
export function formatInterval(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0
  return Math.round(seconds)
}

export function sizeText(bytes: number | string): string {
  const n = Number(bytes)
  if (!Number.isFinite(n) || n <= 0) return ''
  if (n >= 1024 * 1024 * 1024) return (n / 1024 / 1024 / 1024).toFixed(1) + 'GB'
  if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + 'MB'
  if (n >= 1024) return (n / 1024).toFixed(0) + 'KB'
  return n + 'B'
}
