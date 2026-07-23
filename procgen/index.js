/* ------------------------------------------------------------------
 *  Public API of the local procedural generators.
 *
 *  Storage contract: chat metadata keeps only { generator, seed,
 *  params, title, description, thumbnail } — the full model and the
 *  full-res PNG are REGENERATED on demand (deterministic, <50 ms)
 *  and held in small in-memory LRU caches.
 * ------------------------------------------------------------------ */
import { generateDungeon } from './gen-dungeon.js';
import { generateRegion } from './gen-region.js';
import { generateTown } from './gen-town.js';
import { generateInterior } from './gen-interior.js';
import { generateWorld } from './gen-world.js';
import { renderMap } from './render.js';
import { describe, compactJson } from './describe.js';

const GEN_VERSION = 9;

const TYPE_BY_KEY = { ldungeon: 'dungeon', lregion: 'region', ltown: 'town', linterior: 'interior', lworld: 'world' };
const GEN_BY_TYPE = { dungeon: generateDungeon, region: generateRegion, town: generateTown, interior: generateInterior, world: generateWorld };

export function isLocalKey(key) {
    return Object.prototype.hasOwnProperty.call(TYPE_BY_KEY, key);
}

/* tiny LRU on top of Map's insertion order */
function lruGet(cache, key, make, cap) {
    if (cache.has(key)) {
        const v = cache.get(key);
        cache.delete(key);
        cache.set(key, v);
        return v;
    }
    const v = make();
    cache.set(key, v);
    while (cache.size > cap) cache.delete(cache.keys().next().value);
    return v;
}

const models = new Map();
const canvases = new Map();
const dataUrls = new Map();

function cacheKey(map) {
    return `${map.generator}:${map.seed}:${JSON.stringify(map.params ?? {})}:v${GEN_VERSION}`;
}

/** Deterministic structured model for a map ({generator, seed, params}). */
export function buildModel(map) {
    const type = TYPE_BY_KEY[map?.generator];
    if (!type) return null;
    return lruGet(models, cacheKey(map), () => GEN_BY_TYPE[type](String(map.seed ?? ''), map.params ?? {}), 8);
}

export function getRenderCanvas(map) {
    const model = buildModel(map);
    if (!model) return null;
    return lruGet(canvases, cacheKey(map), () => renderMap(model), 6);
}

/** Full-res PNG data URL (for panels, chat preview, vision captioning). */
export function getRenderDataUrl(map) {
    const canvas = getRenderCanvas(map);
    if (!canvas) return null;
    return lruGet(dataUrls, cacheKey(map), () => canvas.toDataURL('image/png'), 6);
}

/** Small JPEG thumbnail (≤320px) — the ONLY image persisted to chat metadata. */
export function getThumbDataUrl(map) {
    const src = getRenderCanvas(map);
    if (!src) return null;
    const scale = Math.min(1, 320 / Math.max(src.width, src.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(src.width * scale));
    c.height = Math.max(1, Math.round(src.height * scale));
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.7);
}

/** Generated map title. */
export function mapName(map) {
    return buildModel(map)?.name || '';
}

/** The LLM-facing description. Prose only — the ASCII minimap reads as
 *  noise to most models (and users), so it is not included. */
export function describeMap(map) {
    const model = buildModel(map);
    if (!model) return '';
    return describe(model).prose;
}

/** Compact machine-readable JSON (no bulky layers). */
export function modelJson(map) {
    const model = buildModel(map);
    return model ? compactJson(model) : '';
}
