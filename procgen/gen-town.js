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

const EXTENT = { village: 460, town: 640, city: 840 };

const PRESETS = {
    village: { rays: 3, depth: 1, buildings: [16, 30], branchEvery: [60, 100] },
    town: { rays: 4, depth: 2, buildings: [50, 90], branchEvery: [50, 90] },
    city: { rays: 5, depth: 3, buildings: [120, 180], branchEvery: [45, 80] },
};

export function generateTown(seed, params = {}) {
    const p = {
        size: 'town', water: 'river', site: 'plain', trade: 'trade',
        wealth: 'average', condition: 'thriving', walls: false, ...params,
    };
    const preset = PRESETS[p.size] || PRESETS.town;
    const model = makeEnvelope('town', seed, p);
    const extent = EXTENT[p.size] || EXTENT.town;
    const margin = Math.round(extent * 0.028);
    model.size = { w: extent, h: extent, unit: 'm' };

    const ctx = {
        seed, p, preset, extent, margin,
        rng: new Rng(`${seed}/layout:${p.size}:${p.water}:${p.site}:${p.trade}:${p.wealth}:${p.condition}`),
        deco: new Rng(`${seed}/deco:${p.size}`),
        nameRng: new Rng(`${seed}/names`),
    };

    buildSite(ctx);
    buildStreets(ctx);
    buildPlots(ctx);
    buildDistricts(ctx);
    buildWalls(ctx);
    buildLife(ctx);   // owned by the life agent: names + residents on ctx

    return assemble(model, ctx);
}

function assemble(model, ctx) {
    const { nameRng, water, site, plaza, roads, bridges, piers, buildings, districts, fields, spoil, wall, gates } = ctx;
    const R = q => [Math.round(q[0]), Math.round(q[1])];

    // town name is written by the life agent (ctx.townName); fall back if it lands after us
    model.name = ctx.townName ?? nameFor(nameRng, 'city');

    /* plaza */
    model.entities.push({
        id: 'plaza', kind: 'plaza', x: Math.round(plaza.x), y: Math.round(plaza.y),
        w: plaza.r * 2, h: plaza.r * 2, purpose: 'market square', name: null,
    });

    /* water */
    if (water.riverPts) model.entities.push({ id: 'river', kind: 'river', pts: water.riverPts.map(R), width: water.width });
    if (water.shorePts) model.entities.push({ id: 'coast', kind: 'coast', y: Math.round(water.shoreY), pts: water.shorePts.map(R) });

    /* contours (hillside) */
    if (site.contours) site.contours.forEach((c, i) => model.entities.push({ id: 'ctr' + (i + 1), kind: 'contour', pts: c.map(R) }));

    /* roads */
    roads.forEach((r, i) => model.entities.push({ id: 'rd' + (i + 1), kind: 'road', purpose: r.kind, pts: r.pts.map(R) }));

    /* bridges */
    bridges.forEach((b, i) => model.entities.push({
        id: 'br' + (i + 1), kind: 'bridge', x: Math.round(b.x), y: Math.round(b.y),
        angle: b.angle, road: 'rd' + (b.roadId + 1), tags: [],
    }));

    /* piers */
    piers.forEach((pr, i) => model.entities.push({ id: 'pr' + (i + 1), kind: 'pier', pts: pr.pts.map(R) }));

    /* buildings + landmarks, in array order */
    let li = 0, bi = 0;
    for (const b of buildings) {
        const poly = b.poly.map(R);
        if (b.landmark) {
            model.entities.push({
                id: 'l' + (++li), kind: 'landmark', purpose: b.landmark,
                name: b.name ?? null, resident: b.resident ?? null,
                x: Math.round(b.cx), y: Math.round(b.cy), poly,
                material: b.material, state: b.state,
            });
        } else {
            model.entities.push({
                id: 'b' + (++bi), kind: 'building', purpose: b.purpose,
                x: Math.round(b.cx), y: Math.round(b.cy), poly,
                material: b.material, state: b.state,
            });
        }
    }

    /* districts */
    districts.forEach((d, i) => model.entities.push({
        id: 'ds' + (i + 1), kind: 'district', name: d.name, fn: d.fn,
        x: Math.round(d.x), y: Math.round(d.y), notes: `${d.n} buildings`,
    }));

    /* fields */
    fields.forEach((f, i) => model.entities.push({ id: 'fd' + (i + 1), kind: 'field', purpose: f.purpose, poly: f.poly.map(R) }));

    /* spoil heaps */
    spoil.forEach((s, i) => model.entities.push({ id: 'sp' + (i + 1), kind: 'spoil', x: Math.round(s.x), y: Math.round(s.y), r: Math.round(s.r) }));

    /* wall + gates */
    if (wall) {
        model.entities.push({ id: 'wall', kind: 'wall', pts: wall.pts.map(R), type: wall.type, tags: wall.tags, breaches: wall.breaches });
        gates.forEach((g, i) => model.entities.push({ id: 'g' + (i + 1), kind: 'gate', x: Math.round(g.x), y: Math.round(g.y), tags: [g.dir] }));
    }

    /* landmark → plaza street edges */
    model.edges = model.entities
        .filter(e => e.kind === 'landmark')
        .map(l => ({ a: l.id, b: 'plaza', kind: 'street', dir: compass(l.x, l.y, plaza.x, plaza.y) }));
    return model;
}
