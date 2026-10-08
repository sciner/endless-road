import { Color, Vector3 } from 'three'
import { Biome, EnvironmentSettings, GroundType, TimeOfDay, Weather } from './EnvironmentTypes'

export type Precipitation = 'none' | 'rain' | 'snow'

/** All visual, audio and grip parameters for a specific environment */
export interface EnvironmentLook {
    zenith: Color
    /** Sky horizon color, also used as the fog color */
    horizon: Color
    glow: Color
    cloud: Color
    cloud_cover: number
    /** Direction toward the sun or moon */
    sun_direction: Vector3
    sun_disk: Color
    stars: number
    fog_density: number

    sun_color: Color
    sun_intensity: number
    hemi_sky: Color
    hemi_ground: Color
    hemi_intensity: number
    environment_intensity: number
    exposure: number
    bloom: number
    shadow_tint: Color

    /** 0 = dry, 1 = puddles */
    wetness: number
    raining: boolean
    /** Snow cover on the road and vegetation, 0..1 */
    snow: number
    ground: GroundType
    ground_tint: Color
    dirt: Color
    fir_tint: Color
    leaf_tint: Color
    /** Second foliage hue that some trees lean toward: yellow in autumn, white in cherry blossom */
    leaf_tint_alt: Color
    /** Luminance-based recolor of foliage toward leaf_tint (autumn), 0..1 */
    leaf_recolor: number
    /** Evens out dark spots in the recolored crown texture, 0..1 */
    leaf_soft: number
    /** Light shining through thin petals, added on top of the lighting */
    leaf_glow: number
    grass_tint: Color
    grass_recolor: number

    precipitation: Precipitation
    precipitation_alpha: number

    /** Fallen leaves lying on the road, 0..1 */
    litter: number
    /** Leaves carried through the air by the wind, 0..1 */
    wind_leaves: number
    /** Leaf size multiplier: petals are smaller than leaves */
    leaf_size: number
    /** Colors of fallen and flying leaves */
    leaf_palette: Color[]

    headlights: number
    grip: number
    spray_color: Color
    spray_amount: number
    spray_off_road: boolean

    rain_sound: number
    wind_sound: number
    wet_tires: number
}

/** Sky and light for one time of day: a clear variant and a fully overcast variant */
interface TimePreset {
    zenith: [number, number]
    horizon: [number, number]
    glow: [number, number]
    cloud: [number, number]
    sun_direction: Vector3
    sun_disk: number
    sun_color: number
    sun_intensity: [number, number]
    hemi_sky: number
    hemi_ground: number
    hemi_intensity: [number, number]
    environment_intensity: number
    exposure: number
    bloom: number
    shadow_tint: [number, number, number]
    stars: number
    headlights: number
    precipitation_alpha: number
    clear_fog: number
}

const TIME_PRESETS: Record<TimeOfDay, TimePreset> = {
    night: {
        zenith: [0x040a1c, 0x0a1a3a],
        horizon: [0x0e1828, 0x1d2a40],
        glow: [0x1c2a48, 0x2a3e63],
        cloud: [0x10182a, 0x1c2a44],
        sun_direction: new Vector3(-0.42, 0.83, 0.36).normalize(),
        sun_disk: 0xb8c4e8,
        sun_color: 0x9fb6ff,
        sun_intensity: [0.75, 0.55],
        hemi_sky: 0x5674a8,
        hemi_ground: 0x0c110c,
        hemi_intensity: [0.5, 0.6],
        environment_intensity: 0.3,
        exposure: 1.15,
        bloom: 0.3,
        shadow_tint: [0.92, 0.99, 1.12],
        stars: 1,
        headlights: 1,
        precipitation_alpha: 1,
        clear_fog: 0.0055,
    },
    dawn: {
        zenith: [0x2c4f86, 0x485468],
        horizon: [0xd9a98c, 0x8a8c94],
        glow: [0xffa070, 0x8a7a78],
        cloud: [0xb08c90, 0x6a6c74],
        sun_direction: new Vector3(0.8, 0.16, -0.55).normalize(),
        sun_disk: 0xffd2a0,
        sun_color: 0xffbe8a,
        sun_intensity: [1.9, 0.45],
        hemi_sky: 0x8ea4cc,
        hemi_ground: 0x2a2620,
        hemi_intensity: [0.7, 0.85],
        environment_intensity: 0.7,
        exposure: 0.9,
        bloom: 0.24,
        shadow_tint: [0.97, 0.98, 1.06],
        stars: 0,
        headlights: 0.7,
        precipitation_alpha: 1.4,
        clear_fog: 0.0045,
    },
    day: {
        zenith: [0x2a62b8, 0x6c7888],
        horizon: [0xb4cbe0, 0xa6acb4],
        glow: [0xfff4dc, 0xc0c4c8],
        cloud: [0xf4f6f8, 0x8c939c],
        sun_direction: new Vector3(-0.35, 0.8, 0.48).normalize(),
        sun_disk: 0xfffbf0,
        sun_color: 0xfff1dc,
        sun_intensity: [3.2, 0.7],
        hemi_sky: 0xb0ccf0,
        hemi_ground: 0x4a4636,
        hemi_intensity: [1.1, 1.4],
        environment_intensity: 1.0,
        exposure: 0.65,
        bloom: 0.12,
        shadow_tint: [1.0, 1.0, 1.02],
        stars: 0,
        headlights: 0.35,
        precipitation_alpha: 2.2,
        clear_fog: 0.0032,
    },
    sunset: {
        zenith: [0x23306a, 0x44445a],
        horizon: [0xf0905a, 0x8a7470],
        glow: [0xff6a28, 0x8a5a48],
        cloud: [0x8a5060, 0x5a4c54],
        sun_direction: new Vector3(-0.85, 0.07, 0.52).normalize(),
        sun_disk: 0xffb070,
        sun_color: 0xff9450,
        sun_intensity: [2.1, 0.45],
        hemi_sky: 0x8a80b0,
        hemi_ground: 0x2c1c16,
        hemi_intensity: [0.65, 0.8],
        environment_intensity: 0.6,
        exposure: 0.95,
        bloom: 0.3,
        shadow_tint: [1.08, 0.98, 0.9],
        stars: 0,
        headlights: 0.85,
        precipitation_alpha: 1.4,
        clear_fog: 0.0042,
    },
}

