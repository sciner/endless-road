import { Mesh } from 'three'

export type CarId = 'porsche' | 'vintage'

/** Driving characteristics: engine, gearbox, grip and steering */
export interface CarSpec {
    /** Top speed, m/s */
    max_speed: number
    reverse_speed: number
    /** Peak engine acceleration and braking deceleration, m/s² */
    engine_accel: number
    brake_decel: number
    /** Upper speed limit of each gear, m/s */
    gear_top: number[]
    /** Grip gain from downforce per squared speed */
    downforce: number
    /** Tire grip multiplier */
    grip: number
    /** Steering lock at standstill, rad */
    max_steer: number
    idle_rpm: number
    redline_rpm: number
    /** Engine firing pulses per crankshaft revolution: half the cylinder count for a four-stroke */
    firing_per_rev: number
    /** Body pitch and roll softness: 1 is a sports car, higher is a soft classic suspension */
    body_softness: number
}

/** Where to find car parts inside the glTF and how to dress them */
export interface CarLook {
    model_path: string
    /** Real length used to scale the model, m */
    length: number
    /** Nose direction in model space; null detects it from the wheel overhangs */
    nose: 'x+' | 'x-' | null
    /** Body materials used to measure the car bounds */
    body_materials: string[]
    tire_material: string
    /** Every material that belongs to the wheels: tire, rim, hub */
    wheel_materials: string[]
    paint_materials: string[]
    glass_materials: string[]
    chrome_materials: string[]
    hidden_materials: string[]
    /** Lamp lens meshes that glow */
    isLamp: (mesh: Mesh, material: string) => boolean
    /** Lens glass is drawn opaque so the glow does not wash out */
    opaque_lamps: boolean
    /** Headlight spotlight position: half track, height and offset back from the nose, m */
    headlight: { x: number, y: number, inset: number }
    /** Taillight glow position: half track, height and offset forward from the tail, m */
    taillight: { x: number, y: number, inset: number }
    /** Driver's eye for the cockpit camera: offset back from the car center (negative is forward) and height, m */
    cockpit: CockpitView
}

export interface CockpitView {
    distance: number
    height: number
    /** Height of the aim point 12 m ahead: sets how much of the dashboard stays in view */
    look_height: number
}

export interface CarProfile {
    id: CarId
    /** Model name is a proper noun and is not translated */
    name: string
    spec: CarSpec
    look: CarLook
}

export const CAR_IDS: CarId[] = ['porsche', 'vintage']

export const CAR_PROFILES: Record<CarId, CarProfile> = {
    porsche: {
        id: 'porsche',
        name: 'Porsche 911 Turbo',
        spec: {
            max_speed: 74,
            reverse_speed: 13,
            engine_accel: 8.2,
            brake_decel: 12.5,
            gear_top: [14, 25, 37, 50, 62, 74],
            downforce: 0.0009,
            grip: 1,
            max_steer: 0.6,
            idle_rpm: 950,
            redline_rpm: 7000,
            firing_per_rev: 3,
            body_softness: 1,
        },
        look: {
            model_path: 'models/porsche911/scene.gltf',
            length: 4.29,
            nose: null,
            body_materials: ['coat', 'paint'],
            tire_material: '930_tire',
            wheel_materials: ['930_rim', '930_tire'],
            paint_materials: ['coat', 'paint'],
            glass_materials: ['glass'],
            chrome_materials: ['930_chromes'],
            hidden_materials: ['material_0'],
            isLamp: (_mesh: Mesh, material: string): boolean => material === '930_lights' || material === '930_lights_refraction',
            opaque_lamps: false,
            headlight: { x: 0.62, y: 0.72, inset: -0.05 },
            taillight: { x: 0.6, y: 0.75, inset: -0.9 },
            cockpit: { distance: -0.35, height: 1.12, look_height: 1.0 },
        },
    },
    vintage: {
        id: 'vintage',
        name: 'Vintage 1938',
        spec: {
            max_speed: 36,
            reverse_speed: 8,
            engine_accel: 4.2,
            brake_decel: 8.5,
            gear_top: [11, 19, 27, 36],
            downforce: 0.0002,
            grip: 0.9,
            max_steer: 0.55,
            idle_rpm: 650,
            redline_rpm: 4300,
            firing_per_rev: 2,
            body_softness: 2.2,
        },
        look: {
            model_path: 'models/vintage_car/vintage_car.glb',
            length: 3.95,
            nose: 'x-',
            body_materials: ['CarPaint'],
            tire_material: 'DarkRubber',
            wheel_materials: ['DarkRubber', 'WhiteRubber', 'WheelPaint', 'RoughSteel'],
            paint_materials: ['CarPaint'],
            glass_materials: ['WindowGlass'],
            chrome_materials: ['Chrome', 'RoughSteel'],
            hidden_materials: [],
            // Headlight lenses share the window glass material, so they are picked by node name
            isLamp: (mesh: Mesh): boolean => mesh.name.startsWith('08_WindowGlass'),
            opaque_lamps: true,
            headlight: { x: 0.62, y: 0.92, inset: 0.35 },
            // Behind and below the cabin: point lights cast no shadows and would tint the seats through the glass
            taillight: { x: 0.55, y: 0.3, inset: -1.1 },
            // Tall cabin far behind a long hood: the eye sits over the front bench, above the dashboard at ~1.2 m
            cockpit: { distance: 0.3, height: 1.4, look_height: 1.25 },
        },
    },
}
