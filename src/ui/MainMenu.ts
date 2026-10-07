import { lang } from '../i18n/Lang'

/** Cyclable menu setting: label and value in the active language, and a change towards direction (−1 / 1) */
export interface MenuOption {
    label: () => string
    value: () => string
    change: (direction: number) => void
}

/** Menu content: setting lists and the actions the menu triggers */
export interface MenuConfig {
    /** Options shown right on the main screen, under the start button */
    main: MenuOption[]
    settings: MenuOption[]
    environment: MenuOption[]
    on_play: () => void
    on_randomize: () => void
}

type MenuScreen = 'main' | 'environment' | 'settings' | 'controls'

interface MenuItem {
    element: HTMLElement
    /** Item activation (Enter / click) */
    activate: () => void
    /** Value change with left / right arrows, settings only */
    change: ((direction: number) => void) | null
}

/** Keyboard reference rows: key and action */
function keyboardControls(): Array<[string, string]> {
    return [
        ['W / ↑', lang.action_throttle],
        ['S / ↓', lang.action_brake],
        ['A D / ← →', lang.action_steer],
        [lang.key_space, lang.action_handbrake],
        ['C', lang.action_camera],
        ['E', lang.action_random_environment],
        ['R', lang.action_reset],
        ['M', lang.action_sound],
        ['H', lang.action_help],
        ['F3', lang.action_debug],
        ['Esc', lang.action_pause],
    ]
}

/** Gamepad reference rows in Xbox / PlayStation notation */
function gamepadControls(): Array<[string, string]> {
    return [
        ['RT / R2', lang.action_throttle],
        ['LT / L2', lang.action_brake],
        [lang.key_left_stick, lang.action_steer],
        ['A / ✕', lang.action_handbrake],
        ['Y / △', lang.action_camera],
        ['X / □', lang.action_random_environment],
        ['B / ○', lang.action_reset],
        ['Back / Share', lang.action_help],
        ['Start / Options', lang.action_pause],
    ]
}

/**
 * Main menu and pause menu over the live scene. Input is passed in from the game loop
 * through handleKey, so the press that closes the menu is not handled by the game again.
 */
export class MainMenu {
    private element: HTMLElement
    private content: HTMLElement
    private subtitle: HTMLElement
    private footer: HTMLElement
    private config: MenuConfig
    private screen: MenuScreen = 'main'
    private items: MenuItem[] = []
    private selected: number = 0
    private open: boolean = false
    private resumable: boolean = false

    constructor(root: HTMLElement, config: MenuConfig) {
        this.config = config
        this.element = document.createElement('div')
        this.element.className = 'menu-screen hidden'
        this.element.innerHTML = `
            <div class="menu-title">ENDLESS ROAD</div>
            <div class="menu-subtitle"></div>
            <div class="menu-content"></div>
            <div class="menu-footer"></div>
        `
        this.content = this.element.querySelector('.menu-content') as HTMLElement
        this.subtitle = this.element.querySelector('.menu-subtitle') as HTMLElement
        this.footer = this.element.querySelector('.menu-footer') as HTMLElement
        root.appendChild(this.element)
        this.applyLanguage()
    }

    get is_open(): boolean {
        return this.open
    }

    /** Shows the menu; resumable means a drive is in progress and can be continued */
    show(resumable: boolean): void {
        this.open = true
        this.resumable = resumable
        this.element.classList.remove('hidden')
        this.element.classList.toggle('menu-paused', resumable)
        this.render('main')
    }

    hide(): void {
        this.open = false
        this.element.classList.add('hidden')
    }

    /** Re-renders texts in the active language, keeping the open screen and selection */
    applyLanguage(): void {
        this.subtitle.textContent = lang.subtitle
        this.footer.textContent = lang.menu_footer
        if (!this.open) return
        const selected: number = this.selected
        this.render(this.screen)
        this.select(selected)
    }

    handleKey(code: string): void {
        if (!this.open) return
        if (code === 'ArrowUp' || code === 'KeyW' || code === 'GamepadUp') this.select(this.selected - 1)
        else if (code === 'ArrowDown' || code === 'KeyS' || code === 'GamepadDown') this.select(this.selected + 1)
        else if (code === 'ArrowLeft' || code === 'KeyA' || code === 'GamepadLeft') this.items[this.selected]?.change?.(-1)
        else if (code === 'ArrowRight' || code === 'KeyD' || code === 'GamepadRight') this.items[this.selected]?.change?.(1)
        else if (code === 'Enter' || code === 'NumpadEnter' || code === 'Space' || code === 'GamepadA') this.items[this.selected]?.activate()
        else if (code === 'Escape' || code === 'GamepadB') this.back()
        else if (code === 'GamepadStart') {
            // Start launches the game from the title screen and acts as "back" everywhere else
            if (this.screen === 'main' && !this.resumable) this.config.on_play()
            else this.back()
        } else if (code === 'KeyE' || code === 'GamepadX') {
            this.config.on_randomize()
            this.refresh()
        }
    }

