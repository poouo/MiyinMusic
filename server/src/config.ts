import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'

const here = path.dirname(fileURLToPath(import.meta.url))
// dist/config.js -> server/  |  src/config.ts -> server/
export const SERVER_ROOT = path.resolve(here, '..')
export const PROJECT_ROOT = path.resolve(SERVER_ROOT, '..')

const dataDir = process.env.MIYIN_DATA_DIR
  ? path.resolve(process.env.MIYIN_DATA_DIR)
  : path.join(PROJECT_ROOT, 'data')

export const config = {
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '0.0.0.0',
  dataDir,
  cacheDir: path.join(dataDir, 'cache'),
  /** 服务端音乐缓存（歌单 / 我的喜欢） */
  audioCacheDir: path.join(dataDir, 'audio-cache'),
  /** SQLite 数据库文件 */
  dbFile: path.join(dataDir, 'miyin.db'),
  /** 旧版 JSON 存储（仅用于一次性迁移） */
  stateFile: path.join(dataDir, 'state.json'),
  usersFile: path.join(dataDir, 'users.json'),
  sessionsFile: path.join(dataDir, 'sessions.json'),
  legacyUsersDir: path.join(dataDir, 'users'),
  legacyBackupDir: path.join(dataDir, 'legacy-backup'),
  webDist: path.join(PROJECT_ROOT, 'web', 'dist'),
  isDev: process.env.NODE_ENV !== 'production',
  /** 是否在启动时联网刷新内置音源脚本 */
  autoUpdateSources: process.env.MIYIN_NO_SOURCE_UPDATE !== '1',
  /** 调试音源脚本的 console 输出 */
  debugSource: process.env.MIYIN_DEBUG_SOURCE === '1',
  /** 远端脚本下载超时 */
  sourceLoadTimeoutMs: Number(process.env.MIYIN_SOURCE_TIMEOUT ?? 20000),
  /** 单个 requests 动作超时 */
  actionTimeoutMs: Number(process.env.MIYIN_ACTION_TIMEOUT ?? 12000),
  /** 是否允许新用户注册（公开部署时可关闭） */
  allowRegister: process.env.MIYIN_ALLOW_REGISTER !== '0',
} as const

export function ensureDirs(): void {
  for (const dir of [config.dataDir, config.cacheDir, config.audioCacheDir]) {
    fs.mkdirSync(dir, { recursive: true })
  }
}