import { WebGLRenderer } from 'three'

export type QualityLevel = 'low' | 'medium' | 'high'
/** Player choice: a fixed level or auto, which picks a level for the detected GPU */
export type QualityChoice = QualityLevel | 'auto'

export const QUALITY_CHOICES: QualityChoice[] = ['auto', 'low', 'medium', 'high']

/** Rendering cost knobs, from the most expensive to the cheapest to change */
export interface QualityPreset {
    /** Upper limit of the device pixel ratio; below 1 renders under native resolution */
    pixel_ratio: number
    /** Sun shadow map resolution and half size of its area, m */
    shadow_map: number
    shadow_extent: number
    /** The headlight shadow is one more full scene pass */
    headlight_shadows: boolean
    bloom: boolean
    /** MSAA samples of the HDR render target */
    msaa: number
}

const PRESETS: Record<QualityLevel, QualityPreset> = {
    low: { pixel_ratio: 0.75, shadow_map: 1024, shadow_extent: 28, headlight_shadows: false, bloom: false, msaa: 0 },
    medium: { pixel_ratio: 1, shadow_map: 2048, shadow_extent: 34, headlight_shadows: false, bloom: true, msaa: 2 },
    high: { pixel_ratio: 1.5, shadow_map: 3072, shadow_extent: 38, headlight_shadows: true, bloom: true, msaa: 4 },
}

/** Integrated and software GPUs that cannot afford the high preset */
const WEAK_GPU: RegExp = /intel|uhd|iris|radeon\(tm\) graphics|radeon graphics|vega \d+ graphics|mali|adreno|powervr|apple gpu|swiftshader|llvmpipe|basic render/i

/** Quality presets and the GPU-based guess for the auto choice */
export class QualityPresets {
    static preset(level: QualityLevel): QualityPreset {
        return PRESETS[level]
    }

    static resolve(choice: QualityChoice, renderer: WebGLRenderer): QualityLevel {
        return choice === 'auto' ? QualityPresets.detect(renderer) : choice
    }

    static isChoice(value: unknown): value is QualityChoice {
        return typeof value === 'string' && QUALITY_CHOICES.includes(value as QualityChoice)
    }

    /** Integrated laptop graphics get medium, phones and software rendering get low, discrete GPUs get high */
    private static detect(renderer: WebGLRenderer): QualityLevel {
        const gl: WebGL2RenderingContext | WebGLRenderingContext = renderer.getContext()
        const extension: WEBGL_debug_renderer_info | null = gl.getExtension('WEBGL_debug_renderer_info')
        const name: string = String(extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER))
        if (/mali|adreno|powervr|swiftshader|llvmpipe|basic render/i.test(name)) return 'low'
        if (WEAK_GPU.test(name)) return 'medium'
        return 'high'
    }
}
