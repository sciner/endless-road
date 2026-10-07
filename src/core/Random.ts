/**
 * Deterministic pseudo-random number generator (mulberry32).
 * The same seed always yields the same sequence.
 */
export class Random {
    private state: number

    constructor(seed: number) {
        this.state = (seed >>> 0) || 0x9e3779b9
    }

    /** Next number in the range [0, 1) */
    next(): number {
        this.state = (this.state + 0x6d2b79f5) >>> 0
        let t: number = this.state
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }

    /** Number in the range [min, max) */
    range(min: number, max: number): number {
        return min + (max - min) * this.next()
    }

    /** Integer in the range [min, max] */
    int(min: number, max: number): number {
        return Math.floor(this.range(min, max + 1))
    }

    /** true with the given probability */
    chance(probability: number): boolean {
        return this.next() < probability
    }

    /** Random sign: -1 or 1 */
    sign(): number {
        return this.next() < 0.5 ? -1 : 1
    }

    /** Mixes several integers into a single 32-bit seed */
    static hash(a: number, b: number, c: number): number {
        let h: number = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1)
        h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
        h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
        return (h ^ (h >>> 16)) >>> 0
    }
}
