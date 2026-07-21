/* ------------------------------------------------------------------
 *  Town stage 4: districts — cluster buildings into named quarters and
 *  grow specialization quarters (docks, mines, garrison, temple, trade,
 *  farms) plus wealth quarters (noble / slums).
 *
 *  General quarters keep the legacy nearest-main clustering; functional
 *  quarters add real extra geometry: piers, spoil heaps, fields, and
 *  extra landmark buildings placed with the same SAT / water / margin
 *  checks as plots. LAYOUT drives geometry, DECO drives material and
 *  every district name. outsideWall flags let the wall stage ignore
 *  farms / mines / slums when sizing the ring.
 * ------------------------------------------------------------------ */
import { DISTRICT_ADJ, DISTRICT_FLAVOR } from '../names.js';
import { rectPoly, centroid, polysIntersect, distToPolyline, polylineTangent } from './geom.js';

const FN_NAMES = {
    docks: ['Fishmarket Row', 'The Wharves', 'Netmender Row', 'Saltgate'],
    mining: ["Miners' End", 'Slaghill', 'The Diggings', 'Orehaven'],
    garrison: ['The Barbican', 'Garrison Green', 'Shieldwall', 'Musterfield'],
    temple: ['Temple Close', 'Cloister Walk', 'Pilgrim Rest', 'Saints Row'],
    trade: ['Caravan Row', 'The Exchange', 'Market Cross', 'Merchant Quarter'],
    farming: ['Granary Row', 'Millfield', 'The Furrows', 'Harvest End'],
    noble: ['High Garden', 'Silver Terrace', 'Lords Walk', 'Crown Heights'],
    slums: ['The Warrens', 'Mudside', "Raggers End", 'The Shambles'],
};

const CLUSTER_MIN = { village: 3, town: 5, city: 7 };

