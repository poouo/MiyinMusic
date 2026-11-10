const ref = (name: string) => ({ $ref: '#/components/schemas/' + name })
const json = (schema: unknown) => ({ 'application/json': { schema } })
const parameter = (name: string, schema: unknown, required = false, description = '') => ({ name, in: 'query', required, description, schema })
const errors = Object.fromEntries([400, 401, 403, 404, 429, 502, 504].map(code => [code, {
  description: ({ 400: '参数无效', 401: '密钥无效或过期', 403: '功能关闭、未授权或权限不足', 404: '资源不存在',
    429: '频率或下载额度超限', 502: '音源失败或所选音质不可用', 504: '上游超时' } as Record<number, string>)[code],
  content: json(ref('Error')),
}]))
const response = (schema: unknown) => ({ '200': { description: '成功', content: json(schema) }, ...errors })
const object = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({ type: 'object', properties, required })
const array = (items: unknown) => ({ type: 'array', items })
const string = { type: 'string' }
const integer = { type: 'integer' }
const boolean = { type: 'boolean' }
const scope = (value: string) => '需要密钥权限：' + value + '。'
const songRequest = {
  required: true, content: json(object({ song: ref('Song'), quality: { ...string, enum: ['128k', '320k', 'flac', 'flac24bit'], default: '320k', description: '设备逐次指定音质；省略为 320k。' },
    fallback: { ...boolean, default: false, description: 'true 时只向低一级降级，实际音质由响应 quality 表示；false 或省略时仅尝试选定音质，不可用则报错。' } }, ['song'])),
}

