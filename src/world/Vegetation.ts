import {
    Color, DynamicDrawUsage, Euler, Group, InstancedBufferAttribute, InstancedMesh, Matrix4, Quaternion, Scene, Vector3,
} from 'three'
import { Random } from '../core/Random'
import { SimplexNoise } from '../core/SimplexNoise'
import { Biome } from '../environment/EnvironmentTypes'
import { WorldMaterials } from '../render/WorldMaterials'
import { AssetLibrary } from '../render/AssetLibrary'
import { VegetationEnvironment, VegetationLayer, VegetationLayers, VegetationVariant } from './VegetationLayers'
import { WorldSurface, TerrainPoint } from './WorldSurface'
import { TERRAIN_CHUNK_SIZE } from './WorldConfig'

/** Generated vegetation instances of a single chunk */
interface ChunkVegetation {
    cx: number
    cz: number
    /** [layer][variant] → flat array of 4x4 matrices */
    matrices: number[][][]
    /** [layer][variant] → flat array of RGB colors */
    colors: number[][][]
    /** x, z, radius for each trunk */
    colliders: number[]
    dirty: boolean
}

export interface VegetationStats {
    name: string
    instances: number
    shadow_instances: number
    fade_distance: number
}

const INITIAL_CAPACITY: number = 512
const UP: Vector3 = new Vector3(0, 1, 0)
const SLOPE_NORMAL: Vector3 = new Vector3()
const SLOPE_ROTATION: Quaternion = new Quaternion()
/** Layer visible only to shadow cameras */
export const SHADOW_LAYER: number = 1
/** Radius in chunks within which trees cast shadows */
const SHADOW_RING: number = 1
/** Margin for the camera lagging behind the car, m */
const FADE_MARGIN: number = 14
/** Fraction of the view distance at which dissolve starts */
const FADE_START: number = 0.62

/**
 * Vegetation and roadside objects around the road. Instances are generated per chunk
 * deterministically and drawn with one shared InstancedMesh per model variant.
 * The set of active layers depends on terrain type and snow.
 */
export class Vegetation {
    private surface: WorldSurface
    private seed: number
    private layers: VegetationLayer[] = []
    private chunks: Map<string, ChunkVegetation> = new Map()
    private root: Group = new Group()
    private center_cx: number = Number.NaN
    private center_cz: number = Number.NaN
    private max_ring: number = 0
    private environment: VegetationEnvironment = { biome: 'forest', snow: false }

    constructor(scene: Scene, surface: WorldSurface, materials: WorldMaterials, assets: AssetLibrary, seed: number) {
        this.surface = surface
        this.seed = seed
        this.root.name = 'vegetation'
        scene.add(this.root)
        const catalog: VegetationLayers = new VegetationLayers(seed, new SimplexNoise(seed ^ 0x4fe1), (): VegetationEnvironment => this.environment)
        this.layers = catalog.create(materials, assets)
        this.createMeshes()
    }

    /**
     * Changes the terrain type: all chunks are regenerated on the next update.
     * Returns true if the vegetation set actually changed.
     */
    setEnvironment(biome: Biome, snow: boolean): boolean {
        if (biome === this.environment.biome && snow === this.environment.snow) return false
        this.environment = { biome: biome, snow: snow }
        for (const chunk of this.chunks.values()) chunk.dirty = true
        return true
    }

    private createMeshes(): void {
        for (let l: number = 0; l < this.layers.length; l++) {
            const layer: VegetationLayer = this.layers[l]
            this.max_ring = Math.max(this.max_ring, layer.ring)
            // Layer chunks are guaranteed to cover ring·chunk size from the car in every direction,
            // so a plant fully fades out before the generated chunks run out
            const hidden: number = layer.ring * TERRAIN_CHUNK_SIZE - FADE_MARGIN
            layer.fade.value.set(hidden * FADE_START, hidden)
            for (let v: number = 0; v < layer.variants.length; v++) {
                layer.meshes.push(this.createMesh(layer.variants[v], INITIAL_CAPACITY, false))
                if (layer.cast_shadow) layer.shadow_meshes.push(this.createMesh(Vegetation.shadowVariant(layer, v), INITIAL_CAPACITY, true))
            }
        }
    }

