import { FogExp2, PMREMGenerator, Scene, Texture, Vector3, WebGLRenderer } from 'three'
import { MathUtils } from '../core/MathUtils'
import { AudioSystem } from '../audio/AudioSystem'
import { Lighting } from '../render/Lighting'
import { PostProcessing } from '../render/PostProcessing'
import { Precipitation } from '../render/Precipitation'
import { SkyDome } from '../render/SkyDome'
import { TireSpray } from '../render/TireSpray'
import { WorldMaterials } from '../render/WorldMaterials'
import { Car } from '../vehicle/Car'
import { Vegetation } from '../world/Vegetation'
import { EnvironmentLook, EnvironmentLookBuilder } from './EnvironmentLook'
import { Biome, BIOMES, EnvironmentSettings, TimeOfDay, TIMES, Weather } from './EnvironmentTypes'

/** Everything the environment affects */
export interface EnvironmentTargets {
    renderer: WebGLRenderer
    scene: Scene
    sky: SkyDome
    lighting: Lighting
    materials: WorldMaterials
    vegetation: Vegetation
    precipitation: Precipitation
    spray: TireSpray
    audio: AudioSystem
    car: Car
    /** Post-processing is created later than the other systems */
    post: () => PostProcessing | null
    /** Point around which vegetation is regenerated */
    center: () => Vector3
}

/** Fade-to-black duration on environment change, ms */
const FADE_MS: number = 380
/** Pause on the black screen after applying, so a frame with the new shaders gets rendered */
const FADE_HOLD_MS: number = 90
/** Brightness of the lower sky hemisphere in the asphalt reflection map */
const REFLECTION_BELOW: number = 0.05

/** Weather probabilities: the desert is mostly clear, the forest gets any weather */
const WEATHER_WEIGHTS: Record<Biome, Array<[Weather, number]>> = {
    forest: [['clear', 0.3], ['rain', 0.3], ['snow', 0.2], ['fog', 0.2]],
    autumn: [['clear', 0.3], ['rain', 0.35], ['snow', 0.1], ['fog', 0.25]],
    desert: [['clear', 0.6], ['rain', 0.15], ['snow', 0.07], ['fog', 0.18]],
}

/**
 * Current environment (time of day, weather, terrain) and its application to all systems:
 * sky, lighting, fog, materials, precipitation, audio, vegetation and car grip
 */
export class EnvironmentSystem {
    private targets: EnvironmentTargets
    private settings: EnvironmentSettings
    private look: EnvironmentLook
    private fog: FogExp2
    private pmrem: PMREMGenerator
    private reflection_sky: SkyDome = new SkyDome(REFLECTION_BELOW)
    private reflection_scene: Scene = new Scene()
    private road_environment: Texture | null = null
    private overlay: HTMLDivElement
    private pending: EnvironmentSettings | null = null

    constructor(root: HTMLElement, targets: EnvironmentTargets, settings: EnvironmentSettings) {
        this.targets = targets
        this.settings = { ...settings }
        this.look = EnvironmentLookBuilder.build(this.settings)
        this.fog = new FogExp2(0x000000, 0.01)
        targets.scene.fog = this.fog
        this.pmrem = new PMREMGenerator(targets.renderer)
        this.reflection_scene.add(this.reflection_sky.mesh)
        this.overlay = document.createElement('div')
        this.overlay.className = 'env-fade'
        root.appendChild(this.overlay)
        this.apply(this.settings)
    }

    /** Selected environment, including one still being applied behind the fade */
    get current(): EnvironmentSettings {
        return { ...(this.pending ?? this.settings) }
    }

    get current_look(): EnvironmentLook {
        return this.look
    }

    /**
     * Smooth transition via a fade to black. Repeated calls during the fade
     * just replace the target; the last environment wins.
     */
    change(settings: EnvironmentSettings): void {
        const fading: boolean = this.pending !== null
        this.pending = { ...settings }
        if (fading) return
        this.overlay.classList.add('env-fade-active')
        window.setTimeout((): void => {
            if (this.pending) this.apply(this.pending)
            window.setTimeout((): void => {
                this.pending = null
                this.overlay.classList.remove('env-fade-active')
            }, FADE_HOLD_MS)
        }, FADE_MS)
    }

