import { BufferGeometry, Color, Group, Mesh, Vector3 } from 'three'
import { GeometryWriter } from '../render/GeometryWriter'
import { WorldMaterials } from '../render/WorldMaterials'
import { RoadNetwork } from './RoadNetwork'
import { RoadProjection, RoadSample, RoadSegment } from './RoadTypes'
import { RAIL_OFFSET, ROAD_HALF_WIDTH, SEGMENT_SAMPLES } from './WorldConfig'
import { BRIDGE_GAP, DECK_HALF_WIDTH, WorldSurface } from './WorldSurface'

const UP: Vector3 = new Vector3(0, 1, 0)
const TEXTURE_METERS: number = 4
const DASH_PERIOD: number = 9
const SKIRT_OUT: number = 0.2
const SKIRT_DOWN: number = 0.55

/**
 * Texture coordinate along the road, local to the segment.
 * The distance along the road reaches tens of kilometers; as a float32 UV that leaves
 * only ~1/1000 of a tile of precision, and the texture visibly snaps and swims ("PS1 look").
 * Subtracting a whole number of periods keeps UVs small and the tiling seamless between segments.
 */
function alongUv(segment: RoadSegment, distance: number, period: number): number {
    const base: number = Math.floor(segment.samples[0].distance / period) * period
    return (distance - base) / period
}

/** W-beam guardrail profile: [outward offset from the road, height] */
const RAIL_PROFILE: number[][] = [[0.02, 0.44], [-0.07, 0.5], [-0.01, 0.6], [-0.07, 0.7], [0.02, 0.77]]

const POST_WHITE: Color = new Color(0x9a9a96)
const POST_BLACK: Color = new Color(0x0d0d0d)
const POST_REFLECTOR: Color = new Color(0xffa020)

/** Concrete texture tile size, m */
const CONCRETE_METERS: number = 4
/** Bridge deck thickness under the road surface, m */
const DECK_DEPTH: number = 1.0
/** A pier stands every this many road samples along a bridge */
const PIER_EVERY: number = 6
const PIER_HALF_THICKNESS: number = 0.5
/** The deck runs this many samples past the span onto the embankment on each side */
const DECK_EXTEND: number = 2
/** Concrete curb along the deck edges, outside the guardrail */
const CURB_WIDTH: number = 0.3
const CURB_HEIGHT: number = 0.25
const ABUTMENT_HALF_THICKNESS: number = 0.4
/** Piers keep this far from the centerline of a road passing underneath, m */
const PIER_ROAD_GAP: number = ROAD_HALF_WIDTH + 3

const PROJECTIONS: RoadProjection[] = []

/**
 * Builds the visual geometry of one track segment:
 * asphalt with embankment slopes, markings, guardrails with posts, delineator posts,
 * and a concrete deck with piers where the road passes over another road
 */
export class RoadMeshBuilder {
    private materials: WorldMaterials
    private network: RoadNetwork
    private surface: WorldSurface

    constructor(surface: WorldSurface, materials: WorldMaterials) {
        this.surface = surface
        this.network = surface.road
        this.materials = materials
    }

    build(segment: RoadSegment): Group {
        const group: Group = new Group()
        group.name = `road-segment-${segment.index}`

        const road: Mesh = new Mesh(this.buildSurface(segment), this.materials.road)
        road.receiveShadow = true
        group.add(road)

        const markings: Mesh = new Mesh(this.buildMarkings(segment), this.materials.markings)
        markings.receiveShadow = true
        group.add(markings)

        if (segment.rail_left || segment.rail_right) {
            const rails: Mesh = new Mesh(this.buildRails(segment), this.materials.rail)
            rails.castShadow = true
            rails.receiveShadow = true
            group.add(rails)
        }

        const posts: GeometryWriter = new GeometryWriter(true)
        this.writeDelineators(segment, posts)
        if (posts.vertex_count > 0) {
            const mesh: Mesh = new Mesh(posts.build(), this.materials.post)
            mesh.castShadow = true
            mesh.receiveShadow = true
            group.add(mesh)
        }

        const concrete: GeometryWriter = new GeometryWriter()
        this.writeBridge(segment, concrete)
        if (concrete.vertex_count > 0) {
            const mesh: Mesh = new Mesh(concrete.build(), this.materials.concrete)
            mesh.castShadow = true
            mesh.receiveShadow = true
            group.add(mesh)
        }
        return group
    }

