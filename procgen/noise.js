/* ------------------------------------------------------------------
 *  Seeded 2D value noise + fBm + domain warp. Used by the region
 *  generator (heightmap/moisture) and for gentle road/river wobble.
 * ------------------------------------------------------------------ */
import { hashSeed } from './rng.js';

function smooth(t) { return t * t * (3 - 2 * t); }

export class Noise2D {
    constructor(seedStr) {
        this.k = hashSeed(String(seedStr))[0] | 0;
    }

    /** hash of an integer lattice point → [0, 1) */
    _lattice(x, y) {
        let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ this.k;
        h = Math.imul(h ^ (h >>> 13), 1274126177);
        return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    }

    /** bilinear value noise in [0, 1) */
    value(x, y) {
        const x0 = Math.floor(x), y0 = Math.floor(y);
        const tx = smooth(x - x0), ty = smooth(y - y0);
        const a = this._lattice(x0, y0), b = this._lattice(x0 + 1, y0);
        const c = this._lattice(x0, y0 + 1), d = this._lattice(x0 + 1, y0 + 1);
        return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
    }

    fbm(x, y, { octaves = 5, lacunarity = 2, gain = 0.5 } = {}) {
        let sum = 0, amp = 1, freq = 1, norm = 0;
        for (let o = 0; o < octaves; o++) {
            sum += amp * this.value(x * freq, y * freq);
            norm += amp;
            amp *= gain;
            freq *= lacunarity;
        }
        return sum / norm;
    }

    /** one round of domain warp — cheap, big realism win for terrain */
    warped(x, y, opts) {
        const wx = this.fbm(x + 5.2, y + 1.3, opts);
        const wy = this.fbm(x + 9.7, y + 8.1, opts);
        return this.fbm(x + 0.6 * wx, y + 0.6 * wy, opts);
    }
}
