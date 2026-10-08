import {
    ACESFilmicToneMapping, PCFShadowMap, PMREMGenerator, Scene, SRGBColorSpace, Texture, Vector3, WebGLRenderer,
    WebGLRenderTarget,
} from 'three'
import { Input, DriveInput } from './core/Input'
import { SessionData, SessionState } from './core/SessionState'
import { Settings } from './core/Settings'
import { EnvironmentSystem } from './environment/EnvironmentSystem'
import {
    Biome, BIOMES, EnvironmentNames, EnvironmentSettings, TimeOfDay, TIMES, Weather, WEATHERS,
} from './environment/EnvironmentTypes'
import { Lang, lang, LANGUAGE_NAMES, LanguageCode, LANGUAGES } from './i18n/Lang'
import { AssetLibrary } from './render/AssetLibrary'
import { CameraRig } from './render/CameraRig'
import { FreeCamera } from './render/FreeCamera'
import { Lighting } from './render/Lighting'
import { PostProcessing } from './render/PostProcessing'
import { Precipitation } from './render/Precipitation'
import { SkyDome } from './render/SkyDome'
import { TireSpray } from './render/TireSpray'
import { AudioSystem } from './audio/AudioSystem'
import { Hud } from './ui/Hud'
import { DebugOverlay, DebugSnapshot } from './ui/DebugOverlay'
import { MainMenu, MenuOption } from './ui/MainMenu'
import { QUALITY_CHOICES, QualityChoice, QualityLevel, QualityPreset, QualityPresets } from './render/QualityPresets'
import { Car } from './vehicle/Car'
import { CarGarage } from './vehicle/CarGarage'
import { CAR_IDS, CAR_PROFILES, CarId, CarProfile } from './vehicle/CarProfiles'
import { CarWheel } from './vehicle/CarModel'
import { LeafLitter } from './world/LeafLitter'
import { World } from './world/World'
import { RAIL_OFFSET, ROAD_GENERATE_AHEAD, WORLD_SEED } from './world/WorldConfig'
import { RoadNetwork } from './world/RoadNetwork'
import { RoadProjection } from './world/RoadTypes'

const PHYSICS_STEP: number = 1 / 120
const MAX_SUBSTEPS: number = 8
/** How often the position is saved while the game runs, s: a crash or a killed tab loses at most this much */
const SESSION_SAVE_INTERVAL: number = 5
/** Road regrowth from a save runs in slices this long between yields to the browser, ms */
const REGROW_SLICE_MS: number = 50

function qualityName(choice: QualityChoice): string {
    const names: Record<QualityChoice, string> = {
        auto: lang.quality_auto, low: lang.quality_low, medium: lang.quality_medium, high: lang.quality_high,
    }
    return names[choice]
}

/**
 * menu is the title menu before the start, paused is the menu over a drive in progress,
 * free is the F10 pause with a free-flying camera: the whole world stays frozen as it was
 */
type GameState = 'menu' | 'playing' | 'paused' | 'free'

/**
 * The whole game: renderer, scene, world, car, effects and the game loop
 */
export class Game {
    private root: HTMLElement
    private renderer: WebGLRenderer
    private scene: Scene = new Scene()
    /** Precipitation and spray are drawn separately, after bloom */
    private particles: Scene = new Scene()
    private input: Input = new Input()
    private settings: Settings = new Settings()
    /** The last drive: the world is rebuilt from its seed and the car returns to where it was */
    private session: SessionData | null = SessionState.load()
    private seed: number = this.session ? this.session.seed : WORLD_SEED
    /** Set once the world and the car are in place, before that there is nothing to save */
    private ready: boolean = false
    private last_save: number = 0
    private hud: Hud
    private debug: DebugOverlay
    private menu: MainMenu
    private state: GameState = 'menu'
    private audio: AudioSystem = new AudioSystem()
    private camera_rig: CameraRig
    private free_camera: FreeCamera
    /** Where F10 returns to from the free camera */
    private free_return: GameState = 'playing'
    private post!: PostProcessing
    private world!: World
    private car!: Car
    private precipitation: Precipitation = new Precipitation()
    private spray: TireSpray = new TireSpray()
    private leaves: LeafLitter = new LeafLitter()
    private sky!: SkyDome
    private lighting!: Lighting
    private environment!: EnvironmentSystem
    private time: number = 0
    private last_frame: number = 0
    private accumulator: number = 0
    private last_impact: number = 0
    private odometer: number = 0
    private last_position: Vector3 = new Vector3()
    private pixel_ratio: number = 1
    private quality: QualityPreset
    /** Set while a new car model is loading, so repeated menu presses don't start parallel loads */
    private car_loading: boolean = false
    private garage: CarGarage

