/**
 * A small set of math helpers missing from THREE.MathUtils
 */
export class MathUtils {
    static smoothstep(edge0: number, edge1: number, x: number): number {
        const t: number = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
        return t * t * (3 - 2 * t)
    }

    static clamp(value: number, min: number, max: number): number {
        return value < min ? min : value > max ? max : value
    }

    static lerp(a: number, b: number, t: number): number {
        return a + (b - a) * t
    }

    /** Frame-rate-independent exponential smoothing */
    static damp(current: number, target: number, lambda: number, dt: number): number {
        return current + (target - current) * (1 - Math.exp(-lambda * dt))
    }

    /** Wraps an angle into the range [-PI, PI] */
    static wrapAngle(angle: number): number {
        let a: number = angle
        while (a > Math.PI) a -= Math.PI * 2
        while (a < -Math.PI) a += Math.PI * 2
        return a
    }

    /** Smooths an angle along the shortest arc */
    static dampAngle(current: number, target: number, lambda: number, dt: number): number {
        const delta: number = MathUtils.wrapAngle(target - current)
        return current + delta * (1 - Math.exp(-lambda * dt))
    }
}
