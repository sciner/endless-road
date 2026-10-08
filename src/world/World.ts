import { Scene, Vector3 } from 'three'
import { AssetLibrary } from '../render/AssetLibrary'
import { WorldMaterials } from '../render/WorldMaterials'
import { Landscape } from './Landscape'
import { RoadNetwork } from './RoadNetwork'
import { RoadRenderer } from './RoadRenderer'
import { RoadSegment } from './RoadTypes'
import { TerrainSystem } from './TerrainSystem'
import { Vegetation, VegetationStats } from './Vegetation'
import { WorldSurface } from './WorldSurface'
import { ROAD_GENERATE_AHEAD, ROAD_INFLUENCE_RADIUS } from './WorldConfig'

/** World streaming state for the debug panel */
export interface WorldStats {
    road_segments: number
    road_meshes: number
    /** Distances along the track to the ends of the built road, m */
    road_ahead: number
    road_behind: number
    terrain_chunks: number
    vegetation_chunks: number
    vegetation: VegetationStats[]
}

/**
 * Endless world: track, terrain and vegetation streamed in around the player
 */
export class World {
    readonly road: RoadNetwork
    readonly surface: WorldSurface
    readonly materials: WorldMaterials
    readonly vegetation: Vegetation
    private road_renderer: RoadRenderer
    private terrain: TerrainSystem

    constructor(scene: Scene, assets: AssetLibrary, anisotropy: number, seed: number) {
        const landscape: Landscape = new Landscape(seed)
        this.road = new RoadNetwork(seed, landscape)
        this.surface = new WorldSurface(this.road)
        this.materials = new WorldMaterials(assets, anisotropy)
        this.road_renderer = new RoadRenderer(scene, this.surface, this.materials)
        this.terrain = new TerrainSystem(scene, this.surface, this.materials)
        this.vegetation = new Vegetation(scene, this.surface, this.materials, assets, seed)

        // A new road section reshapes the terrain around it, so rebuild the affected chunks
        this.road.onSegmentAdded((segment: RoadSegment): void => {
            const m: number = ROAD_INFLUENCE_RADIUS + 4
            this.terrain.markDirty(segment.min_x - m, segment.max_x + m, segment.min_z - m, segment.max_z + m)
            this.vegetation.markDirty(segment.min_x - m, segment.max_x + m, segment.min_z - m, segment.max_z + m)
        })
    }

    /** Synchronous world preparation around the start point; resolves after each step for the progress bar */
    async preload(center: Vector3, on_progress: (ratio: number) => void): Promise<void> {
        const wait: () => Promise<void> = (): Promise<void> => new Promise((resolve: () => void): void => {
            setTimeout(resolve, 0)
        })
        this.road.ensureAround(0, ROAD_GENERATE_AHEAD, 10000)
        on_progress(0.1)
        await wait()
        this.road_renderer.update(center, 10000)
        let steps: number = 0
        while (!this.terrain.isReady(center, 4) && steps < 200) {
            this.terrain.update(center, 60)
            steps++
            on_progress(0.1 + Math.min(0.6, steps * 0.03))
            await wait()
        }
        this.vegetation.update(center, 100000)
        on_progress(0.85)
        await wait()
    }

    stats(): WorldStats {
        return {
            road_segments: this.road.segment_count,
            road_meshes: this.road_renderer.built_count,
            road_ahead: this.road.front_distance,
            road_behind: this.road.back_distance,
            terrain_chunks: this.terrain.chunk_count,
            vegetation_chunks: this.vegetation.chunk_count,
            vegetation: this.vegetation.stats(),
        }
    }

    update(center: Vector3, along: number, time: number): void {
        this.road.ensureAround(along, ROAD_GENERATE_AHEAD, 4)
        this.road_renderer.update(center, 3)
        this.terrain.update(center, 4)
        this.vegetation.update(center, 3)
        this.materials.update(time)
    }
}