    constructor(root: HTMLElement) {
        this.root = root
        // The language is applied before any UI is built
        Lang.set(this.settings.language)
        this.renderer = new WebGLRenderer({ antialias: false, powerPreference: 'high-performance' })
        this.quality = QualityPresets.preset(QualityPresets.resolve(this.settings.quality, this.renderer))
        this.pixel_ratio = Math.min(window.devicePixelRatio, this.quality.pixel_ratio)
        this.renderer.setPixelRatio(this.pixel_ratio)
        this.renderer.setSize(window.innerWidth, window.innerHeight)
        this.renderer.outputColorSpace = SRGBColorSpace
        this.renderer.toneMapping = ACESFilmicToneMapping
        this.renderer.toneMappingExposure = 1.15
        this.renderer.shadowMap.enabled = true
        this.renderer.shadowMap.type = PCFShadowMap
        this.renderer.domElement.classList.add('game-canvas')
        root.appendChild(this.renderer.domElement)

        // Render stats are reset manually once per frame, otherwise every post-processing pass clears them
        this.renderer.info.autoReset = false

        this.hud = new Hud(root)
        this.debug = new DebugOverlay(root, this.renderer)
        this.camera_rig = new CameraRig(window.innerWidth / window.innerHeight)
        this.free_camera = new FreeCamera(this.camera_rig.camera)
        this.garage = new CarGarage(this.renderer, this.scene, this.camera_rig.camera, {
            current: (): Car => this.car,
            headlight_shadows: (): boolean => this.quality.headlight_shadows,
            target: (): WebGLRenderTarget | null => this.post?.scene_target ?? null,
        })
        this.camera_rig.setMode(this.settings.camera_mode)
        this.hud.setHelpVisible(this.settings.help_visible)
        this.debug.setVisible(this.settings.debug_visible)
        this.audio.setMuted(this.settings.muted)
        this.menu = new MainMenu(root, {
            main: [this.carOption()],
            settings: this.menuOptions(),
            environment: this.environmentOptions(),
            on_play: (): void => this.play(),
            on_randomize: (): void => this.randomizeEnvironment(),
        })
        window.addEventListener('resize', (): void => this.resize())
        // The browser releases the mouse on Esc; a click takes it back
        this.renderer.domElement.addEventListener('click', (): void => {
            if (this.state === 'free') this.lockPointer()
        })
        window.addEventListener('blur', (): void => {
            if (this.state === 'playing') this.pause()
        })
        // pagehide covers closing and reloading; a hidden tab may be killed later without any event
        window.addEventListener('pagehide', (): void => this.saveSession())
        document.addEventListener('visibilitychange', (): void => {
            if (document.visibilityState === 'hidden') this.saveSession()
        })
        this.input.onAnyKey((): void => {
            if (!this.audio.started) this.audio.start()
        })
        this.input.onGamepadConnection((name: string, connected: boolean): void => {
            const short_name: string = name.replace(/\s*\(.*$/, '')
            this.hud.showToast(connected ? Lang.format(lang.gamepad_connected, { name: short_name }) : lang.gamepad_disconnected)
            if (connected) this.input.rumble(0.4, 0.6, 180)
        })
    }

    /** Settings available in the menu; every change is applied and saved immediately */
    private menuOptions(): MenuOption[] {
        const on_off: (value: boolean) => string = (value: boolean): string => value ? lang.on : lang.off
        const camera_names: () => string[] = (): string[] => [lang.camera_chase, lang.camera_far, lang.camera_hood]
        return [
            {
                label: (): string => lang.option_language,
                value: (): string => LANGUAGE_NAMES[Lang.code],
                change: (direction: number): void => {
                    const index: number = LANGUAGES.indexOf(Lang.code)
                    this.setLanguage(LANGUAGES[(index + direction + LANGUAGES.length) % LANGUAGES.length])
                },
            },
            {
                label: (): string => lang.option_quality,
                value: (): string => qualityName(this.settings.quality),
                change: (direction: number): void => {
                    const index: number = QUALITY_CHOICES.indexOf(this.settings.quality)
                    const count: number = QUALITY_CHOICES.length
                    this.setQuality(QUALITY_CHOICES[(index + direction + count) % count])
                },
            },
            {
                label: (): string => lang.option_sound,
                value: (): string => on_off(!this.audio.is_muted),
                change: (): void => this.toggleMute(),
            },
            {
                label: (): string => lang.option_camera,
                value: (): string => camera_names()[this.camera_rig.mode_index],
                change: (direction: number): void => {
                    this.camera_rig.setMode(this.camera_rig.mode_index + direction)
                    this.settings.update({ camera_mode: this.camera_rig.mode_index })
                },
            },
            {
                label: (): string => lang.option_help,
                value: (): string => on_off(this.hud.help_visible),
                change: (): void => this.toggleHelp(),
            },
            {
                label: (): string => lang.option_debug,
                value: (): string => on_off(this.debug.is_visible),
                change: (): void => this.toggleDebug(),
            },
        ]
    }

    /** Manual environment setup: each axis cycles around */
    private environmentOptions(): MenuOption[] {
        const cycle: <T>(list: T[], value: T, direction: number) => T = <T>(list: T[], value: T, direction: number): T =>
            list[(list.indexOf(value) + direction + list.length) % list.length]
        return [
            {
                label: (): string => lang.option_time,
                value: (): string => EnvironmentNames.time(this.environment.current.time),
                change: (direction: number): void => {
                    const time: TimeOfDay = cycle(TIMES, this.environment.current.time, direction)
                    this.changeEnvironment({ ...this.environment.current, time: time })
                },
            },
            {
                label: (): string => lang.option_weather,
                value: (): string => EnvironmentNames.weather(this.environment.current.weather),
                change: (direction: number): void => {
                    const weather: Weather = cycle(WEATHERS, this.environment.current.weather, direction)
                    this.changeEnvironment({ ...this.environment.current, weather: weather })
                },
            },
            {
                label: (): string => lang.option_biome,
                value: (): string => EnvironmentNames.biome(this.environment.current.biome),
                change: (direction: number): void => {
                    const biome: Biome = cycle(BIOMES, this.environment.current.biome, direction)
                    this.changeEnvironment({ ...this.environment.current, biome: biome })
                },
            },
        ]
    }

    /** Car choice on the main menu screen */
    private carOption(): MenuOption {
        return {
            label: (): string => lang.option_car,
            value: (): string => CAR_PROFILES[this.settings.car].name,
            change: (direction: number): void => {
                const index: number = CAR_IDS.indexOf(this.settings.car)
                const id: CarId = CAR_IDS[(index + direction + CAR_IDS.length) % CAR_IDS.length]
                // During loading only the choice changes; the load picks it up when it finishes
                if (this.car_loading) {
                    this.settings.update({ car: id })
                    this.menu.applyLanguage()
                    return
                }
                void this.swapCar(id)
            },
        }
    }

    /**
     * Replaces the car with another one at the same place on the road. A car from the garage
     * is swapped in the same frame; only a car that is not built yet makes the player wait.
     * The choice is saved right away so the menu shows it while the model loads
     */
    private async swapCar(id: CarId): Promise<void> {
        this.settings.update({ car: id })
        this.menu.applyLanguage()
        this.car_loading = true
        try {
            const car: Car = await this.garage.get(id)
            // The player could switch again during loading: only the last choice is kept
            if (this.settings.car !== id) return
            this.mountCar(car)
        } catch (error: unknown) {
            // A failed load leaves the current car and its choice in place
            console.error(error)
            this.settings.update({ car: this.car.profile.id })
            this.menu.applyLanguage()
        } finally {
            this.car_loading = false
        }
        // The player switched again during loading: catch up with the latest choice
        if (this.settings.car !== this.car.profile.id) void this.swapCar(this.settings.car)
    }

    /** Puts a ready car into the scene in place of the current one; the old one stays in the garage */
    private mountCar(car: Car): void {
        const old_car: Car = this.car
        if (old_car === car) return
        car.placeOnRoad(this.world.surface, old_car.position.x, old_car.position.z)
        car.model.setHeadlightShadows(this.quality.headlight_shadows)
        this.scene.remove(old_car.model.root)
        this.scene.add(car.model.root)
        this.car = car
        this.environment.setCar(car)
        this.camera_rig.setCockpit(car.profile.look.cockpit)
        this.last_position.copy(car.position)
        this.camera_rig.snap()
    }

    /** Applies a quality preset live: resolution, shadows, bloom and anti-aliasing */
    private setQuality(choice: QualityChoice): void {
        this.settings.update({ quality: choice })
        const level: QualityLevel = QualityPresets.resolve(choice, this.renderer)
        this.quality = QualityPresets.preset(level)
        this.applyQuality()
        this.menu.applyLanguage()
    }

    private applyQuality(): void {
        this.pixel_ratio = Math.min(window.devicePixelRatio, this.quality.pixel_ratio)
        this.renderer.setPixelRatio(this.pixel_ratio)
        this.lighting.setShadowQuality(this.quality.shadow_map, this.quality.shadow_extent)
        const cars: Car[] = this.garage.all()
        for (let i: number = 0; i < cars.length; i++) cars[i].model.setHeadlightShadows(this.quality.headlight_shadows)
        if (this.post) this.post.setQuality(this.quality.bloom, this.quality.msaa)
        this.resize()
    }

    /** Switches the UI language on the fly and remembers the choice */
    private setLanguage(code: LanguageCode): void {
        Lang.set(code)
        this.settings.update({ language: code })
        this.hud.applyLanguage()
        this.menu.applyLanguage()
    }

    private changeEnvironment(settings: EnvironmentSettings): void {
        this.environment.change(settings)
        this.settings.update({ environment: settings })
    }

    /** Random environment with a notice showing what was picked */
    private randomizeEnvironment(): void {
        const settings: EnvironmentSettings = EnvironmentSystem.random(this.environment.current)
        this.changeEnvironment(settings)
        this.hud.showToast(EnvironmentNames.describe(settings))
    }

    /** Starts a drive from the title menu or resumes after a pause */
    private play(): void {
        if (this.state === 'menu') this.camera_rig.beginTransition(this.car.physics)
        this.state = 'playing'
        this.menu.hide()
        this.hud.setVisible(true)
    }

    private pause(): void {
        this.state = 'paused'
        this.saveSession()
        this.hud.setVisible(false)
        this.menu.show(true)
    }

    /** F10: the game stops without the menu and the camera is free to fly anywhere */
    private enterFreeCamera(): void {
        this.free_return = this.state
        this.state = 'free'
        this.saveSession()
        this.menu.hide()
        this.hud.setVisible(false)
        // Movement gathered before the switch must not jerk the camera
        this.input.takeMouse()
        this.input.takeWheel()
        this.free_camera.enter()
        this.lockPointer()
        this.hud.showToast(lang.free_camera_hint, 6000)
    }

    /** F10 again: back to the car exactly where the camera rig left it */
    private exitFreeCamera(): void {
        if (document.pointerLockElement) document.exitPointerLock()
        if (this.free_return === 'playing') {
            this.state = 'playing'
            this.hud.setVisible(true)
        } else {
            this.state = this.free_return
            this.menu.show(this.free_return === 'paused')
        }
    }

    private lockPointer(): void {
        const canvas: HTMLCanvasElement = this.renderer.domElement
        if (document.pointerLockElement === canvas) return
        // Newer browsers return a promise that rejects without a user gesture; a click then locks it
        const result: unknown = canvas.requestPointerLock()
        if (result instanceof Promise) result.catch((): void => undefined)
    }

    private toggleMute(): void {
        this.audio.toggleMute()
        this.settings.update({ muted: this.audio.is_muted })
    }

    private toggleHelp(): void {
        this.hud.toggleHelp()
        this.settings.update({ help_visible: this.hud.help_visible })
    }

    private toggleDebug(): void {
        this.debug.toggle()
        this.settings.update({ debug_visible: this.debug.is_visible })
    }

    async start(): Promise<void> {
        const anisotropy: number = this.renderer.capabilities.getMaxAnisotropy()
        const assets: AssetLibrary = new AssetLibrary(anisotropy, (ratio: number): void => {
            this.hud.setLoading(ratio * 0.6, lang.loading_assets)
        })
        const profile: CarProfile = CAR_PROFILES[this.settings.car]
        await assets.load(profile.look.model_path)

        this.setupScene(assets)
        this.world = new World(this.scene, assets, anisotropy, this.seed)
        this.car = new Car(assets.car, profile)
        this.garage.add(this.car)
        this.camera_rig.setCockpit(profile.look.cockpit)
        this.scene.add(this.car.model.root)
        this.particles.add(this.precipitation.mesh)
        this.particles.add(this.spray.points)
        this.scene.add(this.leaves.mesh)
        // The environment is applied before world generation so vegetation grows for the chosen terrain right away
        this.environment = new EnvironmentSystem(this.root, {
            renderer: this.renderer,
            scene: this.scene,
            sky: this.sky,
            lighting: this.lighting,
            materials: this.world.materials,
            vegetation: this.world.vegetation,
            precipitation: this.precipitation,
            spray: this.spray,
            leaves: this.leaves,
            audio: this.audio,
            car: this.car,
            post: (): PostProcessing | null => this.post ?? null,
            center: (): Vector3 => this.car.position,
        }, this.settings.environment)

        const session: SessionData | null = this.session
        const start: Vector3 = session ? new Vector3(session.x, 0, session.z) : new Vector3(0, 0, 0)
        if (session) await this.regrowRoad(session)
        await this.world.preload(start, (ratio: number): void => {
            this.hud.setLoading(0.6 + ratio * 0.35, lang.loading_world)
        })
        if (!session || !this.restorePosition(session)) this.car.placeOnRoad(this.world.surface, 0, 0)
        this.last_position.copy(this.car.position)
        this.camera_rig.showcase(0, this.car.physics, this.world.surface)

        this.post = new PostProcessing(this.renderer, this.scene, this.particles, this.camera_rig.camera)
        this.environment.syncPost()
        this.applyQuality()

        this.hud.setLoading(0.97, lang.loading_shaders)
        // Compiled for the HDR buffer both scenes are drawn into, otherwise these are screen variants that never get used
        this.renderer.setRenderTarget(this.post.scene_target)
        const scene_ready: Promise<unknown> = this.renderer.compileAsync(this.scene, this.camera_rig.camera)
        const particles_ready: Promise<unknown> = this.renderer.compileAsync(this.particles, this.camera_rig.camera)
        this.renderer.setRenderTarget(null)
        await Promise.all([scene_ready, particles_ready])
        this.hud.setLoading(1, '')
        this.hud.hideLoading()
        this.menu.show(false)

        this.last_frame = performance.now()
        this.ready = true
        this.saveSession()
        this.renderer.setAnimationLoop((): void => this.frame())
        // The other cars are built while the player looks at the menu, so the first swap is already instant
        void this.garage.preloadAll()
    }

    /**
     * The road grows from the start in both directions, and each new piece avoids the ones already built,
     * so it is regrown in the usual order (start, then forward, then back) up to the lengths it had
     */
    private async regrowRoad(session: SessionData): Promise<void> {
        const road: RoadNetwork = this.world.road
        const wait: () => Promise<void> = (): Promise<void> => new Promise((resolve: () => void): void => {
            setTimeout(resolve, 0)
        })
        this.hud.setLoading(0.6, lang.loading_world)
        road.ensureAround(0, ROAD_GENERATE_AHEAD, 10000)
        // A point just short of the far end makes ensureAround extend only that end, one control point per call.
        // The browser delays each setTimeout by at least 4 ms (a second in a background tab), so it yields
        // only once per time slice: yielding per point made tens of kilometers take many seconds
        let slice_end: number = performance.now() + REGROW_SLICE_MS
        while (road.front_distance < session.road_front) {
            road.ensureAround(road.front_distance - ROAD_GENERATE_AHEAD + 1, ROAD_GENERATE_AHEAD, 1)
            if (performance.now() > slice_end) {
                await wait()
                slice_end = performance.now() + REGROW_SLICE_MS
            }
        }
        while (road.back_distance > session.road_back) {
            road.ensureAround(road.back_distance + ROAD_GENERATE_AHEAD - 1, ROAD_GENERATE_AHEAD, 1)
            if (performance.now() > slice_end) {
                await wait()
                slice_end = performance.now() + REGROW_SLICE_MS
            }
        }
    }

    /**
     * Puts the car back where it was. If the road came out a little different (the generator changed),
     * the car is set on the nearest road instead; false when there is no road nearby at all
     */
    private restorePosition(session: SessionData): boolean {
        const projection: RoadProjection | null = this.world.road.project(session.x, session.z, 400)
        if (!projection) return false
        if (Math.abs(projection.lateral) <= RAIL_OFFSET + 2) {
            const position: Vector3 = new Vector3(session.x, this.world.surface.drive(session.x, session.z).height, session.z)
            this.car.physics.place(position, session.yaw)
            this.car.render(0, 1)
        } else {
            this.car.placeOnRoad(this.world.surface, session.x, session.z)
        }
        this.car.physics.along = projection.along
        this.odometer = session.odometer
        return true
    }

    private saveSession(): void {
        if (!this.ready) return
        this.last_save = this.time
        const position: Vector3 = this.car.position
        SessionState.save({
            seed: this.seed,
            x: position.x,
            z: position.z,
            yaw: this.car.physics.yaw,
            along: this.car.physics.along,
            road_front: this.world.road.front_distance,
            road_back: this.world.road.back_distance,
            odometer: this.odometer,
        })
    }

    /** Sky, lights and HDRI environment; EnvironmentSystem sets their colors and intensity */
    private setupScene(assets: AssetLibrary): void {
        this.sky = new SkyDome()
        this.scene.add(this.sky.mesh)

        // Reflection environment: a forest HDRI whose intensity follows the time of day
        const pmrem: PMREMGenerator = new PMREMGenerator(this.renderer)
        const environment: Texture = pmrem.fromEquirectangular(assets.environment).texture
        assets.environment.dispose()
        pmrem.dispose()
        this.scene.environment = environment

        this.lighting = new Lighting(this.scene)
    }

    private resize(): void {
        const width: number = window.innerWidth
        const height: number = window.innerHeight
        this.renderer.setSize(width, height)
        this.camera_rig.camera.aspect = width / height
        this.camera_rig.camera.updateProjectionMatrix()
        if (this.post) this.post.setSize(width, height, this.pixel_ratio)
        this.spray.setViewportHeight(height * this.pixel_ratio)
    }

    private frame(): void {
        const now: number = performance.now()
        const dt: number = Math.min((now - this.last_frame) / 1000, 0.1)
        this.last_frame = now
        this.input.poll()
        this.handleKeys()
        // In the free camera time stops for the whole world: wind, rain, leaves and streaming stay as they were
        const free: boolean = this.state === 'free'
        if (!free) this.time += dt
        const playing: boolean = this.state === 'playing'
        const drive: DriveInput = this.input.drive()

        // Fixed-step physics is frame-rate independent; in the menu the world lives on while the car stands still
        let steps: number = 0
        if (playing) {
            this.accumulator += dt
            while (this.accumulator >= PHYSICS_STEP && steps < MAX_SUBSTEPS) {
                this.car.update(PHYSICS_STEP, drive, this.world.surface, this.world.vegetation)
                this.accumulator -= PHYSICS_STEP
                steps++
            }
            if (steps === MAX_SUBSTEPS) this.accumulator = 0
            // An impact rises in a jump and decays smoothly: rumble only on the rise
            const impact: number = this.car.physics.impact
            const hit: number = impact - this.last_impact
            if (hit > 0.04) this.input.rumble(hit * 1.6, hit * 2.2, 120 + hit * 260)
            this.last_impact = impact
        }
        // While paused the car's time stops: wheels don't spin, suspension freezes
        this.car.render(playing ? dt : 0, this.accumulator / PHYSICS_STEP)

        const position: Vector3 = this.car.position
        this.odometer += Math.hypot(position.x - this.last_position.x, position.z - this.last_position.z)
        this.last_position.copy(position)

        if (!free) this.world.update(position, this.car.physics.along, this.time)
        if (free) this.free_camera.update(dt, this.input)
        else if (playing) this.camera_rig.update(dt, this.car.physics, this.world.surface)
        else this.camera_rig.showcase(dt, this.car.physics, this.world.surface)
        // After the camera has moved: chunks outside the view leave the instance buffers
        this.world.vegetation.cull(this.camera_rig.camera)
        this.lighting.follow(position, this.car.physics.yaw)
        this.sky.update(this.camera_rig.camera.position, this.time)
        if (!free) this.updateEffects(dt, playing)

        if (playing && this.time - this.last_save > SESSION_SAVE_INTERVAL) this.saveSession()

        this.hud.update(this.car.physics.speed, this.car.physics.gear, this.car.physics.rpm, this.odometer)
        // In the menu the engine idles and the tires are silent
        const firing: number = this.car.physics.spec.firing_per_rev
        if (playing) this.audio.update(this.car.physics.rpm, drive.throttle, this.car.physics.speed, this.car.physics.slip, firing)
        else this.audio.update(this.car.physics.spec.idle_rpm, 0, 0, 0, firing)

        // The panel reads the full stats of the previous frame (shadows + scene + post-processing), then they are reset
        this.debug.update(dt, (): DebugSnapshot => ({
            car: this.car.physics,
            world: this.world.stats(),
            seed: this.seed,
            camera_mode: this.camera_rig.mode_index,
            physics_steps: steps,
            pixel_ratio: this.pixel_ratio,
        }))
        this.renderer.info.reset()
        this.post.render(dt, this.time)
        this.input.endFrame()
    }

    private handleKeys(): void {
        if (this.input.wasPressed('F3')) this.toggleDebug()
        if (this.input.wasPressed('F10')) {
            if (this.state === 'free') this.exitFreeCamera()
            else this.enterFreeCamera()
            return
        }
        // In the free camera the keys only fly it
        if (this.state === 'free') return

        // While the menu is open, input belongs to it
        if (this.menu.is_open) {
            const keys: string[] = this.input.pressedKeys()
            for (let i: number = 0; i < keys.length; i++) this.menu.handleKey(keys[i])
            return
        }

        if (this.input.wasAnyPressed('Escape', 'GamepadStart')) {
            this.pause()
            return
        }
        if (this.input.wasAnyPressed('KeyC', 'GamepadY')) {
            this.camera_rig.nextMode()
            this.settings.update({ camera_mode: this.camera_rig.mode_index })
        }
        if (this.input.wasAnyPressed('KeyE', 'GamepadX')) this.randomizeEnvironment()
        if (this.input.wasAnyPressed('KeyH', 'GamepadBack')) this.toggleHelp()
        if (this.input.wasPressed('KeyM')) this.toggleMute()
        if (this.input.wasAnyPressed('KeyR', 'GamepadB')) {
            this.car.placeOnRoad(this.world.surface, this.car.position.x, this.car.position.z)
            this.camera_rig.snap()
        }
    }

    private updateEffects(dt: number, playing: boolean): void {
        const root: Vector3 = this.car.model.root.position
        const yaw: number = this.car.physics.yaw
        const forward: Vector3 = new Vector3(Math.sin(yaw), 0, Math.cos(yaw))
        const head: Vector3 = root.clone().addScaledVector(forward, 2).setY(root.y + 0.7)
        // While paused the car is frozen but keeps its velocity: without zeroing it snowflakes would stretch into dashes
        const relative: Vector3 = playing ? this.car.physics.velocity : new Vector3()
        this.precipitation.setPixelScale(this.camera_rig.camera.fov, window.innerHeight * this.pixel_ratio)
        this.precipitation.update(this.time, this.camera_rig.camera.position, relative, head, forward)

        // Spray is emitted at the contact patches of the rear wheels
        const emitters: Vector3[] = []
        const wheels: CarWheel[] = this.car.model.wheels
        for (let i: number = 0; i < wheels.length; i++) {
            if (wheels[i].front) continue
            const p: Vector3 = new Vector3()
            wheels[i].steer.getWorldPosition(p)
            p.y -= wheels[i].radius * 0.85
            p.addScaledVector(forward, -wheels[i].radius * 0.9)
            emitters.push(p)
        }
        if (emitters.length === 0) emitters.push(root.clone())
        const tail: Vector3 = root.clone().addScaledVector(forward, -2.4).setY(root.y + 0.7)
        // While paused the car is frozen, so no new spray is born and the old one settles
        const speed: number = playing ? this.car.physics.speed : 0
        const slip: number = playing ? this.car.physics.slip : 0
        const back: Vector3 = forward.clone().negate()
        this.spray.update(dt, emitters, this.car.physics.velocity, speed, this.car.physics.on_road, slip, tail, back, this.car.model.tail_glow)
        // Fallen leaves fly up from under the car; in bad weather the wind carries more of them
        this.leaves.update(dt, this.world.surface, this.car.position, yaw, this.car.physics.velocity, speed, this.camera_rig.camera.position)
    }
}
