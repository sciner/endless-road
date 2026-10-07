import './styles/style.less'
import { Game } from './Game'

const root: HTMLElement = document.querySelector('.game-root') as HTMLElement
const game: Game = new Game(root)
game.start().catch((error: unknown): void => {
    console.error(error)
})

// In development the game is exposed to the console for debugging
if (import.meta.env.DEV) Object.assign(window, { game: game })
