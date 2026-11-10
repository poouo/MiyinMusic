import type { IncomingMessage, ServerResponse } from 'node:http'
import * as devices from './device-auth.js'
import { sendJson, readJson } from './http-util.js'
import { HttpError } from './errors.js'
import { deviceOpenApi } from './device-openapi.js'
import { executeDeviceOperation } from './device-service.js'
import { handleDeviceMcp } from './device-mcp.js'

/** This namespace accepts only device Bearer keys, never browser session cookies. */
export async function handleDeviceApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  if (!url.pathname.startsWith('/api/v1/')) return false
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Referrer-Policy', 'no-referrer')
  const path = url.pathname.slice('/api/v1'.length), method = (req.method ?? 'GET').toUpperCase()
  try {
    if (path === '/openapi.json' && method === 'GET') { sendJson(res, 200, deviceOpenApi); return true }
    const identity = devices.authenticate(req)
    devices.rateLimit(identity)
    if (path === '/mcp') { await handleDeviceMcp(req, res, identity); return true }
    const body = method === 'POST' ? await readJson(req, 64 * 1024) : undefined
    sendJson(res, 200, await executeDeviceOperation(identity, path, method, url.searchParams, body))
    return true
  } catch (error) {
    if (!res.headersSent && error instanceof HttpError && error.status === 429) res.setHeader('Retry-After', '60')
    if (!res.headersSent && error instanceof HttpError && error.status === 401) res.setHeader('WWW-Authenticate', 'Bearer realm="Miyin Device API"')
    throw error
  }
}
