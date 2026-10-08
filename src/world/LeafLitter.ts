import {
    BufferGeometry, Color, DoubleSide, DynamicDrawUsage, Euler, Float32BufferAttribute, InstancedBufferAttribute, InstancedMesh,
    Matrix4, MeshStandardMaterial, Quaternion, Texture, Vector3,
} from 'three'
import { Random } from '../core/Random'
import { ProceduralTextures } from '../render/ProceduralTextures'
import { RoadProjection } from './RoadTypes'
import { DrivePoint, WorldSurface } from './WorldSurface'
import { ROAD_HALF_WIDTH } from './WorldConfig'

/** Slots for leaves lying on the road (and those kicked up from it) */
const LITTER_SLOTS: number = 400
/** Slots for leaves carried by the wind */
const WIND_SLOTS: number = 150
const TOTAL: number = LITTER_SLOTS + WIND_SLOTS

const IDLE: number = 0
const RESTING: number = 1
const FLYING: number = 2
const WIND: number = 3

/** Leaves are scattered this far ahead of the car, m */
const SPAWN_NEAR: number = 45
const SPAWN_FAR: number = 90
/** A leaf left this far behind the car is moved ahead again, m */
const RECYCLE_BEHIND: number = 40
/** Wind leaves live in this radius around the camera, m */
const WIND_RADIUS: number = 70
/** Car body half sizes for the airflow around it, m */
const CAR_HALF_WIDTH: number = 1.0
const CAR_HALF_LENGTH: number = 2.3
/** Lamb–Oseen vortex peak factor: v(r) peaks at 0.638·Γ/(2π·rc) */
const VORTEX_PEAK: number = 0.638
/** Prevailing wind direction, the same one rain and snow drift along */
const WIND_DIRECTION: Vector3 = new Vector3(1.4, 0, 0.6).normalize()
/** Spawn attempts per frame while driving */
const SPAWN_BUDGET: number = 50

/**
 * Fallen leaves and petals: they lie on the road, get sucked into the airflow behind
 * a passing car, swirl in its trailing vortices and flutter back down;
 * in bad weather the wind carries leaves through the air.
 * All leaves are one InstancedMesh lit like the rest of the scene.
 */
export class LeafLitter {
    readonly mesh: InstancedMesh
    private material: MeshStandardMaterial
    /** Textures of a leaf and of a cherry petal */
    private sprites: [Texture, Texture]
    private positions: Float32Array = new Float32Array(TOTAL * 3)
    private velocities: Float32Array = new Float32Array(TOTAL * 3)
    private rotations: Float32Array = new Float32Array(TOTAL * 3)
    private spins: Float32Array = new Float32Array(TOTAL * 3)
    private grounds: Float32Array = new Float32Array(TOTAL)
    private ground_timers: Float32Array = new Float32Array(TOTAL)
    private scales: Float32Array = new Float32Array(TOTAL)
    private ages: Float32Array = new Float32Array(TOTAL)
    private lives: Float32Array = new Float32Array(TOTAL)
    private phases: Float32Array = new Float32Array(TOTAL)
    /** Air speed that tears a resting leaf off the ground, m/s */
    private thresholds: Float32Array = new Float32Array(TOTAL)
    private states: Uint8Array = new Uint8Array(TOTAL)
    private random: Random = new Random(4242)
    private litter_count: number = 0
    private wind_count: number = 0
    private wind_level: number = 0
    private size: number = 1
    private palette: Color[] = [new Color(0x8a6a32)]
    private refill: boolean = true
    private last_car: Vector3 = new Vector3(Number.NaN, 0, Number.NaN)
    private time: number = 0

    private matrix: Matrix4 = new Matrix4()
    private position: Vector3 = new Vector3()
    private quaternion: Quaternion = new Quaternion()
    private euler: Euler = new Euler()
    private scale: Vector3 = new Vector3()
    private heading: Vector3 = new Vector3()
    private color: Color = new Color()
    private air: Vector3 = new Vector3()
    /** Car state for the airflow field, captured once per frame */
    private car_position: Vector3 = new Vector3()
    private car_speed: number = 0

