import { SimplexNoise } from '../core/SimplexNoise'

/**
 * Natural terrain without the road: large hills, ridges and small bumps
 */
export class Landscape {
    private macro_noise: SimplexNoise
    private ridge_noise: SimplexNoise
    private detail_noise: SimplexNoise

    constructor(seed: number) {
        this.macro_noise = new SimplexNoise(seed ^ 0x51a3)
        this.ridge_noise = new SimplexNoise(seed ^ 0x7c21)
        this.detail_noise = new SimplexNoise(seed ^ 0x1f99)
    }

    /** Smoothed height of large-scale landforms; the road elevation profile follows it */
    baseHeight(x: number, z: number): number {
        const valleys: number = this.macro_noise.noise2(x * 0.0006, z * 0.0006) * 42
        const hills: number = this.macro_noise.fbm(x * 0.0021 + 31.7, z * 0.0021 - 12.3, 4) * 26
        return valleys + hills
    }

    /** Full height of the natural terrain */
    naturalHeight(x: number, z: number): number {
        const ridge_raw: number = 1 - Math.abs(this.ridge_noise.fbm(x * 0.0045, z * 0.0045, 3))
        const ridges: number = ridge_raw * ridge_raw * 9 - 4
        const detail: number = this.detail_noise.fbm(x * 0.035, z * 0.035, 3) * 1.1
        return this.baseHeight(x, z) + ridges + detail
    }
}
