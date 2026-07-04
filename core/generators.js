/* ------------------------------------------------------------------
 *  Map Generators — generator registry v2 + URL builder + JSON parsers
 *
 *  embed kinds:
 *   - 'gh'   : Watabou app on watabou.github.io — iframe-able, ?seed= state.
 *   - 'itch' : itch.io-only tool — no URL/seed state, framing unreliable
 *              (Cloudflare/X-Frame), so we open it in a new tab.
 *   - 'url'  : user-supplied custom generator URL — try to iframe it.
 *   - 'local': built-in procedural generator (procgen/) — runs fully
 *              offline, renders to a canvas, exports PNG/JSON/text.
 *
 *  Cross-origin note: we CANNOT read a map's state back out of the
 *  iframe. OUR UI owns the seed/params and builds the src; JSON/PNG
 *  come in via manual upload.
 * ------------------------------------------------------------------ */

/**
 * @typedef {Object} GeneratorDef
 * @property {string} key
 * @property {string} label
 * @property {'gh'|'itch'|'url'|'local'} embed
 * @property {string} base       Live app URL (gh/url) or itch page (itch); '' for local.
 * @property {boolean} seedable  Whether the seed reproduces the result.
 * @property {string[]} params   URL params we expose (gh only).
 * @property {boolean} [json]    Has a parseable JSON export.
 * @property {(o:any)=>string} [parse]
 * @property {string} [tagHint]  Placeholder text for the tags input (gh only).
 * @property {Array<{k:string, type:'select'|'range'|'bool', opts?:string[],
 *            min?:number, max?:number, step?:number, def:any, i18n:string}>}
 *            [paramSchema]      Declarative form fields (local only).
 */

/** @type {Record<string, GeneratorDef>} */
export const GENERATORS = {
    // ---- watabou.github.io apps: iframe + seed (live in the panel) ----
    city: {
        key: 'city', label: 'Medieval Fantasy City', embed: 'gh',
        base: 'https://watabou.github.io/city-generator/',
        seedable: true, params: ['seed', 'size', 'tags'], json: true, parse: parseCityJson,
    },
    village: {
        key: 'village', label: 'Village', embed: 'gh',
        base: 'https://watabou.github.io/village-generator/',
        seedable: true, params: ['seed', 'tags'], json: false,
        tagHint: 'e.g. island, coast, river, square',
    },
    dungeon: {
        key: 'dungeon', label: 'One Page Dungeon', embed: 'gh',
        base: 'https://watabou.github.io/one-page-dungeon/',
        seedable: true, params: ['seed', 'tags'], json: true,   // OPD has a JSON export
        tagHint: 'e.g. small, large, huge, den, ruins, secrets, water',
    },
    shores: {
        key: 'shores', label: 'Perilous Shores', embed: 'gh',
        base: 'https://watabou.github.io/perilous-shores/',
        seedable: true, params: ['seed', 'tags'], json: true, parse: parseShoresJson,
        tagHint: 'e.g. island, peninsula, highland, civilized',
    },
    dwellings: {
        key: 'dwellings', label: 'Dwellings', embed: 'gh',
        base: 'https://watabou.github.io/dwellings/',
        seedable: true, params: ['seed'], json: false,
    },

    // ---- built-in local procedural generators (procgen/) ----
    ldungeon: {
        key: 'ldungeon', label: 'Dungeon (local)', embed: 'local', base: '',
        seedable: true, params: [],
        paramSchema: [
            { k: 'size', type: 'select', opts: ['s', 'm', 'l'], def: 'm', i18n: 'p_size' },
            { k: 'theme', type: 'select', opts: ['crypt', 'ruins', 'stronghold', 'sewer', 'caves'], def: 'crypt', i18n: 'p_theme' },
            { k: 'density', type: 'range', min: 0, max: 1, step: 0.1, def: 0.5, i18n: 'p_density' },
            { k: 'secrets', type: 'bool', def: true, i18n: 'p_secrets' },
        ],
    },
    lregion: {
        key: 'lregion', label: 'Region / World (local)', embed: 'local', base: '',
        seedable: true, params: [],
        paramSchema: [
            { k: 'mask', type: 'select', opts: ['island', 'coast', 'inland'], def: 'island', i18n: 'p_mask' },
            { k: 'water', type: 'range', min: 0.15, max: 0.65, step: 0.05, def: 0.42, i18n: 'p_water' },
            { k: 'settlements', type: 'select', opts: ['few', 'some', 'many'], def: 'some', i18n: 'p_settlements' },
        ],
    },
    ltown: {
        key: 'ltown', label: 'Town / Village (local)', embed: 'local', base: '',
        seedable: true, params: [],
        paramSchema: [
            { k: 'size', type: 'select', opts: ['village', 'town', 'city'], def: 'town', i18n: 'p_size' },
            { k: 'water', type: 'select', opts: ['none', 'river', 'coast'], def: 'river', i18n: 'p_water' },
            { k: 'walls', type: 'bool', def: false, i18n: 'p_walls' },
        ],
    },
    linterior: {
        key: 'linterior', label: 'Building Interior (local)', embed: 'local', base: '',
        seedable: true, params: [],
        paramSchema: [
            { k: 'building', type: 'select', opts: ['tavern', 'house', 'shop', 'temple', 'manor', 'keep'], def: 'tavern', i18n: 'p_building' },
        ],
    },

    // ---- itch.io-only tools: no seed, open in a new tab ----
    taverns: {
        key: 'taverns', label: 'Taverns', embed: 'itch',
        base: 'https://watabou.itch.io/taverns', seedable: false, params: [],
    },
    urban: {
        key: 'urban', label: 'Urban Places', embed: 'itch',
        base: 'https://watabou.itch.io/urban-places', seedable: false, params: [],
    },
    icons: {
        key: 'icons', label: 'Perilous Icons', embed: 'itch',
        base: 'https://watabou.itch.io/icons', seedable: false, params: [],
    },
    tinypubs: {
        key: 'tinypubs', label: 'Tiny Pubs', embed: 'itch',
        base: 'https://watabou.itch.io/tiny-pubs', seedable: false, params: [],
    },
    constellations: {
        key: 'constellations', label: 'Constellations', embed: 'itch',
        base: 'https://watabou.itch.io/constellations', seedable: false, params: [],
    },
    sigil: {
        key: 'sigil', label: 'Sigil Generator', embed: 'itch',
        base: 'https://watabou.itch.io/sigil-generator', seedable: false, params: [],
    },
    histomap: {
        key: 'histomap', label: 'Histomap (world history)', embed: 'itch',
        base: 'https://classicwook.itch.io/histomap', seedable: false, params: [],
    },
};

