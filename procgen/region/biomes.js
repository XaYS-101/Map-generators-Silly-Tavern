/* ------------------------------------------------------------------
 *  Region biomes — the single source of truth for biome codes.
 *
 *  ORDER CONTRACT: 'ocean' must stay 0 and 'lake' must stay 1 — the
 *  renderer treats code <= 1 as water (underlay + coastline pass).
 *  New biomes are APPENDED, never inserted, so saved seeds keep
 *  producing the same grids across versions.
 * ------------------------------------------------------------------ */

export const BIOME_CODES = [
    'ocean', 'lake', 'beach', 'grassland', 'forest', 'rainforest',
    'desert', 'swamp', 'mountains', 'snow',
    // appended (never inserted): keep saved seeds stable
    'taiga', 'tundra', 'savanna', 'badlands', 'ashland', 'blight',
];

/** name → code lookup ({ ocean: 0, lake: 1, ... }). */
export const BIOME = Object.fromEntries(BIOME_CODES.map((n, i) => [n, i]));
