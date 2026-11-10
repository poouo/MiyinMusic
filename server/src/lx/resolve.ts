/** Start sources in priority order, hedging slow requests without unbounded fan-out. */
export function resolvePrioritized<T>(
  tasks: ((signal: AbortSignal) => Promise<T>)[],
  options: { budgetMs: number; attemptMs?: number; hedgeMs?: number; concurrency?: number },
): Promise<T> {
  return new Promise((resolve, reject) => {
    let next = 0
    let done = false
    const active = new Set<AbortController>()
    const errors: unknown[] = []
    const cleanup = () => {
      done = true
      clearTimeout(deadline)
      clearInterval(hedge)
      for (const controller of active) controller.abort()
    }
    const fail = () => { cleanup(); reject(new AggregateError(errors, '所有音源请求失败')) }
    const launch = () => {
      if (done || next >= tasks.length || active.size >= (options.concurrency ?? 6)) return
      const task = tasks[next++]
      const controller = new AbortController()
      active.add(controller)
      const timer = setTimeout(() => controller.abort(new Error('音源响应超时')), options.attemptMs ?? 7000)
      let onAbort: () => void
      const aborted = new Promise<never>((_, reject) => {
        onAbort = () => reject(controller.signal.reason)
        controller.signal.addEventListener('abort', onAbort, { once: true })
      })
      void Promise.race([Promise.resolve().then(() => task(controller.signal)), aborted])
        .then(value => { if (!done) { cleanup(); resolve(value) } }, error => {
          if (done) return
          errors.push(error)
          active.delete(controller)
          launch()
          if (next >= tasks.length && !active.size) fail()
        })
        .finally(() => {
          clearTimeout(timer)
          controller.signal.removeEventListener('abort', onAbort!)
          active.delete(controller)
        })
    }
    const deadline = setTimeout(() => { errors.push(new Error('音源解析超时')); fail() }, options.budgetMs)
    const hedge = setInterval(launch, options.hedgeMs ?? 180)
    if (tasks.length) launch()
    else fail()
  })
}

/** Shared capacity across users. A queued/cancelled request never cancels another job. */
export class ResolutionPool {
  private active = 0
  private bySource = new Map<string, number>()
  private queue: { id: string; start: () => void }[] = []
  constructor(private limit = 24, private sourceLimit = 4) {}

  run<T>(id: string, signal: AbortSignal, work: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) { reject(signal.reason); return }
      const abort = () => {
        this.queue = this.queue.filter(item => item !== job)
        reject(signal.reason)
      }
      const job = { id, start: () => {
        signal.removeEventListener('abort', abort)
        this.active++
        this.bySource.set(id, (this.bySource.get(id) ?? 0) + 1)
        void Promise.resolve().then(() => { signal.throwIfAborted(); return work() }).then(resolve, reject).finally(() => {
          this.active--
          this.bySource.set(id, (this.bySource.get(id) ?? 1) - 1)
          this.pump()
        })
      } }
      signal.addEventListener('abort', abort, { once: true })
      this.queue.push(job)
      this.pump()
    })
  }

  private pump(): void {
    while (this.active < this.limit) {
      const index = this.queue.findIndex(job => (this.bySource.get(job.id) ?? 0) < this.sourceLimit)
      if (index < 0) return
      this.queue.splice(index, 1)[0].start()
    }
  }
}
