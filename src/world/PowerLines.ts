import { BufferGeometry, Group, Mesh, MeshStandardMaterial, Object3D, Scene, Vector3 } from 'three'
import { Random } from '../core/Random'
import { GeometryWriter } from '../render/GeometryWriter'
import { WorldMaterials } from '../render/WorldMaterials'
import { RoadNetwork } from './RoadNetwork'
import { RoadProjection, RoadSample } from './RoadTypes'
import { WorldSurface } from './WorldSurface'
import { RAIL_OFFSET } from './WorldConfig'

/** How far from the car a stretch of the line is kept in the scene, m */
const VISIBLE: number = 700
/** Distance between poles, and how many poles one streamed mesh owns */
const SPAN: number = 52
const POLES_PER_CHUNK: number = 8
/** Distance from the road centerline while the line follows the road, m */
const LATERAL: number = 15
/** Length of a stretch that may wander away from the road and come back, m */
const WANDER_BLOCK: number = 720
/** Tall enough for the wires to clear the canopy, and the droop of a wire at mid-span, m */
const POLE_HEIGHT: number = 22
const SAG: number = 1.6
/** A pole must stand at least this far from every centerline, including a road it crosses, m */
const CLEARANCE: number = RAIL_OFFSET + 6

interface Pole {
    along: number
    base: Vector3
    top: Vector3
    right: Vector3
    tangent: Vector3
}

/**
 * One power line running the whole length of the road, on a side chosen by the seed.
 * Most of the way it stays parallel to the road; some stretches wander off and return,
 * and the wires never break between those stretches
 */
export class PowerLines {
    private network: RoadNetwork
    private surface: WorldSurface
    private materials: WorldMaterials
    private seed: number
    private root: Group = new Group()
    private wire_material: MeshStandardMaterial
    private built: Map<number, Group> = new Map()
    private up: Vector3 = new Vector3(0, 1, 0)
    /** +1 is the right side of the travel direction */
    private side: number

    constructor(scene: Scene, surface: WorldSurface, materials: WorldMaterials, seed: number) {
        this.network = surface.road
        this.surface = surface
        this.materials = materials
        this.seed = seed
        this.side = new Random(seed).sign()
        this.wire_material = new MeshStandardMaterial({ color: 0x26282b, metalness: 0.55, roughness: 0.48 })
        this.root.name = 'power-lines'
        scene.add(this.root)
    }

    /** Builds the line near the car and drops stretches left behind. At most max_builds new stretches per call */
    update(along: number, center: Vector3, max_builds: number): void {
        const here: number = Math.floor(along / (SPAN * POLES_PER_CHUNK))
        const reach: number = Math.ceil(VISIBLE / (SPAN * POLES_PER_CHUNK)) + 1
        const wanted: Set<number> = new Set()
        let builds: number = 0
        for (let chunk: number = here - reach; chunk <= here + reach; chunk++) {
            const origin: RoadSample | null = this.network.sampleAlong((chunk + 0.5) * POLES_PER_CHUNK * SPAN)
            if (!origin) continue
            const dx: number = origin.position.x - center.x
            const dz: number = origin.position.z - center.z
            if (dx * dx + dz * dz > VISIBLE * VISIBLE) continue
            wanted.add(chunk)
            if (this.built.has(chunk) || builds >= max_builds) continue
            const group: Group | null = this.build(chunk)
            if (!group) continue
            this.root.add(group)
            this.built.set(chunk, group)
            builds++
        }
        for (const [chunk, group] of this.built) {
            if (wanted.has(chunk)) continue
            this.dispose(group)
            this.built.delete(chunk)
        }
    }

