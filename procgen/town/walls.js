/* ------------------------------------------------------------------
 *  Town stage 5: wall + gates (LAYOUT stream: nPts, per-point radius).
 * ------------------------------------------------------------------ */
import { compass } from '../schema.js';

export function buildWalls(ctx) {
    const { p, rng, extent, plaza, mains, buildings } = ctx;

    let wall = null;
    const gates = [];
    if (p.walls && buildings.length) {
        const dists = buildings.map(b => Math.hypot(b.cx - plaza.x, b.cy - plaza.y)).sort((a, b) => a - b);
        const radius = Math.min(extent * 0.44, dists[Math.floor(dists.length * 0.85)] + 24);
        const nPts = rng.int(14, 18);
        const pts = [];
        for (let i = 0; i < nPts; i++) {
            const a = (Math.PI * 2 * i) / nPts;
            const r = radius * rng.float(0.93, 1.07);
            pts.push([plaza.x + Math.cos(a) * r, plaza.y + Math.sin(a) * r]);
        }
        const gateDirs = [];
        for (const m of mains) {
            for (const q of m.pts) {
                if (Math.hypot(q[0] - plaza.x, q[1] - plaza.y) >= radius) {
                    gates.push({ x: q[0], y: q[1], dir: compass(plaza.x, plaza.y, q[0], q[1]) });
                    gateDirs.push(compass(plaza.x, plaza.y, q[0], q[1]));
                    break;
                }
            }
        }
        wall = { pts, tags: gateDirs.map(d => d) };
    }

    ctx.wall = wall;
    ctx.gates = gates;
}
