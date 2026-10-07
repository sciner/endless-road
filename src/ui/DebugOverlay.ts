import { WebGLRenderer } from 'three'
import { CarPhysics } from '../vehicle/CarPhysics'
import { WorldStats } from '../world/World'
import { VegetationStats } from '../world/Vegetation'

/** Per-frame game state shown by the panel */
export interface DebugSnapshot {
    car: CarPhysics
    world: WorldStats
    seed: number
    camera_mode: number
    physics_steps: number
    pixel_ratio: number
}

interface PerformanceWithMemory extends Performance {
    memory?: { usedJSHeapSize: number, jsHeapSizeLimit: number }
}

/** How often the panel text refreshes, s */
const REFRESH_INTERVAL: number = 0.25

/**
 * Technical panel on F3: performance, render stats, world streaming and car state.
 * It is a developer tool, so it is always in English
 */
export class DebugOverlay {
    private element: HTMLElement
    private renderer: WebGLRenderer
    private gpu_name: string
    private visible: boolean = false
    private elapsed: number = 0
    private frames: number = 0
    private worst_frame: number = 0
    private fps: number = 0
    private frame_ms: number = 0
    private worst_ms: number = 0

    constructor(root: HTMLElement, renderer: WebGLRenderer) {
        this.renderer = renderer
        this.element = document.createElement('div')
        this.element.className = 'debug-overlay hidden'
        root.appendChild(this.element)
        this.gpu_name = DebugOverlay.detectGpu(renderer)
    }

    get is_visible(): boolean {
        return this.visible
    }

    setVisible(visible: boolean): void {
        this.visible = visible
        this.element.classList.toggle('hidden', !visible)
        this.elapsed = REFRESH_INTERVAL
    }

    toggle(): void {
        this.setVisible(!this.visible)
    }

    /** Counts a frame; the text is rebuilt a few times per second and only while the panel is visible */
    update(dt: number, snapshot: () => DebugSnapshot): void {
        this.frames++
        this.elapsed += dt
        this.worst_frame = Math.max(this.worst_frame, dt)
        if (this.elapsed < REFRESH_INTERVAL) return

        this.fps = this.frames / this.elapsed
        this.frame_ms = (this.elapsed / this.frames) * 1000
        this.worst_ms = this.worst_frame * 1000
        this.frames = 0
        this.elapsed = 0
        this.worst_frame = 0
        if (this.visible) this.element.innerHTML = this.build(snapshot())
    }

    private build(s: DebugSnapshot): string {
        const info: WebGLRenderer['info'] = this.renderer.info
        const memory: PerformanceWithMemory['memory'] = (performance as PerformanceWithMemory).memory
        const canvas: HTMLCanvasElement = this.renderer.domElement
        const car: CarPhysics = s.car
        const sections: string[] = [
            DebugOverlay.section('Performance', [
                ['FPS', `${this.fps.toFixed(0)}`],
                ['Frame', `${this.frame_ms.toFixed(2)} ms · worst ${this.worst_ms.toFixed(1)} ms`],
                ['Physics steps', `${s.physics_steps} × 120 Hz`],
                ['JS heap', memory ? `${DebugOverlay.megabytes(memory.usedJSHeapSize)} / ${DebugOverlay.megabytes(memory.jsHeapSizeLimit)} MB` : '—'],
            ]),
            DebugOverlay.section('Render', [
                ['GPU', this.gpu_name],
                ['Resolution', `${canvas.width} × ${canvas.height} (×${s.pixel_ratio.toFixed(2)})`],
                ['Draw calls', DebugOverlay.number(info.render.calls)],
                ['Triangles', DebugOverlay.number(info.render.triangles)],
                ['Points / lines', `${DebugOverlay.number(info.render.points)} / ${DebugOverlay.number(info.render.lines)}`],
                ['Geometries', DebugOverlay.number(info.memory.geometries)],
                ['Textures', DebugOverlay.number(info.memory.textures)],
                ['Shaders', DebugOverlay.number(info.programs ? info.programs.length : 0)],
            ]),
            DebugOverlay.section('World', [
                ['Seed', `${s.seed}`],
                ['Road segments', `${s.world.road_segments} · in scene ${s.world.road_meshes}`],
                ['Road ahead / behind', `${(s.world.road_ahead - car.along).toFixed(0)} / ${(car.along - s.world.road_behind).toFixed(0)} m`],
                ['Terrain chunks', `${s.world.terrain_chunks}`],
                ['Vegetation chunks', `${s.world.vegetation_chunks}`],
                ...s.world.vegetation.map((layer: VegetationStats): [string, string] => [
                    DebugOverlay.layerName(layer.name),
                    `${DebugOverlay.number(layer.instances)}${layer.shadow_instances > 0 ? ` · shadows ${DebugOverlay.number(layer.shadow_instances)}` : ''} · up to ${layer.fade_distance.toFixed(0)} m`,
                ]),
            ]),
            DebugOverlay.section('Car', [
                ['Position', `${car.position.x.toFixed(1)}, ${car.position.y.toFixed(1)}, ${car.position.z.toFixed(1)}`],
                ['Distance along road', `${car.along.toFixed(0)} m`],
                ['Speed', `${(car.speed * 3.6).toFixed(1)} km/h`],
                ['Gear / RPM', `${car.gear} / ${car.rpm.toFixed(0)}`],
                ['Heading / yaw rate', `${(((car.yaw * 180 / Math.PI) % 360 + 360) % 360).toFixed(1)}° / ${car.yaw_rate.toFixed(2)} rad/s`],
                ['Lateral acceleration', `${(car.lat_accel / 9.81).toFixed(2)} g`],
                ['Slip', `${(car.slip * 100).toFixed(0)}%`],
                ['Surface', `${car.on_road ? 'asphalt' : 'dirt'}${car.grounded ? '' : ' · airborne'}`],
                ['Camera', `${s.camera_mode + 1}`],
            ]),
        ]
        return sections.join('')
    }

    private static section(title: string, rows: Array<[string, string]>): string {
        const body: string = rows
            .map((row: [string, string]): string => `<div class="debug-row"><span class="debug-label">${row[0]}</span><span class="debug-value">${row[1]}</span></div>`)
            .join('')
        return `<div class="debug-section"><div class="debug-title">${title}</div>${body}</div>`
    }

    /** Layer ids such as dry_bushes become readable labels */
    private static layerName(name: string): string {
        const words: string = name.replace(/_/g, ' ')
        return words.charAt(0).toUpperCase() + words.slice(1)
    }

    private static number(value: number): string {
        return value.toLocaleString('en-US')
    }

    private static megabytes(bytes: number): string {
        return (bytes / 1048576).toFixed(0)
    }

    private static detectGpu(renderer: WebGLRenderer): string {
        const gl: WebGL2RenderingContext | WebGLRenderingContext = renderer.getContext()
        const extension: WEBGL_debug_renderer_info | null = gl.getExtension('WEBGL_debug_renderer_info')
        const name: unknown = extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)
        return String(name).replace(/^ANGLE \((.*)\)$/, '$1')
    }
}
