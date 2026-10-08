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
/** Holding sprint (Ctrl, like in Minecraft, or Q) multiplies the speed */
const BOOST: number = 5
const PITCH_LIMIT: number = Math.PI / 2 - 0.01

/**
 * Free flight with Minecraft creative controls: WASD moves on the horizontal plane of the
 * look direction, Space rises and Shift descends at the full speed on top of that, and
 * releasing the keys stops at once. The wheel changes the speed. Flies through anything
 */
export class FreeCamera {
    private camera: PerspectiveCamera
    private yaw: number = 0
    private pitch: number = 0
    private speed: number = BASE_SPEED
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
    }

    update(dt: number, input: Input): void {
        const look: { x: number, y: number } = input.takeMouse()
        this.yaw -= look.x * LOOK_SENSITIVITY
        this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch - look.y * LOOK_SENSITIVITY))
        const wheel: number = input.takeWheel()
        if (wheel !== 0) this.speed = Math.max(MIN_SPEED, Math.min(MAX_SPEED, this.speed * Math.pow(WHEEL_STEP, -wheel)))

        this.euler.set(this.pitch, this.yaw, 0, 'YXZ')
        this.camera.quaternion.setFromEuler(this.euler)
        // Flat basis of the heading: looking up does not turn W into a climb
        this.forward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw))
        this.right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw))

        const axis: (positive: boolean, negative: boolean) => number = (positive: boolean, negative: boolean): number =>
            (positive ? 1 : 0) - (negative ? 1 : 0)
        const ahead: number = axis(input.isDown('KeyW') || input.isDown('ArrowUp'), input.isDown('KeyS') || input.isDown('ArrowDown'))
        const side: number = axis(input.isDown('KeyD') || input.isDown('ArrowRight'), input.isDown('KeyA') || input.isDown('ArrowLeft'))
        const up: number = axis(input.isDown('Space'), input.isDown('ShiftLeft') || input.isDown('ShiftRight'))
        // Diagonal keys share one speed, and the vertical keys add their own full speed on top
        this.target.set(0, 0, 0).addScaledVector(this.forward, ahead).addScaledVector(this.right, side)
        if (this.target.lengthSq() > 1) this.target.normalize()
        this.target.y += up
        const sprint: boolean = input.isDown('KeyQ') || input.isDown('ControlLeft') || input.isDown('ControlRight')
        this.target.multiplyScalar(this.speed * (sprint ? BOOST : 1))
        this.camera.position.addScaledVector(this.target, dt)
        this.camera.updateMatrixWorld()
    }
}
