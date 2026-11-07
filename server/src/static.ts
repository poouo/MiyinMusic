import fs from 'node:fs'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { config } from './config.js'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
}

function filePathFor(pathname: string): string | null {
  const decoded = decodeURIComponent(pathname)
  const normalized = path
    .normalize(decoded)
    .replace(/^([/\\])+/, '')
    .replace(/\.\.(\/|\\|$)/g, '')
  const target = path.join(config.webDist, normalized)
  if (!target.startsWith(config.webDist)) return null
  return target
}

export async function serveStatic(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
  if (!fs.existsSync(config.webDist)) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(
      '<!doctype html><meta charset="utf-8"><title>觅音</title>' +
        '<body style="font-family:system-ui;padding:48px;background:#0b0d12;color:#e9ecf5">' +
        '<h1>觅音服务已启动</h1>' +
        '<p>前端尚未构建。开发模式请访问 <code>http://localhost:5173</code>，或运行 <code>npm run build</code> 后刷新。</p>' +
        '<p>API 健康检查：<a style="color:#8aa2ff" href="/api/health">/api/health</a></p>' +
        '</body>',
    )
    return
  }

  const candidate = pathname === '/' ? null : filePathFor(pathname)
  let file = candidate && fs.existsSync(candidate) && fs.statSync(candidate).isFile() ? candidate : null
  if (!file) {
    // SPA 回退
    file = path.join(config.webDist, 'index.html')
    if (!fs.existsSync(file)) {
      res.writeHead(404).end('not found')
      return
    }
  }

  const ext = path.extname(file).toLowerCase()
  const isHtml = ext === '.html'
  const stat = fs.statSync(file)
  const etag = '"' + stat.size.toString(16) + '-' + Math.floor(stat.mtimeMs).toString(16) + '"'
  const isAsset = /\.[0-9a-f]{8,}\.(js|css|woff2?)$/.test(file)

  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { ETag: etag }).end()
    return
  }

  const headers: Record<string, string | number> = {
    'Content-Type': MIME[ext] ?? 'application/octet-stream',
    'Content-Length': stat.size,
    ETag: etag,
    'Cache-Control': isAsset ? 'public, max-age=31536000, immutable' : isHtml ? 'no-cache' : 'public, max-age=3600',
  }
  res.writeHead(200, headers)
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  fs.createReadStream(file).pipe(res)
}
