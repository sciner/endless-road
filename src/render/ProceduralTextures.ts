import { CanvasTexture, ClampToEdgeWrapping, DataTexture, LinearFilter, LinearMipmapLinearFilter, RedFormat, RepeatWrapping, SRGBColorSpace, Texture, UnsignedByteType } from 'three'
import { Random } from '../core/Random'

/**
 * Textures that are easier to draw in code than to store as files:
 * conifer branches, foliage, grass, road markings, puddle mask, soft particle sprite
 */
export class ProceduralTextures {
    private static createCanvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
        const canvas: HTMLCanvasElement = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx: CanvasRenderingContext2D = canvas.getContext('2d') as CanvasRenderingContext2D
        return [canvas, ctx]
    }

    private static finish(canvas: HTMLCanvasElement, srgb: boolean, anisotropy: number): CanvasTexture {
        const texture: CanvasTexture = new CanvasTexture(canvas)
        if (srgb) texture.colorSpace = SRGBColorSpace
        texture.anisotropy = anisotropy
        texture.minFilter = LinearMipmapLinearFilter
        texture.magFilter = LinearFilter
        texture.generateMipmaps = true
        return texture
    }

    /** Spruce bough: branch base at the bottom of the texture, tip at the top */
    static firBranch(anisotropy: number): CanvasTexture {
        const size: number = 512
        const [canvas, ctx] = ProceduralTextures.createCanvas(size, size)
        const random: Random = new Random(1701)
        const cx: number = size / 2
        ctx.lineCap = 'round'

        // Older needles deep in the bough are darker, fresh growth at the tips is lighter
        const needle: (x: number, y: number, angle: number, length: number, fresh: number) => void = (x: number, y: number, angle: number, length: number, fresh: number): void => {
            const hue: number = random.range(100, 135) - fresh * 15
            const light: number = random.range(8, 20) + fresh * random.range(6, 14)
            ctx.strokeStyle = `hsl(${hue}, ${random.range(28, 50) + fresh * 10}%, ${light}%)`
            ctx.lineWidth = random.range(1.5, 2.6)
            ctx.beginPath()
            ctx.moveTo(x, y)
            ctx.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length)
            ctx.stroke()
        }

        // Needles all around a twig: on a flat card they read as a fluffy cylinder, not a fishbone
        const shoot: (x0: number, y0: number, x1: number, y1: number, width: number, tip_fresh: number) => void =
            (x0: number, y0: number, x1: number, y1: number, width: number, tip_fresh: number): void => {
                const angle: number = Math.atan2(y1 - y0, x1 - x0)
                const len: number = Math.hypot(x1 - x0, y1 - y0)
                ctx.strokeStyle = '#2b2116'
                ctx.lineWidth = width
                ctx.beginPath()
                ctx.moveTo(x0, y0)
                ctx.lineTo(x1, y1)
                ctx.stroke()
                const needles: number = Math.floor(len / 1.6)
                for (let n: number = 0; n < needles; n++) {
                    const t: number = n / needles
                    const nx: number = x0 + (x1 - x0) * t
                    const ny: number = y0 + (y1 - y0) * t
                    const nlen: number = random.range(9, 17) * (1 - t * 0.35)
                    const spread: number = random.range(0.5, 1.2)
                    const fresh: number = t > 0.65 ? tip_fresh * (t - 0.65) / 0.35 : 0
                    needle(nx, ny, angle + random.sign() * spread, nlen, fresh)
                }
            }

        // Side twigs get shorter from base to tip, each with a few second-order shoots
        const twig_count: number = 22
        for (let k: number = 0; k < twig_count; k++) {
            const f: number = k / twig_count
            const y: number = size * (0.96 - f * 0.9)
            const twig_len: number = size * (0.4 - f * 0.28) * random.range(0.8, 1.1)
            for (let side: number = -1; side <= 1; side += 2) {
                const angle: number = -Math.PI / 2 + side * random.range(0.7, 1.0)
                const ex: number = cx + Math.cos(angle) * twig_len
                const ey: number = y + Math.sin(angle) * twig_len
                shoot(cx, y, ex, ey, 2.6 - f * 1.6, 1)
                const forks: number = twig_len > size * 0.15 ? 2 : 0
                for (let s: number = 0; s < forks; s++) {
                    const t: number = random.range(0.3, 0.7)
                    const fx: number = cx + (ex - cx) * t
                    const fy: number = y + (ey - y) * t
                    const fork_angle: number = angle + random.sign() * random.range(0.5, 0.8)
                    const fork_len: number = twig_len * random.range(0.25, 0.4)
                    shoot(fx, fy, fx + Math.cos(fork_angle) * fork_len, fy + Math.sin(fork_angle) * fork_len, 1.4, 0.8)
                }
            }
        }

        // Central stem with needles
        shoot(cx, size, cx, size * 0.03, 5, 1)
        return ProceduralTextures.finish(canvas, true, anisotropy)
    }

    /** Deciduous leaf cluster with a ragged edge */
    static leafCluster(anisotropy: number): CanvasTexture {
        const size: number = 512
        const [canvas, ctx] = ProceduralTextures.createCanvas(size, size)
        const random: Random = new Random(4242)
        for (let i: number = 0; i < 420; i++) {
            const r: number = Math.sqrt(random.next()) * size * 0.43
            const a: number = random.next() * Math.PI * 2
            const x: number = size / 2 + Math.cos(a) * r
            const y: number = size / 2 + Math.sin(a) * r
            const leaf_len: number = random.range(16, 28)
            ctx.save()
            ctx.translate(x, y)
            ctx.rotate(random.next() * Math.PI * 2)
            ctx.fillStyle = `hsl(${random.range(75, 110)}, ${random.range(30, 55)}%, ${random.range(12, 30)}%)`
            ctx.beginPath()
            ctx.ellipse(0, 0, leaf_len, leaf_len * 0.45, 0, 0, Math.PI * 2)
            ctx.fill()
            ctx.strokeStyle = 'rgba(10, 20, 8, 0.6)'
            ctx.lineWidth = 1.2
            ctx.beginPath()
            ctx.moveTo(-leaf_len, 0)
            ctx.lineTo(leaf_len, 0)
            ctx.stroke()
            ctx.restore()
        }
        return ProceduralTextures.finish(canvas, true, anisotropy)
    }

    /**
     * Outline of a leaf or a cherry petal centered at the origin, base toward -x, tip toward +x.
     * A leaf is ovate with a finely toothed edge; a petal is rounded with the notch at its tip.
     */
    private static leafPath(ctx: CanvasRenderingContext2D, length: number, width: number, petal: boolean): void {
        ctx.beginPath()
        if (petal) {
            ctx.moveTo(-length, 0)
            ctx.bezierCurveTo(-length * 0.45, -width * 0.95, length * 0.75, -width * 1.15, length, -width * 0.28)
            ctx.lineTo(length * 0.8, 0)
            ctx.lineTo(length, width * 0.28)
            ctx.bezierCurveTo(length * 0.75, width * 1.15, -length * 0.45, width * 0.95, -length, 0)
            ctx.closePath()
            return
        }
        const steps: number = 28
        ctx.moveTo(-length, 0)
        for (let side: number = -1; side <= 1; side += 2) {
            for (let k: number = 1; k <= steps; k++) {
                const i: number = side < 0 ? k : steps - k
                const t: number = i / steps
                // Widest a little below the middle, tapering to a sharp tip; every other point is a tooth
                const half: number = width * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.85)), 0.85) * (i % 2 === 0 ? 1 : 0.94)
                ctx.lineTo(-length + 2 * length * t, side * half)
            }
        }
        ctx.closePath()
    }

    /** Midrib, side veins and the stem of a leaf; a petal gets only faint lines fanning from its base */
    private static leafVeins(ctx: CanvasRenderingContext2D, length: number, width: number, petal: boolean, style: string, stem_style: string): void {
        ctx.strokeStyle = style
        ctx.lineCap = 'round'
        if (petal) {
            ctx.lineWidth = Math.max(0.6, length * 0.03)
            for (let k: number = -2; k <= 2; k++) {
                ctx.beginPath()
                ctx.moveTo(-length * 0.9, 0)
                ctx.quadraticCurveTo(0, k * width * 0.25, length * 0.75, k * width * 0.42)
                ctx.stroke()
            }
            return
        }
        ctx.lineWidth = Math.max(0.8, length * 0.05)
        ctx.beginPath()
        ctx.moveTo(-length, 0)
        ctx.lineTo(length * 0.92, 0)
        ctx.stroke()
        ctx.lineWidth = Math.max(0.6, length * 0.028)
        for (let v: number = 1; v <= 5; v++) {
            const x: number = -length + (2 * length * v) / 6.5
            for (let side: number = -1; side <= 1; side += 2) {
                ctx.beginPath()
                ctx.moveTo(x, 0)
                ctx.quadraticCurveTo(x + length * 0.2, side * width * 0.35, x + length * 0.38, side * width * 0.72)
                ctx.stroke()
            }
        }
        ctx.strokeStyle = stem_style
        ctx.lineWidth = Math.max(1, length * 0.07)
        ctx.beginPath()
        ctx.moveTo(-length, 0)
        ctx.quadraticCurveTo(-length * 1.15, length * 0.04, -length * 1.3, length * 0.1)
        ctx.stroke()
    }

    /**
     * A single leaf or petal for the leaves flying through the air, drawn light gray so the
     * instance color tints it; the leaf spans the texture along u
     */
    static leafSprite(petal: boolean, anisotropy: number): CanvasTexture {
        const size: number = 128
        const [canvas, ctx] = ProceduralTextures.createCanvas(size, size)
        ctx.translate(size * (petal ? 0.5 : 0.55), size / 2)
        const length: number = size * (petal ? 0.42 : 0.38)
        const width: number = length * (petal ? 0.95 : 0.5)
        ProceduralTextures.leafPath(ctx, length, width, petal)
        const gradient: CanvasGradient = ctx.createRadialGradient(0, 0, 0, 0, 0, length)
        gradient.addColorStop(0, petal ? '#ffffff' : '#ececec')
        gradient.addColorStop(1, petal ? '#dcdcdc' : '#c4c4c4')
        ctx.fillStyle = gradient
        ctx.fill()
        ctx.save()
        ProceduralTextures.leafPath(ctx, length, width, petal)
        ctx.clip()
        ProceduralTextures.leafVeins(ctx, length, width, petal, petal ? 'rgba(170, 170, 170, 0.5)' : 'rgba(110, 110, 110, 0.75)', '#777777')
        ctx.restore()
        if (!petal) ProceduralTextures.leafVeins(ctx, length, width, false, 'rgba(0, 0, 0, 0)', '#7a7a7a')
        return ProceduralTextures.finish(canvas, true, anisotropy)
    }

    /**
     * Seamless carpet of fallen leaves or petals, painted onto the terrain. Not a color texture:
     * red picks the palette color of a leaf, green is its brightness (darker veins), blue a random
     * id compared with the local leaf density, alpha the leaf shape
     */
    static fallenLeaves(petal: boolean, anisotropy: number): CanvasTexture {
        const size: number = 1024
        const [canvas, ctx] = ProceduralTextures.createCanvas(size, size)
        const random: Random = new Random(petal ? 7373 : 9191)
        const count: number = petal ? 5200 : 1500
        for (let i: number = 0; i < count; i++) {
            const x: number = random.next() * size
            const y: number = random.next() * size
            const angle: number = random.next() * Math.PI * 2
            const length: number = petal ? random.range(8, 13) : random.range(18, 30)
            const width: number = length * (petal ? random.range(0.8, 1.0) : random.range(0.42, 0.55))
            const pick: number = Math.floor(random.next() * 255)
            const shade: number = random.range(0.3, 1)
            const id: number = Math.floor(random.next() * 255)
            // Drawn at every wrapped position so the texture tiles without seams
            for (let ox: number = -size; ox <= size; ox += size) {
                for (let oy: number = -size; oy <= size; oy += size) {
                    if (Math.abs(x + ox - size / 2) > size / 2 + length * 1.4 || Math.abs(y + oy - size / 2) > size / 2 + length * 1.4) continue
                    ctx.save()
                    ctx.translate(x + ox, y + oy)
                    ctx.rotate(angle)
                    ProceduralTextures.leafPath(ctx, length, width, petal)
                    ctx.fillStyle = `rgb(${pick}, ${Math.floor(shade * 255)}, ${id})`
                    ctx.fill()
                    ProceduralTextures.leafPath(ctx, length, width, petal)
                    ctx.save()
                    ctx.clip()
                    const vein: string = `rgb(${pick}, ${Math.floor(shade * (petal ? 0.85 : 0.6) * 255)}, ${id})`
                    ProceduralTextures.leafVeins(ctx, length, width, petal, vein, vein)
                    ctx.restore()
                    if (!petal) ProceduralTextures.leafVeins(ctx, length, width, false, 'rgba(0, 0, 0, 0)', `rgb(${pick}, ${Math.floor(shade * 0.5 * 255)}, ${id})`)
                    ctx.restore()
                }
            }
        }
        const texture: CanvasTexture = ProceduralTextures.finish(canvas, false, anisotropy)
        texture.wrapS = RepeatWrapping
        texture.wrapT = RepeatWrapping
        return texture
    }

    /** Dry desert shrub: branching twigs from the center with sparse tiny leaves */
    static dryBush(anisotropy: number): CanvasTexture {
        const size: number = 512
        const [canvas, ctx] = ProceduralTextures.createCanvas(size, size)
        const random: Random = new Random(5151)

        // Recursive twig: each branch splits into two thinner ones
        const twig: (x: number, y: number, angle: number, length: number, width: number, depth: number) => void =
            (x: number, y: number, angle: number, length: number, width: number, depth: number): void => {
                const ex: number = x + Math.cos(angle) * length
                const ey: number = y + Math.sin(angle) * length
                ctx.strokeStyle = `hsl(${random.range(22, 34)}, ${random.range(20, 35)}%, ${random.range(14, 26)}%)`
                ctx.lineWidth = width
                ctx.lineCap = 'round'
                ctx.beginPath()
                ctx.moveTo(x, y)
                ctx.lineTo(ex, ey)
                ctx.stroke()
                if (depth >= 5) {
                    for (let i: number = 0; i < 3; i++) {
                        ctx.fillStyle = `hsl(${random.range(45, 75)}, ${random.range(18, 32)}%, ${random.range(24, 38)}%)`
                        ctx.beginPath()
                        ctx.ellipse(ex + random.range(-5, 5), ey + random.range(-5, 5), random.range(2.5, 4.5), random.range(1.5, 2.5), random.next() * Math.PI, 0, Math.PI * 2)
                        ctx.fill()
                    }
                    return
                }
                twig(ex, ey, angle - random.range(0.25, 0.6), length * random.range(0.62, 0.8), width * 0.68, depth + 1)
                twig(ex, ey, angle + random.range(0.25, 0.6), length * random.range(0.62, 0.8), width * 0.68, depth + 1)
            }
        for (let i: number = 0; i < 7; i++) {
            twig(size / 2 + random.range(-20, 20), size, -Math.PI / 2 + random.range(-0.8, 0.8), size * random.range(0.17, 0.24), 5, 0)
        }
        const texture: CanvasTexture = ProceduralTextures.finish(canvas, true, anisotropy)
        texture.wrapS = ClampToEdgeWrapping
        texture.wrapT = ClampToEdgeWrapping
        return texture
    }

    /** Tuft of grass blades, base at the bottom */
    static grassBlades(anisotropy: number): CanvasTexture {
        const width: number = 256
        const height: number = 256
        const [canvas, ctx] = ProceduralTextures.createCanvas(width, height)
        const random: Random = new Random(909)
        for (let i: number = 0; i < 70; i++) {
            const base_x: number = random.range(20, width - 20)
            const blade_h: number = random.range(0.45, 0.98) * height
            const bend: number = random.range(-50, 50)
            const blade_w: number = random.range(3, 6)
            const gradient: CanvasGradient = ctx.createLinearGradient(0, height, 0, height - blade_h)
            const hue: number = random.range(65, 100)
            gradient.addColorStop(0, `hsl(${hue}, 35%, 7%)`)
            gradient.addColorStop(1, `hsl(${hue}, ${random.range(30, 50)}%, ${random.range(22, 36)}%)`)
            ctx.fillStyle = gradient
            ctx.beginPath()
            ctx.moveTo(base_x - blade_w, height)
            ctx.quadraticCurveTo(base_x - blade_w * 0.5 + bend * 0.4, height - blade_h * 0.55, base_x + bend, height - blade_h)
            ctx.quadraticCurveTo(base_x + blade_w * 0.5 + bend * 0.4, height - blade_h * 0.55, base_x + blade_w, height)
            ctx.closePath()
            ctx.fill()
        }
        const texture: CanvasTexture = ProceduralTextures.finish(canvas, true, anisotropy)
        texture.wrapS = ClampToEdgeWrapping
        texture.wrapT = ClampToEdgeWrapping
        return texture
    }

    /**
     * Road markings: left half of the texture is a solid line, right half is a dash
     * (3 m of paint per 9 m period when repeated along V)
     */
    static roadMarkings(anisotropy: number): CanvasTexture {
        const [canvas, ctx] = ProceduralTextures.createCanvas(64, 192)
        ctx.clearRect(0, 0, 64, 192)
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(4, 0, 24, 192)
        ctx.fillRect(36, 0, 24, 64)
        const texture: CanvasTexture = ProceduralTextures.finish(canvas, true, anisotropy)
        texture.wrapS = ClampToEdgeWrapping
        texture.wrapT = RepeatWrapping
        return texture
    }

    /** Soft round sprite for spray and fog */
    static softSprite(): CanvasTexture {
        const size: number = 128
        const [canvas, ctx] = ProceduralTextures.createCanvas(size, size)
        const gradient: CanvasGradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
        gradient.addColorStop(0, 'rgba(255,255,255,1)')
        gradient.addColorStop(0.4, 'rgba(255,255,255,0.45)')
        gradient.addColorStop(1, 'rgba(255,255,255,0)')
        ctx.fillStyle = gradient
        ctx.fillRect(0, 0, size, size)
        return ProceduralTextures.finish(canvas, false, 1)
    }

    /**
     * Seamless single-channel fractal value noise.
     * Used as the puddle mask and for large-scale ground color variation.
     */
    static tileableNoise(size: number, base_period: number, octaves: number, seed: number): Texture {
        const data: Uint8Array = new Uint8Array(size * size)
        const accum: Float32Array = new Float32Array(size * size)
        let amplitude: number = 1
        let period: number = base_period
        let total: number = 0
        for (let o: number = 0; o < octaves; o++) {
            const random: Random = new Random(seed + o * 7919)
            const lattice: Float32Array = new Float32Array(period * period)
            for (let i: number = 0; i < lattice.length; i++) lattice[i] = random.next()
            for (let y: number = 0; y < size; y++) {
                for (let x: number = 0; x < size; x++) {
                    // Smoothed bilinear interpolation over a periodic lattice
                    const fx: number = (x / size) * period
                    const fy: number = (y / size) * period
                    const x0: number = Math.floor(fx)
                    const y0: number = Math.floor(fy)
                    const tx: number = fx - x0
                    const ty: number = fy - y0
                    const sx: number = tx * tx * (3 - 2 * tx)
                    const sy: number = ty * ty * (3 - 2 * ty)
                    const x1: number = (x0 + 1) % period
                    const y1: number = (y0 + 1) % period
                    const a: number = lattice[y0 * period + x0]
                    const b: number = lattice[y0 * period + x1]
                    const c: number = lattice[y1 * period + x0]
                    const d: number = lattice[y1 * period + x1]
                    const v: number = (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy
                    accum[y * size + x] += v * amplitude
                }
            }
            total += amplitude
            amplitude *= 0.5
            period *= 2
        }
        for (let i: number = 0; i < accum.length; i++) data[i] = Math.round((accum[i] / total) * 255)

        const texture: DataTexture = new DataTexture(data, size, size, RedFormat, UnsignedByteType)
        texture.wrapS = RepeatWrapping
        texture.wrapT = RepeatWrapping
        texture.minFilter = LinearMipmapLinearFilter
        texture.magFilter = LinearFilter
        texture.generateMipmaps = true
        texture.needsUpdate = true
        return texture
    }

    /**
     * Seamless fractal value noise in 0..1 as a float array, for building textures pixel by pixel
     */
    private static noiseField(width: number, height: number, period_x: number, period_y: number, octaves: number, seed: number): Float32Array {
        const accum: Float32Array = new Float32Array(width * height)
        let amplitude: number = 1
        let total: number = 0
        let px: number = period_x
        let py: number = period_y
        for (let o: number = 0; o < octaves; o++) {
            const random: Random = new Random(seed + o * 7919)
            const lattice: Float32Array = new Float32Array(px * py)
            for (let i: number = 0; i < lattice.length; i++) lattice[i] = random.next()
            for (let y: number = 0; y < height; y++) {
                const fy: number = (y / height) * py
                const y0: number = Math.floor(fy)
                const ty: number = fy - y0
                const sy: number = ty * ty * (3 - 2 * ty)
                const y1: number = (y0 + 1) % py
                for (let x: number = 0; x < width; x++) {
                    const fx: number = (x / width) * px
                    const x0: number = Math.floor(fx)
                    const tx: number = fx - x0
                    const sx: number = tx * tx * (3 - 2 * tx)
                    const x1: number = (x0 + 1) % px
                    const top: number = lattice[y0 * px + x0] + (lattice[y0 * px + x1] - lattice[y0 * px + x0]) * sx
                    const bottom: number = lattice[y1 * px + x0] + (lattice[y1 * px + x1] - lattice[y1 * px + x0]) * sx
                    accum[y * width + x] += (top + (bottom - top) * sy) * amplitude
                }
            }
            total += amplitude
            amplitude *= 0.5
            px *= 2
            py *= 2
        }
        for (let i: number = 0; i < accum.length; i++) accum[i] /= total
        return accum
    }

    /**
     * Cast-in-place concrete, one tile is 4x4 m: formwork panel seams (2 m x 1 m) with tie holes,
     * blotchy cement tone, fine grain with pores and faint rain streaks running down.
     * Returns color, normal and roughness maps sharing one height field
     */
    static concrete(anisotropy: number): { map: Texture, normal: Texture, roughness: Texture } {
        const size: number = 512
        const px_per_m: number = size / 4
        const tone: Float32Array = ProceduralTextures.noiseField(size, size, 4, 4, 5, 7301)
        const grain: Float32Array = ProceduralTextures.noiseField(size, size, 64, 64, 2, 7411)
        const streak: Float32Array = ProceduralTextures.noiseField(size, size, 48, 3, 3, 7523)
        const height: Float32Array = new Float32Array(size * size)
        const random: Random = new Random(7607)

        for (let i: number = 0; i < height.length; i++) height[i] = 0.5 + (grain[i] - 0.5) * 0.35
        // Formwork seams: a shallow groove every 2 m across and 1 m down
        for (let y: number = 0; y < size; y++) {
            for (let x: number = 0; x < size; x++) {
                const dx: number = Math.abs(((x + 1) % (px_per_m * 2)) - 1)
                const dy: number = Math.abs(((y + 1) % px_per_m) - 1)
                const d: number = Math.min(dx, dy)
                if (d < 2) height[y * size + x] -= (2 - d) * 0.18
            }
        }
        // Tie-rod holes in the formwork panels and small air pores
        const dent = (cx: number, cy: number, radius: number, depth: number): void => {
            const r: number = Math.ceil(radius)
            for (let oy: number = -r; oy <= r; oy++) {
                for (let ox: number = -r; ox <= r; ox++) {
                    const d: number = Math.sqrt(ox * ox + oy * oy) / radius
                    if (d >= 1) continue
                    const x: number = (((Math.round(cx) + ox) % size) + size) % size
                    const y: number = (((Math.round(cy) + oy) % size) + size) % size
                    height[y * size + x] -= depth * (1 - d * d)
                }
            }
        }
        for (let ty: number = 0; ty < 4; ty++) {
            for (let tx: number = 0; tx < 4; tx++) dent((tx + 0.5) * px_per_m, (ty + 0.5) * px_per_m, 3.2, 0.5)
        }
        for (let k: number = 0; k < 900; k++) dent(random.next() * size, random.next() * size, random.range(0.6, 1.6), random.range(0.15, 0.4))

        const [canvas, ctx] = ProceduralTextures.createCanvas(size, size)
        const [rough_canvas, rough_ctx] = ProceduralTextures.createCanvas(size, size)
        const [normal_canvas, normal_ctx] = ProceduralTextures.createCanvas(size, size)
        const color: ImageData = ctx.createImageData(size, size)
        const rough: ImageData = rough_ctx.createImageData(size, size)
        const normal: ImageData = normal_ctx.createImageData(size, size)
        for (let y: number = 0; y < size; y++) {
            for (let x: number = 0; x < size; x++) {
                const i: number = y * size + x
                const h: number = height[i]
                // Rain streaks: narrow, darker vertical runs, strongest under the seams
                const run: number = Math.max(0, streak[i] - 0.55) * 2.2
                let v: number = 0.53 + (tone[i] - 0.5) * 0.16 + (grain[i] - 0.5) * 0.06 - run * 0.1 + (h - 0.5) * 0.18
                v = Math.min(1, Math.max(0, v))
                color.data[i * 4] = Math.round(v * 255 * 1.0)
                color.data[i * 4 + 1] = Math.round(v * 255 * 0.985)
                color.data[i * 4 + 2] = Math.round(v * 255 * 0.95)
                color.data[i * 4 + 3] = 255
                const r: number = Math.min(1, 0.82 + (0.5 - h) * 0.2 - run * 0.15 + (grain[i] - 0.5) * 0.1)
                rough.data[i * 4] = rough.data[i * 4 + 1] = rough.data[i * 4 + 2] = Math.round(r * 255)
                rough.data[i * 4 + 3] = 255
                const hx: number = height[y * size + ((x + 1) % size)] - height[y * size + ((x + size - 1) % size)]
                const hy: number = height[((y + 1) % size) * size + x] - height[((y + size - 1) % size) * size + x]
                // Canvas rows go down while V goes up, hence +hy for the OpenGL normal convention
                const nx: number = -hx * 1.6
                const ny: number = hy * 1.6
                const len: number = Math.sqrt(nx * nx + ny * ny + 1)
                normal.data[i * 4] = Math.round((nx / len * 0.5 + 0.5) * 255)
                normal.data[i * 4 + 1] = Math.round((ny / len * 0.5 + 0.5) * 255)
                normal.data[i * 4 + 2] = Math.round((1 / len * 0.5 + 0.5) * 255)
                normal.data[i * 4 + 3] = 255
            }
        }
        ctx.putImageData(color, 0, 0)
        rough_ctx.putImageData(rough, 0, 0)
        normal_ctx.putImageData(normal, 0, 0)
        const textures: CanvasTexture[] = [
            ProceduralTextures.finish(canvas, true, anisotropy),
            ProceduralTextures.finish(normal_canvas, false, anisotropy),
            ProceduralTextures.finish(rough_canvas, false, anisotropy),
        ]
        for (let i: number = 0; i < textures.length; i++) {
            textures[i].wrapS = RepeatWrapping
            textures[i].wrapT = RepeatWrapping
        }
        return { map: textures[0], normal: textures[1], roughness: textures[2] }
    }

    /**
     * Galvanized steel for guardrails: zinc spangle mottling and long rolling marks along the beam.
     * U runs across the profile, V along the rail (one tile is 4 m)
     */
    static galvanized(anisotropy: number): CanvasTexture {
        const width: number = 64
        const height: number = 512
        const spangle: Float32Array = ProceduralTextures.noiseField(width, height, 8, 64, 3, 8111)
        const rolling: Float32Array = ProceduralTextures.noiseField(width, height, 16, 2, 2, 8221)
        const [canvas, ctx] = ProceduralTextures.createCanvas(width, height)
        const image: ImageData = ctx.createImageData(width, height)
        for (let i: number = 0; i < width * height; i++) {
            const v: number = 0.82 + (spangle[i] - 0.5) * 0.22 + (rolling[i] - 0.5) * 0.12
            const c: number = Math.round(Math.min(1, Math.max(0, v)) * 255)
            image.data[i * 4] = c
            image.data[i * 4 + 1] = c
            image.data[i * 4 + 2] = Math.min(255, c + 3)
            image.data[i * 4 + 3] = 255
        }
        ctx.putImageData(image, 0, 0)
        const texture: CanvasTexture = ProceduralTextures.finish(canvas, true, anisotropy)
        texture.wrapS = RepeatWrapping
        texture.wrapT = RepeatWrapping
        return texture
    }
}