/** Weather influence: cloud cover fraction, fog density, wetness and grip */
interface WeatherPreset {
    overcast: number
    fog_density: number
    wetness: number
    raining: boolean
    snow: number
    precipitation: Precipitation
    grip: number
    spray_amount: number
    rain_sound: number
    wind_sound: number
    wet_tires: number
    /** Leaves torn off and carried by the wind, 0..1 */
    wind_leaves: number
}

const WEATHER_PRESETS: Record<Weather, WeatherPreset> = {
    clear: { overcast: 0, fog_density: 0, wetness: 0, raining: false, snow: 0, precipitation: 'none', grip: 1.05, spray_amount: 0, rain_sound: 0, wind_sound: 0.25, wet_tires: 0, wind_leaves: 0 },
    rain: { overcast: 1, fog_density: 0.0085, wetness: 1, raining: true, snow: 0, precipitation: 'rain', grip: 0.95, spray_amount: 1, rain_sound: 1, wind_sound: 1, wet_tires: 1, wind_leaves: 1 },
    snow: { overcast: 0.85, fog_density: 0.011, wetness: 0.3, raining: false, snow: 1, precipitation: 'snow', grip: 0.62, spray_amount: 0.8, rain_sound: 0, wind_sound: 0.7, wet_tires: 0.35, wind_leaves: 0.35 },
    fog: { overcast: 0.75, fog_density: 0.022, wetness: 0.35, raining: false, snow: 0, precipitation: 'none', grip: 1.0, spray_amount: 0.3, rain_sound: 0, wind_sound: 0.15, wet_tires: 0.4, wind_leaves: 0.45 },
}

const DESERT_HAZE: Color = new Color(0xc8a882)

/**
 * Builds the look from three independent axes: time of day sets sky and light,
 * weather blends the clear and overcast variants and adds fog and wetness,
 * terrain sets ground, vegetation and the warm desert haze
 */