/** Served directly so hardware SDKs can import the exact versioned contract. */
export const deviceOpenApi = {
  openapi: '3.0.3', info: { title: '觅音设备 API', version: '1.0.0',
    description: '面向智能音箱、AI 硬件和自动化客户端。先在 Web 设置→设备 API 创建密钥。JSON 接口使用 Authorization: Bearer myk_…。播放、下载返回音源的 HTTP(S) 直链，音频由设备直连上游，不经本站代理。过期时间、Range、跨域和防盗链规则由上游决定。' },
  servers: [{ url: '/api/v1' }], security: [{ DeviceKey: [] }],
  paths: {
    '/openapi.json': { get: { operationId: 'getOpenApi', summary: '获取本 OpenAPI 文档', security: [], responses: response({ type: 'object' }) } },
    '/me': { get: { operationId: 'getDeviceAccount', summary: '查询当前账号、密钥、权限及下载用量',
      responses: response(object({ user: ref('User'), key: ref('DeviceKeyInfo'), access: ref('DeviceAccess'), policy: ref('Policy'), usage: ref('Usage') })) } },
    '/capabilities': { get: { operationId: 'getCapabilities', summary: '平台、音质及设备能力', responses: response(object({
      apiVersion: string, platforms: array(object({ id: ref('Platform'), name: string, available: boolean })),
      qualities: array(ref('Quality')), scopes: array(ref('Scope')), mediaUrlMode: string,
      expiresAtKnown: boolean,
      mcp: object({ endpoint: string, transport: string }),
    })) } },
    '/search': { get: { operationId: 'searchSongs', summary: '按平台搜索歌曲', description: scope('search') + '保留完整歌曲对象，后续播放、下载、歌词请求原样传回。',
      parameters: [parameter('q', { ...string, minLength: 1, maxLength: 100 }, true, '歌曲名、歌手或关键词'),
        parameter('platform', { ...ref('Platform'), default: 'wy' }), parameter('page', { ...integer, minimum: 1, maximum: 10000, default: 1 }),
        parameter('limit', { ...integer, minimum: 1, maximum: 50, default: 20 })],
      responses: response(object({ result: object({ platform: ref('Platform'), list: array(ref('Song')), total: integer, page: integer, limit: integer, hasMore: boolean }) })) } },
    '/playback': { post: { operationId: 'resolvePlayback', summary: '解析在线播放直链', description: scope('playback') + '复用音源优先级与完整音频检查。返回上游绝对地址，不使用本站音频缓存或代理。音源可能有地区/IP、防盗链或格式限制；设备不能播放时可重新解析或换平台。',
      requestBody: songRequest, responses: response(ref('MediaResult')) } },
    '/download': { post: { operationId: 'resolveDownload', summary: '获取歌曲下载直链', description: scope('download') + '遵循账号音质与日/月次数，成功签发直链计 1 次，和 Web 共用次数；失败不计数。直连流量无法核验，因此有日/月流量上限的账号返回 direct_download_byte_quota，不绕过流量限制。filename 是建议保存名。',
      requestBody: songRequest, responses: response(ref('DownloadResult')) } },
    '/lyrics': { post: { operationId: 'getLyrics', summary: '读取歌词、翻译和逐字歌词', description: scope('lyrics'),
      requestBody: { required: true, content: json(object({ song: ref('Song') })) },
      responses: response(object({ lyric: object({ lyric: string, tlyric: string, lxlyric: string }, ['lyric']) })) } },
    '/playlists': { get: { operationId: 'listOwnPlaylists', summary: '列出当前用户的歌单', description: scope('library') + '只读，仅本账号。',
      responses: response(object({ playlists: array(ref('PlaylistSummary')) })) } },
    '/playlists/{id}': { get: { operationId: 'getOwnPlaylist', summary: '读取自己歌单的歌曲', description: scope('library'),
      parameters: [{ name: 'id', in: 'path', required: true, schema: string }], responses: response(object({ playlist: ref('Playlist') })) } },
    '/favorites': { get: { operationId: 'listOwnFavorites', summary: '分页读取我的喜欢', description: scope('library'),
      parameters: [parameter('page', { ...integer, minimum: 1, maximum: 10000, default: 1 }), parameter('limit', { ...integer, minimum: 1, maximum: 100, default: 20 })],
      responses: response(object({ songs: array(ref('Song')), total: integer, page: integer, limit: integer, hasMore: boolean })) } },
  },
  components: {
    securitySchemes: { DeviceKey: { type: 'http', scheme: 'bearer', bearerFormat: 'myk_<43-character-secret>' } },
    schemas: {
      Platform: { ...string, enum: ['kw', 'kg', 'tx', 'wy', 'mg'], description: '酷我、酷狗、QQ音乐、网易云音乐、咪咕' },
      Quality: { ...string, enum: ['128k', '320k', 'flac', 'flac24bit'] },
      Scope: { ...string, enum: ['search', 'playback', 'download', 'lyrics', 'library'] },
      Song: { ...object({ platform: ref('Platform'), songmid: string, name: string, singer: string, albumName: string,
        interval: { type: 'number', description: '歌曲完整时长，秒' }, img: { ...string, nullable: true }, qualities: array(ref('Quality')),
        hash: string, albumId: string, albumMid: string, strMediaMid: string, copyrightId: string, lrcUrl: string, songId: string,
        artists: array(object({ id: string, name: string })),
      }, ['platform', 'songmid']), description: '直接使用搜索/歌单返回的完整对象。hash、strMediaMid 等字段因平台而异，不要丢弃。' },
      MediaResult: object({ url: { ...string, format: 'uri', description: '上游 HTTP(S) 绝对直链。不要向上游发送本站 API 密钥；删除密钥只阻止后续解析，无法撤销已发出的上游链接。' },
        delivery: { ...string, enum: ['direct'] }, expiresAt: { ...integer, nullable: true, description: '上游有效期未知时为 null；失效后重新解析。' },
        quality: ref('Quality'), requestedQuality: ref('Quality'), downgraded: boolean, duration: { type: 'number' }, platform: ref('Platform') }),
      DownloadResult: { allOf: [ref('MediaResult'), object({ filename: string })] },
      Error: object({ error: object({ code: string, message: string }) }),
      User: object({ id: string, username: string, nickname: string, avatarColor: string, role: { ...string, enum: ['user', 'vip', 'admin'] },
        status: { ...string, enum: ['active', 'disabled'] }, createdAt: integer, lastLoginAt: { ...integer, nullable: true } }),
      DeviceKeyInfo: object({ id: string, name: string, prefix: string, scopes: array(ref('Scope')), createdAt: integer,
        expiresAt: { ...integer, nullable: true }, lastUsedAt: { ...integer, nullable: true } }),
      DeviceAccess: object({ enabled: boolean, authorized: boolean, allowed: boolean,
        mode: { ...string, enum: ['inherit', 'allow', 'deny'] }, requestsPerMinute: integer }),
      Policy: object({ playbackEnabled: boolean, playbackQualities: array(ref('Quality')), downloadEnabled: boolean,
        downloadQualities: array(ref('Quality')), dailyDownloads: { ...integer, nullable: true }, monthlyDownloads: { ...integer, nullable: true },
        dailyBytes: { ...integer, nullable: true }, monthlyBytes: { ...integer, nullable: true } }),
      Usage: object({ day: object({ downloads: integer, bytes: integer }), month: object({ downloads: integer, bytes: integer }), dayKey: string, monthKey: string, timezone: string }),
      PlaylistSummary: object({ id: string, name: string, description: string, createdAt: integer, updatedAt: integer, songCount: integer }),
      Playlist: object({ id: string, name: string, description: string, createdAt: integer, updatedAt: integer, songs: array(ref('Song')) }),
    },
  },
}