    /**
     * Distance from the centerline. A wander starts and ends on the roadside offset,
     * so the next stretch continues the same wire instead of jumping
     */
    private offset(along: number): number {
        const block: number = Math.floor(along / WANDER_BLOCK)
        const random: Random = new Random(Random.hash(this.seed, block, 9))
        const departs: boolean = random.next() < 0.42
        const reach: number = random.range(24, 55)
        const local: number = (along - block * WANDER_BLOCK) / WANDER_BLOCK
        const bell: number = Math.sin(local * Math.PI)
        return LATERAL + (departs ? bell * bell * reach : 0)
    }

    /**
     * Poles of this stretch, plus the first pole of the next one so the wire crosses
     * the boundary. The shared pole itself is drawn only with the next stretch
     */
    private build(chunk: number): Group | null {
        const first: number = chunk * POLES_PER_CHUNK
        const poles: Pole[] = []
        for (let i: number = first; i <= first + POLES_PER_CHUNK; i++) {
            const pole: Pole | null = this.placePole(i * SPAN)
            if (pole) poles.push(pole)
        }
        if (poles.length < 2) return null
        this.aimPoles(poles)

        const poles_writer: GeometryWriter = new GeometryWriter()
        const wires_writer: GeometryWriter = new GeometryWriter()
        for (let i: number = 0; i < poles.length; i++) {
            const owned: boolean = poles[i].along < (first + POLES_PER_CHUNK) * SPAN - 1
            if (owned) this.addPole(poles_writer, poles[i])
            // One skipped pole still keeps the wire; a long hole does not get a wire across the map
            if (i + 1 < poles.length && poles[i + 1].along - poles[i].along <= SPAN * 3) {
                this.addWires(wires_writer, poles[i], poles[i + 1])
            }
        }

        const group: Group = new Group()
        group.name = 'power-line'
        const pole_mesh: Mesh = new Mesh(poles_writer.build(), this.materials.concrete)
        pole_mesh.castShadow = true
        pole_mesh.receiveShadow = true
        group.add(pole_mesh)
        const wire_mesh: Mesh = new Mesh(wires_writer.build(), this.wire_material)
        wire_mesh.castShadow = false
        group.add(wire_mesh)
        return group
    }

    /**
     * Pole base on the ground beside the road. Null where the road is not generated yet,
     * or where the spot stays on a roadway: the wire then spans that one gap.
     */
    private placePole(along: number): Pole | null {
        const sample: RoadSample | null = this.network.sampleAlong(along)
        if (!sample) return null
        const flat_right: Vector3 = new Vector3(sample.right.x, 0, sample.right.z).normalize()
        let x: number = sample.position.x + flat_right.x * this.offset(along) * this.side
        let z: number = sample.position.z + flat_right.z * this.offset(along) * this.side
        // A curve or a crossing can drop the spot onto asphalt. Step straight off that road,
        // not further along the line's own side, which on a crossing walks down the deck
        for (let step: number = 0; step < 6; step++) {
            const hit: RoadProjection | null = this.network.closest(x, z, 40)
            if (!hit || Math.abs(hit.lateral) >= CLEARANCE) break
            const sign: number = Math.abs(hit.lateral) < 1 ? 1 : Math.sign(hit.lateral)
            const push: number = CLEARANCE + 2 - Math.abs(hit.lateral)
            const rx: number = hit.right.x
            const rz: number = hit.right.z
            const scale: number = Math.hypot(rx, rz) || 1
            x += (rx / scale) * sign * push
            z += (rz / scale) * sign * push
        }
        const still: RoadProjection | null = this.network.closest(x, z, 40)
        if (still && Math.abs(still.lateral) < RAIL_OFFSET + 1.5) return null
        const ground: number = this.surface.height(x, z)
        const base: Vector3 = new Vector3(x, ground, z)
        const tangent: Vector3 = new Vector3(sample.tangent.x, 0, sample.tangent.z).normalize()
        return {
            along: along,
            base: base,
            top: base.clone().addScaledVector(this.up, POLE_HEIGHT),
            right: new Vector3().crossVectors(tangent, this.up).normalize(),
            tangent: tangent,
        }
    }