/** The special key for user-supplied generators. */
export const CUSTOM_KEY = 'custom';

/**
 * Resolve a generator def for a saved map. Custom maps carry their own
 * url/label on the map object, so synthesise a def for them.
 * @param {object} map
 * @returns {GeneratorDef}
 */
export function defFor(map) {
    if (map?.generator && GENERATORS[map.generator]) return GENERATORS[map.generator];
    // custom
    return {
        key: CUSTOM_KEY,
        label: map?.customLabel || 'Custom',
        embed: 'url',
        base: map?.url || '',
        seedable: false,
        params: [],
    };
}

/** A reasonably-sized random seed, matching Watabou's integer seeds. */
export function randomSeed() {
    return Math.floor(Math.random() * 2147483647);
}

/**
 * Build a generator URL from a seed + params object (gh generators).
 * For itch/custom we just return the base URL.
 */
export function buildUrl(generatorKey, seed, params = {}) {
    const def = GENERATORS[generatorKey];
    if (!def) return '';
    if (def.embed !== 'gh') return def.base;
    const qs = new URLSearchParams();
    if (def.seedable && seed !== undefined && seed !== null && seed !== '') qs.set('seed', String(seed));
    for (const [k, v] of Object.entries(params)) {
        if (v === undefined || v === null || v === '' || k === 'seed') continue;
        qs.set(k, Array.isArray(v) ? v.join(',') : String(v));
    }
    const q = qs.toString();
    return def.base + (q ? '?' + q : '');
}

/** Build an export URL (gh generators that support &export=). */
export function buildExportUrl(generatorKey, seed, params = {}, format = 'png') {
    const base = buildUrl(generatorKey, seed, params);
    if (!base || GENERATORS[generatorKey]?.embed !== 'gh') return base;
    return base + (base.includes('?') ? '&' : '?') + 'export=' + format;
}

export function parseUrl(url) {
    const out = { seed: null, params: {} };
    try {
        const u = new URL(url);
        for (const [k, v] of u.searchParams.entries()) {
            if (k === 'seed') out.seed = v;
            else out.params[k] = v;
        }
    } catch { /* ignore */ }
    return out;
}

export function detectGenerator(url) {
    try {
        const u = new URL(url);
        for (const def of Object.values(GENERATORS)) {
            if (!def.base) continue;   // local generators have no URL
            const base = new URL(def.base);
            if (u.host === base.host && u.pathname.replace(/\/$/, '') === base.pathname.replace(/\/$/, '')) {
                return def.key;
            }
        }
    } catch { /* ignore */ }
    return null;
}

