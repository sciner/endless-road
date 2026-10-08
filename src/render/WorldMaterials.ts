import { Color, DoubleSide, SRGBColorSpace, IUniform, Material, Mesh, MeshStandardMaterial, Object3D, Texture, Vector2, WebGLProgramParametersWithUniforms } from 'three'
import { EnvironmentLook } from '../environment/EnvironmentLook'
import { GroundType } from '../environment/EnvironmentTypes'
import { AssetLibrary, PbrSet } from './AssetLibrary'
import { ProceduralTextures } from './ProceduralTextures'
import { ShaderPatches } from './ShaderPatches'

/**
 * All environment materials. The shared animation uniform uTime
 * is updated once per frame and drives rain ripples and wind;
 * weather uniforms (wetness, snow, foliage recolor) are set by the environment.
 */
export class WorldMaterials {
    readonly road: MeshStandardMaterial
    readonly markings: MeshStandardMaterial
    readonly rail: MeshStandardMaterial
    readonly post: MeshStandardMaterial
    /** Bridge decks, piers, abutments and curbs */
    readonly concrete: MeshStandardMaterial
    readonly terrain: MeshStandardMaterial
    readonly bark: MeshStandardMaterial
    readonly fir_foliage: MeshStandardMaterial
    readonly leaf_foliage: MeshStandardMaterial
    readonly grass: MeshStandardMaterial
    readonly fern: MeshStandardMaterial
    readonly rock: MeshStandardMaterial
    readonly cactus: MeshStandardMaterial
    readonly dry_bush: MeshStandardMaterial
    readonly puddle_map: Texture
    /** Vegetation fade distances (fully visible, fully hidden), set by Vegetation */
    readonly tree_fade: IUniform<Vector2> = { value: new Vector2(1e5, 1e5 + 1) }
    readonly fern_fade: IUniform<Vector2> = { value: new Vector2(1e5, 1e5 + 1) }
    readonly grass_fade: IUniform<Vector2> = { value: new Vector2(1e5, 1e5 + 1) }

    private time_uniform: IUniform<number> = { value: 0 }
    private wetness_uniform: IUniform<number> = { value: 1 }
    private rain_uniform: IUniform<number> = { value: 1 }
    private snow_uniform: IUniform<number> = { value: 0 }
    private road_snow_uniform: IUniform<number> = { value: 0 }
    private dirt_uniform: IUniform<Color> = { value: new Color(0.055, 0.048, 0.04) }
    private shoulder_roughness_uniform: IUniform<number> = { value: 0.32 }
    private leaf_recolor_uniform: IUniform<number> = { value: 0 }
    private leaf_recolor_color_uniform: IUniform<Color> = { value: new Color() }
    private leaf_recolor_alt_uniform: IUniform<Color> = { value: new Color(0.92, 0.66, 0.16) }
    private leaf_soft_uniform: IUniform<number> = { value: 0 }
    /** Grass albedo: the average terrain color under it, so tufts do not stand out as dark spots */
    private grass_ground_uniform: IUniform<Color> = { value: new Color(0.3, 0.32, 0.22) }
    private ground_average = new Map<Texture, Color>()
    /** Leaves and cherry petals painted onto the terrain */
    private fallen_leaf_maps: [Texture, Texture]
    private litter_map_uniform: IUniform<Texture>
    private litter_amount_uniform: IUniform<number> = { value: 0 }
    private litter_tint_uniform: IUniform<number> = { value: 1 }
    private litter_colors: IUniform<Color[]> = { value: [new Color(0x7a5a32), new Color(0x8a7a3a), new Color(0x6f7a3a)] }
    private grounds: Record<GroundType, PbrSet>

