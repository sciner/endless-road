import { BufferGeometry, CylinderGeometry, Float32BufferAttribute, Matrix4, Quaternion, Vector3 } from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { Random } from '../core/Random'
import { TrunkShape, TrunkStyle } from './TrunkShape'

/** Finished tree model: group 0 is the trunk, group 1 is the crown */
export interface TreeModel {
    geometry: BufferGeometry
    trunk_radius: number
}

const UP: Vector3 = new Vector3(0, 1, 0)

/** Spruces are nearly straight, deciduous trees noticeably more bent, dry desert trees the most gnarled */
const FIR_TRUNK: TrunkStyle = { lean: [0.008, 0.028], wobble: [0.004, 0.011], sweep: [0.004, 0.016] }
const BROADLEAF_TRUNK: TrunkStyle = { lean: [0.03, 0.08], wobble: [0.012, 0.03], sweep: [0.008, 0.028] }
const DEAD_TRUNK: TrunkStyle = { lean: [0.05, 0.12], wobble: [0.02, 0.045], sweep: [0.01, 0.04] }

/**
 * Procedural plants built from alpha-textured cards: spruces, deciduous trees, dry trees and bushes.
 * Card normals point away from the crown center, so the crown is lit
 * as a solid volume rather than a set of planes.
 */
export class TreeFactory {
    /** Spruce: tapering tiers of drooping branches around the trunk */
    static fir(seed: number): TreeModel {
        const random: Random = new Random(seed)
        const height: number = random.range(15, 21)
        const trunk_radius: number = height * 0.019
        const shape: TrunkShape = new TrunkShape(random, height, FIR_TRUNK)
        const trunk: BufferGeometry = shape.geometry(trunk_radius * 0.2, trunk_radius, height)

        const cards: CardWriter = new CardWriter()
        const crown_start: number = height * random.range(0.1, 0.22)
        const crown_radius: number = height * random.range(0.2, 0.25)
        const layers: number = 17
        for (let l: number = 0; l < layers; l++) {
            const f: number = l / (layers - 1)
            const y: number = crown_start + (height * 0.96 - crown_start) * f
            const radius: number = crown_radius * Math.pow(1 - f, 0.9) + 0.45
            const count: number = Math.max(4, Math.round(9 * (1 - f)) + 3)
            // Each tier attaches to the bent trunk axis at its own height
            const base: Vector3 = shape.point(y)
            const center: Vector3 = base.clone().setY(y - radius * 0.35)
            for (let c: number = 0; c < count; c++) {
                const angle: number = (c / count) * Math.PI * 2 + random.range(-0.25, 0.25) + l * 0.71
                const length: number = radius * random.range(0.85, 1.15)
                const droop: number = length * random.range(0.18, 0.42)
                const tip: Vector3 = base.clone().add(new Vector3(Math.cos(angle) * length, -droop, Math.sin(angle) * length))
                cards.branch(base, tip, length * 0.78, random.range(-0.5, 0.5), center)
            }
        }
        // Top: two crossed vertical cards
        const top_base: Vector3 = shape.point(height * 0.86)
        const top_tip: Vector3 = shape.point(height * 1.02)
        const top_center: Vector3 = shape.point(height * 0.8)
        cards.branch(top_base, top_tip, 1.6, 0, top_center)
        cards.branch(top_base, top_tip, 1.6, Math.PI / 2, top_center)

        return { geometry: TreeFactory.merge(trunk, cards.build()), trunk_radius: trunk_radius }
    }

