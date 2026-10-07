import { AdditiveBlending, BufferGeometry, Color, Float32BufferAttribute, IUniform, Mesh, NormalBlending, ShaderMaterial, Vector3 } from 'three'
import { Random } from '../core/Random'
import { Precipitation as PrecipitationType } from '../environment/EnvironmentLook'

const PARTICLES: number = 16000
const BOX: Vector3 = new Vector3(70, 34, 70)

const VERTEX: string = /* glsl */ `
attribute vec3 offset;
attribute vec2 corner;
attribute float seed;
uniform float uTime;
uniform vec3 uCamera;
uniform vec3 uBox;
uniform vec3 uWind;
uniform vec3 uRelative;
uniform vec3 uHeadPosition;
uniform vec3 uHeadDirection;
uniform float uFall;
uniform float uSwirl;
uniform float uWidth;
uniform float uStreak;
uniform float uBaseAlpha;
uniform float uHeadlights;
varying float vAlpha;
varying vec2 vCorner;

void main() {
    float fall = uFall * (0.8 + seed * 0.4);
    vec3 velocity = vec3(uWind.x, -fall, uWind.z);
    vec3 world = offset + velocity * uTime;
    // Snowflakes swirl: each has its own sway phase
    float phase = uTime * (0.7 + seed * 0.8) + seed * 40.0;
    world.x += sin(phase) * uSwirl;
    world.z += cos(phase * 0.8 + 1.3) * uSwirl;
    // Particles live in a box around the camera and wrap seamlessly when leaving it
    world = mod(world - uCamera + uBox * 0.5, uBox) - uBox * 0.5 + uCamera;

    // The streak stretches along the particle velocity relative to the camera — a shutter exposure effect
    vec3 streak = (velocity - uRelative) * uStreak;
    vec3 head = world + streak * 0.5;
    vec3 tail = world - streak * 0.5;
    vec4 view_head = viewMatrix * vec4(head, 1.0);
    vec4 view_tail = viewMatrix * vec4(tail, 1.0);
    vec2 axis = view_tail.xy - view_head.xy;
    float axis_len = length(axis);
    vec2 dir = axis_len > 1e-5 ? axis / axis_len : vec2(0.0, 1.0);
    // A short streak must not be shorter than its width, otherwise a snowflake turns into a dash.
    // Side vector to the right of the direction: quad vertices are always counter-clockwise, so the face is front-facing
    vec2 side = vec2(dir.y, -dir.x) * uWidth;
    vec4 view = mix(view_head, view_tail, corner.y);
    view.xy += side * corner.x + dir * uWidth * (corner.y * 2.0 - 1.0);
    gl_Position = projectionMatrix * view;

    // Headlight cone lighting and distance fade
    vec3 to_particle = world - uHeadPosition;
    float dist = length(to_particle);
    // Right at the headlights there are few particles, but they overlap into a blinding blob, so lighting ramps up from a couple of meters
    float cone = smoothstep(0.82, 0.96, dot(to_particle / max(dist, 1e-3), uHeadDirection))
        * exp(-dist * 0.045) * smoothstep(1.5, 5.0, dist) * uHeadlights;
    float camera_dist = length(world - uCamera);
    float fade = smoothstep(0.6, 2.5, camera_dist) * exp(-camera_dist * 0.035);
    vAlpha = (uBaseAlpha + cone * 0.6) * fade;
    vCorner = corner;
}
`

const FRAGMENT: string = /* glsl */ `
uniform vec3 uColor;
uniform float uRound;
varying float vAlpha;
varying vec2 vCorner;
void main() {
    // Rain is a streak with soft sides and ends, snow is a round dot
    float streak = (1.0 - vCorner.x * vCorner.x) * smoothstep(0.0, 0.25, vCorner.y) * (1.0 - smoothstep(0.75, 1.0, vCorner.y));
    float flake = 1.0 - smoothstep(0.2, 1.0, length(vec2(vCorner.x, vCorner.y * 2.0 - 1.0)));
    float soft = mix(streak, flake, uRound);
    float alpha = min(vAlpha * soft, 1.0);
    gl_FragColor = vec4(uColor * alpha, alpha);
}
`

interface PrecipitationStyle {
    fall: number
    swirl: number
    width: number
    streak: number
    base_alpha: number
    additive: boolean
}

const STYLES: Record<Exclude<PrecipitationType, 'none'>, PrecipitationStyle> = {
    rain: { fall: 10.5, swirl: 0, width: 0.0065, streak: 0.028, base_alpha: 0.07, additive: true },
    snow: { fall: 1.3, swirl: 0.45, width: 0.05, streak: 0.012, base_alpha: 0.5, additive: false },
}

