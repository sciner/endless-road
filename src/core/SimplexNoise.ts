import { Random } from './Random'

const F2: number = 0.5 * (Math.sqrt(3) - 1)
const G2: number = (3 - Math.sqrt(3)) / 6
const GRADIENTS: number[] = [1, 1, -1, 1, 1, -1, -1, -1, 1, 0, -1, 0, 1, 0, -1, 0, 0, 1, 0, -1, 0, 1, 0, -1]

/**
 * 2D simplex noise with a deterministic permutation table
 */
export class SimplexNoise {
    private perm: Uint8Array
    private perm12: Uint8Array

    constructor(seed: number) {
        const random: Random = new Random(seed)
        const table: Uint8Array = new Uint8Array(256)
        for (let i: number = 0; i < 256; i++) table[i] = i
        for (let i: number = 255; i > 0; i--) {
            const j: number = Math.floor(random.next() * (i + 1))
            const tmp: number = table[i]
            table[i] = table[j]
            table[j] = tmp
        }
        this.perm = new Uint8Array(512)
        this.perm12 = new Uint8Array(512)
        for (let i: number = 0; i < 512; i++) {
            this.perm[i] = table[i & 255]
            this.perm12[i] = this.perm[i] % 12
        }
    }

    /** Noise value at a point, range roughly [-1, 1] */
    noise2(x: number, y: number): number {
        const s: number = (x + y) * F2
        const i: number = Math.floor(x + s)
        const j: number = Math.floor(y + s)
        const t: number = (i + j) * G2
        const x0: number = x - (i - t)
        const y0: number = y - (j - t)
        const i1: number = x0 > y0 ? 1 : 0
        const j1: number = x0 > y0 ? 0 : 1
        const x1: number = x0 - i1 + G2
        const y1: number = y0 - j1 + G2
        const x2: number = x0 - 1 + 2 * G2
        const y2: number = y0 - 1 + 2 * G2
        const ii: number = i & 255
        const jj: number = j & 255

        let n0: number = 0
        let n1: number = 0
        let n2: number = 0

        let t0: number = 0.5 - x0 * x0 - y0 * y0
        if (t0 > 0) {
            const g: number = this.perm12[ii + this.perm[jj]] * 2
            t0 *= t0
            n0 = t0 * t0 * (GRADIENTS[g] * x0 + GRADIENTS[g + 1] * y0)
        }
        let t1: number = 0.5 - x1 * x1 - y1 * y1
        if (t1 > 0) {
            const g: number = this.perm12[ii + i1 + this.perm[jj + j1]] * 2
            t1 *= t1
            n1 = t1 * t1 * (GRADIENTS[g] * x1 + GRADIENTS[g + 1] * y1)
        }
        let t2: number = 0.5 - x2 * x2 - y2 * y2
        if (t2 > 0) {
            const g: number = this.perm12[ii + 1 + this.perm[jj + 1]] * 2
            t2 *= t2
            n2 = t2 * t2 * (GRADIENTS[g] * x2 + GRADIENTS[g + 1] * y2)
        }
        return 70 * (n0 + n1 + n2)
    }

    /** Fractal noise from several octaves */
    fbm(x: number, y: number, octaves: number, lacunarity: number = 2, gain: number = 0.5): number {
        let sum: number = 0
        let amplitude: number = 1
        let frequency: number = 1
        let norm: number = 0
        for (let o: number = 0; o < octaves; o++) {
            sum += this.noise2(x * frequency, y * frequency) * amplitude
            norm += amplitude
            amplitude *= gain
            frequency *= lacunarity
        }
        return sum / norm
    }
}
