import { GamepadInput, GamepadState } from './GamepadInput'

/** Snapshot of control inputs for one frame */
export interface DriveInput {
    throttle: number
    brake: number
    /** -1 = right, 1 = left */
    steer: number
    /** Steering comes from an analog stick rather than keys, so no hold-to-ramp is needed */
    steer_analog: boolean
    handbrake: boolean
}

/**
 * Keyboard and gamepad input: held keys, single presses
 * (gamepad buttons arrive as virtual codes GamepadA, GamepadStart…) and analog control
 */
export class Input {
    private held: Set<string> = new Set()
    private pressed: Set<string> = new Set()
    private listeners: Array<() => void> = []
    private connection_listeners: Array<(name: string, connected: boolean) => void> = []
    private gamepad: GamepadInput
    private pad: GamepadState = { steer: 0, throttle: 0, brake: 0, handbrake: false }
    /** Mouse movement while the pointer is locked and wheel notches, gathered until taken */
    private mouse_x: number = 0
    private mouse_y: number = 0
    private wheel: number = 0

    constructor() {
        window.addEventListener('keydown', (event: KeyboardEvent): void => {
            if (!this.held.has(event.code)) this.pressed.add(event.code)
            this.held.add(event.code)
            // Arrows and Space scroll the page, F3 opens the browser's find bar, F10 focuses the browser menu
            if (event.code.startsWith('Arrow') || event.code === 'Space' || event.code === 'F3' || event.code === 'F10') {
                event.preventDefault()
            }
            for (let i: number = 0; i < this.listeners.length; i++) this.listeners[i]()
        })
        window.addEventListener('pointerdown', (): void => {
            for (let i: number = 0; i < this.listeners.length; i++) this.listeners[i]()
        })
        window.addEventListener('mousemove', (event: MouseEvent): void => {
            if (!document.pointerLockElement) return
            // Some browsers report a huge jump right after the lock: such events are dropped
            if (Math.abs(event.movementX) > 400 || Math.abs(event.movementY) > 400) return
            this.mouse_x += event.movementX
            this.mouse_y += event.movementY
        })
        window.addEventListener('wheel', (event: WheelEvent): void => {
            this.wheel += Math.sign(event.deltaY)
        }, { passive: true })
        window.addEventListener('keyup', (event: KeyboardEvent): void => {
            this.held.delete(event.code)
        })
        window.addEventListener('blur', (): void => {
            this.held.clear()
        })
        this.gamepad = new GamepadInput((name: string, connected: boolean): void => {
            for (let i: number = 0; i < this.connection_listeners.length; i++) this.connection_listeners[i](name, connected)
        })
    }

    /** Called on any key or mouse button press (needed to start audio after a user gesture) */
    onAnyKey(listener: () => void): void {
        this.listeners.push(listener)
    }

    /** Gamepad connect and disconnect */
    onGamepadConnection(listener: (name: string, connected: boolean) => void): void {
        this.connection_listeners.push(listener)
    }

    /** Polls the gamepad; called at the start of the frame, before presses are read */
    poll(): void {
        this.pad = this.gamepad.poll((code: string): void => {
            this.pressed.add(code)
        })
    }

    rumble(strong: number, weak: number, duration_ms: number): void {
        this.gamepad.rumble(strong, weak, duration_ms)
    }

    isDown(code: string): boolean {
        return this.held.has(code)
    }

    /** Whether the key was pressed since the last endFrame call */
    wasPressed(code: string): boolean {
        return this.pressed.has(code)
    }

    /** Whether any of the keys was pressed since the last endFrame call */
    wasAnyPressed(...codes: string[]): boolean {
        for (let i: number = 0; i < codes.length; i++) {
            if (this.pressed.has(codes[i])) return true
        }
        return false
    }

    /** All keys pressed since the last endFrame call */
    pressedKeys(): string[] {
        return Array.from(this.pressed)
    }

    /** Mouse movement since the last call, px */
    takeMouse(): { x: number, y: number } {
        const delta: { x: number, y: number } = { x: this.mouse_x, y: this.mouse_y }
        this.mouse_x = 0
        this.mouse_y = 0
        return delta
    }

    /** Wheel notches since the last call: positive is towards the user */
    takeWheel(): number {
        const wheel: number = this.wheel
        this.wheel = 0
        return wheel
    }

    endFrame(): void {
        this.pressed.clear()
    }

    drive(): DriveInput {
        const up: boolean = this.isDown('KeyW') || this.isDown('ArrowUp')
        const down: boolean = this.isDown('KeyS') || this.isDown('ArrowDown')
        const left: boolean = this.isDown('KeyA') || this.isDown('ArrowLeft')
        const right: boolean = this.isDown('KeyD') || this.isDown('ArrowRight')
        const keyboard_steer: number = (left ? 1 : 0) - (right ? 1 : 0)
        // Steering keys take priority over the stick; without them the stick value is used as is
        const analog: boolean = keyboard_steer === 0 && this.pad.steer !== 0
        return {
            throttle: Math.max(up ? 1 : 0, this.pad.throttle),
            brake: Math.max(down ? 1 : 0, this.pad.brake),
            steer: analog ? this.pad.steer : keyboard_steer,
            steer_analog: analog,
            handbrake: this.isDown('Space') || this.pad.handbrake,
        }
    }
}
