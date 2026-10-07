import { BufferGeometry, Float32BufferAttribute } from 'three'
import { WorldSurface, TerrainPoint } from './WorldSurface'
import { ROAD_INFLUENCE_RADIUS, TERRAIN_CHUNK_SIZE } from './WorldConfig'

const UV_METERS: number = 5
const SKIRT_DEPTH: number = 3

/**
 * Builds the mesh of one square terrain chunk with a "skirt" along the edges
 * that closes gaps between adjacent chunks of different resolution
 */
export class TerrainChunkBuilder {
    private surface: WorldSurface

    constructor(surface: WorldSurface) {
        this.surface = surface
    }

    build(cx: number, cz: number, segments: number): BufferGeometry {
        const size: number = TERRAIN_CHUNK_SIZE
        const step: number = size / segments
        const ox: number = cx * size
        const oz: number = cz * size
        const n1: number = segments + 1
        const padded: number = segments + 3

        // UVs are computed from a local origin that is a multiple of the texture tile size
        // to avoid losing float precision far from the start
        const uv_base_x: number = Math.floor(ox / 1000) * 1000
        const uv_base_z: number = Math.floor(oz / 1000) * 1000

        const near_road: boolean = this.surface.road.hasRoadNear(ox + size / 2, oz + size / 2, size * 0.75 + ROAD_INFLUENCE_RADIUS)
        const heights: Float32Array = new Float32Array(padded * padded)
        const masks: Float32Array = new Float32Array(padded * padded)
        for (let j: number = 0; j < padded; j++) {
            for (let i: number = 0; i < padded; i++) {
                const x: number = ox + (i - 1) * step
                const z: number = oz + (j - 1) * step
                const index: number = j * padded + i
                if (near_road) {
                    const point: TerrainPoint = this.surface.sample(x, z)
                    heights[index] = point.height
                    masks[index] = point.road_mask
                } else {
                    heights[index] = this.surface.landscape.naturalHeight(x, z)
                }
            }
        }

        const vertex_total: number = n1 * n1 + n1 * 4
        const positions: Float32Array = new Float32Array(vertex_total * 3)
        const normals: Float32Array = new Float32Array(vertex_total * 3)
        const uvs: Float32Array = new Float32Array(vertex_total * 2)
        const road_mask: Float32Array = new Float32Array(vertex_total)
        const indices: number[] = []

        const writeVertex: (v: number, x: number, y: number, z: number, nx: number, ny: number, nz: number, mask: number) => void =
            (v: number, x: number, y: number, z: number, nx: number, ny: number, nz: number, mask: number): void => {
                positions[v * 3] = x
                positions[v * 3 + 1] = y
                positions[v * 3 + 2] = z
                normals[v * 3] = nx
                normals[v * 3 + 1] = ny
                normals[v * 3 + 2] = nz
                uvs[v * 2] = (x - uv_base_x) / UV_METERS
                uvs[v * 2 + 1] = (z - uv_base_z) / UV_METERS
                road_mask[v] = mask
            }

        for (let j: number = 0; j < n1; j++) {
            for (let i: number = 0; i < n1; i++) {
                const index: number = (j + 1) * padded + (i + 1)
                // Normal from central differences, including neighbors beyond the chunk edge
                const nx: number = heights[index - 1] - heights[index + 1]
                const nz: number = heights[index - padded] - heights[index + padded]
                const ny: number = 2 * step
                const len: number = Math.hypot(nx, ny, nz)
                writeVertex(j * n1 + i, ox + i * step, heights[index], oz + j * step, nx / len, ny / len, nz / len, masks[index])
            }
        }
        for (let j: number = 0; j < segments; j++) {
            for (let i: number = 0; i < segments; i++) {
                const a: number = j * n1 + i
                const b: number = a + 1
                const c: number = a + n1
                const d: number = c + 1
                indices.push(a, c, b, b, c, d)
            }
        }

        // Skirts: walk each edge so the outer side is on the left of the direction of travel
        const edges: number[][] = []
        const e0: number[] = []
        const e1: number[] = []
        const e2: number[] = []
        const e3: number[] = []
        for (let k: number = 0; k < n1; k++) {
            e0.push(k)
            e1.push(k * n1 + segments)
            e2.push(segments * n1 + (segments - k))
            e3.push((segments - k) * n1)
        }
        edges.push(e0, e1, e2, e3)
        let skirt_vertex: number = n1 * n1
        for (let e: number = 0; e < edges.length; e++) {
            const edge: number[] = edges[e]
            const first: number = skirt_vertex
            for (let k: number = 0; k < edge.length; k++) {
                const top: number = edge[k]
                writeVertex(skirt_vertex++,
                    positions[top * 3], positions[top * 3 + 1] - SKIRT_DEPTH, positions[top * 3 + 2],
                    normals[top * 3], normals[top * 3 + 1], normals[top * 3 + 2], road_mask[top])
            }
            for (let k: number = 0; k < edge.length - 1; k++) {
                const t0: number = edge[k]
                const t1: number = edge[k + 1]
                const s0: number = first + k
                const s1: number = first + k + 1
                indices.push(t0, t1, s0, t1, s1, s0)
            }
        }

        const geometry: BufferGeometry = new BufferGeometry()
        geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
        geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3))
        geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
        geometry.setAttribute('roadMask', new Float32BufferAttribute(road_mask, 1))
        geometry.setIndex(indices)
        geometry.computeBoundingSphere()
        geometry.computeBoundingBox()
        return geometry
    }
}
