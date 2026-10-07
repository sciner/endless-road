import { Vector3 } from 'three'
import { Random } from '../core/Random'
import { MathUtils } from '../core/MathUtils'
import { GridIndex } from '../core/GridIndex'
import { Landscape } from './Landscape'
import { ControlPoint } from './RoadTypes'
import { CONTROL_SPACING } from './WorldConfig'

/** State of one growing end of the track */
interface RoadEnd {
    heading: number
    turn: number
    turn_target: number
    steps_left: number
    grade: number
    random: Random
}

/** Minimum distance between non-adjacent track sections, m */
const CLEARANCE: number = 85
/** How many of the latest control points of the same end are ignored in intersection checks */
const OWN_EXCLUDE: number = 9
/** Free-space probing distance, m */
const PROBE_DISTANCE: number = 460
const PROBE_STEP: number = 40
/** Maximum heading change per control point step, rad */
const MAX_TURN: number = 0.62
const HEADING_CANDIDATES: number[] = [0, 0.12, -0.12, 0.24, -0.24, 0.36, -0.36, 0.5, -0.5, 0.62, -0.62]

/**
 * Generates new control points for both ends of the endless track.
 * Plans straights, gentle and sharp turns, makes sure the track
 * does not cross itself, and fits the elevation profile to the large-scale terrain.
 */
export class RoadGenerator {
    private landscape: Landscape
    private cp_index: GridIndex<ControlPoint>
    private ends: Map<number, RoadEnd> = new Map()

    constructor(seed: number, landscape: Landscape, cp_index: GridIndex<ControlPoint>) {
        this.landscape = landscape
        this.cp_index = cp_index
        this.ends.set(1, this.createEnd(seed, 1, 0))
        this.ends.set(-1, this.createEnd(seed, -1, Math.PI))
    }

    private createEnd(seed: number, direction: number, heading: number): RoadEnd {
        return {
            heading: heading,
            turn: 0,
            turn_target: 0,
            steps_left: 3,
            grade: 0,
            random: new Random(Random.hash(seed, direction + 5, 1337)),
        }
    }

    /** Computes the next control point position for the track end direction (1 is forward, -1 is backward) */
    nextPosition(direction: number, last: ControlPoint): Vector3 {
        const end: RoadEnd = this.ends.get(direction) as RoadEnd
        if (end.steps_left <= 0) this.planSection(end)
        end.steps_left--
        end.turn += (end.turn_target - end.turn) * 0.5

        // Try headings from the desired one toward increasingly deviated ones and take
        // the first with free space ahead; otherwise the freest one found
        const desired: number = end.heading + end.turn
        let best_heading: number = desired
        let best_free: number = -1
        for (let c: number = 0; c < HEADING_CANDIDATES.length; c++) {
            const heading: number = desired + HEADING_CANDIDATES[c]
            if (Math.abs(MathUtils.wrapAngle(heading - end.heading)) > MAX_TURN) continue
            const free: number = this.probeFreeDistance(last, heading)
            if (free > best_free) {
                best_free = free
                best_heading = heading
            }
            if (free >= PROBE_DISTANCE) break
        }

        // If we had to deviate from the plan, re-plan so the next step is smooth
        if (best_heading !== desired) {
            end.turn = MathUtils.clamp(best_heading - end.heading, -MAX_TURN, MAX_TURN)
            end.turn_target = end.turn * 0.6
            end.steps_left = Math.min(end.steps_left, 2)
        }
        end.heading = best_heading

        const x: number = last.position.x + Math.sin(end.heading) * CONTROL_SPACING
        const z: number = last.position.z + Math.cos(end.heading) * CONTROL_SPACING

        // Elevation profile: approach the large-scale terrain height with a slope limit
        const target_y: number = this.landscape.baseHeight(x, z)
        const desired_grade: number = MathUtils.clamp((target_y - last.position.y) / (CONTROL_SPACING * 3), -0.08, 0.08)
        end.grade += (desired_grade - end.grade) * 0.4
        const y: number = last.position.y + end.grade * CONTROL_SPACING

        return new Vector3(x, y, z)
    }

    /** Picks the next section: straight, gentle turn or sharp turn */
    private planSection(end: RoadEnd): void {
        const roll: number = end.random.next()
        if (roll < 0.3) {
            end.turn_target = end.random.range(-0.03, 0.03)
            end.steps_left = end.random.int(3, 9)
        } else if (roll < 0.8) {
            end.turn_target = end.random.sign() * end.random.range(0.07, 0.24)
            end.steps_left = end.random.int(2, 6)
        } else {
            end.turn_target = end.random.sign() * end.random.range(0.26, 0.42)
            end.steps_left = end.random.int(2, 4)
        }
    }

    /** How far along a ray with the given heading there are no other track sections */
    private probeFreeDistance(origin: ControlPoint, heading: number): number {
        const sx: number = Math.sin(heading)
        const sz: number = Math.cos(heading)
        const clearance_sq: number = CLEARANCE * CLEARANCE
        for (let d: number = PROBE_STEP; d <= PROBE_DISTANCE; d += PROBE_STEP) {
            const px: number = origin.position.x + sx * d
            const pz: number = origin.position.z + sz * d
            let blocked: boolean = false
            this.cp_index.query(px, pz, CLEARANCE, (cp: ControlPoint): boolean => {
                if (Math.abs(cp.index - origin.index) <= OWN_EXCLUDE) return true
                const dx: number = cp.position.x - px
                const dz: number = cp.position.z - pz
                if (dx * dx + dz * dz < clearance_sq) {
                    blocked = true
                    return false
                }
                return true
            })
            if (blocked) return d - PROBE_STEP
        }
        return PROBE_DISTANCE
    }
}
