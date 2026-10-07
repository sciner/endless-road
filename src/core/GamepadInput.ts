/** Analog gamepad control for one frame */
export interface GamepadState {
    /** -1 = right, 1 = left, with dead zone and response curve already applied */
    steer: number
    throttle: number
    brake: number
    handbrake: boolean
}

/** Standard-mapping buttons (Xbox / PlayStation) → virtual press codes */
const BUTTON_CODES: Record<number, string> = {
    0: 'GamepadA',
    1: 'GamepadB',
    2: 'GamepadX',
    3: 'GamepadY',
    4: 'GamepadLB',
    5: 'GamepadRB',
    8: 'GamepadBack',
    9: 'GamepadStart',
    12: 'GamepadUp',
    13: 'GamepadDown',
    14: 'GamepadLeft',
    15: 'GamepadRight',
}

const BUTTON_A: number = 0
const TRIGGER_LEFT: number = 6
const TRIGGER_RIGHT: number = 7
const STICK_DEADZONE: number = 0.12
const TRIGGER_DEADZONE: number = 0.04
/** Stick as a D-pad for menus: press and release with hysteresis */
const STICK_PRESS: number = 0.6
const STICK_RELEASE: number = 0.4

const IDLE: GamepadState = { steer: 0, throttle: 0, brake: 0, handbrake: false }

/**
 * Gamepad polling via the Gamepad API: stick and triggers give analog control,
 * buttons give single presses with virtual codes, plus rumble on impacts
 */
export class GamepadInput {
    private buttons_down: boolean[] = []
    private stick_down: Record<string, boolean> = {}
    private index: number = -1

    constructor(on_connection: (name: string, connected: boolean) => void) {
        window.addEventListener('gamepadconnected', (event: GamepadEvent): void => {
            if (this.index < 0) this.index = event.gamepad.index
            on_connection(event.gamepad.id, true)
        })
        window.addEventListener('gamepaddisconnected', (event: GamepadEvent): void => {
            if (event.gamepad.index === this.index) this.index = -1
            on_connection(event.gamepad.id, false)
        })
    }

    /** Active gamepad; if the selected one is disconnected, the first connected one */
    private current(): Gamepad | null {
        const pads: (Gamepad | null)[] = navigator.getGamepads ? navigator.getGamepads() : []
        const chosen: Gamepad | null = this.index >= 0 ? pads[this.index] ?? null : null
        if (chosen && chosen.connected) return chosen
        for (let i: number = 0; i < pads.length; i++) {
            const pad: Gamepad | null = pads[i]
            if (pad && pad.connected) {
                this.index = pad.index
                return pad
            }
        }
        return null
    }

    /** Reads the state; on_press is called for each button pressed since the last poll */
    poll(on_press: (code: string) => void): GamepadState {
        const pad: Gamepad | null = this.current()
        if (!pad) return IDLE

        for (const key of Object.keys(BUTTON_CODES)) {
            const button: number = Number(key)
            const down: boolean = pad.buttons[button]?.pressed ?? false
            if (down && !this.buttons_down[button]) on_press(BUTTON_CODES[button])
            this.buttons_down[button] = down
        }

        const x: number = GamepadInput.deadzone(pad.axes[0] ?? 0, STICK_DEADZONE)
        const y: number = GamepadInput.deadzone(pad.axes[1] ?? 0, STICK_DEADZONE)
        this.stickPress('GamepadLeft', -x, on_press)
        this.stickPress('GamepadRight', x, on_press)
        this.stickPress('GamepadUp', -y, on_press)
        this.stickPress('GamepadDown', y, on_press)

        return {
            // Power curve: small stick deflections are more precise, full travel gives full lock
            steer: -Math.sign(x) * Math.pow(Math.abs(x), 1.6),
            throttle: GamepadInput.deadzone(pad.buttons[TRIGGER_RIGHT]?.value ?? 0, TRIGGER_DEADZONE),
            brake: GamepadInput.deadzone(pad.buttons[TRIGGER_LEFT]?.value ?? 0, TRIGGER_DEADZONE),
            handbrake: pad.buttons[BUTTON_A]?.pressed ?? false,
        }
    }

    /** Rumble: strong = heavy motor, weak = light motor, 0..1 */
    rumble(strong: number, weak: number, duration_ms: number): void {
        const pad: Gamepad | null = this.current()
        const actuator: GamepadHapticActuator | null | undefined = pad?.vibrationActuator
        if (!actuator || typeof actuator.playEffect !== 'function') return
        actuator.playEffect('dual-rumble', {
            duration: duration_ms,
            strongMagnitude: Math.min(1, strong),
            weakMagnitude: Math.min(1, weak),
        }).catch((): void => {
            // Rumble is not supported by this gamepad or browser
        })
    }

    private stickPress(code: string, value: number, on_press: (code: string) => void): void {
        const down: boolean = this.stick_down[code] ?? false
        if (!down && value > STICK_PRESS) {
            this.stick_down[code] = true
            on_press(code)
        } else if (down && value < STICK_RELEASE) {
            this.stick_down[code] = false
        }
    }

    /** Values below the threshold become zero; values above are rescaled back to the full range */
    private static deadzone(value: number, threshold: number): number {
        const magnitude: number = Math.abs(value)
        if (magnitude < threshold) return 0
        return Math.sign(value) * (magnitude - threshold) / (1 - threshold)
    }
}
