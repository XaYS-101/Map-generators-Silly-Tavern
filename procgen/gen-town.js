/* ------------------------------------------------------------------
 *  Town / village generator (vector, world units ≈ meters, 640×640).
 *
 *  Plaza center → 3–5 main road rays with heading jitter → branch
 *  lanes (rejected when too close to existing roads) → building
 *  plots dropped along roads (rotated rects, SAT overlap tests) →
 *  landmarks claim the plots nearest the plaza → districts by
 *  nearest ray → optional wall with gates on the main roads.
 * ------------------------------------------------------------------ */
import { Rng } from './rng.js';
import { makeEnvelope, compass } from './schema.js';
import { nameFor, TOWN_LANDMARKS, BUILDING_KINDS, DISTRICT_ADJ, DISTRICT_FLAVOR } from './names.js';
import { rectPoly, centroid, scalePoly, distToPolyline, segPointDist, polysIntersect } from './town/geom.js';

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
    model.size = { w: SIZE, h: SIZE, unit: 'm' };

    const rng = new Rng(`${seed}/layout:${p.size}:${p.water}`);

    /* ---- water ---- */
    let riverPts = null;      // polyline across the map
    let shoreY = null;        // horizontal shoreline; water below
    if (p.water === 'river') {
        const vertical = rng.chance(0.5);
        const base = SIZE * rng.float(0.35, 0.65);
        riverPts = [];
        for (let t = -20; t <= SIZE + 20; t += 40) {
            const off = rng.gaussian(0, 22);
            riverPts.push(vertical ? [base + off, t] : [t, base + off]);
        }
    } else if (p.water === 'coast') {
        shoreY = SIZE * rng.float(0.7, 0.8);
    }
    const inWater = (x, y) => {
        if (shoreY != null) return y > shoreY;   // shoreline wobble is render-only
        if (riverPts) return distToPolyline(x, y, riverPts) < 16;
        return false;
    };

    /* ---- plaza ---- */
    let px = SIZE / 2 + rng.float(-40, 40), py = SIZE / 2 + rng.float(-40, 40);
    if (shoreY != null) py = Math.min(py, shoreY - 120);
    if (riverPts) {
        // snap near the river → the bridge feels like the reason the town exists
        let best = riverPts[0], bd = Infinity;
        for (const q of riverPts) {
            const d = Math.hypot(q[0] - px, q[1] - py);
            if (d < bd) { bd = d; best = q; }
        }
        const ang = Math.atan2(py - best[1], px - best[0]);
        px = best[0] + Math.cos(ang) * 46;
        py = best[1] + Math.sin(ang) * 46;
    }
    const plazaR = rng.int(26, 38);

    /* ---- roads ---- */
    const roads = [];       // { id, kind:'main'|'lane', pts }
    const segments = [];    // { x1,y1,x2,y2, roadId }
    let roadId = 0;

    function addSegments(pts, id) {
        for (let i = 1; i < pts.length; i++) {
            segments.push({ x1: pts[i - 1][0], y1: pts[i - 1][1], x2: pts[i][0], y2: pts[i][1], roadId: id });
        }
    }
    function tooCloseToRoads(x, y, minD, excludeId) {
        for (const s of segments) {
            if (s.roadId === excludeId) continue;
            if (segPointDist(x, y, s) < minD) return true;
        }
        return false;
    }

    function growRoad(fromX, fromY, heading, kind, maxLen) {
        const id = roadId++;
        const pts = [[fromX, fromY]];
        const step = kind === 'main' ? 26 : 22;
        let x = fromX, y = fromY, len = 0;
        while (len < maxLen) {
            heading += rng.float(-0.21, 0.21);
            const nx = x + Math.cos(heading) * step;
            const ny = y + Math.sin(heading) * step;
            if (nx < MARGIN || ny < MARGIN || nx > SIZE - MARGIN || ny > SIZE - MARGIN) break;
            if (shoreY != null && ny > shoreY - 8) break;
            if (kind !== 'main' && tooCloseToRoads(nx, ny, 17, id)) break;
            pts.push([nx, ny]);
            x = nx; y = ny; len += step;
        }
        if (pts.length < 3) { roadId--; return null; }
        const road = { id, kind, pts };
        roads.push(road);
        addSegments(pts, id);
        return road;
    }

    // main rays from the plaza
    const rayBase = rng.float(0, Math.PI * 2);
    const mains = [];
    for (let i = 0; i < preset.rays; i++) {
        const ang = rayBase + (Math.PI * 2 * i) / preset.rays + rng.float(-0.25, 0.25);
        const r = growRoad(px + Math.cos(ang) * plazaR, py + Math.sin(ang) * plazaR, ang, 'main', SIZE);
        if (r) mains.push(r);
    }

    // branch lanes
    function branchFrom(road, depth) {
        if (depth > preset.depth) return;
        const pts = road.pts;
        let nextAt = rng.int(preset.branchEvery[0], preset.branchEvery[1]);
        let acc = 0;
        for (let i = 1; i < pts.length; i++) {
            acc += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
            if (acc < nextAt) continue;
            acc = 0;
            nextAt = rng.int(preset.branchEvery[0], preset.branchEvery[1]);
            const tangent = Math.atan2(pts[i][1] - pts[i - 1][1], pts[i][0] - pts[i - 1][0]);
            const side = rng.chance(0.5) ? 1 : -1;
            const ang = tangent + side * (Math.PI / 2 + rng.float(-0.35, 0.35));
            const lane = growRoad(pts[i][0], pts[i][1], ang, 'lane', rng.int(60, 160));
            if (lane && rng.chance(0.5)) branchFrom(lane, depth + 1);
        }
    }
    for (const m of mains) branchFrom(m, 1);

    /* ---- buildings along roads ---- */
    const buildings = [];   // { poly, cx, cy, purpose, landmark? }
    const [minB, maxB] = preset.buildings;
    const targetB = rng.int(minB, maxB);

    outer:
    for (let lap = 0; lap < 3 && buildings.length < targetB; lap++) {
        for (const road of roads) {
            const pts = road.pts;
            let acc = 0, nextAt = rng.int(20, 30);
            let side = rng.chance(0.5) ? 1 : -1;
            for (let i = 1; i < pts.length; i++) {
                const dx = pts[i][0] - pts[i - 1][0], dy = pts[i][1] - pts[i - 1][1];
                const segLen = Math.hypot(dx, dy) || 1;
                acc += segLen;
                if (acc < nextAt) continue;
                acc = 0;
                nextAt = rng.int(20, 30);
                side = -side;
                const tx = dx / segLen, ty = dy / segLen;
                const nx = -ty * side, ny = tx * side;
                const offset = rng.int(9, 13);
                const cx = pts[i][0] + nx * offset, cy = pts[i][1] + ny * offset;
                const bw = rng.int(10, 18), bd = rng.int(8, 14);
                const poly = rectPoly(cx + nx * bd / 2, cy + ny * bd / 2, bw, bd, Math.atan2(ty, tx));
                if (poly.some(([qx, qy]) => qx < MARGIN || qy < MARGIN || qx > SIZE - MARGIN || qy > SIZE - MARGIN)) continue;
                if (poly.some(([qx, qy]) => inWater(qx, qy))) continue;
                if (Math.hypot(cx - px, cy - py) < plazaR + 12) continue;
                const c = centroid(poly);
                if (tooCloseToRoads(c[0], c[1], 8, -1)) continue;
                if (buildings.some(b => polysIntersect(b.poly, poly))) continue;
                buildings.push({ poly, cx: c[0], cy: c[1] });
                if (buildings.length >= targetB) break outer;
            }
        }
    }

    /* ---- landmarks: plots nearest the plaza ---- */
    const deco = new Rng(`${seed}/deco:${p.size}`);
    const nameRng = new Rng(`${seed}/names`);
    const lmKinds = (TOWN_LANDMARKS[p.size] || TOWN_LANDMARKS.town).filter(k => k !== 'market');
    const byDist = [...buildings].sort((a, b) =>
        Math.hypot(a.cx - px, a.cy - py) - Math.hypot(b.cx - px, b.cy - py));
    byDist.slice(0, lmKinds.length).forEach((b, i) => {
        b.landmark = lmKinds[i];
        b.name = lmKinds[i] === 'tavern' ? nameFor(nameRng, 'tavern') : null;
        b.poly = scalePoly(b.poly, 1.3);
    });
    for (const b of buildings) {
        if (!b.landmark) b.purpose = deco.weighted(BUILDING_KINDS);
    }

    /* ---- districts (town/city): cluster by nearest main ray ---- */
    const districts = [];
    if (p.size !== 'village' && mains.length) {
        const clusters = mains.map(() => ({ n: 0, sx: 0, sy: 0 }));
        for (const b of buildings) {
            let bi = 0, bd = Infinity;
            mains.forEach((m, i) => {
                const d = distToPolyline(b.cx, b.cy, m.pts);
                if (d < bd) { bd = d; bi = i; }
            });
            clusters[bi].n++; clusters[bi].sx += b.cx; clusters[bi].sy += b.cy;
        }
        const usedNames = new Set();
        clusters.forEach((c) => {
            if (c.n < 6) return;
            let dn;
            do { dn = `${deco.pick(DISTRICT_ADJ)} ${deco.pick(DISTRICT_FLAVOR)}`; } while (usedNames.has(dn));
            usedNames.add(dn);
            districts.push({ name: dn, x: c.sx / c.n, y: c.sy / c.n, n: c.n });
        });
    }

    /* ---- wall + gates ---- */
    let wall = null;
    const gates = [];
    if (p.walls && buildings.length) {
        const dists = buildings.map(b => Math.hypot(b.cx - px, b.cy - py)).sort((a, b) => a - b);
        const radius = Math.min(SIZE * 0.44, dists[Math.floor(dists.length * 0.85)] + 24);
        const nPts = rng.int(14, 18);
        const pts = [];
        for (let i = 0; i < nPts; i++) {
            const a = (Math.PI * 2 * i) / nPts;
            const r = radius * rng.float(0.93, 1.07);
            pts.push([px + Math.cos(a) * r, py + Math.sin(a) * r]);
        }
        const gateDirs = [];
        for (const m of mains) {
            for (const q of m.pts) {
                if (Math.hypot(q[0] - px, q[1] - py) >= radius) {
                    gates.push({ x: q[0], y: q[1], dir: compass(px, py, q[0], q[1]) });
                    gateDirs.push(compass(px, py, q[0], q[1]));
                    break;
                }
            }
        }
        wall = { pts, tags: gateDirs.map(d => d) };
    }

    /* ---- assemble ---- */
    model.name = nameFor(nameRng, p.size === 'village' ? 'village' : 'city');
    model.entities.push({ id: 'plaza', kind: 'plaza', x: px, y: py, w: plazaR * 2, h: plazaR * 2, purpose: 'market square', name: null });
    if (riverPts) model.entities.push({ id: 'river', kind: 'river', pts: riverPts.map(q => [Math.round(q[0]), Math.round(q[1])]) });
    if (shoreY != null) model.entities.push({ id: 'coast', kind: 'coast', y: Math.round(shoreY), pts: [[0, Math.round(shoreY)], [SIZE, Math.round(shoreY)]] });
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
        .map(l => ({ a: l.id, b: 'plaza', kind: 'street', dir: compass(l.x, l.y, px, py) }));
    return model;
}

/* geometry helpers live in town/geom.js */
