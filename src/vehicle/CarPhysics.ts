import { Vector3 } from 'three'
import { MathUtils } from '../core/MathUtils'
import { DriveInput } from '../core/Input'
import { DrivePoint, WorldSurface } from '../world/WorldSurface'
import { RAIL_OFFSET } from '../world/WorldConfig'
import { Vegetation } from '../world/Vegetation'
import { SteeringAssist } from './SteeringAssist'
import { CarSpec } from './CarProfiles'

const GRAVITY: number = 9.81
/** Full steering input asks for this much more than the grip limit, so the limit can still be felt */
const STEER_GRIP_MARGIN: number = 1.25
/** Gap to the guardrail that still counts as touching it, m: without it contact flickers on and off every few steps */
const RAIL_SKIN: number = 0.03
/** How fast a nose pointing into the guardrail is turned along it, 1/s, and the speed at which this reaches full strength, m/s */
const RAIL_ALIGN_RATE: number = 3
const RAIL_ALIGN_SPEED: number = 4
/** Fastest the body is eased out of the guardrail on top of its own motion into it, m/s */
const RAIL_EASE_SPEED: number = 1.5

/**
 * Arcade car physics based on the bicycle model:
 * longitudinal traction and braking, lateral acceleration limited by grip,
 * rear-axle slide on the handbrake, jumps off crests, impacts with guardrails and trees.
 */
export class CarPhysics {
    readonly position: Vector3 = new Vector3()
    readonly velocity: Vector3 = new Vector3()
    yaw: number = 0
    yaw_rate: number = 0
    steer: number = 0
    private assist: SteeringAssist = new SteeringAssist()
    vertical_speed: number = 0
    grounded: boolean = true
    on_road: boolean = true
    pitch: number = 0
    roll: number = 0
    gear: number = 1
    rpm: number
    /** Longitudinal and lateral acceleration for body tilt */
    long_accel: number = 0
    lat_accel: number = 0
    /** Slip (0..1), used for tire sound and spray */
    slip: number = 0
    /** Strength of the last impact, decays over time */
    impact: number = 0
    /** Distance along the track at the car's position */
    along: number = 0
    /** Weather grip multiplier: snow is slippery, dry asphalt is grippy */
    surface_grip: number = 1

    /**
     * Render pose: interpolation between the two latest physics steps.
     * The physics step is fixed while frames run at a different rate; without interpolation the car moves jerkily.
     */
    readonly render_position: Vector3 = new Vector3()
    render_yaw: number = 0
    render_pitch: number = 0
    render_roll: number = 0
    private prev_position: Vector3 = new Vector3()
    private prev_yaw: number = 0
    private prev_pitch: number = 0
    private prev_roll: number = 0

    private wheelbase: number
    private half_width: number
    private half_length: number
    private landing: number = 0
    /** How far the body reached toward the guardrail on the previous step, m */
    private rail_extent: number = 0
    /** Guardrail contact, 0..1: fades out over a few steps after the body leaves the rail */
    private rail_contact: number = 0
    /** Outward guardrail normal and heading along the rail at the last contact */
    private rail_nx: number = 0
    private rail_nz: number = 0
    private rail_yaw: number = 0

    readonly spec: CarSpec

    constructor(wheelbase: number, width: number, length: number, spec: CarSpec) {
        this.spec = spec
        this.rpm = spec.idle_rpm
        this.wheelbase = wheelbase
        this.half_width = width * 0.5
        this.half_length = length * 0.5
    }

    get speed(): number {
        return Math.hypot(this.velocity.x, this.velocity.z)
    }

    get forward_speed(): number {
        return this.velocity.x * Math.sin(this.yaw) + this.velocity.z * Math.cos(this.yaw)
    }

    /** Places the car at a point with heading yaw and resets its motion */
    place(position: Vector3, yaw: number): void {
        this.position.copy(position)
        this.velocity.set(0, 0, 0)
        this.yaw = yaw
        this.yaw_rate = 0
        this.steer = 0
        this.assist.reset()
        this.rail_contact = 0
        this.vertical_speed = 0
        this.grounded = true
        // A teleport is not interpolated
        this.saveState()
        this.interpolate(1)
    }

