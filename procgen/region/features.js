/* ------------------------------------------------------------------
 *  Region stage 4: features — named biome blobs + points of interest.
 *
 *  Blobs: BFS on a 4× downsample of the biome grid, keep the 5 largest
 *  nameable patches. POIs: the "wildest" (least settle-able) candidate
 *  sites, kind chosen from a biome-keyed table on an isolated sub-stream
 *  so adding POI variety never reshuffles the layout.
 *
 *  nameRng draws (blob names) happen AFTER settlement names — the caller
 *  runs settlements first, so this stage's blob names land in order.
 * ------------------------------------------------------------------ */
import { BIOME_CODES, BIOME } from './biomes.js';
import { biomeName, REGION_POI } from '../names.js';

/**
 * @param {object} ctx {N, biome, settlements, scored, rng (layout), nameRng}
 */
export function buildFeatures(ctx) {
    const { N, biome, settlements, scored, rng, nameRng } = ctx;

    /* ---- named biome blobs (BFS on a 4× downsample) ---- */
    const blobs = [];
    {
        const M = N / 4;
        const down = new Uint8Array(M * M);
        for (let y = 0; y < M; y++) for (let x = 0; x < M; x++) down[y * M + x] = biome[(y * 4) * N + x * 4];
        const nameable = new Set([
            BIOME.forest, BIOME.rainforest, BIOME.swamp, BIOME.mountains, BIOME.desert,
            BIOME.taiga, BIOME.tundra, BIOME.savanna, BIOME.badlands, BIOME.ashland, BIOME.blight,
        ]);
        const minSize = Math.round(55 * (N * N) / (256 * 256));
        const seen = new Uint8Array(M * M);
        for (let y = 0; y < M; y++) for (let x = 0; x < M; x++) {
            const i = y * M + x;
            if (seen[i] || !nameable.has(down[i])) continue;
            const b = down[i];
            const q = [i];
            seen[i] = 1;
            let size = 0, sx = 0, sy = 0;
            for (let qi = 0; qi < q.length; qi++) {
                const ci = q[qi], cx = ci % M, cy = (ci / M) | 0;
                size++; sx += cx; sy += cy;
                for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]]) {
                    if (nx < 0 || ny < 0 || nx >= M || ny >= M) continue;
                    const ni = ny * M + nx;
                    if (!seen[ni] && down[ni] === b) { seen[ni] = 1; q.push(ni); }
                }
            }
            if (size >= minSize) blobs.push({ biome: BIOME_CODES[b], x: (sx / size) * 4, y: (sy / size) * 4, cells: size * 16 });
        }
        blobs.sort((a, b) => b.cells - a.cells || a.y - b.y || a.x - b.x);
        blobs.length = Math.min(blobs.length, 5);
        for (const b of blobs) b.name = biomeName(nameRng, b.biome);
    }

    /* ---- POIs: wildest spots, biome-keyed kind on an isolated stream ---- */
    const pois = [];
    const nPois = rng.int(3, 6);
    const poiRng = rng.sub('pois');
    for (const c of scored.slice().reverse()) {   // less "ideal" spots feel wilder
        if (pois.length >= nPois) break;
        if (settlements.some(s => Math.hypot(s.x - c.x, s.y - c.y) < 20)) continue;
        if (pois.some(s => Math.hypot(s.x - c.x, s.y - c.y) < 20)) continue;
        const code = biome[c.y * N + c.x];
        const table = REGION_POI[BIOME_CODES[code]] || REGION_POI.default;
        pois.push({ x: c.x, y: c.y, kind: poiRng.pick(table) });
    }

    return { blobs, pois };
}
