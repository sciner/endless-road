import { lang } from '../i18n/Lang'

/** One hint line: pairs of key and action, shown separated by dots */
type HelpLine = Array<[string, string]>

/**
 * Overlay above the game: loading screen, speedometer, gear, odometer and hints
 */
export class Hud {
    private loading: HTMLElement
    private loading_bar: HTMLElement
    private loading_text: HTMLElement
    private loading_subtitle: HTMLElement
    private speed: HTMLElement
    private unit: HTMLElement
    private gear: HTMLElement
    private distance: HTMLElement
    private rpm_bar: HTMLElement
    private help: HTMLElement
    private layer: HTMLElement
    private toast: HTMLElement
    private toast_timer: number = 0
    private last_distance: number = 0

    constructor(root: HTMLElement) {
        root.insertAdjacentHTML('beforeend', `
            <div class="loading-screen">
                <div class="loading-title">ENDLESS ROAD</div>
                <div class="loading-subtitle"></div>
                <div class="loading-track"><div class="loading-bar"></div></div>
                <div class="loading-text"></div>
            </div>
            <div class="hud-layer hidden">
                <div class="hud-panel">
                    <div class="hud-speed">0</div>
                    <div class="hud-unit"></div>
                    <div class="hud-rpm-track"><div class="hud-rpm-bar"></div></div>
                    <div class="hud-row">
                        <span class="hud-gear">N</span>
                        <span class="hud-distance"></span>
                    </div>
                </div>
                <div class="hud-help"></div>
            </div>
            <div class="hud-toast"></div>
        `)
        this.layer = root.querySelector('.hud-layer') as HTMLElement
        this.toast = root.querySelector('.hud-toast') as HTMLElement
        this.loading = root.querySelector('.loading-screen') as HTMLElement
        this.loading_bar = root.querySelector('.loading-bar') as HTMLElement
        this.loading_text = root.querySelector('.loading-text') as HTMLElement
        this.loading_subtitle = root.querySelector('.loading-subtitle') as HTMLElement
        this.speed = root.querySelector('.hud-speed') as HTMLElement
        this.unit = root.querySelector('.hud-unit') as HTMLElement
        this.gear = root.querySelector('.hud-gear') as HTMLElement
        this.distance = root.querySelector('.hud-distance') as HTMLElement
        this.rpm_bar = root.querySelector('.hud-rpm-bar') as HTMLElement
        this.help = root.querySelector('.hud-help') as HTMLElement
        this.loading_text.textContent = lang.loading
        this.applyLanguage()
    }

    /** Rewrites every static text in the active language */
    applyLanguage(): void {
        this.loading_subtitle.textContent = lang.subtitle
        this.unit.textContent = lang.unit_kmh
        this.distance.textContent = this.formatDistance(this.last_distance)
        const lines: HelpLine[] = [
            [['W / ↑', lang.action_throttle]],
            [['S / ↓', lang.action_brake]],
            [['A D / ← →', lang.action_steer]],
            [[lang.key_space, lang.action_handbrake]],
            [['C', lang.action_camera], ['R', lang.action_reset]],
            [['E', lang.action_random_environment]],
            [['M', lang.action_sound], ['F3', lang.action_debug], ['H', lang.action_hide]],
            [['Esc', lang.action_pause]],
            [[`${lang.gamepad}:`, ''], ['RT', lang.action_throttle], ['LT', lang.action_brake], ['A', lang.action_handbrake]],
        ]
        this.help.innerHTML = lines
            .map((line: HelpLine): string => `<div>${line
                .map((pair: [string, string]): string => pair[1] ? `<b>${pair[0]}</b> ${pair[1]}` : `<b>${pair[0]}</b>`)
                .join(' · ')}</div>`)
            .join('')
    }

    /** Gauges are shown only while driving and hidden in the menu */
    setVisible(visible: boolean): void {
        this.layer.classList.toggle('hidden', !visible)
    }

    /** Short notice at the top center that fades out by itself */
    showToast(text: string): void {
        this.toast.textContent = text
        this.toast.classList.add('hud-toast-visible')
        window.clearTimeout(this.toast_timer)
        this.toast_timer = window.setTimeout((): void => this.toast.classList.remove('hud-toast-visible'), 2600)
    }

    setLoading(ratio: number, text: string): void {
        this.loading_bar.style.width = `${Math.round(ratio * 100)}%`
        this.loading_text.textContent = text
    }

    hideLoading(): void {
        this.loading.classList.add('hidden')
    }

    get help_visible(): boolean {
        return !this.help.classList.contains('hidden')
    }

    toggleHelp(): void {
        this.help.classList.toggle('hidden')
    }

    setHelpVisible(visible: boolean): void {
        this.help.classList.toggle('hidden', !visible)
    }

    update(speed_ms: number, gear: number, rpm: number, distance_m: number): void {
        this.last_distance = distance_m
        this.speed.textContent = `${Math.round(speed_ms * 3.6)}`
        this.gear.textContent = gear < 0 ? 'R' : `${gear}`
        this.distance.textContent = this.formatDistance(distance_m)
        this.rpm_bar.style.width = `${Math.min(100, (rpm / 7000) * 100).toFixed(1)}%`
        this.rpm_bar.classList.toggle('redline', rpm > 6400)
    }

    private formatDistance(distance_m: number): string {
        return `${(distance_m / 1000).toFixed(1)} ${lang.unit_km}`
    }
}
