/* ------------------------------------------------------------------
 *  Per-type painters. Each receives (ctx, model, rng, h, view):
 *   - rng:  seeded style stream (cosmetic only)
 *   - h:    ink primitives from render.js (inkLine/inkPoly/inkRect/
 *           hatchPoly/label + palette)
 *   - view: { s: scale px-per-unit, ox, oy: margins }
 * ------------------------------------------------------------------ */
import { rleDecode } from './schema.js';
import { BIOME_CODES } from './region/biomes.js';

const idNum = id => Number(String(id).replace(/^\D+/, ''));

/* ------------------------------------------------------------------
 *  Dungeon: polygon floor + traced wall loops with diagonal smoothing
 *  + outside crosshatch, classic one-page-dungeon look.
 * ------------------------------------------------------------------ */
const DUNGEON_FLOOR = {
    crypt: '#ece2c8', ruins: '#e9e3c9', stronghold: '#eadfc2',
    sewer: '#e2e4c4', caves: '#e6dcc3',
};

/* Per-theme line character: crosshatch alpha, wall wobble, water tint. */
const THEME_STYLE = {
    crypt: { hatch: 0.34, wallWobble: 0.9 },
    ruins: { hatch: 0.22, wallWobble: 1.3 },
    stronghold: { hatch: 0.30, wallWobble: 0.6 },
    sewer: { hatch: 0.30, wallWobble: 0.8, water: '#a9c4b8' },
    caves: { hatch: 0.26, wallWobble: 1.6 },
};

const FLOOR_CHARS = new Set(['.', '+', '<', '>', '~']);

/* ------------------------------------------------------------------
 *  Boundary tracer. Pure & RNG-free (node-testable).
 *
 *  Walks the floor/wall boundary into closed vertex loops. Edges are
 *  directed with the floor on the LEFT of travel, so outer boundaries
 *  and holes (pillars) wind oppositely — a single nonzero-winding fill
 *  paints floors and keeps holes. With smooth:true, collinear unit
 *  edges merge into runs and 1:1 staircases (octagon chamfers, rotunda
 *  rims) collapse into diagonals; 4-edge loops (1x1 pillars) are kept
 *  square. Vertices are cell-corner coords; loops omit the closing
 *  duplicate vertex.
 * ------------------------------------------------------------------ */
export function traceDungeonWalls(rows, { smooth = true } = {}) {
    const H = rows.length, W = rows[0].length;
    const at = (x, y) => (rows[y]?.[x]) ?? '#';
    const floor = (x, y) => FLOOR_CHARS.has(at(x, y));

    // directed boundary edges, keyed by start vertex
    const edges = new Map();
    const add = (x1, y1, x2, y2) => {
        const k = x1 + ',' + y1;
        if (!edges.has(k)) edges.set(k, []);
        edges.get(k).push([x2, y2]);
    };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        if (!floor(x, y)) continue;
        if (!floor(x, y - 1)) add(x + 1, y, x, y);           // top side, travel -x
        if (!floor(x, y + 1)) add(x, y + 1, x + 1, y + 1);   // bottom side, travel +x
        if (!floor(x - 1, y)) add(x, y, x, y + 1);           // left side, travel +y
        if (!floor(x + 1, y)) add(x + 1, y + 1, x + 1, y);   // right side, travel -y
    }

    const loops = [];
    for (const [k, list] of edges) {
        while (list.length) {
            const [sx, sy] = k.split(',').map(Number);
            let [cx, cy] = list.pop();
            let px = sx, py = sy;
            const loop = [[sx, sy]];
            while (cx !== sx || cy !== sy) {
                loop.push([cx, cy]);
                const cands = edges.get(cx + ',' + cy);
                if (!cands || !cands.length) break;          // broken boundary (shouldn't happen)
                let idx = 0;
                if (cands.length > 1) {
                    // ambiguous vertex (regions touching diagonally): prefer the
                    // left-most turn to keep hugging the same region
                    const dinX = cx - px, dinY = cy - py;
                    const pref = [[dinY, -dinX], [dinX, dinY], [-dinY, dinX]];
                    outer: for (const [pdx, pdy] of pref) {
                        for (let i = 0; i < cands.length; i++) {
                            if (cands[i][0] - cx === pdx && cands[i][1] - cy === pdy) { idx = i; break outer; }
                        }
                    }
                }
                const [nx, ny] = cands.splice(idx, 1)[0];
                px = cx; py = cy;
                cx = nx; cy = ny;
            }
            loops.push(smooth ? simplifyLoop(loop) : loop);
        }
    }
    return loops;
}

function simplifyLoop(pts) {
    const n = pts.length;
    if (n <= 4) return pts.slice();                          // 1x1 pillars stay square
    const dirAt = i => {
        const a = pts[i], b = pts[(i + 1) % n];
        return (b[0] - a[0]) + ',' + (b[1] - a[1]);
    };
    // rotate so the list starts at a corner
    let s0 = 0;
    for (let i = 0; i < n; i++) {
        if (dirAt((i + n - 1) % n) !== dirAt(i)) { s0 = i; break; }
    }
    const rp = [];
    for (let i = 0; i < n; i++) rp.push(pts[(s0 + i) % n]);

    // merge collinear unit edges into direction tokens
    const toks = [];
    for (let i = 0; i < n; i++) {
        const a = rp[i], b = rp[(i + 1) % n];
        const d = (b[0] - a[0]) + ',' + (b[1] - a[1]);
        const last = toks[toks.length - 1];
        if (last && last.d === d) { last.len++; last.end = b; }
        else toks.push({ d, len: 1, start: a, end: b });
    }

    // collapse maximal alternating runs of unit tokens into diagonals
    const segs = [];
    let i = 0;
    while (i < toks.length) {
        const t = toks[i];
        if (t.len === 1 && i + 1 < toks.length && toks[i + 1].len === 1 && toks[i + 1].d !== t.d) {
            const pair = new Set([t.d, toks[i + 1].d]);
            let j = i + 1;
            while (j < toks.length && toks[j].len === 1 && pair.has(toks[j].d)) j++;
            if (j - i >= toks.length) j = toks.length - 1;    // never swallow the whole loop
            if (j - i >= 2) {
                segs.push({ start: t.start, end: toks[j - 1].end });
                i = j;
                continue;
            }
        }
        segs.push(t);
        i++;
    }

    const verts = [segs[0].start];
    for (const seg of segs) verts.push(seg.end);
    verts.pop();                                             // closing duplicate
    return verts;
}

