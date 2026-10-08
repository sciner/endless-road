import { Vector3 } from 'three'
import { GridIndex } from '../core/GridIndex'
import { Random } from '../core/Random'
import { Landscape } from './Landscape'
import { RoadGenerator } from './RoadGenerator'
import { ControlPoint, RoadProjection, RoadSample, RoadSegment, SampleRef } from './RoadTypes'
import { CONTROL_SPACING, RAIL_OFFSET, SEGMENT_SAMPLES } from './WorldConfig'

const UP: Vector3 = new Vector3(0, 1, 0)

/** At most this many road branches are considered at one point (overpasses) */
const MAX_BRANCHES: number = 3
/** How strongly a height difference counts against lateral distance when choosing the road level */
const LEVEL_WEIGHT: number = 3
/** Height below the road at which another branch counts as passing underneath, m */
const UNDERPASS_DEPTH: number = 3

interface Candidate {
    ref: SampleRef
    d2: number
}

/** Reused candidate records: projectAll runs for every terrain and vegetation sample */
const CANDIDATES: Candidate[] = []
let candidate_count: number = 0
const BRANCH_ALONG: number[] = []
const PROJECTIONS: RoadProjection[] = []

type SegmentListener = (segment: RoadSegment) => void

/**
 * Endless track: stores control points and interpolated segments,
 * extends both ends as the player moves and answers spatial queries.
 * All data is kept, so the road stays the same when driving back.
 */
export class RoadNetwork {
    readonly landscape: Landscape
    private seed: number
    private control_points: Map<number, ControlPoint> = new Map()
    private segments: Map<number, RoadSegment> = new Map()
    private segment_list: RoadSegment[] = []
    private min_index: number = 0
    private max_index: number = 0
    private cp_index: GridIndex<ControlPoint> = new GridIndex(32)
    private sample_index: GridIndex<SampleRef> = new GridIndex(32)
    private generator: RoadGenerator
    private listeners: SegmentListener[] = []

    constructor(seed: number, landscape: Landscape) {
        this.seed = seed
        this.landscape = landscape
        this.generator = new RoadGenerator(seed, landscape, this.cp_index)

        // Straight starting section along +Z
        const start_y: number = landscape.baseHeight(0, 0)
        for (let i: number = -2; i <= 2; i++) {
            this.addControlPoint(i, new Vector3(0, start_y, i * CONTROL_SPACING))
        }
        this.min_index = -2
        this.max_index = 2
        this.buildSegment(0)
        this.buildSegment(-1)
    }

    onSegmentAdded(listener: SegmentListener): void {
        this.listeners.push(listener)
    }

    getSegment(index: number): RoadSegment | undefined {
        return this.segments.get(index)
    }

    getSegments(): readonly RoadSegment[] {
        return this.segment_list
    }

    get segment_count(): number {
        return this.segment_list.length
    }

    /** Distance along the track to the front end of the built road */
    get front_distance(): number {
        const segment: RoadSegment = this.segments.get(this.max_index - 2) as RoadSegment
        return segment.start_distance + segment.length
    }

    /** Distance along the track to the back end of the built road */
    get back_distance(): number {
        return (this.segments.get(this.min_index + 1) as RoadSegment).start_distance
    }

    /**
     * Extends the track so there are at least ahead meters of road around the point along
     * in both directions. At most max_steps points are added per call to avoid freezes.
     */
    ensureAround(along: number, ahead: number, max_steps: number): boolean {
        let steps: number = 0
        while (steps < max_steps && this.front_distance - along < ahead) {
            this.extend(1)
            steps++
        }
        while (steps < max_steps && along - this.back_distance < ahead) {
            this.extend(-1)
            steps++
        }
        return steps > 0
    }

