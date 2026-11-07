import fs from 'node:fs'
import path from 'node:path'

/** 一个带原子写入与延迟落盘的极简 JSON 存储 */
export class JsonStore<T> {
  readonly file: string
  data: T
  private timer: NodeJS.Timeout | null = null
  private dirty = false

  constructor(file: string, defaults: () => T) {
    this.file = file
    this.data = this.read(defaults)
  }

  private read(defaults: () => T): T {
    try {
      if (!fs.existsSync(this.file)) return defaults()
      const raw = fs.readFileSync(this.file, 'utf8')
      if (!raw.trim()) return defaults()
      return JSON.parse(raw) as T
    } catch {
      return defaults()
    }
  }

  /** 立即落盘（原子替换） */
  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (!this.dirty) return
    this.dirty = false
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      const tmp = this.file + '.tmp'
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2))
      fs.renameSync(tmp, this.file)
    } catch {
      /* 落盘失败不阻塞请求 */
    }
  }

  /** 标记为已修改，500ms 后合并写入 */
  save(): void {
    this.dirty = true
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.flush()
    }, 500)
    this.timer.unref?.()
  }
}

export function shortId(prefix = ''): string {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}