export function drawDungeon(ctx, model, rng, h, view) {
    const { s, ox, oy } = view;
    const px = (x, y) => [ox + x * s, oy + y * s];
    const rows = rleDecode(model.layers.grid);
    const W = rows[0].length, H = rows.length;
    const at = (x, y) => (rows[y]?.[x]) ?? '#';
    const isFloor = c => FLOOR_CHARS.has(c);
    const wallAt = (x, y) => !isFloor(at(x, y));
    const floorColor = DUNGEON_FLOOR[model.params.theme] || DUNGEON_FLOOR.crypt;
    const style = THEME_STYLE[model.params.theme] || THEME_STYLE.crypt;

    // wall loops traced once: polygon floor fill + smoothed wall ink both
    // come from them, so diagonals stay perfectly aligned
    const loops = traceDungeonWalls(rows, { smooth: true });

    // floor: one path, nonzero winding keeps pillar holes unfilled
    ctx.fillStyle = floorColor;
    ctx.beginPath();
    for (const loop of loops) {
        loop.forEach(([vx, vy], i) => {
            const [X, Y] = px(vx, vy);
            if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y);
        });
        ctx.closePath();
    }
    ctx.fill();

    // subtle tile variation specks
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        if (!isFloor(at(x, y)) || !rng.chance(0.07)) continue;
        ctx.fillStyle = 'rgba(120,95,55,0.07)';
        ctx.fillRect(ox + x * s + 1, oy + y * s + 1, s - 2, s - 2);
    }

    // water tiles (sewer basins): tinted fill + faint wave strokes
    ctx.fillStyle = style.water || '#b9cbc6';
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        if (at(x, y) === '~') ctx.fillRect(ox + x * s, oy + y * s, s, s);
    }
    ctx.strokeStyle = 'rgba(70,100,110,0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        if (at(x, y) !== '~' || !rng.chance(0.4)) continue;
        const wy = oy + y * s + s * rng.float(0.3, 0.7);
        ctx.moveTo(ox + x * s + s * 0.15, wy);
        ctx.lineTo(ox + x * s + s * 0.55, wy);
    }
    ctx.stroke();

    // crosshatch band on wall cells that touch floor
    ctx.strokeStyle = `rgba(58,44,26,${style.hatch})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        if (isFloor(at(x, y))) continue;
        let near = false;
        for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) {
            if (isFloor(at(x + dx, y + dy))) { near = true; break; }
        }
        if (!near) continue;
        const [x0, y0] = px(x, y);
        const j = rng.float(-1.5, 1.5);
        ctx.moveTo(x0 + j, y0 + s);
        ctx.lineTo(x0 + s + j, y0);
    }
    ctx.stroke();

    // wall ink: smoothed boundary loops (long straights + 45° chamfers)
    for (const loop of loops) {
        h.inkPoly(loop.map(([vx, vy]) => px(vx, vy)), { width: 2.2, wobble: style.wallWobble });
    }

    // secret / locked door cells (Phase 3 tracks the door cell on the edge)
    const secretAt = new Set(), lockedAt = new Set();
    for (const e of model.edges || []) {
        for (const cell of [e.at, e.at2]) {
            if (!cell) continue;
            const k = cell[0] + ',' + cell[1];
            if (e.kind === 'secret') secretAt.add(k);   // both thresholds hidden
            if (e.locked) lockedAt.add(k);              // sealed at both ends
        }
    }

    // doors, stairs
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const c = at(x, y);
        const [x0, y0] = px(x, y);
        if (c === '+') {
            const vertCorr = wallAt(x - 1, y) && wallAt(x + 1, y);
            const rect = vertCorr
                ? [x0 + s * 0.1, y0 + s * 0.3, s * 0.8, s * 0.4]
                : [x0 + s * 0.3, y0 + s * 0.1, s * 0.4, s * 0.8];
            if (secretAt.has(x + ',' + y)) {
                // hidden door: dashed outline + a small "S", no solid rect
                ctx.save();
                ctx.setLineDash([2, 2]);
                ctx.strokeStyle = h.INK;
                ctx.globalAlpha = 0.6;
                ctx.lineWidth = 1;
                ctx.strokeRect(...rect);
                ctx.restore();
                ctx.globalAlpha = 0.8;
                ctx.fillStyle = h.INK;
                ctx.font = `600 ${Math.max(7, s * 0.5)}px Georgia, serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText('S', x0 + s / 2, y0 + s / 2);
                ctx.textAlign = 'start';
                ctx.textBaseline = 'alphabetic';
                ctx.globalAlpha = 1;
            } else if (lockedAt.has(x + ',' + y)) {
                // locked: dark barred door + parchment keyhole
                ctx.fillStyle = 'rgba(58,44,26,0.85)';
                ctx.fillRect(...rect);
                h.inkRect(...rect, { width: 1.1, wobble: 0.4, overshoot: 1 });
                ctx.fillStyle = h.PARCHMENT;
                ctx.beginPath();
                ctx.arc(x0 + s / 2, y0 + s / 2, Math.max(1.2, s * 0.09), 0, Math.PI * 2);
                ctx.fill();
            } else {
                ctx.fillStyle = h.PARCHMENT;
                ctx.fillRect(...rect);
                h.inkRect(...rect, { width: 1.1, wobble: 0.4, overshoot: 1 });
            }
        } else if (c === '>') {
            for (let i = 1; i <= 3; i++) {
                const inset = i * s * 0.15;
                h.inkLine([[x0 + inset, y0 + s - inset], [x0 + s - inset, y0 + s - inset]], { width: 1.1, wobble: 0.25 });
            }
        } else if (c === '<') {
            h.inkLine([[x0 + s * 0.2, y0 + s * 0.6], [x0 + s * 0.5, y0 + s * 0.25], [x0 + s * 0.8, y0 + s * 0.6]], { width: 1.4, wobble: 0.25 });
        }
    }

    // entrance approach: fading dashes from the outer wall toward the border
    let ent = null;
    for (let y = 0; y < H && !ent; y++) for (let x = 0; x < W; x++) {
        if (at(x, y) === '<') { ent = [x, y]; break; }
    }
    if (ent) {
        const dirs = [[ent[0], [-1, 0]], [W - 1 - ent[0], [1, 0]], [ent[1], [0, -1]], [H - 1 - ent[1], [0, 1]]]
            .sort((a, b) => a[0] - b[0]);
        const [ddx, ddy] = dirs[0][1];
        let wx = ent[0], wy = ent[1];
        while (isFloor(at(wx + ddx, wy + ddy))) { wx += ddx; wy += ddy; }  // last floor cell
        ctx.strokeStyle = h.INK;
        ctx.lineWidth = 1.4;
        ctx.lineCap = 'round';
        for (let i = 0; i < 3; i++) {
            const t0 = 0.45 + i * 0.85, t1 = t0 + 0.45;
            const [ax, ay] = px(wx + 0.5 + ddx * t0, wy + 0.5 + ddy * t0);
            const [bx, by] = px(wx + 0.5 + ddx * t1, wy + 0.5 + ddy * t1);
            ctx.globalAlpha = 0.5 - i * 0.15;
            ctx.beginPath();
            ctx.moveTo(ax, ay);
            ctx.lineTo(bx, by);
            ctx.stroke();
        }
        ctx.globalAlpha = 1;
    }

    // room numbers (base36, matches the prose/ascii ids)
    for (const r of model.entities.filter(e => e.kind === 'room')) {
        const lbl = idNum(r.id).toString(36).toUpperCase();
        const [cx, cy] = px(r.x + r.w / 2, r.y + r.h / 2);
        h.label(lbl, cx, cy + s * 0.22, { size: Math.max(11, s * 0.62), italic: false, weight: '600' });
    }

    // content micro-icons under the room number (cosmetic, params.icons)
    if (model.params.icons !== false) {
        for (const r of model.entities.filter(e => e.kind === 'room')) {
            const c = r.content || {};
            const glyphs = [];
            if (c.encounter) glyphs.push('mob');
            if (c.treasure) glyphs.push('loot');
            if (c.trap) glyphs.push('trap');
            if (c.key) glyphs.push('key');
            if (!glyphs.length) continue;
            const [cx, cy] = px(r.x + r.w / 2, r.y + r.h / 2);
            const gy = cy + s * 0.62;
            const step = s * 0.55;
            let gx = cx - step * (glyphs.length - 1) / 2;
            ctx.globalAlpha = 0.85;
            for (const g of glyphs) {
                drawContentIcon(ctx, g, gx, gy, s, h.INK);
                gx += step;
            }
            ctx.globalAlpha = 1;
        }
    }
}

