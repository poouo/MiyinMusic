import vm from 'node:vm'
import crypto from 'node:crypto'
import zlib from 'node:zlib'
import { AsyncLocalStorage } from 'node:async_hooks'
import { request as httpRequest, type RequestOptions } from '../http-client.js'

export const EVENT_NAMES = {
  request: 'request',
  inited: 'inited',
  updateAlert: 'updateAlert',
} as const

export interface LxSourceInfo {
  name?: string
  type?: string
  actions?: string[]
  qualitys?: string[]
}

export interface LxInited {
  status?: boolean
  sources: Record<string, LxSourceInfo>
  openDevTools?: boolean
}

export interface LxRequestPayload {
  action: string
  source: string
  info: { type: string; musicInfo: Record<string, unknown> }
}

export interface SandboxOptions {
  /** 脚本名，用于日志与错误信息 */
  filename?: string
  /** 初始化超时 */
  initTimeoutMs?: number
  /** 单个动作超时 */
  actionTimeoutMs?: number
  /** 输出脚本 console 日志 */
  debug?: boolean
  onLog?: (level: string, args: unknown[]) => void
}

const SECRET = Symbol('lx-sandbox')

/**
 * 在独立的 vm 上下文中运行洛雪音乐自定义音源脚本，并实现 `globalThis.lx` 运行时。
 *
 * 说明：Node 的 vm 不是安全沙箱，音源脚本来自可信来源（你指定的仓库 / 自行导入），
 * 这里主要目的是隔离全局变量、注入 LX 风格 API，并给脚本调用加上超时保护。
 */
export class SourceRuntime {
  private readonly sandboxOptions: SandboxOptions
  private context: vm.Context | null = null
  private inited: LxInited | null = null
  private handler: ((payload: LxRequestPayload) => unknown) | null = null
  private initError: Error | null = null
  private initedResolve: ((v: LxInited) => void) | null = null
  private initedPromise: Promise<LxInited> | null = null
  private activeRequests = new Set<AbortController>()
  private actionSignal = new AsyncLocalStorage<AbortSignal>()
  private disposed = false
  readonly script: string

  constructor(script: string, options: SandboxOptions = {}) {
    this.script = script
    this.sandboxOptions = options
  }

  get info(): LxInited | null {
    return this.inited
  }

  get error(): Error | null {
    return this.initError
  }

  private log(level: string, args: unknown[]): void {
    if (this.sandboxOptions.debug) this.sandboxOptions.onLog?.(level, args)
  }

  /** 执行脚本并等待 `inited` 事件，返回音源能力声明 */
  init(): Promise<LxInited> {
    if (this.initedPromise) return this.initedPromise
    const timeoutMs = this.sandboxOptions.initTimeoutMs ?? 15000
    this.initedPromise = new Promise<LxInited>((resolve, reject) => {
      this.initedResolve = resolve
      const timer = setTimeout(() => {
        reject(this.initError ?? new Error('音源脚本初始化超时'))
      }, timeoutMs)
      const finish = () => clearTimeout(timer)
      const origResolve = resolve
      this.initedResolve = (v) => {
        finish()
        origResolve(v)
      }

      try {
        this.bootstrap()
      } catch (err) {
        finish()
        this.initError = toError(err)
        reject(this.initError)
      }
    })
    return this.initedPromise
  }

