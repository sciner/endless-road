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

    constructor() {
        window.addEventListener('keydown', (event: KeyboardEvent): void => {
            if (!this.held.has(event.code)) this.pressed.add(event.code)
            this.held.add(event.code)
            // Arrows and Space scroll the page, F3 opens the browser's find bar
            if (event.code.startsWith('Arrow') || event.code === 'Space' || event.code === 'F3') event.preventDefault()
            for (let i: number = 0; i < this.listeners.length; i++) this.listeners[i]()
        })
        window.addEventListener('pointerdown', (): void => {
            for (let i: number = 0; i < this.listeners.length; i++) this.listeners[i]()
        })
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