export class EnvironmentLookBuilder {
    static build(settings: EnvironmentSettings): EnvironmentLook {
        const time: TimePreset = TIME_PRESETS[settings.time]
        const weather: WeatherPreset = WEATHER_PRESETS[settings.weather]
        const o: number = weather.overcast
        const mix: (pair: [number, number]) => Color = (pair: [number, number]): Color => new Color(pair[0]).lerp(new Color(pair[1]), o)
        const blend: (pair: [number, number]) => number = (pair: [number, number]): number => pair[0] + (pair[1] - pair[0]) * o

        const look: EnvironmentLook = {
            zenith: mix(time.zenith),
            horizon: mix(time.horizon),
            glow: mix(time.glow),
            cloud: mix(time.cloud),
            cloud_cover: 0.25 + o * 0.75,
            sun_direction: time.sun_direction.clone(),
            sun_disk: new Color(time.sun_disk).multiplyScalar(1 - Math.min(1, o * 1.15)),
            stars: time.stars * (1 - o),
            fog_density: Math.max(time.clear_fog, weather.fog_density),

            sun_color: new Color(time.sun_color),
            sun_intensity: blend(time.sun_intensity),
            hemi_sky: new Color(time.hemi_sky),
            hemi_ground: new Color(time.hemi_ground),
            hemi_intensity: blend(time.hemi_intensity),
            environment_intensity: time.environment_intensity,
            exposure: time.exposure,
            bloom: time.bloom,
            shadow_tint: new Color(time.shadow_tint[0], time.shadow_tint[1], time.shadow_tint[2]),

            wetness: weather.wetness,
            raining: weather.raining,
            snow: weather.snow,
            ground: weather.snow > 0 ? 'snow' : 'grass',
            ground_tint: new Color(0x9aa08a),
            dirt: new Color(0.055, 0.048, 0.04),
            fir_tint: new Color(0x8c9a7e),
            leaf_tint: new Color(0x93a07c),
            leaf_tint_alt: new Color(0.92, 0.66, 0.16),
            leaf_recolor: 0,
            leaf_soft: 0,
            leaf_glow: 0,
            grass_tint: new Color(0x8f9a78),
            grass_recolor: 0,

            precipitation: weather.precipitation,
            precipitation_alpha: time.precipitation_alpha,

            // Summer forest: a few dry leaves on the road; snow buries them
            litter: weather.snow > 0 ? 0 : 0.35,
            wind_leaves: weather.wind_leaves * 0.5,
            leaf_size: 1,
            leaf_palette: [new Color(0x6f7a3a), new Color(0x8a7a3a), new Color(0x7a5a32), new Color(0x5e6a34)],

            headlights: settings.weather === 'fog' ? Math.max(time.headlights, 0.8) : time.headlights,
            grip: weather.grip,
            spray_color: new Color(weather.snow > 0 ? 0xc8d0dc : 0x2a3442),
            spray_amount: weather.spray_amount,
            spray_off_road: false,

            rain_sound: weather.rain_sound,
            wind_sound: weather.wind_sound,
            wet_tires: weather.wet_tires,
        }
        EnvironmentLookBuilder.applyBiome(look, settings.biome, settings.time)
        if (weather.snow > 0) look.ground_tint.set(0xdfe4ec)
        return look
    }

    private static luminance(color: Color): number {
        return color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722
    }

    private static applyBiome(look: EnvironmentLook, biome: Biome, time: TimeOfDay): void {
        if (biome === 'autumn') {
            look.ground_tint.set(0xa89a72)
            look.leaf_tint.set(0xd2702a)
            look.leaf_recolor = 1
            look.grass_tint.set(0xa89058)
            look.grass_recolor = 0.65
            look.litter = look.snow > 0 ? 0.15 : 1
            look.wind_leaves *= 2
            look.leaf_palette = [new Color(0xd2642a), new Color(0xe0a030), new Color(0xb8401e), new Color(0x8a5428), new Color(0xd88a2a)]
            return
        }
        if (biome === 'sakura') {
            // Blossoming cherries: pink crowns with white-flowered trees here and there, fresh spring grass
            // Brighter than 1: the recolor takes brightness from the dark green leaf texture
            look.leaf_tint.set(0xffa8bc).multiplyScalar(1.15)
            look.leaf_tint_alt.set(0xfff0f2)
            look.leaf_recolor = 1
            // Blossom is light and translucent: no dark holes in the crowns, a soft glow in daylight
            look.leaf_soft = 0.6
            look.leaf_glow = 0.07 * Math.min(1, look.hemi_intensity)
            look.grass_tint.set(0x8fa86e)
            look.ground_tint.set(0x9ea88a)
            // Petals lie on the road and drift down even in calm weather
            look.litter = look.snow > 0 ? 0.2 : 1
            look.wind_leaves = Math.max(0.35, look.wind_leaves * 2)
            look.leaf_size = 0.75
            look.leaf_palette = [new Color(0xf6b8d0), new Color(0xfad4e2), new Color(0xee9cbc), new Color(0xfff0f4)]
            return
        }
        if (biome !== 'desert') return

        // No leaves in the desert
        look.litter = 0
        look.wind_leaves = 0

        look.ground = look.snow > 0 ? 'snow' : 'sand'
        look.ground_tint.set(0xd8c8b4)
        look.dirt.setRGB(0.12, 0.09, 0.065)
        look.grass_tint.set(0xb89a62)
        look.grass_recolor = 0.9
        // Warm dusty haze over the desert, barely visible at night
        const haze: number = time === 'night' ? 0.12 : 0.22
        const brightness: number = EnvironmentLookBuilder.luminance(look.horizon) / EnvironmentLookBuilder.luminance(DESERT_HAZE)
        look.horizon.lerp(DESERT_HAZE.clone().multiplyScalar(brightness + 0.1), haze)
        // Dry desert kicks up dust from the wheels and on the roadside
        if (look.wetness < 0.5 && look.snow === 0) {
            look.spray_color.set(0x8a7356)
            look.spray_amount = 0.9
            look.spray_off_road = true
        }
    }
}
