/** World seed: each game launch produces a new random track */
export const WORLD_SEED: number = Math.floor(Math.random() * 0x7fffffff)

/** Half of the asphalt width, m */
export const ROAD_HALF_WIDTH: number = 4.0

/** Flat dirt strip beyond the asphalt edge, m */
export const ROAD_FLAT_MARGIN: number = 1.5

/** Distance from the road centerline to the guardrail, m */
export const RAIL_OFFSET: number = 5.0

/** Spacing between track control points, m */
export const CONTROL_SPACING: number = 28

/** Number of sampling intervals within one track segment */
export const SEGMENT_SAMPLES: number = 14

/** How far along the track the road is pre-generated in each direction, m */
export const ROAD_GENERATE_AHEAD: number = 1600

/** Radius within which road meshes are built, m */
export const ROAD_VISIBLE_RADIUS: number = 450

/** Terrain chunk size, m */
export const TERRAIN_CHUNK_SIZE: number = 80

/** Terrain loading radius in chunks */
export const TERRAIN_CHUNK_RADIUS: number = 5

/** Radius within which the road affects the terrain, m */
export const ROAD_INFLUENCE_RADIUS: number = 70