    /** Instantly applies the environment to all systems */
    apply(settings: EnvironmentSettings): void {
        const t: EnvironmentTargets = this.targets
        this.settings = { ...settings }
        const look: EnvironmentLook = EnvironmentLookBuilder.build(this.settings)
        this.look = look

        t.renderer.toneMappingExposure = look.exposure
        this.fog.color.copy(look.horizon)
        this.fog.density = look.fog_density
        t.scene.environmentIntensity = look.environment_intensity
        t.sky.setLook(look)
        t.lighting.setLook(look)
        t.materials.setLook(look)
        this.updateReflections(look)

        // Snow must not glow in the dark: snowflake brightness follows the overall lighting
        const brightness: number = MathUtils.clamp(look.hemi_intensity * 0.75, 0.35, 1)
        t.precipitation.configure(look.precipitation, look.precipitation_alpha, brightness, look.headlights)
        t.spray.configure(look.spray_color, look.spray_amount, look.spray_off_road)
        t.audio.setAmbience(look.rain_sound, look.wind_sound, look.wet_tires)
        t.car.model.setHeadlightLevel(look.headlights)
        t.car.physics.surface_grip = look.grip
        const post: PostProcessing | null = t.post()
        if (post) post.setLook(look.bloom, look.shadow_tint)

        // Changing terrain or snow changes the vegetation mix: regenerate it right away while the screen is dark
        if (t.vegetation.setEnvironment(this.settings.biome, look.snow > 0) && t.vegetation.isReady()) {
            t.vegetation.update(t.center(), Infinity)
        }
    }

    /** Rebuilds the sky reflection map for wet asphalt to match the new sky */
    private updateReflections(look: EnvironmentLook): void {
        this.reflection_sky.setLook(look)
        const texture: Texture = this.pmrem.fromScene(this.reflection_scene, 0, 0.1, 4000).texture
        this.targets.materials.setRoadEnvironment(texture)
        if (this.road_environment) this.road_environment.dispose()
        this.road_environment = texture
    }

    /** A replaced car gets the current headlight level and weather grip */
    setCar(car: Car): void {
        this.targets.car = car
        car.model.setHeadlightLevel(this.look.headlights)
        car.physics.surface_grip = this.look.grip
    }

    /** Applies post-processing if it appeared after the first apply */
    syncPost(): void {
        const post: PostProcessing | null = this.targets.post()
        if (post) post.setLook(this.look.bloom, this.look.shadow_tint)
    }

    /** Random plausible environment that differs noticeably from the current one */
    static random(current: EnvironmentSettings): EnvironmentSettings {
        let candidate: EnvironmentSettings = current
        for (let attempt: number = 0; attempt < 32; attempt++) {
            const biome: Biome = BIOMES[Math.floor(Math.random() * BIOMES.length)]
            const time: TimeOfDay = TIMES[Math.floor(Math.random() * TIMES.length)]
            const weather: Weather = EnvironmentSystem.weighted(WEATHER_WEIGHTS[biome])
            candidate = { time: time, weather: weather, biome: biome }
            // At least two of the three axes must change, otherwise the switch is barely noticeable
            const changes: number = Number(time !== current.time) + Number(weather !== current.weather) + Number(biome !== current.biome)
            if (changes >= 2) return candidate
        }
        return candidate
    }

    private static weighted<T>(options: Array<[T, number]>): T {
        const total: number = options.reduce((sum: number, option: [T, number]): number => sum + option[1], 0)
        let roll: number = Math.random() * total
        for (let i: number = 0; i < options.length; i++) {
            roll -= options[i][1]
            if (roll <= 0) return options[i][0]
        }
        return options[options.length - 1][0]
    }
}