/* ------------------------------------------------------------------
 *  JSON → text summaries (best-effort, never throw).
 * ------------------------------------------------------------------ */
function collectFeatures(root, depth = 0, acc = []) {
    if (!root || depth > 4) return acc;
    if (Array.isArray(root)) {
        acc.push(root);
        for (const it of root) if (it && typeof it === 'object') collectFeatures(it, depth + 1, acc);
    } else if (typeof root === 'object') {
        for (const v of Object.values(root)) if (v && typeof v === 'object') collectFeatures(v, depth + 1, acc);
    }
    return acc;
}

function asText(obj) {
    try { return JSON.stringify(obj).toLowerCase(); } catch { return ''; }
}

export function parseCityJson(data) {
    const text = asText(data);
    const parts = [];
    const features = (data && Array.isArray(data.features)) ? data.features : null;
    if (features) {
        const byType = {};
        for (const f of features) {
            const ty = (f?.geometry?.type || f?.type || 'feature').toLowerCase();
            byType[ty] = (byType[ty] || 0) + 1;
        }
        const polys = (byType.polygon || 0) + (byType.multipolygon || 0);
        const lines = (byType.linestring || 0) + (byType.multilinestring || 0);
        if (polys) parts.push(`~${polys} building footprints`);
        if (lines) parts.push(`${lines} road segments`);
    }
    const names = new Set();
    for (const arr of collectFeatures(data)) {
        for (const it of arr) {
            const n = it?.name || it?.properties?.name || it?.label;
            if (typeof n === 'string' && n.length && n.length < 40) names.add(n);
        }
    }
    if (names.size) parts.push(`districts/landmarks: ${[...names].join(', ')}`);
    const flags = [];
    if (/\bwall|rampart/.test(text)) flags.push('city walls');
    if (/\bgate/.test(text)) flags.push('gates');
    if (/\bcitadel|castle/.test(text)) flags.push('a citadel/castle');
    if (/\btemple|cathedral/.test(text)) flags.push('a temple');
    if (/\bplaza|market|square/.test(text)) flags.push('a market plaza');
    if (/\briver|water|moat/.test(text)) flags.push('water (river/moat)');
    if (/\bcoast|sea|harbou?r|port/.test(text)) flags.push('a coastline/harbour');
    if (/\btower/.test(text)) flags.push('towers');
    if (flags.length) parts.push('features: ' + flags.join(', '));
    return parts.length
        ? `A fortified medieval city. ${parts.join('. ')}.`
        : 'A medieval city map (no recognisable structure in the JSON; edit this description).';
}

export function parseShoresJson(data) {
    const text = asText(data);
    const parts = [];
    const names = new Set();
    for (const arr of collectFeatures(data)) {
        for (const it of arr) {
            const n = it?.name || it?.label || it?.properties?.name || it?.text;
            if (typeof n === 'string' && n.length && n.length < 40) names.add(n);
        }
    }
    if (names.size) parts.push(`named places: ${[...names].join(', ')}`);
    const flags = [];
    if (/island/.test(text)) flags.push('islands');
    if (/mountain|peak|highland/.test(text)) flags.push('mountains');
    if (/forest|wood/.test(text)) flags.push('forests');
    if (/swamp|marsh/.test(text)) flags.push('wetlands');
    if (/river/.test(text)) flags.push('rivers');
    if (/coast|sea|shore|bay/.test(text)) flags.push('coastline');
    if (/town|village|city|ruin|tower|temple/.test(text)) flags.push('settlements/ruins');
    if (flags.length) parts.push('terrain: ' + flags.join(', '));
    return parts.length
        ? `A regional fantasy map of coasts and wilds. ${parts.join('. ')}.`
        : 'A regional fantasy map (no recognisable structure in the JSON; edit this description).';
}

/**
 * Generic JSON → text for generators without a dedicated parser.
 * Extracts every name/label/title/text field it can find; if none,
 * falls back to pretty-printed JSON. Never truncates.
 * @param {any} data parsed JSON
 * @returns {string}
 */
export function jsonToText(data) {
    const names = [];
    for (const arr of collectFeatures(data)) {
        for (const it of arr) {
            for (const key of ['name', 'label', 'title', 'text', 'caption']) {
                const v = it?.[key] ?? it?.properties?.[key];
                if (typeof v === 'string' && v.trim()) names.push(v.trim());
            }
        }
    }
    if (names.length) {
        // de-dup while preserving order, no cap
        const seen = new Set();
        const uniq = names.filter(n => (seen.has(n) ? false : (seen.add(n), true)));
        return uniq.join('\n');
    }
    try { return JSON.stringify(data, null, 2); } catch { return String(data); }
}
