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

        const needle: (x: number, y: number, angle: number, length: number) => void = (x: number, y: number, angle: number, length: number): void => {
            const hue: number = random.range(95, 130)
            const light: number = random.range(9, 24)
            ctx.strokeStyle = `hsl(${hue}, ${random.range(30, 55)}%, ${light}%)`
            ctx.lineWidth = random.range(1.6, 2.8)
            ctx.beginPath()
            ctx.moveTo(x, y)
            ctx.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length)
            ctx.stroke()
        }

        // Side twigs get shorter from base to tip
        const twig_count: number = 15
        for (let k: number = 0; k < twig_count; k++) {
            const f: number = k / twig_count
            const y: number = size * (0.95 - f * 0.88)
            const twig_len: number = size * (0.42 - f * 0.3) * random.range(0.8, 1.1)
            for (let side: number = -1; side <= 1; side += 2) {
                const angle: number = -Math.PI / 2 + side * random.range(0.75, 1.05)
                const ex: number = cx + Math.cos(angle) * twig_len
                const ey: number = y + Math.sin(angle) * twig_len
                ctx.strokeStyle = '#2b2116'
                ctx.lineWidth = 3 - f * 2
                ctx.beginPath()
                ctx.moveTo(cx, y)
                ctx.lineTo(ex, ey)
                ctx.stroke()
                const needles: number = Math.floor(twig_len / 3.2)
                for (let n: number = 0; n < needles; n++) {
                    const t: number = n / needles
                    const nx: number = cx + (ex - cx) * t
                    const ny: number = y + (ey - y) * t
                    const len: number = random.range(12, 22) * (1 - t * 0.4)
                    needle(nx, ny, angle - 0.9 + random.range(-0.3, 0.3), len)
                    needle(nx, ny, angle + 0.9 + random.range(-0.3, 0.3), len)
                }
            }
        }

        // Central stem with needles
        ctx.strokeStyle = '#30241a'
        ctx.lineWidth = 6
        ctx.beginPath()
        ctx.moveTo(cx, size)
        ctx.lineTo(cx, size * 0.03)
        ctx.stroke()
        for (let n: number = 0; n < 140; n++) {
            const y: number = size * (1 - n / 140 * 0.97)
            needle(cx, y, -Math.PI / 2 - 0.8 + random.range(-0.3, 0.3), random.range(12, 24))
            needle(cx, y, -Math.PI / 2 + 0.8 + random.range(-0.3, 0.3), random.range(12, 24))
        }
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
}
