/** One song load may refresh its URL once; media events and play() share this budget. */
export class PlaybackLoad {
  private attempt = 0
  private handled = false
  private retries = 0

  begin(resetBudget = false): number {
    if (resetBudget) this.retries = 0
    this.handled = false
    return ++this.attempt
  }

  isCurrent(attempt: number): boolean {
    return this.attempt === attempt
  }

  fail(attempt: number, retryable: boolean): 'ignore' | 'retry' | 'failed' {
    if (!this.isCurrent(attempt) || this.handled) return 'ignore'
    this.handled = true
    if (retryable && this.retries < 1) {
      this.retries++
      return 'retry'
    }
    return 'failed'
  }
}