    /** Pose between the previous (alpha = 0) and current (alpha = 1) physics step */
    interpolate(alpha: number): void {
        this.render_position.lerpVectors(this.prev_position, this.position, alpha)
        this.render_yaw = this.prev_yaw + MathUtils.wrapAngle(this.yaw - this.prev_yaw) * alpha
        this.render_pitch = MathUtils.lerp(this.prev_pitch, this.pitch, alpha)
        this.render_roll = MathUtils.lerp(this.prev_roll, this.roll, alpha)
    }

    private saveState(): void {
        this.prev_position.copy(this.position)
        this.prev_yaw = this.yaw
        this.prev_pitch = this.pitch
        this.prev_roll = this.roll
    }

    update(dt: number, input: DriveInput, surface: WorldSurface, vegetation: Vegetation): void {
        this.saveState()
        const fx: number = Math.sin(this.yaw)
        const fz: number = Math.cos(this.yaw)
        const rx: number = -fz
        const rz: number = fx
        let v_long: number = this.velocity.x * fx + this.velocity.z * fz
        let v_lat: number = this.velocity.x * rx + this.velocity.z * rz
        const speed: number = Math.abs(v_long)

        const spec: CarSpec = this.spec
        const grip: number = (this.on_road ? 1.0 : 0.62) * this.surface_grip * spec.grip
        // Lateral acceleration limit grows with downforce, otherwise the turning radius becomes huge at speed
        const downforce: number = 1 + spec.downforce * speed * speed * (this.on_road ? 1 : 0.5)
        const lat_limit: number = GRAVITY * grip * downforce * (input.handbrake ? 1.35 : 1.05)

        // Steering: max angle shrinks as speed grows, for stability. It is also capped near the angle that already
        // reaches the grip limit: otherwise at high speed a few percent of input turned as hard as the tires allow,
        // and every key tap or small stick correction swung the car from side to side
        const grip_steer: number = Math.atan(lat_limit * this.wheelbase / Math.max(speed * speed, 1)) * STEER_GRIP_MARGIN
        const max_steer: number = Math.min(spec.max_steer / (1 + speed * 0.035), grip_steer)
        const shaped: number = this.assist.shape(input, speed, dt)
        this.steer = MathUtils.damp(this.steer, shaped * max_steer, 18, dt)
        const traction: number = this.grounded ? 1 : 0

        // Longitudinal dynamics: throttle, brake/reverse, drag
        let accel: number = 0
        if (input.throttle > 0) {
            if (v_long < -0.5) accel += spec.brake_decel * input.throttle
            else accel += spec.engine_accel * input.throttle * (1 - Math.pow(Math.max(0, v_long) / spec.max_speed, 2)) * (this.on_road ? 1 : 0.7)
        }
        if (input.brake > 0) {
            if (v_long > 0.5) accel -= spec.brake_decel * input.brake * grip
            else accel -= spec.engine_accel * 0.6 * input.brake * (1 - Math.min(1, Math.max(0, -v_long) / spec.reverse_speed))
        }
        const drag: number = 0.35 + 0.00042 * v_long * v_long + (this.on_road ? 0 : 1.4 + 0.0035 * v_long * v_long)
        if (Math.abs(v_long) > 0.05) accel -= Math.sign(v_long) * drag
        else if (input.throttle === 0 && input.brake === 0) v_long = 0
        if (input.handbrake) accel -= Math.sign(v_long) * 4.5
        accel *= traction

        const slope: number = this.surfaceSlope(surface, fx, fz)
        accel -= GRAVITY * slope * traction
        v_long += accel * dt

        // Turning: bicycle-model target yaw rate, limited by grip
        let yaw_target: number = (v_long * Math.tan(this.steer)) / this.wheelbase
        // Track steering assist only when moving forward; while it helps, grip is slightly above normal
        const assist_active: boolean = v_long > 0 && !input.handbrake && this.on_road && this.grounded
        yaw_target += this.assist.yawAssist(surface, this.position, this.yaw, speed, shaped, assist_active, dt)
        const max_lat: number = lat_limit * this.assist.gripBonus(yaw_target)
        if (Math.abs(yaw_target * v_long) > max_lat && speed > 1) yaw_target = Math.sign(yaw_target) * max_lat / speed
        if (input.handbrake && speed > 6) yaw_target *= 1.55
        yaw_target = this.railAlign(yaw_target, speed)
        const yaw_response: number = (input.handbrake ? 3 : 7.5) * traction + 0.2
        this.yaw_rate = MathUtils.damp(this.yaw_rate, yaw_target * traction + this.yaw_rate * (1 - traction), yaw_response, dt)
        this.yaw += this.yaw_rate * dt

        // Re-project velocity into the new basis: the lagging velocity vector produces the slide
        const nfx: number = Math.sin(this.yaw)
        const nfz: number = Math.cos(this.yaw)
        const nrx: number = -nfz
        const nrz: number = nfx
        const world_x: number = fx * v_long + rx * v_lat
        const world_z: number = fz * v_long + rz * v_lat
        v_long = world_x * nfx + world_z * nfz
        v_lat = world_x * nrx + world_z * nrz
        const lateral_grip: number = (input.handbrake ? 1.1 : this.on_road ? 7.5 : 4.2) * traction * this.surface_grip * spec.grip
        const lat_before: number = v_lat
        v_lat *= Math.exp(-lateral_grip * dt)
        this.slip = MathUtils.damp(this.slip, MathUtils.clamp(Math.abs(lat_before) / 6, 0, 1), 8, dt)

        const prev_long: number = this.forward_speed
        this.velocity.x = nfx * v_long + nrx * v_lat
        this.velocity.z = nfz * v_long + nrz * v_lat
        this.long_accel = MathUtils.damp(this.long_accel, (v_long - prev_long) / dt, 6, dt)
        this.lat_accel = MathUtils.damp(this.lat_accel, this.yaw_rate * v_long, 6, dt)

        const prev_x: number = this.position.x
        const prev_z: number = this.position.z
        this.position.x += this.velocity.x * dt
        this.position.z += this.velocity.z * dt

        this.collideRails(surface, prev_x, prev_z, dt)
        this.collideTrees(vegetation)
        this.integrateVertical(dt, surface, nfx, nfz)
        this.updateGearbox(dt, v_long, input)
        this.impact = Math.max(0, this.impact - dt * 2)
    }

