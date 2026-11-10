import WebSocket from 'ws'

export interface XiaozhiBridgeOptions {
  endpoint: string
  mcpUrl: string
  apiKey: string
  log?: (message: string) => void
  initialBackoffMs?: number
  onState?: (state: 'connecting' | 'connected' | 'reconnecting', connectedAt?: number) => void
}

/** Xiaozhi's official MCP endpoint carries one JSON-RPC message per WebSocket frame. */
export class XiaozhiMcpBridge {
  private socket?: WebSocket
  private reconnectTimer?: ReturnType<typeof setTimeout>
  private heartbeat?: ReturnType<typeof setInterval>
  private readonly controller = new AbortController()
  private stopped = false
  private started = false
  private active = 0
  private backoff: number
  private protocolVersion = '2024-11-05'

  constructor(private readonly options: XiaozhiBridgeOptions) {
    const endpoint = new URL(options.endpoint), mcp = new URL(options.mcpUrl)
    if (!['ws:', 'wss:'].includes(endpoint.protocol) || endpoint.username || endpoint.password
      || !['http:', 'https:'].includes(mcp.protocol) || mcp.username || mcp.password
      || !/^myk_[A-Za-z0-9_-]{43}$/.test(options.apiKey)) throw new Error('MCP_ENDPOINT、MIYIN_MCP_URL 或 MIYIN_API_KEY 格式不正确')
    this.backoff = options.initialBackoffMs ?? 1000
  }

  start(): void {
    if (this.started) return
    this.started = true
    this.connect()
  }

  stop(): void {
    this.stopped = true
    this.controller.abort()
    clearTimeout(this.reconnectTimer)
    clearInterval(this.heartbeat)
    this.socket?.terminate()
  }

  private log(message: string) { this.options.log?.(message) }

  private connect(): void {
    if (this.stopped) return
    this.log('正在连接小智 MCP 接入点…')
    this.options.onState?.('connecting')
    const socket = new WebSocket(this.options.endpoint, { maxPayload: 64 * 1024, handshakeTimeout: 15000 })
    this.socket = socket
    let openedAt = 0, alive = true
    socket.on('open', () => {
      openedAt = Date.now()
      this.protocolVersion = '2024-11-05'
      this.log('小智 MCP 已连接')
      this.options.onState?.('connected', openedAt)
      this.heartbeat = setInterval(() => {
        if (!alive) { socket.terminate(); return }
        alive = false; socket.ping()
      }, 30000)
    })
    socket.on('pong', () => { alive = true })
    socket.on('message', data => { void this.forward(socket, data.toString()) })
    // Do not log the upstream Error: its text may contain the private endpoint token.
    socket.on('error', () => this.log('小智 MCP 连接异常，将自动重试'))
    socket.on('close', () => {
      clearInterval(this.heartbeat)
      if (this.stopped) return
      if (openedAt && Date.now() - openedAt > 30000) this.backoff = this.options.initialBackoffMs ?? 1000
      const wait = this.backoff
      this.backoff = Math.min(60000, this.backoff * 2)
      this.log('小智 MCP 已断开，稍后自动重连')
      this.options.onState?.('reconnecting')
      this.reconnectTimer = setTimeout(() => this.connect(), wait)
    })
  }

  private send(socket: WebSocket, value: unknown) {
    if (socket.readyState !== WebSocket.OPEN) return
    if (socket.bufferedAmount > 2 * 1024 * 1024) { socket.close(1013, 'Client too slow'); return }
    socket.send(JSON.stringify(value))
  }

  private async forward(socket: WebSocket, text: string) {
    let message: Record<string, unknown>
    try {
      const parsed: unknown = JSON.parse(text)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid message')
      message = parsed as Record<string, unknown>
    } catch { this.send(socket, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Invalid JSON-RPC message' } }); return }
    if ('result' in message || 'error' in message) return
    const hasId = Object.hasOwn(message, 'id')
    if (message.jsonrpc !== '2.0' || typeof message.method !== 'string'
      || (hasId && typeof message.id !== 'string' && typeof message.id !== 'number')) {
      this.send(socket, { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid JSON-RPC request' } }); return
    }
    if (this.active >= 4) {
      if (hasId) this.send(socket, { jsonrpc: '2.0', id: message.id, error: { code: -32000, message: 'Too many concurrent tool calls' } })
      return
    }
    this.active++
    try {
      const response = await fetch(this.options.mcpUrl, {
        method: 'POST', headers: { Authorization: 'Bearer ' + this.options.apiKey, 'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': this.protocolVersion },
        body: text, signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(30000)]), redirect: 'error',
      })
      if (response.status === 202 || response.status === 204) return
      const payload = await response.json() as Record<string, any>
      if (!response.ok) {
        if (hasId) this.send(socket, { jsonrpc: '2.0', id: message.id,
          error: { code: -32001, message: typeof payload.error?.message === 'string' ? payload.error.message : 'Miyin MCP request failed' } })
        return
      }
      if (message.method === 'initialize' && typeof payload.result?.protocolVersion === 'string'
        && payload.result.protocolVersion.length < 32) this.protocolVersion = payload.result.protocolVersion
      if (hasId) this.send(socket, payload)
    } catch {
      if (!this.stopped && hasId) this.send(socket, { jsonrpc: '2.0', id: message.id, error: { code: -32000, message: '觅音 MCP 连接失败或超时，请稍后重试' } })
    } finally { this.active-- }
  }
}
