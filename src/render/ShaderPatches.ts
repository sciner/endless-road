import { IUniform, ShaderChunk, Vector2, WebGLProgramParametersWithUniforms } from 'three'

/**
 * World-space texture coordinates are taken relative to an origin snapped to this grid around the camera.
 * Tens of kilometers from the world origin a float32 varying keeps only millimeters, and its interpolation
 * makes ground patterns crawl as the camera moves. Every world-space frequency below times this period
 * must be a whole number, so a jump of the origin to the next cell leaves all patterns unchanged.
 */
const WORLD_UV_PERIOD: string = '6000.0'

/** World position relative to the snapped origin: only xz is shifted */
const WORLD_UV_ORIGIN_GLSL: string = /* glsl */ `vec3(floor(cameraPosition.x / ${WORLD_UV_PERIOD}) * ${WORLD_UV_PERIOD}, 0.0, floor(cameraPosition.z / ${WORLD_UV_PERIOD}) * ${WORLD_UV_PERIOD})`

/** Shared GLSL hash functions */
const HASH_GLSL: string = /* glsl */ `
float rpHash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}
`

/**
 * Raindrop ripples: sum of expanding rings in grid cells.
 * Returns the surface slope in the XZ plane.
 */
const RIPPLES_GLSL: string = /* glsl */ `
vec2 rpRipples(vec2 uv, float time) {
    vec2 cell = floor(uv);
    vec2 slope = vec2(0.0);
    for (int j = -1; j <= 1; j++) {
        for (int i = -1; i <= 1; i++) {
            vec2 c = cell + vec2(float(i), float(j));
            float h = rpHash12(c);
            vec2 center = c + vec2(rpHash12(c + 7.31), rpHash12(c + 3.17));
            float phase = fract(time * 1.25 + h);
            vec2 d = uv - center;
            float r = length(d);
            float x = r - phase * 0.95;
            float fade = (1.0 - phase) * (1.0 - phase);
            float ring = exp(-x * x * 160.0) * fade;
            slope += (d / max(r, 1e-3)) * sin(x * 42.0) * ring;
        }
    }
    return slope;
}
`

/**
 * Samples a tiling texture without visible repetition: low-frequency world noise
 * assigns each patch its own texture offset, with smooth blending between neighboring offsets.
 * Derivatives come from the original UVs, otherwise mip selection breaks into stripes at offset jumps.
 */
const NO_TILE_GLSL: string = /* glsl */ `
vec4 rpNoTile(sampler2D tex, vec2 uv, vec2 world) {
    float rpK = texture2D(uPuddleMap, world * 0.011).r * 10.0;
    float rpIndex = floor(rpK);
    float rpBlend = smoothstep(0.25, 0.75, fract(rpK));
    vec2 rpDx = dFdx(uv);
    vec2 rpDy = dFdy(uv);
    vec4 rpA = textureGrad(tex, uv + sin(vec2(3.0, 7.0) * rpIndex), rpDx, rpDy);
    vec4 rpB = textureGrad(tex, uv + sin(vec2(3.0, 7.0) * (rpIndex + 1.0)), rpDx, rpDy);
    return mix(rpA, rpB, rpBlend);
}
`

/**
 * Modifications of standard three.js shaders via onBeforeCompile
 */
export class ShaderPatches {
    /** Adds the fragment world position, relative to the snapped origin (see WORLD_UV_PERIOD), to the vRpWorld varying */
    private static injectWorldPosition(shader: WebGLProgramParametersWithUniforms): void {
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\nvarying vec3 vRpWorld;')
            .replace('#include <project_vertex>', `#include <project_vertex>
                #ifdef USE_INSTANCING
                    vRpWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz - ${WORLD_UV_ORIGIN_GLSL};
                #else
                    vRpWorld = (modelMatrix * vec4(transformed, 1.0)).xyz - ${WORLD_UV_ORIGIN_GLSL};
                #endif`)
        shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vRpWorld;')
    }

