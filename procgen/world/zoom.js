/* ------------------------------------------------------------------
 *  World → region zoom: derive region-generator params for a world cell.
 *
 *  Pure and DOM-free. Given a world model and a cell (wx, wy) it returns
 *  a {seed, params} pair to feed generateRegion, so drilling into the
 *  same world cell always regenerates the same local map. Climate comes
 *  from latitude (shifted by the world's own climate), the land/water
 *  mask and water fraction from the local ocean coverage, and the flavor
 *  from the cell's biome.
 * ------------------------------------------------------------------ */
import { BIOME } from '../region/biomes.js';

const COLDER = { hot: 'temperate', temperate: 'cold', cold: 'cold' };
const WARMER = { cold: 'temperate', temperate: 'hot', hot: 'hot' };

const round05 = v => Number((Math.round(v / 0.05) * 0.05).toFixed(2));

/**
 * @param {object} worldModel  a generateWorld() envelope (needs layers.N,
 *                             layers.biomes, seed, params.climate)
 * @param {number} wx
 * @param {number} wy
 * @returns {{seed:string, params:object}}
 */
export function deriveRegionParams(worldModel, wx, wy) {
    const N = worldModel.layers.N;
    const biomes = worldModel.layers.biomes;
    const seed = `${worldModel.seed}@${wx},${wy}`;

    /* ---- climate by latitude, shifted by the world climate ---- */
    const lat01 = Math.abs(wy - N / 2) / (N / 2);
    let climate = lat01 > 0.62 ? 'cold' : lat01 < 0.3 ? 'hot' : 'temperate';
    const worldClimate = worldModel.params && worldModel.params.climate;
    if (worldClimate === 'iceage') climate = COLDER[climate];
    else if (worldClimate === 'hot') climate = WARMER[climate];

    /* ---- local ocean fraction in a ~24-cell box → mask + water param ---- */
    const R = 12;
    let ocean = 0, total = 0;
    for (let dy = -R; dy <= R; dy++) {
        const ny = wy + dy; if (ny < 0 || ny >= N) continue;
        for (let dx = -R; dx <= R; dx++) {
            const nx = wx + dx; if (nx < 0 || nx >= N) continue;
            const c = biomes[ny * N + nx];
            total++;
            if (c === BIOME.ocean || c === BIOME.iceshelf) ocean++;
        }
    }
    const oceanFrac = total ? ocean / total : 0;
    const mask = oceanFrac > 0.55 ? 'island' : oceanFrac >= 0.15 ? 'coast' : 'inland';
    const water = round05(Math.min(0.65, Math.max(0.15, oceanFrac)));

    /* ---- flavor from the cell's biome ---- */
    const cell = biomes[wy * N + wx];
    const flavor = cell === BIOME.ashland ? 'volcanic'
        : cell === BIOME.blight ? 'blighted'
            : (cell === BIOME.desert || cell === BIOME.badlands) ? 'wasteland'
                : 'normal';

    return {
        seed,
        params: { mask, water, climate, flavor, rivers: 'normal', settlements: 'some', size: 'medium' },
    };
}
