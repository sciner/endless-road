import { lang } from '../i18n/Lang'
import { LangKey } from '../i18n/locales/en'

export type TimeOfDay = 'dawn' | 'day' | 'sunset' | 'night'
export type Weather = 'clear' | 'rain' | 'snow' | 'fog'
export type Biome = 'forest' | 'autumn' | 'sakura' | 'desert'

/** Environment chosen by the player: time of day, weather and terrain */
export interface EnvironmentSettings {
    time: TimeOfDay
    weather: Weather
    biome: Biome
}

export const TIMES: TimeOfDay[] = ['dawn', 'day', 'sunset', 'night']
export const WEATHERS: Weather[] = ['clear', 'rain', 'snow', 'fog']
export const BIOMES: Biome[] = ['forest', 'autumn', 'sakura', 'desert']

export const DEFAULT_ENVIRONMENT: EnvironmentSettings = { time: 'night', weather: 'rain', biome: 'forest' }

/** Localized names of environment values in the active language */
export class EnvironmentNames {
    static time(time: TimeOfDay): string {
        return lang[`time_${time}` as LangKey]
    }

    static weather(weather: Weather): string {
        return lang[`weather_${weather}` as LangKey]
    }

    static biome(biome: Biome): string {
        return lang[`biome_${biome}` as LangKey]
    }

    static describe(settings: EnvironmentSettings): string {
        return `${EnvironmentNames.time(settings.time)} · ${EnvironmentNames.weather(settings.weather)} · ${EnvironmentNames.biome(settings.biome)}`
    }
}

/** Ground surface type; it selects the terrain textures */
export type GroundType = 'grass' | 'sand' | 'snow'
