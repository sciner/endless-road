import { BufferGeometry, Float32BufferAttribute, InstancedMesh, IUniform, Material, Mesh, Object3D, Vector2, Vector3 } from 'three'
import { MathUtils } from '../core/MathUtils'
import { Random } from '../core/Random'
import { SimplexNoise } from '../core/SimplexNoise'
import { Biome } from '../environment/EnvironmentTypes'
import { AssetLibrary } from '../render/AssetLibrary'
import { WorldMaterials } from '../render/WorldMaterials'
import { PropFactory } from './PropFactory'
import { TreeFactory, TreeModel } from './TreeFactory'
import { ROAD_HALF_WIDTH, RAIL_OFFSET } from './WorldConfig'

export interface VegetationVariant {
    geometry: BufferGeometry
    material: Material | Material[]
    /** Collider radius at scale 1; 0 means no collisions */
    collider: number
}

/** Terrain type and snow that determine which layers grow */
export interface VegetationEnvironment {
    biome: Biome
    snow: boolean
}

export interface VegetationLayer {
    name: string
    variants: VegetationVariant[]
    /** View distance in chunks */
    ring: number
    /** Dissolve uniform of the layer material */
    fade: IUniform<Vector2>
    spacing: number
    min_road: number
    min_road_jitter: number
    max_road: number
    scale_min: number
    scale_max: number
    sink: number
    /** Random instance tilt, rad */
    tilt: number
    cast_shadow: boolean
    active: (environment: VegetationEnvironment) => boolean
    density: (x: number, z: number) => number
    pick: (x: number, z: number, random: Random) => number
    meshes: InstancedMesh[]
    /** Copies of nearby instances invisible to the main camera, used only for shadows */
    shadow_meshes: InstancedMesh[]
}

/** Common layer defaults that each description overrides */
const LAYER_DEFAULTS: Pick<VegetationLayer, 'min_road_jitter' | 'max_road' | 'scale_min' | 'scale_max' | 'sink' | 'tilt' | 'cast_shadow'> = {
    min_road_jitter: 2,
    max_road: Infinity,
    scale_min: 0.8,
    scale_max: 1.2,
    sink: 0.05,
    tilt: 0.04,
    cast_shadow: false,
}

type LayerDescription = Omit<VegetationLayer, 'meshes' | 'shadow_meshes'>

/**
 * Catalog of vegetation and roadside object layers for all terrain types:
 * forest and autumn forest, desert with cacti, dry trees and bushes, boulders everywhere
 */
export class VegetationLayers {
    private seed: number
    private noise: SimplexNoise
    private environment: () => VegetationEnvironment

    constructor(seed: number, noise: SimplexNoise, environment: () => VegetationEnvironment) {
        this.seed = seed
        this.noise = noise
        this.environment = environment
    }

    /** Forest density: large stands with occasional clearings */
    private forestDensity(x: number, z: number): number {
        const n: number = this.noise.fbm(x * 0.005, z * 0.005, 3)
        return MathUtils.smoothstep(-0.45, 0.15, n) * 0.85 + 0.08
    }

    /** Desert: sparse vegetation patches amid bare sand */
    private desertDensity(x: number, z: number): number {
        const n: number = this.noise.fbm(x * 0.008 + 31, z * 0.008 - 17, 3)
        return MathUtils.smoothstep(-0.35, 0.45, n)
    }

