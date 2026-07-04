/* ------------------------------------------------------------------
 *  Building interior generator (single floor, 1 cell = 1 m).
 *
 *  Hub room (common room / hearth room / nave / corridor) at the
 *  street entrance, remaining space slice-subdivided into rooms;
 *  doors placed by BFS from the hub so the plan is always connected.
 *  All rooms are axis-aligned rects; the building outline may be
 *  L-shaped.
 * ------------------------------------------------------------------ */
import { Rng } from './rng.js';
import { makeEnvelope, compass, rleEncode } from './schema.js';
import { nameFor, word, INTERIOR_PLANS, furnitureFor } from './names.js';

const KIND_SIZE = {
    house: [12, 9], shop: [12, 10], tavern: [18, 12],
    temple: [18, 14], manor: [22, 14], keep: [22, 16],
};
const CORRIDOR_KINDS = new Set(['manor', 'keep']);

function titleCase(s) {
    return s.replace(/(^|[\s-])\w/g, c => c.toUpperCase());
}

export function generateInterior(seed, params = {}) {
    const p = { building: 'tavern', ...params };
    const kind = KIND_SIZE[p.building] ? p.building : 'tavern';
    const model = makeEnvelope('interior', seed, { ...p, building: kind });

    const rng = new Rng(`${seed}/layout:${kind}`);
    const [bw, bh] = KIND_SIZE[kind];
    const W = bw + rng.int(-1, 2);
    const H = bh + rng.int(-1, 1);
    model.size = { w: W, h: H, unit: 'm' };

    /* ---- outline (optionally L-shaped) + free regions ---- */
    const useCorridor = CORRIDOR_KINDS.has(kind);
    let cut = null;   // { corner:'tl'|'tr', w, h }
    if (!useCorridor && kind !== 'temple' && rng.chance(0.35)) {
        cut = {
            corner: rng.chance(0.5) ? 'tl' : 'tr',
            w: Math.round(W * rng.float(0.28, 0.4)),
            h: Math.round(H * rng.float(0.25, 0.35)),
        };
    }

    const rooms = [];   // { i, x, y, w, h, purpose, notes }
    const regions = [];
    let hubRect;

    if (useCorridor) {
        const cx = Math.round(W / 2) - 1;
        const y0 = Math.round(H * 0.3);
        hubRect = { x: cx, y: y0, w: 2, h: H - y0 };
        regions.push({ x: 0, y: y0, w: cx, h: H - y0 });
        regions.push({ x: cx + 2, y: y0, w: W - cx - 2, h: H - y0 });
        regions.push({ x: 0, y: 0, w: W, h: y0 });
    } else {
        const hh = Math.max(4, Math.round(H * rng.float(0.4, 0.5)));
        hubRect = { x: 0, y: H - hh, w: W, h: hh };
        let topH = H - hh;
        if (cut) {
            cut.h = Math.min(cut.h, topH - 3);
            if (cut.h < 3) cut = null;   // a thinner strip would be skipped by the slicer → hole
        }
        if (cut) {
            if (cut.corner === 'tl') regions.push({ x: cut.w, y: 0, w: W - cut.w, h: cut.h });
            else regions.push({ x: 0, y: 0, w: W - cut.w, h: cut.h });
            regions.push({ x: 0, y: cut.h, w: W, h: topH - cut.h });
        } else {
            regions.push({ x: 0, y: 0, w: W, h: topH });
        }
    }

    const hub = { i: 0, ...hubRect };
    rooms.push(hub);

    const AREA_MAX = kind === 'house' || kind === 'shop' ? 22 : 30;
    (function slice(list) {
        for (const rect of list) {
            if (rect.w < 3 || rect.h < 3) continue;   // too thin — merge into nothing (rare)
            subdivide(rect);
        }
        function subdivide(rect) {
            const canV = rect.w >= 6, canH = rect.h >= 6;
            if (rect.w * rect.h <= AREA_MAX || (!canV && !canH)) {
                rooms.push({ i: rooms.length, ...rect });
                return;
            }
            const vertical = canV && (!canH || (rect.w > rect.h ? true : (rect.w < rect.h ? false : rng.chance(0.5))));
            if (vertical) {
                const c = Math.max(3, Math.min(rect.w - 3, Math.round(rect.w * rng.float(0.35, 0.65))));
                subdivide({ x: rect.x, y: rect.y, w: c, h: rect.h });
                subdivide({ x: rect.x + c, y: rect.y, w: rect.w - c, h: rect.h });
            } else {
                const c = Math.max(3, Math.min(rect.h - 3, Math.round(rect.h * rng.float(0.35, 0.65))));
                subdivide({ x: rect.x, y: rect.y, w: rect.w, h: c });
                subdivide({ x: rect.x, y: rect.y + c, w: rect.w, h: rect.h - c });
            }
        }
    })(regions);

    /* ---- doors: BFS from hub over shared walls → always connected ---- */
    function sharedWall(A, B) {
        if (A.x + A.w === B.x || B.x + B.w === A.x) {
            const x = (A.x + A.w === B.x) ? B.x : A.x;
            const y0 = Math.max(A.y, B.y), y1 = Math.min(A.y + A.h, B.y + B.h);
            if (y1 - y0 >= 1) return { orient: 'v', x, y: Math.floor((y0 + y1) / 2) };
        }
        if (A.y + A.h === B.y || B.y + B.h === A.y) {
            const y = (A.y + A.h === B.y) ? B.y : A.y;
            const x0 = Math.max(A.x, B.x), x1 = Math.min(A.x + A.w, B.x + B.w);
            if (x1 - x0 >= 1) return { orient: 'h', y, x: Math.floor((x0 + x1) / 2) };
        }
        return null;
    }

    const doors = [];   // { orient, x, y, a, b }
    const edges = [];
    const visited = new Set([0]);
    const order = [0];  // BFS order → purpose depth
    const queue = [0];
    while (queue.length) {
        const ai = queue.shift();
        for (const b of rooms) {
            if (visited.has(b.i)) continue;
            const wall = sharedWall(rooms[ai], b);
            if (!wall) continue;
            visited.add(b.i);
            order.push(b.i);
            queue.push(b.i);
            doors.push({ ...wall, a: ai, b: b.i });
            edges.push({ a: ai, b: b.i, kind: 'door' });
        }
    }
    // Any isolated rects (shouldn't happen, but never ship a sealed room).
    for (const r of rooms) {
        if (!visited.has(r.i)) {
            for (const o of rooms) {
                if (o.i === r.i || !visited.has(o.i)) continue;
                const wall = sharedWall(r, o);
                if (wall) {
                    visited.add(r.i); order.push(r.i);
                    doors.push({ ...wall, a: o.i, b: r.i });
                    edges.push({ a: o.i, b: r.i, kind: 'door' });
                    break;
                }
            }
        }
    }

    // street entrance on the bottom wall of the hub
    const entranceX = hub.x + Math.floor(hub.w / 2) + rng.int(-Math.floor(hub.w / 4), Math.floor(hub.w / 4));
    doors.push({ orient: 'h', x: Math.max(hub.x, Math.min(hub.x + hub.w - 1, entranceX)), y: H, a: 0, b: 'street' });

    /* ---- purposes by BFS depth (deeper room → later list entry) ---- */
    const plan = INTERIOR_PLANS[kind] || INTERIOR_PLANS.tavern;
    const deco = new Rng(`${seed}/deco:${kind}`);
    const extras = ['storage', 'spare room', 'closet'];
    order.forEach((ri, k) => {
        const r = rooms[ri];
        r.purpose = k === 0 ? plan.hub : (plan.rooms[k - 1] || deco.pick(extras));
        const n = deco.int(1, r.w * r.h > 20 ? 3 : 2);
        const items = new Set();
        for (let i = 0; i < n; i++) items.add(furnitureFor(deco, r.purpose));
        r.notes = [...items].join(', ');
    });

    /* ---- windows on exterior walls (cosmetic) ---- */
    const inside = (x, y) => rooms.some(r => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
    const windows = [];
    for (const r of rooms) {
        for (let x = r.x + 1; x < r.x + r.w - 1; x += deco.int(3, 4)) {
            if (!inside(x, r.y - 1)) windows.push({ orient: 'h', x, y: r.y });
            if (!inside(x, r.y + r.h)) windows.push({ orient: 'h', x, y: r.y + r.h });
        }
        for (let y = r.y + 1; y < r.y + r.h - 1; y += deco.int(3, 4)) {
            if (!inside(r.x - 1, y)) windows.push({ orient: 'v', x: r.x, y });
            if (!inside(r.x + r.w, y)) windows.push({ orient: 'v', x: r.x + r.w, y });
        }
    }

    /* ---- name ---- */
    const nameRng = new Rng(`${seed}/names`);
    model.name = {
        tavern: () => nameFor(nameRng, 'tavern'),
        temple: () => `Temple of the ${nameRng.pick(['Dawn', 'Deep', 'Silent Flame', 'Veiled Moon', 'Iron Oath'])}`,
        keep: () => `${word(nameRng)} Keep`,
        manor: () => `${nameFor(nameRng, 'person')} Manor`,
        house: () => `${nameFor(nameRng, 'person')}'s house`,
        shop: () => `${nameFor(nameRng, 'person')}'s shop`,
    }[kind]();

    /* ---- assemble ---- */
    const cx0 = W / 2;
    for (const r of rooms) {
        model.entities.push({
            id: 'r' + (r.i + 1), kind: 'room',
            name: titleCase(r.purpose), purpose: r.purpose,
            x: r.x, y: r.y, w: r.w, h: r.h,
            tags: r.i === 0 ? ['entrance'] : [],
            notes: r.notes,
        });
    }
    doors.forEach((d, i) => model.entities.push({
        id: 'do' + (i + 1), kind: 'door', x: d.x, y: d.y,
        tags: [d.orient], notes: '',
    }));
    windows.forEach((w, i) => model.entities.push({
        id: 'wi' + (i + 1), kind: 'window', x: w.x, y: w.y, tags: [w.orient],
    }));

    const cxOf = r => r.x + r.w / 2, cyOf = r => r.y + r.h / 2;
    model.edges = edges.map(e => ({
        a: 'r' + (e.a + 1), b: 'r' + (e.b + 1), kind: 'door',
        dir: compass(cxOf(rooms[e.a]), cyOf(rooms[e.a]), cxOf(rooms[e.b]), cyOf(rooms[e.b])),
    }));
    model.edges.push({ a: 'r1', b: 'street', kind: 'door', dir: 'S' });

    /* ---- cell grid for the ASCII minimap ----
     * Room chars MUST be non-digits: the RLE codec uses digits for run
     * counts, so digit tiles would corrupt the encoding. a=room 1, b=2… */
    const grid = Array.from({ length: H }, () => Array(W).fill('#'));
    for (const r of rooms) {
        const ch = String.fromCharCode(97 + (r.i % 26));
        for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) grid[y][x] = ch;
    }
    model.layers.grid = rleEncode(grid.map(row => row.join('')));
    model.layers.doors = doors;
    model.layers.cellGrid = true;   // tells the describer this grid is room-ids, not tiles
    if (cut) model.layers.cut = cut;
    model.layers.outline = outlinePts(W, H, cut);
    return model;
}

function outlinePts(W, H, cut) {
    if (!cut) return [[0, 0], [W, 0], [W, H], [0, H]];
    if (cut.corner === 'tl') return [[cut.w, 0], [W, 0], [W, H], [0, H], [0, cut.h], [cut.w, cut.h]];
    return [[0, 0], [W - cut.w, 0], [W - cut.w, cut.h], [W, cut.h], [W, H], [0, H]];
}
