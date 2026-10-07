import { BufferAttribute, BufferGeometry, CylinderGeometry, Float32BufferAttribute, IcosahedronGeometry, Matrix4, Quaternion, SphereGeometry, Vector3 } from 'three'
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'
import { Random } from '../core/Random'
import { SimplexNoise } from '../core/SimplexNoise'
import { TreeModel } from './TreeFactory'

const UP: Vector3 = new Vector3(0, 1, 0)

/**
 * Procedural roadside objects: boulders and saguaro cacti.
 * They return the same model as trees: geometry and collider radius at scale 1.
 */
export class PropFactory {
    /**
     * Boulder: an icosphere displaced by noise along vertex directions, flattened
     * and with a flat bottom so it rests on the ground instead of a single point
     */
    static boulder(seed: number): TreeModel {
        const random: Random = new Random(seed)
        const noise: SimplexNoise = new SimplexNoise(seed)
        const source: BufferGeometry = new IcosahedronGeometry(1, 4)
        source.deleteAttribute('normal')
        source.deleteAttribute('uv')
        const geometry: BufferGeometry = mergeVertices(source)
        source.dispose()

        const stretch: Vector3 = new Vector3(random.range(0.9, 1.4), random.range(0.55, 0.8), random.range(0.75, 1.1))
        const position: BufferAttribute = geometry.getAttribute('position') as BufferAttribute
        const v: Vector3 = new Vector3()
        const uvs: number[] = []
        for (let i: number = 0; i < position.count; i++) {
            v.fromBufferAttribute(position, i)
            // Large bumps and small chips: noise over two projections of the direction
            const bumps: number = noise.noise2(v.x * 1.3 + 3.1, v.y * 1.3 - v.z * 0.7) * 0.18
            const chips: number = noise.noise2(v.z * 4.1 - 7.3, v.x * 4.1 + v.y * 2.3) * 0.05
            v.multiplyScalar(1 + bumps + chips).multiply(stretch)
            v.y = Math.max(v.y, -stretch.y * 0.35)
            position.setXYZ(i, v.x, v.y, v.z)
            uvs.push((v.x + v.z * 0.7) * 0.45, (v.y + v.z * 0.4) * 0.45)
        }
        geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
        // Bottom at ground level so instance scaling does not sink the rock below the terrain
        geometry.translate(0, stretch.y * 0.35, 0)
        geometry.computeVertexNormals()
        return { geometry: geometry, trunk_radius: Math.max(stretch.x, stretch.z) * 0.85 }
    }

    /** Saguaro: ribbed trunk with a hemispherical top and one to three upward-curving arms */
    static cactus(seed: number): TreeModel {
        const random: Random = new Random(seed)
        const height: number = random.range(3, 5.5)
        const radius: number = random.range(0.22, 0.3)
        const parts: BufferGeometry[] = [PropFactory.column(new Vector3(0, 0, 0), UP, height, radius)]

        const arms: number = random.int(1, 3)
        for (let a: number = 0; a < arms; a++) {
            const angle: number = random.next() * Math.PI * 2
            const out: Vector3 = new Vector3(Math.cos(angle), 0, Math.sin(angle))
            const arm_radius: number = radius * random.range(0.65, 0.8)
            const base: Vector3 = new Vector3(0, height * random.range(0.35, 0.6), 0)
            const reach: number = random.range(0.45, 0.7)
            // Elbow: a short horizontal stub, then a vertical arm
            const elbow: Vector3 = base.clone().addScaledVector(out, reach)
            parts.push(PropFactory.column(base, out, reach, arm_radius, false))
            const joint: BufferGeometry = new SphereGeometry(arm_radius, 12, 8)
            joint.translate(elbow.x, elbow.y, elbow.z)
            parts.push(joint)
            parts.push(PropFactory.column(elbow, UP, height * random.range(0.25, 0.4), arm_radius))
        }
        return { geometry: mergeGeometries(parts, false) as BufferGeometry, trunk_radius: radius * 1.3 }
    }

    /** Ribbed cylinder from base along direction; with a hemispherical top if cap */
    private static column(base: Vector3, direction: Vector3, length: number, radius: number, cap: boolean = true): BufferGeometry {
        const body: BufferGeometry = new CylinderGeometry(radius, radius * 1.04, length, 24, Math.max(2, Math.round(length * 2)), true)
        body.translate(0, length / 2, 0)
        const parts: BufferGeometry[] = [body]
        if (cap) {
            const top: BufferGeometry = new SphereGeometry(radius, 24, 8, 0, Math.PI * 2, 0, Math.PI / 2)
            top.translate(0, length, 0)
            parts.push(top)
        }
        const column: BufferGeometry = mergeGeometries(parts, false) as BufferGeometry
        PropFactory.ribs(column)
        const rotation: Quaternion = new Quaternion().setFromUnitVectors(UP, direction.clone().normalize())
        column.applyMatrix4(new Matrix4().compose(base, rotation, new Vector3(1, 1, 1)))
        column.computeVertexNormals()
        return column
    }

    /** Lengthwise cactus ribs: radius is modulated by angle around the axis */
    private static ribs(geometry: BufferGeometry): void {
        const position: BufferAttribute = geometry.getAttribute('position') as BufferAttribute
        for (let i: number = 0; i < position.count; i++) {
            const x: number = position.getX(i)
            const z: number = position.getZ(i)
            const angle: number = Math.atan2(z, x)
            const rib: number = 1 + Math.cos(angle * 12) * 0.06
            position.setX(i, x * rib)
            position.setZ(i, z * rib)
        }
    }
}