export function buildDistricts(ctx) {
    const { p, rng, deco, extent, plaza, mains, buildings, site, water } = ctx;
    const M = ctx.margin;
    const size = p.size || 'town';

    const districts = [];
    ctx.piers = [];
    ctx.fields = [];
    ctx.spoil = [];

    const usedNames = new Set();
    function pickFnName(fn) {
        const pool = FN_NAMES[fn] || FN_NAMES.trade;
        const shuffled = deco.shuffle(pool);
        for (const n of shuffled) if (!usedNames.has(n)) { usedNames.add(n); return n; }
        let n, guard = 0;
        do { n = `${deco.pick(pool)} ${deco.pick(DISTRICT_FLAVOR)}`; } while (usedNames.has(n) && guard++ < 8);
        usedNames.add(n);
        return n;
    }
    function pickGeneralName() {
        let n, guard = 0;
        do { n = `${deco.pick(DISTRICT_ADJ)} ${deco.pick(DISTRICT_FLAVOR)}`; } while (usedNames.has(n) && guard++ < 12);
        usedNames.add(n);
        return n;
    }

    /* ---- placement helpers (shared SAT / water / margin checks) ---- */
    function inBounds(poly) { return !poly.some(([x, y]) => x < M || y < M || x > extent - M || y > extent - M); }
    function dry(poly) { return !poly.some(([x, y]) => water.inWater(x, y)); }
    function place(cx, cy, bw, bd, ang, opts = {}) {
        const poly = rectPoly(cx, cy, bw, bd, ang);
        if (!inBounds(poly)) return null;
        if (!opts.allowWater && !dry(poly)) return null;
        if (buildings.some(b => polysIntersect(b.poly, poly))) return null;
        const b = {
            poly, cx, cy,
            material: opts.material || (deco.chance(opts.stone ?? 0.3) ? 'stone' : 'wood'),
            state: 'intact',
            outsideWall: !!opts.outsideWall,
        };
        if (opts.landmark) { b.landmark = opts.landmark; b.name = null; }
        else b.purpose = opts.purpose || 'house';
        buildings.push(b);
        return b;
    }
    function placeNear(ax, ay, bw, bd, baseAng, opts = {}, tries = 34) {
        for (let t = 0; t < tries; t++) {
            const rad = t === 0 ? 0 : rng.float(6, 6 + t * 5);
            const a = rng.float(0, Math.PI * 2);
            const b = place(ax + Math.cos(a) * rad, ay + Math.sin(a) * rad, bw, bd, baseAng + rng.float(-0.4, 0.4), opts);
            if (b) return b;
        }
        return null;
    }
    function finishDistrict(fn, name, members, outsideWall) {
        const real = members.filter(Boolean);
        if (!real.length) return;
        const c = centroid(real.map(b => [b.cx, b.cy]));
        districts.push({ name, fn, x: c[0], y: c[1], n: real.length, outsideWall: !!outsideWall });
    }
    function mainFarEnd() {
        let best = [plaza.x, plaza.y], bd = -1;
        for (const m of mains) {
            const q = m.pts[m.pts.length - 1];
            const d = Math.hypot(q[0] - plaza.x, q[1] - plaza.y);
            if (d > bd) { bd = d; best = q; }
        }
        return best;
    }
    function edgeAnchor() {
        const cands = [[extent * 0.5, M + 45], [extent - M - 45, extent * 0.5], [extent * 0.5, extent - M - 45], [M + 45, extent * 0.5]];
        for (const c of deco.shuffle(cands)) if (!water.inWater(c[0], c[1])) return c;
        return cands[0];
    }
    function nearestMainTangent(x, y) {
        if (!mains.length) return 0;
        let best = mains[0], bd = Infinity;
        for (const m of mains) { const d = distToPolyline(x, y, m.pts); if (d < bd) { bd = d; best = m; } }
        return polylineTangent(x, y, best.pts);
    }

    /* ---- 1) general quarters (legacy nearest-main clustering) ---- */
    if (mains.length) {
        const min = CLUSTER_MIN[size] || CLUSTER_MIN.town;
        const clusters = mains.map(() => ({ n: 0, sx: 0, sy: 0 }));
        for (const b of buildings) {
            let bi = 0, bd = Infinity;
            mains.forEach((m, i) => { const d = distToPolyline(b.cx, b.cy, m.pts); if (d < bd) { bd = d; bi = i; } });
            clusters[bi].n++; clusters[bi].sx += b.cx; clusters[bi].sy += b.cy;
        }
        clusters.forEach((c) => {
            if (c.n < min) return;
            districts.push({ name: pickGeneralName(), fn: 'general', x: c.sx / c.n, y: c.sy / c.n, n: c.n, outsideWall: false });
        });
    }

    /* ---- 2) functional quarter(s) by trade ---- */
    const trade = p.trade || 'trade';
    if (trade === 'fishing' || (trade === 'trade' && water.type === 'coast')) buildDocks();
    if (trade === 'mining') buildMining();
    if (trade === 'garrison') buildGarrison();
    if (trade === 'temple') buildTemple();
    if (trade === 'trade') buildTrade();
    if (trade === 'farming') buildFarming();

    /* ---- 3) wealth quarters ---- */
    if (p.wealth === 'wealthy') buildNoble();
    if (p.wealth === 'poor') buildSlums();

    ctx.districts = districts;

    /* ================= functional builders ================= */

    function waterFront(nP) {
        // returns [{base:[x,y], heading}] pier seats + a dry shore anchor
        const seats = [];
        let shoreAnchor = null;
        if (water.type === 'coast') {
            for (let k = 0; k < nP; k++) {
                const bx = Math.max(M + 10, Math.min(extent - M - 10, plaza.x + rng.float(-140, 140)));
                const by = water.shoreYAt(bx);
                seats.push({ base: [bx, by], heading: Math.PI / 2 });   // +y = into the sea
            }
            shoreAnchor = [plaza.x, water.shoreYAt(plaza.x) - 34];
        } else if (water.type === 'river') {
            const rp = water.riverPts;
            // nearest river vertex to plaza, plus neighbours, as pier seats
            let ni = 0, bd = Infinity;
            rp.forEach((q, i) => { const d = Math.hypot(q[0] - plaza.x, q[1] - plaza.y); if (d < bd) { bd = d; ni = i; } });
            for (let k = 0; k < nP; k++) {
                const i = Math.max(1, Math.min(rp.length - 2, ni - Math.floor(nP / 2) + k));
                const t = Math.atan2(rp[i + 1][1] - rp[i - 1][1], rp[i + 1][0] - rp[i - 1][0]);
                let n = t + Math.PI / 2;
                // choose the bank on the plaza side
                const nx = Math.cos(n), ny = Math.sin(n);
                if ((plaza.x - rp[i][0]) * nx + (plaza.y - rp[i][1]) * ny < 0) n += Math.PI;
                const base = [rp[i][0] + Math.cos(n) * (water.width / 2 + 3), rp[i][1] + Math.sin(n) * (water.width / 2 + 3)];
                seats.push({ base, heading: Math.atan2(rp[i][1] - base[1], rp[i][0] - base[0]) });
            }
            shoreAnchor = seats.length ? [seats[0].base[0], seats[0].base[1]] : [plaza.x, plaza.y];
        }
        return { seats, shoreAnchor };
    }

    function addPier(base, heading) {
        const len = rng.int(2, 4);
        const pts = [[base[0], base[1]]];
        let x = base[0], y = base[1];
        for (let s = 1; s < len; s++) {
            x += Math.cos(heading) * rng.int(14, 20) + rng.gaussian(0, 2);
            y += Math.sin(heading) * rng.int(14, 20) + rng.gaussian(0, 2);
            pts.push([x, y]);
        }
        ctx.piers.push({ pts });
    }

    function buildDocks() {
        if (water.type !== 'coast' && water.type !== 'river') return;
        const nP = rng.int(2, 4);
        const { seats, shoreAnchor } = waterFront(nP);
        for (const s of seats) addPier(s.base, s.heading);
        const members = [];
        const ang = shoreAnchor ? nearestMainTangent(shoreAnchor[0], shoreAnchor[1]) : 0;
        const nW = rng.int(2, 3);
        for (let k = 0; k < nW; k++) members.push(placeNear(shoreAnchor[0], shoreAnchor[1], rng.int(18, 26), rng.int(14, 20), ang, { landmark: 'warehouse', stone: 0.5 }));
        members.push(placeNear(shoreAnchor[0], shoreAnchor[1], rng.int(20, 28), rng.int(16, 22), ang, { landmark: 'fish market', stone: 0.4 }));
        finishDistrict('docks', pickFnName('docks'), members, false);
    }

    function buildMining() {
        const anchor = edgeAnchor();
        const ang = nearestMainTangent(anchor[0], anchor[1]);
        const members = [];
        members.push(placeNear(anchor[0], anchor[1], rng.int(20, 28), rng.int(16, 22), ang, { landmark: 'ore works', stone: 0.7, outsideWall: true }));
        members.push(placeNear(anchor[0], anchor[1], rng.int(14, 20), rng.int(11, 16), ang, { landmark: 'warehouse', stone: 0.5, outsideWall: true }));
        // spoil heaps just outside town toward the map edge
        const nS = rng.int(2, 4);
        for (let k = 0; k < nS; k++) {
            const sx = anchor[0] + rng.float(-70, 70), sy = anchor[1] + rng.float(-70, 70);
            if (water.inWater(sx, sy)) continue;
            if (sx < M || sy < M || sx > extent - M || sy > extent - M) continue;
            ctx.spoil.push({ x: sx, y: sy, r: rng.int(12, 20) });
        }
        finishDistrict('mining', pickFnName('mining'), members, true);
    }

    function buildGarrison() {
        const far = mainFarEnd();
        const ax = (far[0] + plaza.x) / 2, ay = (far[1] + plaza.y) / 2;
        const ang = nearestMainTangent(ax, ay);
        const members = [];
        members.push(placeNear(ax, ay, rng.int(20, 26), rng.int(14, 18), ang, { landmark: 'barracks', stone: 0.7 }));
        members.push(placeNear(ax, ay, rng.int(20, 26), rng.int(14, 18), ang, { landmark: 'barracks', stone: 0.7 }));
        // drill yard: an empty rect landmark (no resident is the life stage's call)
        members.push(placeNear(ax, ay, rng.int(34, 46), rng.int(26, 36), ang, { landmark: 'drill yard', material: 'stone' }));
        finishDistrict('garrison', pickFnName('garrison'), members, false);
    }

    function buildTemple() {
        // a short walk out from the plaza along a main
        const far = mainFarEnd();
        const ang0 = Math.atan2(far[1] - plaza.y, far[0] - plaza.x);
        const ax = plaza.x + Math.cos(ang0) * (plaza.r + 90), ay = plaza.y + Math.sin(ang0) * (plaza.r + 90);
        const ang = nearestMainTangent(ax, ay);
        const members = [];
        members.push(placeNear(ax, ay, rng.int(24, 32), rng.int(18, 26), ang, { landmark: 'temple', stone: 0.85 }));
        members.push(placeNear(ax, ay, rng.int(18, 24), rng.int(14, 18), ang, { landmark: 'cloister', stone: 0.7 }));
        const nH = rng.int(3, 4);
        for (let k = 0; k < nH; k++) members.push(placeNear(ax, ay, rng.int(9, 13), rng.int(8, 11), ang, { purpose: 'pilgrim house', stone: 0.2 }));
        finishDistrict('temple', pickFnName('temple'), members, false);
    }

    function buildTrade() {
        // caravanserai near a main, far from the plaza
        const far = mainFarEnd();
        const ang = nearestMainTangent(far[0], far[1]);
        const members = [];
        members.push(placeNear(far[0], far[1], rng.int(30, 42), rng.int(24, 34), ang, { landmark: 'caravanserai', stone: 0.6 }));
        members.push(placeNear(far[0], far[1], rng.int(18, 26), rng.int(14, 20), ang, { landmark: 'warehouse', stone: 0.5 }));
        members.push(placeNear(far[0], far[1], rng.int(18, 26), rng.int(14, 20), ang, { landmark: 'warehouse', stone: 0.5 }));
        members.push(placeNear(far[0], far[1], rng.int(22, 30), rng.int(18, 24), ang, { landmark: 'market', stone: 0.4 }));
        finishDistrict('trade', pickFnName('trade'), members, false);
    }

    function buildFarming() {
        const members = [];
        for (let k = 0; k < 2; k++) {
            const a = edgeAnchor();
            members.push(placeNear(a[0], a[1], rng.int(20, 28), rng.int(16, 22), nearestMainTangent(a[0], a[1]), { landmark: 'granary', stone: 0.4, outsideWall: true }));
        }
        const mA = edgeAnchor();
        members.push(placeNear(mA[0], mA[1], rng.int(18, 24), rng.int(14, 18), nearestMainTangent(mA[0], mA[1]), { landmark: 'mill', stone: 0.3, outsideWall: true }));
        // fields near the edges (outside the wall), aligned to a nearby road;
        // sample the whole perimeter and shrink on repeated failure so a
        // built-up map still gets at least a couple of plots
        const nF = rng.int(2, 4);
        let made = 0;
        for (let attempt = 0; attempt < nF * 12 && made < nF; attempt++) {
            const side = rng.int(0, 3);
            const t = rng.float(0.12, 0.88);
            const inset = M + rng.float(40, 80);
            const cx = side === 1 ? extent - inset : side === 3 ? inset : extent * t;
            const cy = side === 0 ? inset : side === 2 ? extent - inset : extent * t;
            const shrink = 1 - 0.35 * Math.min(1, attempt / (nF * 8));
            const ang = nearestMainTangent(cx, cy);
            const poly = rectPoly(cx, cy, rng.int(40, 62) * shrink, rng.int(28, 46) * shrink, ang);
            if (!inBounds(poly) || !dry(poly)) continue;
            if (buildings.some(b => polysIntersect(b.poly, poly))) continue;
            if (ctx.fields.some(f => polysIntersect(f.poly, poly))) continue;
            ctx.fields.push({ poly, purpose: deco.chance(0.5) ? 'orchard' : 'field' });
            made++;
        }
        finishDistrict('farming', pickFnName('farming'), members, true);
    }

    /* ================= wealth builders ================= */

    function buildNoble() {
        const members = [];
        const nH = rng.int(3, 5);
        for (let k = 0; k < nH; k++) {
            const a = rng.float(0, Math.PI * 2);
            const rad = plaza.r + rng.float(30, 90);
            members.push(placeNear(plaza.x + Math.cos(a) * rad, plaza.y + Math.sin(a) * rad, rng.int(20, 30), rng.int(16, 24), a, { landmark: 'manor', stone: 0.9 }));
        }
        if (site.type === 'hillside' && site.highPoint) {
            const hp = site.highPoint;
            members.push(placeNear(hp[0], hp[1], rng.int(32, 44), rng.int(26, 34), 0, { landmark: 'citadel', material: 'stone' }));
        }
        finishDistrict('noble', pickFnName('noble'), members, false);
    }

    function buildSlums() {
        // outside the main cluster, near a main road's far end
        const far = mainFarEnd();
        const ang = Math.atan2(far[1] - plaza.y, far[0] - plaza.x);
        const cx = far[0] - Math.cos(ang) * 20, cy = far[1] - Math.sin(ang) * 20;
        const members = [];
        const nH = rng.int(6, 10);
        for (let k = 0; k < nH; k++) members.push(placeNear(cx, cy, rng.int(7, 11), rng.int(6, 9), ang, { purpose: 'hovel', material: 'wood', outsideWall: true }, 40));
        // short alley dead-ends
        if (ctx.growRoad) {
            const nA = rng.int(2, 3);
            for (let k = 0; k < nA; k++) ctx.growRoad(cx + rng.float(-30, 30), cy + rng.float(-30, 30), rng.float(0, Math.PI * 2), 'alley', rng.int(24, 48));
        }
        finishDistrict('slums', pickFnName('slums'), members, true);
    }
}