    /** Sine of the longitudinal slope under the car (positive means uphill) */
    private surfaceSlope(surface: WorldSurface, fx: number, fz: number): number {
        if (!this.grounded) return 0
        const front: number = surface.drive(this.position.x + fx * 1.2, this.position.z + fz * 1.2, this.position.y).height
        const back: number = surface.drive(this.position.x - fx * 1.2, this.position.z - fz * 1.2, this.position.y).height
        return (front - back) / 2.4
    }

    /**
     * While the body touches the guardrail, a nose pointing into it is turned along it through the yaw rate,
     * so the turn goes through the same smoothing as steering. A car standing still is not turned on the spot
     */
    private railAlign(yaw_target: number, speed: number): number {
        if (this.rail_contact <= 0) return yaw_target
        const fx: number = Math.sin(this.yaw)
        const fz: number = Math.cos(this.yaw)
        if (fx * this.rail_nx + fz * this.rail_nz >= 0) return yaw_target
        const align: number = MathUtils.wrapAngle(this.rail_yaw - this.yaw) * RAIL_ALIGN_RATE * Math.min(1, speed / RAIL_ALIGN_SPEED)
        // Steering further into the rail is replaced by the turn along it; steering away from it is kept
        if (yaw_target * align >= 0 && Math.abs(yaw_target) > Math.abs(align)) return yaw_target
        return MathUtils.lerp(yaw_target, align, this.rail_contact)
    }

