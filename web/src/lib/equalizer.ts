export const EQ_FREQUENCIES = [60, 230, 910, 3600, 14000]

/** One graph per audio element. Gain headroom limits clipping when boosting bands. */
export class BrowserEqualizer {
  readonly context: AudioContext
  private readonly input: MediaElementAudioSourceNode
  private readonly headroom: GainNode
  private readonly filters: BiquadFilterNode[]
  constructor(audio: HTMLAudioElement) {
    if (audio.currentSrc && new URL(audio.currentSrc, location.href).origin !== location.origin) throw new Error('此跨域音源暂不支持均衡器')
    this.context = new AudioContext()
    try { this.input = this.context.createMediaElementSource(audio) }
    catch (error) { void this.context.close(); throw error }
    this.headroom = this.context.createGain()
    this.filters = EQ_FREQUENCIES.map(frequency => {
      const filter = this.context.createBiquadFilter(); filter.type = 'peaking'; filter.frequency.value = frequency; filter.Q.value = 1
      return filter
    })
    this.input.connect(this.headroom)
    let previous: AudioNode = this.headroom
    for (const filter of this.filters) { previous.connect(filter); previous = filter }
    previous.connect(this.context.destination)
  }
  apply(enabled: boolean, gains: number[]) {
    const values = EQ_FREQUENCIES.map((_, index) => enabled ? Math.max(-12, Math.min(12, gains[index] || 0)) : 0)
    this.headroom.gain.setTargetAtTime(Math.pow(10, -Math.max(0, ...values) / 20), this.context.currentTime, 0.03)
    this.filters.forEach((filter, index) => filter.gain.setTargetAtTime(values[index], this.context.currentTime, 0.03))
  }
  resume() { return this.context.resume() }
  close() { this.input.disconnect(); return this.context.close() }
}