    /**
     * The main mesh is visible to the camera and casts no shadows. The shadow mesh lives
     * only on SHADOW_LAYER: shadow cameras see it, the main camera does not.
     */
    private createMesh(variant: VegetationVariant, capacity: number, shadow: boolean): InstancedMesh {
        const mesh: InstancedMesh = new InstancedMesh(variant.geometry, variant.material, capacity)
        mesh.instanceMatrix.setUsage(DynamicDrawUsage)
        mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3)
        mesh.instanceColor.setUsage(DynamicDrawUsage)
        mesh.count = 0
        mesh.frustumCulled = false
        mesh.castShadow = shadow
        mesh.receiveShadow = !shadow
        if (shadow) mesh.layers.set(SHADOW_LAYER)
        this.root.add(mesh)
        return mesh
    }

    private static key(cx: number, cz: number): string {
        return `${cx}:${cz}`
    }

    markDirty(min_x: number, max_x: number, min_z: number, max_z: number): void {
        const c0x: number = Math.floor(min_x / TERRAIN_CHUNK_SIZE)
        const c1x: number = Math.floor(max_x / TERRAIN_CHUNK_SIZE)
        const c0z: number = Math.floor(min_z / TERRAIN_CHUNK_SIZE)
        const c1z: number = Math.floor(max_z / TERRAIN_CHUNK_SIZE)
        for (let cx: number = c0x; cx <= c1x; cx++) {
            for (let cz: number = c0z; cz <= c1z; cz++) {
                const chunk: ChunkVegetation | undefined = this.chunks.get(Vegetation.key(cx, cz))
                if (chunk) chunk.dirty = true
            }
        }
    }

    update(center: Vector3, budget_ms: number): void {
        const started: number = performance.now()
        const ccx: number = Math.floor(center.x / TERRAIN_CHUNK_SIZE)
        const ccz: number = Math.floor(center.z / TERRAIN_CHUNK_SIZE)
        let changed: boolean = ccx !== this.center_cx || ccz !== this.center_cz
        this.center_cx = ccx
        this.center_cz = ccz

        for (const [key, chunk] of this.chunks) {
            if (Math.max(Math.abs(chunk.cx - ccx), Math.abs(chunk.cz - ccz)) > this.max_ring + 1) {
                this.chunks.delete(key)
                changed = true
            }
        }

        // Generate missing chunks from nearest to farthest while the time budget lasts
        let generated: number = 0
        for (let ring: number = 0; ring <= this.max_ring; ring++) {
            for (let dz: number = -ring; dz <= ring; dz++) {
                for (let dx: number = -ring; dx <= ring; dx++) {
                    if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue
                    const key: string = Vegetation.key(ccx + dx, ccz + dz)
                    const existing: ChunkVegetation | undefined = this.chunks.get(key)
                    if (existing && !existing.dirty) continue
                    if (generated > 0 && performance.now() - started > budget_ms) {
                        if (changed) this.rebuildInstances()
                        return
                    }
                    this.chunks.set(key, this.generate(ccx + dx, ccz + dz))
                    generated++
                    changed = true
                }
            }
        }
        if (changed) this.rebuildInstances()
    }

    private generate(cx: number, cz: number): ChunkVegetation {
        const chunk_seed: number = Random.hash(this.seed, cx, cz)
        const size: number = TERRAIN_CHUNK_SIZE
        const ox: number = cx * size
        const oz: number = cz * size
        const data: ChunkVegetation = { cx: cx, cz: cz, matrices: [], colors: [], colliders: [], dirty: false }
        const matrix: Matrix4 = new Matrix4()
        const position: Vector3 = new Vector3()
        const rotation: Quaternion = new Quaternion()
        const euler: Euler = new Euler()
        const scale: Vector3 = new Vector3()
        const tint: Color = new Color()

        for (let l: number = 0; l < this.layers.length; l++) {
            const layer: VegetationLayer = this.layers[l]
            const matrices: number[][] = layer.variants.map((): number[] => [])
            const colors: number[][] = layer.variants.map((): number[] => [])
            data.matrices.push(matrices)
            data.colors.push(colors)
            if (!layer.active(this.environment)) continue
            if (layer.max_road < Infinity && !this.surface.road.hasRoadNear(ox + size / 2, oz + size / 2, size * 0.75 + layer.max_road)) continue

            // Separate RNG per layer: enabling one layer does not shift the placement of others
            const layer_random: Random = new Random(Random.hash(chunk_seed, l, 17))
            const cells: number = Math.floor(size / layer.spacing)
            for (let gz: number = 0; gz < cells; gz++) {
                for (let gx: number = 0; gx < cells; gx++) {
                    const x: number = ox + (gx + layer_random.next()) * layer.spacing
                    const z: number = oz + (gz + layer_random.next()) * layer.spacing
                    const roll: number = layer_random.next()
                    const jitter: number = layer_random.next()
                    if (roll > layer.density(x, z)) continue
                    const point: TerrainPoint = this.surface.sample(x, z)
                    if (point.road_distance < layer.min_road + jitter * layer.min_road_jitter) continue
                    if (point.road_distance > layer.max_road) continue

                    const variant: number = layer.pick(x, z, layer_random)
                    const s: number = layer_random.range(layer.scale_min, layer.scale_max)
                    const stretch: number = layer_random.range(0.85, 1.15)
                    euler.set(layer_random.range(-layer.tilt, layer.tilt), layer_random.next() * Math.PI * 2, layer_random.range(-layer.tilt, layer.tilt))
                    rotation.setFromEuler(euler)
                    position.set(x, point.height - layer.sink * s, z)
                    if (layer.align) this.alignToSlope(x, z, rotation)
                    scale.set(s * stretch, s, s * stretch)
                    matrix.compose(position, rotation, scale)
                    const list: number[] = matrices[variant]
                    for (let e: number = 0; e < 16; e++) list.push(matrix.elements[e])

                    const shade: number = layer_random.range(0.75, 1.15)
                    tint.setRGB(shade * layer_random.range(0.92, 1.08), shade, shade * layer_random.range(0.85, 1.05))
                    colors[variant].push(tint.r, tint.g, tint.b)

                    const collider: number = layer.variants[variant].collider
                    if (collider > 0) data.colliders.push(x, z, collider * s * stretch + 0.15)
                }
            }
        }
        return data
    }

    /** Shadows are soft and small on screen, so they use the lighter model when there is one */
    private static shadowVariant(layer: VegetationLayer, v: number): VegetationVariant {
        return layer.shadow_variants ? layer.shadow_variants[v] : layer.variants[v]
    }

    /** Tilts the rotation so the instance lies along the terrain slope */
    private alignToSlope(x: number, z: number, rotation: Quaternion): void {
        const d: number = 0.8
        const dx: number = this.surface.height(x + d, z) - this.surface.height(x - d, z)
        const dz: number = this.surface.height(x, z + d) - this.surface.height(x, z - d)
        SLOPE_NORMAL.set(-dx / (2 * d), 1, -dz / (2 * d)).normalize()
        SLOPE_ROTATION.setFromUnitVectors(UP, SLOPE_NORMAL)
        rotation.premultiply(SLOPE_ROTATION)
    }

    /** Copies instances of all active chunks into the shared InstancedMesh objects */
    private rebuildInstances(): void {
        for (let l: number = 0; l < this.layers.length; l++) {
            const layer: VegetationLayer = this.layers[l]
            for (let v: number = 0; v < layer.variants.length; v++) {
                layer.meshes[v] = this.fillMesh(layer.meshes[v], l, v, layer.ring, false, layer.variants[v])
                if (layer.cast_shadow) layer.shadow_meshes[v] = this.fillMesh(layer.shadow_meshes[v], l, v, SHADOW_RING, true, Vegetation.shadowVariant(layer, v))
            }
        }
    }

    /** Fills the mesh with instances from chunks within ring; returns a new mesh if capacity is insufficient */
    private fillMesh(source_mesh: InstancedMesh, l: number, v: number, ring: number, shadow: boolean, variant: VegetationVariant): InstancedMesh {
        let total: number = 0
        const sources: ChunkVegetation[] = []
        for (const chunk of this.chunks.values()) {
            const chunk_ring: number = Math.max(Math.abs(chunk.cx - this.center_cx), Math.abs(chunk.cz - this.center_cz))
            if (chunk_ring > ring) continue
            sources.push(chunk)
            total += chunk.matrices[l][v].length / 16
        }

        let mesh: InstancedMesh = source_mesh
        if (total > mesh.instanceMatrix.count) {
            this.root.remove(mesh)
            mesh.dispose()
            mesh = this.createMesh(variant, Math.ceil(total * 1.5), shadow)
        }

        const matrix_array: Float32Array = mesh.instanceMatrix.array as Float32Array
        const color_attribute: InstancedBufferAttribute = mesh.instanceColor as InstancedBufferAttribute
        const color_array: Float32Array = color_attribute.array as Float32Array
        let offset: number = 0
        for (let s: number = 0; s < sources.length; s++) {
            const matrices: number[] = sources[s].matrices[l][v]
            matrix_array.set(matrices, offset * 16)
            color_array.set(sources[s].colors[l][v], offset * 3)
            offset += matrices.length / 16
        }
        mesh.count = total
        mesh.instanceMatrix.needsUpdate = true
        color_attribute.needsUpdate = true
        return mesh
    }

    /**
     * Pushes a rectangle centered at position, facing yaw, out of trunks and rocks.
     * previous is the center a step earlier: when a trunk ends up inside the body,
     * it is pushed back out through the face it came in by, not the nearest one.
     * Returns the collision normal or null.
     */
    collideBox(position: Vector3, previous: Vector3, yaw: number, half_width: number, half_length: number): Vector3 | null {
        const fx: number = Math.sin(yaw)
        const fz: number = Math.cos(yaw)
        const ccx: number = Math.floor(position.x / TERRAIN_CHUNK_SIZE)
        const ccz: number = Math.floor(position.z / TERRAIN_CHUNK_SIZE)
        let normal: Vector3 | null = null
        for (let dz: number = -1; dz <= 1; dz++) {
            for (let dx: number = -1; dx <= 1; dx++) {
                const chunk: ChunkVegetation | undefined = this.chunks.get(Vegetation.key(ccx + dx, ccz + dz))
                if (!chunk) continue
                const list: number[] = chunk.colliders
                for (let i: number = 0; i < list.length; i += 3) {
                    // Collider center in the body frame: f along the nose, r to the side (r = (-fz, fx))
                    const ex: number = list[i] - position.x
                    const ez: number = list[i + 1] - position.z
                    const radius: number = list[i + 2]
                    const lf: number = ex * fx + ez * fz
                    const lr: number = -ex * fz + ez * fx
                    if (Math.abs(lf) > half_length + radius || Math.abs(lr) > half_width + radius) continue
                    const cf: number = Math.max(-half_length, Math.min(half_length, lf))
                    const cr: number = Math.max(-half_width, Math.min(half_width, lr))
                    const of: number = lf - cf
                    const or: number = lr - cr
                    const d2: number = of * of + or * or
                    if (d2 >= radius * radius) continue
                    // Local push direction away from the collider and its depth
                    let nf: number
                    let nr: number
                    let push: number
                    if (d2 > 1e-8) {
                        const d: number = Math.sqrt(d2)
                        nf = -of / d
                        nr = -or / d
                        push = radius - d
                    } else {
                        // Collider center inside the body: leave through the face it entered by
                        const px: number = list[i] - previous.x
                        const pz: number = list[i + 1] - previous.z
                        const out_f: number = Math.abs(px * fx + pz * fz) - half_length
                        const out_r: number = Math.abs(-px * fz + pz * fx) - half_width
                        const pen_f: number = half_length - Math.abs(lf) + radius
                        const pen_r: number = half_width - Math.abs(lr) + radius
                        if (out_f > out_r) {
                            nf = lf >= 0 ? -1 : 1
                            nr = 0
                            push = pen_f
                        } else {
                            nf = 0
                            nr = lr >= 0 ? -1 : 1
                            push = pen_r
                        }
                    }
                    const nx: number = fx * nf - fz * nr
                    const nz: number = fz * nf + fx * nr
                    position.x += nx * push
                    position.z += nz * push
                    normal = new Vector3(nx, 0, nz)
                }
            }
        }
        return normal
    }

    /**
     * Pushes the circle (x, z, radius) out of trunks and rocks.
     * Returns the collision normal or null.
     */
    collide(position: Vector3, radius: number): Vector3 | null {
        const ccx: number = Math.floor(position.x / TERRAIN_CHUNK_SIZE)
        const ccz: number = Math.floor(position.z / TERRAIN_CHUNK_SIZE)
        let normal: Vector3 | null = null
        for (let dz: number = -1; dz <= 1; dz++) {
            for (let dx: number = -1; dx <= 1; dx++) {
                const chunk: ChunkVegetation | undefined = this.chunks.get(Vegetation.key(ccx + dx, ccz + dz))
                if (!chunk) continue
                const list: number[] = chunk.colliders
                for (let i: number = 0; i < list.length; i += 3) {
                    const ex: number = position.x - list[i]
                    const ez: number = position.z - list[i + 1]
                    const min_distance: number = radius + list[i + 2]
                    const d2: number = ex * ex + ez * ez
                    if (d2 >= min_distance * min_distance || d2 < 1e-8) continue
                    const d: number = Math.sqrt(d2)
                    const push: number = min_distance - d
                    position.x += (ex / d) * push
                    position.z += (ez / d) * push
                    normal = new Vector3(ex / d, 0, ez / d)
                }
            }
        }
        return normal
    }

    isReady(): boolean {
        return !Number.isNaN(this.center_cx)
    }

    get chunk_count(): number {
        return this.chunks.size
    }

    /** Number of rendered instances per layer and dissolve distance */
    stats(): VegetationStats[] {
        return this.layers.map((layer: VegetationLayer): VegetationStats => ({
            name: layer.name,
            instances: layer.meshes.reduce((sum: number, mesh: InstancedMesh): number => sum + mesh.count, 0),
            shadow_instances: layer.shadow_meshes.reduce((sum: number, mesh: InstancedMesh): number => sum + mesh.count, 0),
            fade_distance: layer.fade.value.y,
        }))
    }
}
