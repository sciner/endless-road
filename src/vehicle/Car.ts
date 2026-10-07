import { Vector3 } from 'three'
import { GLTF } from 'three/addons/loaders/GLTFLoader.js'
import { DriveInput } from '../core/Input'
import { MathUtils } from '../core/MathUtils'
import { WorldSurface } from '../world/WorldSurface'
import { Vegetation } from '../world/Vegetation'
import { RoadProjection } from '../world/RoadTypes'
import { CarModel, CarWheel } from './CarModel'
import { CarPhysics } from './CarPhysics'
import { CarContactShadow } from './CarContactShadow'

/**
 * Player car: links the physics to the visual model,
 * animates the wheels, suspension and brake lights
 */
export class Car {
    readonly model: CarModel
    readonly physics: CarPhysics
    private contact_shadow: CarContactShadow
    private wheel_angle: number = 0
    private body_pitch: number = 0
    private body_roll: number = 0
    private brake_level: number = 0

    constructor(gltf: GLTF) {
        this.model = new CarModel(gltf)
        this.physics = new CarPhysics(this.model.wheelbase, this.model.width, this.model.length)
        // Shadow is attached to the root, not the body: it lies on the ground and does not sway with the suspension
        this.contact_shadow = new CarContactShadow(this.model.width, this.model.length)
        this.model.root.add(this.contact_shadow.mesh)
    }

    get position(): Vector3 {
        return this.physics.position
    }

    /** Places the car on the road centerline, facing the direction of travel */
    placeOnRoad(surface: WorldSurface, x: number, z: number): void {
        const projection: RoadProjection | null = surface.road.project(x, z, 400)
        if (!projection) return
        const position: Vector3 = new Vector3(
            x - projection.right.x * projection.lateral + projection.right.x * 1.9,
            projection.height,
            z - projection.right.z * projection.lateral + projection.right.z * 1.9,
        )
        this.physics.place(position, Math.atan2(projection.tangent.x, projection.tangent.z))
        this.render(0, 1)
    }

    /** Physics step with a fixed dt */
    update(dt: number, input: DriveInput, surface: WorldSurface, vegetation: Vegetation): void {
        this.physics.update(dt, input, surface, vegetation)
        const braking: boolean = (input.brake > 0 && this.physics.forward_speed > 0.5) || (input.throttle > 0 && this.physics.forward_speed < -0.5)
        this.brake_level = MathUtils.damp(this.brake_level, braking ? 1 : 0, 14, dt)
        this.model.setBrake(this.brake_level)
    }

    /**
     * Once per frame, applies to the scene the pose interpolated between physics steps;
     * alpha is the fraction of the accumulated but not yet simulated step
     */
    render(dt: number, alpha: number): void {
        const p: CarPhysics = this.physics
        p.interpolate(alpha)
        const root: CarModel['root'] = this.model.root
        root.position.copy(p.render_position)
        root.rotation.set(p.render_pitch, p.render_yaw, p.render_roll, 'YXZ')
        this.contact_shadow.update(p.grounded, dt)

        // Body: dive under braking, squat under acceleration, roll in corners, jolt on landing
        const target_pitch: number = MathUtils.clamp(-p.long_accel * 0.006, -0.05, 0.05)
        const target_roll: number = MathUtils.clamp(p.lat_accel * 0.0045, -0.05, 0.05)
        if (dt > 0) {
            this.body_pitch = MathUtils.damp(this.body_pitch, target_pitch, 6, dt)
            this.body_roll = MathUtils.damp(this.body_roll, target_roll, 6, dt)
        }
        this.model.body.rotation.set(this.body_pitch, 0, this.body_roll)
        this.model.body.position.y = -p.landing_impact * 0.08

        // Wheels: spin by distance traveled, front wheels turn with the steering
        const wheels: CarWheel[] = this.model.wheels
        const radius: number = wheels.length > 0 ? wheels[0].radius : 0.33
        this.wheel_angle += (p.forward_speed * dt) / Math.max(radius, 0.1)
        for (let i: number = 0; i < wheels.length; i++) {
            const wheel: CarWheel = wheels[i]
            wheel.spin.rotation.x = this.wheel_angle
            wheel.steer.rotation.y = wheel.front ? p.steer : 0
            // Wheels counter the body roll, pitch and sag so they stay on the ground
            const local_x: number = wheel.steer.position.x
            const local_z: number = wheel.steer.position.z
            wheel.steer.position.y = wheel.rest_y - this.model.body.position.y - local_x * this.body_roll + local_z * this.body_pitch
        }
    }
}
