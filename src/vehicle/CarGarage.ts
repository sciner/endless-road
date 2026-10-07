import { Camera, Material, Mesh, Object3D, Scene, Texture, WebGLRenderer, WebGLRenderTarget } from 'three'
import { GLTF } from 'three/addons/loaders/GLTFLoader.js'
import { AssetLibrary } from '../render/AssetLibrary'
import { Car } from './Car'
import { CAR_IDS, CAR_PROFILES, CarId, CarProfile } from './CarProfiles'

/** Current render state the cars are prepared for */
export interface GarageSetup {
    current: () => Car
    headlight_shadows: () => boolean
    target: () => WebGLRenderTarget | null
}

/**
 * Keeps every car built once: the model is loaded, assembled and its shaders compiled
 * a single time, after that a swap is just putting another ready object into the scene
 */
export class CarGarage {
    private renderer: WebGLRenderer
    private scene: Scene
    private camera: Camera
    private cars: Map<CarId, Car> = new Map()
    /** Builds in progress, so the background preload and a player's choice share one load */
    private pending: Map<CarId, Promise<Car>> = new Map()
    /** The car in the scene and the current headlight shadow setting: shaders are compiled for that light setup */
    private current: () => Car
    private headlight_shadows: () => boolean
    /** Render target of the scene pass; null draws straight to the screen */
    private target: () => WebGLRenderTarget | null

    constructor(renderer: WebGLRenderer, scene: Scene, camera: Camera, setup: GarageSetup) {
        this.renderer = renderer
        this.scene = scene
        this.camera = camera
        this.current = setup.current
        this.headlight_shadows = setup.headlight_shadows
        this.target = setup.target
    }

    /** Registers a car built elsewhere (the one from the initial loading) */
    add(car: Car): void {
        this.cars.set(car.profile.id, car)
    }

    /** Cars that are already built, in any state */
    all(): Car[] {
        return [...this.cars.values()]
    }

    /** Resolves immediately for a built car, otherwise waits for its single build */
    get(id: CarId): Promise<Car> {
        const ready: Car | undefined = this.cars.get(id)
        if (ready) return Promise.resolve(ready)
        let build: Promise<Car> | undefined = this.pending.get(id)
        if (!build) {
            build = this.build(CAR_PROFILES[id])
            this.pending.set(id, build)
            const clear: () => void = (): void => {
                this.pending.delete(id)
            }
            build.then(clear, clear)
        }
        return build
    }

    /** Builds the remaining cars in the background, one by one so the frame rate is not hit all at once */
    async preloadAll(): Promise<void> {
        for (let i: number = 0; i < CAR_IDS.length; i++) {
            try {
                await this.get(CAR_IDS[i])
            } catch (error: unknown) {
                console.error(error)
            }
        }
    }

    /**
     * Shader programs depend on the number of lights. The compiler counts the lights of both the scene
     * and the new car, so the car in the scene is hidden for the synchronous part of the compile:
     * then the light setup matches the one after the swap and the programs are reused as is
     */
    private async build(profile: CarProfile): Promise<Car> {
        const gltf: GLTF = await AssetLibrary.loadCar(profile.look.model_path)
        const car: Car = new Car(gltf, profile)
        car.model.setHeadlightShadows(this.headlight_shadows())
        const active: Car = this.current()
        const visible: boolean = active.model.root.visible
        const previous_target: WebGLRenderTarget | null = this.renderer.getRenderTarget()
        active.model.root.visible = false
        // Tone mapping and output color space are part of the program, so compile for the buffer the scene goes into
        this.renderer.setRenderTarget(this.target())
        let compiled: Promise<unknown>
        try {
            compiled = this.renderer.compileAsync(car.model.root, this.camera, this.scene)
        } finally {
            this.renderer.setRenderTarget(previous_target)
            active.model.root.visible = visible
        }
        await compiled
        this.uploadTextures(car.model.root)
        this.cars.set(profile.id, car)
        return car
    }

    /** Textures go to the GPU now instead of on the first frame the car is drawn */
    private uploadTextures(root: Object3D): void {
        const textures: Set<Texture> = new Set()
        root.traverse((object: Object3D): void => {
            const mesh: Mesh = object as Mesh
            if (!mesh.isMesh) return
            const materials: Material[] = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
            for (let i: number = 0; i < materials.length; i++) {
                const values: unknown[] = Object.values(materials[i])
                for (let j: number = 0; j < values.length; j++) {
                    if (values[j] instanceof Texture) textures.add(values[j] as Texture)
                }
            }
        })
        textures.forEach((texture: Texture): void => this.renderer.initTexture(texture))
    }
}