    private extend(direction: number): void {
        const last_index: number = direction > 0 ? this.max_index : this.min_index
        const last: ControlPoint = this.control_points.get(last_index) as ControlPoint
        const position: Vector3 = this.generator.nextPosition(direction, last)
        const index: number = last_index + direction
        this.addControlPoint(index, position)
        if (direction > 0) {
            this.max_index = index
            this.buildSegment(index - 2)
        } else {
            this.min_index = index
            this.buildSegment(index + 1)
        }
    }

    private addControlPoint(index: number, position: Vector3): void {
        const cp: ControlPoint = { index: index, position: position }
        this.control_points.set(index, cp)
        this.cp_index.insert(position.x, position.z, cp)
    }

    /** Builds the segment between control points k and k+1 using a Catmull-Rom spline */
    private buildSegment(k: number): void {
        const p0: Vector3 = (this.control_points.get(k - 1) as ControlPoint).position
        const p1: Vector3 = (this.control_points.get(k) as ControlPoint).position
        const p2: Vector3 = (this.control_points.get(k + 1) as ControlPoint).position
        const p3: Vector3 = (this.control_points.get(k + 2) as ControlPoint).position

        const samples: RoadSample[] = []
        let length: number = 0
        for (let i: number = 0; i <= SEGMENT_SAMPLES; i++) {
            const t: number = i / SEGMENT_SAMPLES
            const position: Vector3 = RoadNetwork.catmullRom(p0, p1, p2, p3, t, new Vector3())
            const tangent: Vector3 = RoadNetwork.catmullRomDerivative(p0, p1, p2, p3, t, new Vector3()).normalize()
            const flat: Vector3 = new Vector3(tangent.x, 0, tangent.z).normalize()
            const right: Vector3 = new Vector3().crossVectors(flat, UP).normalize()
            if (i > 0) length += position.distanceTo(samples[i - 1].position)
            samples.push({ position: position, tangent: tangent, right: right, distance: length })
        }

        // Distance along the track is measured from the adjacent, already built segment
        const prev: RoadSegment | undefined = this.segments.get(k - 1)
        const next: RoadSegment | undefined = this.segments.get(k + 1)
        let start_distance: number = 0
        if (prev) start_distance = prev.start_distance + prev.length
        else if (next) start_distance = next.start_distance - length
        for (let i: number = 0; i < samples.length; i++) samples[i].distance += start_distance

        let min_x: number = Infinity
        let max_x: number = -Infinity
        let min_z: number = Infinity
        let max_z: number = -Infinity
        for (let i: number = 0; i < samples.length; i++) {
            const p: Vector3 = samples[i].position
            min_x = Math.min(min_x, p.x)
            max_x = Math.max(max_x, p.x)
            min_z = Math.min(min_z, p.z)
            max_z = Math.max(max_z, p.z)
        }

        const segment: RoadSegment = {
            index: k,
            samples: samples,
            start_distance: start_distance,
            length: length,
            rail_left: false,
            rail_right: false,
            min_x: min_x,
            max_x: max_x,
            min_z: min_z,
            max_z: max_z,
        }
        this.decideRails(segment)

        this.segments.set(k, segment)
        this.segment_list.push(segment)
        for (let i: number = 0; i < SEGMENT_SAMPLES; i++) {
            const p: Vector3 = samples[i].position
            this.sample_index.insert(p.x, p.z, { segment: segment, sample: i, x: p.x, z: p.z, distance: samples[i].distance })
        }
        for (let i: number = 0; i < this.listeners.length; i++) this.listeners[i](segment)
    }