    /** Roadway and slopes: three strips (left slope, asphalt, right slope) */
    private buildSurface(segment: RoadSegment): BufferGeometry {
        const writer: GeometryWriter = new GeometryWriter()
        const rows: number = segment.samples.length
        const lanes: number[] = [-ROAD_HALF_WIDTH, -ROAD_HALF_WIDTH * 0.5, 0, ROAD_HALF_WIDTH * 0.5, ROAD_HALF_WIDTH]
        const p: Vector3 = new Vector3()
        const n: Vector3 = new Vector3()

        const surface_first: number = writer.vertex_count
        for (let i: number = 0; i < rows; i++) {
            const s: RoadSample = segment.samples[i]
            n.crossVectors(s.right, s.tangent).normalize()
            for (let c: number = 0; c < lanes.length; c++) {
                p.copy(s.position).addScaledVector(s.right, lanes[c])
                writer.vertex(p, n, (lanes[c] + ROAD_HALF_WIDTH) / TEXTURE_METERS, alongUv(segment, s.distance, TEXTURE_METERS))
            }
        }
        writer.strip(surface_first, rows, lanes.length)

        // Slopes go below ground and close the gap between asphalt and terrain
        for (let side: number = -1; side <= 1; side += 2) {
            const first: number = writer.vertex_count
            for (let i: number = 0; i < rows; i++) {
                const s: RoadSample = segment.samples[i]
                n.copy(s.right).multiplyScalar(side).addScaledVector(UP, 0.4).normalize()
                const edge: Vector3 = s.position.clone().addScaledVector(s.right, side * ROAD_HALF_WIDTH)
                const foot: Vector3 = s.position.clone().addScaledVector(s.right, side * (ROAD_HALF_WIDTH + SKIRT_OUT))
                foot.y -= SKIRT_DOWN
                const v: number = alongUv(segment, s.distance, TEXTURE_METERS)
                if (side < 0) {
                    writer.vertex(foot, n, -SKIRT_OUT / TEXTURE_METERS, v)
                    writer.vertex(edge, n, 0, v)
                } else {
                    writer.vertex(edge, n, (ROAD_HALF_WIDTH * 2) / TEXTURE_METERS, v)
                    writer.vertex(foot, n, (ROAD_HALF_WIDTH * 2 + SKIRT_OUT) / TEXTURE_METERS, v)
                }
            }
            writer.strip(first, rows, 2)
        }
        return writer.build()
    }

    /** Dashed center line and two solid edge lines */
    private buildMarkings(segment: RoadSegment): BufferGeometry {
        const writer: GeometryWriter = new GeometryWriter()
        const lines: number[][] = [
            [0, 0.13, 0.75],
            [-(ROAD_HALF_WIDTH - 0.32), 0.15, 0.25],
            [ROAD_HALF_WIDTH - 0.32, 0.15, 0.25],
        ]
        const p: Vector3 = new Vector3()
        const n: Vector3 = new Vector3()
        for (let l: number = 0; l < lines.length; l++) {
            const [offset, width, u] = lines[l]
            const first: number = writer.vertex_count
            for (let i: number = 0; i < segment.samples.length; i++) {
                const s: RoadSample = segment.samples[i]
                n.crossVectors(s.right, s.tangent).normalize()
                for (let c: number = -1; c <= 1; c += 2) {
                    p.copy(s.position).addScaledVector(s.right, offset + c * width * 0.5).addScaledVector(n, 0.012)
                    writer.vertex(p, n, u, alongUv(segment, s.distance, DASH_PERIOD))
                }
            }
            writer.strip(first, segment.samples.length, 2)
        }
        return writer.build()
    }