    /** Deciduous tree: trunk with branches and a spherical crown of foliage clusters */
    static broadleaf(seed: number): TreeModel {
        const random: Random = new Random(seed)
        const height: number = random.range(10, 16)
        const trunk_radius: number = height * 0.024
        const shape: TrunkShape = new TrunkShape(random, height, BROADLEAF_TRUNK)
        const parts: BufferGeometry[] = [shape.geometry(trunk_radius * 0.45, trunk_radius, height * 0.62)]

        // The crown sits on top of the bent trunk, not straight above the base
        const crown_center: Vector3 = shape.point(height * 0.64).add(new Vector3(random.range(-0.4, 0.4), 0, random.range(-0.4, 0.4)))
        const crown_radius: number = height * random.range(0.27, 0.33)

        // A few branches from the trunk toward the crown
        for (let b: number = 0; b < 4; b++) {
            const angle: number = random.next() * Math.PI * 2
            const from: Vector3 = shape.point(height * random.range(0.38, 0.5))
            const to: Vector3 = crown_center.clone().add(new Vector3(Math.cos(angle) * crown_radius * 0.7, random.range(-0.5, 1.5), Math.sin(angle) * crown_radius * 0.7))
            parts.push(TreeFactory.limb(from, to, trunk_radius * 0.35))
        }

        const cards: CardWriter = new CardWriter()
        const clusters: number = 34
        for (let c: number = 0; c < clusters; c++) {
            const direction: Vector3 = new Vector3(random.range(-1, 1), random.range(-0.7, 1), random.range(-1, 1)).normalize()
            const distance: number = crown_radius * Math.sqrt(random.range(0.25, 1))
            const position: Vector3 = crown_center.clone().addScaledVector(direction, distance)
            position.y = crown_center.y + (position.y - crown_center.y) * 0.85
            const size: number = height * random.range(0.17, 0.25)
            cards.cluster(position, size, random, crown_center)
        }
        parts.push(cards.build())
        const trunk: BufferGeometry = mergeGeometries(parts.slice(0, parts.length - 1), false) as BufferGeometry
        return { geometry: TreeFactory.merge(trunk, parts[parts.length - 1]), trunk_radius: trunk_radius }
    }

    /** Dry dead desert tree: bent trunk with recursively branching bare limbs */
    static deadTree(seed: number): TreeModel {
        const random: Random = new Random(seed)
        const height: number = random.range(5, 8.5)
        const trunk_radius: number = height * 0.03
        const shape: TrunkShape = new TrunkShape(random, height, DEAD_TRUNK)
        const parts: BufferGeometry[] = [shape.geometry(trunk_radius * 0.55, trunk_radius, height * 0.55)]

        const grow: (from: Vector3, direction: Vector3, length: number, radius: number, depth: number) => void =
            (from: Vector3, direction: Vector3, length: number, radius: number, depth: number): void => {
                const to: Vector3 = from.clone().addScaledVector(direction, length)
                parts.push(TreeFactory.limb(from, to, radius))
                if (depth >= 3) return
                const forks: number = depth === 0 ? 3 : 2
                for (let i: number = 0; i < forks; i++) {
                    const next: Vector3 = direction.clone()
                        .add(new Vector3(random.range(-0.9, 0.9), random.range(-0.1, 0.5), random.range(-0.9, 0.9)))
                        .normalize()
                    grow(to, next, length * random.range(0.55, 0.75), radius * 0.6, depth + 1)
                }
            }
        const top: Vector3 = shape.point(height * 0.55)
        for (let i: number = 0; i < 2; i++) {
            const direction: Vector3 = new Vector3(random.range(-0.5, 0.5), 1, random.range(-0.5, 0.5)).normalize()
            grow(top, direction, height * random.range(0.25, 0.35), trunk_radius * 0.7, 0)
        }
        return { geometry: mergeGeometries(parts, false) as BufferGeometry, trunk_radius: trunk_radius }
    }

    /** Dry bush: vertical cards fanned around the center, base at ground level */
    static dryBush(seed: number): TreeModel {
        const random: Random = new Random(seed)
        const cards: CardWriter = new CardWriter()
        const width: number = random.range(1.2, 1.9)
        const height: number = width * random.range(0.55, 0.75)
        const center: Vector3 = new Vector3(0, -height * 0.6, 0)
        const count: number = 5
        for (let i: number = 0; i < count; i++) {
            const angle: number = (i / count) * Math.PI + random.range(-0.2, 0.2)
            const half: Vector3 = new Vector3(Math.cos(angle), 0, Math.sin(angle)).multiplyScalar(width * 0.5 * random.range(0.8, 1.1))
            const lean: Vector3 = new Vector3(random.range(-0.2, 0.2), 0, random.range(-0.2, 0.2))
            const base: Vector3 = new Vector3(lean.x * 0.3, 0, lean.z * 0.3)
            const top: Vector3 = new Vector3(lean.x, height * random.range(0.85, 1.1), lean.z)
            cards.upright(base, top, half, center)
        }
        return { geometry: cards.build(), trunk_radius: 0 }
    }