/** Tiny ink glyphs: ▲ monster, ◆ treasure, ^ trap, key. */
function drawContentIcon(ctx, kind, gx, gy, s, ink) {
    const r = s * 0.24;
    ctx.fillStyle = ink;
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.5;
    ctx.lineCap = 'round';
    if (kind === 'mob') {
        ctx.beginPath();
        ctx.moveTo(gx, gy - r);
        ctx.lineTo(gx - r, gy + r * 0.8);
        ctx.lineTo(gx + r, gy + r * 0.8);
        ctx.closePath();
        ctx.fill();
    } else if (kind === 'loot') {
        ctx.beginPath();
        ctx.moveTo(gx, gy - r);
        ctx.lineTo(gx + r * 0.8, gy);
        ctx.lineTo(gx, gy + r);
        ctx.lineTo(gx - r * 0.8, gy);
        ctx.closePath();
        ctx.fill();
    } else if (kind === 'trap') {
        ctx.beginPath();
        ctx.moveTo(gx - r, gy + r * 0.6);
        ctx.lineTo(gx, gy - r * 0.7);
        ctx.lineTo(gx + r, gy + r * 0.6);
        ctx.stroke();
    } else if (kind === 'key') {
        ctx.beginPath();
        ctx.arc(gx - r * 0.45, gy, r * 0.5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(gx, gy);
        ctx.lineTo(gx + r, gy);
        ctx.moveTo(gx + r * 0.6, gy);
        ctx.lineTo(gx + r * 0.6, gy + r * 0.5);
        ctx.stroke();
    }
}

/* ------------------------------------------------------------------
 *  Interior: floor plan with inked walls, door gaps + swing arcs,
 *  window ticks, room labels.
 * ------------------------------------------------------------------ */
export function drawInterior(ctx, model, rng, h, view) {
    const { s, ox, oy } = view;
    const px = (x, y) => [ox + x * s, oy + y * s];
    const rooms = model.entities.filter(e => e.kind === 'room');

    // floors
    for (const r of rooms) {
        ctx.fillStyle = '#f0e7d0';
        ctx.fillRect(ox + r.x * s, oy + r.y * s, r.w * s, r.h * s);
    }
    // faint plank lines in the hub
    const hub = rooms[0];
    if (hub) {
        ctx.strokeStyle = 'rgba(120,95,55,0.12)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let y = hub.y + 1; y < hub.y + hub.h; y++) {
            const [ax, ay] = px(hub.x + 0.2, y);
            const [bx] = px(hub.x + hub.w - 0.2, y);
            ctx.moveTo(ax, ay); ctx.lineTo(bx, ay);
        }
        ctx.stroke();
    }

    // interior walls then the heavy outer outline
    for (const r of rooms) {
        h.inkRect(ox + r.x * s, oy + r.y * s, r.w * s, r.h * s, { width: 1.6, wobble: 0.6, overshoot: 1 });
    }
    const outline = (model.layers.outline || []).map(([x, y]) => px(x, y));
    if (outline.length) h.inkPoly(outline, { width: 3.6, wobble: 0.8 });

    // doors: parchment gap + swing arc
    for (const d of (model.layers.doors || [])) {
        const [dx, dy] = px(d.x, d.y);
        ctx.fillStyle = '#f0e7d0';
        if (d.orient === 'v') {
            ctx.fillRect(dx - 3, dy + s * 0.15, 6, s * 0.7);
            ctx.strokeStyle = h.INK;
            ctx.globalAlpha = 0.55;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(dx, dy + s * 0.15, s * 0.7, 0, Math.PI / 2);
            ctx.stroke();
            ctx.globalAlpha = 1;
        } else {
            ctx.fillRect(dx + s * 0.15, dy - 3, s * 0.7, 6);
            ctx.strokeStyle = h.INK;
            ctx.globalAlpha = 0.55;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(dx + s * 0.15, dy, s * 0.7, 0, Math.PI / 2);
            ctx.stroke();
            ctx.globalAlpha = 1;
        }
    }

    // windows: thin double ticks across exterior walls
    ctx.strokeStyle = h.INK;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    for (const w of model.entities.filter(e => e.kind === 'window')) {
        const [wx, wy] = px(w.x, w.y);
        if (w.tags?.includes('h')) {
            ctx.moveTo(wx + s * 0.2, wy - 2); ctx.lineTo(wx + s * 0.8, wy - 2);
            ctx.moveTo(wx + s * 0.2, wy + 2); ctx.lineTo(wx + s * 0.8, wy + 2);
        } else {
            ctx.moveTo(wx - 2, wy + s * 0.2); ctx.lineTo(wx - 2, wy + s * 0.8);
            ctx.moveTo(wx + 2, wy + s * 0.2); ctx.lineTo(wx + 2, wy + s * 0.8);
        }
    }
    ctx.stroke();
    ctx.globalAlpha = 1;

    // labels: "N. Name"
    for (const r of rooms) {
        const [cx, cy] = px(r.x + r.w / 2, r.y + r.h / 2);
        const n = idNum(r.id);
        if (!h.label(`${n}. ${r.name}`, cx, cy, { size: 12 })) {
            h.label(String(n), cx, cy, { size: 12, italic: false, weight: '600' });
        }
    }
}

/* ------------------------------------------------------------------
 *  Region: biome underlay + inked coastline, rivers, peaks, trees,
 *  settlement glyphs, labels.
 * ------------------------------------------------------------------ */
const BIOME_RGB = {
    ocean: [143, 168, 186], lake: [149, 175, 190], beach: [230, 217, 176],
    grassland: [201, 207, 158], forest: [154, 184, 138], rainforest: [127, 168, 119],
    desert: [221, 200, 148], swamp: [163, 171, 138], mountains: [185, 172, 149], snow: [232, 230, 224],
    // appended biomes: parchment-friendly muted tones
    taiga: [126, 148, 130], tundra: [206, 202, 186], savanna: [199, 194, 130],
    badlands: [193, 141, 106], ashland: [118, 110, 104], blight: [150, 138, 150],
    iceshelf: [222, 229, 235],   // world maps: frozen polar ocean, pale blue-white
};
const BIOME_ORDER = BIOME_CODES;   // single source of truth: region/biomes.js

