import { BufferAttribute, BufferGeometry, CylinderGeometry, Float32BufferAttribute, Quaternion, Vector3 } from 'three'
import { Random } from '../core/Random'

/** Model detail: full for close-ups, medium for the world, lite for shadow casters */
export type TreeDetail = 'full' | 'medium' | 'lite'

/** How strongly the trunk bends, as fractions of tree height */
export interface TrunkStyle {
    /** Overall lean of the top */
    lean: [number, number]
    /** Amplitude of smooth bends */
    wobble: [number, number]
    /** Bend at the base: the trunk leaves the ground at an angle and then straightens */
    sweep: [number, number]
    /** Number of crooks: short sideways jogs where the trunk once lost its leader */
    crooks: [number, number]
    /** Sideways shift of one crook */
    crook: [number, number]
    /** Bark knots and burls per trunk */
    knots: [number, number]
}

/** A short sideways jog of the axis at height t (fraction of tree height) */
interface Crook {
    t: number
    width: number
    shift: Vector3
}

/** A bump on the bark surface */
interface Knot {
    y: number
    angle: number
    size: number
    strength: number
}

const UP: Vector3 = new Vector3(0, 1, 0)
const IDENTITY: Quaternion = new Quaternion()

/**
 * Bent trunk axis and its geometry. The axis starts exactly at (0, 0, 0),
 * so the collider at the base stays in place; branches and crown
 * attach to it via offset so they do not float in the air next to a bent trunk.
 */
export class TrunkShape {
    private height: number
    private lean: Vector3
    private lean_power: number
    private wobble_a: Vector3
    private wobble_b: Vector3
    private wobble_c: Vector3
    private sweep: Vector3
    private frequency_a: number
    private frequency_b: number
    private frequency_c: number
    private phase_a: number
    private phase_b: number
    private phase_c: number
    private crooks: Crook[] = []
    private knots: Knot[] = []
    private bark_phase: number
    private oval: number
    private oval_angle: number
    private oval_twist: number
    private roots: number
    private root_phase: number

    constructor(random: Random, height: number, style: TrunkStyle) {
        this.height = height
        const angle: number = random.next() * Math.PI * 2
        const side: number = angle + Math.PI / 2 + random.range(-0.6, 0.6)
        const sweep_angle: number = angle + Math.PI + random.range(-0.8, 0.8)
        const third: number = random.next() * Math.PI * 2
        this.lean = TrunkShape.horizontal(angle, height * random.range(style.lean[0], style.lean[1]))
        this.lean_power = random.range(1.2, 2)
        this.wobble_a = TrunkShape.horizontal(side, height * random.range(style.wobble[0], style.wobble[1]))
        this.wobble_b = TrunkShape.horizontal(angle, height * random.range(style.wobble[0], style.wobble[1]) * 0.6)
        // Third bend in an unrelated direction so the axis wanders in space instead of staying in one plane
        this.wobble_c = TrunkShape.horizontal(third, height * random.range(style.wobble[0], style.wobble[1]) * 0.35)
        this.sweep = TrunkShape.horizontal(sweep_angle, height * random.range(style.sweep[0], style.sweep[1]))
        this.frequency_a = random.range(1.2, 2.2)
        this.frequency_b = random.range(2.5, 4)
        this.frequency_c = random.range(5, 8)
        this.phase_a = random.next() * Math.PI * 2
        this.phase_b = random.next() * Math.PI * 2
        this.phase_c = random.next() * Math.PI * 2

        const crook_count: number = random.int(style.crooks[0], style.crooks[1])
        for (let i: number = 0; i < crook_count; i++) {
            this.crooks.push({
                t: random.range(0.2, 0.75),
                width: random.range(0.06, 0.14),
                shift: TrunkShape.horizontal(random.next() * Math.PI * 2, height * random.range(style.crook[0], style.crook[1])),
            })
        }
        const knot_count: number = random.int(style.knots[0], style.knots[1])
        for (let i: number = 0; i < knot_count; i++) {
            this.knots.push({
                y: height * random.range(0.1, 0.6),
                angle: random.next() * Math.PI * 2,
                size: random.range(0.25, 0.5),
                strength: random.range(0.12, 0.3),
            })
        }
        this.bark_phase = random.next() * 100
        this.oval = random.range(0.05, 0.14)
        this.oval_angle = random.next() * Math.PI
        this.oval_twist = random.range(-0.15, 0.15)
        this.roots = random.int(4, 6)
        this.root_phase = random.next() * Math.PI * 2
    }