    /** Guardrail beams that dip into the ground at the ends, with posts every ~4 m */
    private buildRails(segment: RoadSegment): BufferGeometry {
        const writer: GeometryWriter = new GeometryWriter()
        const prev: RoadSegment | undefined = this.network.getSegment(segment.index - 1)
        const next: RoadSegment | undefined = this.network.getSegment(segment.index + 1)
        const rows: number = segment.samples.length

        for (let side: number = -1; side <= 1; side += 2) {
            const has: boolean = side > 0 ? segment.rail_right : segment.rail_left
            if (!has) continue
            const prev_has: boolean = !prev || (side > 0 ? prev.rail_right : prev.rail_left)
            const next_has: boolean = !next || (side > 0 ? next.rail_right : next.rail_left)

            const first: number = writer.vertex_count
            for (let i: number = 0; i < rows; i++) {
                const s: RoadSample = segment.samples[i]
                // End terminal: the beam smoothly dips into the ground if the adjacent segment has no guardrail
                let drop: number = 0
                if (!prev_has && i < 4) drop = Math.max(drop, (1 - i / 4) * 0.75)
                if (!next_has && i > rows - 5) drop = Math.max(drop, (1 - (rows - 1 - i) / 4) * 0.75)
                for (let k: number = 0; k < RAIL_PROFILE.length; k++) {
                    const k0: number = Math.max(0, k - 1)
                    const k1: number = Math.min(RAIL_PROFILE.length - 1, k + 1)
                    const dh: number = RAIL_PROFILE[k1][1] - RAIL_PROFILE[k0][1]
                    const doff: number = RAIL_PROFILE[k1][0] - RAIL_PROFILE[k0][0]
                    // Profile normal faces the road
                    const normal: Vector3 = s.right.clone().multiplyScalar(-side * dh).addScaledVector(UP, doff).normalize()
                    const p: Vector3 = s.position.clone().addScaledVector(s.right, side * (RAIL_OFFSET + RAIL_PROFILE[k][0]))
                    p.y += RAIL_PROFILE[k][1] - drop
                    writer.vertex(p, normal, k / (RAIL_PROFILE.length - 1), alongUv(segment, s.distance, 4))
                }
            }
            writer.strip(first, rows, RAIL_PROFILE.length)

            for (let i: number = 0; i < rows - 1; i += 2) {
                if ((!prev_has && i < 2) || (!next_has && i > rows - 4)) continue
                const s: RoadSample = segment.samples[i]
                const center: Vector3 = s.position.clone().addScaledVector(s.right, side * (RAIL_OFFSET + 0.11))
                center.y += 0.22
                writer.box(center, s.right, UP, 0.05, 0.55, 0.07)
            }
        }
        return writer.build()
    }

    /**
     * Where the ground under the road drops away (another road passes underneath), the road
     * rests on a concrete deck as wide as the shoulders, with curbs along its edges,
     * piers standing clear of the lower road, and abutment walls under the deck ends
     */
    private writeBridge(segment: RoadSegment, writer: GeometryWriter): void {
        const rows: number = segment.samples.length
        // Bridge flags for this segment's rows plus DECK_EXTEND rows of each neighbor,
        // so that a deck crossing a segment boundary is built seamlessly from both sides
        const bridge: boolean[] = []
        let any: boolean = false
        for (let i: number = -DECK_EXTEND * 2; i < rows + DECK_EXTEND * 2; i++) {
            const s: RoadSample | null = this.sampleAt(segment, i)
            const b: boolean = s !== null && s.position.y - this.surface.height(s.position.x, s.position.z) > BRIDGE_GAP
            bridge.push(b)
            any = any || b
        }
        if (!any) return
        const at = (i: number): boolean => bridge[i + DECK_EXTEND * 2]
        // The deck runs DECK_EXTEND samples past the bridge on each side so its ends rest on the embankment
        const deck = (i: number): boolean => {
            for (let k: number = i - DECK_EXTEND; k <= i + DECK_EXTEND; k++) if (at(k)) return true
            return false
        }

        let i: number = 0
        while (i < rows) {
            if (!deck(i)) {
                i++
                continue
            }
            let j: number = i
            while (j + 1 < rows && deck(j + 1)) j++
            if (j > i) {
                // An end at the segment boundary is open only where the neighbor carries the deck on
                const start_open: boolean = !(i === 0 && deck(-1))
                const end_open: boolean = !(j === rows - 1 && deck(rows))
                this.writeDeck(segment, i, j, writer)
                if (start_open) this.writeDeckEnd(segment.samples[i], -1, writer)
                if (end_open) this.writeDeckEnd(segment.samples[j], 1, writer)
            }
            i = j + 1
        }

        for (let k: number = 0; k < rows; k++) {
            const global: number = segment.index * SEGMENT_SAMPLES + k
            if (((global % PIER_EVERY) + PIER_EVERY) % PIER_EVERY !== 0) continue
            if (!at(k) || k === SEGMENT_SAMPLES) continue
            this.writePier(segment.samples[k], writer)
        }
    }

    /** Sample by index that may run into the neighboring segments (they share their boundary samples) */
    private sampleAt(segment: RoadSegment, i: number): RoadSample | null {
        if (i >= 0 && i <= SEGMENT_SAMPLES) return segment.samples[i]
        if (i < 0) {
            const prev: RoadSegment | undefined = this.network.getSegment(segment.index - 1)
            return prev ? prev.samples[SEGMENT_SAMPLES + i] ?? null : null
        }
        const next: RoadSegment | undefined = this.network.getSegment(segment.index + 1)
        return next ? next.samples[i - SEGMENT_SAMPLES] ?? null : null
    }