export function drawRegion(ctx, model, rng, h, view) {
    const { s, ox, oy } = view;
    const px = (x, y) => [ox + x * s, oy + y * s];
    const N = model.layers.N;
    const biome = model.layers.biomes;
    if (!N || !biome) return;
    const isWater = c => c === 0 || c === 1;

    // biome color underlay (crisp cells scaled up, translucent over parchment)
    const tmp = document.createElement('canvas');
    tmp.width = N; tmp.height = N;
    const tctx = tmp.getContext('2d');
    const img = tctx.createImageData(N, N);
    for (let i = 0; i < N * N; i++) {
        const rgb = BIOME_RGB[BIOME_ORDER[biome[i]]] || [200, 200, 200];
        img.data[i * 4] = rgb[0];
        img.data[i * 4 + 1] = rgb[1];
        img.data[i * 4 + 2] = rgb[2];
        img.data[i * 4 + 3] = 255;
    }
    tctx.putImageData(img, 0, 0);
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = 0.5;
    ctx.drawImage(tmp, ox, oy, N * s, N * s);
    ctx.restore();
    ctx.globalAlpha = 1;

    // coastline: cell-edge segments between water and land
    ctx.strokeStyle = h.INK;
    ctx.globalAlpha = 0.8;
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
            const w0 = isWater(biome[y * N + x]);
            if (x + 1 < N && w0 !== isWater(biome[y * N + x + 1])) {
                const [ax, ay] = px(x + 1, y);
                ctx.moveTo(ax + rng.float(-0.5, 0.5), ay);
                ctx.lineTo(ax + rng.float(-0.5, 0.5), ay + s);
            }
            if (y + 1 < N && w0 !== isWater(biome[(y + 1) * N + x])) {
                const [ax, ay] = px(x, y + 1);
                ctx.moveTo(ax, ay + rng.float(-0.5, 0.5));
                ctx.lineTo(ax + s, ay + rng.float(-0.5, 0.5));
            }
        }
    }
    ctx.stroke();
    ctx.globalAlpha = 1;

    // rivers: shared per-point-width run-grouping painter (see drawRivers)
    drawRivers(model.entities.filter(e => e.kind === 'river'), px, s, h);

    // roads (dashed)
    ctx.save();
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = '#7a5f3a';
    ctx.globalAlpha = 0.75;
    ctx.lineWidth = 1.2;
    for (const r of model.entities.filter(e => e.kind === 'road')) {
        ctx.beginPath();
        r.pts.forEach(([x, y], i) => {
            const [qx, qy] = px(x, y);
            if (i) ctx.lineTo(qx, qy); else ctx.moveTo(qx, qy);
        });
        ctx.stroke();
    }
    ctx.restore();
    ctx.globalAlpha = 1;

    // bridges & fords: the road crosses perpendicular to the river flow `angle`
    for (const br of model.entities.filter(e => e.kind === 'bridge')) {
        const [cx, cy] = px(br.x, br.y);
        const a = br.angle || 0;
        const rvx = Math.cos(a), rvy = Math.sin(a);      // along the river
        const rdx = -Math.sin(a), rdy = Math.cos(a);     // along the road (perpendicular)
        const u = s / 3;
        if (br.purpose === 'ford') {
            // a row of small dots across the river (along the road direction)
            const half = 3 * u;
            ctx.fillStyle = '#6f4f2e';
            for (let k = 0; k < 4; k++) {
                const t = -half + (2 * half) * k / 3;
                ctx.beginPath();
                ctx.arc(cx + rdx * t, cy + rdy * t, Math.max(0.9, 0.7 * u), 0, Math.PI * 2);
                ctx.fill();
            }
        } else {
            // deck: a slightly thicker light stroke, then two dark rails either side
            const half = 3 * u;                          // ~5–7 px long at s=3
            const off = 2 * u;
            h.inkLine([[cx - rdx * half, cy - rdy * half], [cx + rdx * half, cy + rdy * half]],
                { width: 1.8 * u, wobble: 0.2, color: '#d8c49a', alpha: 0.9, passes: 1 });
            for (const sgn of [1, -1]) {
                const ox2 = rvx * off * sgn, oy2 = rvy * off * sgn;
                h.inkLine([[cx + ox2 - rdx * half, cy + oy2 - rdy * half],
                           [cx + ox2 + rdx * half, cy + oy2 + rdy * half]],
                    { width: 1.2 * u, wobble: 0.2, color: '#5a3d22', alpha: 0.95, passes: 1 });
            }
        }
    }

    // mountain carets
    ctx.strokeStyle = h.INK;
    ctx.lineWidth = 1.2;
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    for (const [x, y] of (model.layers.peaks || [])) {
        const [cx, cy] = px(x, y);
        const r = rng.float(2.6, 4.4);
        ctx.moveTo(cx - r, cy + r * 0.7);
        ctx.lineTo(cx, cy - r);
        ctx.lineTo(cx + r, cy + r * 0.7);
        ctx.moveTo(cx, cy - r * 0.4);
        ctx.lineTo(cx + r * 0.5, cy + r * 0.35);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;

    // tree bumps
    ctx.strokeStyle = '#5c6b4a';
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.65;
    ctx.beginPath();
    for (const [x, y] of (model.layers.trees || [])) {
        const [cx, cy] = px(x, y);
        const r = rng.float(1.6, 2.6);
        ctx.moveTo(cx + r, cy);
        ctx.arc(cx, cy, r, 0, Math.PI, true);
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx, cy + r);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;

    // dunes: small open arcs (breve marks) in sand
    ctx.strokeStyle = '#b09a6a';
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    for (const [x, y] of (model.layers.dunes || [])) {
        const [cx, cy] = px(x, y);
        const r = rng.float(2.2, 3.6);
        ctx.moveTo(cx - r, cy);
        ctx.arc(cx, cy, r, Math.PI, Math.PI * 2, false);   // upper open arc
    }
    ctx.stroke();
    ctx.globalAlpha = 1;

    // dead trees: bare Y-shape strokes
    ctx.strokeStyle = '#5b4b3a';
    ctx.lineWidth = 1;
    ctx.lineCap = 'round';
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    for (const [x, y] of (model.layers.deadTrees || [])) {
        const [cx, cy] = px(x, y);
        const r = rng.float(2.2, 3.4);
        ctx.moveTo(cx, cy + r);
        ctx.lineTo(cx, cy - r * 0.2);
        ctx.lineTo(cx - r * 0.7, cy - r);        // left branch
        ctx.moveTo(cx, cy - r * 0.2);
        ctx.lineTo(cx + r * 0.7, cy - r);        // right branch
    }
    ctx.stroke();
    ctx.globalAlpha = 1;

    // tussocks: 2–3 tiny horizontal dashes
    ctx.strokeStyle = '#8a9a72';
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    for (const [x, y] of (model.layers.tussocks || [])) {
        const [cx, cy] = px(x, y);
        const rows = rng.chance(0.5) ? 3 : 2;
        for (let i = 0; i < rows; i++) {
            const dy = (i - (rows - 1) / 2) * 1.6;
            const w = rng.float(1.6, 2.6);
            const jx = rng.float(-1, 1);
            ctx.moveTo(cx - w + jx, cy + dy);
            ctx.lineTo(cx + w + jx, cy + dy);
        }
    }
    ctx.stroke();
    ctx.globalAlpha = 1;

    // vents: tiny circle with a wiggly smoke stroke rising
    ctx.strokeStyle = '#4a4642';
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.75;
    for (const [x, y] of (model.layers.vents || [])) {
        const [cx, cy] = px(x, y);
        ctx.beginPath();
        ctx.arc(cx, cy + 1.5, rng.float(1.1, 1.7), 0, Math.PI * 2);
        ctx.stroke();
        const sway = rng.float(0.8, 1.6);
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx - sway, cy - 2.2);
        ctx.lineTo(cx + sway, cy - 4.4);
        ctx.lineTo(cx - sway * 0.6, cy - 6.2);
        ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // settlements
    for (const st of model.entities.filter(e => e.kind === 'settlement')) {
        const [cx, cy] = px(st.x, st.y);
        ctx.fillStyle = h.INK;
        if (st.purpose === 'city') {
            ctx.fillRect(cx - 4, cy - 3, 4, 5);
            ctx.fillRect(cx + 1, cy - 5, 4, 7);
            h.inkLine([[cx + 3, cy - 5], [cx + 3, cy - 10], [cx + 7, cy - 8.5], [cx + 3, cy - 7]], { width: 1, wobble: 0.2 });
        } else if (st.purpose === 'town') {
            ctx.fillRect(cx - 4, cy - 3, 4, 5);
            ctx.fillRect(cx + 1, cy - 4, 4, 6);
        } else {
            ctx.fillRect(cx - 2, cy - 2, 5, 5);
        }
        h.label(st.name, cx, cy + 14, { size: 13, italic: false });
    }

    // POIs
    for (const poi of model.entities.filter(e => e.kind === 'poi')) {
        const [cx, cy] = px(poi.x, poi.y);
        h.inkLine([[cx - 3, cy - 3], [cx + 3, cy + 3]], { width: 1.2, wobble: 0.2 });
        h.inkLine([[cx - 3, cy + 3], [cx + 3, cy - 3]], { width: 1.2, wobble: 0.2 });
        h.label(poi.purpose, cx, cy + 12, { size: 10, color: '#6b5334' });
    }

    // named biome patches
    for (const b of model.entities.filter(e => e.kind === 'biome' && e.name)) {
        const [cx, cy] = px(b.x, b.y);
        h.label(b.name, cx, cy, { size: 13, color: '#5d5133' });
    }

    // named lakes: italic label (water already in the biome grid)
    for (const lk of model.entities.filter(e => e.kind === 'lake' && e.name)) {
        const [cx, cy] = px(lk.x, lk.y);
        h.label(lk.name, cx, cy, { size: 12, italic: true, color: '#5d5133' });
    }
}

