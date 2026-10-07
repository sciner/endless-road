import { BufferAttribute, BufferGeometry, CylinderGeometry, Float32BufferAttribute, Vector3 } from 'three'
import { Random } from '../core/Random'

/** How strongly the trunk bends, as fractions of tree height */
export interface TrunkStyle {
    /** Overall lean of the top */
    lean: [number, number]
    /** Amplitude of smooth bends */
    wobble: [number, number]
    /** Bend at the base: the trunk leaves the ground at an angle and then straightens */
    sweep: [number, number]
}

/**
 * Bent trunk axis and its geometry. The axis starts exactly at (0, 0, 0),
 * so the collider at the base stays in place; branches and crown
 * attach to it via offset so they do not float in the air next to a bent trunk.
 */
export class TrunkShape {
    private height: number
    private lean: Vector3
    private wobble_a: Vector3
    private wobble_b: Vector3
    private sweep: Vector3
    private frequency_a: number
    private frequency_b: number
    private phase_a: number
    private phase_b: number
    private bark_phase: number

    constructor(random: Random, height: number, style: TrunkStyle) {
        this.height = height
        const angle: number = random.next() * Math.PI * 2
        const side: number = angle + Math.PI / 2 + random.range(-0.6, 0.6)
        const sweep_angle: number = angle + Math.PI + random.range(-0.8, 0.8)
        this.lean = new Vector3(Math.cos(angle), 0, Math.sin(angle)).multiplyScalar(height * random.range(style.lean[0], style.lean[1]))
        this.wobble_a = new Vector3(Math.cos(side), 0, Math.sin(side)).multiplyScalar(height * random.range(style.wobble[0], style.wobble[1]))
        this.wobble_b = new Vector3(Math.cos(angle), 0, Math.sin(angle)).multiplyScalar(height * random.range(style.wobble[0], style.wobble[1]) * 0.6)
        this.sweep = new Vector3(Math.cos(sweep_angle), 0, Math.sin(sweep_angle)).multiplyScalar(height * random.range(style.sweep[0], style.sweep[1]))
        this.frequency_a = random.range(1.2, 2.2)
        this.frequency_b = random.range(2.5, 4)
        this.phase_a = random.next() * Math.PI * 2
        this.phase_b = random.next() * Math.PI * 2
        this.bark_phase = random.next() * 100
    }

    /** Horizontal offset of the trunk axis at height y */
    offset(y: number): Vector3 {
        const t: number = Math.max(0, y) / this.height
        // Lean grows toward the top and bends fade toward the base so the base stays at zero
        const lean: number = Math.pow(t, 1.6)
        const wave_a: number = (Math.sin(t * Math.PI * this.frequency_a + this.phase_a) - Math.sin(this.phase_a)) * t
        const wave_b: number = (Math.sin(t * Math.PI * this.frequency_b + this.phase_b) - Math.sin(this.phase_b)) * t
        const sweep: number = 1 - Math.exp(-t * 9)
        return new Vector3()
            .addScaledVector(this.lean, lean)
            .addScaledVector(this.wobble_a, wave_a)
            .addScaledVector(this.wobble_b, wave_b)
            .addScaledVector(this.sweep, sweep)
    }

    /** Point on the trunk axis */
    point(y: number): Vector3 {
        return this.offset(y).setY(y)
    }

    /**
     * Trunk from the ground up to length: bent along the axis, root flare at the ground
     * and lengthwise bark irregularities so the cross-section is not a perfect circle
     */
    geometry(radius_top: number, radius_bottom: number, length: number): BufferGeometry {
        const rings: number = Math.max(6, Math.round(length / 1.2))
        const geometry: BufferGeometry = new CylinderGeometry(radius_top, radius_bottom, length, 10, rings, true)
        geometry.translate(0, length / 2, 0)
        const position: BufferAttribute = geometry.getAttribute('position') as BufferAttribute
        for (let i: number = 0; i < position.count; i++) {
            const x: number = position.getX(i)
            const y: number = position.getY(i)
            const z: number = position.getZ(i)
            const angle: number = Math.atan2(z, x)
            const flare: number = 1 + 0.55 * Math.exp(-y / (radius_bottom * 3.5))
            const bark: number = 1 + Math.sin(angle * 5 + y * 0.9 + this.bark_phase) * 0.05 + Math.sin(angle * 3 - y * 0.4) * 0.04
            const shift: Vector3 = this.offset(y)
            position.setXYZ(i, x * flare * bark + shift.x, y, z * flare * bark + shift.z)
        }
        const uv: Float32BufferAttribute = geometry.getAttribute('uv') as Float32BufferAttribute
        for (let i: number = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2, uv.getY(i) * length / 2.5)
        return geometry
    }
}