    /** Deck from row first to row last: shoulder tops, curbs, side fascias and the underside */
    private writeDeck(segment: RoadSegment, first: number, last: number, writer: GeometryWriter): void {
        const rows: number = last - first + 1
        const inner: number = DECK_HALF_WIDTH - CURB_WIDTH
        // Each face is a strip of two columns: [offset, height] at the first and second column.
        // Column order sets the face direction (see GeometryWriter.strip): the normal is the column
        // direction turned from "right" toward "up"
        const faces: number[][] = [
            [-inner, -0.02, -ROAD_HALF_WIDTH, -0.02],
            [ROAD_HALF_WIDTH, -0.02, inner, -0.02],
            [-inner, CURB_HEIGHT, -inner, -0.02],
            [inner, -0.02, inner, CURB_HEIGHT],
            [-DECK_HALF_WIDTH, CURB_HEIGHT, -inner, CURB_HEIGHT],
            [inner, CURB_HEIGHT, DECK_HALF_WIDTH, CURB_HEIGHT],
            [-DECK_HALF_WIDTH, -DECK_DEPTH, -DECK_HALF_WIDTH, CURB_HEIGHT],
            [DECK_HALF_WIDTH, CURB_HEIGHT, DECK_HALF_WIDTH, -DECK_DEPTH],
            [DECK_HALF_WIDTH, -DECK_DEPTH, -DECK_HALF_WIDTH, -DECK_DEPTH],
        ]
        const p: Vector3 = new Vector3()
        const n: Vector3 = new Vector3()
        for (let f: number = 0; f < faces.length; f++) {
            const [o0, h0, o1, h1] = faces[f]
            const length: number = Math.hypot(o1 - o0, h1 - h0)
            // UV across the face in meters: lateral offset on horizontal faces, height on vertical ones
            const vertical: boolean = Math.abs(h1 - h0) > Math.abs(o1 - o0)
            const u0: number = (vertical ? h0 : o0) / CONCRETE_METERS
            const u1: number = u0 + (vertical ? Math.sign(h1 - h0) : Math.sign(o1 - o0)) * length / CONCRETE_METERS
            const start: number = writer.vertex_count
            for (let r: number = first; r <= last; r++) {
                const s: RoadSample = segment.samples[r]
                const v: number = alongUv(segment, s.distance, CONCRETE_METERS)
                n.copy(s.right).multiplyScalar(-(h1 - h0) / length).addScaledVector(UP, (o1 - o0) / length)
                p.copy(s.position).addScaledVector(s.right, o0)
                p.y += h0
                writer.vertex(p, n, u0, v)
                p.copy(s.position).addScaledVector(s.right, o1)
                p.y += h1
                writer.vertex(p, n, u1, v)
            }
            writer.strip(start, rows, 2)
        }
    }

    /**
     * Closes an open end of the deck (direction -1 at the start, +1 at the end): the slab cross-section
     * and curbs, and an abutment wall from the deck down into the ground where the embankment falls away
     */
    private writeDeckEnd(s: RoadSample, direction: number, writer: GeometryWriter): void {
        const forward: Vector3 = s.tangent.clone().multiplyScalar(direction)
        const inner: number = DECK_HALF_WIDTH - CURB_WIDTH
        // Cross-section split into rectangles [offset0, height0, offset1, height1]
        const parts: number[][] = [
            [-DECK_HALF_WIDTH, -DECK_DEPTH, DECK_HALF_WIDTH, -0.02],
            [-ROAD_HALF_WIDTH, -0.02, ROAD_HALF_WIDTH, 0],
            [-DECK_HALF_WIDTH, -0.02, -inner, CURB_HEIGHT],
            [inner, -0.02, DECK_HALF_WIDTH, CURB_HEIGHT],
        ]
        for (let k: number = 0; k < parts.length; k++) {
            const [o0, h0, o1, h1] = parts[k]
            const corners: Vector3[] = [[o0, h0], [o1, h0], [o1, h1], [o0, h1]].map((c: number[]): Vector3 => {
                const p: Vector3 = s.position.clone().addScaledVector(s.right, c[0])
                p.y += c[1]
                return p
            })
            const uvs: number[][] = [[o0, h0], [o1, h0], [o1, h1], [o0, h1]].map((c: number[]): number[] => [c[0] / CONCRETE_METERS, c[1] / CONCRETE_METERS])
            this.writeQuad(corners, uvs, forward, writer)
        }

        // Abutment: lowest ground under the deck end decides how deep the wall goes
        let ground: number = Infinity
        for (let o: number = -1; o <= 1; o += 0.5) {
            const x: number = s.position.x + s.right.x * DECK_HALF_WIDTH * o
            const z: number = s.position.z + s.right.z * DECK_HALF_WIDTH * o
            ground = Math.min(ground, this.surface.height(x, z))
        }
        const top: number = s.position.y - DECK_DEPTH
        const bottom: number = ground - 0.6
        if (top - bottom < 0.7) return
        const flat_forward: Vector3 = new Vector3(forward.x, 0, forward.z).normalize()
        const center: Vector3 = s.position.clone().addScaledVector(flat_forward, -ABUTMENT_HALF_THICKNESS)
        center.y = (top + bottom) * 0.5
        writer.box(center, flat_forward, UP, ABUTMENT_HALF_THICKNESS, (top - bottom) * 0.5, DECK_HALF_WIDTH, null, CONCRETE_METERS)
    }