  private bootstrap(): void {
    const options = this.sandboxOptions
    const filename = options.filename ?? 'custom-source.js'
    const runtime = this
    const timers = new Set<ReturnType<typeof setTimeout>>()

    const lx = {
      EVENT_NAMES,
      env: 'desktop',
      version: '2.0.0',
      currentScriptInfo: { name: filename, rawScript: this.script, version: '' },
      /**
       * LX 的请求接口：`request(url, options, callback)`
       * 回调签名为 `callback(err, resp, body)`，resp.body 已尽量解析为 JSON。
       */
      request(url: string, opts: Record<string, unknown> = {}, callback?: (...a: unknown[]) => void) {
        const controller = new AbortController()
        const actionSignal = runtime.actionSignal.getStore()
        const cancel = () => controller.abort(actionSignal?.reason)
        if (actionSignal?.aborted) cancel()
        else actionSignal?.addEventListener('abort', cancel, { once: true })
        runtime.activeRequests.add(controller)
        const cb = typeof callback === 'function' ? callback : () => {}
        const timeout = Number(opts.timeout) > 0 ? Math.min(Number(opts.timeout), 30000) : 20000
        const reqOpts: RequestOptions = {
          method: (opts.method as string) ?? 'GET',
          headers: (opts.headers as Record<string, string>) ?? undefined,
          body: opts.body,
          form: opts.form as Record<string, unknown> | undefined,
          timeoutMs: timeout,
          retries: 0,
          signal: controller.signal,
        }
        if (opts.formData && !reqOpts.form) reqOpts.form = opts.formData as Record<string, unknown>
        httpRequest(url, reqOpts)
          .then((res) => {
            if (runtime.disposed || actionSignal?.aborted) return
            const resp = {
              statusCode: res.status,
              statusMessage: '',
              headers: Object.fromEntries(res.headers.entries()),
              bytes: res.buffer.length,
              raw: res.buffer,
              body: res.json ?? res.text,
            }
            cb.call(lx, null, resp, resp.body)
          })
          .catch((err: unknown) => {
            if (runtime.disposed || actionSignal?.aborted) return
            cb.call(lx, err instanceof Error ? err : new Error(String(err)), null, null)
          })
          .finally(() => {
            actionSignal?.removeEventListener('abort', cancel)
            runtime.activeRequests.delete(controller)
          })
        return () => controller.abort()
      },
      send(eventName: string, data: unknown) {
        if (eventName === EVENT_NAMES.inited) {
          if (runtime.inited) return Promise.resolve()
          runtime.inited = data as LxInited
          try {
            runtime.initedResolve?.(data as LxInited)
          } catch (err) {
            runtime.log('error', ['inited resolve failed', err])
          }
          return Promise.resolve()
        }
        if (eventName === EVENT_NAMES.updateAlert) return Promise.resolve()
        return Promise.resolve()
      },
      on(eventName: string, handler: (payload: LxRequestPayload) => unknown) {
        if (eventName === EVENT_NAMES.request) runtime.handler = handler
        return Promise.resolve()
      },
      utils: {
        crypto: {
          aesEncrypt(buffer: Buffer, mode: string, key: Buffer, iv: Buffer | string) {
            const cipher = crypto.createCipheriv(mode as crypto.CipherGCMTypes, key, iv as Buffer)
            return Buffer.concat([cipher.update(buffer), cipher.final()])
          },
          rsaEncrypt(buffer: Buffer, key: string) {
            const padded = Buffer.concat([Buffer.alloc(Math.max(0, 128 - buffer.length)), buffer])
            return crypto.publicEncrypt({ key, padding: crypto.constants.RSA_NO_PADDING }, padded)
          },
          randomBytes(size: number) {
            return crypto.randomBytes(size)
          },
          md5(str: string) {
            return crypto.createHash('md5').update(str).digest('hex')
          },
        },
        buffer: {
          from(...args: unknown[]) {
            return (Buffer.from as any)(...args)
          },
          bufToString(buf: Buffer, format: string) {
            return Buffer.from(buf as unknown as string, 'binary').toString(format as BufferEncoding)
          },
        },
        zlib: {
          inflate(buf: Buffer) {
            return new Promise<Buffer>((resolve, reject) => {
              zlib.inflate(buf, (err, data) => (err ? reject(new Error(err.message)) : resolve(data)))
            })
          },
          deflate(data: Buffer | string) {
            return new Promise<Buffer>((resolve, reject) => {
              zlib.deflate(data, (err, buf) => (err ? reject(new Error(err.message)) : resolve(buf)))
            })
          },
        },
      },
    }

    const guardedConsole = {
      log: (...a: unknown[]) => runtime.log('log', a),
      info: (...a: unknown[]) => runtime.log('info', a),
      warn: (...a: unknown[]) => runtime.log('warn', a),
      error: (...a: unknown[]) => runtime.log('error', a),
      debug: (...a: unknown[]) => runtime.log('debug', a),
      group: (...a: unknown[]) => runtime.log('group', a),
      groupEnd: () => undefined,
      table: (...a: unknown[]) => runtime.log('table', a),
      trace: (...a: unknown[]) => runtime.log('trace', a),
      time: () => undefined,
      timeEnd: () => undefined,
    }

    const sandboxGlobals: Record<string, unknown> = {
      lx,
      console: guardedConsole,
      setTimeout: (fn: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) => {
        const t = setTimeout(() => {
          timers.delete(t)
          if (!runtime.disposed) fn(...args)
        }, ms)
        timers.add(t)
        return t
      },
      clearTimeout: (t: ReturnType<typeof setTimeout>) => {
        timers.delete(t)
        clearTimeout(t)
      },
      setInterval: (fn: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) => {
        const t = setInterval(() => {
          if (!runtime.disposed) fn(...args)
        }, ms)
        timers.add(t)
        return t
      },
      clearInterval: (t: ReturnType<typeof setTimeout>) => {
        timers.delete(t)
        clearInterval(t as ReturnType<typeof setInterval>)
      },
      URL,
      URLSearchParams,
      TextEncoder,
      TextDecoder,
      Buffer,
      atob: (s: string) => Buffer.from(s, 'base64').toString('binary'),
      btoa: (s: string) => Buffer.from(s, 'binary').toString('base64'),
      encodeURIComponent,
      decodeURIComponent,
      encodeURI,
      decodeURI,
      parseInt,
      parseFloat,
      isNaN,
      JSON,
      Math,
      Date,
      Promise,
      Array,
      Object,
      String,
      Number,
      Boolean,
      RegExp,
      Error,
      TypeError,
      Uint8Array,
      Uint16Array,
      Int32Array,
      ArrayBuffer,
      DataView,
      crypto: {
        subtle: crypto.webcrypto.subtle,
        getRandomValues: (arr: Uint8Array) => crypto.getRandomValues(arr),
      },
    }

    const context = vm.createContext(sandboxGlobals, {
      name: filename,
      codeGeneration: { strings: true, wasm: false },
    })
    // 让 globalThis 指向上下文本身
    vm.runInContext('globalThis.window = undefined; globalThis.self = globalThis;', context)
    this.context = context
    this.guardScriptTimers(timers)

    try {
      vm.runInContext(this.script, context, { filename, timeout: 8000 })
    } catch (err) {
      for (const t of timers) clearTimeout(t as ReturnType<typeof setTimeout>)
      throw toError(err)
    }
  }

