import { en, LangStrings } from './locales/en'
import { ru } from './locales/ru'
import { de } from './locales/de'
import { fr } from './locales/fr'
import { es } from './locales/es'
import { pt } from './locales/pt'
import { zh } from './locales/zh'
import { ja } from './locales/ja'

export type LanguageCode = 'en' | 'ru' | 'de' | 'fr' | 'es' | 'pt' | 'zh' | 'ja'

export const LANGUAGES: LanguageCode[] = ['en', 'ru', 'de', 'fr', 'es', 'pt', 'zh', 'ja']

/** Each language is named in itself so a player can always find their own */
export const LANGUAGE_NAMES: Record<LanguageCode, string> = {
    en: 'English',
    ru: 'Русский',
    de: 'Deutsch',
    fr: 'Français',
    es: 'Español',
    pt: 'Português',
    zh: '中文',
    ja: '日本語',
}

const DICTIONARIES: Record<LanguageCode, LangStrings> = { en, ru, de, fr, es, pt, zh, ja }

let current_code: LanguageCode = 'en'
let current_strings: LangStrings = en

/**
 * Strings of the active language. A key without a translation resolves to the key itself,
 * so a missing entry shows up in the UI instead of breaking it
 */
export const lang: LangStrings = new Proxy({} as LangStrings, {
    get: (_target: LangStrings, key: string | symbol): string | undefined => {
        if (typeof key !== 'string') return undefined
        return (current_strings as Record<string, string>)[key] ?? key
    },
})

/** Active language selection and string helpers */
export class Lang {
    static get code(): LanguageCode {
        return current_code
    }

    static set(code: LanguageCode): void {
        current_code = code
        current_strings = DICTIONARIES[code]
        document.documentElement.lang = code
    }

    /** First browser language the game supports, English otherwise */
    static detect(): LanguageCode {
        const preferred: readonly string[] = navigator.languages && navigator.languages.length > 0 ? navigator.languages : [navigator.language]
        for (let i: number = 0; i < preferred.length; i++) {
            const base: string = (preferred[i] ?? '').toLowerCase().split('-')[0]
            if (LANGUAGES.includes(base as LanguageCode)) return base as LanguageCode
        }
        return 'en'
    }

    static isSupported(value: unknown): value is LanguageCode {
        return typeof value === 'string' && LANGUAGES.includes(value as LanguageCode)
    }

    /** Substitutes {name} placeholders with values */
    static format(template: string, values: Record<string, string>): string {
        return template.replace(/\{(\w+)\}/g, (match: string, name: string): string => values[name] ?? match)
    }
}
