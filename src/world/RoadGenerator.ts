import { Vector3 } from 'three'
import { Random } from '../core/Random'
import { MathUtils } from '../core/MathUtils'
import { GridIndex } from '../core/GridIndex'
import { Landscape } from './Landscape'
import { ControlPoint } from './RoadTypes'
import { CONTROL_SPACING } from './WorldConfig'

/** Loop stages: approach straight, long turn of about 270 degrees, exit straight that passes over the approach */
const PHASE_NONE: number = 0
const PHASE_APPROACH: number = 1
const PHASE_TURN: number = 2
const PHASE_EXIT: number = 3

/** Planned course of one growing end: what nextPosition follows and what the look-ahead simulates */
interface Course {
    heading: number
    turn: number
    turn_target: number
    steps_left: number
    loop_phase: number
    loop_sign: number
}

/** State of one growing end of the track */
interface RoadEnd extends Course {
    grade: number
    /** Steps that skip the free-space check (a loop must cross its own approach) */
    unchecked: number
    /** Steps until the next loop may start */
    loop_cooldown: number
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

/** Usual grade limit when following the terrain */
const MAX_GRADE: number = 0.08
/** Grade limit when climbing over another road */
const MAX_CLIMB: number = 0.12
/** Required grade at which the road starts climbing toward a crossing */
const CLIMB_START: number = 0.045
/** Height of the upper road surface above the lower one at a crossing, m (about 6.5 m of free space under the deck) */
const VERTICAL_CLEARANCE: number = 7.5
/**
 * Older control points within this distance count as a road to pass over. It covers both
 * control points around the crossing on the lower road, so the clearance holds between them too, m
 */
const CROSS_RADIUS: number = 60
/**
 * How many control points ahead the elevation profile looks for roads to pass over.
 * Further out the free-space check usually steers the road away; a loop is looked through to its end
 */
const LOOKAHEAD_STEPS: number = 6

/** Chance that a new section starts a loop, once the cooldown has passed */
const LOOP_CHANCE: number = 0.2
/** Minimum steps between loop starts */
const LOOP_COOLDOWN: number = 30
const LOOP_APPROACH_STEPS: number = 4
/** Turn per step inside the loop: radius about CONTROL_SPACING / LOOP_TURN = 78 m */
const LOOP_TURN: number = 0.36
/** Steps of the turn: LOOP_TURN * steps gives about 270 degrees with the smoothing */
const LOOP_TURN_STEPS: number = 13
const LOOP_EXIT_STEPS: number = 6
/** The loop area must be this far from other track sections, m */
const LOOP_CLEARANCE: number = 60

/**
 * Generates new control points for both ends of the endless track.
 * Plans straights, gentle and sharp turns and loops that pass over themselves.
 * Elsewhere the track avoids crossing itself; wherever it does pass over an older
 * section, the newer road climbs at least VERTICAL_CLEARANCE above it.
 * The elevation profile follows the large-scale terrain.
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
            loop_phase: PHASE_NONE,
            loop_sign: 1,
            grade: 0,
            unchecked: 0,
            loop_cooldown: LOOP_COOLDOWN,
            random: new Random(Random.hash(seed, direction + 5, 1337)),
        }
    }

    /** Computes the next control point position for the track end direction (1 is forward, -1 is backward) */
    nextPosition(direction: number, last: ControlPoint): Vector3 {
        const end: RoadEnd = this.ends.get(direction) as RoadEnd
        const index: number = last.index + direction
        if (end.steps_left <= 0) this.planSection(end, last)
        end.steps_left--
        if (end.loop_cooldown > 0) end.loop_cooldown--
        end.turn += (end.turn_target - end.turn) * 0.5

        const desired: number = end.heading + end.turn
        let best_heading: number = desired
        if (end.unchecked > 0) {
            end.unchecked--
        } else {
            // Try headings from the desired one toward increasingly deviated ones and take
            // the first with free space ahead; otherwise the freest one found
            let best_free: number = -Infinity
            for (let c: number = 0; c < HEADING_CANDIDATES.length; c++) {
                const heading: number = desired + HEADING_CANDIDATES[c]
                if (Math.abs(MathUtils.wrapAngle(heading - end.heading)) > MAX_TURN) continue
                // A heading that runs into another road too steeply to climb over it is the worst option
                const excess: number = this.climbExcess(last, heading, direction)
                const free: number = excess > 0 ? -excess : this.probeFreeDistance(last, heading)
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
        }
        end.heading = best_heading

        const x: number = last.position.x + Math.sin(end.heading) * CONTROL_SPACING
        const z: number = last.position.z + Math.cos(end.heading) * CONTROL_SPACING

        // Elevation profile: approach the large-scale terrain height with a slope limit
        const target_y: number = this.landscape.baseHeight(x, z)
        let desired_grade: number = MathUtils.clamp((target_y - last.position.y) / (CONTROL_SPACING * 3), -MAX_GRADE, MAX_GRADE)

        // Roads to pass over ahead: start climbing once the required grade gets noticeable,
        // so the road does not rise on an embankment long before the crossing
        const need: number = this.clearanceGrade(end, last, x, z, direction, LOOKAHEAD_STEPS)
        const climbing: boolean = need > CLIMB_START
        if (climbing && need > desired_grade) desired_grade = Math.min(need * 1.2, MAX_CLIMB)
        end.grade += (desired_grade - end.grade) * 0.4
        // Right at a crossing the road holds the height it needs instead of dipping and jumping back
        const floor: number = climbing ? need : this.clearanceGrade(end, last, x, z, direction, 2)
        if (floor > end.grade) end.grade = Math.min(floor, MAX_CLIMB)
        let y: number = last.position.y + end.grade * CONTROL_SPACING

        // Hard guarantee for a crossing the look-ahead could not foresee
        const required: number = this.requiredHeight(x, z, index)
        if (y < required) {
            y = required
            end.grade = Math.min((y - last.position.y) / CONTROL_SPACING, MAX_CLIMB)
        }

        return new Vector3(x, y, z)
    }

    /** Picks the next section: straight, gentle turn, sharp turn or a loop */
    private planSection(end: RoadEnd, last: ControlPoint): void {
        if (RoadGenerator.advanceLoop(end)) return

        if (end.loop_cooldown <= 0 && end.random.chance(LOOP_CHANCE)) {
            const sign: number = end.random.sign()
            if (this.loopFits(end, last, sign)) {
                end.loop_phase = PHASE_APPROACH
                end.loop_sign = sign
                end.turn_target = 0
                end.steps_left = LOOP_APPROACH_STEPS
                end.loop_cooldown = LOOP_COOLDOWN
                // The area was checked as a whole, and the exit has to cross the approach
                end.unchecked = LOOP_APPROACH_STEPS + LOOP_TURN_STEPS + LOOP_EXIT_STEPS
                return
            }
        }

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

    /** Moves a course to the next loop stage; false when no loop is in progress */
    private static advanceLoop(course: Course): boolean {
        if (course.loop_phase === PHASE_APPROACH) {
            course.loop_phase = PHASE_TURN
            course.turn_target = course.loop_sign * LOOP_TURN
            course.steps_left = LOOP_TURN_STEPS
            return true
        }
        if (course.loop_phase === PHASE_TURN) {
            course.loop_phase = PHASE_EXIT
            course.turn_target = 0
            course.steps_left = LOOP_EXIT_STEPS
            return true
        }
        course.loop_phase = PHASE_NONE
        return false
    }

    /**
     * Steps a copy of the course forward from (x, z) as nextPosition would, without the free-space check.
     * Past the planned sections the road is assumed to go straight.
     */
    private static simulate(source: Course, x: number, z: number, steps: number, visit: (k: number, px: number, pz: number) => void): void {
        const course: Course = { ...source }
        let px: number = x
        let pz: number = z
        for (let k: number = 1; k <= steps; k++) {
            if (course.steps_left <= 0 && !RoadGenerator.advanceLoop(course)) {
                course.turn_target = 0
                course.steps_left = Infinity
            }
            course.steps_left--
            course.turn += (course.turn_target - course.turn) * 0.5
            course.heading += course.turn
            px += Math.sin(course.heading) * CONTROL_SPACING
            pz += Math.cos(course.heading) * CONTROL_SPACING
            visit(k, px, pz)
        }
    }

    /** Whether a loop starting after the last point stays clear of other track sections */
    private loopFits(end: RoadEnd, last: ControlPoint, sign: number): boolean {
        const course: Course = {
            heading: end.heading,
            turn: end.turn,
            turn_target: 0,
            steps_left: LOOP_APPROACH_STEPS,
            loop_phase: PHASE_APPROACH,
            loop_sign: sign,
        }
        const clearance_sq: number = LOOP_CLEARANCE * LOOP_CLEARANCE
        let fits: boolean = true
        const total: number = LOOP_APPROACH_STEPS + LOOP_TURN_STEPS + LOOP_EXIT_STEPS
        RoadGenerator.simulate(course, last.position.x, last.position.z, total, (_k: number, px: number, pz: number): void => {
            if (!fits) return
            this.cp_index.query(px, pz, LOOP_CLEARANCE, (cp: ControlPoint): boolean => {
                if (Math.abs(cp.index - last.index) <= OWN_EXCLUDE) return true
                const dx: number = cp.position.x - px
                const dz: number = cp.position.z - pz
                if (dx * dx + dz * dz < clearance_sq) {
                    fits = false
                    return false
                }
                return true
            })
        })
        return fits
    }

    /**
     * Lowest grade from the last point that keeps VERTICAL_CLEARANCE over every older section
     * on the next lookahead steps of the course (the whole loop while in one), starting with
     * the new point at (x, z); -Infinity if nothing is crossed
     */
    private clearanceGrade(end: RoadEnd, last: ControlPoint, x: number, z: number, direction: number, lookahead: number): number {
        const index: number = last.index + direction
        let need: number = (this.requiredHeight(x, z, index) - last.position.y) / CONTROL_SPACING
        const steps: number = lookahead === LOOKAHEAD_STEPS ? Math.max(lookahead, end.unchecked + 2) : lookahead
        RoadGenerator.simulate(end, x, z, steps, (k: number, px: number, pz: number): void => {
            const required: number = this.requiredHeight(px, pz, index + k * direction)
            if (required === -Infinity) return
            need = Math.max(need, (required - last.position.y) / ((k + 1) * CONTROL_SPACING))
        })
        return need
    }

    /** By how much the road straight along the heading would fall short of clearing older sections at MAX_CLIMB, m; 0 if it can */
    private climbExcess(last: ControlPoint, heading: number, direction: number): number {
        const sx: number = Math.sin(heading) * CONTROL_SPACING
        const sz: number = Math.cos(heading) * CONTROL_SPACING
        let excess: number = 0
        for (let k: number = 1; k <= LOOKAHEAD_STEPS; k++) {
            const required: number = this.requiredHeight(last.position.x + sx * k, last.position.z + sz * k, last.index + k * direction)
            excess = Math.max(excess, required - last.position.y - MAX_CLIMB * CONTROL_SPACING * k)
        }
        return excess
    }

    /** Minimum road height at (x, z) to pass over older sections, or -Infinity if there are none nearby */
    private requiredHeight(x: number, z: number, index: number): number {
        const radius_sq: number = CROSS_RADIUS * CROSS_RADIUS
        let required: number = -Infinity
        this.cp_index.query(x, z, CROSS_RADIUS, (cp: ControlPoint): void => {
            if (Math.abs(cp.index - index) <= OWN_EXCLUDE) return
            const dx: number = cp.position.x - x
            const dz: number = cp.position.z - z
            if (dx * dx + dz * dz < radius_sq) required = Math.max(required, cp.position.y + VERTICAL_CLEARANCE)
        })
        return required
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
