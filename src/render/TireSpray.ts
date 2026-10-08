import { BufferGeometry, Color, DynamicDrawUsage, Float32BufferAttribute, IUniform, Points, ShaderMaterial, Texture, Vector3 } from 'three'
import { Random } from '../core/Random'
import { ProceduralTextures } from './ProceduralTextures'

const MAX_PARTICLES: number = 1400

const VERTEX: string = /* glsl */ `
attribute float alpha;
attribute float size;
uniform float uScale;
uniform vec3 uTailPosition;
uniform vec3 uTailDirection;
uniform float uTailGlow;
varying float vAlpha;
varying float vTail;
void main() {
    vec4 view = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * view;
    gl_PointSize = size * uScale / max(-view.z, 0.1);
    vAlpha = alpha;
    vec3 to_tail = position - uTailPosition;
    float tail_dist = length(to_tail);
    // Tail lamps shine backward: spray beside the wheels, under or above the car stays unlit
    float facing = smoothstep(0.0, 0.6, dot(to_tail / max(tail_dist, 1e-3), uTailDirection));
    vTail = exp(-tail_dist * 0.7) * facing * uTailGlow;
}
`

const FRAGMENT: string = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uColor;
uniform vec3 uTailColor;
varying float vAlpha;
varying float vTail;
void main() {
    float a = texture2D(uMap, gl_PointCoord).a * vAlpha;
    vec3 color = uColor + uTailColor * vTail;
    gl_FragColor = vec4(color, a);
}
`

/**
 * Spray from the rear wheels: water mist on wet asphalt, snow or sand;
 * tinted red behind the tail lights while they are lit
 */
export class TireSpray {
    readonly points: Points
    private positions: Float32Array = new Float32Array(MAX_PARTICLES * 3)
    private velocities: Float32Array = new Float32Array(MAX_PARTICLES * 3)
    private life: Float32Array = new Float32Array(MAX_PARTICLES)
    private max_life: Float32Array = new Float32Array(MAX_PARTICLES)
    private alphas: Float32Array = new Float32Array(MAX_PARTICLES)
    private sizes: Float32Array = new Float32Array(MAX_PARTICLES)
    private cursor: number = 0
    private emit_accumulator: number = 0
    private random: Random = new Random(99)
    private amount: number = 1
    private off_road: boolean = false
    private uniforms: Record<string, IUniform>
    private geometry: BufferGeometry

    constructor() {
        this.geometry = new BufferGeometry()
        const position: Float32BufferAttribute = new Float32BufferAttribute(this.positions, 3)
        const alpha: Float32BufferAttribute = new Float32BufferAttribute(this.alphas, 1)
        const size: Float32BufferAttribute = new Float32BufferAttribute(this.sizes, 1)
        position.setUsage(DynamicDrawUsage)
        alpha.setUsage(DynamicDrawUsage)
        size.setUsage(DynamicDrawUsage)
        this.geometry.setAttribute('position', position)
        this.geometry.setAttribute('alpha', alpha)
        this.geometry.setAttribute('size', size)

        const sprite: Texture = ProceduralTextures.softSprite()
        this.uniforms = {
            uMap: { value: sprite },
            uScale: { value: 600 },
            uColor: { value: new Color(0x2a3442) },
            uTailColor: { value: new Color(0x5a0804) },
            uTailPosition: { value: new Vector3() },
            uTailDirection: { value: new Vector3(0, 0, -1) },
            uTailGlow: { value: 0 },
        }
        const material: ShaderMaterial = new ShaderMaterial({
            vertexShader: VERTEX,
            fragmentShader: FRAGMENT,
            uniforms: this.uniforms,
            transparent: true,
            depthWrite: false,
        })
        this.points = new Points(this.geometry, material)
        this.points.frustumCulled = false
        this.points.renderOrder = 5
    }

    setViewportHeight(pixels: number): void {
        this.uniforms.uScale.value = pixels * 0.55
    }

    /** Water mist, snow powder or sand dust; off_road — also emits off the asphalt */
    configure(color: Color, amount: number, off_road: boolean): void {
        const target: Color = this.uniforms.uColor.value as Color
        target.copy(color)
        this.amount = amount
        this.off_road = off_road
    }

    /**
     * Emitters are the rear wheel contact points. Intensity depends on speed
     * and asphalt wetness; drifting produces more spray.
     */
    update(dt: number, emitters: Vector3[], car_velocity: Vector3, speed: number, on_road: boolean, slip: number, tail_position: Vector3, tail_direction: Vector3, tail_glow: number): void {
        const emitting: boolean = (on_road || this.off_road) && speed > 3
        const rate: number = emitting ? (speed * 7 + slip * 260) * this.amount : 0
        this.emit_accumulator += rate * dt
        while (this.emit_accumulator >= 1) {
            this.emit_accumulator -= 1
            const emitter: Vector3 = emitters[this.random.int(0, emitters.length - 1)]
            this.spawn(emitter, car_velocity, speed)
        }

        const drag: number = Math.exp(-2.6 * dt)
        for (let i: number = 0; i < MAX_PARTICLES; i++) {
            if (this.life[i] <= 0) {
                this.alphas[i] = 0
                continue
            }
            this.life[i] -= dt
            const i3: number = i * 3
            this.velocities[i3] *= drag
            this.velocities[i3 + 1] = this.velocities[i3 + 1] * drag - 2.2 * dt
            this.velocities[i3 + 2] *= drag
            this.positions[i3] += this.velocities[i3] * dt
            this.positions[i3 + 1] += this.velocities[i3 + 1] * dt
            this.positions[i3 + 2] += this.velocities[i3 + 2] * dt
            const t: number = 1 - Math.max(0, this.life[i]) / this.max_life[i]
            this.alphas[i] = Math.sin(Math.PI * Math.min(1, t * 1.4)) * 0.32 * (1 - t)
            this.sizes[i] = 0.35 + t * 2.4
        }
        const tail_uniform: Vector3 = this.uniforms.uTailPosition.value as Vector3
        tail_uniform.copy(tail_position)
        const tail_direction_uniform: Vector3 = this.uniforms.uTailDirection.value as Vector3
        tail_direction_uniform.copy(tail_direction)
        this.uniforms.uTailGlow.value = tail_glow
        this.geometry.attributes.position.needsUpdate = true
        this.geometry.attributes.alpha.needsUpdate = true
        this.geometry.attributes.size.needsUpdate = true
    }

    private spawn(emitter: Vector3, car_velocity: Vector3, speed: number): void {
        const i: number = this.cursor
        this.cursor = (this.cursor + 1) % MAX_PARTICLES
        const i3: number = i * 3
        this.positions[i3] = emitter.x + this.random.range(-0.15, 0.15)
        this.positions[i3 + 1] = emitter.y + this.random.range(0, 0.15)
        this.positions[i3 + 2] = emitter.z + this.random.range(-0.15, 0.15)
        const spread: number = 0.8 + speed * 0.04
        this.velocities[i3] = car_velocity.x * 0.45 + this.random.range(-spread, spread)
        this.velocities[i3 + 1] = this.random.range(0.6, 1.8) + speed * 0.02
        this.velocities[i3 + 2] = car_velocity.z * 0.45 + this.random.range(-spread, spread)
        this.max_life[i] = this.random.range(0.5, 1.1)
        this.life[i] = this.max_life[i]
    }
}
