import { BufferAttribute, BufferGeometry, CylinderGeometry, Float32BufferAttribute, Matrix4, Quaternion, Vector3 } from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { Random } from '../core/Random'
import { TreeDetail, TrunkShape, TrunkStyle } from './TrunkShape'

/** Finished tree model: group 0 is the trunk, group 1 is the crown */
export interface TreeModel {
    geometry: BufferGeometry
    trunk_radius: number
}

const UP: Vector3 = new Vector3(0, 1, 0)

/** Spruces are nearly straight, deciduous trees noticeably more bent, dry desert trees the most gnarled */
const FIR_TRUNK: TrunkStyle = { lean: [0.015, 0.05], wobble: [0.008, 0.02], sweep: [0.006, 0.025], crooks: [0, 1], crook: [0.008, 0.02], knots: [1, 3] }
const BROADLEAF_TRUNK: TrunkStyle = { lean: [0.04, 0.12], wobble: [0.025, 0.05], sweep: [0.015, 0.04], crooks: [1, 2], crook: [0.02, 0.045], knots: [2, 5] }
const DEAD_TRUNK: TrunkStyle = { lean: [0.06, 0.16], wobble: [0.035, 0.065], sweep: [0.02, 0.06], crooks: [1, 3], crook: [0.03, 0.06], knots: [3, 6] }

/**
 * Procedural plants built from alpha-textured cards: spruces, deciduous trees, dry trees and bushes.
 * Card normals point away from the crown center, so the crown is lit
 * as a solid volume rather than a set of planes.
 */
export class TreeFactory {
    /**
     * Spruce: tapering tiers of drooping branches around the trunk.
     * medium drops the short inner shoots and thins the tiers; lite (shadow casters only)
     * has half the tiers, wider boughs and no side shoots
     */
    static fir(seed: number, detail: TreeDetail = 'full'): TreeModel {
        const lite: boolean = detail === 'lite'
        const random: Random = new Random(seed)
        const height: number = random.range(15, 21)
        const trunk_radius: number = height * 0.019
        const shape: TrunkShape = new TrunkShape(random, height, FIR_TRUNK)
        // The trunk runs along the bent axis all the way to the tip of the leader and tapers almost to a point,
        // so the upper whorls and the leader sit on it instead of hanging in the air
        const trunk: BufferGeometry = shape.geometry(trunk_radius * 0.06, trunk_radius, height * 1.01, detail)

        const cards: CardWriter = new CardWriter()
        const crown_start: number = height * random.range(0.05, 0.12)
        const crown_radius: number = height * random.range(0.19, 0.24)
        const layers: number = lite ? 11 : detail === 'medium' ? 16 : 24
        for (let l: number = 0; l < layers; l++) {
            const f: number = l / (layers - 1)
            const y: number = crown_start + (height * 0.95 - crown_start) * f + random.range(-0.15, 0.15)
            // Slightly convex cone: a spruce crown is fuller in the middle than a straight cone
            const radius: number = crown_radius * Math.pow(1 - f, 0.8) * random.range(0.88, 1.08) + 0.65
            const count: number = Math.max(5, Math.round(9 * (1 - f)) + 5)
            // Each whorl attaches to the bent trunk axis at its own height
            const base: Vector3 = shape.point(y)
            const center: Vector3 = base.clone().setY(y - radius * 0.35)
            // Lower branches sag under their weight, upper ones still reach upward
            const sag: number = 0.15 + 0.4 * (1 - f)
            const rise: number = 0.25 * f
            for (let c: number = 0; c < count; c++) {
                // Gaps where a branch broke off or never grew
                if (random.chance(0.08)) continue
                const angle: number = (c / count) * Math.PI * 2 + random.range(-0.3, 0.3) + l * 0.71
                const direction: Vector3 = new Vector3(Math.cos(angle), 0, Math.sin(angle))
                const length: number = radius * random.range(0.75, 1.2)
                const droop: number = length * (sag + random.range(-0.08, 0.08))
                const from: Vector3 = base.clone().setY(base.y + random.range(-0.12, 0.12))
                // Branch leaves the trunk, arcs down under its weight and the tip turns slightly up again
                const points: Vector3[] = [
                    from,
                    from.clone().addScaledVector(direction, length * 0.33).add(new Vector3(0, length * (rise - droop * 0.15 / length), 0)),
                    from.clone().addScaledVector(direction, length * 0.68).add(new Vector3(0, length * rise * 0.6 - droop * 0.75, 0)),
                    from.clone().addScaledVector(direction, length).add(new Vector3(0, length * rise * 0.3 - droop * 0.85, 0)),
                ]
                cards.bough(points, length * (lite ? 1.25 : detail === 'medium' ? 1.0 : 0.9), random.range(-0.35, 0.35), center)
                // Medium keeps side shoots only on the lower, sagging half where they show most
                if (lite || (detail === 'medium' && f > 0.5)) continue
                // Side shoots hang from the bough like a comb and give it thickness when seen edge-on
                const hang_from: Vector3 = points[1].clone().lerp(points[2], random.range(0.2, 0.8))
                const hang: number = length * random.range(0.25, 0.4) * (0.5 + sag)
                cards.hanging(hang_from, direction, hang, length * random.range(0.45, 0.65), center)
            }
            // A few short shoots near the trunk fill the core of the crown
            const inner: number = detail === 'full' ? Math.ceil(count * 0.35) : 0
            for (let c: number = 0; c < inner; c++) {
                const angle: number = random.next() * Math.PI * 2
                const length: number = radius * random.range(0.35, 0.55)
                const droop: number = length * random.range(0.3, 0.6)
                const from: Vector3 = base.clone().setY(y + random.range(-0.4, 0.4))
                const tip: Vector3 = from.clone().add(new Vector3(Math.cos(angle) * length, -droop, Math.sin(angle) * length))
                cards.branch(from, tip, length * 1.1, random.range(-1.2, 1.2), center)
            }
        }
        // Leader: a thin upright shoot with a couple of crossed cards
        const top_base: Vector3 = shape.point(height * 0.86)
        const top_tip: Vector3 = shape.point(height * 1.03)
        const top_center: Vector3 = shape.point(height * 0.8)
        cards.branch(top_base, top_tip, 1.3, 0, top_center)
        cards.branch(top_base, top_tip, 1.3, Math.PI / 2, top_center)

        return { geometry: TreeFactory.merge(trunk, cards.build()), trunk_radius: trunk_radius }
    }

