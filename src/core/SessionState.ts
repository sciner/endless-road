/** Where the player was when the game was last closed */
export interface SessionData {
    /** The world is generated from the seed, so the same seed rebuilds the same road */
    seed: number
    x: number
    z: number
    yaw: number
    /** Distance along the track at the car's position */
    along: number
    /** How far the road had been generated in each direction: the generator order affects its shape */
    road_front: number
    road_back: number
    odometer: number
}

const STORAGE_KEY: string = 'endless-road.session'
/** Raised when road generation changes, so an old save doesn't put the car on a road that no longer exists */
const VERSION: number = 1

/**
 * The last drive in localStorage. Unlike settings, it is kept only if every field is valid,
 * otherwise the game simply starts a new world
 */
export class SessionState {
    static load(): SessionData | null {
        try {
            const raw: string | null = localStorage.getItem(STORAGE_KEY)
            if (!raw) return null
            const stored: Record<string, unknown> = JSON.parse(raw)
            if (stored.version !== VERSION) return null
            const keys: (keyof SessionData)[] = ['seed', 'x', 'z', 'yaw', 'along', 'road_front', 'road_back', 'odometer']
            for (let i: number = 0; i < keys.length; i++) {
                if (typeof stored[keys[i]] !== 'number' || !Number.isFinite(stored[keys[i]])) return null
            }
            return stored as unknown as SessionData
        } catch {
            return null
        }
    }

    static save(data: SessionData): void {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: VERSION, ...data }))
        } catch {
            // Storage is unavailable (private mode, quota): the next launch starts a new world
        }
    }
}