    constructor(assets: AssetLibrary, anisotropy: number) {
        this.puddle_map = ProceduralTextures.tileableNoise(256, 4, 5, 3131)
        const puddle_uniform: IUniform<Texture> = { value: this.puddle_map }
        this.grounds = { grass: assets.grass, sand: assets.sand, snow: assets.snow }

        // Asphalt: 4x4 m texture, UVs are given in meters / 4
        this.road = new MeshStandardMaterial({
            map: assets.asphalt.map,
            normalMap: assets.asphalt.normal,
            normalScale: new Vector2(0.9, 0.9),
            roughnessMap: assets.asphalt.roughness,
            roughness: 1,
            metalness: 0,
            envMapIntensity: 1.0,
        })
        this.road.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms): void => {
            ShaderPatches.wetRoad(shader, {
                uPuddleMap: puddle_uniform,
                uTime: this.time_uniform,
                uWetness: this.wetness_uniform,
                uRain: this.rain_uniform,
                uSnow: this.road_snow_uniform,
            })
        }
        this.road.customProgramCacheKey = (): string => 'wet-road'

        this.markings = new MeshStandardMaterial({
            map: ProceduralTextures.roadMarkings(anisotropy),
            color: new Color(0xbcb9b0),
            roughness: 0.35,
            metalness: 0,
            alphaTest: 0.5,
            polygonOffset: true,
            polygonOffsetFactor: -2,
            polygonOffsetUnits: -2,
        })

        this.rail = new MeshStandardMaterial({
            map: ProceduralTextures.galvanized(anisotropy),
            color: new Color(0x9aa2a7),
            metalness: 0.85,
            roughness: 0.32,
            side: DoubleSide,
        })

        this.post = new MeshStandardMaterial({
            vertexColors: true,
            metalness: 0.1,
            roughness: 0.5,
        })

        // Concrete: 4x4 m texture, UVs are given in meters / 4
        const concrete_maps: { map: Texture, normal: Texture, roughness: Texture } = ProceduralTextures.concrete(anisotropy)
        this.concrete = new MeshStandardMaterial({
            map: concrete_maps.map,
            normalMap: concrete_maps.normal,
            roughnessMap: concrete_maps.roughness,
            color: new Color(0xb4b0a8),
            roughness: 1,
            metalness: 0,
        })