    /**
     * Guardrails are placed on the outer side of noticeable turns, above drop-offs
     * (road noticeably above the natural terrain) and occasionally on straights
     */
    private decideRails(segment: RoadSegment): void {
        const first: RoadSample = segment.samples[0]
        const last: RoadSample = segment.samples[SEGMENT_SAMPLES]
        const turn: number = first.tangent.z * last.tangent.x - first.tangent.x * last.tangent.z

        let drop_left: boolean = false
        let drop_right: boolean = false
        for (let i: number = 0; i <= SEGMENT_SAMPLES; i += 3) {
            const s: RoadSample = segment.samples[i]
            const reach: number = RAIL_OFFSET + 7
            const left_h: number = this.landscape.naturalHeight(s.position.x - s.right.x * reach, s.position.z - s.right.z * reach)
            const right_h: number = this.landscape.naturalHeight(s.position.x + s.right.x * reach, s.position.z + s.right.z * reach)
            if (s.position.y - left_h > 2.2) drop_left = true
            if (s.position.y - right_h > 2.2) drop_right = true
        }

        // A section passing over another road is a bridge: guardrails on both sides
        let bridge: boolean = false
        for (let i: number = 0; i <= SEGMENT_SAMPLES && !bridge; i += 2) {
            const s: RoadSample = segment.samples[i]
            const count: number = this.projectAll(s.position.x, s.position.z, 40, PROJECTIONS)
            for (let k: number = 0; k < count; k++) {
                if (PROJECTIONS[k].height < s.position.y - UNDERPASS_DEPTH) bridge = true
            }
        }

        const random: Random = new Random(Random.hash(this.seed, segment.index, 77))
        const both: boolean = random.chance(0.14) || bridge
        segment.rail_right = turn > 0.1 || drop_right || both
        segment.rail_left = turn < -0.1 || drop_left || both
    }

    /**
     * Projects a point onto the centerline of the nearest road section within radius.
     * Where the track passes over itself, y_ref picks the level: the road closest
     * to that height wins, so a car under an overpass stays on the lower road.
     */
    project(x: number, z: number, radius: number, y_ref: number | null = null): RoadProjection | null {
        const count: number = this.projectAll(x, z, radius, PROJECTIONS)
        let best: RoadProjection | null = null
        let best_score: number = Infinity
        for (let i: number = 0; i < count; i++) {
            const p: RoadProjection = PROJECTIONS[i]
            const dy: number = y_ref === null ? 0 : (p.height - y_ref) * LEVEL_WEIGHT
            const score: number = p.lateral * p.lateral + dy * dy
            if (score < best_score) {
                best_score = score
                best = p
            }
        }
        return best
    }

    /**
     * Projects a point onto every distinct road branch within radius: normally one,
     * two or more near overpasses. Samples closer than twice the radius along the track
     * belong to the same branch. Returns the count written into out.
     */
    projectAll(x: number, z: number, radius: number, out: RoadProjection[]): number {
        candidate_count = 0
        const radius_sq: number = radius * radius
        this.sample_index.query(x, z, radius, (candidate: SampleRef): void => {
            const dx: number = candidate.x - x
            const dz: number = candidate.z - z
            const d2: number = dx * dx + dz * dz
            if (d2 >= radius_sq) return
            if (candidate_count === CANDIDATES.length) CANDIDATES.push({ ref: candidate, d2: d2 })
            const c: Candidate = CANDIDATES[candidate_count++]
            c.ref = candidate
            c.d2 = d2
        })

        const gap: number = radius * 2 + 10
        let count: number = 0
        while (count < MAX_BRANCHES) {
            let best: Candidate | null = null
            for (let i: number = 0; i < candidate_count; i++) {
                const c: Candidate = CANDIDATES[i]
                if (best && c.d2 >= best.d2) continue
                const along: number = c.ref.distance
                let taken: boolean = false
                for (let k: number = 0; k < count; k++) {
                    if (Math.abs(along - BRANCH_ALONG[k]) < gap) {
                        taken = true
                        break
                    }
                }
                if (!taken) best = c
            }
            if (!best) break
            BRANCH_ALONG[count] = best.ref.distance
            out[count] = this.refine(best.ref, x, z)
            count++
        }
        return count
    }

