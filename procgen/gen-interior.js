/* ------------------------------------------------------------------
 *  Building interior generator (single floor, 1 cell = 1 m).
 *
 *  Realistic circulation: most buildings get a HALLWAY —
 *   - tavern/shop/temple: a horizontal hallway between the hub room
 *     (common room / shopfront / nave) and a row of back rooms;
 *   - manor/keep: a central vertical hallway off the great hall with
 *     rooms opening onto it from both sides;
 *   - house: no hallway — the hearth room is the hub of a cottage.
 *  Doors prefer hallway → hub → (only as a last resort) another room,
 *  so you never walk through the kitchen to reach a guest room.
 * ------------------------------------------------------------------ */
import { Rng } from './rng.js';
import { makeEnvelope, compass, rleEncode } from './schema.js';
import { nameFor, word, INTERIOR_PLANS, furnitureFor } from './names.js';

const KIND_SIZE = {
    house: [12, 9], shop: [12, 10], tavern: [18, 12],
    temple: [18, 14], manor: [22, 14], keep: [22, 16],
};
const SIDE_CORRIDOR = new Set(['manor', 'keep']);        // vertical central hallway
const TOP_CORRIDOR = new Set(['tavern', 'shop', 'temple']); // hallway behind the hub

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

    const rooms = [];
    const addRoom = (r) => { const room = { i: rooms.length, ...r }; rooms.push(room); return room; };

    const AREA_MAX = (kind === 'house' || kind === 'shop') ? 22 : 30;
    function subdivide(rect, axis) {
        const canV = rect.w >= 6 && axis !== 'h';
        const canH = rect.h >= 6 && axis !== 'v';
        if (rect.w * rect.h <= AREA_MAX || (!canV && !canH)) {
            addRoom(rect);
            return;
        }
        const vertical = canV && (!canH || (rect.w > rect.h ? true : (rect.w < rect.h ? false : rng.chance(0.5))));
        if (vertical) {
            const c = Math.max(3, Math.min(rect.w - 3, Math.round(rect.w * rng.float(0.35, 0.65))));
            subdivide({ x: rect.x, y: rect.y, w: c, h: rect.h }, axis);
            subdivide({ x: rect.x + c, y: rect.y, w: rect.w - c, h: rect.h }, axis);
        } else {
            const c = Math.max(3, Math.min(rect.h - 3, Math.round(rect.h * rng.float(0.35, 0.65))));
            subdivide({ x: rect.x, y: rect.y, w: rect.w, h: c }, axis);
            subdivide({ x: rect.x, y: rect.y + c, w: rect.w, h: rect.h - c }, axis);
        }
    }
    const sliceRegion = (rect, axis) => {
        if (rect.w >= 3 && rect.h >= 3) subdivide(rect, axis);
    };

    /* ---- layout: hub + optional hallway + sliced regions ---- */
    let cut = null;       // L-shape (house only)
    let hub, corridor = null;

    if (SIDE_CORRIDOR.has(kind)) {
        // great hall across the bottom, hallway running up the middle,
        // rooms opening onto it left and right (horizontal cuts only →
        // every room touches the hallway)
        const hh = Math.max(4, Math.round(H * 0.32));
        hub = addRoom({ x: 0, y: H - hh, w: W, h: hh });
        const cx = Math.max(3, Math.min(W - 5, Math.round(W / 2) - 1 + rng.int(-1, 1)));
        corridor = addRoom({ x: cx, y: 0, w: 2, h: H - hh });
        sliceRegion({ x: 0, y: 0, w: cx, h: H - hh }, 'h');
        sliceRegion({ x: cx + 2, y: 0, w: W - cx - 2, h: H - hh }, 'h');
    } else if (TOP_CORRIDOR.has(kind)) {
        // hub at the entrance, hallway behind it, a row of back rooms
        // (vertical cuts only → every back room opens onto the hallway)
        const topH = Math.max(4, Math.min(6, Math.round(H * 0.35)));
        const hh = H - 2 - topH;
        hub = addRoom({ x: 0, y: H - hh, w: W, h: hh });
        corridor = addRoom({ x: 0, y: topH, w: W, h: 2 });
        sliceRegion({ x: 0, y: 0, w: W, h: topH }, 'v');
    } else {
        // cottage: hearth room is the hub, optionally L-shaped
        if (rng.chance(0.35)) {
            cut = {
                corner: rng.chance(0.5) ? 'tl' : 'tr',
                w: Math.round(W * rng.float(0.28, 0.4)),
                h: Math.round(H * rng.float(0.25, 0.35)),
            };
        }
        const hh = Math.max(4, Math.round(H * rng.float(0.4, 0.5)));
        const topH = H - hh;
        if (cut) {
            cut.h = Math.min(cut.h, topH - 3);
            if (cut.h < 3) cut = null;   // a thinner strip would be skipped by the slicer → hole
        }
        hub = addRoom({ x: 0, y: H - hh, w: W, h: hh });
        if (cut) {
            if (cut.corner === 'tl') sliceRegion({ x: cut.w, y: 0, w: W - cut.w, h: cut.h }, 'any');
            else sliceRegion({ x: 0, y: 0, w: W - cut.w, h: cut.h }, 'any');
            sliceRegion({ x: 0, y: cut.h, w: W, h: topH - cut.h }, 'any');
        } else {
            sliceRegion({ x: 0, y: 0, w: W, h: topH }, 'any');
        }
    }

    /* ---- doors: hallway first, hub second, through-room last ---- */
    function sharedWall(A, B) {
        if (A.x + A.w === B.x || B.x + B.w === A.x) {
            const x = (A.x + A.w === B.x) ? B.x : A.x;
            const y0 = Math.max(A.y, B.y), y1 = Math.min(A.y + A.h, B.y + B.h);
            if (y1 - y0 >= 1) return { orient: 'v', x, y: Math.floor((y0 + y1) / 2), len: y1 - y0 };
        }
        if (A.y + A.h === B.y || B.y + B.h === A.y) {
            const y = (A.y + A.h === B.y) ? B.y : A.y;
            const x0 = Math.max(A.x, B.x), x1 = Math.min(A.x + A.w, B.x + B.w);
            if (x1 - x0 >= 1) return { orient: 'h', y, x: Math.floor((x0 + x1) / 2), len: x1 - x0 };
        }
        return null;
    }

    const doors = [];
    const edges = [];
    const connected = new Set([hub.i]);
    const order = [hub.i];   // connection order → purpose depth
    function connect(a, b) {
        const wall = sharedWall(rooms[a], rooms[b]);
        if (!wall) return false;
        doors.push({ orient: wall.orient, x: wall.x, y: wall.y, a, b });
        edges.push({ a, b, kind: 'door' });
        connected.add(b);
        order.push(b);
        return true;
    }

    if (corridor) connect(hub.i, corridor.i);
    if (corridor) {
        for (const r of rooms) {
            if (!connected.has(r.i) && sharedWall(r, corridor)) connect(corridor.i, r.i);
        }
    }
    for (const r of rooms) {
        if (!connected.has(r.i) && sharedWall(r, hub)) connect(hub.i, r.i);
    }
    // leftovers: attach to the connected neighbor with the longest shared wall
    let progress = true;
    while (progress && connected.size < rooms.length) {
        progress = false;
        for (const r of rooms) {
            if (connected.has(r.i)) continue;
            let best = -1, bestLen = 0;
            for (const o of rooms) {
                if (!connected.has(o.i) || o.i === r.i) continue;
                const wall = sharedWall(r, o);
                if (wall && wall.len > bestLen) { bestLen = wall.len; best = o.i; }
            }
            if (best >= 0) { connect(best, r.i); progress = true; }
        }
    }

    // street entrance on the bottom wall of the hub
    const entranceX = hub.x + Math.floor(hub.w / 2) + rng.int(-Math.floor(hub.w / 4), Math.floor(hub.w / 4));
    doors.push({ orient: 'h', x: Math.max(hub.x, Math.min(hub.x + hub.w - 1, entranceX)), y: H, a: hub.i, b: 'street' });

    /* ---- purposes by connection order (deeper room → later list entry) ---- */
    const plan = INTERIOR_PLANS[kind] || INTERIOR_PLANS.tavern;
    const deco = new Rng(`${seed}/deco:${kind}`);
    const extras = ['storage', 'spare room', 'closet'];
    let pi = 0;
    const assignPurpose = (r) => {
        if (r.i === hub.i) r.purpose = plan.hub;
        else if (corridor && r.i === corridor.i) r.purpose = 'hallway';
        else r.purpose = plan.rooms[pi++] || deco.pick(extras);
        const n = deco.int(1, r.w * r.h > 20 ? 3 : 2);
        const items = new Set();
        for (let i = 0; i < n; i++) items.add(furnitureFor(deco, r.purpose));
        r.notes = [...items].join(', ');
    };
    for (const ri of order) assignPurpose(rooms[ri]);
    for (const r of rooms) if (!r.purpose) assignPurpose(r);   // safety net

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
    for (const r of rooms) {
        model.entities.push({
            id: 'r' + (r.i + 1), kind: 'room',
            name: titleCase(r.purpose), purpose: r.purpose,
            x: r.x, y: r.y, w: r.w, h: r.h,
            tags: r.i === hub.i ? ['entrance'] : [],
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
    model.edges.push({ a: 'r' + (hub.i + 1), b: 'street', kind: 'door', dir: 'S' });

    /* ---- cell grid ----
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
