import { Camera, Scene, WebGLRenderer, WebGLRenderTarget } from 'three'
import { Pass } from 'three/addons/postprocessing/Pass.js'

/**
 * Draws a separate scene on top of the finished frame into the same buffer without clearing it.
 * The main scene's depth is preserved, so overlay objects are correctly occluded by the car and trees.
 * Runs after bloom: otherwise small bright particles (raindrops, snowflakes) turn into sparkles.
 */
export class OverlayPass extends Pass {
    private scene: Scene
    private camera: Camera

    constructor(scene: Scene, camera: Camera) {
        super()
        this.scene = scene
        this.camera = camera
        this.needsSwap = false
    }

    render(renderer: WebGLRenderer, _write_buffer: WebGLRenderTarget, read_buffer: WebGLRenderTarget): void {
        const auto_clear: boolean = renderer.autoClear
        renderer.autoClear = false
        renderer.setRenderTarget(this.renderToScreen ? null : read_buffer)
        renderer.render(this.scene, this.camera)
        renderer.autoClear = auto_clear
    }
}