/**
 * Fully GPU-driven precipitation: thin rain streaks or swirling snowflakes,
 * oriented along relative velocity and lit by the headlights
 */
export class Precipitation {
    readonly mesh: Mesh
    private uniforms: Record<string, IUniform>
    private material: ShaderMaterial

    constructor() {
        const random: Random = new Random(777)
        const offsets: number[] = []
        const corners: number[] = []
        const seeds: number[] = []
        const indices: number[] = []
        for (let i: number = 0; i < PARTICLES; i++) {
            const x: number = random.next() * BOX.x
            const y: number = random.next() * BOX.y
            const z: number = random.next() * BOX.z
            const s: number = random.next()
            const quad: number[][] = [[-1, 0], [1, 0], [1, 1], [-1, 1]]
            for (let k: number = 0; k < 4; k++) {
                offsets.push(x, y, z)
                corners.push(quad[k][0], quad[k][1])
                seeds.push(s)
            }
            const b: number = i * 4
            indices.push(b, b + 1, b + 2, b, b + 2, b + 3)
        }
        const geometry: BufferGeometry = new BufferGeometry()
        geometry.setAttribute('position', new Float32BufferAttribute(offsets, 3))
        geometry.setAttribute('offset', new Float32BufferAttribute(offsets, 3))
        geometry.setAttribute('corner', new Float32BufferAttribute(corners, 2))
        geometry.setAttribute('seed', new Float32BufferAttribute(seeds, 1))
        geometry.setIndex(indices)

        this.uniforms = {
            uTime: { value: 0 },
            uCamera: { value: new Vector3() },
            uBox: { value: BOX.clone() },
            uWind: { value: new Vector3(1.4, 0, 0.6) },
            uRelative: { value: new Vector3() },
            uHeadPosition: { value: new Vector3() },
            uHeadDirection: { value: new Vector3(0, 0, 1) },
            uColor: { value: new Color(0xb8c8e0) },
            uFall: { value: 10.5 },
            uSwirl: { value: 0 },
            uWidth: { value: 0.0065 },
            uStreak: { value: 0.028 },
            uBaseAlpha: { value: 0.07 },
            uRound: { value: 0 },
            uHeadlights: { value: 1 },
        }
        this.material = new ShaderMaterial({
            vertexShader: VERTEX,
            fragmentShader: FRAGMENT,
            uniforms: this.uniforms,
            transparent: true,
            depthWrite: false,
            blending: AdditiveBlending,
        })
        this.mesh = new Mesh(geometry, this.material)
        this.mesh.frustumCulled = false
        this.mesh.renderOrder = 10
        this.mesh.name = 'precipitation'
    }

    /**
     * Rain uses additive blending (drops are visible only when lit), snow uses
     * normal blending: snowflakes stay visible against a bright daytime background
     */
    configure(type: PrecipitationType, alpha_scale: number, brightness: number, headlights: number): void {
        this.mesh.visible = type !== 'none'
        if (type === 'none') return
        this.uniforms.uHeadlights.value = headlights
        const style: PrecipitationStyle = STYLES[type]
        this.uniforms.uFall.value = style.fall
        this.uniforms.uSwirl.value = style.swirl
        this.uniforms.uWidth.value = style.width
        this.uniforms.uStreak.value = style.streak
        this.uniforms.uBaseAlpha.value = style.base_alpha * alpha_scale
        this.uniforms.uRound.value = style.additive ? 0 : 1
        const color: Color = this.uniforms.uColor.value as Color
        if (type === 'rain') color.set(0xb8c8e0)
        else color.setScalar(brightness)
        this.material.blending = style.additive ? AdditiveBlending : NormalBlending
        this.material.premultipliedAlpha = !style.additive
        this.material.needsUpdate = true
    }

    update(time: number, camera: Vector3, relative_velocity: Vector3, head_position: Vector3, head_direction: Vector3): void {
        this.uniforms.uTime.value = time
        const targets: Vector3[] = [
            this.uniforms.uCamera.value as Vector3,
            this.uniforms.uRelative.value as Vector3,
            this.uniforms.uHeadPosition.value as Vector3,
            this.uniforms.uHeadDirection.value as Vector3,
        ]
        const sources: Vector3[] = [camera, relative_velocity, head_position, head_direction]
        for (let i: number = 0; i < targets.length; i++) targets[i].copy(sources[i])
    }
}