/* ------------------------------------------------------------------
 *  Town: water, roads, shadowed buildings, wall with towers/gates,
 *  labels.
 * ------------------------------------------------------------------ */
export function drawTown(ctx, model, rng, h, view) {
    const { s, ox, oy } = view;
    const px = (x, y) => [ox + x * s, oy + y * s];
    const pxPts = pts => pts.map(([x, y]) => px(x, y));
    const ents = model.entities;
    const W = model.size.w, H = model.size.h;

    // coast
    const coast = ents.find(e => e.kind === 'coast');
    if (coast) {
        const shore = [];
        for (let x = 0; x <= W; x += 32) shore.push([x, coast.y + rng.gaussian(0, 5)]);
        const poly = pxPts([...shore, [W, H], [0, H]]);
        ctx.fillStyle = 'rgba(150,176,192,0.7)';
        ctx.beginPath();
        poly.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
        ctx.closePath();
        ctx.fill();
        h.inkLine(pxPts(shore), { width: 1.6, wobble: 1 });
        h.inkLine(pxPts(shore.map(([x, y]) => [x, y + 8])), { width: 1, wobble: 1, alpha: 0.35, passes: 1 });
        h.inkLine(pxPts(shore.map(([x, y]) => [x, y + 18])), { width: 1, wobble: 1, alpha: 0.2, passes: 1 });
    }

    // river band
    const river = ents.find(e => e.kind === 'river');
    if (river) {
        const pts = pxPts(river.pts);
        ctx.strokeStyle = 'rgba(150,176,192,0.75)';
        ctx.lineWidth = 24 * s;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.beginPath();
        pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
        ctx.stroke();
        h.inkLine(offsetPolyline(pts, 12 * s), { width: 1.3, wobble: 1, alpha: 0.8 });
        h.inkLine(offsetPolyline(pts, -12 * s), { width: 1.3, wobble: 1, alpha: 0.8 });
    }

    // plaza
    const plaza = ents.find(e => e.kind === 'plaza');
    if (plaza) {
        const [cx, cy] = px(plaza.x, plaza.y);
        const r = (plaza.w / 2) * s;
        ctx.fillStyle = '#e6d9b8';
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.save();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = h.INK;
        ctx.globalAlpha = 0.4;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        ctx.globalAlpha = 1;
    }

    // roads under everything else
    const roads = ents.filter(e => e.kind === 'road');
    for (const r of roads) {
        const pts = pxPts(r.pts);
        ctx.strokeStyle = '#dcd0ab';
        ctx.lineWidth = (r.purpose === 'main' ? 7 : 4) * s;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.beginPath();
        pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
        ctx.stroke();
    }
    ctx.save();
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = h.INK;
    ctx.globalAlpha = 0.22;
    ctx.lineWidth = 1;
    for (const r of roads) {
        const pts = pxPts(r.pts);
        ctx.beginPath();
        pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
        ctx.stroke();
    }
    ctx.restore();
    ctx.globalAlpha = 1;

    // buildings: shadow → body → ink outline (landmarks darker + ridge)
    const drawBuilding = (b, landmark) => {
        const poly = pxPts(b.poly);
        ctx.fillStyle = 'rgba(60,40,20,0.22)';
        ctx.beginPath();
        poly.forEach(([x, y], i) => i ? ctx.lineTo(x + 2.5, y + 2.5) : ctx.moveTo(x + 2.5, y + 2.5));
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = landmark ? '#e9dab4' : '#efe6cf';
        ctx.beginPath();
        poly.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
        ctx.closePath();
        ctx.fill();
        h.inkPoly(poly, { width: landmark ? 1.7 : 1.1, wobble: 0.6 });
        if (poly.length === 4) {
            const len = (a, b) => Math.hypot(poly[a][0] - poly[b][0], poly[a][1] - poly[b][1]);
            const mid = (a, b) => [(poly[a][0] + poly[b][0]) / 2, (poly[a][1] + poly[b][1]) / 2];
            const ridge = len(0, 1) >= len(1, 2) ? [mid(0, 3), mid(1, 2)] : [mid(0, 1), mid(3, 2)];
            h.inkLine(ridge, { width: 0.9, wobble: 0.4, alpha: 0.5, passes: 1 });
        }
    };
    for (const b of ents.filter(e => e.kind === 'building')) drawBuilding(b, false);
    for (const b of ents.filter(e => e.kind === 'landmark')) drawBuilding(b, true);

    // wall with towers and gates
    const wall = ents.find(e => e.kind === 'wall');
    if (wall) {
        h.inkPoly(pxPts(wall.pts), { width: 3.6, wobble: 1.4 });
        for (const [x, y] of wall.pts) {
            const [cx, cy] = px(x, y);
            ctx.fillStyle = h.PARCHMENT;
            ctx.beginPath();
            ctx.arc(cx, cy, 4.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = h.INK;
            ctx.lineWidth = 1.4;
            ctx.stroke();
        }
        for (const g of ents.filter(e => e.kind === 'gate')) {
            const [cx, cy] = px(g.x, g.y);
            ctx.fillStyle = h.PARCHMENT;
            ctx.fillRect(cx - 5, cy - 5, 10, 10);
            h.inkRect(cx - 5, cy - 5, 10, 10, { width: 1.3, wobble: 0.4, overshoot: 1 });
        }
    }

    // labels
    for (const l of ents.filter(e => e.kind === 'landmark')) {
        const [cx, cy] = px(l.x, l.y);
        h.label(l.name || capitalize(l.purpose), cx, cy - 8 * s, { size: 11 });
    }
    for (const d of ents.filter(e => e.kind === 'district')) {
        const [cx, cy] = px(d.x, d.y);
        h.label(d.name, cx, cy, { size: 15, color: 'rgba(93,81,51,0.85)' });
    }
}

function offsetPolyline(pts, d) {
    return pts.map(([x, y], i) => {
        const [ax, ay] = pts[Math.max(0, i - 1)];
        const [bx, by] = pts[Math.min(pts.length - 1, i + 1)];
        const dx = bx - ax, dy = by - ay;
        const l = Math.hypot(dx, dy) || 1;
        return [x - dy / l * d, y + dx / l * d];
    });
}

function capitalize(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }

/* ------------------------------------------------------------------
 *  Shared river painter (region + world). Per-point width grows
 *  downstream: split each polyline into runs of similar (quantized)
 *  width and ink each run with the double stroke, widths scaled to s.
 *  Runs share their boundary point so there are no gaps. RNG-free.
 * ------------------------------------------------------------------ */
function drawRivers(rivers, px, s, h) {
    const riverW = p => (p.length > 2 && p[2] != null) ? p[2] : 1.5;   // 2-tuple → default
    const qStep = 0.75;
    for (const r of rivers) {
        const pts = r.pts || [];
        const n = pts.length;
        if (n >= 2) {
            const ws = pts.map(riverW);
            const qs = ws.map(w => Math.round(w / qStep));
            const emit = (a, b) => {
                // average width over this run's own points (a..b-1, excluding the
                // shared boundary at b), fall back to the single point when a===b
                let sum = 0, cnt = 0;
                for (let i = a; i < b; i++) { sum += ws[i]; cnt++; }
                const w = cnt ? sum / cnt : ws[a];
                const outer = (0.9 + 0.55 * w) * (s / 3);
                const seg = pts.slice(a, b + 1).map(([x, y]) => px(x, y));
                h.inkLine(seg, { width: outer, wobble: 0.8, color: '#5b7f96', alpha: 0.85 });
                h.inkLine(seg, { width: outer * 0.4, wobble: 0.6, color: '#8fb0c4', alpha: 0.8, passes: 1 });
            };
            let a = 0;
            for (let i = 1; i < n; i++) {
                if (qs[i] !== qs[a]) { emit(a, i); a = i; }   // shares point i with next run
            }
            emit(a, n - 1);
        }

        // delta hint: short diverging strokes fanning from the mouth
        if (r.tags && r.tags.includes('delta') && n >= 2) {
            const [lx, ly] = pts[n - 1];
            const [px2, py2] = pts[n - 2];
            const dx = lx - px2, dy = ly - py2;
            const len = Math.hypot(dx, dy) || 1;
            const ux = dx / len, uy = dy / len;
            const ang0 = Math.atan2(uy, ux);
            const reach = 5 * (s / 3);
            const [mx, my] = px(lx, ly);
            for (const da of [-0.5, 0, 0.5]) {
                const a2 = ang0 + da;
                h.inkLine([[mx, my], [mx + Math.cos(a2) * reach, my + Math.sin(a2) * reach]],
                    { width: 1.1 * (s / 3), wobble: 0.5, color: '#5b7f96', alpha: 0.75, passes: 1 });
            }
        }
    }
}

/* ------------------------------------------------------------------
 *  World: planetary parchment chart. Biome underlay + nation tint +
 *  dashed borders + coastline, rivers, sea/land trade routes, glyph
 *  scatters, capitals/cities/wonders/ruins, nation/sea/continent
 *  labels, and a decorative frame + compass rose + sea serpents.
 *
 *  Everything deterministic (jitter from the style `rng`) and tolerant
 *  of missing layers/entities — an empty world must not throw.
 * ------------------------------------------------------------------ */
export function drawWorld(ctx, model, rng, h, view) {
    const { s, ox, oy } = view;
    const px = (x, y) => [ox + x * s, oy + y * s];
    const layers = model.layers || {};
    const ents = model.entities || [];
    const N = layers.N;
    const biome = layers.biomes;
    const isWater = c => c === 0 || c === 1 || c === 16;   // ocean, lake, iceshelf (frozen ocean)

    if (N && biome) {
        // ---- 1. biome color underlay (crisp cells scaled up, translucent) ----
        const tmp = document.createElement('canvas');
        tmp.width = N; tmp.height = N;
        const tctx = tmp.getContext('2d');
        const img = tctx.createImageData(N, N);
        for (let i = 0; i < N * N; i++) {
            const rgb = BIOME_RGB[BIOME_ORDER[biome[i]]] || [200, 200, 200];
            img.data[i * 4] = rgb[0];
            img.data[i * 4 + 1] = rgb[1];
            img.data[i * 4 + 2] = rgb[2];
            img.data[i * 4 + 3] = 255;
        }
        tctx.putImageData(img, 0, 0);
        ctx.save();
        ctx.imageSmoothingEnabled = false;
        ctx.globalAlpha = 0.5;
        ctx.drawImage(tmp, ox, oy, N * s, N * s);
        ctx.restore();
        ctx.globalAlpha = 1;

        // ---- 2. nation tint (owner value indexes nationColors directly) ----
        const owner = layers.owner;
        const nationColors = layers.nationColors || [];
        if (owner) {
            const timg = tctx.createImageData(N, N);
            for (let i = 0; i < N * N; i++) {
                const o = owner[i];
                const c = o >= 0 ? nationColors[o] : null;
                if (c) {
                    timg.data[i * 4] = c[0];
                    timg.data[i * 4 + 1] = c[1];
                    timg.data[i * 4 + 2] = c[2];
                    timg.data[i * 4 + 3] = 255;
                } else {
                    timg.data[i * 4 + 3] = 0;   // transparent where owner < 0 / unknown
                }
            }
            tctx.putImageData(timg, 0, 0);
            ctx.save();
            ctx.imageSmoothingEnabled = false;
            ctx.globalAlpha = 0.16;
            ctx.drawImage(tmp, ox, oy, N * s, N * s);
            ctx.restore();
            ctx.globalAlpha = 1;

            // ---- 3. borders: dashed cell-edge strokes between differing owners,
            //         only where BOTH cells are land ----
            ctx.save();
            ctx.setLineDash([3, 3]);
            ctx.strokeStyle = h.INK;
            ctx.globalAlpha = 0.55;
            ctx.lineWidth = 1;
            ctx.beginPath();
            for (let y = 0; y < N; y++) {
                for (let x = 0; x < N; x++) {
                    const i = y * N + x;
                    if (isWater(biome[i])) continue;
                    const o0 = owner[i];
                    if (x + 1 < N) {
                        const j = i + 1;
                        if (!isWater(biome[j]) && o0 !== owner[j]) {
                            const [ax, ay] = px(x + 1, y);
                            const jx = rng.float(-0.4, 0.4);
                            ctx.moveTo(ax + jx, ay);
                            ctx.lineTo(ax + jx, ay + s);
                        }
                    }
                    if (y + 1 < N) {
                        const j = i + N;
                        if (!isWater(biome[j]) && o0 !== owner[j]) {
                            const [ax, ay] = px(x, y + 1);
                            const jy = rng.float(-0.4, 0.4);
                            ctx.moveTo(ax, ay + jy);
                            ctx.lineTo(ax + s, ay + jy);
                        }
                    }
                }
            }
            ctx.stroke();
            ctx.restore();
            ctx.globalAlpha = 1;
        }

        // ---- 4. coastline: cell edges between water and land ----
        ctx.strokeStyle = h.INK;
        ctx.globalAlpha = 0.8;
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        for (let y = 0; y < N; y++) {
            for (let x = 0; x < N; x++) {
                const w0 = isWater(biome[y * N + x]);
                if (x + 1 < N && w0 !== isWater(biome[y * N + x + 1])) {
                    const [ax, ay] = px(x + 1, y);
                    ctx.moveTo(ax + rng.float(-0.5, 0.5), ay);
                    ctx.lineTo(ax + rng.float(-0.5, 0.5), ay + s);
                }
                if (y + 1 < N && w0 !== isWater(biome[(y + 1) * N + x])) {
                    const [ax, ay] = px(x, y + 1);
                    ctx.moveTo(ax, ay + rng.float(-0.5, 0.5));
                    ctx.lineTo(ax + s, ay + rng.float(-0.5, 0.5));
                }
            }
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
    }

    // ---- 5. rivers (shared painter) ----
    drawRivers(ents.filter(e => e.kind === 'river'), px, s, h);

    // ---- 6. trade routes ----
    for (const rt of ents.filter(e => e.kind === 'route')) {
        const raw = rt.pts || [];
        if (raw.length < 2) continue;
        const pts = raw.map(([x, y]) => px(x, y));
        const sea = rt.purpose === 'sea';
        ctx.save();
        ctx.setLineDash(sea ? [2, 6] : [6, 5]);
        ctx.strokeStyle = sea ? '#4a6b82' : '#8a5a30';
        ctx.globalAlpha = sea ? 0.6 : 0.8;
        ctx.lineWidth = sea ? 1.2 : 1.3;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
        ctx.stroke();
        ctx.restore();
        ctx.globalAlpha = 1;

        // tiny ship glyph at the midpoint of long sea lanes (> ~30 cells)
        if (sea) {
            let cells = 0;
            for (let i = 1; i < raw.length; i++) {
                cells += Math.hypot(raw[i][0] - raw[i - 1][0], raw[i][1] - raw[i - 1][1]);
            }
            if (cells > 30) {
                const [mx, my] = pts[Math.floor(pts.length / 2)];
                drawShip(ctx, mx, my, h);
            }
        }
    }

    // ---- 7. glyph scatters (world scale: smaller than region) ----
    ctx.strokeStyle = h.INK;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.75;
    ctx.beginPath();
    for (const [x, y] of (layers.peaks || [])) {
        const [cx, cy] = px(x, y);
        const r = rng.float(2.0, 3.2);
        ctx.moveTo(cx - r, cy + r * 0.7);
        ctx.lineTo(cx, cy - r);
        ctx.lineTo(cx + r, cy + r * 0.7);
        ctx.moveTo(cx, cy - r * 0.4);
        ctx.lineTo(cx + r * 0.5, cy + r * 0.35);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;

    ctx.strokeStyle = '#5c6b4a';
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    for (const [x, y] of (layers.trees || [])) {
        const [cx, cy] = px(x, y);
        const r = rng.float(1.3, 2.1);
        ctx.moveTo(cx + r, cy);
        ctx.arc(cx, cy, r, 0, Math.PI, true);
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx, cy + r);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;

    // ---- 8. settlement marks (capitals + cities), drawn before labels ----
    for (const cap of ents.filter(e => e.kind === 'capital')) {
        const [cx, cy] = px(cap.x, cap.y);
        const R = 5 * (s / 3);
        ctx.strokeStyle = h.INK;
        ctx.globalAlpha = 0.9;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(cx, cy, R + 2, 0, Math.PI * 2);   // enclosing circle
        ctx.stroke();
        ctx.fillStyle = h.INK;
        star5(ctx, cx, cy, R, R * 0.42);           // 5-point ink star
        ctx.fill();
        ctx.globalAlpha = 1;
    }
    for (const city of ents.filter(e => e.kind === 'city')) {
        const [cx, cy] = px(city.x, city.y);
        ctx.fillStyle = h.INK;
        ctx.fillRect(cx - 2, cy - 2, 4, 4);        // filled square
        if (city.tags && city.tags.includes('port')) drawAnchor(ctx, cx + 6, cy, h);
    }

    // ---- 9. wonders: 4-ray asterisk glyph ----
    for (const wd of ents.filter(e => e.kind === 'wonder')) {
        const [cx, cy] = px(wd.x, wd.y);
        ctx.strokeStyle = '#6b5334';
        ctx.globalAlpha = 0.9;
        ctx.lineWidth = 1.2;
        ctx.lineCap = 'round';
        ctx.beginPath();
        const r = 4;
        for (let k = 0; k < 4; k++) {
            const a = k * Math.PI / 4;
            ctx.moveTo(cx - Math.cos(a) * r, cy - Math.sin(a) * r);
            ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
    }

    // ---- 10. ruins: three-dot (∴) glyph ----
    for (const ru of ents.filter(e => e.kind === 'ruin')) {
        const [cx, cy] = px(ru.x, ru.y);
        ctx.fillStyle = '#6b5334';
        ctx.globalAlpha = 0.85;
        for (const [dx, dy] of [[0, -2], [-2, 1.5], [2, 1.5]]) {
            ctx.beginPath();
            ctx.arc(cx + dx, cy + dy, 0.9, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
    }

    // ---- 11. nation names FIRST (large faded italic) so the big names land,
    //         then settlement labels dodge around them ----
    for (const nt of ents.filter(e => e.kind === 'nation')) {
        if (!nt.name) continue;
        const [cx, cy] = px(nt.x, nt.y);
        h.label(nt.name, cx, cy, { size: 20, italic: true, color: 'rgba(74,56,35,0.55)' });
    }

    // ---- 8b. settlement labels ----
    for (const cap of ents.filter(e => e.kind === 'capital')) {
        if (!cap.name) continue;
        const [cx, cy] = px(cap.x, cap.y);
        h.label(cap.name, cx, cy + 14, { size: 13, italic: false, weight: '600' });
    }
    for (const city of ents.filter(e => e.kind === 'city')) {
        if (!city.name) continue;
        const [cx, cy] = px(city.x, city.y);
        h.label(city.name, cx, cy + 11, { size: 11, italic: false });
    }

    // ---- 9b/10b. wonder + ruin labels (italic) ----
    for (const wd of ents.filter(e => e.kind === 'wonder')) {
        if (!wd.name) continue;
        const [cx, cy] = px(wd.x, wd.y);
        h.label(wd.name, cx, cy + 12, { size: 11, italic: true, color: '#6b5334' });
    }
    for (const ru of ents.filter(e => e.kind === 'ruin')) {
        if (!ru.name) continue;
        const [cx, cy] = px(ru.x, ru.y);
        h.label(ru.name, cx, cy + 11, { size: 10, italic: true, color: '#6b5334' });
    }

    // ---- 12. sea + continent names ----
    for (const sea of ents.filter(e => e.kind === 'sea')) {
        if (!sea.name) continue;
        const [cx, cy] = px(sea.x, sea.y);
        h.label(sea.name, cx, cy, { size: 14, italic: true, color: 'rgba(74,90,105,0.75)' });
    }
    for (const co of ents.filter(e => e.kind === 'continent')) {
        if (!co.name) continue;
        const [cx, cy] = px(co.x, co.y);
        const text = co.name.toUpperCase().split('').join(' ');   // spaced caps
        h.label(text, cx, cy, { size: 16, italic: false, color: 'rgba(74,56,35,0.5)' });
    }

    // ---- 13. decor: double frame, compass rose, sea serpents ----
    const cw = ctx.canvas.width, ch = ctx.canvas.height;
    h.inkRect(6, 6, cw - 12, ch - 12, { width: 1.5, wobble: 0.5 });
    h.inkRect(12, 12, cw - 24, ch - 24, { width: 0.8, wobble: 0.4 });

    const decor = layers.decor || {};
    if (decor.compass) {
        const [cx, cy] = px(decor.compass[0], decor.compass[1]);
        drawCompass(ctx, cx, cy, h, rng);
    }
    for (const sp of (decor.serpents || [])) {
        const [cx, cy] = px(sp[0], sp[1]);
        drawSerpent(ctx, cx, cy, h, rng);
    }
}

/** Trace a 5-point star path (not stroked/filled here — caller decides). */
function star5(ctx, cx, cy, rOuter, rInner) {
    ctx.beginPath();
    for (let k = 0; k < 10; k++) {
        const rr = k % 2 === 0 ? rOuter : rInner;
        const a = -Math.PI / 2 + k * Math.PI / 5;
        const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
        if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.closePath();
}

/** Tiny ship: hull arc + a triangular sail on a short mast. */
function drawShip(ctx, cx, cy, h) {
    ctx.save();
    ctx.strokeStyle = '#3a4b58';
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = 1.1;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.arc(cx, cy - 1, 4, Math.PI * 0.15, Math.PI * 0.85, false);   // hull
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx, cy - 1);
    ctx.lineTo(cx, cy - 7);            // mast
    ctx.lineTo(cx + 4, cy - 2.5);      // sail leech
    ctx.lineTo(cx, cy - 2.5);          // sail foot
    ctx.stroke();
    ctx.restore();
    ctx.globalAlpha = 1;
}

/** Tiny anchor next to port cities: shank, ring, stock, curved flukes. */
function drawAnchor(ctx, cx, cy, h) {
    ctx.save();
    ctx.strokeStyle = h.INK;
    ctx.globalAlpha = 0.8;
    ctx.lineWidth = 1;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx, cy - 3.5);
    ctx.lineTo(cx, cy + 4);            // shank
    ctx.moveTo(cx - 2, cy - 1.5);
    ctx.lineTo(cx + 2, cy - 1.5);      // stock (crossbar)
    ctx.moveTo(cx - 3, cy + 1.5);
    ctx.quadraticCurveTo(cx, cy + 6, cx + 3, cy + 1.5);   // flukes
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy - 4.2, 1.1, 0, Math.PI * 2);            // ring
    ctx.stroke();
    ctx.restore();
    ctx.globalAlpha = 1;
}

/** Compass rose: two rings, 8 rays (long cardinals + short diagonals), N tick. */
function drawCompass(ctx, cx, cy, h, rng) {
    const R = 26;
    ctx.save();
    ctx.strokeStyle = h.INK;
    ctx.globalAlpha = 0.8;
    ctx.lineWidth = 1.2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.35, 0, Math.PI * 2);
    ctx.stroke();
    for (let k = 0; k < 8; k++) {
        const a = -Math.PI / 2 + k * Math.PI / 4;
        const len = (k % 2 === 0 ? R : R * 0.6) + rng.float(-0.6, 0.6);
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len);
        ctx.stroke();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
    h.label('N', cx, cy - R - 4, { size: 11, italic: false, weight: '600', color: h.INK });
}

/** Sea serpent: 3-hump wavy body + head dot + forked tail, jittered orientation. */
function drawSerpent(ctx, cx, cy, h, rng) {
    const len = 30, humps = 3, steps = 18;
    const dir = rng.float(0, Math.PI * 2);
    const ux = Math.cos(dir), uy = Math.sin(dir);
    const nx = -uy, ny = ux;
    const pts = [];
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const along = t * len;
        const wave = Math.sin(t * Math.PI * humps) * 4;
        pts.push([cx + ux * along + nx * wave, cy + uy * along + ny * wave]);
    }
    h.inkLine(pts, { width: 1.4, wobble: 0.5, color: h.INK, alpha: 0.7 });
    ctx.save();
    ctx.globalAlpha = 0.7;
    ctx.strokeStyle = h.INK;
    ctx.fillStyle = h.INK;
    ctx.lineWidth = 1;
    ctx.lineCap = 'round';
    const [hx, hy] = pts[0];
    ctx.beginPath();
    ctx.arc(hx, hy, 2, 0, Math.PI * 2);   // head
    ctx.fill();
    const [tx, ty] = pts[pts.length - 1];
    const fork = 4;
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(tx + ux * fork + nx * fork * 0.8, ty + uy * fork + ny * fork * 0.8);
    ctx.moveTo(tx, ty);
    ctx.lineTo(tx + ux * fork - nx * fork * 0.8, ty + uy * fork - ny * fork * 0.8);
    ctx.stroke();                          // forked tail
    ctx.restore();
    ctx.globalAlpha = 1;
}
