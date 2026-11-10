import crypto from 'node:crypto'
import { HttpError } from './errors.js'
import { QUALITIES, type Quality } from './types.js'

const key = crypto.createHash('sha256').update(process.env.MIYIN_SECRET ?? crypto.randomBytes(32)).digest()
interface PlaybackGrant { target: string; quality: Quality; subject: string; expires: number }

/** Encrypted grants hide upstream URLs as well as authenticating all authorization fields. */
export function playbackUrl(target: string, quality: Quality, subject: string): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const claims: PlaybackGrant = { target, quality, subject, expires: Date.now() + 2 * 60 * 60 * 1000 }
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(claims)), cipher.final()])
  return '/api/stream?t=' + Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url')
}

export function readPlayback(token: string, subject: string): PlaybackGrant {
  try {
    if (!token || token.length > 32768) throw new Error('invalid length')
    const data = Buffer.from(token, 'base64url')
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, data.subarray(0, 12))
    decipher.setAuthTag(data.subarray(12, 28))
    const claims = JSON.parse(Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8')) as PlaybackGrant
    if (claims.subject !== subject || !(claims.expires > Date.now()) || !QUALITIES.includes(claims.quality)
      || typeof claims.target !== 'string' || !claims.target) throw new Error('invalid grant')
    return claims
  } catch {
    throw new HttpError(403, '播放链接无效或已过期', 'invalid_playback_grant')
  }
}
