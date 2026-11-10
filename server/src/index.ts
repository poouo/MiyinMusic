import http from 'node:http'
import { config, ensureDirs } from './config.js'
import { logger } from './log.js'
import { handleApi } from './routes.js'
import { serveStatic } from './static.js'
import { notFound, sendError } from './http-util.js'
import { sourceManager } from './lx/manager.js'
import { flushLibraries } from './library.js'
import { closeDb, getDb } from './db.js'
import * as audioCache from './audio-cache.js'
import { migrateLegacyData } from './migrate.js'
import { getAppConfig } from './app-config.js'
import { pruneGuard } from './login-guard.js'
import { HttpError } from './errors.js'

const log = logger('server')

process.on('unhandledRejection', (reason) => {
  // 音源脚本里的异步异常不应让整个服务崩溃
  log.debug('未处理的 Promise 拒绝：', reason instanceof Error ? reason.message : reason)
})
process.on('uncaughtException', (err) => {
  log.error('未捕获异常：', err)
})

async function main(): Promise<void> {
  ensureDirs()
  getDb()
  migrateLegacyData()
  pruneGuard()
  getAppConfig()
  audioCache.init()

  const server = http.createServer((req, res) => {
    void handle(req, res)
  })

  server.keepAliveTimeout = 65_000
  server.headersTimeout = 70_000

  server.listen(config.port, config.host, () => {
    log.info('觅音已启动 → http://localhost:' + config.port)
    log.info('数据目录：' + config.dataDir)
  })

  // 后台加载内置音源，不阻塞首个请求
  void sourceManager.bootstrap().then(() => {
    const list = sourceManager.list()
    const ready = list.filter((s) => s.status === 'ready')
    log.info('音源加载完成：' + ready.length + '/' + list.length + ' 可用')
    audioCache.warmCollections(false)
  })

  // 音源来自 GitHub，脚本会持续更新：启动后先自动检查一次，之后每 6 小时同步
  if (config.autoUpdateSources) {
    const first = setTimeout(() => {
      if (!sourceManager.getUpdateState().running) {
        log.info('开始自动更新音源脚本…')
        sourceManager.startUpdate()
      }
    }, 3 * 60 * 1000)
    first.unref?.()
    const timer = setInterval(() => {
      if (!sourceManager.getUpdateState().running) sourceManager.startUpdate()
    }, 6 * 60 * 60 * 1000)
    timer.unref?.()
  }

  const shutdown = (signal: string) => {
    log.info('收到 ' + signal + '，正在退出…')
    sourceManager.dispose()
    flushLibraries()
    closeDb()
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 3000).unref()
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const started = Date.now()
  try {
    const host = req.headers.host ?? 'localhost'
    const url = new URL(req.url ?? '/', 'http://' + host)
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'same-origin')
    // 反爬：告诉搜索引擎不要索引，避免被批量采集
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet')

    if (url.pathname === '/robots.txt') {
      const body = Buffer.from('User-agent: *\nDisallow: /\n')
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': body.length })
      res.end(body)
      return
    }

    if (url.pathname.startsWith('/api/')) {
      const handled = await handleApi(req, res, url)
      if (!handled) notFound(res)
      if (process.env.MIYIN_DEBUG === '1') {
        log.debug(req.method, url.pathname, res.statusCode, Date.now() - started + 'ms')
      }
      return
    }

    await serveStatic(req, res, url.pathname)
  } catch (err) {
    if (res.headersSent) {
      res.end()
      return
    }
    if (err instanceof HttpError) {
      sendError(res, err.status, err.message, err.code)
      return
    }
    const message = err instanceof Error ? err.message : String(err)
    log.warn('请求失败：', req.method, (req.url ?? '/').split('?')[0], message)
    sendError(res, 500, message)
  }
}

main().catch((err) => {
  log.error('启动失败：', err)
  process.exit(1)
})