    /**
     * A guardrail is a line at RAIL_OFFSET from the centerline. If the body has crossed it
     * on a side that has a guardrail, push the car back and kill its lateral velocity.
     * The body is a rectangle: at an angle to the road its corners reach further than half the width.
     * The side of the rail is decided by where the center was before the step, and the push-out per step
     * is limited to the motion into the rail plus a little, so a car entering a railed section
     * on the shoulder or swinging its tail is eased out instead of teleported.
     */
    private collideRails(surface: WorldSurface, prev_x: number, prev_z: number, dt: number): void {
        // Contact fades out instead of switching off, otherwise the turn along the rail jerks on and off
        this.rail_contact = Math.max(0, this.rail_contact - dt * 8)
        const point: DrivePoint = surface.drive(this.position.x, this.position.z, this.position.y)
        if (!point.projection) return
        const lateral: number = point.projection.lateral
        const side: number = Math.sign(lateral)
        const has_rail: boolean = side > 0 ? point.projection.segment.rail_right : point.projection.segment.rail_left
        if (!has_rail) return

        const prev: DrivePoint = surface.drive(prev_x, prev_z, this.position.y)
        const prev_lateral: number = prev.projection ? prev.projection.lateral : lateral
        const tangent: Vector3 = point.projection.tangent
        const fx: number = Math.sin(this.yaw)
        const fz: number = Math.cos(this.yaw)
        const cos_rel: number = Math.min(1, Math.abs(fx * tangent.x + fz * tangent.z))
        const sin_rel: number = Math.sqrt(1 - cos_rel * cos_rel)
        const extent: number = this.half_length * sin_rel + this.half_width * cos_rel
        const extent_growth: number = Math.max(0, extent - this.rail_extent)
        this.rail_extent = extent
        const inner_limit: number = RAIL_OFFSET - extent - 0.05
        const outer_limit: number = RAIL_OFFSET + extent + 0.15
        const abs_now: number = Math.abs(lateral)
        const abs_prev: number = Math.sign(prev_lateral) === side ? Math.abs(prev_lateral) : 0

        const inside: boolean = abs_prev < RAIL_OFFSET
        const gap: number = inside ? inner_limit - abs_now : abs_now - outer_limit
        if (gap > RAIL_SKIN) return

        // Guardrail normal points where the car is pushed out; v_normal < 0 means moving into the rail
        const right: Vector3 = point.projection.right
        const push: number = inside ? -side : side
        const nx: number = right.x * push
        const nz: number = right.z * push
        const along_sign: number = fx * tangent.x + fz * tangent.z >= 0 ? 1 : -1
        this.rail_contact = 1
        this.rail_nx = nx
        this.rail_nz = nz
        this.rail_yaw = Math.atan2(tangent.x * along_sign, tangent.z * along_sign)

        if (gap < 0) {
            const max_step: number = Math.abs(abs_now - abs_prev) + extent_growth + RAIL_EASE_SPEED * dt
            const correction: number = Math.min(-gap, max_step)
            this.position.x += nx * correction
            this.position.z += nz * correction
        }

        const v_normal: number = this.velocity.x * nx + this.velocity.z * nz
        if (v_normal >= 0) return

        // The car slides along the rail: the speed into the rail is removed, and only a hard hit
        // bounces back a little. Coulomb friction: the longitudinal loss is proportional to the impact.
        const v_in: number = -v_normal
        const bounce: number = Math.max(0, v_in - 4) * 0.25
        const v_tangent: number = this.velocity.x * tangent.x + this.velocity.z * tangent.z
        const friction: number = Math.min(Math.abs(v_tangent), v_in * 0.3)
        const new_tangent: number = v_tangent - Math.sign(v_tangent) * friction
        this.velocity.x = tangent.x * new_tangent + nx * bounce
        this.velocity.z = tangent.z * new_tangent + nz * bounce
        // Scraping along the rail doesn't shake the camera, only a real hit does
        if (v_in > 1.5) this.impact = Math.min(1, this.impact + v_in / 12)
    }

