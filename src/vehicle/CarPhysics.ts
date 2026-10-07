import { Vector3 } from 'three'
import { MathUtils } from '../core/MathUtils'
import { DriveInput } from '../core/Input'
import { DrivePoint, WorldSurface } from '../world/WorldSurface'
import { RAIL_OFFSET } from '../world/WorldConfig'
import { Vegetation } from '../world/Vegetation'
import { SteeringAssist } from './SteeringAssist'
import { CarSpec } from './CarProfiles'

const GRAVITY: number = 9.81

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

        // Steering: max angle shrinks as speed grows, for stability
        const spec: CarSpec = this.spec
        const max_steer: number = spec.max_steer / (1 + speed * 0.035)
        const shaped: number = this.assist.shape(input, speed, dt)
        this.steer = MathUtils.damp(this.steer, shaped * max_steer, 18, dt)

        const grip: number = (this.on_road ? 1.0 : 0.62) * this.surface_grip * spec.grip
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
        // Lateral acceleration limit grows with downforce, otherwise the turning radius becomes huge at speed
        const downforce: number = 1 + spec.downforce * speed * speed * (this.on_road ? 1 : 0.5)
        // Track steering assist only when moving forward; while it helps, grip is slightly above normal
        const assist_active: boolean = v_long > 0 && !input.handbrake && this.on_road && this.grounded
        yaw_target += this.assist.yawAssist(surface, this.position, this.yaw, speed, shaped, assist_active, dt)
        const max_lat: number = GRAVITY * grip * downforce * (input.handbrake ? 1.35 : 1.05) * this.assist.gripBonus(yaw_target)
        if (Math.abs(yaw_target * v_long) > max_lat && speed > 1) yaw_target = Math.sign(yaw_target) * max_lat / speed
        if (input.handbrake && speed > 6) yaw_target *= 1.55
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

        this.collideRails(surface, prev_x, prev_z)
        this.collideTrees(vegetation)
        this.integrateVertical(dt, surface, nfx, nfz)
        this.updateGearbox(dt, v_long, input)
        this.impact = Math.max(0, this.impact - dt * 2)
    }

    /** Sine of the longitudinal slope under the car (positive means uphill) */
    private surfaceSlope(surface: WorldSurface, fx: number, fz: number): number {
        if (!this.grounded) return 0
        const front: number = surface.drive(this.position.x + fx * 1.2, this.position.z + fz * 1.2).height
        const back: number = surface.drive(this.position.x - fx * 1.2, this.position.z - fz * 1.2).height
        return (front - back) / 2.4
    }

    /**
     * A guardrail is a line at RAIL_OFFSET from the centerline. If the body has crossed it
     * on a side that has a guardrail, push the car back and kill its lateral velocity.
     */
    private collideRails(surface: WorldSurface, prev_x: number, prev_z: number): void {
        const point: DrivePoint = surface.drive(this.position.x, this.position.z)
        if (!point.projection) return
        const lateral: number = point.projection.lateral
        const side: number = Math.sign(lateral)
        const has_rail: boolean = side > 0 ? point.projection.segment.rail_right : point.projection.segment.rail_left
        if (!has_rail) return

        const prev: DrivePoint = surface.drive(prev_x, prev_z)
        const prev_lateral: number = prev.projection ? prev.projection.lateral : lateral
        const inner_limit: number = RAIL_OFFSET - this.half_width - 0.05
        const outer_limit: number = RAIL_OFFSET + this.half_width + 0.15
        const abs_now: number = Math.abs(lateral)
        const abs_prev: number = Math.abs(prev_lateral)

        let target: number | null = null
        if (abs_prev <= inner_limit + 0.4 && abs_now > inner_limit) target = inner_limit
        else if (abs_prev >= outer_limit - 0.4 && abs_now < outer_limit) target = outer_limit
        if (target === null) return

        const correction: number = (target - abs_now) * side
        const right: Vector3 = point.projection.right
        this.position.x += right.x * correction
        this.position.z += right.z * correction

        // Guardrail normal points where the car is pushed out; v_normal < 0 means moving into the rail
        const push: number = Math.sign(correction)
        const nx: number = right.x * push
        const nz: number = right.z * push
        const v_normal: number = this.velocity.x * nx + this.velocity.z * nz
        if (v_normal >= 0) return

        const tangent: Vector3 = point.projection.tangent
        const v_tangent: number = this.velocity.x * tangent.x + this.velocity.z * tangent.z
        // Bounce with a minimum push-out speed so the car doesn't "stick" on grazing contact,
        // and Coulomb friction: longitudinal loss is proportional to impact strength, not contact time
        const bounce: number = Math.max(-v_normal * 0.3, 1.2)
        const friction: number = Math.min(Math.abs(v_tangent), -v_normal * 0.3)
        const new_tangent: number = v_tangent - Math.sign(v_tangent) * friction
        this.velocity.x = tangent.x * new_tangent + nx * bounce
        this.velocity.z = tangent.z * new_tangent + nz * bounce
        this.impact = Math.min(1, this.impact + -v_normal / 12)

        // A nose pointing into the rail is partly turned along it, otherwise tire grip pulls the car back into the rail
        const fx: number = Math.sin(this.yaw)
        const fz: number = Math.cos(this.yaw)
        if (fx * nx + fz * nz < 0) {
            const along_sign: number = fx * tangent.x + fz * tangent.z >= 0 ? 1 : -1
            const rail_yaw: number = Math.atan2(tangent.x * along_sign, tangent.z * along_sign)
            this.yaw += MathUtils.wrapAngle(rail_yaw - this.yaw) * 0.5
            this.yaw_rate *= 0.5
        }
    }

    private collideTrees(vegetation: Vegetation): void {
        const normal: Vector3 | null = vegetation.collide(this.position, this.half_width + 0.15)
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
        const center: DrivePoint = surface.drive(this.position.x, this.position.z)
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
        const h_front: number = surface.drive(this.position.x + fx * l, this.position.z + fz * l).height
        const h_back: number = surface.drive(this.position.x - fx * l, this.position.z - fz * l).height
        const h_right: number = surface.drive(this.position.x + rx * w, this.position.z + rz * w).height
        const h_left: number = surface.drive(this.position.x - rx * w, this.position.z - rz * w).height
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
