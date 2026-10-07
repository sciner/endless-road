import { Color, DirectionalLight, HemisphereLight, Scene, Vector3 } from 'three'
import { EnvironmentLook } from '../environment/EnvironmentLook'
import { SHADOW_LAYER } from '../world/Vegetation'

/** Distance from the focus point to the directional light, m */
const SUN_DISTANCE: number = 90
const UP: Vector3 = new Vector3(0, 1, 0)
/** Forward offset of the shadow center: the camera looks ahead, and shadows behind the car are barely visible */
const SHADOW_LEAD: number = 12

/**
 * Lighting: ambient sky light and a directional sun or moon light
 * with shadows; the shadow area follows the car
 */
export class Lighting {
    readonly hemisphere: HemisphereLight
    readonly sun: DirectionalLight
    private sun_offset: Vector3 = new Vector3(-35, 70, 30)
    private focus: Vector3 = new Vector3()
    private light_dir: Vector3 = new Vector3()
    private light_u: Vector3 = new Vector3()
    private light_v: Vector3 = new Vector3()
    /** Shadow area half size, m, and map resolution; set by the quality preset */
    private shadow_extent: number = 38
    private shadow_map_size: number = 3072

    constructor(scene: Scene) {
        this.hemisphere = new HemisphereLight(new Color(0x5674a8), new Color(0x0c110c), 0.6)
        scene.add(this.hemisphere)

        this.sun = new DirectionalLight(new Color(0x9fb6ff), 0.55)
        this.sun.castShadow = true
        this.setShadowQuality(this.shadow_map_size, this.shadow_extent)
        this.sun.shadow.camera.near = 1
        this.sun.shadow.camera.far = 220
        this.sun.shadow.bias = -0.0004
        this.sun.shadow.normalBias = 0.025
        this.sun.shadow.radius = 2.5
        this.sun.shadow.camera.layers.enable(SHADOW_LAYER)
        scene.add(this.sun)
        scene.add(this.sun.target)
    }

    /** Resolution and area of the sun shadow; the old map is released and recreated on the next render */
    setShadowQuality(map_size: number, extent: number): void {
        this.shadow_map_size = map_size
        this.shadow_extent = extent
        const shadow: DirectionalLight['shadow'] = this.sun.shadow
        shadow.mapSize.set(map_size, map_size)
        shadow.camera.left = -extent
        shadow.camera.right = extent
        shadow.camera.top = extent
        shadow.camera.bottom = -extent
        shadow.camera.updateProjectionMatrix()
        if (shadow.map) {
            shadow.map.dispose()
            shadow.map = null
        }
    }

    setLook(look: EnvironmentLook): void {
        this.hemisphere.color.copy(look.hemi_sky)
        this.hemisphere.groundColor.copy(look.hemi_ground)
        this.hemisphere.intensity = look.hemi_intensity
        this.sun.color.copy(look.sun_color)
        this.sun.intensity = look.sun_intensity
        // Keep a low sun above ~10°, otherwise shadows become infinitely long
        const direction: Vector3 = look.sun_direction.clone()
        direction.y = Math.max(direction.y, 0.18)
        this.sun_offset.copy(direction.normalize()).multiplyScalar(SUN_DISTANCE)
    }

    /**
     * Moves the shadow camera with the car. The center snaps to the texel grid
     * in the plane perpendicular to the light rays: this is what keeps shadows from shimmering in motion
     */
    follow(center: Vector3, yaw: number): void {
        this.focus.set(center.x + Math.sin(yaw) * SHADOW_LEAD, center.y, center.z + Math.cos(yaw) * SHADOW_LEAD)

        // Light basis: dir points to the light, u and v are the shadow map axes
        this.light_dir.copy(this.sun_offset).normalize()
        this.light_u.crossVectors(this.light_dir, UP)
        if (this.light_u.lengthSq() < 1e-6) this.light_u.set(1, 0, 0)
        this.light_u.normalize()
        this.light_v.crossVectors(this.light_u, this.light_dir).normalize()

        const texel: number = this.shadow_extent * 2 / this.shadow_map_size
        const u: number = Math.round(this.focus.dot(this.light_u) / texel) * texel
        const v: number = Math.round(this.focus.dot(this.light_v) / texel) * texel
        const d: number = this.focus.dot(this.light_dir)
        this.focus.copy(this.light_u).multiplyScalar(u)
            .addScaledVector(this.light_v, v)
            .addScaledVector(this.light_dir, d)

        this.sun.target.position.copy(this.focus)
        this.sun.position.copy(this.focus).add(this.sun_offset)
    }
}
