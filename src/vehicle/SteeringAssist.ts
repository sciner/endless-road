import { Vector3 } from 'three'
import { MathUtils } from '../core/MathUtils'
import { DriveInput } from '../core/Input'
import { DrivePoint, WorldSurface } from '../world/WorldSurface'
import { RAIL_OFFSET } from '../world/WorldConfig'

/** Time to reach full lock from keys: when stationary and at high speed */
const RAMP_TIME_SLOW: number = 0.2
const RAMP_TIME_FAST: number = 0.42
const RETURN_TIME: number = 0.12
/** Speed (m/s) at which steering build-up becomes slowest */
const RAMP_FAST_SPEED: number = 45
/** Strength of steering toward the track direction, 1/s, and max heading correction */
const ASSIST_GAIN: number = 2.4
const ASSIST_MAX_ERROR: number = 0.45
/** How far the assist may exceed the normal grip limit */
const ASSIST_GRIP_BONUS: number = 0.3
/** Assist weight with no steering input, and heading error dead zone, rad */
const ASSIST_IDLE_WEIGHT: number = 0.12
const ASSIST_DEADBAND: number = 0.025

/**
 * NFS-style arcade steering assist: fast but not twitchy angle build-up from keys
 * and steering along the track when the player turns toward the road
 */
export class SteeringAssist {
    /** Accumulated steering key hold, -1..1 */
    private hold: number = 0
    private ahead: Vector3 = new Vector3()
    /** Smoothed yaw rate offset */
    private output: number = 0

    reset(): void {
        this.hold = 0
        this.output = 0
    }

    /** Normalized steering -1..1: stick as is, keys by hold time */
    shape(input: DriveInput, speed: number, dt: number): number {
        if (input.steer_analog) {
            this.hold = input.steer
            return input.steer
        }
        const direction: number = input.steer
        const returning: boolean = direction === 0 || direction * this.hold < 0
        const ramp: number = MathUtils.lerp(RAMP_TIME_SLOW, RAMP_TIME_FAST, MathUtils.clamp(speed / RAMP_FAST_SPEED, 0, 1))
        const rate: number = dt / (returning ? RETURN_TIME : ramp)
        // Reversing direction first passes quickly through center
        const target: number = returning && direction !== 0 && Math.abs(this.hold) > rate ? 0 : direction
        if (this.hold < target) this.hold = Math.min(target, this.hold + rate)
        else this.hold = Math.max(target, this.hold - rate)
        // Curve slightly softer than linear: a tap gives a small angle, but steering responds immediately with no dead start
        const magnitude: number = Math.abs(this.hold)
        return Math.sign(this.hold) * Math.pow(magnitude, 1.35)
    }

    /**
     * Yaw rate offset that turns the car toward the track heading ahead.
     * steer is normalized steering; positive yaw rate turns left
     */
    yawAssist(surface: WorldSurface, position: Vector3, yaw: number, speed: number, steer: number, active: boolean, dt: number): number {
        const target: number = active && speed > 6 ? this.targetAssist(surface, position, yaw, speed, steer) : 0
        // Time smoothing: the assist doesn't jerk the heading even on abrupt steering changes
        this.output = MathUtils.damp(this.output, target, 5, dt)
        return this.output
    }

    private targetAssist(surface: WorldSurface, position: Vector3, yaw: number, speed: number, steer: number): number {
        const here: DrivePoint = surface.drive(position.x, position.z)
        if (!here.projection) return 0
        const fx: number = Math.sin(yaw)
        const fz: number = Math.cos(yaw)

        // Look-ahead point is taken along the track, not along the car's nose: otherwise turning moves the target and the heading oscillates
        const here_tangent: Vector3 = here.projection.tangent
        const here_sign: number = here_tangent.x * fx + here_tangent.z * fz >= 0 ? 1 : -1
        const look: number = 6 + speed * 0.45
        this.ahead.set(position.x + here_tangent.x * here_sign * look, position.y, position.z + here_tangent.z * here_sign * look)
        const point: DrivePoint = surface.drive(this.ahead.x, this.ahead.z)
        if (!point.projection) return 0

        const tangent: Vector3 = point.projection.tangent
        const along_sign: number = tangent.x * fx + tangent.z * fz >= 0 ? 1 : -1
        const road_yaw: number = Math.atan2(tangent.x * along_sign, tangent.z * along_sign)
        let error: number = MathUtils.wrapAngle(road_yaw - yaw)
        // A car facing backwards or sideways is not corrected: that's the player's choice
        if (Math.abs(error) > 1.2) return 0

        // Near the road edge the heading is nudged toward center so the assist doesn't press the car into the rail
        const lateral: number = here.projection.lateral * here_sign
        const edge: number = RAIL_OFFSET - 2.2
        if (Math.abs(lateral) > edge) error += Math.sign(lateral) * Math.min(0.15, (Math.abs(lateral) - edge) * 0.08)
        // Small deviations on straights are ignored so the assist doesn't "hunt" for the heading
        error = Math.sign(error) * Math.max(0, Math.abs(error) - ASSIST_DEADBAND)
        error = MathUtils.clamp(error, -ASSIST_MAX_ERROR, ASSIST_MAX_ERROR)

        // Weight varies continuously: steering toward the track gives up to full assist, no steering a light alignment, steering against it down to zero
        const agreement: number = steer * Math.sign(error)
        const weight: number = agreement >= 0
            ? ASSIST_IDLE_WEIGHT + (1 - ASSIST_IDLE_WEIGHT) * agreement
            : ASSIST_IDLE_WEIGHT * Math.max(0, 1 + agreement * 3)

        const speed_fade: number = MathUtils.smoothstep(6, 18, speed)
        return error * ASSIST_GAIN * weight * speed_fade
    }

    /** Grip limit multiplier: grows smoothly with assist directed into the turn */
    gripBonus(yaw_target: number): number {
        if (this.output * yaw_target <= 0) return 1
        return 1 + ASSIST_GRIP_BONUS * Math.min(1, Math.abs(this.output) / 0.4)
    }
}
