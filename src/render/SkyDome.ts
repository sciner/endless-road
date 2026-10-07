import { BackSide, Color, IUniform, Mesh, ShaderMaterial, SphereGeometry, Vector3 } from 'three'
import { EnvironmentLook } from '../environment/EnvironmentLook'

const VERTEX: string = /* glsl */ `
varying vec3 vDirection;
void main() {
    vDirection = normalize(position);
    vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = clip.xyww;
}
`

const FRAGMENT: string = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uBelow;
uniform vec3 uGlow;
uniform vec3 uCloud;
uniform vec3 uSunDirection;
uniform vec3 uSunDisk;
uniform float uCloudCover;
uniform float uStars;
uniform float uTime;
varying vec3 vDirection;

float skyHash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float skyNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(skyHash(i), skyHash(i + vec2(1.0, 0.0)), u.x), mix(skyHash(i + vec2(0.0, 1.0)), skyHash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float skyFbm(vec2 p) {
    float sum = 0.0;
    float amplitude = 0.5;
    for (int i = 0; i < 5; i++) {
        sum += skyNoise(p) * amplitude;
        p = p * 2.03 + vec2(1.7, 9.2);
        amplitude *= 0.5;
    }
    return sum;
}

void main() {
    vec3 direction = normalize(vDirection);
    float h = direction.y;
    float up = clamp(h, 0.0, 1.0);
    vec3 color = mix(uHorizon, uZenith, pow(up, 0.5));

    // Horizon glow on the side of the sun/moon and a wide halo around it
    vec3 sun_flat = normalize(vec3(uSunDirection.x, 0.0, uSunDirection.z) + 1e-5);
    float glow = pow(max(dot(normalize(vec3(direction.x, 0.0, direction.z) + 1e-5), sun_flat), 0.0), 4.0);
    color += uGlow * glow * pow(1.0 - up, 6.0);
    float sun_dot = max(dot(direction, uSunDirection), 0.0);
    color += uGlow * pow(sun_dot, 12.0) * 0.35;

    // Stars: twinkling random points in direction cells
    if (uStars > 0.0) {
        vec2 star_uv = vec2(atan(direction.z, direction.x) * 180.0, h * 360.0);
        vec2 cell = floor(star_uv);
        float star = skyHash(cell);
        float twinkle = 0.6 + 0.4 * sin(uTime * 3.0 + star * 50.0);
        float size = smoothstep(0.35, 0.0, length(fract(star_uv) - 0.5));
        color += vec3(0.75, 0.82, 1.0) * step(0.996, star) * size * twinkle * uStars * smoothstep(0.05, 0.3, h) * 0.9;
    }

    // Sun or moon disc, occluded by clouds
    float disk = smoothstep(0.9993, 0.9997, sun_dot);
    vec3 disk_color = uSunDisk * disk * 6.0;

    // Stratus clouds: view direction projected onto the sky plane
    vec2 cloud_uv = direction.xz / (h + 0.12) * 0.9 + vec2(uTime * 0.004, uTime * 0.002);
    float cloud = skyFbm(cloud_uv);
    float threshold = mix(0.78, 0.36, uCloudCover);
    float cover = smoothstep(threshold, threshold + 0.3, cloud) * smoothstep(0.0, 0.2, h);
    color += disk_color * (1.0 - cover);
    vec3 cloud_lit = uCloud * (0.7 + cloud * 0.6) + uGlow * pow(sun_dot, 6.0) * 0.4;
    color = mix(color, cloud_lit, cover * 0.88);

    // Below the horizon — fog color so the sky blends into the haze (or ground for the reflection map)
    color = mix(uBelow, color, smoothstep(-0.02, 0.06, h));
    gl_FragColor = vec4(color, 1.0);
}
`

/**
 * Sky dome with clouds, sun/moon and stars; the horizon matches the fog color.
 * If below is set, the lower hemisphere is filled with it — this makes the dome usable
 * for generating the wet asphalt reflection map.
 */
export class SkyDome {
    readonly mesh: Mesh
    private uniforms: Record<string, IUniform>
    private below_factor: number | null

    /** below_factor — lower hemisphere brightness relative to the horizon, null — same as the horizon */
    constructor(below_factor: number | null = null) {
        this.below_factor = below_factor
        this.uniforms = {
            uZenith: { value: new Color() },
            uHorizon: { value: new Color() },
            uBelow: { value: new Color() },
            uGlow: { value: new Color() },
            uCloud: { value: new Color() },
            uSunDirection: { value: new Vector3(0, 1, 0) },
            uSunDisk: { value: new Color() },
            uCloudCover: { value: 0.5 },
            uStars: { value: 0 },
            uTime: { value: 0 },
        }
        const material: ShaderMaterial = new ShaderMaterial({
            vertexShader: VERTEX,
            fragmentShader: FRAGMENT,
            side: BackSide,
            depthWrite: false,
            fog: false,
            uniforms: this.uniforms,
        })
        this.mesh = new Mesh(new SphereGeometry(1800, 48, 24), material)
        this.mesh.name = 'sky'
        this.mesh.frustumCulled = false
        this.mesh.renderOrder = -1
    }

    setLook(look: EnvironmentLook): void {
        const u: Record<string, IUniform> = this.uniforms
        const colors: Array<[string, Color]> = [
            ['uZenith', look.zenith], ['uHorizon', look.horizon], ['uGlow', look.glow], ['uCloud', look.cloud], ['uSunDisk', look.sun_disk],
        ]
        for (let i: number = 0; i < colors.length; i++) {
            const target: Color = u[colors[i][0]].value as Color
            target.copy(colors[i][1])
        }
        const sun: Vector3 = u.uSunDirection.value as Vector3
        sun.copy(look.sun_direction)
        const below: Color = u.uBelow.value as Color
        below.copy(look.horizon)
        if (this.below_factor !== null) below.multiplyScalar(this.below_factor)
        u.uCloudCover.value = look.cloud_cover
        u.uStars.value = look.stars
    }

    update(camera_position: Vector3, time: number): void {
        this.mesh.position.copy(camera_position)
        this.uniforms.uTime.value = time
    }
}
