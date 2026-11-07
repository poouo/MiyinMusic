export interface BuiltinSource {
  id: string
  /** 展示名称 */
  name: string
  /** 仓库内的路径 */
  path: string
}

/**
 * 内置音源列表，全部来自 https://github.com/pdone/lx-music-source
 * 脚本在服务端运行，把洛雪音乐的音乐地址接口转换成 HTTP API 供本应用使用。
 */
export const BUILTIN_SOURCES: BuiltinSource[] = [
  { id: 'lx', name: '洛雪音乐源', path: 'lx/latest.js' },
  { id: 'sixyin', name: '六音源', path: 'sixyin/latest.js' },
  { id: 'huibq', name: 'Huibq 源', path: 'huibq/latest.js' },
  { id: 'jiexiang', name: '杰翔聚合', path: 'jiexiang/latest.js' },
  { id: 'xinghai', name: '星海音乐源', path: 'xinghai/latest.js' },
  { id: 'fish', name: 'Fish 源', path: 'fish/latest.js' },
  { id: 'changqing', name: '长青 SVIP', path: 'changqing/latest.js' },
  { id: 'huanyin', name: '幻音源', path: 'huanyin/latest.js' },
  { id: 'hyw', name: 'HYW 公益版', path: 'hyw/latest.js' },
  { id: 'qdy', name: '全豆要聚合', path: 'qdy/latest.js' },
  { id: 'yuningxi', name: '玉宁熙 Pro', path: 'yuningxi/latest.js' },
  { id: 'ikun', name: 'ikun 源', path: 'ikun/latest.js' },
  { id: 'helloworld', name: 'HelloWorld 聚合', path: 'helloworld/latest.js' },
  { id: 'juhe', name: 'JuheApi', path: 'juhe/latest.js' },
  { id: 'grass', name: 'Grass 源', path: 'grass/latest.js' },
  { id: 'flower', name: '野花源', path: 'flower/latest.js' },
]

const RAW_BASE = 'https://raw.githubusercontent.com/pdone/lx-music-source/main/'

/** GitHub 直连 + 若干加速镜像，逐个尝试 */
export function candidateUrls(pathOrUrl: string): string[] {
  if (/^https?:\/\//i.test(pathOrUrl)) {
    if (!/raw\.githubusercontent\.com/.test(pathOrUrl)) return [pathOrUrl]
    const stripped = pathOrUrl.replace(/^https?:\/\//, '')
    return [
      pathOrUrl,
      'https://ghproxy.net/' + stripped,
      'https://gh-proxy.org/' + pathOrUrl,
      'https://gh.llkk.cc/' + pathOrUrl,
      'https://ghproxy.cn/' + pathOrUrl,
    ]
  }
  const raw = RAW_BASE + pathOrUrl
  const stripped = raw.replace(/^https?:\/\//, '')
  return [
    raw,
    'https://ghproxy.net/' + stripped,
    'https://gh-proxy.org/' + raw,
    'https://gh.llkk.cc/' + raw,
    'https://ghproxy.cn/' + raw,
    'https://gh.api.99988866.xyz/' + raw,
  ]
}