    /** Refines the projection onto the two polyline segments adjacent to the nearest sample */
    private refine(ref: SampleRef, x: number, z: number): RoadProjection {
        const current: RoadSample = ref.segment.samples[ref.sample]
        const after: RoadSample = ref.segment.samples[ref.sample + 1]
        let before: RoadSample | null = null
        let before_segment: RoadSegment = ref.segment
        if (ref.sample > 0) {
            before = ref.segment.samples[ref.sample - 1]
        } else {
            const prev: RoadSegment | undefined = this.segments.get(ref.segment.index - 1)
            if (prev) {
                before = prev.samples[SEGMENT_SAMPLES - 1]
                before_segment = prev
            }
        }

        let a: RoadSample = current
        let b: RoadSample = after
        let segment: RoadSegment = ref.segment
        let t: number = RoadNetwork.projectOnInterval(x, z, current, after)
        let d2: number = RoadNetwork.distanceSqOnInterval(x, z, current, after, t)
        if (before) {
            const t2: number = RoadNetwork.projectOnInterval(x, z, before, current)
            const d2b: number = RoadNetwork.distanceSqOnInterval(x, z, before, current, t2)
            if (d2b < d2) {
                a = before
                b = current
                t = t2
                d2 = d2b
                segment = before_segment
            }
        }

        const px: number = a.position.x + (b.position.x - a.position.x) * t
        const pz: number = a.position.z + (b.position.z - a.position.z) * t
        const right: Vector3 = new Vector3().lerpVectors(a.right, b.right, t).normalize()
        return {
            segment: segment,
            lateral: (x - px) * right.x + (z - pz) * right.z,
            height: a.position.y + (b.position.y - a.position.y) * t,
            along: a.distance + (b.distance - a.distance) * t,
            tangent: new Vector3().lerpVectors(a.tangent, b.tangent, t).normalize(),
            right: right,
        }
    }

    /** Whether any road sections are within the radius of the point (fast coarse check) */
    hasRoadNear(x: number, z: number, radius: number): boolean {
        return this.sample_index.hasAny(x, z, radius)
    }

    private static projectOnInterval(x: number, z: number, a: RoadSample, b: RoadSample): number {
        const abx: number = b.position.x - a.position.x
        const abz: number = b.position.z - a.position.z
        const len2: number = abx * abx + abz * abz
        if (len2 < 1e-8) return 0
        const t: number = ((x - a.position.x) * abx + (z - a.position.z) * abz) / len2
        return t < 0 ? 0 : t > 1 ? 1 : t
    }

    private static distanceSqOnInterval(x: number, z: number, a: RoadSample, b: RoadSample, t: number): number {
        const px: number = a.position.x + (b.position.x - a.position.x) * t - x
        const pz: number = a.position.z + (b.position.z - a.position.z) * t - z
        return px * px + pz * pz
    }

    private static catmullRom(p0: Vector3, p1: Vector3, p2: Vector3, p3: Vector3, t: number, out: Vector3): Vector3 {
        const t2: number = t * t
        const t3: number = t2 * t
        const f: (a: number, b: number, c: number, d: number) => number = (a: number, b: number, c: number, d: number): number =>
            0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3)
        return out.set(f(p0.x, p1.x, p2.x, p3.x), f(p0.y, p1.y, p2.y, p3.y), f(p0.z, p1.z, p2.z, p3.z))
    }

    private static catmullRomDerivative(p0: Vector3, p1: Vector3, p2: Vector3, p3: Vector3, t: number, out: Vector3): Vector3 {
        const t2: number = t * t
        const f: (a: number, b: number, c: number, d: number) => number = (a: number, b: number, c: number, d: number): number =>
            0.5 * ((-a + c) + 2 * (2 * a - 5 * b + 4 * c - d) * t + 3 * (-a + 3 * b - 3 * c + d) * t2)
        return out.set(f(p0.x, p1.x, p2.x, p3.x), f(p0.y, p1.y, p2.y, p3.y), f(p0.z, p1.z, p2.z, p3.z))
    }
}
