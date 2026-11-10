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
const query = z.string().min(1).max(100).describe('用户要找的歌曲名，可加歌手名消歧，例如“周杰伦 晴天”；不要填写播放或下载等指令词')
const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }

function parseSong(value: string): unknown {
  try { return JSON.parse(value) }
  catch { throw new HttpError(400, 'song_json 必须是完整歌曲对象的 JSON 字符串', 'invalid_parameter') }
}

export function createDeviceMcp(identity: devices.DeviceIdentity): McpServer {
  const canSearch = identity.key.scopes.includes('search')
  const canPlay = identity.key.scopes.includes('playback')
  const canDownload = identity.key.scopes.includes('download')
  const instructions = [
    '觅音音乐工具，只能使用 tools/list 列出的已授权工具；缺少权限时如实告知用户，不要编造调用。',
    canSearch && canPlay ? '用户说“听歌、播放某首歌”时调用 miyin_find_playback_url。' : '',
    canSearch && canDownload ? '用户明确要求“下载、保存歌曲文件”时调用 miyin_find_download_url。' : '',
    canSearch ? '只查询歌曲时用 miyin_search_music。' : '',
    '已知歌曲对象时可直接调用对应的 get 工具。成功结果中的 url 是音源直链，应交给设备已有的 URL 播放器或下载器，本站不传输音频。获取直链不代表设备已播放或已下载；设备没有对应能力时如实说明。不得为听歌调用下载工具，下载直链会扣除账号额度。音质受账号权限和音源限制，低性能硬件使用 128k；用户同意降低音质时才将 fallback 设为 true。',
  ].filter(Boolean).join('')
  const server = new McpServer({ name: 'miyin-music', version: '1.0.0' }, {
    instructions,
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
    server.registerTool('miyin_search_music', { description: '用户查找歌曲、歌手或需要选择多个搜索结果时调用。返回匹配歌曲的完整对象；将选中对象序列化为 song_json，可交给已授权的播放或下载工具。' + (canPlay ? '用户直接点歌时优先用 miyin_find_playback_url。' : ''),
      inputSchema: { query, platform, page: z.number().int().min(1).max(10000).default(1).describe('搜索页码，从 1 开始'), limit: z.number().int().min(1).max(50).default(5).describe('每页歌曲数量，语音查询建议 1–5 首') }, annotations: readOnly },
      ({ query, platform, page, limit }) => run(() => operate('/search', 'GET', new URLSearchParams({ q: query, platform, page: String(page), limit: String(limit) })) ))
  }
  if (identity.key.scopes.includes('playback')) {
    server.registerTool('miyin_get_playback_url', { description: '已从搜索、我的喜欢或歌单选定歌曲，且用户希望听这首歌时调用。返回 url、实际 quality 和 duration，可交给设备的 URL 播放工具；此工具本身不会启动扬声器播放，也不扣下载次数。',
      inputSchema: { song_json: songJson, quality, fallback }, annotations: readOnly },
      args => run(() => operate('/playback', 'POST', undefined, { song: parseSong(args.song_json), quality: args.quality, fallback: args.fallback })))
    if (identity.key.scopes.includes('search')) {
      server.registerTool('miyin_find_playback_url', { description: '用户说“我想听某首歌”“播放歌名”或指定歌手点歌时优先调用，一次完成搜索与播放直链解析，选择首个匹配结果。返回歌曲、url、实际 quality 和 playbackStarted:false；随后把 url 交给设备已有播放器，未执行播放器前不能声称已播放。',
        inputSchema: { query, platform, quality, fallback }, annotations: readOnly },
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
    server.registerTool('miyin_get_download_url', { description: '已知完整歌曲对象，且用户明确要求下载或保存歌曲文件时调用；听歌不要调用。返回 url、filename 和实际 quality，成功签发扣 1 次下载额度，受账号下载权限及每日每月额度限制。需要设备下载器保存文件，此工具不会自动保存。',
      inputSchema: { song_json: songJson, quality, fallback }, annotations: { ...readOnly, readOnlyHint: false, idempotentHint: false } },
      args => run(() => operate('/download', 'POST', undefined, { song: parseSong(args.song_json), quality: args.quality, fallback: args.fallback })))
    if (identity.key.scopes.includes('search')) {
      server.registerTool('miyin_find_download_url', { description: '用户明确说“下载某首歌”“把这首歌保存为文件”，且只提供歌名或歌手时调用。搜索首个匹配结果并返回下载 url、filename、实际 quality 和 downloadStarted:false。成功签发扣 1 次下载额度；不要用于听歌，不要自动重试消耗额度。设备下载器执行成功后才能说已下载。',
        inputSchema: { query, platform, quality, fallback }, annotations: { ...readOnly, readOnlyHint: false, idempotentHint: false } },
        args => run(async () => {
          const { result } = await operate('/search', 'GET', new URLSearchParams({ q: args.query, platform: args.platform, limit: '1' }))
          const song = (result as SearchResult).list[0]
          if (!song) throw new HttpError(404, '没有找到匹配歌曲', 'song_not_found')
          const media = await operate('/download', 'POST', undefined, { song, quality: args.quality, fallback: args.fallback })
          return { song, ...media, downloadStarted: false }
        }))
    }
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
