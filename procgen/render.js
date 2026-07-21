/* ------------------------------------------------------------------
 *  Canvas renderer — hand-drawn / parchment style shared by all four
 *  map types. Browser-only (uses document); generation modules stay
 *  DOM-free so they can be tested under node.
 *
 *  renderMap(model) → HTMLCanvasElement, rendered ONCE per generate.
 *  All jitter comes from the dedicated `seed + '/ink'` stream, so the
 *  drawing is stable across re-renders of the same map.
 * ------------------------------------------------------------------ */
import { Rng } from './rng.js';
import { drawDungeon, drawRegion, drawTown, drawInterior, drawWorld } from './render-styles.js';

export const INK = '#3a2c1a';
export const PARCHMENT = '#f3e9d2';

function canvasDims(model) {
    const { w, h } = model.size;
    switch (model.type) {
        case 'dungeon': {
            const ts = 16, m = 40;
            return { w: w * ts + m * 2, h: h * ts + m * 2 + 24, view: { s: ts, ox: m, oy: m + 24 } };
        }
        case 'interior': {
            // multi-floor plans render side by side; legacy single-floor
            // models synthesize one Ground floor and keep the old layout.
            const floors = (model.layers?.floors?.length)
                ? [...model.layers.floors].sort((a, b) => a.level - b.level)
                : [{ level: 0, w, h }];
            const m = 48, gap = 24;
            const totalUnits = floors.reduce((a, f) => a + (f.w || w), 0);
            let ts = 34;
            let width = m * 2 + totalUnits * ts + gap * (floors.length - 1);
            if (width > 1400) { ts = 26; width = m * 2 + totalUnits * ts + gap * (floors.length - 1); }
            const maxH = Math.max(...floors.map(f => f.h || h));
            const oyTop = m + 24;
            const floorOrigins = [];
            let cursor = m;
            for (const f of floors) {
                floorOrigins.push({ level: f.level, ox: cursor, oy: oyTop });
                cursor += (f.w || w) * ts + gap;
            }
            return {
                w: width, h: maxH * ts + m * 2 + 24,
                view: { s: ts, ox: m, oy: oyTop, floorOrigins },
            };
        }
        case 'region': {
            // scale adapts to map size N so canvases stay ~700–900 px
            const s = Math.max(2, Math.round(768 / w)), m = 36;
            return { w: w * s + m * 2, h: h * s + m * 2, view: { s, ox: m, oy: m } };
        }
        case 'world': {
            // world charts run larger N; scale keeps the canvas ~700–900 px.
            // wider margin (44) leaves room for the decorative double frame.
            const s = Math.max(2, Math.round(900 / w)), m = 44;
            return { w: w * s + m * 2, h: h * s + m * 2, view: { s, ox: m, oy: m } };
        }
        case 'town': {
            // adaptive scale keeps the canvas ~1000 px across village→city
            // extents (460 → ~2.1, 640 → 1.5, 840 → ~1.2).
            const s = Math.max(1.1, Math.round((980 / w) * 10) / 10), m = 28;
            return { w: Math.round(w * s) + m * 2, h: Math.round(h * s) + m * 2, view: { s, ox: m, oy: m } };
        }
        default:
            return { w: 800, h: 600, view: { s: 1, ox: 0, oy: 0 } };
    }
}

export function renderMap(model) {
    const dims = canvasDims(model);
    const canvas = document.createElement('canvas');
    canvas.width = dims.w;
    canvas.height = dims.h;
    const ctx = canvas.getContext('2d');

    const ink = new Rng(model.seed + '/ink');
    parchment(ctx, dims.w, dims.h, ink.sub('parchment'));

    const h = makeHelpers(ctx, ink.sub('lines'));
    const style = ink.sub('style');
    try {
        switch (model.type) {
            case 'dungeon': drawDungeon(ctx, model, style, h, dims.view); break;
            case 'interior': drawInterior(ctx, model, style, h, dims.view); break;
            case 'region': drawRegion(ctx, model, style, h, dims.view); break;
            case 'world': drawWorld(ctx, model, style, h, dims.view); break;
            case 'town': drawTown(ctx, model, style, h, dims.view); break;
        }
    } catch (e) {
        console.error('[MapGenerators] renderMap failed', e);
    }
    drawTitle(ctx, model.name, dims.w);
    return canvas;
}

/* ------------------------------------------------------------------
 *  Parchment background
 * ------------------------------------------------------------------ */
function parchment(ctx, w, h, rng) {
    ctx.fillStyle = PARCHMENT;
    ctx.fillRect(0, 0, w, h);

    // vignette
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.75);
    g.addColorStop(0, 'rgba(239,227,200,0)');
    g.addColorStop(1, 'rgba(196,172,124,0.35)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // a few soft stains
    for (let i = 0; i < 3; i++) {
        const sx = rng.float(0, w), sy = rng.float(0, h), r = rng.float(40, 140);
        const sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
        sg.addColorStop(0, 'rgba(150,110,60,0.05)');
        sg.addColorStop(1, 'rgba(150,110,60,0)');
        ctx.fillStyle = sg;
        ctx.fillRect(sx - r, sy - r, 2 * r, 2 * r);
    }

    // ink speckle
    const n = Math.round(w * h / 600);
    for (let i = 0; i < n; i++) {
        ctx.fillStyle = `rgba(120,90,40,${rng.float(0.04, 0.12).toFixed(3)})`;
        ctx.fillRect(rng.float(0, w), rng.float(0, h), rng.float(0.6, 1.8), rng.float(0.6, 1.8));
    }
}

