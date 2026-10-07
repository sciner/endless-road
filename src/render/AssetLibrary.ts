import { DataTexture, EquirectangularReflectionMapping, LoadingManager, RepeatWrapping, SRGBColorSpace, Texture, TextureLoader } from 'three'
import { GLTF, GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js'

/** Set of PBR maps for one material */
export interface PbrSet {
    map: Texture
    normal: Texture
    roughness: Texture
}

/**
 * Loads all external game assets and reports loading progress
 */
export class AssetLibrary {
    car!: GLTF
    fern!: GLTF
    fern_alpha!: Texture
    asphalt!: PbrSet
    grass!: PbrSet
    sand!: PbrSet
    snow!: PbrSet
    rock!: PbrSet
    bark!: PbrSet
    environment!: DataTexture

    private manager: LoadingManager
    private anisotropy: number

    constructor(anisotropy: number, on_progress: (ratio: number) => void) {
        this.anisotropy = anisotropy
        this.manager = new LoadingManager()
        this.manager.onProgress = (_url: string, loaded: number, total: number): void => {
            on_progress(total > 0 ? loaded / total : 0)
        }
    }

    /** Loads a car model on its own: used to swap cars after the initial loading */
    static loadCar(model_path: string): Promise<GLTF> {
        return new GLTFLoader().loadAsync(model_path)
    }

    async load(car_path: string): Promise<void> {
        const gltf_loader: GLTFLoader = new GLTFLoader(this.manager)
        const texture_loader: TextureLoader = new TextureLoader(this.manager)
        const hdr_loader: HDRLoader = new HDRLoader(this.manager)

        const pbr: (name: string) => Promise<PbrSet> = async (name: string): Promise<PbrSet> => {
            const [map, normal, roughness] = await Promise.all([
                texture_loader.loadAsync(`textures/${name}_diffuse.jpg`),
                texture_loader.loadAsync(`textures/${name}_nor_gl.jpg`),
                texture_loader.loadAsync(`textures/${name}_rough.jpg`),
            ])
            map.colorSpace = SRGBColorSpace
            const textures: Texture[] = [map, normal, roughness]
            for (let i: number = 0; i < textures.length; i++) {
                textures[i].wrapS = RepeatWrapping
                textures[i].wrapT = RepeatWrapping
                textures[i].anisotropy = this.anisotropy
            }
            return { map: map, normal: normal, roughness: roughness }
        }

        const [car, fern, fern_alpha, asphalt, grass, sand, snow, rock, bark, environment] = await Promise.all([
            gltf_loader.loadAsync(car_path),
            gltf_loader.loadAsync('models/fern_02/fern_02.gltf'),
            texture_loader.loadAsync('models/fern_02/textures/fern_02_alpha_1k.jpg'),
            pbr('asphalt_02'),
            pbr('leafy_grass'),
            pbr('aerial_sand'),
            pbr('snow_02'),
            pbr('rock_boulder_dry'),
            pbr('pine_bark'),
            hdr_loader.loadAsync('textures/dark_autumn_forest_1k.hdr'),
        ])

        // glTF textures are not flipped in Y; the alpha mask must match them
        fern_alpha.flipY = false
        environment.mapping = EquirectangularReflectionMapping

        this.car = car
        this.fern = fern
        this.fern_alpha = fern_alpha
        this.asphalt = asphalt
        this.grass = grass
        this.sand = sand
        this.snow = snow
        this.rock = rock
        this.bark = bark
        this.environment = environment
    }
}
