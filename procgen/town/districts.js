/* ------------------------------------------------------------------
 *  Town stage 4: districts — cluster buildings into named quarters.
 *  (Currently: nearest-main-ray clustering; DECO stream names.)
 * ------------------------------------------------------------------ */
import { DISTRICT_ADJ, DISTRICT_FLAVOR } from '../names.js';
import { distToPolyline } from './geom.js';

export function buildDistricts(ctx) {
    const { p, deco, mains, buildings } = ctx;

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

    ctx.districts = districts;
    ctx.piers = [];
    ctx.fields = [];
    ctx.spoil = [];
}
