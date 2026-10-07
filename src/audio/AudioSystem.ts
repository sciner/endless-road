const RAIN_VOLUME: number = 0.09
const WIND_VOLUME: number = 0.12

/**
 * Procedural audio: an engine built from several overdriven oscillators,
 * rain noise, wind rumble and tire hiss. Starts after the first user gesture.
 */
export class AudioSystem {
    private context: AudioContext | null = null
    private master: GainNode | null = null
    private engine_oscillators: OscillatorNode[] = []
    private engine_filter: BiquadFilterNode | null = null
    private engine_gain: GainNode | null = null
    private tire_gain: GainNode | null = null
    private tire_filter: BiquadFilterNode | null = null
    private rain_gain: GainNode | null = null
    private wind_gain: GainNode | null = null
    private rain_level: number = 1
    private wind_level: number = 1
    private wet_level: number = 1
    private muted: boolean = false

    get started(): boolean {
        return this.context !== null
    }

    start(): void {
        if (this.context) return
        const context: AudioContext = new AudioContext()
        this.context = context
        this.master = context.createGain()
        this.master.gain.value = this.muted ? 0 : 0.7
        this.master.connect(context.destination)

        // Engine: fundamental, subharmonic and detuned unison through overdrive and a filter
        this.engine_filter = context.createBiquadFilter()
        this.engine_filter.type = 'lowpass'
        this.engine_filter.Q.value = 2.5
        const shaper: WaveShaperNode = context.createWaveShaper()
        shaper.curve = AudioSystem.distortionCurve(18)
        this.engine_gain = context.createGain()
        this.engine_gain.gain.value = 0.0
        shaper.connect(this.engine_filter)
        this.engine_filter.connect(this.engine_gain)
        this.engine_gain.connect(this.master)
        const voices: Array<[OscillatorType, number]> = [['sawtooth', 0.32], ['square', 0.16], ['sawtooth', 0.22], ['triangle', 0.4]]
        for (let i: number = 0; i < voices.length; i++) {
            const oscillator: OscillatorNode = context.createOscillator()
            oscillator.type = voices[i][0]
            const gain: GainNode = context.createGain()
            gain.gain.value = voices[i][1]
            oscillator.connect(gain)
            gain.connect(shaper)
            oscillator.start()
            this.engine_oscillators.push(oscillator)
        }

        const noise: AudioBuffer = AudioSystem.noiseBuffer(context, 3)

        // Rain: broadband noise and a low rumble of drops
        const rain_source: AudioBufferSourceNode = context.createBufferSource()
        rain_source.buffer = noise
        rain_source.loop = true
        const rain_high: BiquadFilterNode = context.createBiquadFilter()
        rain_high.type = 'highpass'
        rain_high.frequency.value = 900
        const rain_low: BiquadFilterNode = context.createBiquadFilter()
        rain_low.type = 'lowpass'
        rain_low.frequency.value = 7000
        this.rain_gain = context.createGain()
        this.rain_gain.gain.value = RAIN_VOLUME * this.rain_level
        rain_source.connect(rain_high)
        rain_high.connect(rain_low)
        rain_low.connect(this.rain_gain)
        this.rain_gain.connect(this.master)
        rain_source.start()

        const rumble_source: AudioBufferSourceNode = context.createBufferSource()
        rumble_source.buffer = noise
        rumble_source.loop = true
        rumble_source.playbackRate.value = 0.6
        const rumble_filter: BiquadFilterNode = context.createBiquadFilter()
        rumble_filter.type = 'lowpass'
        rumble_filter.frequency.value = 320
        this.wind_gain = context.createGain()
        this.wind_gain.gain.value = WIND_VOLUME * this.wind_level
        rumble_source.connect(rumble_filter)
        rumble_filter.connect(this.wind_gain)
        this.wind_gain.connect(this.master)
        rumble_source.start()

        // Tires: band-pass noise, volume follows speed, louder on wet surfaces
        const tire_source: AudioBufferSourceNode = context.createBufferSource()
        tire_source.buffer = noise
        tire_source.loop = true
        this.tire_filter = context.createBiquadFilter()
        this.tire_filter.type = 'bandpass'
        this.tire_filter.Q.value = 0.8
        this.tire_filter.frequency.value = 1200
        this.tire_gain = context.createGain()
        this.tire_gain.gain.value = 0
        tire_source.connect(this.tire_filter)
        this.tire_filter.connect(this.tire_gain)
        this.tire_gain.connect(this.master)
        tire_source.start()
    }

    get is_muted(): boolean {
        return this.muted
    }

    toggleMute(): void {
        this.setMuted(!this.muted)
    }

    setMuted(muted: boolean): void {
        this.muted = muted
        if (this.master && this.context) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.7, this.context.currentTime, 0.05)
    }

    /** Ambient levels: rain noise, wind rumble and tire wetness, 0..1; crossfades smoothly */
    setAmbience(rain: number, wind: number, wet_tires: number): void {
        this.rain_level = rain
        this.wind_level = wind
        this.wet_level = wet_tires
        if (!this.context || !this.rain_gain || !this.wind_gain) return
        const now: number = this.context.currentTime
        this.rain_gain.gain.setTargetAtTime(RAIN_VOLUME * rain, now, 0.6)
        this.wind_gain.gain.setTargetAtTime(WIND_VOLUME * wind, now, 0.6)
    }

    /** firing_per_rev: engine pulses per crankshaft revolution (3 for a flat-six, 2 for an inline-four) */
    update(rpm: number, throttle: number, speed: number, slip: number, firing_per_rev: number): void {
        if (!this.context || !this.engine_filter || !this.engine_gain || !this.tire_gain || !this.tire_filter) return
        const now: number = this.context.currentTime
        const base: number = (rpm / 60) * firing_per_rev
        const ratios: number[] = [1, 0.5, 1.007, 2]
        for (let i: number = 0; i < this.engine_oscillators.length; i++) {
            this.engine_oscillators[i].frequency.setTargetAtTime(base * ratios[i], now, 0.03)
        }
        this.engine_filter.frequency.setTargetAtTime(350 + rpm * 0.32 + throttle * 900, now, 0.05)
        this.engine_gain.gain.setTargetAtTime(0.1 + throttle * 0.1 + (rpm / 7000) * 0.06, now, 0.08)
        const tire_volume: number = 0.05 + this.wet_level * 0.11
        this.tire_gain.gain.setTargetAtTime(Math.min(speed / 60, 1) * tire_volume + slip * 0.12, now, 0.1)
        this.tire_filter.frequency.setTargetAtTime(700 + speed * 25, now, 0.1)
    }

    private static distortionCurve(amount: number): Float32Array<ArrayBuffer> {
        const samples: number = 1024
        const curve: Float32Array<ArrayBuffer> = new Float32Array(samples)
        for (let i: number = 0; i < samples; i++) {
            const x: number = (i * 2) / samples - 1
            curve[i] = ((3 + amount) * x * 20 * (Math.PI / 180)) / (Math.PI + amount * Math.abs(x))
        }
        return curve
    }

    private static noiseBuffer(context: AudioContext, seconds: number): AudioBuffer {
        const buffer: AudioBuffer = context.createBuffer(1, context.sampleRate * seconds, context.sampleRate)
        const data: Float32Array = buffer.getChannelData(0)
        let brown: number = 0
        for (let i: number = 0; i < data.length; i++) {
            const white: number = Math.random() * 2 - 1
            brown = (brown + white * 0.02) / 1.02
            data[i] = white * 0.6 + brown * 2.5
        }
        return buffer
    }
}