    private back(): void {
        if (this.screen !== 'main') this.render('main')
        else if (this.resumable) this.config.on_play()
    }

    /** Environment values changed from outside (the E key): refresh the open screen */
    refresh(): void {
        if (!this.open || this.screen !== 'environment') return
        const selected: number = this.selected
        this.render('environment')
        this.select(selected)
    }

    private render(screen: MenuScreen): void {
        this.screen = screen
        this.items = []
        this.content.innerHTML = ''
        if (screen === 'main') this.renderMain()
        else if (screen === 'environment') this.renderEnvironment()
        else if (screen === 'settings') this.renderOptions(lang.menu_settings, this.config.settings)
        else this.renderControls()
        this.select(0)
        if (screen !== 'main') this.addButton(lang.menu_back, (): void => this.render('main'))
    }

    private renderMain(): void {
        this.addButton(this.resumable ? lang.menu_resume : lang.menu_play, (): void => this.config.on_play())
        this.addOptionRows(this.config.main)
        this.addButton(lang.menu_environment, (): void => this.render('environment'))
        this.addButton(lang.menu_settings, (): void => this.render('settings'))
        this.addButton(lang.menu_controls, (): void => this.render('controls'))
    }

    private renderEnvironment(): void {
        this.renderOptions(lang.menu_environment, this.config.environment)
        this.addButton(lang.menu_random_environment, (): void => {
            this.config.on_randomize()
            this.refresh()
        })
    }

    private renderOptions(title: string, options: MenuOption[]): void {
        this.addHeading(title)
        this.addOptionRows(options)
    }

    private addOptionRows(options: MenuOption[]): void {
        for (let i: number = 0; i < options.length; i++) {
            const option: MenuOption = options[i]
            const row: HTMLElement = document.createElement('div')
            row.className = 'menu-item menu-option'
            row.innerHTML = `
                <span class="menu-option-label"></span>
                <span class="menu-option-arrow">‹</span>
                <span class="menu-option-value"></span>
                <span class="menu-option-arrow">›</span>
            `
            const label: HTMLElement = row.querySelector('.menu-option-label') as HTMLElement
            const value: HTMLElement = row.querySelector('.menu-option-value') as HTMLElement
            const arrows: NodeListOf<HTMLElement> = row.querySelectorAll('.menu-option-arrow')
            const change: (direction: number) => void = (direction: number): void => {
                option.change(direction)
                // The language option re-renders the whole menu, so the row may already be detached
                if (!row.isConnected) return
                label.textContent = option.label()
                value.textContent = option.value()
            }
            label.textContent = option.label()
            value.textContent = option.value()
            arrows[0].addEventListener('click', (event: MouseEvent): void => {
                event.stopPropagation()
                change(-1)
            })
            arrows[1].addEventListener('click', (event: MouseEvent): void => {
                event.stopPropagation()
                change(1)
            })
            this.addItem(row, (): void => change(1), change)
        }
    }

    private renderControls(): void {
        this.addHeading(lang.menu_controls)
        this.addControlsTable(keyboardControls())
        this.addHeading(lang.gamepad)
        this.addControlsTable(gamepadControls())
    }

    private addControlsTable(rows: Array<[string, string]>): void {
        const table: HTMLElement = document.createElement('div')
        table.className = 'menu-controls'
        table.innerHTML = rows
            .map((row: [string, string]): string => `<span class="menu-key">${row[0]}</span><span class="menu-action">${row[1]}</span>`)
            .join('')
        this.content.appendChild(table)
    }

    private addHeading(text: string): void {
        const heading: HTMLElement = document.createElement('div')
        heading.className = 'menu-heading'
        heading.textContent = text
        this.content.appendChild(heading)
    }

    private addButton(text: string, activate: () => void): void {
        const button: HTMLElement = document.createElement('div')
        button.className = 'menu-item menu-button'
        button.textContent = text
        this.addItem(button, activate, null)
    }

    private addItem(element: HTMLElement, activate: () => void, change: ((direction: number) => void) | null): void {
        const index: number = this.items.length
        element.addEventListener('mouseenter', (): void => this.select(index))
        element.addEventListener('click', (): void => activate())
        this.content.appendChild(element)
        this.items.push({ element: element, activate: activate, change: change })
    }

    private select(index: number): void {
        if (this.items.length === 0) return
        this.selected = (index + this.items.length) % this.items.length
        for (let i: number = 0; i < this.items.length; i++) {
            this.items[i].element.classList.toggle('menu-selected', i === this.selected)
        }
    }
}