    private static limb(from: Vector3, to: Vector3, radius: number): BufferGeometry {
        const length: number = from.distanceTo(to)
        const geometry: BufferGeometry = new CylinderGeometry(radius * 0.35, radius, length, 6, 1, true)
        geometry.translate(0, length / 2, 0)
        const direction: Vector3 = to.clone().sub(from).normalize()
        const rotation: Quaternion = new Quaternion().setFromUnitVectors(UP, direction)
        geometry.applyMatrix4(new Matrix4().compose(from, rotation, new Vector3(1, 1, 1)))
        TreeFactory.scaleUv(geometry, 1, length / 2.5)
        return geometry
    }

    private static scaleUv(geometry: BufferGeometry, u: number, v: number): void {
        const uv: Float32BufferAttribute = geometry.getAttribute('uv') as Float32BufferAttribute
        for (let i: number = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * u, uv.getY(i) * v)
    }

    private static merge(trunk: BufferGeometry, foliage: BufferGeometry): BufferGeometry {
        return mergeGeometries([trunk, foliage], true) as BufferGeometry
    }
}

/**
 * Accumulator for crown cards
 */
class CardWriter {
    private positions: number[] = []
    private normals: number[] = []
    private uvs: number[] = []
    private indices: number[] = []

    /** Branch card from base to tip, rotated around its own axis by roll */
    branch(base: Vector3, tip: Vector3, width: number, roll: number, center: Vector3): void {
        const axis: Vector3 = tip.clone().sub(base).normalize()
        let side: Vector3 = new Vector3().crossVectors(axis, UP)
        if (side.lengthSq() < 1e-4) side.set(1, 0, 0)
        side.normalize().applyAxisAngle(axis, roll)
        const half: Vector3 = side.multiplyScalar(width * 0.5)
        this.quad(
            base.clone().sub(half), base.clone().add(half),
            tip.clone().add(half), tip.clone().sub(half),
            center,
        )
    }

    /** Foliage cluster: three mutually perpendicular cards with random orientation */
    cluster(position: Vector3, size: number, random: Random, center: Vector3): void {
        const rotation: Quaternion = new Quaternion().setFromAxisAngle(
            new Vector3(random.range(-1, 1), random.range(-1, 1), random.range(-1, 1)).normalize(),
            random.next() * Math.PI,
        )
        const axes: Vector3[] = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)]
        for (let k: number = 0; k < 3; k++) {
            const u: Vector3 = axes[k].clone().applyQuaternion(rotation).multiplyScalar(size * 0.5)
            const v: Vector3 = axes[(k + 1) % 3].clone().applyQuaternion(rotation).multiplyScalar(size * 0.5)
            this.quad(
                position.clone().sub(u).sub(v), position.clone().add(u).sub(v),
                position.clone().add(u).add(v), position.clone().sub(u).add(v),
                center,
            )
        }
    }

    /** Vertical card from base to top, 2·half wide */
    upright(base: Vector3, top: Vector3, half: Vector3, center: Vector3): void {
        this.quad(
            base.clone().sub(half), base.clone().add(half),
            top.clone().add(half), top.clone().sub(half),
            center,
        )
    }

    private quad(a: Vector3, b: Vector3, c: Vector3, d: Vector3, center: Vector3): void {
        const base: number = this.positions.length / 3
        const corners: Vector3[] = [a, b, c, d]
        const uv: number[][] = [[0, 0], [1, 0], [1, 1], [0, 1]]
        for (let k: number = 0; k < 4; k++) {
            const p: Vector3 = corners[k]
            const n: Vector3 = p.clone().sub(center).normalize().addScaledVector(UP, 0.35).normalize()
            this.positions.push(p.x, p.y, p.z)
            this.normals.push(n.x, n.y, n.z)
            this.uvs.push(uv[k][0], uv[k][1])
        }
        this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
    }

    build(): BufferGeometry {
        const geometry: BufferGeometry = new BufferGeometry()
        geometry.setAttribute('position', new Float32BufferAttribute(this.positions, 3))
        geometry.setAttribute('normal', new Float32BufferAttribute(this.normals, 3))
        geometry.setAttribute('uv', new Float32BufferAttribute(this.uvs, 2))
        geometry.setIndex(this.indices)
        return geometry
    }
}