    /** Two triangles over four corners, wound so the face looks along normal */
    private writeQuad(corners: Vector3[], uvs: number[][], normal: Vector3, writer: GeometryWriter): void {
        const base: number = writer.vertex_count
        for (let k: number = 0; k < 4; k++) writer.vertex(corners[k], normal, uvs[k][0], uvs[k][1])
        const e1: Vector3 = corners[1].clone().sub(corners[0])
        const e2: Vector3 = corners[2].clone().sub(corners[0])
        if (e1.cross(e2).dot(normal) >= 0) {
            writer.triangle(base, base + 1, base + 2)
            writer.triangle(base, base + 2, base + 3)
        } else {
            writer.triangle(base, base + 2, base + 1)
            writer.triangle(base, base + 3, base + 2)
        }
    }

    /** A wall-like pier under the deck, skipped where it would stand on or next to the lower road */
    private writePier(s: RoadSample, writer: GeometryWriter): void {
        const top: number = s.position.y - DECK_DEPTH
        const reach: number = DECK_HALF_WIDTH - 1.2
        const count: number = this.network.projectAll(s.position.x, s.position.z, 30, PROJECTIONS)
        for (let k: number = 0; k < count; k++) {
            const other: RoadProjection = PROJECTIONS[k]
            if (other.height < top - 1 && Math.abs(other.lateral) < PIER_ROAD_GAP + reach + PIER_HALF_THICKNESS) return
        }
        let bottom: number = this.surface.height(s.position.x, s.position.z)
        for (let side: number = -1; side <= 1; side += 2) {
            bottom = Math.min(bottom, this.surface.height(s.position.x + s.right.x * reach * side, s.position.z + s.right.z * reach * side))
        }
        bottom -= 0.5
        if (top - bottom < 1.2) return
        const center: Vector3 = s.position.clone()
        center.y = (top + bottom) * 0.5
        const forward: Vector3 = new Vector3(s.tangent.x, 0, s.tangent.z).normalize()
        writer.box(center, forward, UP, PIER_HALF_THICKNESS, (top - bottom) * 0.5, reach, null, CONCRETE_METERS)
        // Pier cap: a slightly wider beam right under the deck
        const cap: Vector3 = s.position.clone()
        cap.y = top - 0.3
        writer.box(cap, forward, UP, PIER_HALF_THICKNESS + 0.15, 0.3, reach + 0.4, null, CONCRETE_METERS)
    }

    /** White delineator posts with a black band and reflector where there is no guardrail */
    private writeDelineators(segment: RoadSegment, writer: GeometryWriter): void {
        for (let i: number = 0; i < SEGMENT_SAMPLES; i++) {
            const global: number = segment.index * SEGMENT_SAMPLES + i
            if (((global % 13) + 13) % 13 !== 0) continue
            for (let side: number = -1; side <= 1; side += 2) {
                const has_rail: boolean = side > 0 ? segment.rail_right : segment.rail_left
                if (has_rail) continue
                const s: RoadSample = segment.samples[i]
                const base: Vector3 = s.position.clone().addScaledVector(s.right, side * (ROAD_HALF_WIDTH + 1.0))
                const body: Vector3 = base.clone()
                body.y += 0.35
                writer.box(body, s.right, UP, 0.06, 0.65, 0.06, POST_WHITE)
                const band: Vector3 = base.clone()
                band.y += 0.86
                writer.box(band, s.right, UP, 0.062, 0.1, 0.062, POST_BLACK)
                const reflector: Vector3 = base.clone().addScaledVector(s.right, -side * 0.063)
                reflector.y += 0.86
                writer.box(reflector, s.right, UP, 0.004, 0.05, 0.035, POST_REFLECTOR)
            }
        }
    }
}
