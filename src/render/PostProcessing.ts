import { Camera, Color, HalfFloatType, Scene, Vector2, WebGLRenderer, WebGLRenderTarget } from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { OverlayPass } from './OverlayPass'

/** Cinematic color grading: cool tint, vignette, chromatic aberration, grain */
const GRADE_SHADER: { uniforms: Record<string, { value: unknown }>, vertexShader: string, fragmentShader: string } = {
    uniforms: {
        tDiffuse: { value: null },
        uTime: { value: 0 },
        uShadowTint: { value: new Color(0.92, 0.99, 1.12) },
    },
    vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform float uTime;
        uniform vec3 uShadowTint;
        varying vec2 vUv;
        void main() {
            vec2 c = vUv - 0.5;
            float edge = dot(c, c);
            vec2 shift = c * edge * 0.004;
            vec3 color;
            color.r = texture2D(tDiffuse, vUv - shift).r;
            color.g = texture2D(tDiffuse, vUv).g;
            color.b = texture2D(tDiffuse, vUv + shift).b;

            float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
            vec3 tinted = color * uShadowTint;
            color = mix(tinted, color, smoothstep(0.0, 0.6, luma));

            float vignette = smoothstep(0.95, 0.2, length(c * vec2(1.0, 0.8)));
            color *= mix(0.45, 1.0, vignette);

            float grain = fract(sin(dot(vUv * (uTime + 1.37), vec2(12.9898, 78.233))) * 43758.5453);
            color *= 1.0 + (grain - 0.5) * 0.06;
            gl_FragColor = vec4(color, 1.0);
        }
    `,
}

/**
 * Post-processing chain: HDR render with MSAA, bloom, color grading, tone mapping
 */
export class PostProcessing {
    private composer: EffectComposer
    private bloom: UnrealBloomPass
    private grade: ShaderPass

    /** particles is the precipitation and spray scene; it is drawn after bloom and does not glow */
    constructor(renderer: WebGLRenderer, scene: Scene, particles: Scene, camera: Camera) {
        const size: Vector2 = renderer.getDrawingBufferSize(new Vector2())
        const target: WebGLRenderTarget = new WebGLRenderTarget(size.x, size.y, { type: HalfFloatType, samples: 4 })
        this.composer = new EffectComposer(renderer, target)
        this.composer.addPass(new RenderPass(scene, camera))
        this.bloom = new UnrealBloomPass(new Vector2(size.x, size.y), 0.55, 0.65, 0.92)
        this.composer.addPass(this.bloom)
        this.composer.addPass(new OverlayPass(particles, camera))
        this.grade = new ShaderPass(GRADE_SHADER)
        this.composer.addPass(this.grade)
        this.composer.addPass(new OutputPass())
    }

    /** HDR buffer the scene is drawn into: shaders compiled for it skip tone mapping, unlike the screen ones */
    get scene_target(): WebGLRenderTarget {
        return this.composer.readBuffer
    }

    /** Bloom on or off and the MSAA sample count; render targets are recreated with the new samples */
    setQuality(bloom: boolean, msaa: number): void {
        this.bloom.enabled = bloom
        const targets: WebGLRenderTarget[] = [this.composer.renderTarget1, this.composer.renderTarget2]
        for (let i: number = 0; i < targets.length; i++) {
            if (targets[i].samples === msaa) continue
            targets[i].samples = msaa
            targets[i].dispose()
        }
    }

    setSize(width: number, height: number, pixel_ratio: number): void {
        this.composer.setPixelRatio(pixel_ratio)
        this.composer.setSize(width, height)
    }

    /** Bloom strength and shadow tint for the environment: cool at night, warm at sunset */
    setLook(bloom: number, shadow_tint: Color): void {
        this.bloom.strength = bloom
        const tint: Color = this.grade.uniforms.uShadowTint.value as Color
        tint.copy(shadow_tint)
    }

    render(dt: number, time: number): void {
        this.grade.uniforms.uTime.value = time % 100
        this.composer.render(dt)
    }
}