    /** Horizontal offset of the trunk axis at height y */
    offset(y: number): Vector3 {
        const t: number = Math.max(0, y) / this.height
        // Lean grows toward the top and bends fade toward the base so the base stays at zero
        const lean: number = Math.pow(t, this.lean_power)
        const wave_a: number = (Math.sin(t * Math.PI * this.frequency_a + this.phase_a) - Math.sin(this.phase_a)) * t
        const wave_b: number = (Math.sin(t * Math.PI * this.frequency_b + this.phase_b) - Math.sin(this.phase_b)) * t
        const wave_c: number = (Math.sin(t * Math.PI * this.frequency_c + this.phase_c) - Math.sin(this.phase_c)) * t
        const sweep: number = 1 - Math.exp(-t * 9)
        const result: Vector3 = new Vector3()
            .addScaledVector(this.lean, lean)
            .addScaledVector(this.wobble_a, wave_a)
            .addScaledVector(this.wobble_b, wave_b)
            .addScaledVector(this.wobble_c, wave_c)
            .addScaledVector(this.sweep, sweep)
        for (const crook of this.crooks) {
            const s: number = Math.min(1, Math.max(0, (t - crook.t) / crook.width + 0.5))
            result.addScaledVector(crook.shift, s * s * (3 - 2 * s))
        }
        return result
    }

    /** Point on the trunk axis */
    point(y: number): Vector3 {
        return this.offset(y).setY(y)
    }

    /** Unit direction of the trunk axis at height y */
    tangent(y: number): Vector3 {
        const step: number = 0.05
        return this.point(y + step).sub(this.point(Math.max(0, y - step))).normalize()
    }

    /**
     * Trunk from the ground up to length: bent along the axis with rings kept perpendicular to it,
     * root buttresses at the ground, an oval twisting cross-section, knots and bark ridges.
     * Lower detail gives a coarser trunk with fewer sides and rings.
     */
    geometry(radius_top: number, radius_bottom: number, length: number, detail: TreeDetail = 'full'): BufferGeometry {
        const radial: number = detail === 'lite' ? 6 : detail === 'medium' ? 8 : 12
        const ring_step: number = detail === 'lite' ? 2.5 : detail === 'medium' ? 1.2 : 0.6
        const rings: number = Math.max(detail === 'full' ? 10 : 4, Math.round(length / ring_step))
        const geometry: BufferGeometry = new CylinderGeometry(radius_top, radius_bottom, length, radial, rings, true)
        geometry.translate(0, length / 2, 0)
        const position: BufferAttribute = geometry.getAttribute('position') as BufferAttribute
        const local: Vector3 = new Vector3()
        const rotation: Quaternion = new Quaternion()
        for (let i: number = 0; i < position.count; i++) {
            const x: number = position.getX(i)
            const y: number = position.getY(i)
            const z: number = position.getZ(i)
            const angle: number = Math.atan2(z, x)
            const root: number = Math.max(0, Math.cos(angle * this.roots + this.root_phase))
            const flare: number = 1 + (0.35 + 0.55 * root * root) * Math.exp(-y / (radius_bottom * 3.5))
            const bark: number = 1 + Math.sin(angle * 5 + y * 0.9 + this.bark_phase) * 0.05 + Math.sin(angle * 3 - y * 0.4) * 0.04
            const oval_axis: number = this.oval_angle + y * this.oval_twist
            const oval: number = 1 + this.oval * Math.cos(2 * (angle - oval_axis))
            let knot: number = 0
            for (const k of this.knots) {
                const dy: number = (y - k.y) / k.size
                const da: number = Math.atan2(Math.sin(angle - k.angle), Math.cos(angle - k.angle)) / 0.6
                knot += k.strength * Math.exp(-(dy * dy + da * da))
            }
            const scale: number = flare * bark * oval + knot
            local.set(x * scale, 0, z * scale)
            // Rings follow the axis direction, but at the ground they stay flat so the base sits on the terrain
            const tilt: number = Math.min(1, y / (radius_bottom * 4))
            rotation.setFromUnitVectors(UP, this.tangent(y))
            local.applyQuaternion(IDENTITY.clone().slerp(rotation, tilt))
            const center: Vector3 = this.point(y)
            position.setXYZ(i, center.x + local.x, center.y + local.y, center.z + local.z)
        }
        TrunkShape.smoothNormals(geometry, radial)
        const uv: Float32BufferAttribute = geometry.getAttribute('uv') as Float32BufferAttribute
        for (let i: number = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2, uv.getY(i) * length / 2.5)
        return geometry
    }

    /**
     * Recomputes normals of a deformed open cylinder and welds them across the seam,
     * where CylinderGeometry duplicates the first column of vertices
     */
    static smoothNormals(geometry: BufferGeometry, radial: number): void {
        geometry.computeVertexNormals()
        const normal: BufferAttribute = geometry.getAttribute('normal') as BufferAttribute
        const columns: number = radial + 1
        const a: Vector3 = new Vector3()
        const b: Vector3 = new Vector3()
        for (let row: number = 0; row * columns < normal.count; row++) {
            const first: number = row * columns
            const last: number = first + radial
            a.fromBufferAttribute(normal, first)
            b.fromBufferAttribute(normal, last)
            a.add(b).normalize()
            normal.setXYZ(first, a.x, a.y, a.z)
            normal.setXYZ(last, a.x, a.y, a.z)
        }
    }

    private static horizontal(angle: number, length: number): Vector3 {
        return new Vector3(Math.cos(angle), 0, Math.sin(angle)).multiplyScalar(length)
    }
}
