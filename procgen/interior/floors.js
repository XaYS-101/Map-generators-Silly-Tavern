/* ------------------------------------------------------------------
 *  Interior — multi-floor assembly.
 *
 *  buildFloors() turns a building kind + params into a stack of floors
 *  (cellar / ground / upper), each a fully-tiled skeleton with room
 *  purposes, global room ids, per-floor letters and the stairs linking
 *  consecutive levels. Geometry only — doors, windows, locks, content
 *  and names are layered on by gen-interior.js.
 *
 *  Floor eligibility is driven by size, with a "wealthy" building
 *  treated one size larger. The layout stream key never carries the
 *  building's `condition`, so state (looted / lived-in) can never
 *  reshape the geometry.
 * ------------------------------------------------------------------ */
import { groundDims, buildSkeleton, sliceRegion, titleCase } from './layout.js';
import { computeOrder } from './doors.js';
import { INTERIOR_PLANS } from '../names.js';

const SIZE_RANK = { small: 0, medium: 1, large: 2 };

/* min effective size-rank at which a cellar / upper floor appears
 * (null = never). mill's upper is 0 → always. */
const KIND_FLOORS = {
    tavern: { cellar: 1, upper: 1 },
    manor: { cellar: 1, upper: 1 },
    keep: { cellar: 1, upper: 1 },
    warehouse: { cellar: 1, upper: 1 },
    house: { cellar: 2, upper: 1 },
    shop: { cellar: 2, upper: 2 },
    temple: { cellar: 1, upper: null },
    smithy: { cellar: 2, upper: null },
    barracks: { cellar: null, upper: 1 },
    caravanserai: { cellar: null, upper: 2 },
    mill: { cellar: null, upper: 0 },
};

export const CELLAR_ROOMS = ['cellar', 'wine cellar', 'root cellar', 'strongroom'];
export const UPPER_ROOMS = ['upstairs bedroom', 'guest room', 'loft', 'study'];
const EXTRAS = ['storage', 'spare room', 'closet'];

/**
 * @returns {{floors, roomsAll, stairs, stairEdges, W, H}}
 *   floors: level-ascending; roomsAll: level-ascending, r1.. id order.
 */
export function buildFloors(kind, p, seed, layoutRng) {
    const { W, H } = groundDims(kind, p.size, layoutRng);

    // ---- ground floor ----
    const gRng = layoutRng.sub('L0');
    const sk = buildSkeleton(kind, W, H, gRng);
    const ground = { level: 0, label: 'Ground floor', w: W, h: H, cut: sk.cut, rooms: [] };
    sk.rooms.forEach((r, i) => ground.rooms.push({
        x: r.x, y: r.y, w: r.w, h: r.h, level: 0, li: i,
        role: r.role || null, courtyard: !!r.courtyard,
        tags: [], notes: '', content: null,
    }));
    ground.hub = ground.rooms.find(r => r.role === 'hub') || ground.rooms[0];
    ground.corridor = ground.rooms.find(r => r.role === 'corridor') || null;
    ground.courtyard = ground.rooms.find(r => r.courtyard) || null;
    ground.gate = ground.rooms.find(r => r.role === 'gate') || null;
    assignGroundPurposes(kind, ground, gRng);

    // ---- optional cellar / upper ----
    const effRank = Math.min(2, (SIZE_RANK[p.size] ?? 1) + (p.wealth === 'wealthy' ? 1 : 0));
    const spec = KIND_FLOORS[kind] || {};
    const floors = [];
    if (spec.cellar != null && effRank >= spec.cellar) {
        floors.push(buildAux(kind, -1, 'Cellar', W, H, 0.8, layoutRng.sub('Lm1')));
    }
    floors.push(ground);
    if (spec.upper != null && effRank >= spec.upper) {
        floors.push(buildAux(kind, 1, 'Upper floor', W, H, 0.85, layoutRng.sub('Lp1')));
    }
    floors.sort((a, b) => a.level - b.level);

    // ---- global room ids (level-ascending) ----
    let gid = 0;
    const roomsAll = [];
    for (const f of floors) for (const r of f.rooms) { r.id = 'r' + (++gid); roomsAll.push(r); }

    // ---- tags ----
    addTag(ground.hub, 'entrance');
    if (ground.courtyard) { addTag(ground.courtyard, 'courtyard'); addTag(ground.courtyard, 'open'); ground.courtyard.open = true; }

    // ---- stairs ----
    const { stairs, stairEdges } = buildStairs(floors);

    return { floors, roomsAll, stairs, stairEdges, W, H };
}

