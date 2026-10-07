import {
    Box3, Color, Group, IUniform, Material, Matrix4, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, Object3D,
    PointLight, SpotLight, Vector3, WebGLProgramParametersWithUniforms,
} from 'three'
import { GLTF } from 'three/addons/loaders/GLTFLoader.js'
import { SHADOW_LAYER } from '../world/Vegetation'
import { WheelAxle } from './WheelAxle'

/** Wheel prepared for animation */
export interface CarWheel {
    /** Steering node (rotation around Y) */
    steer: Group
    /** Wheel spin node (rotation around X) */
    spin: Group
    radius: number
    front: boolean
    left: boolean
    rest_y: number
}

/** Real length of the Porsche 911 (930) Turbo, m */
const CAR_LENGTH: number = 4.29
const WHEEL_MATERIALS: string[] = ['930_rim', '930_tire']
const LIGHT_MATERIALS: string[] = ['930_lights', '930_lights_refraction']
/** Headlight spotlight intensity at night, cd */
const HEADLIGHT_INTENSITY: number = 320

/**
 * Porsche 911 visual model: glTF normalization, wheels, headlights and brake lights.
 * Local coordinate system: forward +Z, up +Y, tire bottoms at y = 0.
 */
export class CarModel {
    readonly root: Group = new Group()
    /** Body, tilted by the suspension independently of the root */
    readonly body: Group = new Group()
    readonly wheels: CarWheel[] = []
    readonly length: number = CAR_LENGTH
    width: number = 1.8
    wheelbase: number = 2.27

    private brake_uniform: IUniform<number> = { value: 0 }
    private tail_lights: PointLight[] = []
    private head_lights: SpotLight[] = []
    private light_level: number = 1

    constructor(gltf: GLTF) {
        this.root.name = 'porsche-911'
        this.root.add(this.body)
        const model: Object3D = gltf.scene
        this.body.add(model)

        this.normalize(model)
        this.upgradeMaterials(model)
        this.setupWheels(model)
        this.setupLamps(model)
        this.createLights()

        model.traverse((object: Object3D): void => {
            const mesh: Mesh = object as Mesh
            if (!mesh.isMesh) return
            mesh.castShadow = true
            mesh.receiveShadow = true
        })
    }

    private static materialName(mesh: Mesh): string {
        const material: Material = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as Material
        return material.name
    }

    /**
     * Scales the model to real length, turns it nose toward +Z
     * and puts the wheels at y = 0. Bounds are computed from the body and wheels only,
     * because the source contains helper meshes with outlier coordinates.
     */
    private normalize(model: Object3D): void {
        model.updateMatrixWorld(true)
        const box: Box3 = this.measure(model, ['coat', 'paint', ...WHEEL_MATERIALS])
        const size: Vector3 = box.getSize(new Vector3())

        // The car's long axis must run along Z
        if (size.x > size.z) model.rotation.y = Math.PI / 2
        model.updateMatrixWorld(true)

        // The 911 is rear-engined and its rear overhang is noticeably longer than the front:
        // the nose is where the wheels are closer to the body edge
        const wheels: Box3[] = this.wheelBoxes(model)
        const body: Box3 = this.measure(model, ['coat', 'paint'])
        if (wheels.length >= 4) {
            let overhang_plus: number = Infinity
            let overhang_minus: number = Infinity
            for (let i: number = 0; i < wheels.length; i++) {
                const center: Vector3 = wheels[i].getCenter(new Vector3())
                overhang_plus = Math.min(overhang_plus, body.max.z - center.z)
                overhang_minus = Math.min(overhang_minus, center.z - body.min.z)
            }
            if (overhang_plus > overhang_minus) model.rotation.y += Math.PI
        }
        model.updateMatrixWorld(true)

        const oriented: Box3 = this.measure(model, ['coat', 'paint', ...WHEEL_MATERIALS])
        const oriented_size: Vector3 = oriented.getSize(new Vector3())
        const scale: number = CAR_LENGTH / oriented_size.z
        model.scale.multiplyScalar(scale)
        model.updateMatrixWorld(true)

        const scaled: Box3 = this.measure(model, ['coat', 'paint', ...WHEEL_MATERIALS])
        const center: Vector3 = scaled.getCenter(new Vector3())
        model.position.set(-center.x, -scaled.min.y, -center.z)
        model.updateMatrixWorld(true)
        this.width = scaled.max.x - scaled.min.x

        // Hide helper meshes far outside the body (shadow planes, outliers)
        const limit: Box3 = scaled.clone().translate(model.position).expandByScalar(0.6)
        model.traverse((object: Object3D): void => {
            const mesh: Mesh = object as Mesh
            if (!mesh.isMesh) return
            if (CarModel.materialName(mesh) === 'material_0') {
                mesh.visible = false
                return
            }
            const mesh_box: Box3 = new Box3().setFromObject(mesh)
            if (!limit.containsBox(mesh_box) && mesh_box.getSize(new Vector3()).length() > CAR_LENGTH * 1.6) mesh.visible = false
        })
    }

