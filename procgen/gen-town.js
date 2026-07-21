/* ------------------------------------------------------------------
 *  Town / village generator (vector, world units ≈ meters).
 *
 *  Staged pipeline: site (water, plaza) → streets (main rays +
 *  branch lanes) → plots (buildings along roads, SAT tests) →
 *  districts → walls + gates → life (names/residents) → assemble.
 *
 *  Stream discipline (see rng.js): LAYOUT = all geometry, DECO =
 *  building purposes / district names, NAMES = every display string
 *  in a fixed order (tavern → town name).
 * ------------------------------------------------------------------ */
import { Rng } from './rng.js';
import { makeEnvelope, compass } from './schema.js';
import { nameFor } from './names.js';
import { buildSite } from './town/site.js';
import { buildStreets } from './town/streets.js';
import { buildPlots } from './town/plots.js';
import { buildDistricts } from './town/districts.js';
import { buildWalls } from './town/walls.js';
import { buildLife } from './town/life.js';

const SIZE = 640;
const MARGIN = 18;

const PRESETS = {
    village: { rays: 3, depth: 1, buildings: [16, 30], branchEvery: [60, 100] },
    town: { rays: 4, depth: 2, buildings: [50, 90], branchEvery: [50, 90] },
    city: { rays: 5, depth: 3, buildings: [120, 180], branchEvery: [45, 80] },
};

export function generateTown(seed, params = {}) {
    const p = { size: 'town', water: 'river', walls: false, ...params };
    const preset = PRESETS[p.size] || PRESETS.town;
    const model = makeEnvelope('town', seed, p);
    const extent = SIZE;
    model.size = { w: extent, h: extent, unit: 'm' };

    const ctx = {
        seed, p, preset, extent, margin: MARGIN,
        rng: new Rng(`${seed}/layout:${p.size}:${p.water}`),
        deco: new Rng(`${seed}/deco:${p.size}`),
        nameRng: new Rng(`${seed}/names`),
    };

    buildSite(ctx);
    buildStreets(ctx);
    buildPlots(ctx);
    buildDistricts(ctx);
    buildWalls(ctx);
    buildLife(ctx);

    return assemble(model, ctx);
}

function assemble(model, ctx) {
    const { p, extent, nameRng, water, plaza, roads, buildings, districts, wall, gates } = ctx;

    model.name = nameFor(nameRng, p.size === 'village' ? 'village' : 'city');
    model.entities.push({
        id: 'plaza', kind: 'plaza', x: plaza.x, y: plaza.y,
        w: plaza.r * 2, h: plaza.r * 2, purpose: 'market square', name: null,
    });
    if (water.riverPts) model.entities.push({ id: 'river', kind: 'river', pts: water.riverPts.map(q => [Math.round(q[0]), Math.round(q[1])]) });
    if (water.shoreY != null) model.entities.push({ id: 'coast', kind: 'coast', y: Math.round(water.shoreY), pts: [[0, Math.round(water.shoreY)], [extent, Math.round(water.shoreY)]] });
    roads.forEach((r, i) => model.entities.push({
        id: 'rd' + (i + 1), kind: 'road', purpose: r.kind,
        pts: r.pts.map(q => [Math.round(q[0]), Math.round(q[1])]),
    }));
    let li = 0, bi = 0;
    for (const b of buildings) {
        const poly = b.poly.map(q => [Math.round(q[0]), Math.round(q[1])]);
        if (b.landmark) {
            model.entities.push({
                id: 'l' + (++li), kind: 'landmark', purpose: b.landmark, name: b.name,
                x: Math.round(b.cx), y: Math.round(b.cy), poly,
            });
        } else {
            model.entities.push({
                id: 'b' + (++bi), kind: 'building', purpose: b.purpose,
                x: Math.round(b.cx), y: Math.round(b.cy), poly,
            });
        }
    }
    districts.forEach((d, i) => model.entities.push({
        id: 'ds' + (i + 1), kind: 'district', name: d.name,
        x: Math.round(d.x), y: Math.round(d.y), notes: `${d.n} buildings`,
    }));
    if (wall) {
        model.entities.push({ id: 'wall', kind: 'wall', pts: wall.pts.map(q => [Math.round(q[0]), Math.round(q[1])]), tags: wall.tags });
        gates.forEach((g, i) => model.entities.push({ id: 'g' + (i + 1), kind: 'gate', x: Math.round(g.x), y: Math.round(g.y), tags: [g.dir] }));
    }
    model.edges = model.entities
        .filter(e => e.kind === 'landmark')
        .map(l => ({ a: l.id, b: 'plaza', kind: 'street', dir: compass(l.x, l.y, plaza.x, plaza.y) }));
    return model;
}
