/* ------------------------------------------------------------------
 *  Town stage 5: wall + gates.
 *
 *  Radius = 90th-percentile building distance (ignoring farms / mines /
 *  slums that sprawl outside) + 24, capped. Gates sit on the EXACT
 *  main-road × wall crossings. Ruined towns get 1–2 breaches: index
 *  ranges into the wall polyline that never overlap a gate segment.
 *  LAYOUT stream: nPts, per-point radius, breach picks.
 * ------------------------------------------------------------------ */
import { compass } from '../schema.js';
import { polylineIntersect, nearestSegIndex } from './geom.js';

export function buildWalls(ctx) {
    const { p, rng, extent, plaza, mains, buildings } = ctx;
    const size = p.size || 'town';

    let wall = null;
    const gates = [];
    if (p.walls && buildings.length) {
        const type = (size === 'village' || p.wealth === 'poor') ? 'palisade' : 'stone';

        const dists = buildings
            .filter(b => !b.outsideWall)
            .map(b => Math.hypot(b.cx - plaza.x, b.cy - plaza.y))
            .sort((a, b) => a - b);
        const base = dists.length ? dists[Math.floor(dists.length * 0.9)] : extent * 0.25;
        const radius = Math.min(extent * 0.44, base + 24);

        const nPts = rng.int(14, 18);
        const pts = [];
        for (let i = 0; i < nPts; i++) {
            const a = (Math.PI * 2 * i) / nPts;
            const r = radius * rng.float(0.93, 1.07);
            pts.push([plaza.x + Math.cos(a) * r, plaza.y + Math.sin(a) * r]);
        }
        const ring = [...pts, pts[0]];   // closed for intersection tests

        // gates: exact main × wall crossings (deduped)
        const gateDirs = [];
        const gateSegs = new Set();
        for (const m of mains) {
            const hit = polylineIntersect(m.pts, ring);
            if (!hit) continue;
            if (gates.some(g => Math.hypot(g.x - hit.x, g.y - hit.y) < 24)) continue;
            const dir = compass(plaza.x, plaza.y, hit.x, hit.y);
            gates.push({ x: hit.x, y: hit.y, dir });
            gateDirs.push(dir);
            gateSegs.add((nearestSegIndex(hit.x, hit.y, ring) - 1 + nPts) % nPts);
        }

        // breaches (ruined only): 1–2 index ranges, avoiding gate segments
        const breaches = [];
        if (p.condition === 'ruined') {
            const nB = rng.int(1, 2);
            const taken = new Set(gateSegs);
            for (let b = 0; b < nB; b++) {
                const len = rng.int(1, 2);
                let start = -1;
                for (let tryN = 0; tryN < 12; tryN++) {
                    const s = rng.int(0, nPts - 1);
                    let ok = true;
                    for (let k = 0; k <= len; k++) if (taken.has((s + k) % nPts)) { ok = false; break; }
                    if (ok) { start = s; break; }
                }
                if (start < 0) continue;
                for (let k = 0; k <= len; k++) taken.add((start + k) % nPts);
                breaches.push([start, (start + len) % nPts]);
            }
        }

        wall = { pts, type, tags: gateDirs, breaches };
    }

    ctx.wall = wall;
    ctx.gates = gates;
}
