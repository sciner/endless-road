import { CanvasTexture, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace } from 'three'
import { MathUtils } from '../core/MathUtils'

const TEXTURE_WIDTH: number = 128
const TEXTURE_HEIGHT: number = 256
/** Opacity on the ground and airborne */
const GROUND_OPACITY: number = 0.82
const AIR_OPACITY: number = 0.12

/**
 * Contact shadow under the floor: sky and environment light cast no shadows,
 * so without it the car "floats" above the road, especially in overcast weather
 */
export class CarContactShadow {
    readonly mesh: Mesh
    private material: MeshBasicMaterial
    private opacity: number = GROUND_OPACITY

    /** wheels are the tire contact points in car space, [x, z]: spots go exactly under them */
    constructor(width: number, length: number, wheels: number[][]) {
        this.material = new MeshBasicMaterial({
            color: 0x000000,
            map: CarContactShadow.createTexture(width, length, wheels),
            transparent: true,
            opacity: GROUND_OPACITY,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: -2,
            polygonOffsetUnits: -4,
        })
        // Plane is wider than the body: the soft edge extends past the footprint
        const geometry: PlaneGeometry = new PlaneGeometry(width * 1.35, length * 1.2)
        geometry.rotateX(-Math.PI / 2)
        this.mesh = new Mesh(geometry, this.material)
        this.mesh.name = 'car-contact-shadow'
        // Just above the asphalt: higher up, the plane covers the bottom of the tires and they look sunk into the road
        this.mesh.position.y = 0.004
        this.mesh.renderOrder = 1
        this.mesh.castShadow = false
        this.mesh.receiveShadow = false
    }

    /** Shadow fades while airborne: the ground is far from the floor */
    update(grounded: boolean, dt: number): void {
        this.opacity = MathUtils.damp(this.opacity, grounded ? GROUND_OPACITY : AIR_OPACITY, 10, dt)
        this.material.opacity = this.opacity
    }

    /**
     * Soft rounded rectangle built from a distance field:
     * densest under the center and wheels, smoothly fading toward the edges
     */
    private static createTexture(width: number, length: number, wheels: number[][]): CanvasTexture {
        const canvas: HTMLCanvasElement = document.createElement('canvas')
        canvas.width = TEXTURE_WIDTH
        canvas.height = TEXTURE_HEIGHT
        const context: CanvasRenderingContext2D = canvas.getContext('2d') as CanvasRenderingContext2D
        const image: ImageData = context.createImageData(TEXTURE_WIDTH, TEXTURE_HEIGHT)

        // Sizes in meters: plane is width·1.35 × length·1.2, body is width × length
        const plane_half_x: number = width * 1.35 * 0.5
        const plane_half_z: number = length * 1.2 * 0.5
        const box_half_x: number = width * 0.42
        const box_half_z: number = length * 0.44
        const corner: number = width * 0.3
        const softness: number = width * 0.28
        // Wheels are often not symmetric about the body center (a rear-engined car has its axles shifted forward)
        const spots: number[][] = wheels.length > 0 ? wheels : [[-1, -1], [-1, 1], [1, -1], [1, 1]].map((sign: number[]): number[] => [sign[0] * width * 0.4, sign[1] * length * 0.31])

        for (let py: number = 0; py < TEXTURE_HEIGHT; py++) {
            for (let px: number = 0; px < TEXTURE_WIDTH; px++) {
                const x: number = ((px + 0.5) / TEXTURE_WIDTH * 2 - 1) * plane_half_x
                const z: number = ((py + 0.5) / TEXTURE_HEIGHT * 2 - 1) * plane_half_z
                // Signed distance to the rounded rectangle
                const qx: number = Math.abs(x) - (box_half_x - corner)
                const qz: number = Math.abs(z) - (box_half_z - corner)
                const outside: number = Math.hypot(Math.max(qx, 0), Math.max(qz, 0))
                const distance: number = outside + Math.min(Math.max(qx, qz), 0) - corner
                let alpha: number = 1 - MathUtils.smoothstep(-softness, softness, distance)
                alpha = alpha * alpha * 0.75
                // Spots under the wheels, where the floor is closest to the ground
                let wheel: number = 0
                for (let w: number = 0; w < spots.length; w++) {
                    const d: number = Math.hypot(x - spots[w][0], (z - spots[w][1]) * 0.7)
                    wheel = Math.max(wheel, 1 - MathUtils.smoothstep(0, width * 0.32, d))
                }
                alpha = Math.min(1, alpha + wheel * 0.45)

                const index: number = (py * TEXTURE_WIDTH + px) * 4
                image.data[index + 3] = Math.round(alpha * 255)
            }
        }
        context.putImageData(image, 0, 0)
        const texture: CanvasTexture = new CanvasTexture(canvas)
        texture.colorSpace = SRGBColorSpace
        return texture
    }
}