    private collideTrees(vegetation: Vegetation): void {
        const normal: Vector3 | null = vegetation.collideBox(this.position, this.prev_position, this.yaw, this.half_width + 0.05, this.half_length + 0.05)
        if (!normal) return
        const v_normal: number = this.velocity.x * normal.x + this.velocity.z * normal.z
        if (v_normal < 0) {
            this.velocity.x -= normal.x * v_normal * 1.3
            this.velocity.z -= normal.z * v_normal * 1.3
            this.impact = Math.min(1, this.impact + Math.abs(v_normal) / 10)
        }
        this.velocity.multiplyScalar(0.9)
    }

    /** Vertical: ground following, lift-off on crests and body tilt along the terrain */
    private integrateVertical(dt: number, surface: WorldSurface, fx: number, fz: number): void {
        const center: DrivePoint = surface.drive(this.position.x, this.position.z, this.position.y)
        this.on_road = center.on_road
        if (center.projection) this.along = center.projection.along

        const ground: number = center.height
        this.vertical_speed -= GRAVITY * 1.5 * dt
        const next_y: number = this.position.y + this.vertical_speed * dt
        if (next_y <= ground) {
            if (!this.grounded && this.vertical_speed < -3) this.landing = Math.min(1, -this.vertical_speed / 12)
            const ground_rate: number = (ground - this.position.y) / dt
            this.position.y = ground
            this.vertical_speed = Math.max(Math.min(ground_rate, 12), -40)
            this.grounded = true
        } else {
            this.position.y = next_y
            this.grounded = next_y - ground < 0.05
        }
        this.landing = Math.max(0, this.landing - dt * 3)

        // Tilt from four contact points
        const rx: number = -fz
        const rz: number = fx
        const l: number = this.half_length * 0.6
        const w: number = this.half_width * 0.85
        const h_front: number = surface.drive(this.position.x + fx * l, this.position.z + fz * l, this.position.y).height
        const h_back: number = surface.drive(this.position.x - fx * l, this.position.z - fz * l, this.position.y).height
        const h_right: number = surface.drive(this.position.x + rx * w, this.position.z + rz * w, this.position.y).height
        const h_left: number = surface.drive(this.position.x - rx * w, this.position.z - rz * w, this.position.y).height
        const target_pitch: number = Math.atan2(h_back - h_front, l * 2)
        const target_roll: number = Math.atan2(h_left - h_right, w * 2)
        const lambda: number = this.grounded ? 14 : 1.5
        this.pitch = MathUtils.damp(this.pitch, target_pitch, lambda, dt)
        this.roll = MathUtils.damp(this.roll, target_roll, lambda, dt)
    }

    /** Landing impact, 0..1, used by the suspension and camera */
    get landing_impact(): number {
        return this.landing
    }

    private updateGearbox(dt: number, v_long: number, input: DriveInput): void {
        const spec: CarSpec = this.spec
        const gears: number[] = spec.gear_top
        const speed: number = Math.abs(v_long)
        if (v_long < -0.5) {
            this.gear = -1
        } else {
            if (this.gear < 1) this.gear = 1
            const top: number = gears[this.gear - 1]
            const bottom: number = this.gear > 1 ? gears[this.gear - 2] : 0
            if (speed > top * 0.97 && this.gear < gears.length) this.gear++
            else if (speed < bottom * 0.72 && this.gear > 1) this.gear--
        }
        const gear_index: number = Math.max(1, this.gear)
        const top: number = this.gear < 0 ? spec.reverse_speed : gears[gear_index - 1]
        const bottom: number = this.gear > 1 ? gears[gear_index - 2] * 0.55 : 0
        const ratio: number = MathUtils.clamp((speed - bottom) / (top - bottom), 0, 1)
        const range: number = spec.redline_rpm - spec.idle_rpm
        let target: number = spec.idle_rpm + ratio * range
        // Launch: the clutch slips and holds the engine around a third of its range
        if (input.throttle > 0 && speed < 3) target = Math.max(target, spec.idle_rpm + range * 0.33)
        this.rpm = MathUtils.damp(this.rpm, target, 10, dt)
    }
}