    private measure(model: Object3D, materials: string[]): Box3 {
        const box: Box3 = new Box3()
        model.traverse((object: Object3D): void => {
            const mesh: Mesh = object as Mesh
            if (mesh.isMesh && materials.indexOf(CarModel.materialName(mesh)) >= 0) box.expandByObject(mesh)
        })
        return box
    }

    private wheelBoxes(model: Object3D): Box3[] {
        const boxes: Box3[] = []
        model.traverse((object: Object3D): void => {
            const mesh: Mesh = object as Mesh
            if (mesh.isMesh && CarModel.materialName(mesh) === '930_tire') boxes.push(new Box3().setFromObject(mesh))
        })
        return boxes
    }

    /** Body paint with a clearcoat layer, glass and chrome, tuned for a wet scene */
    private upgradeMaterials(model: Object3D): void {
        model.traverse((object: Object3D): void => {
            const mesh: Mesh = object as Mesh
            if (!mesh.isMesh) return
            const source: MeshStandardMaterial = mesh.material as MeshStandardMaterial
            const name: string = source.name
            if (name === 'paint' || name === 'coat') {
                const paint: MeshPhysicalMaterial = new MeshPhysicalMaterial()
                MeshStandardMaterial.prototype.copy.call(paint, source)
                paint.clearcoat = 1
                paint.clearcoatRoughness = 0.04
                paint.envMapIntensity = 1.4
                paint.name = name
                mesh.material = paint
            } else if (name === 'glass') {
                source.transparent = true
                source.opacity = 0.42
                source.roughness = 0.02
                source.metalness = 0
                source.envMapIntensity = 1.6
                source.depthWrite = false
            } else if (name === '930_chromes') {
                source.envMapIntensity = 1.5
            } else if (name === '930_tire') {
                source.envMapIntensity = 0.5
            }
        })
    }

    /**
     * Finds rim and tire meshes, groups them per wheel and moves them
     * into steer → spin nodes centered on the wheel axle
     */
    private setupWheels(model: Object3D): void {
        model.updateMatrixWorld(true)
        this.root.updateMatrixWorld(true)
        const inverse_root: Matrix4 = this.body.matrixWorld.clone().invert()

        interface Cluster { center: Vector3, meshes: Mesh[], radius: number, tire: Mesh | null }
        const clusters: Cluster[] = []
        model.traverse((object: Object3D): void => {
            const mesh: Mesh = object as Mesh
            if (!mesh.isMesh || WHEEL_MATERIALS.indexOf(CarModel.materialName(mesh)) < 0) return
            const box: Box3 = new Box3().setFromObject(mesh).applyMatrix4(inverse_root)
            const center: Vector3 = box.getCenter(new Vector3())
            const is_tire: boolean = CarModel.materialName(mesh) === '930_tire'
            let cluster: Cluster | undefined = clusters.find((c: Cluster): boolean => c.center.distanceTo(center) < 0.45)
            if (!cluster) {
                cluster = { center: center.clone(), meshes: [], radius: 0, tire: null }
                clusters.push(cluster)
            }
            cluster.meshes.push(mesh)
            if (is_tire) {
                cluster.center.copy(center)
                cluster.radius = (box.max.y - box.min.y) * 0.5
                cluster.tire = mesh
            }
        })

        // Wheels are the four tire clusters spread farthest apart (the spare is ignored)
        const candidates: Cluster[] = clusters.filter((c: Cluster): boolean => c.tire !== null)
        candidates.sort((a: Cluster, b: Cluster): number => Math.abs(b.center.x) - Math.abs(a.center.x))
        const chosen: Cluster[] = candidates.slice(0, 4)

        let front_z: number = 0
        let rear_z: number = 0
        for (let i: number = 0; i < chosen.length; i++) {
            const cluster: Cluster = chosen[i]
            const steer: Group = new Group()
            steer.position.copy(cluster.center)
            this.body.add(steer)
            const spin: Group = new Group()
            steer.add(spin)
            const spin_align: Group = new Group()
            spin.add(spin_align)
            const static_align: Group = new Group()
            steer.add(static_align)
            steer.updateMatrixWorld(true)

            // In the model the wheels are steered: parts on the axle spin, the rest only steer,
            // then everything is rotated so the true tire axis aligns with the X axis
            const axle: WheelAxle = WheelAxle.fromTire(cluster.tire as Mesh, steer)
            for (let m: number = 0; m < cluster.meshes.length; m++) {
                const mesh: Mesh = cluster.meshes[m]
                if (axle.isRotating(mesh, steer)) spin_align.attach(mesh)
                else static_align.attach(mesh)
            }
            spin_align.quaternion.copy(axle.alignment)
            static_align.quaternion.copy(axle.alignment)
            const front: boolean = cluster.center.z > 0
            if (front) front_z = cluster.center.z
            else rear_z = cluster.center.z
            this.wheels.push({
                steer: steer,
                spin: spin,
                radius: cluster.radius,
                front: front,
                left: cluster.center.x > 0,
                rest_y: cluster.center.y,
            })
        }
        if (front_z !== 0 && rear_z !== 0) this.wheelbase = front_z - rear_z
    }

