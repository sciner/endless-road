import { BufferAttribute, InterleavedBufferAttribute, Matrix4, Mesh, Object3D, Quaternion, Vector3 } from 'three'

/**
 * Geometric wheel analysis: the true tire spin axis and
 * separation of non-spinning parts (calipers etc.).
 * Needed because the front wheels in the source model are already steered.
 */
export class WheelAxle {
    /** Wheel axis direction in pivot space, pointing toward +X */
    readonly axis: Vector3

    private constructor(axis: Vector3) {
        this.axis = axis
    }

    /**
     * The axis is the direction of least spread of tire vertices
     * (a torus is wide in the rim plane and narrow along the axis)
     */
    static fromTire(tire: Mesh, pivot: Object3D): WheelAxle {
        const points: Vector3[] = WheelAxle.localPoints(tire, pivot, 3)
        const mean: Vector3 = new Vector3()
        for (let i: number = 0; i < points.length; i++) mean.add(points[i])
        mean.divideScalar(Math.max(points.length, 1))

        let xx: number = 0, xy: number = 0, xz: number = 0, yy: number = 0, yz: number = 0, zz: number = 0
        for (let i: number = 0; i < points.length; i++) {
            const dx: number = points[i].x - mean.x
            const dy: number = points[i].y - mean.y
            const dz: number = points[i].z - mean.z
            xx += dx * dx
            xy += dx * dy
            xz += dx * dz
            yy += dy * dy
            yz += dy * dz
            zz += dz * dz
        }

        // Power iteration on (trace·I − C): its dominant vector is the smallest eigenvector of C
        const trace: number = xx + yy + zz
        const axis: Vector3 = new Vector3(1, 0, 0)
        const next: Vector3 = new Vector3()
        for (let i: number = 0; i < 64; i++) {
            next.set(
                (trace - xx) * axis.x - xy * axis.y - xz * axis.z,
                -xy * axis.x + (trace - yy) * axis.y - yz * axis.z,
                -xz * axis.x - yz * axis.y + (trace - zz) * axis.z,
            )
            axis.copy(next.normalize())
        }
        if (axis.x < 0) axis.negate()
        return new WheelAxle(axis)
    }

    /** Rotation aligning the wheel axis with the pivot's X axis */
    get alignment(): Quaternion {
        return new Quaternion().setFromUnitVectors(this.axis, new Vector3(1, 0, 0))
    }

    /**
     * A part spins with the wheel only if it is symmetric about the axis:
     * the centroid of its vertices must lie on the axis
     */
    isRotating(mesh: Mesh, pivot: Object3D): boolean {
        const points: Vector3[] = WheelAxle.localPoints(mesh, pivot, 1)
        const center: Vector3 = new Vector3()
        for (let i: number = 0; i < points.length; i++) center.add(points[i])
        center.divideScalar(Math.max(points.length, 1))
        const off_axis: number = center.clone().sub(this.axis.clone().multiplyScalar(center.dot(this.axis))).length()
        return off_axis < 0.03
    }

    /** Mesh vertices in pivot space, sampled every step-th vertex */
    private static localPoints(mesh: Mesh, pivot: Object3D, step: number): Vector3[] {
        mesh.updateMatrixWorld(true)
        pivot.updateMatrixWorld(true)
        const to_pivot: Matrix4 = pivot.matrixWorld.clone().invert().multiply(mesh.matrixWorld)
        const position: BufferAttribute | InterleavedBufferAttribute = mesh.geometry.attributes.position
        const points: Vector3[] = []
        for (let i: number = 0; i < position.count; i += step) {
            points.push(new Vector3().fromBufferAttribute(position, i).applyMatrix4(to_pivot))
        }
        return points
    }
}