    /**
     * Deciduous tree: trunk with branches and a spherical crown of foliage clusters.
     * lite (shadow casters only): a coarse trunk, two limbs and fewer, larger clusters
     */
    static broadleaf(seed: number, detail: TreeDetail = 'full'): TreeModel {
        const lite: boolean = detail === 'lite'
        const random: Random = new Random(seed)
        const height: number = random.range(10, 16)
        const trunk_radius: number = height * 0.024
        const shape: TrunkShape = new TrunkShape(random, height, BROADLEAF_TRUNK)
        const parts: BufferGeometry[] = [shape.geometry(trunk_radius * 0.45, trunk_radius, height * 0.62, detail)]

        // The crown sits on top of the bent trunk, not straight above the base
        const crown_center: Vector3 = shape.point(height * 0.64).add(new Vector3(random.range(-0.4, 0.4), 0, random.range(-0.4, 0.4)))
        const crown_radius: number = height * random.range(0.27, 0.33)

        // A few branches from the trunk toward the crown
        for (let b: number = 0; b < (lite ? 2 : 4); b++) {
            const angle: number = random.next() * Math.PI * 2
            const from: Vector3 = shape.point(height * random.range(0.38, 0.5))
            const to: Vector3 = crown_center.clone().add(new Vector3(Math.cos(angle) * crown_radius * 0.7, random.range(-0.5, 1.5), Math.sin(angle) * crown_radius * 0.7))
            const bow: Vector3 = new Vector3(random.range(-0.4, 0.4), 1, random.range(-0.4, 0.4))
            parts.push(TreeFactory.limb(from, to, trunk_radius * 0.35, bow, random.range(0.08, 0.16), random))
        }

        const cards: CardWriter = new CardWriter()
        const clusters: number = lite ? 18 : 34
        for (let c: number = 0; c < clusters; c++) {
            const direction: Vector3 = new Vector3(random.range(-1, 1), random.range(-0.7, 1), random.range(-1, 1)).normalize()
            const distance: number = crown_radius * Math.sqrt(random.range(0.25, 1))
            const position: Vector3 = crown_center.clone().addScaledVector(direction, distance)
            position.y = crown_center.y + (position.y - crown_center.y) * 0.85
            const size: number = height * random.range(0.17, 0.25) * (lite ? 1.3 : 1)
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
                const bow: Vector3 = new Vector3(random.range(-1, 1), random.range(-0.3, 1), random.range(-1, 1))
                parts.push(TreeFactory.limb(from, to, radius, bow, random.range(0.06, 0.18), random))
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

    /**
     * Branch from one point to another, bowed sideways toward hint by bend (fraction of length)
     * with a smaller S-shaped wiggle, so limbs are not straight sticks. Both ends stay in place.
     */
    private static limb(from: Vector3, to: Vector3, radius: number, hint: Vector3, bend: number, random: Random): BufferGeometry {
        const radial: number = 6
        const length: number = from.distanceTo(to)
        const geometry: BufferGeometry = new CylinderGeometry(radius * 0.35, radius, length, radial, 6, true)
        geometry.translate(0, length / 2, 0)
        const direction: Vector3 = to.clone().sub(from).normalize()
        const rotation: Quaternion = new Quaternion().setFromUnitVectors(UP, direction)
        geometry.applyMatrix4(new Matrix4().compose(from, rotation, new Vector3(1, 1, 1)))

        const bow: Vector3 = hint.clone().addScaledVector(direction, -hint.dot(direction))
        if (bow.lengthSq() < 1e-4) bow.set(1, 0, 0).addScaledVector(direction, -direction.x)
        bow.normalize()
        const wiggle: Vector3 = new Vector3().crossVectors(direction, bow).multiplyScalar(length * bend * random.range(-0.4, 0.4))
        bow.multiplyScalar(length * bend)
        const position: BufferAttribute = geometry.getAttribute('position') as BufferAttribute
        const p: Vector3 = new Vector3()
        for (let i: number = 0; i < position.count; i++) {
            p.fromBufferAttribute(position, i)
            const s: number = Math.min(1, Math.max(0, p.clone().sub(from).dot(direction) / length))
            p.addScaledVector(bow, Math.sin(s * Math.PI)).addScaledVector(wiggle, Math.sin(s * Math.PI * 2))
            position.setXYZ(i, p.x, p.y, p.z)
        }
        TrunkShape.smoothNormals(geometry, radial)
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

    /**
     * Bent branch card along a polyline (base first). The texture runs along the whole
     * length, so the bough droops and curves instead of being a flat plank
     */
    bough(points: Vector3[], width: number, roll: number, center: Vector3): void {
        const axis: Vector3 = points[points.length - 1].clone().sub(points[0]).normalize()
        let side: Vector3 = new Vector3().crossVectors(axis, UP)
        if (side.lengthSq() < 1e-4) side.set(1, 0, 0)
        side.normalize().applyAxisAngle(axis, roll)
        let total: number = 0
        for (let i: number = 1; i < points.length; i++) total += points[i].distanceTo(points[i - 1])
        const start: number = this.positions.length / 3
        let run: number = 0
        for (let i: number = 0; i < points.length; i++) {
            if (i > 0) run += points[i].distanceTo(points[i - 1])
            const v: number = run / total
            // A bough is widest a little way out from the trunk and narrows to the tip
            const half: Vector3 = side.clone().multiplyScalar(width * 0.5 * (0.75 + 0.25 * Math.sin(Math.min(1, v * 1.6) * Math.PI * 0.5)))
            this.vertex(points[i].clone().sub(half), 0, v, center)
            this.vertex(points[i].clone().add(half), 1, v, center)
        }
        for (let i: number = 0; i < points.length - 1; i++) {
            const a: number = start + i * 2
            this.indices.push(a, a + 1, a + 3, a, a + 3, a + 2)
        }
    }

    /** Vertical card of shoots hanging under a bough: stem at the top, twigs pointing down */
    hanging(top: Vector3, direction: Vector3, length: number, width: number, center: Vector3): void {
        const half: Vector3 = new Vector3(direction.x, 0, direction.z).normalize().multiplyScalar(width * 0.5)
        const bottom: Vector3 = top.clone().add(new Vector3(0, -length, 0)).addScaledVector(direction, length * 0.15)
        this.quad(
            top.clone().sub(half), top.clone().add(half),
            bottom.clone().add(half), bottom.clone().sub(half),
            center,
        )
    }

    private vertex(p: Vector3, u: number, v: number, center: Vector3): void {
        const n: Vector3 = p.clone().sub(center).normalize().addScaledVector(UP, 0.35).normalize()
        this.positions.push(p.x, p.y, p.z)
        this.normals.push(n.x, n.y, n.z)
        this.uvs.push(u, v)
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
