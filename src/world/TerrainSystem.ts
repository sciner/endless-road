import { BufferGeometry, Group, Mesh, Scene, Vector3 } from 'three'
import { WorldMaterials } from '../render/WorldMaterials'
import { TerrainChunkBuilder } from './TerrainChunkBuilder'
import { WorldSurface } from './WorldSurface'
import { TERRAIN_CHUNK_RADIUS, TERRAIN_CHUNK_SIZE } from './WorldConfig'

interface TerrainChunk {
    cx: number
    cz: number
    mesh: Mesh
    lod: number
    dirty: boolean
}

interface BuildRequest {
    cx: number
    cz: number
    lod: number
    priority: number
}

/**
 * Chunked terrain streaming around the player with levels of detail.
 * Chunks crossed by a new part of the road are rebuilt.
 */
export class TerrainSystem {
    private builder: TerrainChunkBuilder
    private materials: WorldMaterials
    private chunks: Map<string, TerrainChunk> = new Map()
    private root: Group = new Group()

    constructor(scene: Scene, surface: WorldSurface, materials: WorldMaterials) {
        this.builder = new TerrainChunkBuilder(surface)
        this.materials = materials
        this.root.name = 'terrain'
        scene.add(this.root)
    }

    private static key(cx: number, cz: number): string {
        return `${cx}:${cz}`
    }

    /** Number of grid segments depending on chunk distance */
    private static lodFor(ring: number): number {
        if (ring <= 1) return 40
        if (ring <= 3) return 20
        return 10
    }

    /** Marks all chunks intersecting the rectangle for rebuild */
    markDirty(min_x: number, max_x: number, min_z: number, max_z: number): void {
        const c0x: number = Math.floor(min_x / TERRAIN_CHUNK_SIZE)
        const c1x: number = Math.floor(max_x / TERRAIN_CHUNK_SIZE)
        const c0z: number = Math.floor(min_z / TERRAIN_CHUNK_SIZE)
        const c1z: number = Math.floor(max_z / TERRAIN_CHUNK_SIZE)
        for (let cx: number = c0x; cx <= c1x; cx++) {
            for (let cz: number = c0z; cz <= c1z; cz++) {
                const chunk: TerrainChunk | undefined = this.chunks.get(TerrainSystem.key(cx, cz))
                if (chunk) chunk.dirty = true
            }
        }
    }

    /** Builds missing chunks within the time budget budget_ms */
    update(center: Vector3, budget_ms: number): void {
        const started: number = performance.now()
        const ccx: number = Math.floor(center.x / TERRAIN_CHUNK_SIZE)
        const ccz: number = Math.floor(center.z / TERRAIN_CHUNK_SIZE)
        const radius: number = TERRAIN_CHUNK_RADIUS

        for (const [key, chunk] of this.chunks) {
            const ring: number = Math.max(Math.abs(chunk.cx - ccx), Math.abs(chunk.cz - ccz))
            if (ring > radius + 1) {
                this.root.remove(chunk.mesh)
                chunk.mesh.geometry.dispose()
                this.chunks.delete(key)
            }
        }

        const requests: BuildRequest[] = []
        for (let dz: number = -radius; dz <= radius; dz++) {
            for (let dx: number = -radius; dx <= radius; dx++) {
                const ring: number = Math.max(Math.abs(dx), Math.abs(dz))
                const cx: number = ccx + dx
                const cz: number = ccz + dz
                const lod: number = TerrainSystem.lodFor(ring)
                const chunk: TerrainChunk | undefined = this.chunks.get(TerrainSystem.key(cx, cz))
                if (chunk && chunk.lod === lod && !chunk.dirty) continue
                // Missing chunks take priority over LOD changes of existing ones
                const priority: number = dx * dx + dz * dz + (chunk ? 50 : 0)
                requests.push({ cx: cx, cz: cz, lod: lod, priority: priority })
            }
        }
        requests.sort((a: BuildRequest, b: BuildRequest): number => a.priority - b.priority)

        for (let r: number = 0; r < requests.length; r++) {
            if (r > 0 && performance.now() - started > budget_ms) break
            this.buildChunk(requests[r])
        }
    }

    private buildChunk(request: BuildRequest): void {
        const key: string = TerrainSystem.key(request.cx, request.cz)
        const existing: TerrainChunk | undefined = this.chunks.get(key)
        const geometry: BufferGeometry = this.builder.build(request.cx, request.cz, request.lod)
        if (existing) {
            existing.mesh.geometry.dispose()
            existing.mesh.geometry = geometry
            existing.lod = request.lod
            existing.dirty = false
            return
        }
        const mesh: Mesh = new Mesh(geometry, this.materials.terrain)
        mesh.receiveShadow = true
        mesh.name = `terrain-${key}`
        this.root.add(mesh)
        this.chunks.set(key, { cx: request.cx, cz: request.cz, mesh: mesh, lod: request.lod, dirty: false })
    }

    get chunk_count(): number {
        return this.chunks.size
    }

    /** Whether all chunks within ring around the point are built */
    isReady(center: Vector3, ring: number): boolean {
        const ccx: number = Math.floor(center.x / TERRAIN_CHUNK_SIZE)
        const ccz: number = Math.floor(center.z / TERRAIN_CHUNK_SIZE)
        for (let dz: number = -ring; dz <= ring; dz++) {
            for (let dx: number = -ring; dx <= ring; dx++) {
                if (!this.chunks.has(TerrainSystem.key(ccx + dx, ccz + dz))) return false
            }
        }
        return true
    }
}
