import { BIOMES, DEFAULT_ENVIRONMENT, EnvironmentSettings, TIMES, WEATHERS } from '../environment/EnvironmentTypes'
import { Lang, LanguageCode } from '../i18n/Lang'
import { QualityChoice, QualityPresets } from '../render/QualityPresets'
import { CAR_IDS, CarId } from '../vehicle/CarProfiles'

/** User settings that survive a page reload */
export interface SettingsData {
    camera_mode: number
    help_visible: boolean
    debug_visible: boolean
    muted: boolean
    language: LanguageCode
    car: CarId
    quality: QualityChoice
    environment: EnvironmentSettings
}

const STORAGE_KEY: string = 'endless-road.settings'

const DEFAULTS: Omit<SettingsData, 'language'> = {
    camera_mode: 0,
    help_visible: true,
    debug_visible: false,
    muted: false,
    car: 'porsche',
    quality: 'auto',
    environment: DEFAULT_ENVIRONMENT,
}

/**
 * Settings storage in localStorage. Corrupted or outdated data never breaks the game:
 * every field is type-checked and falls back to its default on mismatch.
 */
export class Settings {
    private data: SettingsData

    constructor() {
        this.data = Settings.read()
    }

    get camera_mode(): number {
        return this.data.camera_mode
    }

    get help_visible(): boolean {
        return this.data.help_visible
    }

    get debug_visible(): boolean {
        return this.data.debug_visible
    }

    get muted(): boolean {
        return this.data.muted
    }

    get language(): LanguageCode {
        return this.data.language
    }

    get car(): CarId {
        return this.data.car
    }

    get quality(): QualityChoice {
        return this.data.quality
    }

    get environment(): EnvironmentSettings {
        return { ...this.data.environment }
    }

    /** Changes part of the settings and saves them right away */
    update(patch: Partial<SettingsData>): void {
        this.data = { ...this.data, ...patch }
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data))
        } catch {
            // Storage is unavailable (private mode, quota): settings live until reload
        }
    }

    private static read(): SettingsData {
        let stored: Partial<Record<keyof SettingsData, unknown>> = {}
        try {
            const raw: string | null = localStorage.getItem(STORAGE_KEY)
            if (raw) stored = JSON.parse(raw)
        } catch {
            stored = {}
        }
        return {
            camera_mode: Number.isInteger(stored.camera_mode) ? stored.camera_mode as number : DEFAULTS.camera_mode,
            help_visible: typeof stored.help_visible === 'boolean' ? stored.help_visible : DEFAULTS.help_visible,
            debug_visible: typeof stored.debug_visible === 'boolean' ? stored.debug_visible : DEFAULTS.debug_visible,
            muted: typeof stored.muted === 'boolean' ? stored.muted : DEFAULTS.muted,
            // Without a saved choice the language follows the browser
            language: Lang.isSupported(stored.language) ? stored.language : Lang.detect(),
            car: CAR_IDS.includes(stored.car as CarId) ? stored.car as CarId : DEFAULTS.car,
            quality: QualityPresets.isChoice(stored.quality) ? stored.quality : DEFAULTS.quality,
            environment: Settings.readEnvironment(stored.environment),
        }
    }

    /** Each environment axis is validated against its list of allowed values separately */
    private static readEnvironment(value: unknown): EnvironmentSettings {
        const stored: Partial<Record<keyof EnvironmentSettings, unknown>> =
            typeof value === 'object' && value !== null ? value as Partial<Record<keyof EnvironmentSettings, unknown>> : {}
        const pick: <T extends string>(list: T[], candidate: unknown, fallback: T) => T =
            <T extends string>(list: T[], candidate: unknown, fallback: T): T => list.includes(candidate as T) ? candidate as T : fallback
        return {
            time: pick(TIMES, stored.time, DEFAULT_ENVIRONMENT.time),
            weather: pick(WEATHERS, stored.weather, DEFAULT_ENVIRONMENT.weather),
            biome: pick(BIOMES, stored.biome, DEFAULT_ENVIRONMENT.biome),
        }
    }
}
