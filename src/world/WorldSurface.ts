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

/**
 * Final world surface: natural terrain "pulled" toward the road.
 * Near the road the ground is leveled to the road height, then smoothly transitions
 * into an embankment or cut; the transition width depends on the height difference.
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
        const projection: RoadProjection | null = this.road.project(x, z, ROAD_INFLUENCE_RADIUS)
        const out: TerrainPoint = this.point
        if (!projection) {
            out.height = natural
            out.road_mask = 0
            out.road_distance = Infinity
            return out
        }
        out.height = this.blend(natural, projection)
        out.road_distance = Math.abs(projection.lateral)
        out.road_mask = 1 - MathUtils.smoothstep(ROAD_HALF_WIDTH + 0.5, ROAD_HALF_WIDTH + ROAD_FLAT_MARGIN + 2.5, out.road_distance)
        return out
    }

    height(x: number, z: number): number {
        return this.sample(x, z).height
    }

    /** Height the car drives on: on asphalt, the exact roadway height */
    drive(x: number, z: number): DrivePoint {
        const projection: RoadProjection | null = this.road.project(x, z, ROAD_INFLUENCE_RADIUS)
        const natural: number = this.landscape.naturalHeight(x, z)
        if (!projection) return { height: natural, on_road: false, projection: null }
        const distance: number = Math.abs(projection.lateral)
        if (distance < ROAD_HALF_WIDTH + 0.25) {
            return { height: projection.height, on_road: true, projection: projection }
        }
        return { height: this.blend(natural, projection), on_road: false, projection: projection }
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