    /** Crossarms square to the wire, so a wandering stretch does not twist the wires apart */
    private aimPoles(poles: Pole[]): void {
        for (let i: number = 0; i < poles.length; i++) {
            const other: Pole = poles[i + 1] ?? poles[i - 1]
            const tangent: Vector3 = new Vector3(other.base.x - poles[i].base.x, 0, other.base.z - poles[i].base.z)
            if (tangent.lengthSq() < 1e-4) continue
            tangent.normalize()
            if (i + 1 >= poles.length) tangent.negate()
            poles[i].tangent.copy(tangent)
            poles[i].right.crossVectors(tangent, this.up).normalize()
        }
    }

    private addPole(writer: GeometryWriter, pole: Pole): void {
        const center: Vector3 = pole.base.clone().addScaledVector(this.up, POLE_HEIGHT * 0.5)
        writer.box(center, pole.right, this.up, 0.22, POLE_HEIGHT * 0.5, 0.22, null, 4)
        const arm: Vector3 = pole.top.clone().addScaledVector(this.up, -0.55)
        writer.box(arm, pole.right, this.up, 1.85, 0.07, 0.09, null, 4)
    }

    /** Three wires on the crossarm, each sagging on its own between the poles */
    private addWires(writer: GeometryWriter, from: Pole, to: Pole): void {
        const offsets: number[] = [-1.15, 0, 1.15]
        const points: Vector3[] = []
        for (let w: number = 0; w < offsets.length; w++) {
            const a: Vector3 = from.top.clone().addScaledVector(from.right, offsets[w]).addScaledVector(this.up, -0.7)
            const b: Vector3 = to.top.clone().addScaledVector(to.right, offsets[w]).addScaledVector(this.up, -0.7)
            points.length = 0
            const steps: number = 6
            for (let s: number = 0; s <= steps; s++) {
                const t: number = s / steps
                const p: Vector3 = new Vector3().lerpVectors(a, b, t)
                p.y -= SAG * 4 * t * (1 - t)
                points.push(p)
            }
            this.addTube(writer, points, 0.045)
        }
    }

    /** Square tube along a polyline, wide enough to read as a wire and cheap enough to repeat */
    private addTube(writer: GeometryWriter, points: Vector3[], radius: number): void {
        const sides: number = 4
        const forward: Vector3 = new Vector3()
        const side: Vector3 = new Vector3()
        const binormal: Vector3 = new Vector3()
        const rings: number[][] = []
        for (let i: number = 0; i < points.length; i++) {
            if (i < points.length - 1) forward.subVectors(points[i + 1], points[i])
            else forward.subVectors(points[i], points[i - 1])
            forward.normalize()
            side.crossVectors(forward, this.up)
            if (side.lengthSq() < 1e-8) side.set(1, 0, 0)
            side.normalize()
            binormal.crossVectors(side, forward).normalize()
            const ring: number[] = []
            for (let s: number = 0; s < sides; s++) {
                const angle: number = (s / sides) * Math.PI * 2
                const normal: Vector3 = side.clone().multiplyScalar(Math.cos(angle)).addScaledVector(binormal, Math.sin(angle))
                const position: Vector3 = points[i].clone().addScaledVector(normal, radius)
                ring.push(writer.vertex(position, normal, s / sides, i * 0.25))
            }
            rings.push(ring)
        }
        for (let i: number = 0; i < rings.length - 1; i++) {
            for (let s: number = 0; s < sides; s++) {
                const next: number = (s + 1) % sides
                writer.triangle(rings[i][s], rings[i][next], rings[i + 1][s])
                writer.triangle(rings[i][next], rings[i + 1][next], rings[i + 1][s])
            }
        }
    }

    private dispose(group: Group): void {
        this.root.remove(group)
        group.traverse((object: Object3D): void => {
            const mesh: Mesh = object as Mesh
            if (mesh.isMesh) (mesh.geometry as BufferGeometry).dispose()
        })
    }
}