    /**
     * Weather-aware asphalt: uWetness — darkening and puddles with mirror reflections,
     * uRain — raindrop ripples, uSnow — snow with packed wheel ruts in each lane
     */
    static wetRoad(shader: WebGLProgramParametersWithUniforms, uniforms: Record<string, IUniform>): void {
        Object.assign(shader.uniforms, uniforms)
        ShaderPatches.injectWorldPosition(shader)
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', `#include <common>
                uniform sampler2D uPuddleMap;
                uniform float uTime;
                uniform float uWetness;
                uniform float uRain;
                uniform float uSnow;
                float rpPuddle;
                float rpSnowCover;
                ${HASH_GLSL}
                ${RIPPLES_GLSL}`)
            .replace('#include <map_fragment>', `#include <map_fragment>
                float rpNoise = texture2D(uPuddleMap, vRpWorld.xz * 0.035).r;
                float rpDetail = texture2D(uPuddleMap, vRpWorld.xz * 0.21 + 0.37).r;
                // The drier it is, the higher the threshold: puddles remain only in the deepest spots
                float rpLevel = 0.5 + (1.0 - uWetness) * 0.35;
                rpPuddle = smoothstep(rpLevel, rpLevel + 0.1, rpNoise + (rpDetail - 0.5) * 0.14) * min(uWetness * 2.0, 1.0);

                // Lateral coordinate from road UV (0 — centerline, 4 — edge); wheels pack two ruts in each lane
                float rpLateral = abs(vMapUv.x * 4.0 - 4.0);
                float rpTrack = max(exp(-pow((rpLateral - 1.15) / 0.34, 2.0)), exp(-pow((rpLateral - 2.65) / 0.34, 2.0)));
                // Between ruts and along the shoulder snow lies in solid strips; noise only breaks up their edges
                float rpDrift = 0.58 + smoothstep(3.0, 3.9, rpLateral) * 0.6 + (rpDetail - 0.5) * 0.35 + (rpNoise - 0.5) * 0.5 - rpTrack * 0.9;
                rpSnowCover = smoothstep(0.3, 0.55, rpDrift) * uSnow;

                diffuseColor.rgb *= mix(1.0, mix(0.5, 0.25, rpPuddle), uWetness);
                diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.74, 0.76, 0.8) * (0.9 + rpDetail * 0.2), rpSnowCover);
                rpPuddle *= 1.0 - rpSnowCover;`)
            .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
                // Not lower than ~0.1: a near-mirror GGX peak from a point light turns every ripple into a blinding firefly
                roughnessFactor = mix(roughnessFactor, mix(roughnessFactor * 0.42, 0.1, rpPuddle), uWetness);
                roughnessFactor = mix(roughnessFactor, 0.6, rpSnowCover);`)
            .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
                normal = normalize(mix(normal, nonPerturbedNormal, max(rpPuddle * 0.92, rpSnowCover * 0.7)));
                vec2 rpSlope = rpRipples(vRpWorld.xz * 1.7, uTime) + rpRipples(vRpWorld.xz * 2.3 + 11.0, uTime * 0.87 + 0.5);
                vec3 rpWorldTilt = vec3(rpSlope.x, 0.0, rpSlope.y) * (0.12 + rpPuddle * 0.55) * uRain;
                normal = normalize(normal + (viewMatrix * vec4(rpWorldTilt, 0.0)).xyz);`)
    }

    /**
     * Ground: texture sampling without a visible tile grid, large-scale color variation
     * and a wet dirt shoulder next to the road
     */
    static terrain(shader: WebGLProgramParametersWithUniforms, uniforms: Record<string, IUniform>): void {
        Object.assign(shader.uniforms, uniforms)
        ShaderPatches.injectWorldPosition(shader)
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\nattribute float roadMask;\nvarying float vRoadMask;')
            .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRoadMask = roadMask;')
        // All three maps are read via rpNoTile with identical offsets, so color, relief and gloss stay aligned
        const no_tile: (chunk: string, call: string, sampler: string, uv: string) => string =
            (chunk: string, call: string, sampler: string, uv: string): string => chunk.split(call).join(`rpNoTile( ${sampler}, ${uv}, vRpWorld.xz )`)
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', `#include <common>
                uniform sampler2D uPuddleMap;
                uniform vec3 uDirtColor;
                uniform float uShoulderRoughness;
                uniform sampler2D uLitterMap;
                uniform vec3 uLitterColors[3];
                uniform float uLitterAmount;
                uniform float uLitterTint;
                varying float vRoadMask;
                ${NO_TILE_GLSL}`)
            .replace('#include <roughnessmap_fragment>', `${no_tile(ShaderChunk.roughnessmap_fragment, 'texture2D( roughnessMap, vRoughnessMapUv )', 'roughnessMap', 'vRoughnessMapUv')}
                roughnessFactor = mix(roughnessFactor, uShoulderRoughness, vRoadMask);`)
            .replace('#include <normal_fragment_maps>', no_tile(ShaderChunk.normal_fragment_maps, 'texture2D( normalMap, vNormalMapUv )', 'normalMap', 'vNormalMapUv'))
            .replace('#include <map_fragment>', `${no_tile(ShaderChunk.map_fragment, 'texture2D( map, vMapUv )', 'map', 'vMapUv')}
                float rpMacro = texture2D(uPuddleMap, vRpWorld.xz * 0.0035).r;
                float rpMid = texture2D(uPuddleMap, vRpWorld.xz * 0.03 + 0.5).r;
                diffuseColor.rgb *= mix(0.55, 1.2, rpMacro) * mix(0.8, 1.1, rpMid);
                vec3 rpDirt = uDirtColor * (0.7 + rpMid * 0.6);
                diffuseColor.rgb = mix(diffuseColor.rgb, rpDirt, vRoadMask * 0.9);
                // Fallen leaves: patchy carpet, thicker along the road shoulder where they drift.
                // Two differently rotated layers hide the tiling; a leaf shows when its id is below the density
                if (uLitterAmount > 0.0) {
                    float rpPatch = texture2D(uPuddleMap, vRpWorld.xz * 0.013 + 0.37).r;
                    float rpCover = uLitterAmount * clamp(smoothstep(0.3, 0.7, rpPatch) * 0.85 + vRoadMask * 0.5, 0.0, 0.95);
                    vec2 rpLitterUv = vRpWorld.xz / 3.0;
                    vec4 rpLeafA = texture2D(uLitterMap, rpLitterUv);
                    vec4 rpLeafB = texture2D(uLitterMap, mat2(0.8, -0.6, 0.6, 0.8) * rpLitterUv * 1.31 + 0.5);
                    float rpShowB = smoothstep(0.35, 0.65, rpLeafB.a) * step(rpLeafB.b, rpCover);
                    vec4 rpLeaf = rpShowB > 0.5 ? rpLeafB : rpLeafA;
                    float rpShow = smoothstep(0.35, 0.65, rpLeaf.a) * step(rpLeaf.b, rpCover);
                    vec3 rpLeafColor = rpLeaf.r < 0.4 ? uLitterColors[0] : rpLeaf.r < 0.75 ? uLitterColors[1] : uLitterColors[2];
                    diffuseColor.rgb = mix(diffuseColor.rgb, rpLeafColor * (0.45 + rpLeaf.g * 0.6) * uLitterTint, rpShow);
                }`)
    }

    /**
     * Autumn foliage recolor: hue comes from uRecolorColor with per-instance variation
     * toward uRecolorAlt (yellow in autumn, white in cherry blossom), brightness from the texture,
     * its contrast lowered by uRecolorSoft. uRecolor = 0 keeps the original color.
     */
    static recolor(shader: WebGLProgramParametersWithUniforms, uniforms: Record<string, IUniform>): void {
        Object.assign(shader.uniforms, uniforms)
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\nvarying float vRpHue;')
            .replace('#include <begin_vertex>', `#include <begin_vertex>
                #ifdef USE_INSTANCING
                    vRpHue = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);
                #else
                    vRpHue = 0.5;
                #endif`)
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', `#include <common>
                uniform vec3 uRecolorColor;
                uniform vec3 uRecolorAlt;
                uniform float uRecolorSoft;
                uniform float uRecolor;
                varying float vRpHue;`)
            .replace('#include <color_fragment>', `#include <color_fragment>
                if (uRecolor > 0.0) {
                    float rpLum = dot(sampledDiffuseColor.rgb, vec3(0.299, 0.587, 0.114));
                    rpLum = mix(rpLum, max(rpLum, 0.24), uRecolorSoft);
                    vec3 rpHueColor = mix(uRecolorColor, uRecolorAlt, vRpHue * vRpHue);
                    diffuseColor.rgb = mix(diffuseColor.rgb, rpHueColor * rpLum * 3.2, uRecolor);
                }`)
    }

    /**
     * Snow cover on upward-facing surfaces (tree crowns, rocks, cacti).
     * The normal is taken in world space, including the instance matrix.
     */
    static snowCover(shader: WebGLProgramParametersWithUniforms, uniforms: Record<string, IUniform>): void {
        Object.assign(shader.uniforms, uniforms)
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\nvarying float vRpUp;\nvarying vec2 vRpSnowUv;')
            .replace('#include <begin_vertex>', `#include <begin_vertex>
                #ifdef USE_INSTANCING
                    vRpUp = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal).y;
                    vRpSnowUv = (modelMatrix * instanceMatrix * vec4(transformed, 1.0) - vec4(${WORLD_UV_ORIGIN_GLSL}, 0.0)).xz;
                #else
                    vRpUp = normalize(mat3(modelMatrix) * objectNormal).y;
                    vRpSnowUv = (modelMatrix * vec4(transformed, 1.0) - vec4(${WORLD_UV_ORIGIN_GLSL}, 0.0)).xz;
                #endif`)
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', `#include <common>
                uniform float uSnow;
                uniform sampler2D uPuddleMap;
                varying float vRpUp;
                varying vec2 vRpSnowUv;`)
            .replace('#include <alphamap_fragment>', `#include <alphamap_fragment>
                if (uSnow > 0.0) {
                    float rpFlake = texture2D(uPuddleMap, vRpSnowUv * 0.9).r;
                    float rpCover = smoothstep(0.15, 0.55, vRpUp + (rpFlake - 0.5) * 0.5) * uSnow;
                    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.68, 0.7, 0.75), rpCover);
                }`)
    }

    /**
     * Leaves and grass are not glossy: without this, low sun behind them is mirrored
     * off their upward normals at a grazing angle and whole cards light up and bloom
     */
    static matte(shader: WebGLProgramParametersWithUniforms, specular: number): void {
        shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
                reflectedLight.directSpecular *= ${specular.toFixed(3)};
                reflectedLight.indirectSpecular *= ${specular.toFixed(3)};`)
    }

    /**
     * Grass blends into the ground: its albedo is the terrain color (the blade texture only adds
     * darker roots and lighter tips). Tuft normals are the slope normal (the layer is aligned to
     * the terrain), so a tuft gets the same light as the soil it grows from
     */
    static groundMatch(shader: WebGLProgramParametersWithUniforms, uniforms: Record<string, IUniform>): void {
        Object.assign(shader.uniforms, uniforms)
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', `#include <common>
                varying vec2 vRpGroundXz;`)
            .replace('#include <begin_vertex>', `#include <begin_vertex>
                #ifdef USE_INSTANCING
                    vRpGroundXz = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xz - ${WORLD_UV_ORIGIN_GLSL}.xz;
                #else
                    vRpGroundXz = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xz - ${WORLD_UV_ORIGIN_GLSL}.xz;
                #endif`)
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', `#include <common>
                uniform vec3 uGroundColor;
                uniform sampler2D uGroundNoise;
                varying vec2 vRpGroundXz;`)
            .replace('#include <color_fragment>', `#include <color_fragment>
                // Same large-scale light/dark patches as the terrain shader at the tuft's root
                float rpGroundMacro = texture2D(uGroundNoise, vRpGroundXz * 0.0035).r;
                float rpGroundMid = texture2D(uGroundNoise, vRpGroundXz * 0.03 + 0.5).r;
                float rpBladeLum = sqrt(dot(sampledDiffuseColor.rgb, vec3(0.299, 0.587, 0.114)));
                diffuseColor.rgb = uGroundColor * mix(0.55, 1.2, rpGroundMacro) * mix(0.8, 1.1, rpGroundMid)
                    * mix(0.85, 1.1, smoothstep(0.08, 0.3, rpBladeLum));`)
    }

    /**
     * Foliage: wind sway based on vertex height, and normals not flipped
     * on back faces (otherwise double-sided cards darken from behind)
     */
    static foliage(shader: WebGLProgramParametersWithUniforms, uniforms: Record<string, IUniform>, sway: number): void {
        Object.assign(shader.uniforms, uniforms)
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', `#include <common>
                uniform float uTime;`)
            .replace('#include <begin_vertex>', `#include <begin_vertex>
                #ifdef USE_INSTANCING
                    vec3 rpOrigin = instanceMatrix[3].xyz;
                #else
                    vec3 rpOrigin = vec3(0.0);
                #endif
                float rpPhase = uTime * 1.3 + rpOrigin.x * 0.13 + rpOrigin.z * 0.11;
                float rpBend = max(position.y, 0.0) * ${sway.toFixed(4)};
                transformed.x += sin(rpPhase) * rpBend + sin(rpPhase * 2.7 + position.z) * rpBend * 0.25;
                transformed.z += cos(rpPhase * 0.8) * rpBend * 0.6;`)
        const begin: string = ShaderChunk.normal_fragment_begin.split('normal *= faceDirection;').join('')
        shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', begin)
    }

    /**
     * Distance-based instance fade-in: uFadeRange = (fully visible, fully hidden).
     * Opacity is computed at the instance base point so the whole plant dissolves at once,
     * and is implemented with dithering — no transparency sorting, compatible with alphaTest and MSAA.
     */
    static distanceFade(shader: WebGLProgramParametersWithUniforms, fade_range: IUniform<Vector2>): void {
        shader.uniforms.uFadeRange = fade_range
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', `#include <common>
                uniform vec2 uFadeRange;
                varying float vRpFade;`)
            .replace('#include <project_vertex>', `#include <project_vertex>
                #ifdef USE_INSTANCING
                    vec3 rpBase = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
                #else
                    vec3 rpBase = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
                #endif
                vRpFade = 1.0 - smoothstep(uFadeRange.x, uFadeRange.y, distance(rpBase.xz, cameraPosition.xz));`)
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', `#include <common>
                varying float vRpFade;`)
            .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
                // Interleaved gradient noise: uniform screen-space threshold without a visible grid
                float rpDither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
                if (vRpFade < 0.999 && rpDither >= vRpFade) discard;`)
    }
}