    /**
     * Headlights and taillights: the lens texture itself glows. Front/rear is determined
     * in the shader from the vertex position in car space, because
     * some light meshes combine front and rear elements.
     */
    private setupLamps(model: Object3D): void {
        model.updateMatrixWorld(true)
        const inverse_body: Matrix4 = this.body.matrixWorld.clone().invert()
        const brake: IUniform<number> = this.brake_uniform
        model.traverse((object: Object3D): void => {
            const mesh: Mesh = object as Mesh
            if (!mesh.isMesh || LIGHT_MATERIALS.indexOf(CarModel.materialName(mesh)) < 0) return
            const source: MeshStandardMaterial = mesh.material as MeshStandardMaterial
            const material: MeshStandardMaterial = source.clone()
            material.emissive = new Color(1, 1, 1)
            material.emissiveMap = source.map
            material.emissiveIntensity = 1
            const to_car: IUniform<Matrix4> = { value: new Matrix4().multiplyMatrices(inverse_body, mesh.matrixWorld) }
            material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms): void => {
                shader.uniforms.uToCar = to_car
                shader.uniforms.uBrake = brake
                shader.vertexShader = shader.vertexShader
                    .replace('#include <common>', '#include <common>\nuniform mat4 uToCar;\nvarying float vCarZ;\nvarying float vCarNormalZ;')
                    .replace('#include <begin_vertex>', `#include <begin_vertex>
                        vCarZ = (uToCar * vec4(position, 1.0)).z;
                        vCarNormalZ = normalize(mat3(uToCar) * objectNormal).z;`)
                shader.fragmentShader = shader.fragmentShader
                    .replace('#include <common>', '#include <common>\nuniform float uBrake;\nvarying float vCarZ;\nvarying float vCarNormalZ;')
                    .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
                        // Only outward-facing faces glow: headlights forward, taillights backward
                        float lampFront = step(0.0, vCarZ);
                        float facing = mix(smoothstep(0.0, 0.6, -vCarNormalZ), smoothstep(0.55, 0.9, vCarNormalZ), lampFront);
                        float tailMask = max(totalEmissiveRadiance.r - max(totalEmissiveRadiance.g, totalEmissiveRadiance.b) * 0.6, 0.0);
                        vec3 lampTail = vec3(1.0, 0.03, 0.015) * (tailMask * 3.0 + 0.02) * mix(9.0, 40.0, uBrake);
                        vec3 lampHead = vec3(1.0, 0.93, 0.82) * dot(totalEmissiveRadiance, vec3(0.333)) * 6.0;
                        totalEmissiveRadiance = mix(lampTail, lampHead, lampFront) * facing * float(gl_FrontFacing);`)
            }
            material.customProgramCacheKey = (): string => `car-lamp-${mesh.uuid}`
            mesh.material = material
        })
    }

    /** Actual light sources: two headlight spotlights and red taillight glow */
    private createLights(): void {
        const front_z: number = this.length * 0.5 + 0.05
        for (let side: number = -1; side <= 1; side += 2) {
            const light: SpotLight = new SpotLight(0xfff1dc, HEADLIGHT_INTENSITY, 140, 0.46, 0.6, 1.5)
            light.position.set(side * 0.62, 0.72, front_z)
            light.target.position.set(side * 0.9, -0.6, front_z + 30)
            light.castShadow = side < 0
            light.shadow.mapSize.set(1024, 1024)
            light.shadow.bias = -0.0004
            light.shadow.normalBias = 0.02
            light.shadow.camera.near = 0.5
            light.shadow.camera.far = 140
            light.shadow.camera.layers.enable(SHADOW_LAYER)
            this.root.add(light)
            this.root.add(light.target)
            this.head_lights.push(light)
        }
        for (let side: number = -1; side <= 1; side += 2) {
            const tail: PointLight = new PointLight(0xff1a0a, 2.5, 10, 1.4)
            tail.position.set(side * 0.6, 0.75, -this.length * 0.5 - 0.9)
            this.root.add(tail)
            this.tail_lights.push(tail)
        }
    }

    /** Brake light brightness: 0 is tail lights, 1 is braking */
    setBrake(amount: number): void {
        this.brake_uniform.value = amount
        for (let i: number = 0; i < this.tail_lights.length; i++) this.tail_lights[i].intensity = 2.5 * this.light_level + amount * 5
    }

    /** Headlight and tail light glow strength relative to night: in daylight their light on the road is barely visible */
    setHeadlightLevel(level: number): void {
        this.light_level = level
        for (let i: number = 0; i < this.head_lights.length; i++) this.head_lights[i].intensity = HEADLIGHT_INTENSITY * level
    }
}
