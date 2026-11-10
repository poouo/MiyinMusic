import type { Platform, Song } from '../types.js'
import type { Provider } from './types.js'
import { kwProvider } from './kw.js'
import { kgProvider } from './kg.js'
import { txProvider } from './tx.js'
import { wyProvider } from './wy.js'
import { mgProvider } from './mg.js'

const providers: Record<Platform, Provider> = {
  kw: kwProvider,
  kg: kgProvider,
  tx: txProvider,
  wy: wyProvider,
  mg: mgProvider,
}

export function getProvider(platform: Platform): Provider {
  const provider = providers[platform]
  if (!provider) throw new Error('不支持的平台：' + platform)
  return provider
}

export function getPic(song: Song): Promise<string | null> {
  const provider = getProvider(song.platform)
  if (provider.pic) return provider.pic(song)
  return Promise.resolve(song.img ?? null)
}

export { providers }
