import { Euler, PerspectiveCamera, Quaternion, Vector3 } from 'three'
import { MathUtils } from '../core/MathUtils'
import { CarPhysics } from '../vehicle/CarPhysics'
import { CockpitView } from '../vehicle/CarProfiles'
import { WorldSurface } from '../world/WorldSurface'

/** Parameters of a single camera mode */
interface CameraMode {
    distance: number
    height: number
    look_ahead: number
    look_height: number
    stiffness: number
    /** Camera is attached to the body (cockpit view); eye position then comes from the car's cockpit, not from the mode */
    rigid: boolean
}

const MODES: CameraMode[] = [
    { distance: 6.6, height: 2.05, look_ahead: 4.5, look_height: 0.95, stiffness: 5.5, rigid: false },
    { distance: 9.5, height: 3.1, look_ahead: 5.0, look_height: 1.0, stiffness: 4.0, rigid: false },
    { distance: -0.35, height: 1.12, look_ahead: 12, look_height: 1.0, stiffness: 40, rigid: true },
]

/** Menu orbit around the car: radius, m, sweep speed, rad/s, arc span, rad, and framing offset, m */
const SHOWCASE_RADIUS: number = 6.1
const SHOWCASE_SPEED: number = 0.16
const SHOWCASE_ARC: number = 1.05
const SHOWCASE_SHIFT: number = 1.4
const SHOWCASE_FOV: number = 54
const UP: Vector3 = new Vector3(0, 1, 0)
/** Duration of the camera flight from the menu to the car, s */
const TRANSITION_TIME: number = 2.2
/** Camera rise at mid-flight, like a camera crane, m */
const TRANSITION_LIFT: number = 1.1

/**
 * Chase camera: lags softly behind the heading, widens FOV with speed,
 * shakes on impacts and never sinks below the ground
 */
export class CameraRig {
    readonly camera: PerspectiveCamera
    private mode: number = 0
    private yaw: number = 0
    private position: Vector3 = new Vector3()
    private shake_time: number = 0
    private initialized: boolean = false
    private showcase_angle: number = 0
    private transition: number = 1
    /** Camera and look-at positions relative to the car at the start of the flight */
    private transition_offset: Vector3 = new Vector3()
    private transition_look: Vector3 = new Vector3()
    private transition_fov: number = 60
    /** Point the current camera mode looks at */
    private look_point: Vector3 = new Vector3()
    /** Mode FOV ignoring the flight, smoothed separately from the camera */
    private fov: number = 60
    /** Eye position of the attached camera; each car has its own cabin */
    private cockpit: CockpitView = { distance: -0.35, height: 1.12, look_height: 1.0 }

    constructor(aspect: number) {
        this.camera = new PerspectiveCamera(60, aspect, 0.1, 4000)
    }

    setCockpit(cockpit: CockpitView): void {
        this.cockpit = cockpit
    }

    get mode_index(): number {
        return this.mode
    }

    nextMode(): void {
        this.mode = (this.mode + 1) % MODES.length
    }

    setMode(mode: number): void {
        this.mode = ((mode % MODES.length) + MODES.length) % MODES.length
    }

    snap(): void {
        this.initialized = false
    }

    /** Slow orbit around the parked car as the menu background */
    showcase(dt: number, car: CarPhysics, surface: WorldSurface): void {
        // The camera sweeps an arc on the left side (the roadway side) without going over the roadside
        this.showcase_angle += dt * SHOWCASE_SPEED
        const car_position: Vector3 = car.render_position
        const angle: number = car.render_yaw + Math.PI * 0.5 + Math.sin(this.showcase_angle) * SHOWCASE_ARC
        const x: number = car_position.x + Math.sin(angle) * SHOWCASE_RADIUS
        const z: number = car_position.z + Math.cos(angle) * SHOWCASE_RADIUS
        const ground: number = surface.drive(x, z, car_position.y).height
        this.camera.position.set(x, Math.max(car_position.y + 1.25, ground + 0.8), z)
        this.camera.up.copy(UP)

        // The look-at point is shifted left of the car so it sits in the right part of the frame, not under the menu
        const look: Vector3 = new Vector3(car_position.x, car_position.y + 0.6, car_position.z)
        const view_right: Vector3 = new Vector3().subVectors(look, this.camera.position).cross(UP).normalize()
        look.addScaledVector(view_right, -SHOWCASE_SHIFT)
        this.look_point.copy(look)
        this.camera.lookAt(look)
        this.fov = SHOWCASE_FOV
        this.camera.fov = SHOWCASE_FOV
        this.camera.updateProjectionMatrix()
        this.initialized = false
    }

    /** Over the next frames the camera flies around the car from its current position to the selected mode's position */
    beginTransition(car: CarPhysics): void {
        this.transition_offset.subVectors(this.camera.position, car.render_position)
        this.transition_look.subVectors(this.look_point, car.render_position)
        this.transition_fov = this.camera.fov
        this.transition = 0
    }

    update(dt: number, car: CarPhysics, surface: WorldSurface): void {
        this.follow(dt, car, surface)
        if (this.transition >= 1) return
        this.transition = Math.min(1, this.transition + dt / TRANSITION_TIME)
        this.fly(car, surface)
    }

