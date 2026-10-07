/**
 * Uniform spatial grid in the XZ plane for fast neighbor lookup
 */
export class GridIndex<T> {
    private cells: Map<number, T[]> = new Map()
    private cell_size: number

    constructor(cell_size: number) {
        this.cell_size = cell_size
    }

    private static key(cx: number, cz: number): number {
        return (cx + 100000) * 200000 + (cz + 100000)
    }

    insert(x: number, z: number, item: T): void {
        const key: number = GridIndex.key(Math.floor(x / this.cell_size), Math.floor(z / this.cell_size))
        let list: T[] | undefined = this.cells.get(key)
        if (!list) {
            list = []
            this.cells.set(key, list)
        }
        list.push(item)
    }

    /**
     * Visits all items in cells overlapping a square of half-size radius around the point.
     * If visitor returns false, the traversal stops.
     */
    query(x: number, z: number, radius: number, visitor: (item: T) => boolean | void): void {
        const min_cx: number = Math.floor((x - radius) / this.cell_size)
        const max_cx: number = Math.floor((x + radius) / this.cell_size)
        const min_cz: number = Math.floor((z - radius) / this.cell_size)
        const max_cz: number = Math.floor((z + radius) / this.cell_size)
        for (let cx: number = min_cx; cx <= max_cx; cx++) {
            for (let cz: number = min_cz; cz <= max_cz; cz++) {
                const list: T[] | undefined = this.cells.get(GridIndex.key(cx, cz))
                if (!list) continue
                for (let i: number = 0; i < list.length; i++) {
                    if (visitor(list[i]) === false) return
                }
            }
        }
    }

    /** Whether there is at least one item in the cells around the point */
    hasAny(x: number, z: number, radius: number): boolean {
        let found: boolean = false
        this.query(x, z, radius, (): boolean => {
            found = true
            return false
        })
        return found
    }
}
