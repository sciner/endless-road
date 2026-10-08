import { BufferGeometry, Group, Mesh, Object3D, Scene, Vector3 } from 'three'
import { WorldMaterials } from '../render/WorldMaterials'
import { RoadMeshBuilder } from './RoadMeshBuilder'
import { RoadNetwork } from './RoadNetwork'
import { RoadSegment } from './RoadTypes'
import { WorldSurface } from './WorldSurface'
import { ROAD_VISIBLE_RADIUS } from './WorldConfig'

/**
 * Keeps meshes in the scene only for road segments near the camera
 */
export class RoadRenderer {
    private network: RoadNetwork
    private builder: RoadMeshBuilder
    private root: Group = new Group()
    private meshes: Map<number, Group> = new Map()

    constructor(scene: Scene, surface: WorldSurface, materials: WorldMaterials) {
        this.network = surface.road
        this.builder = new RoadMeshBuilder(surface, materials)
        this.root.name = 'road'
        scene.add(this.root)
    }

    /** Builds and unloads segments; at most max_builds segments are built per call */
    update(center: Vector3, max_builds: number): void {
        const segments: readonly RoadSegment[] = this.network.getSegments()
        const keep_sq: number = (ROAD_VISIBLE_RADIUS + 80) ** 2
        const show_sq: number = ROAD_VISIBLE_RADIUS ** 2
        let builds: number = 0
        for (let i: number = 0; i < segments.length; i++) {
            const segment: RoadSegment = segments[i]
            const cx: number = (segment.min_x + segment.max_x) * 0.5 - center.x
            const cz: number = (segment.min_z + segment.max_z) * 0.5 - center.z
            const d2: number = cx * cx + cz * cz
            const existing: Group | undefined = this.meshes.get(segment.index)
            if (existing && d2 > keep_sq) {
                this.dispose(existing)
                this.meshes.delete(segment.index)
            } else if (!existing && d2 < show_sq && builds < max_builds) {
                const group: Group = this.builder.build(segment)
                this.root.add(group)
                this.meshes.set(segment.index, group)
                builds++
            }
        }
    }

    get built_count(): number {
        return this.meshes.size
    }

    private dispose(group: Group): void {
        this.root.remove(group)
        group.traverse((object: Object3D): void => {
            const mesh: Mesh = object as Mesh
            if (mesh.isMesh) (mesh.geometry as BufferGeometry).dispose()
        })
    }
}