    /**
     * Arc flight around the car: angle, radius and height are interpolated in coordinates
     * relative to the car, so the camera flies around it instead of through the body,
     * and the car stays in frame the whole time, even if it has already started moving
     */
    private fly(car: CarPhysics, surface: WorldSurface): void {
        const x: number = this.transition
        // Smooth start and soft deceleration with no jerk at the end (smootherstep)
        const t: number = x * x * x * (x * (x * 6 - 15) + 10)
        const car_position: Vector3 = car.render_position
        const start: Vector3 = this.transition_offset
        const end: Vector3 = new Vector3().subVectors(this.camera.position, car_position)

        const start_angle: number = Math.atan2(start.x, start.z)
        const angle: number = start_angle + MathUtils.wrapAngle(Math.atan2(end.x, end.z) - start_angle) * t
        const radius: number = MathUtils.lerp(Math.hypot(start.x, start.z), Math.hypot(end.x, end.z), t)
        const height: number = MathUtils.lerp(start.y, end.y, t) + Math.sin(Math.PI * t) * TRANSITION_LIFT
        const eye: Vector3 = new Vector3(Math.sin(angle) * radius, height, Math.cos(angle) * radius).add(car_position)
        eye.y = Math.max(eye.y, surface.drive(eye.x, eye.z, car_position.y).height + 0.6)

        const end_look: Vector3 = new Vector3().subVectors(this.look_point, car_position)
        const look: Vector3 = new Vector3().lerpVectors(this.transition_look, end_look, t).add(car_position)

        this.camera.position.copy(eye)
        this.camera.up.copy(UP)
        this.camera.lookAt(look)
        this.camera.fov = MathUtils.lerp(this.transition_fov, this.fov, t)
        this.camera.updateProjectionMatrix()
    }

    private follow(dt: number, car: CarPhysics, surface: WorldSurface): void {
        const mode: CameraMode = MODES[this.mode]
        const speed: number = car.speed
        const car_position: Vector3 = car.render_position

        // The camera follows the car's heading; in a slide it looks slightly along the velocity vector
        let heading: number = car.render_yaw
        if (speed > 8 && car.forward_speed > 0) {
            const velocity_heading: number = Math.atan2(car.velocity.x, car.velocity.z)
            heading = car.render_yaw + MathUtils.wrapAngle(velocity_heading - car.render_yaw) * 0.35
        }
        if (!this.initialized) this.yaw = heading
        this.yaw = MathUtils.dampAngle(this.yaw, heading, mode.stiffness, dt)
        this.shake_time += dt

        if (mode.rigid) {
            this.mountOnCar(car, mode)
        } else {
            const fx: number = Math.sin(this.yaw)
            const fz: number = Math.cos(this.yaw)
            const speed_pull: number = Math.min(speed * 0.012, 0.9)
            const target: Vector3 = new Vector3(
                car_position.x - fx * (mode.distance + speed_pull),
                car_position.y + mode.height,
                car_position.z - fz * (mode.distance + speed_pull),
            )
            if (!this.initialized) this.position.copy(target)
            this.position.x = target.x
            this.position.z = target.z
            this.position.y = MathUtils.damp(this.position.y, target.y, mode.stiffness * 1.5, dt)

            // Keep the camera above the terrain
            const ground: number = surface.drive(this.position.x, this.position.z, car_position.y).height
            this.position.y = Math.max(this.position.y, ground + 0.6)

            // Only impacts and landings shake the camera. A constant speed shake made the car on screen trace a figure-eight
            const shake: number = car.impact * 0.12 + car.landing_impact * 0.06
            this.camera.up.copy(UP)
            this.camera.position.copy(this.position)
            this.camera.position.x += Math.sin(this.shake_time * 37) * shake
            this.camera.position.y += Math.sin(this.shake_time * 29 + 1.3) * shake
            this.look_point.set(
                car_position.x + Math.sin(car.render_yaw) * mode.look_ahead,
                car_position.y + mode.look_height,
                car_position.z + Math.cos(car.render_yaw) * mode.look_ahead,
            )
            this.camera.lookAt(this.look_point)
        }
        this.initialized = true

        const fov: number = 58 + Math.min(speed, 75) * 0.16
        this.fov = MathUtils.damp(this.fov, fov, 3, dt)
        this.camera.fov = this.fov
        this.camera.updateProjectionMatrix()
    }

    /**
     * The camera is rigidly attached to the body: it tilts with the car and has no
     * smoothing of its own, otherwise the hood "floats" relative to the view. It shakes only on impacts.
     */
    private mountOnCar(car: CarPhysics, mode: CameraMode): void {
        const orientation: Quaternion = new Quaternion().setFromEuler(new Euler(car.render_pitch, car.render_yaw, car.render_roll, 'YXZ'))
        const cockpit: CockpitView = this.cockpit
        const eye: Vector3 = new Vector3(0, cockpit.height, -cockpit.distance).applyQuaternion(orientation).add(car.render_position)
        const look: Vector3 = new Vector3(0, cockpit.look_height, mode.look_ahead).applyQuaternion(orientation).add(car.render_position)
        const shake: number = car.impact * 0.05 + car.landing_impact * 0.03
        eye.y += Math.sin(this.shake_time * 29 + 1.3) * shake
        this.position.copy(eye)
        this.camera.position.copy(eye)
        this.look_point.copy(look)
        this.camera.up.copy(UP).applyQuaternion(orientation)
        this.camera.lookAt(look)
    }
}