function addTag(room, tag) { if (!room.tags.includes(tag)) room.tags.push(tag); }

function assignGroundPurposes(kind, floor, rng) {
    const plan = INTERIOR_PLANS[kind] || { hub: 'hall', rooms: [] };
    const { order } = computeOrder(floor.rooms);
    const eRng = rng.sub('purpose');
    let pi = 0;
    for (const r of order) {
        if (r.role === 'hub') r.purpose = plan.hub;
        else if (r.role === 'corridor') r.purpose = 'hallway';
        else if (r.role === 'gate') r.purpose = 'gate';
        else r.purpose = plan.rooms[pi++] || eRng.pick(EXTRAS);
        r.name = titleCase(r.purpose);
    }
    for (const r of floor.rooms) if (!r.purpose) { r.purpose = eRng.pick(EXTRAS); r.name = titleCase(r.purpose); }
}

/* Cellar / upper: a hub-less simple slicer; the first room is the stair
 * landing and connectivity root. Purposes come from the per-level pool. */
function buildAux(kind, level, label, W, H, scale, rng) {
    const w = Math.max(6, Math.round(W * scale));
    const h = Math.max(5, Math.round(H * scale));
    const rects = sliceRegion({ x: 0, y: 0, w, h }, 'any', rng, 24);
    const floor = { level, label, w, h, cut: null, rooms: [] };
    rects.forEach((r, i) => floor.rooms.push({
        x: r.x, y: r.y, w: r.w, h: r.h, level, li: i,
        role: null, courtyard: false, tags: [], notes: '', content: null,
    }));
    floor.rooms[0].role = 'hub';        // landing
    floor.hub = floor.rooms[0];

    const isCellar = level < 0;
    const pool = rng.sub('pool').shuffle(isCellar ? CELLAR_ROOMS : UPPER_ROOMS);
    let forcedFirst = null;
    if (isCellar && kind === 'temple') forcedFirst = 'crypt';
    if (!isCellar && kind === 'mill') forcedFirst = 'grain loft';
    floor.rooms.forEach((r, i) => {
        r.purpose = (i === 0 && forcedFirst) ? forcedFirst : pool[i % pool.length];
        r.name = titleCase(r.purpose);
    });
    return floor;
}

function buildStairs(floors) {
    const stairs = [], stairEdges = [];
    let n = 0;
    for (let i = 0; i < floors.length - 1; i++) {
        const lo = floors[i], hi = floors[i + 1];
        const loRoom = pickStair(lo, hi.level);
        const hiRoom = pickStair(hi, lo.level);
        addTag(loRoom, 'stairs'); addTag(hiRoom, 'stairs');
        stairs.push({ id: 'st' + (++n), kind: 'stair', level: lo.level, to: hi.level, x: loRoom.x + Math.floor(loRoom.w / 2), y: loRoom.y + Math.floor(loRoom.h / 2), room: loRoom.id });
        stairs.push({ id: 'st' + (++n), kind: 'stair', level: hi.level, to: lo.level, x: hiRoom.x + Math.floor(hiRoom.w / 2), y: hiRoom.y + Math.floor(hiRoom.h / 2), room: hiRoom.id });
        stairEdges.push({ a: loRoom.id, b: hiRoom.id, kind: 'stair', dir: 'up' });
    }
    return { stairs, stairEdges };
}

function pickStair(floor, otherLevel) {
    if (floor.level !== 0) return floor.rooms[0];            // aux landing
    const hub = floor.hub;
    if (otherLevel < 0) {
        const cs = floor.rooms.find(r => r.purpose === 'cellar stair');
        if (cs) return cs;
    }
    const cands = floor.rooms.filter(r => r !== hub);
    if (!cands.length) return hub;
    const hcx = hub.x + hub.w / 2, hcy = hub.y + hub.h / 2;
    let best = cands[0], bestD = Infinity;
    for (const r of cands) {
        const d = (r.x + r.w / 2 - hcx) ** 2 + (r.y + r.h / 2 - hcy) ** 2;
        if (d < bestD - 1e-9 || (Math.abs(d - bestD) < 1e-9 && r.li < best.li)) { bestD = d; best = r; }
    }
    return best;
}
