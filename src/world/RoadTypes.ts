import { Vector3 } from 'three'

/** Track control point: a spline knot */
export interface ControlPoint {
    index: number
    position: Vector3
}

/** Point on the road centerline after spline interpolation */
export interface RoadSample {
    position: Vector3
    /** Tangent (travel direction toward increasing indices) */
    tangent: Vector3
    /** Horizontal vector pointing right of the travel direction */
    right: Vector3
    /** Distance along the track from the start point, m (negative on the backward branch) */
    distance: number
}

/** Road section between two adjacent control points */
export interface RoadSegment {
    index: number
    samples: RoadSample[]
    start_distance: number
    length: number
    rail_left: boolean
    rail_right: boolean
    min_x: number
    max_x: number
    min_z: number
    max_z: number
}

/** Reference to a sample within a segment, stored in the spatial index */
export interface SampleRef {
    segment: RoadSegment
    sample: number
}

/** Result of projecting an arbitrary point onto the road centerline */
export interface RoadProjection {
    segment: RoadSegment
    /** Signed lateral offset: positive is to the right of the centerline */
    lateral: number
    /** Road centerline height at the projection point */
    height: number
    /** Distance along the track */
    along: number
    tangent: Vector3
    right: Vector3
}
