import { Euler, PerspectiveCamera, Vector3 } from 'three'
import { Input } from '../core/Input'

/** Mouse look, rad per pixel */
const LOOK_SENSITIVITY: number = 0.0022
/** Flight speed, m/s: the starting value and the range the wheel can reach */
const BASE_SPEED: number = 25
const MIN_SPEED: number = 2
const MAX_SPEED: number = 600
/** One wheel notch changes the speed by this factor */
const WHEEL_STEP: number = 1.2
/** Holding Q multiplies the speed */
const BOOST: number = 5
/** How fast the velocity catches up with the keys, 1/s: the flight starts and stops smoothly */
const RESPONSE: number = 8
const PITCH_LIMIT: number = Math.PI / 2 - 0.01

/**
 * Spectator camera like in Minecraft: mouse to look, W/S fly where the camera looks,
 * A/D strafe, Space and Shift go straight up and down. Flies through anything
 */
export class FreeCamera {
    private camera: PerspectiveCamera
    private yaw: number = 0
    private pitch: number = 0
    private speed: number = BASE_SPEED
    private velocity: Vector3 = new Vector3()
    private euler: Euler = new Euler(0, 0, 0, 'YXZ')
    private forward: Vector3 = new Vector3()
    private right: Vector3 = new Vector3()
    private target: Vector3 = new Vector3()

    constructor(camera: PerspectiveCamera) {
        this.camera = camera
    }

    /** Starts from wherever the camera is now, looking the same way */
    enter(): void {
        this.euler.setFromQuaternion(this.camera.quaternion, 'YXZ')
        this.yaw = this.euler.y
        this.pitch = this.euler.x
        this.velocity.set(0, 0, 0)
    }

    update(dt: number, input: Input): void {
        const look: { x: number, y: number } = input.takeMouse()
        this.yaw -= look.x * LOOK_SENSITIVITY
        this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch - look.y * LOOK_SENSITIVITY))
        const wheel: number = input.takeWheel()
        if (wheel !== 0) this.speed = Math.max(MIN_SPEED, Math.min(MAX_SPEED, this.speed * Math.pow(WHEEL_STEP, -wheel)))

        this.euler.set(this.pitch, this.yaw, 0, 'YXZ')
        this.camera.quaternion.setFromEuler(this.euler)
        this.forward.set(0, 0, -1).applyQuaternion(this.camera.quaternion)
        this.right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw))

        const axis: (positive: boolean, negative: boolean) => number = (positive: boolean, negative: boolean): number =>
            (positive ? 1 : 0) - (negative ? 1 : 0)
        const ahead: number = axis(input.isDown('KeyW') || input.isDown('ArrowUp'), input.isDown('KeyS') || input.isDown('ArrowDown'))
        const side: number = axis(input.isDown('KeyD') || input.isDown('ArrowRight'), input.isDown('KeyA') || input.isDown('ArrowLeft'))
        const up: number = axis(input.isDown('Space'), input.isDown('ShiftLeft') || input.isDown('ShiftRight'))
        this.target.set(0, 0, 0)
            .addScaledVector(this.forward, ahead)
            .addScaledVector(this.right, side)
        this.target.y += up
        if (this.target.lengthSq() > 1) this.target.normalize()
        this.target.multiplyScalar(this.speed * (input.isDown('KeyQ') ? BOOST : 1))

        this.velocity.lerp(this.target, 1 - Math.exp(-RESPONSE * dt))
        this.camera.position.addScaledVector(this.velocity, dt)
        this.camera.updateMatrixWorld()
    }
}