        // Ground: 5x5 m texture, the map set changes with the terrain
        this.terrain = new MeshStandardMaterial({
            map: assets.grass.map,
            normalMap: assets.grass.normal,
            roughnessMap: assets.grass.roughness,
            roughness: 0.9,
            metalness: 0,
            color: new Color(0x9aa08a),
        })
        this.fallen_leaf_maps = [ProceduralTextures.fallenLeaves(false, anisotropy), ProceduralTextures.fallenLeaves(true, anisotropy)]
        this.litter_map_uniform = { value: this.fallen_leaf_maps[0] }
        this.terrain.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms): void => {
            ShaderPatches.terrain(shader, {
                uPuddleMap: puddle_uniform,
                uDirtColor: this.dirt_uniform,
                uShoulderRoughness: this.shoulder_roughness_uniform,
                uLitterMap: this.litter_map_uniform,
                uLitterColors: this.litter_colors,
                uLitterAmount: this.litter_amount_uniform,
                uLitterTint: this.litter_tint_uniform,
            })
        }
        this.terrain.customProgramCacheKey = (): string => 'terrain'

        const snow_uniforms: Record<string, IUniform> = { uSnow: this.snow_uniform, uPuddleMap: puddle_uniform }

        this.bark = new MeshStandardMaterial({
            map: assets.bark.map,
            normalMap: assets.bark.normal,
            roughnessMap: assets.bark.roughness,
            color: new Color(0x8a8078),
            roughness: 1,
            metalness: 0,
        })
        this.bark.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms): void => {
            ShaderPatches.snowCover(shader, snow_uniforms)
            ShaderPatches.distanceFade(shader, this.tree_fade)
        }
        this.bark.customProgramCacheKey = (): string => 'bark'

        this.fir_foliage = this.createFoliage(ProceduralTextures.firBranch(anisotropy), 0x8c9a7e, 0.0055, 'fir', this.tree_fade, null)
        this.leaf_foliage = this.createFoliage(ProceduralTextures.leafCluster(anisotropy), 0x93a07c, 0.009, 'leaf', this.tree_fade, {
            uRecolor: this.leaf_recolor_uniform,
            uRecolorColor: this.leaf_recolor_color_uniform,
            uRecolorAlt: this.leaf_recolor_alt_uniform,
            uRecolorSoft: this.leaf_soft_uniform,
        })
        this.grass = this.createFoliage(ProceduralTextures.grassBlades(anisotropy), 0xffffff, 0.18, 'grass', this.grass_fade, null, this.grass_ground_uniform)
        this.dry_bush = this.createFoliage(ProceduralTextures.dryBush(anisotropy), 0xa89878, 0.012, 'dry-bush', this.fern_fade, null)


        const fern_source: MeshStandardMaterial = WorldMaterials.findFirstMaterial(assets)
        this.fern = new MeshStandardMaterial({
            map: fern_source.map,
            normalMap: fern_source.normalMap,
            roughnessMap: fern_source.roughnessMap,
            alphaMap: assets.fern_alpha,
            alphaTest: 0.5,
            side: DoubleSide,
            roughness: 0.85,
            metalness: 0,
            color: new Color(0x9aa58a),
        })
        this.fern.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms): void => {
            ShaderPatches.foliage(shader, { uTime: this.time_uniform }, 0.06)
            ShaderPatches.matte(shader, 0.1)
            ShaderPatches.distanceFade(shader, this.fern_fade)
        }
        this.fern.customProgramCacheKey = (): string => 'fern'

        // Boulders: rock texture at the model's world scale, snow settles on top
        this.rock = new MeshStandardMaterial({
            map: assets.rock.map,
            normalMap: assets.rock.normal,
            roughnessMap: assets.rock.roughness,
            color: new Color(0xa09a92),
            roughness: 1,
            metalness: 0,
        })
        this.rock.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms): void => {
            ShaderPatches.snowCover(shader, snow_uniforms)
            ShaderPatches.distanceFade(shader, this.tree_fade)
        }
        this.rock.customProgramCacheKey = (): string => 'rock'

        // Cactus: ribs come from geometry, the waxy skin from roughness
        this.cactus = new MeshStandardMaterial({
            color: new Color(0x4d6a3a),
            roughness: 0.62,
            metalness: 0,
        })
        this.cactus.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms): void => {
            ShaderPatches.snowCover(shader, snow_uniforms)
            ShaderPatches.distanceFade(shader, this.tree_fade)
        }
        this.cactus.customProgramCacheKey = (): string => 'cactus'
    }

    private createFoliage(map: Texture, color: number, sway: number, key: string, fade: IUniform<Vector2>, recolor: Record<string, IUniform> | null, ground: IUniform<Color> | null = null): MeshStandardMaterial {
        const material: MeshStandardMaterial = new MeshStandardMaterial({
            map: map,
            color: new Color(color),
            alphaTest: 0.42,
            side: DoubleSide,
            roughness: 0.82,
            metalness: 0,
            envMapIntensity: 0.6,
        })
        material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms): void => {
            ShaderPatches.foliage(shader, { uTime: this.time_uniform }, sway)
            // Grass lit like the ground keeps the ground's own sheen: otherwise it reads darker than the soil around it
            if (!ground) ShaderPatches.matte(shader, 0.1)
            if (recolor) ShaderPatches.recolor(shader, recolor)
            if (ground) ShaderPatches.groundMatch(shader, { uGroundColor: ground, uGroundNoise: { value: this.puddle_map } })
            ShaderPatches.snowCover(shader, { uSnow: this.snow_uniform, uPuddleMap: { value: this.puddle_map } })
            ShaderPatches.distanceFade(shader, fade)
        }
        if (ground) {
            // Terrain roughness 0.9 times its roughness map (~0.68 on average)
            material.roughness = 0.62
            material.envMapIntensity = 1
        }
        material.customProgramCacheKey = (): string => `foliage-${key}`
        return material
    }

    private static findFirstMaterial(assets: AssetLibrary): MeshStandardMaterial {
        const holder: { material: MeshStandardMaterial | null } = { material: null }
        assets.fern.scene.traverse((object: Object3D): void => {
            const mesh: Mesh = object as Mesh
            if (!holder.material && mesh.isMesh) holder.material = mesh.material as MeshStandardMaterial
        })
        return holder.material as MeshStandardMaterial
    }

    /** Wet road surfaces reflect the sky rather than the scene's shared environment */
    setRoadEnvironment(environment: Texture): void {
        this.road.envMap = environment
        this.road.needsUpdate = true
    }

    /**
     * Weather and terrain: asphalt wetness, snow, ground textures and color, foliage tints.
     * Only uniforms and textures change, so shaders are not recompiled.
     */
    setLook(look: EnvironmentLook): void {
        this.wetness_uniform.value = look.wetness
        // Dry rough asphalt barely reflects the sky, otherwise at sunset the whole road takes on the sky color
        this.road.envMapIntensity = 0.3 + look.wetness * 0.8
        this.rain_uniform.value = look.raining ? 1 : 0
        this.road_snow_uniform.value = look.snow
        this.snow_uniform.value = look.snow * 0.8
        this.dirt_uniform.value.copy(look.snow > 0 ? new Color(0.3, 0.31, 0.33) : look.dirt)
        this.shoulder_roughness_uniform.value = 0.85 - look.wetness * 0.53

        const ground: PbrSet = this.grounds[look.ground]
        this.terrain.map = ground.map
        this.terrain.normalMap = ground.normal
        this.terrain.roughnessMap = ground.roughness
        this.terrain.color.copy(look.ground_tint)

        this.fir_foliage.color.copy(look.fir_tint)
        this.leaf_foliage.color.copy(look.leaf_tint)
        this.leaf_recolor_uniform.value = look.leaf_recolor
        this.leaf_recolor_color_uniform.value.copy(look.leaf_tint)
        this.leaf_recolor_alt_uniform.value.copy(look.leaf_tint_alt)
        this.leaf_soft_uniform.value = look.leaf_soft
        this.leaf_foliage.emissive.copy(look.leaf_tint).multiplyScalar(look.leaf_glow)
        for (let i: number = 0; i < 3; i++) this.litter_colors.value[i].copy(look.leaf_palette[i % look.leaf_palette.length])
        // Fallen leaves are painted onto the terrain itself, so they always lie flush; snow and sand have none
        this.litter_map_uniform.value = this.fallen_leaf_maps[look.leaf_size < 1 ? 1 : 0]
        this.litter_amount_uniform.value = look.ground === 'grass' ? look.litter : 0
        // Wet leaves go darker
        this.litter_tint_uniform.value = 1 - look.wetness * 0.3
        // Grass takes the terrain's own color, so tufts never stand out from the ground
        this.grass_ground_uniform.value.copy(this.averageColor(ground.map)).multiply(look.ground_tint)
    }

    /** Average linear albedo of a loaded texture, measured once on a small canvas */
    private averageColor(texture: Texture): Color {
        const cached: Color | undefined = this.ground_average.get(texture)
        if (cached) return cached.clone()
        const color: Color = new Color(0.3, 0.3, 0.25)
        const image: CanvasImageSource | undefined = texture.image as CanvasImageSource | undefined
        const canvas: HTMLCanvasElement = document.createElement('canvas')
        canvas.width = 32
        canvas.height = 32
        const ctx: CanvasRenderingContext2D | null = canvas.getContext('2d', { willReadFrequently: true })
        if (image && ctx) {
            ctx.drawImage(image, 0, 0, 32, 32)
            const data: Uint8ClampedArray = ctx.getImageData(0, 0, 32, 32).data
            const sum: number[] = [0, 0, 0]
            const pixel: Color = new Color()
            for (let i: number = 0; i < data.length; i += 4) {
                pixel.setRGB(data[i] / 255, data[i + 1] / 255, data[i + 2] / 255, SRGBColorSpace)
                sum[0] += pixel.r
                sum[1] += pixel.g
                sum[2] += pixel.b
            }
            const count: number = data.length / 4
            color.setRGB(sum[0] / count, sum[1] / count, sum[2] / count)
        }
        this.ground_average.set(texture, color)
        return color.clone()
    }

    update(time: number): void {
        this.time_uniform.value = time
    }

    all(): Material[] {
        return [
            this.road, this.markings, this.rail, this.post, this.concrete, this.terrain, this.bark, this.fir_foliage,
            this.leaf_foliage, this.grass, this.fern, this.rock, this.cactus, this.dry_bush,
        ]
    }
}