    constructor() {
        this.sprites = [ProceduralTextures.leafSprite(false, 4), ProceduralTextures.leafSprite(true, 4)]
        this.material = new MeshStandardMaterial({ map: this.sprites[0], alphaTest: 0.5, side: DoubleSide, roughness: 0.78, metalness: 0 })
        this.mesh = new InstancedMesh(LeafLitter.leafGeometry(), this.material, TOTAL)
        this.mesh.instanceMatrix.setUsage(DynamicDrawUsage)
        this.mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(TOTAL * 3), 3)
        this.mesh.frustumCulled = false
        this.mesh.receiveShadow = true
        this.mesh.castShadow = false
        this.mesh.count = 0
        this.mesh.name = 'leaves'
    }

    /**
     * litter — share of leaves on the road, wind — share of leaves in the air,
     * size — leaf size multiplier (petals are smaller), palette — leaf colors
     */
    configure(litter: number, wind: number, size: number, palette: Color[]): void {
        this.litter_count = Math.round(LITTER_SLOTS * Math.min(1, Math.max(0, litter)))
        this.wind_count = Math.round(WIND_SLOTS * Math.min(1, Math.max(0, wind)))
        this.wind_level = wind
        this.size = size
        this.palette = palette.length > 0 ? palette : [new Color(0x8a6a32)]
        this.material.map = this.sprites[size < 1 ? 1 : 0]
        this.states.fill(IDLE)
        this.refill = true
    }

    update(dt: number, surface: WorldSurface, car: Vector3, yaw: number, car_velocity: Vector3, speed: number, camera: Vector3): void {
        this.time += dt
        // The road ahead is where the car is heading; standing still, where its nose points
        if (speed > 2) this.heading.set(car_velocity.x, 0, car_velocity.z).normalize()
        else this.heading.set(Math.sin(yaw), 0, Math.cos(yaw))
        // After a teleport (respawn, restored session) leaves are scattered anew around the car
        if (Number.isNaN(this.last_car.x) || Math.hypot(car.x - this.last_car.x, car.z - this.last_car.z) > 60) this.refill = true
        this.last_car.copy(car)
        this.car_position.copy(car)
        this.car_speed = speed

        const gust: number = 1 + Math.sin(this.time * 0.7) * 0.35 + Math.sin(this.time * 1.9 + 1.3) * 0.2
        const wind_speed: number = (1.5 + this.wind_level * 9) * gust
        const wind_x: number = WIND_DIRECTION.x * wind_speed
        const wind_z: number = WIND_DIRECTION.z * wind_speed

        const fill: boolean = this.refill
        this.refill = false
        let budget: number = fill ? LITTER_SLOTS * 3 : SPAWN_BUDGET
        if (fill) for (let i: number = 0; i < LITTER_SLOTS; i++) this.states[i] = IDLE

        for (let i: number = 0; i < LITTER_SLOTS; i++) {
            if (i >= this.litter_count) {
                this.states[i] = IDLE
                continue
            }
            if (this.states[i] === IDLE) {
                if (budget > 0) {
                    budget--
                    this.spawnLitter(i, surface, car, fill)
                }
                continue
            }
            const i3: number = i * 3
            const ex: number = this.positions[i3] - car.x
            const ez: number = this.positions[i3 + 2] - car.z
            const ahead: number = ex * this.heading.x + ez * this.heading.z
            // A leaf still in the air is left alone a while longer, so it never vanishes mid-flight
            const behind_limit: number = this.states[i] === FLYING ? RECYCLE_BEHIND * 2.5 : RECYCLE_BEHIND
            if (ahead < -behind_limit || ex * ex + ez * ez > SPAWN_FAR * SPAWN_FAR * 1.2) {
                this.states[i] = IDLE
                continue
            }
            if (this.states[i] === RESTING) {
                // The leaf stays put until the air around the car is strong enough to tear it off
                if (this.carAir(this.positions[i3], this.positions[i3 + 1], this.positions[i3 + 2], this.air) > this.thresholds[i]) this.liftOff(i)
                continue
            }
            this.fly(i, dt, surface, wind_x * 0.6, wind_z * 0.6)
        }

        budget = fill ? WIND_SLOTS : SPAWN_BUDGET
        for (let i: number = LITTER_SLOTS; i < TOTAL; i++) {
            if (i - LITTER_SLOTS >= this.wind_count) {
                this.states[i] = IDLE
                continue
            }
            if (this.states[i] === IDLE) {
                if (budget > 0) {
                    budget--
                    this.spawnWind(i, surface, camera, fill)
                }
                continue
            }
            this.blow(i, dt, surface, camera, wind_x, wind_z)
        }
        this.writeInstances()
    }

    /** Puts a leaf on the asphalt ahead of the car; more of them gather near the edges */
    private spawnLitter(i: number, surface: WorldSurface, car: Vector3, fill: boolean): void {
        const r: Random = this.random
        const distance: number = fill ? r.range(-RECYCLE_BEHIND * 0.6, SPAWN_FAR) : r.range(SPAWN_NEAR, SPAWN_FAR)
        const side: number = r.range(-14, 14)
        let x: number = car.x + this.heading.x * distance - this.heading.z * side
        let z: number = car.z + this.heading.z * distance + this.heading.x * side
        const probe: DrivePoint = surface.drive(x, z, car.y)
        const projection: RoadProjection | null = probe.projection
        if (!projection || Math.abs(projection.lateral) > 40) return
        const edge: number = ROAD_HALF_WIDTH + 0.7
        const u: number = r.next()
        const lateral: number = r.chance(0.55) ? r.sign() * edge * (1 - u * u * 0.7) : r.range(-edge, edge)
        x -= projection.right.x * (projection.lateral - lateral)
        z -= projection.right.z * (projection.lateral - lateral)
        // Leaves must not appear right in front of the camera
        if (!fill && (x - car.x) * (x - car.x) + (z - car.z) * (z - car.z) < SPAWN_NEAR * SPAWN_NEAR * 0.7) return
        const height: number = surface.drive(x, z, car.y).height
        const i3: number = i * 3
        this.positions[i3] = x
        this.positions[i3 + 1] = height + 0.012
        this.positions[i3 + 2] = z
        this.grounds[i] = height
        this.settle(i)
        this.setupLeaf(i)
        this.states[i] = RESTING
    }

    /** A leaf in the air somewhere around the camera, mostly ahead and upwind */
    private spawnWind(i: number, surface: WorldSurface, camera: Vector3, fill: boolean): void {
        const r: Random = this.random
        const distance: number = fill ? r.range(-WIND_RADIUS * 0.5, WIND_RADIUS * 0.9) : r.range(6, WIND_RADIUS * 0.75)
        const side: number = r.range(-WIND_RADIUS * 0.6, WIND_RADIUS * 0.6)
        const upwind: number = fill ? 0 : r.range(0, 25)
        const x: number = camera.x + this.heading.x * distance - this.heading.z * side - WIND_DIRECTION.x * upwind
        const z: number = camera.z + this.heading.z * distance + this.heading.x * side - WIND_DIRECTION.z * upwind
        const ground: number = surface.height(x, z)
        const i3: number = i * 3
        this.positions[i3] = x
        this.positions[i3 + 1] = ground + r.range(0.5, 3) + r.next() * r.next() * 12
        this.positions[i3 + 2] = z
        this.velocities[i3] = WIND_DIRECTION.x * 4
        this.velocities[i3 + 1] = 0
        this.velocities[i3 + 2] = WIND_DIRECTION.z * 4
        this.grounds[i] = ground
        this.ground_timers[i] = r.range(0, 0.3)
        this.rotations[i3] = r.range(0, Math.PI * 2)
        this.rotations[i3 + 1] = r.range(0, Math.PI * 2)
        this.rotations[i3 + 2] = r.range(0, Math.PI * 2)
        this.spinRandom(i, 2, 6)
        this.setupLeaf(i)
        // Leaves in the air are seen against the sky, so they are a little larger
        this.scales[i] *= 1.6
        this.lives[i] = r.range(6, 14)
        // The first leaves are already midway through their flight, so they do not all appear at once
        if (fill) this.ages[i] = r.range(0.5, this.lives[i] * 0.6)
        this.states[i] = WIND
    }

    /** Size, color and flutter phase of a new leaf */
    private setupLeaf(i: number): void {
        const r: Random = this.random
        this.scales[i] = r.range(0.16, 0.26) * this.size
        this.phases[i] = r.range(0, 100)
        this.thresholds[i] = r.range(2.5, 6) * (this.size < 1 ? 0.7 : 1)
        this.ages[i] = 0
        const base: Color = this.palette[r.int(0, this.palette.length - 1)]
        const shade: number = r.range(0.75, 1.1)
        this.color.setRGB(base.r * shade, base.g * shade * r.range(0.92, 1.06), base.b * shade)
        this.mesh.setColorAt(i, this.color)
    }

    /** Lies flat on the ground with a slight random tilt */
    private settle(i: number): void {
        const i3: number = i * 3
        this.rotations[i3] = this.random.range(-0.12, 0.12)
        this.rotations[i3 + 1] = this.random.range(0, Math.PI * 2)
        this.rotations[i3 + 2] = this.random.range(-0.12, 0.12)
        this.velocities[i3] = 0
        this.velocities[i3 + 1] = 0
        this.velocities[i3 + 2] = 0
    }

    private spinRandom(i: number, min: number, max: number): void {
        const i3: number = i * 3
        for (let k: number = 0; k < 3; k++) this.spins[i3 + k] = this.random.sign() * this.random.range(min, max)
    }

    /**
     * Air velocity induced by the car at a point, without the wind; returns its magnitude.
     * Ahead of the bumper the bow wave pushes air forward and aside, along the body it is dragged
     * with the car, and behind it the wake follows the car and holds two counter-rotating
     * trailing vortices: they sweep leaves inward along the ground, lift them up the middle
     * and throw them outward on top, all fading as the wake falls behind.
     */
    private carAir(x: number, y: number, z: number, out: Vector3): number {
        out.set(0, 0, 0)
        const speed: number = this.car_speed
        if (speed < 3) return 0
        const fx: number = this.heading.x
        const fz: number = this.heading.z
        const ex: number = x - this.car_position.x
        const ez: number = z - this.car_position.z
        const along: number = ex * fx + ez * fz
        // Lateral axis is (-fz, fx)
        const across: number = -ex * fz + ez * fx
        const height: number = y - this.car_position.y
        const behind: number = -along - CAR_HALF_LENGTH
        const wake_length: number = 5 + speed * 0.45
        const spread: number = Math.max(0, behind)
        if (along > CAR_HALF_LENGTH + 2.5 || behind > wake_length) return 0
        if (Math.abs(across) > CAR_HALF_WIDTH + 3 + spread * 0.15 || height > 3 + spread * 0.12 || height < -1) return 0

        let forward: number = 0
        let lateral: number = 0
        let up: number = 0
        if (along > CAR_HALF_LENGTH) {
            // Bow wave: a light push forward and aside, most leaves still end up under the car
            const near: number = 1 - (along - CAR_HALF_LENGTH) / 2.5
            const falloff: number = Math.exp(-Math.pow(across / (CAR_HALF_WIDTH + 0.5), 2)) * near
            forward = speed * 0.2 * falloff
            lateral = Math.sign(across) * speed * 0.1 * falloff
            up = speed * 0.04 * falloff
        } else if (behind <= 0) {
            // Along and under the body the air is dragged with the car
            const outside: number = Math.max(0, Math.abs(across) - CAR_HALF_WIDTH)
            forward = speed * 0.4 * Math.exp(-outside * outside / 0.6)
        } else {
            const decay: number = Math.exp(-behind / (wake_length * 0.45))
            const width: number = CAR_HALF_WIDTH + 0.4 + behind * 0.12
            const core_flow: number = decay * Math.exp(-Math.pow(across / width, 2))
            forward = speed * 0.55 * core_flow
            // The wake as a whole climbs away from the road
            up = speed * 0.08 * core_flow
            // Trailing vortices drift apart and rise as they fall behind the car
            const offset: number = CAR_HALF_WIDTH * 0.75 + behind * 0.1
            const center: number = 0.5 + behind * 0.08
            const core: number = 0.7 + behind * 0.05
            const peak: number = speed * 0.32 * decay
            for (let side: number = -1; side <= 1; side += 2) {
                const dc: number = across - side * offset
                const dy: number = height - center
                const r2: number = Math.max(dc * dc + dy * dy, 1e-4)
                // Lamb–Oseen profile, normalized to the peak tangential speed
                const tangential: number = peak * core * (1 - Math.exp(-r2 / (core * core))) / (VORTEX_PEAK * r2)
                // Upwash between the vortices: the right one turns one way, the left one the other
                const sense: number = -side
                lateral += -dy * tangential * sense
                up += dc * tangential * sense
            }
            // Turbulence in the wake keeps leaves from moving in lockstep
            const t: number = this.time * 7
            lateral += Math.sin(t + x * 1.7 + z * 0.9) * speed * 0.04 * decay
            up += Math.sin(t * 1.3 + z * 1.3 - x * 0.7) * speed * 0.04 * decay
        }
        out.set(fx * forward - fz * lateral, up, fz * forward + fx * lateral)
        return out.length()
    }

    private liftOff(i: number): void {
        this.positions[i * 3 + 1] += 0.02
        this.ground_timers[i] = 0
        this.spinRandom(i, 1.5, 5)
        this.states[i] = FLYING
    }

    /**
     * Leaf in the air: a light body with strong drag, so it follows the airflow
     * with a short lag and falls slowly; it tumbles faster the stronger the flow around it
     */
    private fly(i: number, dt: number, surface: WorldSurface, wind_x: number, wind_z: number): void {
        const i3: number = i * 3
        this.ages[i] += dt
        this.updateGround(i, dt, surface)
        const strength: number = this.carAir(this.positions[i3], this.positions[i3 + 1], this.positions[i3 + 2], this.air)
        const phase: number = this.time * 3.1 + this.phases[i]
        const fall: number = 1.0 + (this.phases[i] % 1) * 0.6
        // Petals are lighter than leaves and follow the air more closely
        const drag: number = this.size < 1 ? 3.4 : 2.6
        const follow: number = 1 - Math.exp(-drag * dt)
        const air_x: number = this.air.x + wind_x
        const air_y: number = this.air.y
        const air_z: number = this.air.z + wind_z
        const rel_x: number = air_x - this.velocities[i3]
        const rel_y: number = air_y - this.velocities[i3 + 1]
        const rel_z: number = air_z - this.velocities[i3 + 2]
        this.velocities[i3] += rel_x * follow + Math.cos(phase) * 2.2 * dt
        this.velocities[i3 + 1] += rel_y * follow - fall * drag * dt
        this.velocities[i3 + 2] += rel_z * follow + Math.sin(phase * 0.8) * 2.2 * dt
        const relative: number = Math.sqrt(rel_x * rel_x + rel_y * rel_y + rel_z * rel_z)
        this.integrate(i, dt, 0.5 + Math.min(relative, 20) * 0.3)
        const floor: number = this.grounds[i] + 0.012
        if (this.positions[i3 + 1] <= floor) {
            this.positions[i3 + 1] = floor
            if (strength > this.thresholds[i] * 0.6) {
                // Still in a strong flow: the leaf skids and tumbles along the asphalt
                this.velocities[i3 + 1] = Math.max(0, this.velocities[i3 + 1])
                const friction: number = Math.exp(-3 * dt)
                this.velocities[i3] *= friction
                this.velocities[i3 + 2] *= friction
            } else if (this.velocities[i3 + 1] < 0) {
                this.settle(i)
                this.states[i] = RESTING
            }
        }
    }

    /** Wind leaf: drifts with the gusts, rises and dips, skips off the ground; a passing car stirs it */
    private blow(i: number, dt: number, surface: WorldSurface, camera: Vector3, wind_x: number, wind_z: number): void {
        const i3: number = i * 3
        this.ages[i] += dt
        const dx: number = this.positions[i3] - camera.x
        const dz: number = this.positions[i3 + 2] - camera.z
        if (this.ages[i] > this.lives[i] || dx * dx + dz * dz > WIND_RADIUS * WIND_RADIUS * 1.3) {
            this.states[i] = IDLE
            return
        }
        this.updateGround(i, dt, surface)
        this.carAir(this.positions[i3], this.positions[i3 + 1], this.positions[i3 + 2], this.air)
        const phase: number = this.time + this.phases[i]
        const lift: number = Math.sin(phase * 0.9) * 1.6 + Math.sin(phase * 2.3) * 0.6 - 0.35
        const follow: number = 1 - Math.exp(-1.1 * dt)
        const individual: number = 0.75 + (this.phases[i] % 1) * 0.5
        const target_x: number = wind_x * individual + this.air.x
        const target_y: number = lift + this.air.y
        const target_z: number = wind_z * individual + this.air.z
        const rel_x: number = target_x - this.velocities[i3]
        const rel_z: number = target_z - this.velocities[i3 + 2]
        this.velocities[i3] += rel_x * follow + Math.cos(phase * 3.3) * 3 * dt
        this.velocities[i3 + 1] += (target_y - this.velocities[i3 + 1]) * (1 - Math.exp(-1.5 * dt))
        this.velocities[i3 + 2] += rel_z * follow + Math.sin(phase * 2.7) * 3 * dt
        this.integrate(i, dt, 0.8 + Math.min(Math.hypot(rel_x, rel_z), 20) * 0.15)
        // Touching the ground, the leaf bounces and tumbles on
        if (this.positions[i3 + 1] < this.grounds[i] + 0.05) {
            this.positions[i3 + 1] = this.grounds[i] + 0.05
            this.velocities[i3 + 1] = this.random.range(0.8, 3)
        }
    }

    /** spin_rate scales the leaf's own tumbling: faster in a strong flow */
    private integrate(i: number, dt: number, spin_rate: number): void {
        const i3: number = i * 3
        for (let k: number = 0; k < 3; k++) {
            this.positions[i3 + k] += this.velocities[i3 + k] * dt
            this.rotations[i3 + k] += this.spins[i3 + k] * spin_rate * dt
        }
    }

    /** Ground height under a flying leaf is refreshed a few times a second */
    private updateGround(i: number, dt: number, surface: WorldSurface): void {
        this.ground_timers[i] -= dt
        if (this.ground_timers[i] > 0) return
        this.ground_timers[i] = 0.2
        const i3: number = i * 3
        const point: DrivePoint = surface.drive(this.positions[i3], this.positions[i3 + 2], this.positions[i3 + 1])
        this.grounds[i] = point.height
    }

    private writeInstances(): void {
        let count: number = 0
        for (let i: number = 0; i < TOTAL; i++) if (this.states[i] !== IDLE) count = i + 1
        for (let i: number = 0; i < count; i++) {
            const i3: number = i * 3
            if (this.states[i] === IDLE) {
                this.matrix.makeScale(0, 0, 0)
                this.mesh.setMatrixAt(i, this.matrix)
                continue
            }
            let s: number = this.scales[i]
            // Wind leaves grow in on spawn and shrink away at the end of their life
            if (this.states[i] === WIND) s *= Math.min(1, this.ages[i] / 0.5, (this.lives[i] - this.ages[i]) / 0.6)
            this.position.set(this.positions[i3], this.positions[i3 + 1], this.positions[i3 + 2])
            this.euler.set(this.rotations[i3], this.rotations[i3 + 1], this.rotations[i3 + 2])
            this.quaternion.setFromEuler(this.euler)
            this.scale.set(s, s, s)
            this.matrix.compose(this.position, this.quaternion, this.scale)
            this.mesh.setMatrixAt(i, this.matrix)
        }
        this.mesh.count = count
        this.mesh.instanceMatrix.needsUpdate = true
        if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
    }

    /** A 1 m square in the XZ plane; the leaf shape comes from the texture */
    private static leafGeometry(): BufferGeometry {
        const geometry: BufferGeometry = new BufferGeometry()
        geometry.setAttribute('position', new Float32BufferAttribute([-0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5], 3))
        geometry.setAttribute('normal', new Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3))
        geometry.setAttribute('uv', new Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2))
        geometry.setIndex([0, 2, 1, 0, 3, 2])
        return geometry
    }
}
