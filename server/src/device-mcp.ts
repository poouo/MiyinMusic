import type { IncomingMessage, ServerResponse } from 'node:http'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import * as z from 'zod/v4'
import * as devices from './device-auth.js'
import { executeDeviceOperation } from './device-service.js'
import { readJson, sendJson } from './http-util.js'
import { HttpError } from './errors.js'
import type { SearchResult } from './types.js'

const platform = z.enum(['kw', 'kg', 'tx', 'wy', 'mg']).default('wy').describe('歌曲平台：酷我、酷狗、QQ音乐、网易云、咪咕')
const quality = z.enum(['128k', '320k', 'flac', 'flac24bit']).default('320k').describe('设备期望音质；性能有限的硬件建议显式选择 128k')
const fallback = z.boolean().default(false).describe('true 才向下兼容低音质；false 或省略时音质不可用则报错')
const songJson = z.string().min(2).max(16000).describe('搜索或歌单返回的完整歌曲对象 JSON 字符串，保留平台专用字段')
const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }

function parseSong(value: string): unknown {
  try { return JSON.parse(value) }
  catch { throw new HttpError(400, 'song_json 必须是完整歌曲对象的 JSON 字符串', 'invalid_parameter') }
}

export function createDeviceMcp(identity: devices.DeviceIdentity): McpServer {
  const server = new McpServer({ name: 'miyin-music', version: '1.0.0' }, {
    instructions: '为当前用户搜索音乐、读取歌单及获取音源直链。音频由设备直接连接上游。获取直链不会自动控制或启动小智硬件播放；只有设备提供 URL 播放工具时才能交给该工具。不要声称设备已经开始播放。',
  })
  const run = async (operation: () => Promise<Record<string, unknown>>): Promise<CallToolResult> => {
    try {
      const result = await operation()
      return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result }
    } catch (error) {
      const result = { error: { code: error instanceof HttpError ? error.code : 'upstream_error',
        status: error instanceof HttpError ? error.status : 502,
        message: error instanceof HttpError ? error.message : '音乐接口暂时不可用，请稍后重试' } }
      return { isError: true, content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result }
    }
  }
  const operate = (path: string, method = 'GET', query?: URLSearchParams, body?: unknown) => executeDeviceOperation(identity, path, method, query, body)

  server.registerTool('miyin_account', { description: '查询当前用户权限、音质、设备密钥和下载直链次数用量', inputSchema: {}, annotations: readOnly },
    () => run(() => operate('/me')))
  if (identity.key.scopes.includes('search')) {
    server.registerTool('miyin_search_music', { description: '按歌曲名或歌手搜索音乐，返回歌曲对象供解析直链，不会播放歌曲',
      inputSchema: { query: z.string().min(1).max(100), platform, page: z.number().int().min(1).max(10000).default(1), limit: z.number().int().min(1).max(50).default(5) }, annotations: readOnly },
      ({ query, platform, page, limit }) => run(() => operate('/search', 'GET', new URLSearchParams({ q: query, platform, page: String(page), limit: String(limit) })) ))
  }
  if (identity.key.scopes.includes('playback')) {
    server.registerTool('miyin_get_playback_url', { description: '从歌曲对象获取可交给设备播放器的音乐直链，服务端不转发音频。不会自动启动硬件播放。',
      inputSchema: { song_json: songJson, quality, fallback }, annotations: readOnly },
      args => run(() => operate('/playback', 'POST', undefined, { song: parseSong(args.song_json), quality: args.quality, fallback: args.fallback })))
    if (identity.key.scopes.includes('search')) {
      server.registerTool('miyin_find_playback_url', { description: '根据歌曲名和歌手搜索，取最匹配的第一首并解析音乐直链。适合小智语音点歌；只返回 URL，不代表设备已开始播放。',
        inputSchema: { query: z.string().min(1).max(100), platform, quality, fallback }, annotations: readOnly },
        args => run(async () => {
          const { result } = await operate('/search', 'GET', new URLSearchParams({ q: args.query, platform: args.platform, limit: '1' }))
          const song = (result as SearchResult).list[0]
          if (!song) throw new HttpError(404, '没有找到匹配歌曲', 'song_not_found')
          const media = await operate('/playback', 'POST', undefined, { song, quality: args.quality, fallback: args.fallback })
          return { song, ...media, playbackStarted: false }
        }))
    }
  }
  if (identity.key.scopes.includes('download')) {
    server.registerTool('miyin_get_download_url', { description: '仅在用户明确要求下载时获取下载直链，成功签发扣除 1 次下载额度。返回 URL 与建议文件名，不转发文件。',
      inputSchema: { song_json: songJson, quality, fallback }, annotations: { ...readOnly, readOnlyHint: false, idempotentHint: false } },
      args => run(() => operate('/download', 'POST', undefined, { song: parseSong(args.song_json), quality: args.quality, fallback: args.fallback })))
  }
  if (identity.key.scopes.includes('lyrics')) {
    server.registerTool('miyin_get_lyrics', { description: '读取歌曲的原文歌词、翻译及可用的逐字歌词', inputSchema: { song_json: songJson }, annotations: readOnly },
      args => run(() => operate('/lyrics', 'POST', undefined, { song: parseSong(args.song_json) })))
  }
  if (identity.key.scopes.includes('library')) {
    server.registerTool('miyin_list_playlists', { description: '列出当前用户自己的歌单摘要', inputSchema: {}, annotations: readOnly }, () => run(() => operate('/playlists')))
    server.registerTool('miyin_get_playlist', { description: '读取当前用户自己指定歌单的歌曲，不能读取其他用户的歌单', inputSchema: { id: z.string().min(1).max(128) }, annotations: readOnly },
      args => run(() => operate('/playlists/' + encodeURIComponent(args.id))))
    server.registerTool('miyin_get_favorites', { description: '分页读取当前用户我的喜欢',
      inputSchema: { page: z.number().int().min(1).max(10000).default(1), limit: z.number().int().min(1).max(100).default(20) }, annotations: readOnly },
      args => run(() => operate('/favorites', 'GET', new URLSearchParams({ page: String(args.page), limit: String(args.limit) }))))
  }
  return server
}

/** Stateless transport avoids retaining one client's identity in another client's session. */
export async function handleDeviceMcp(req: IncomingMessage, res: ServerResponse, identity: devices.DeviceIdentity): Promise<void> {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    sendJson(res, 405, { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Use Streamable HTTP POST for MCP' } })
    return
  }
  const body = await readJson(req, 64 * 1024)
  if (Array.isArray(body)) {
    sendJson(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Send one MCP message per HTTP request' } })
    return
  }
  const server = createDeviceMcp(identity)
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
  res.on('close', () => { void server.close().catch(() => undefined) })
  try {
    await server.connect(transport)
    await transport.handleRequest(req, res, body)
  } catch (error) {
    await server.close().catch(() => undefined)
    throw error
  }
}
