/* ------------------------------------------------------------------
 *  Region stage 5: settlements.
 *
 *  Suitability scoring on the climate/hydrology layers over a coarse
 *  candidate grid, then greedy placement of cities/towns/villages with
 *  a minimum spacing. Score jitter is drawn from the LAYOUT stream (one
 *  draw per candidate, in grid order); names from the NAMES stream in
 *  placement order — matching the old generator's draw discipline.
 * ------------------------------------------------------------------ */
import { BIOME } from './biomes.js';
import { nameFor } from '../names.js';

const COUNTS = { few: [1, 2, 2], some: [1, 3, 4], many: [2, 4, 6] };
const BIOME_PENALTY = { [BIOME.desert]: 1, [BIOME.badlands]: 2, [BIOME.ashland]: 3, [BIOME.blight]: 3, [BIOME.tundra]: 1.5 };
const GOOD_BIOME = new Set([BIOME.grassland, BIOME.savanna, BIOME.forest]);

/**
 * @param {object} ctx {N, p, biome, slope, distWater, isOcean, lakeMask,
 *                       isRiver, confluences, rng (layout), nameRng}
 * @returns {{settlements:Array, scored:Array}}
 */
export function buildSettlements(ctx) {
    const { N, p, biome, slope, distWater, isOcean, lakeMask, isRiver, confluences, rng, nameRng } = ctx;

    /* neighborhood scans (typed grids, small radii) */
    const near = (grid, val, x, y, r) => {
        for (let dy = -r; dy <= r; dy++) {
            const ny = y + dy; if (ny < 0 || ny >= N) continue;
            for (let dx = -r; dx <= r; dx++) {
                const nx = x + dx; if (nx < 0 || nx >= N) continue;
                if (grid[ny * N + nx] === val) return true;
            }
        }
        return false;
    };
    const nearOcean = (x, y, r) => near(isOcean, 1, x, y, r);
    const nearRiver = (x, y, r) => near(isRiver, 1, x, y, r);
    const nearLake = (x, y, r) => near(lakeMask, 1, x, y, r);
    const nearMountains = (x, y, r) => near(biome, BIOME.mountains, x, y, r);

    const confSet = new Set(confluences.map(([cx, cy]) => cy * N + cx));
    const nearConfluence = (x, y, r) => {
        for (let dy = -r; dy <= r; dy++) {
            const ny = y + dy; if (ny < 0 || ny >= N) continue;
            for (let dx = -r; dx <= r; dx++) {
                const nx = x + dx; if (nx < 0 || nx >= N) continue;
                if (confSet.has(ny * N + nx)) return true;
            }
        }
        return false;
    };

    /* ---- candidate scoring ---- */
    const excluded = new Set([BIOME.ocean, BIOME.lake, BIOME.mountains, BIOME.snow, BIOME.swamp]);
    const scored = [];
    for (let y = 10; y < N - 10; y += 4) {
        for (let x = 10; x < N - 10; x += 4) {
            const i = y * N + x;
            if (excluded.has(biome[i]) || slope[i] > 0.045) continue;
            let s = 1 + rng.float(0, 0.5);   // LAYOUT stream, one draw per candidate
            s += 2.2 * Math.exp(-distWater[i] / 3);
            const coastal = nearOcean(x, y, 6);
            if (nearOcean(x, y, 3) && slope[i] < 0.02) s += 2.0;   // harbor: right on the shore
            else if (coastal) s += 1.0;
            if (GOOD_BIOME.has(biome[i])) s += 1.2;
            if (nearConfluence(x, y, 3)) s += 1.0;
            s -= BIOME_PENALTY[biome[i]] || 0;
            scored.push({ x, y, s });
        }
    }
    scored.sort((a, b) => b.s - a.s || a.y - b.y || a.x - b.x);

    /* ---- greedy placement ---- */
    const counts = COUNTS[p.settlements] || COUNTS.some;
    const settlements = [];
    const wanted = [['city', counts[0]], ['town', counts[1]], ['village', counts[2]]];
    for (const [kind, n] of wanted) {
        let placed = 0;
        for (const c of scored) {
            if (placed >= n) break;
            if (settlements.some(s => Math.hypot(s.x - c.x, s.y - c.y) < 28)) continue;
            const i = c.y * N + c.x;
            const coastal = nearOcean(c.x, c.y, 6);
            const harbor = nearOcean(c.x, c.y, 3) && slope[i] < 0.02;
            const tags = [];
            if (nearRiver(c.x, c.y, 4)) tags.push('on a river');
            if (harbor) tags.push('harbor');
            else if (coastal) tags.push('coastal');
            if (nearLake(c.x, c.y, 5)) tags.push('lakeside');
            if (nearConfluence(c.x, c.y, 3)) tags.push('at a river confluence');
            if (nearMountains(c.x, c.y, 8)) tags.push('in the foothills');
            if (biome[i] === BIOME.desert && distWater[i] <= 3) tags.push('oasis town');
            settlements.push({
                x: c.x, y: c.y, kind,
                name: nameFor(nameRng, kind === 'village' ? 'village' : 'city'),
                tags,
            });
            placed++;
        }
    }

    return { settlements, scored };
}
