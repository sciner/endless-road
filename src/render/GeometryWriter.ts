import { BufferGeometry, Color, Float32BufferAttribute, Vector3 } from 'three'

const TMP_Z: Vector3 = new Vector3()

/**
 * Simple vertex and index accumulator for procedural geometry
 */
export class GeometryWriter {
    private positions: number[] = []
    private normals: number[] = []
    private uvs: number[] = []
    private colors: number[] = []
    private indices: number[] = []
    private with_colors: boolean

    constructor(with_colors: boolean = false) {
        this.with_colors = with_colors
    }

    get vertex_count(): number {
        return this.positions.length / 3
    }

    vertex(position: Vector3, normal: Vector3, u: number, v: number, color: Color | null = null): number {
        this.positions.push(position.x, position.y, position.z)
        this.normals.push(normal.x, normal.y, normal.z)
        this.uvs.push(u, v)
        if (this.with_colors) {
            if (color) this.colors.push(color.r, color.g, color.b)
            else this.colors.push(1, 1, 1)
        }
        return this.vertex_count - 1
    }

    triangle(a: number, b: number, c: number): void {
        this.indices.push(a, b, c)
    }

    /**
     * Strip grid: rows rows of columns vertices each, laid out row by row.
     * The winding gives an "up" normal when columns go left to right and rows go forward.
     */
    strip(first: number, rows: number, columns: number): void {
        for (let r: number = 0; r < rows - 1; r++) {
            for (let c: number = 0; c < columns - 1; c++) {
                const a: number = first + r * columns + c
                const b: number = a + 1
                const d: number = a + columns
                const e: number = d + 1
                this.indices.push(a, b, d, b, e, d)
            }
        }
    }

    /**
     * Oriented box; the Z axis is computed as X × Y.
     * With uv_meters > 0 each face gets UVs in units of uv_meters (texture keeps its scale on long faces),
     * otherwise every face spans 0..1
     */
    box(center: Vector3, axis_x: Vector3, axis_y: Vector3, half_x: number, half_y: number, half_z: number, color: Color | null = null, uv_meters: number = 0): void {
        const axis_z: Vector3 = TMP_Z.crossVectors(axis_x, axis_y).normalize().clone()
        const axes: Vector3[] = [axis_x, axis_y, axis_z]
        const halves: number[] = [half_x, half_y, half_z]
        // For each face: the normal axis and two axes whose cross product gives the normal
        const faces: number[][] = [[0, 1, 2], [1, 2, 0], [2, 0, 1]]
        for (let f: number = 0; f < faces.length; f++) {
            const [n, u, v] = faces[f]
            for (let sign: number = -1; sign <= 1; sign += 2) {
                const normal: Vector3 = axes[n].clone().multiplyScalar(sign)
                const face_center: Vector3 = center.clone().addScaledVector(axes[n], halves[n] * sign)
                const au: Vector3 = axes[sign > 0 ? u : v]
                const av: Vector3 = axes[sign > 0 ? v : u]
                const hu: number = halves[sign > 0 ? u : v]
                const hv: number = halves[sign > 0 ? v : u]
                const corners: number[][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]]
                const base: number = this.vertex_count
                for (let k: number = 0; k < 4; k++) {
                    const p: Vector3 = face_center.clone()
                        .addScaledVector(au, hu * corners[k][0])
                        .addScaledVector(av, hv * corners[k][1])
                    const su: number = uv_meters > 0 ? (hu * 2) / uv_meters : 1
                    const sv: number = uv_meters > 0 ? (hv * 2) / uv_meters : 1
                    this.vertex(p, normal, (corners[k][0] + 1) * 0.5 * su, (corners[k][1] + 1) * 0.5 * sv, color)
                }
                this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
            }
        }
    }

    build(): BufferGeometry {
        const geometry: BufferGeometry = new BufferGeometry()
        geometry.setAttribute('position', new Float32BufferAttribute(this.positions, 3))
        geometry.setAttribute('normal', new Float32BufferAttribute(this.normals, 3))
        geometry.setAttribute('uv', new Float32BufferAttribute(this.uvs, 2))
        if (this.with_colors) geometry.setAttribute('color', new Float32BufferAttribute(this.colors, 3))
        geometry.setIndex(this.indices)
        geometry.computeBoundingSphere()
        geometry.computeBoundingBox()
        return geometry
    }
}
