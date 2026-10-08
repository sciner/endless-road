import { MathUtils } from '../core/MathUtils'
import { Landscape } from './Landscape'
import { RoadNetwork } from './RoadNetwork'
import { RoadProjection } from './RoadTypes'
import { ROAD_FLAT_MARGIN, ROAD_HALF_WIDTH, ROAD_INFLUENCE_RADIUS } from './WorldConfig'

/** Ground surface information at a point */
export interface TerrainPoint {
    height: number
    /** 1 at the very asphalt edge, 0 far from the road */
    road_mask: number
    /** Lateral distance to the road centerline, or Infinity */
    road_distance: number
}

/** Information for car physics */
export interface DrivePoint {
    height: number
    on_road: boolean
    projection: RoadProjection | null
}

/** Half-width of the solid deck on a bridge: asphalt plus the shoulder up to the guardrail, m */
export const DECK_HALF_WIDTH: number = ROAD_HALF_WIDTH + ROAD_FLAT_MARGIN
/** The road counts as a bridge where the ground under it is lower than this, m */
export const BRIDGE_GAP: number = 0.6

const PROJECTIONS: RoadProjection[] = []

/**
 * Final world surface: natural terrain "pulled" toward the road.
 * Near the road the ground is leveled to the road height, then smoothly transitions
 * into an embankment or cut; the transition width depends on the height difference.
 * Where the track passes over itself, roads are applied from the highest to the lowest,
 * so the lower road cuts its corridor through the upper embankment and the upper road
 * spans it as a bridge.
 */
export class WorldSurface {
    readonly road: RoadNetwork
    readonly landscape: Landscape
    private point: TerrainPoint = { height: 0, road_mask: 0, road_distance: Infinity }

    constructor(road: RoadNetwork) {
        this.road = road
        this.landscape = road.landscape
    }

    /** Height and shoulder mask; returns a reused object */
    sample(x: number, z: number): TerrainPoint {
        const natural: number = this.landscape.naturalHeight(x, z)
        const count: number = this.road.projectAll(x, z, ROAD_INFLUENCE_RADIUS, PROJECTIONS)
        const out: TerrainPoint = this.point
        out.height = this.ground(natural, count)
        out.road_distance = Infinity
        out.road_mask = 0
        for (let i: number = 0; i < count; i++) {
            const projection: RoadProjection = PROJECTIONS[i]
            const distance: number = Math.abs(projection.lateral)
            out.road_distance = Math.min(out.road_distance, distance)
            // The shoulder is painted only under roads that lie on the ground, not under bridges
            if (projection.height - out.height > 1) continue
            const mask: number = 1 - MathUtils.smoothstep(ROAD_HALF_WIDTH + 0.5, ROAD_HALF_WIDTH + ROAD_FLAT_MARGIN + 2.5, distance)
            out.road_mask = Math.max(out.road_mask, mask)
        }
        return out
    }

    height(x: number, z: number): number {
        return this.sample(x, z).height
    }

    /**
     * Height the car drives on: on asphalt, the exact roadway height.
     * y_ref is the current height of whoever asks (car, camera): at an overpass it picks the level.
     */
    drive(x: number, z: number, y_ref: number | null = null): DrivePoint {
        const natural: number = this.landscape.naturalHeight(x, z)
        const count: number = this.road.projectAll(x, z, ROAD_INFLUENCE_RADIUS, PROJECTIONS)
        if (count === 0) return { height: natural, on_road: false, projection: null }

        let projection: RoadProjection = PROJECTIONS[0]
        let best_score: number = Infinity
        for (let i: number = 0; i < count; i++) {
            const p: RoadProjection = PROJECTIONS[i]
            const dy: number = y_ref === null ? 0 : (p.height - y_ref) * 3
            const score: number = p.lateral * p.lateral + dy * dy
            if (score < best_score) {
                best_score = score
                projection = p
            }
        }

        const distance: number = Math.abs(projection.lateral)
        if (distance < ROAD_HALF_WIDTH + 0.25) {
            return { height: projection.height, on_road: true, projection: projection }
        }
        const ground: number = this.ground(natural, count)
        // On a bridge the deck continues to the guardrail
        if (distance < DECK_HALF_WIDTH && ground < projection.height - BRIDGE_GAP) {
            return { height: projection.height - 0.04, on_road: false, projection: projection }
        }
        return { height: ground, on_road: false, projection: projection }
    }

    /** Terrain height with the first count entries of PROJECTIONS applied from the highest road to the lowest */
    private ground(natural: number, count: number): number {
        if (count > 1) {
            PROJECTIONS.length = count
            PROJECTIONS.sort((a: RoadProjection, b: RoadProjection): number => b.height - a.height)
        }
        let height: number = natural
        for (let i: number = 0; i < count; i++) height = this.blend(height, PROJECTIONS[i])
        return height
    }

    private blend(natural: number, projection: RoadProjection): number {
        const distance: number = Math.abs(projection.lateral)
        const flat: number = ROAD_HALF_WIDTH + ROAD_FLAT_MARGIN
        const difference: number = Math.abs(natural - projection.height)
        const width: number = MathUtils.clamp(6 + difference * 1.7, 8, ROAD_INFLUENCE_RADIUS - flat - 2)
        const t: number = MathUtils.smoothstep(flat, flat + width, distance)

        // Under the asphalt the ground is lowered so it does not poke through; near the edge it is almost flush
        const under: number = MathUtils.lerp(-0.3, -0.04, MathUtils.smoothstep(ROAD_HALF_WIDTH - 1, ROAD_HALF_WIDTH + 0.4, distance))
        // Shallow ditch right past the flat shoulder
        const ditch_t: number = MathUtils.clamp((distance - flat + 0.5) / 3.5, 0, 1)
        const ditch: number = -0.45 * Math.sin(Math.PI * ditch_t) * (1 - t)
        return MathUtils.lerp(projection.height + under, natural, t) + ditch
    }
}
