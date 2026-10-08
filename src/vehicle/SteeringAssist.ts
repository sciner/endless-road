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
/**
 * Above this speed, m/s, the gain falls as 1/speed: the same yaw rate at high speed means
 * a much larger lateral acceleration, and a stiff assist starts swinging the car
 */
const ASSIST_FULL_GAIN_SPEED: number = 32
/** How far the assist may exceed the normal grip limit */
const ASSIST_GRIP_BONUS: number = 0.3
/** Assist weight with no steering input, and heading error dead zone, rad */
const ASSIST_IDLE_WEIGHT: number = 0.12
const ASSIST_DEADBAND: number = 0.025
/** The dead zone also never lets the car drift sideways faster than this, m/s */
const ASSIST_DEADBAND_DRIFT: number = 0.3
/** Distance from the centerline where the push away from the rail starts, m */
const EDGE_START: number = RAIL_OFFSET - 2.2
/** Lateral speed toward the center per meter past EDGE_START, 1/s, and its limit, m/s */
const EDGE_PUSH_RATE: number = 1.0
const EDGE_PUSH_MAX: number = 1.5
/** Depth past EDGE_START at which the push works at full weight regardless of steering, m */
const EDGE_FULL_DEPTH: number = 0.8

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
    /** Smoothed assist weight and the target weight from the last track query */
    private weight: number = 0
    private target_weight: number = 0

    reset(): void {
        this.hold = 0
        this.output = 0
        this.weight = 0
        this.target_weight = 0
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
        this.target_weight = 0
        const error: number = active && speed > 6 ? this.headingError(surface, position, yaw, speed, steer) : 0
        // Only the weight is smoothed slowly, so abrupt steering changes don't jerk the heading.
        // The error itself goes through with little lag: a slow filter inside the feedback loop is what made the car overshoot and swing
        this.weight = MathUtils.damp(this.weight, this.target_weight, 6, dt)
        const gain: number = ASSIST_GAIN * Math.min(1, ASSIST_FULL_GAIN_SPEED / Math.max(speed, 1)) * MathUtils.smoothstep(6, 18, speed)
        this.output = MathUtils.damp(this.output, error * gain * this.weight, 14, dt)
        return this.output
    }

    /** Heading correction toward the track, rad; also sets target_weight */
    private headingError(surface: WorldSurface, position: Vector3, yaw: number, speed: number, steer: number): number {
        const here: DrivePoint = surface.drive(position.x, position.z, position.y)
        if (!here.projection) return 0
        const fx: number = Math.sin(yaw)
        const fz: number = Math.cos(yaw)

        // Look-ahead point is taken along the track, not along the car's nose: otherwise turning moves the target and the heading oscillates
        const here_tangent: Vector3 = here.projection.tangent
        const here_sign: number = here_tangent.x * fx + here_tangent.z * fz >= 0 ? 1 : -1
        const look: number = 6 + speed * 0.45
        this.ahead.set(position.x + here_tangent.x * here_sign * look, position.y, position.z + here_tangent.z * here_sign * look)
        const point: DrivePoint = surface.drive(this.ahead.x, this.ahead.z, position.y)
        if (!point.projection) return 0

        const tangent: Vector3 = point.projection.tangent
        const along_sign: number = tangent.x * fx + tangent.z * fz >= 0 ? 1 : -1
        const road_yaw: number = Math.atan2(tangent.x * along_sign, tangent.z * along_sign)
        let error: number = MathUtils.wrapAngle(road_yaw - yaw)
        // A car facing backwards or sideways is not corrected: that's the player's choice
        if (Math.abs(error) > 1.2) return 0

        // Near the road edge the car is steered toward center. The push is set as a lateral speed, not a heading angle:
        // a fixed angle at high speed means a fast sideways dash that carried the car across the road to the other edge and back
        const lateral: number = here.projection.lateral * here_sign
        const depth: number = Math.abs(lateral) - EDGE_START
        let edge_weight: number = 0
        if (depth > 0) {
            error += Math.sign(lateral) * Math.min(EDGE_PUSH_MAX, depth * EDGE_PUSH_RATE) / speed
            edge_weight = MathUtils.clamp(depth / EDGE_FULL_DEPTH, 0, 1)
        }
        // Small deviations on straights are ignored so the assist doesn't "hunt" for the heading.
        // At high speed the dead zone narrows, otherwise the car drifts sideways uncorrected
        const deadband: number = Math.min(ASSIST_DEADBAND, ASSIST_DEADBAND_DRIFT / speed)
        error = Math.sign(error) * Math.max(0, Math.abs(error) - deadband)
        error = MathUtils.clamp(error, -ASSIST_MAX_ERROR, ASSIST_MAX_ERROR)

        // Weight varies continuously: steering toward the track gives up to full assist, no steering a light alignment, steering against it down to zero.
        // The error sign is softened near zero so the weight doesn't flip at every crossing of the track heading
        const agreement: number = steer * MathUtils.clamp(error / 0.04, -1, 1)
        const weight: number = agreement >= 0
            ? ASSIST_IDLE_WEIGHT + (1 - ASSIST_IDLE_WEIGHT) * agreement
            : ASSIST_IDLE_WEIGHT * Math.max(0, 1 + agreement * 3)
        this.target_weight = Math.max(weight, edge_weight)
        return error
    }

    /** Grip limit multiplier: grows smoothly with assist directed into the turn */
    gripBonus(yaw_target: number): number {
        if (this.output * yaw_target <= 0) return 1
        return 1 + ASSIST_GRIP_BONUS * Math.min(1, Math.abs(this.output) / 0.4)
    }
}