  private scriptTimers = new Set<ReturnType<typeof setTimeout>>()
  private guardScriptTimers(timers: Set<ReturnType<typeof setTimeout>>): void {
    this.scriptTimers = timers
  }

  /** 调用脚本注册的 `request` 事件处理器 */
  async request(payload: LxRequestPayload, signal?: AbortSignal): Promise<unknown> {
    if (!this.handler) throw new Error('音源脚本尚未就绪')
    const timeoutMs = this.sandboxOptions.actionTimeoutMs ?? 12000
    let timer: ReturnType<typeof setTimeout> | undefined
    const controller = new AbortController()
    const cancel = () => controller.abort(signal?.reason)
    if (signal?.aborted) cancel()
    else signal?.addEventListener('abort', cancel, { once: true })
    let onAbort: (() => void) | undefined
    try {
      controller.signal.throwIfAborted()
      const result = this.actionSignal.run(controller.signal, () => this.handler!(payload))
      const timeoutPromise = new Promise<never>((_, reject) => {
        onAbort = () => reject(controller.signal.reason)
        controller.signal.addEventListener('abort', onAbort, { once: true })
        timer = setTimeout(() => controller.abort(new Error('音源响应超时')), timeoutMs)
      })
      // 让 Promise.race 不因脚本抛出的 rejection 造成未处理警告
      const settled = Promise.resolve(result)
      settled.catch(() => undefined)
      return await Promise.race([settled, timeoutPromise])
    } catch (err) {
      throw toError(err)
    } finally {
      if (timer) clearTimeout(timer)
      signal?.removeEventListener('abort', cancel)
      if (onAbort) controller.signal.removeEventListener('abort', onAbort)
      controller.abort()
    }
  }

  dispose(): void {
    this.disposed = true
    for (const controller of this.activeRequests) {
      try {
        controller.abort()
      } catch {
        /* ignore */
      }
    }
    this.activeRequests.clear()
    for (const t of this.scriptTimers) {
      clearTimeout(t as ReturnType<typeof setTimeout>)
      clearInterval(t as ReturnType<typeof setInterval>)
    }
    this.scriptTimers.clear()
    this.context = null
    this.handler = null
  }

  static isRuntime(value: unknown): value is SourceRuntime {
    return typeof value === 'object' && value !== null && SECRET in value
  }
}

function toError(err: unknown): Error {
  if (err instanceof Error) return err
  if (typeof err === 'string') return new Error(err)
  try {
    return new Error(JSON.stringify(err))
  } catch {
    return new Error(String(err))
  }
}
