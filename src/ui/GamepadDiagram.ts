import { lang } from '../i18n/Lang'

/** Labelled button: anchor point on the controller, the height the leader line turns at, and the label side */
interface Callout {
    x: number
    y: number
    turn_y: number
    side: 'left' | 'right'
    key: () => string
    action: () => string
}

/** Horizontal end of the leader lines on each side, the labels start right past it */
const LEFT_EDGE: number = 120
const RIGHT_EDGE: number = 480

const CALLOUTS: Callout[] = [
    { x: 272, y: 124, turn_y: 16, side: 'left', key: (): string => 'Back / Share', action: (): string => lang.action_help },
    { x: 206, y: 62, turn_y: 44, side: 'left', key: (): string => 'LT / L2', action: (): string => lang.action_brake },
    { x: 220, y: 150, turn_y: 150, side: 'left', key: (): string => lang.key_left_stick, action: (): string => lang.action_steer },
    { x: 328, y: 124, turn_y: 16, side: 'right', key: (): string => 'Start / Options', action: (): string => lang.action_pause },
    { x: 394, y: 62, turn_y: 44, side: 'right', key: (): string => 'RT / R2', action: (): string => lang.action_throttle },
    { x: 357, y: 150, turn_y: 104, side: 'right', key: (): string => 'X / □', action: (): string => lang.action_random_environment },
    { x: 380, y: 127, turn_y: 127, side: 'right', key: (): string => 'Y / △', action: (): string => lang.action_camera },
    { x: 403, y: 150, turn_y: 150, side: 'right', key: (): string => 'B / ○', action: (): string => lang.action_reset },
    { x: 380, y: 173, turn_y: 173, side: 'right', key: (): string => 'A / ✕', action: (): string => lang.action_handbrake },
]

const BODY_PATH: string = 'M 210 100 C 240 92 360 92 390 100 C 425 108 445 125 455 160 C 468 205 480 260 468 290 '
    + 'C 458 312 425 312 410 290 C 395 268 382 250 360 248 L 240 248 C 218 250 205 268 190 290 '
    + 'C 175 312 142 312 132 290 C 120 260 132 205 145 160 C 155 125 175 108 210 100 Z'

function faceButton(x: number, y: number, letter: string, color: string): string {
    return `<circle class="pad-part" cx="${x}" cy="${y}" r="10"/>`
        + `<text class="pad-letter" x="${x}" y="${y + 4.5}" fill="${color}">${letter}</text>`
}

function stick(x: number, y: number, radius: number): string {
    return `<circle class="pad-part" cx="${x}" cy="${y}" r="${radius}"/>`
        + `<circle class="pad-part pad-stick-top" cx="${x}" cy="${y}" r="${radius - 7}"/>`
}

function controller(): string {
    return [
        `<rect class="pad-part" x="180" y="62" width="52" height="22" rx="10"/>`,
        `<rect class="pad-part" x="368" y="62" width="52" height="22" rx="10"/>`,
        `<rect class="pad-part" x="176" y="87" width="60" height="10" rx="5"/>`,
        `<rect class="pad-part" x="364" y="87" width="60" height="10" rx="5"/>`,
        `<path class="pad-body" d="${BODY_PATH}"/>`,
        stick(220, 150, 22),
        stick(355, 205, 20),
        `<path class="pad-part" d="M 238 191 h 14 v 7 h 7 v 14 h -7 v 7 h -14 v -7 h -7 v -14 h 7 Z"/>`,
        `<rect class="pad-part" x="265" y="119.5" width="14" height="9" rx="4.5"/>`,
        `<rect class="pad-part" x="321" y="119.5" width="14" height="9" rx="4.5"/>`,
        `<circle class="pad-part" cx="300" cy="113" r="9"/>`,
        faceButton(380, 127, 'Y', '#f2c230'),
        faceButton(357, 150, 'X', '#4a90e2'),
        faceButton(403, 150, 'B', '#e5534b'),
        faceButton(380, 173, 'A', '#6cc04a'),
    ].join('')
}

/** Leader line from the button centre up or down to its turn height, then out to the label column */
function callout(item: Callout): string {
    const left: boolean = item.side === 'left'
    const edge: number = left ? LEFT_EDGE : RIGHT_EDGE
    const key: string = `<tspan class="pad-key">${item.key()}</tspan>`
    const action: string = `<tspan class="pad-action">${item.action()}</tspan>`
    const text_x: number = left ? edge - 8 : edge + 8
    return `<polyline class="pad-line" points="${item.x},${item.y} ${item.x},${item.turn_y} ${edge},${item.turn_y}"/>`
        + `<text class="pad-label" x="${text_x}" y="${item.turn_y + 5}" text-anchor="${left ? 'end' : 'start'}">`
        + (left ? `${action}  ${key}` : `${key}  ${action}`)
        + '</text>'
}

/** Gamepad drawing with every in-game button labelled, in Xbox / PlayStation notation */
export function gamepadDiagram(): string {
    return `<svg class="pad-diagram" viewBox="-130 0 860 316">`
        // Lines go under the controller so they start hidden beneath each button
        + CALLOUTS.map(callout).join('')
        + controller()
        + '</svg>'
}
