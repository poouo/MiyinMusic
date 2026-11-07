type Level = 'debug' | 'info' | 'warn' | 'error'

const COLORS: Record<Level, string> = {
  debug: '\u001b[90m',
  info: '\u001b[36m',
  warn: '\u001b[33m',
  error: '\u001b[31m',
}
const RESET = '\u001b[0m'
const useColor = process.stdout.isTTY

function stamp(): string {
  const d = new Date()
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function emit(level: Level, scope: string, args: unknown[]): void {
  const tag = level.toUpperCase().padEnd(5)
  const head = useColor ? `${COLORS[level]}${tag}${RESET}` : tag
  // eslint-disable-next-line no-console
  console.log(`${stamp()} ${head} [${scope}]`, ...args)
}

export function logger(scope: string) {
  return {
    debug: (...a: unknown[]) => { if (process.env.MIYIN_DEBUG === '1') emit('debug', scope, a) },
    info: (...a: unknown[]) => emit('info', scope, a),
    warn: (...a: unknown[]) => emit('warn', scope, a),
    error: (...a: unknown[]) => emit('error', scope, a),
  }
}