    create(materials: WorldMaterials, assets: AssetLibrary): VegetationLayer[] {
        const is_forest: (environment: VegetationEnvironment) => boolean = (environment: VegetationEnvironment): boolean => environment.biome !== 'desert'
        const is_desert: (environment: VegetationEnvironment) => boolean = (environment: VegetationEnvironment): boolean => environment.biome === 'desert'
        const layers: LayerDescription[] = []

        const tree_variants: VegetationVariant[] = []
        const fir_count: number = 4
        for (let i: number = 0; i < fir_count; i++) {
            const model: TreeModel = TreeFactory.fir(this.seed + i * 101)
            tree_variants.push({ geometry: model.geometry, material: [materials.bark, materials.fir_foliage], collider: model.trunk_radius })
        }
        for (let i: number = 0; i < 3; i++) {
            const model: TreeModel = TreeFactory.broadleaf(this.seed + i * 211 + 7)
            tree_variants.push({ geometry: model.geometry, material: [materials.bark, materials.leaf_foliage], collider: model.trunk_radius })
        }
        layers.push({
            ...LAYER_DEFAULTS,
            name: 'trees',
            variants: tree_variants,
            ring: 4,
            fade: materials.tree_fade,
            spacing: 6.5,
            min_road: ROAD_HALF_WIDTH + 4.5,
            min_road_jitter: 5,
            scale_min: 0.75,
            scale_max: 1.3,
            sink: 0.3,
            cast_shadow: true,
            active: is_forest,
            density: (x: number, z: number): number => this.forestDensity(x, z),
            pick: (x: number, z: number, random: Random): number => {
                // Conifer and deciduous areas alternate by low-frequency noise; autumn has more deciduous
                const threshold: number = this.environment().biome === 'autumn' ? 0.25 : -0.15
                const mix: number = this.noise.noise2(x * 0.0021 + 50, z * 0.0021 - 50) + random.range(-0.45, 0.45)
                return mix > threshold ? random.int(0, fir_count - 1) : fir_count + random.int(0, 2)
            },
        })

        layers.push({
            ...LAYER_DEFAULTS,
            name: 'dead_trees',
            variants: VegetationLayers.variants(3, (i: number): TreeModel => TreeFactory.deadTree(this.seed + i * 37 + 3), materials.bark, true),
            ring: 4,
            fade: materials.tree_fade,
            spacing: 30,
            min_road: ROAD_HALF_WIDTH + 5,
            min_road_jitter: 8,
            scale_min: 0.8,
            scale_max: 1.25,
            sink: 0.2,
            tilt: 0.12,
            cast_shadow: true,
            active: is_desert,
            density: (x: number, z: number): number => 0.12 + this.desertDensity(x, z) * 0.25,
            pick: (_x: number, _z: number, random: Random): number => random.int(0, 2),
        })

        layers.push({
            ...LAYER_DEFAULTS,
            name: 'cacti',
            variants: VegetationLayers.variants(4, (i: number): TreeModel => PropFactory.cactus(this.seed + i * 53 + 11), materials.cactus, true),
            ring: 4,
            fade: materials.tree_fade,
            spacing: 13,
            min_road: ROAD_HALF_WIDTH + 3.5,
            min_road_jitter: 6,
            scale_min: 0.75,
            scale_max: 1.3,
            sink: 0.1,
            tilt: 0.05,
            cast_shadow: true,
            active: is_desert,
            density: (x: number, z: number): number => this.desertDensity(x, z) * 0.45,
            pick: (_x: number, _z: number, random: Random): number => random.int(0, 3),
        })

        // Boulders appear everywhere, more often in the desert; never placed closer than the guardrail
        layers.push({
            ...LAYER_DEFAULTS,
            name: 'boulders',
            variants: VegetationLayers.variants(5, (i: number): TreeModel => PropFactory.boulder(this.seed + i * 71 + 5), materials.rock, true),
            ring: 4,
            fade: materials.tree_fade,
            spacing: 17,
            min_road: RAIL_OFFSET + 1.6,
            min_road_jitter: 10,
            scale_min: 0.45,
            scale_max: 1.9,
            sink: 0.22,
            tilt: 0.35,
            cast_shadow: true,
            active: (): boolean => true,
            density: (x: number, z: number): number => {
                // Rocks lie in scattered clusters: threshold on their own noise
                const cluster: number = MathUtils.smoothstep(0.1, 0.6, this.noise.noise2(x * 0.011 - 90, z * 0.011 + 40))
                return cluster * (this.environment().biome === 'desert' ? 0.55 : 0.3) + 0.03
            },
            pick: (_x: number, _z: number, random: Random): number => random.int(0, 4),
        })

        const fern_variants: VegetationVariant[] = []
        assets.fern.scene.traverse((object: Object3D): void => {
            const mesh: Mesh = object as Mesh
            if (!mesh.isMesh) return
            const geometry: BufferGeometry = mesh.geometry.clone()
            geometry.computeBoundingBox()
            const box: Vector3 = new Vector3()
            geometry.boundingBox?.getCenter(box)
            geometry.translate(-box.x, -(geometry.boundingBox?.min.y ?? 0), -box.z)
            fern_variants.push({ geometry: geometry, material: materials.fern, collider: 0 })
        })
        layers.push({
            ...LAYER_DEFAULTS,
            name: 'ferns',
            variants: fern_variants,
            ring: 3,
            fade: materials.fern_fade,
            spacing: 2.6,
            min_road: ROAD_HALF_WIDTH + 1.8,
            max_road: 45,
            scale_max: 1.5,
            active: (environment: VegetationEnvironment): boolean => is_forest(environment) && !environment.snow,
            density: (x: number, z: number): number => this.forestDensity(x, z) * 0.45,
            pick: (_x: number, _z: number, random: Random): number => random.int(0, fern_variants.length - 1),
        })

        layers.push({
            ...LAYER_DEFAULTS,
            name: 'dry_bushes',
            variants: VegetationLayers.variants(3, (i: number): TreeModel => TreeFactory.dryBush(this.seed + i * 19 + 2), materials.dry_bush, false),
            ring: 3,
            fade: materials.fern_fade,
            spacing: 6,
            min_road: ROAD_HALF_WIDTH + 2,
            min_road_jitter: 4,
            scale_min: 0.6,
            scale_max: 1.4,
            active: is_desert,
            density: (x: number, z: number): number => 0.08 + this.desertDensity(x, z) * 0.5,
            pick: (_x: number, _z: number, random: Random): number => random.int(0, 2),
        })

        layers.push({
            ...LAYER_DEFAULTS,
            name: 'grass',
            variants: [{ geometry: VegetationLayers.grassTuft(), material: materials.grass, collider: 0 }],
            ring: 2,
            fade: materials.grass_fade,
            spacing: 1.25,
            min_road: ROAD_HALF_WIDTH + 0.8,
            min_road_jitter: 1.2,
            max_road: 18,
            scale_min: 0.7,
            scale_max: 1.35,
            sink: 0.04,
            active: (environment: VegetationEnvironment): boolean => !environment.snow,
            // Desert: sparse tufts of dry grass
            density: (x: number, z: number): number => this.environment().biome === 'desert' ? 0.06 + this.desertDensity(x, z) * 0.18 : 0.65,
            pick: (): number => 0,
        })
        return layers.map((layer: LayerDescription): VegetationLayer => ({ ...layer, meshes: [], shadow_meshes: [] }))
    }