function drawTitle(ctx, name, w) {
    if (!name) return;
    ctx.font = '600 20px Georgia, "Times New Roman", serif';
    ctx.textBaseline = 'alphabetic';
    const text = name.toUpperCase();
    ctx.strokeStyle = 'rgba(243,233,210,0.9)';
    ctx.lineWidth = 4;
    ctx.strokeText(text, 20, 30, w - 40);
    ctx.fillStyle = '#4a3823';
    ctx.fillText(text, 20, 30, w - 40);
}

/* ------------------------------------------------------------------
 *  Ink primitives — passed to the per-type painters as `h`
 * ------------------------------------------------------------------ */
function resample(pts, step) {
    if (pts.length < 2) return pts;
    const out = [pts[0]];
    let [px, py] = pts[0];
    for (let i = 1; i < pts.length; i++) {
        const [qx, qy] = pts[i];
        const d = Math.hypot(qx - px, qy - py);
        const n = Math.max(1, Math.floor(d / step));
        for (let k = 1; k <= n; k++) {
            out.push([px + (qx - px) * k / n, py + (qy - py) * k / n]);
        }
        px = qx; py = qy;
    }
    return out;
}

function makeHelpers(ctx, rng) {
    const labelBoxes = [];

    /** Hand-drawn stroke: resampled polyline with per-vertex perpendicular
     *  jitter, double pass (the 2nd thin/faint pass reads as real ink). */
    function inkLine(pts, { wobble = 1.2, width = 1.4, color = INK, alpha = 1, passes = 2 } = {}) {
        if (!pts || pts.length < 2) return;
        const rs = resample(pts, 6);
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        for (let pass = 0; pass < passes; pass++) {
            ctx.beginPath();
            for (let i = 0; i < rs.length; i++) {
                let [x, y] = rs[i];
                if (i > 0 && i < rs.length - 1) {   // exact endpoints → segments join cleanly
                    const [ax, ay] = rs[i - 1], [bx, by] = rs[i + 1];
                    const dx = bx - ax, dy = by - ay;
                    const len = Math.hypot(dx, dy) || 1;
                    const off = rng.gaussian(0, wobble);
                    x += (-dy / len) * off;
                    y += (dx / len) * off;
                }
                if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
            }
            ctx.strokeStyle = color;
            ctx.globalAlpha = alpha * (pass ? 0.45 : 1);
            ctx.lineWidth = width * (pass ? 0.6 : 1);
            ctx.stroke();
        }
        ctx.globalAlpha = 1;
    }

    function inkPoly(pts, opts = {}) {
        if (!pts || pts.length < 3) return;
        inkLine([...pts, pts[0]], opts);
    }

    /** Sketched rectangle: four strokes with slight corner overshoot. */
    function inkRect(x, y, w, h, opts = {}) {
        const o = opts.overshoot ?? 2;
        inkLine([[x - o, y], [x + w + o, y]], opts);
        inkLine([[x - o, y + h], [x + w + o, y + h]], opts);
        inkLine([[x, y - o], [x, y + h + o]], opts);
        inkLine([[x + w, y - o], [x + w, y + h + o]], opts);
    }

    /** 45° hatching clipped to a polygon (water, forest fills). */
    function hatchPoly(pts, { spacing = 7, color = INK, alpha = 0.3, width = 1, angle = Math.PI / 4 } = {}) {
        if (!pts || pts.length < 3) return;
        ctx.save();
        ctx.beginPath();
        pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
        ctx.closePath();
        ctx.clip();
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const [x, y] of pts) {
            minX = Math.min(minX, x); maxX = Math.max(maxX, x);
            minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        }
        ctx.strokeStyle = color;
        ctx.globalAlpha = alpha;
        ctx.lineWidth = width;
        const diag = Math.hypot(maxX - minX, maxY - minY);
        const dx = Math.cos(angle), dy = Math.sin(angle);
        const nx = -dy, ny = dx;
        const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
        ctx.beginPath();
        for (let d = -diag / 2; d <= diag / 2; d += spacing) {
            ctx.moveTo(cx + nx * d - dx * diag, cy + ny * d - dy * diag);
            ctx.lineTo(cx + nx * d + dx * diag, cy + ny * d + dy * diag);
        }
        ctx.stroke();
        ctx.restore();
        ctx.globalAlpha = 1;
    }

    /** Serif label with parchment halo and simple overlap avoidance. */
    function label(text, x, y, { size = 14, italic = true, color = '#4a3823', halo = true, weight = '' } = {}) {
        ctx.font = `${italic ? 'italic ' : ''}${weight ? weight + ' ' : ''}${size}px Georgia, "Times New Roman", serif`;
        ctx.textBaseline = 'alphabetic';
        const w = ctx.measureText(text).width;
        const cands = [
            [x - w / 2, y],
            [x - w / 2, y + size + 4],
            [x - w / 2, y - size - 2],
            [x + 8, y + size / 2 - 2],
            [x - w - 8, y + size / 2 - 2],
        ];
        for (const [lx, ly] of cands) {
            const box = { x: lx - 2, y: ly - size, w: w + 4, h: size + 5 };
            if (labelBoxes.some(b => b.x < box.x + box.w && box.x < b.x + b.w && b.y < box.y + box.h && box.y < b.y + b.h)) continue;
            labelBoxes.push(box);
            if (halo) {
                ctx.strokeStyle = 'rgba(243,233,210,0.85)';
                ctx.lineWidth = 3;
                ctx.strokeText(text, lx, ly);
            }
            ctx.fillStyle = color;
            ctx.fillText(text, lx, ly);
            return true;
        }
        return false;
    }

    return { inkLine, inkPoly, inkRect, hatchPoly, label, INK, PARCHMENT };
}