    private static variants(count: number, build: (index: number) => TreeModel, material: Material, collide: boolean): VegetationVariant[] {
        const list: VegetationVariant[] = []
        for (let i: number = 0; i < count; i++) {
            const model: TreeModel = build(i)
            list.push({ geometry: model.geometry, material: material, collider: collide ? model.trunk_radius : 0 })
        }
        return list
    }

    /** Grass tuft made of three crossed cards */
    private static grassTuft(): BufferGeometry {
        const positions: number[] = []
        const normals: number[] = []
        const uvs: number[] = []
        const indices: number[] = []
        const width: number = 1.0
        const height: number = 0.6
        for (let k: number = 0; k < 3; k++) {
            const angle: number = (k / 3) * Math.PI
            const dx: number = Math.cos(angle) * width * 0.5
            const dz: number = Math.sin(angle) * width * 0.5
            const base: number = positions.length / 3
            positions.push(-dx, 0, -dz, dx, 0, dz, dx, height, dz, -dx, height, -dz)
            for (let i: number = 0; i < 4; i++) normals.push(0, 1, 0)
            uvs.push(0, 0, 1, 0, 1, 1, 0, 1)
            indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
        }
        const geometry: BufferGeometry = new BufferGeometry()
        geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
        geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3))
        geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
        geometry.setIndex(indices)
        return geometry
    }
}
