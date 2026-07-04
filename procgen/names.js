/* ------------------------------------------------------------------
 *  Deterministic fantasy name generation + all flavor/content tables
 *  the generators consume. Keeping every "content string" in one
 *  module makes it easy to edit or localize later.
 *
 *  Always consume from a dedicated rng.sub('names') stream in a FIXED
 *  iteration order (sort entities by id first) — see rng.js.
 * ------------------------------------------------------------------ */

const SYL = {
    start: ['bar', 'kel', 'dur', 'mor', 'thal', 'vin', 'gral', 'ost', 'wyn', 'fen',
        'cal', 'dren', 'har', 'bel', 'tor', 'mir', 'ash', 'grim', 'sil', 'ran',
        'ul', 'nor', 'crow', 'black', 'stone', 'east', 'wolf', 'raven'],
    mid: ['a', 'o', 'en', 'ar', 'il', 'um', 'ath', 'or', 'ev', 'and', 'is', 'el'],
    end: ['dor', 'wick', 'holm', 'mere', 'fell', 'burg', 'stead', 'haven', 'moor',
        'ford', 'gate', 'march', 'crag', 'deep', 'watch', 'vale', 'shaw', 'den',
        'port', 'ley'],
};

const VILLAGE_END = ['stead', 'wick', 'ford', 'den', 'ley', 'shaw'];
const CITY_END = ['burg', 'gate', 'holm', 'port', 'watch', 'haven'];

export function word(rng, { midChance = 0.45, end = null } = {}) {
    let w = rng.pick(SYL.start);
    if (rng.chance(midChance)) w += rng.pick(SYL.mid);
    w += rng.pick(end || SYL.end);
    return w[0].toUpperCase() + w.slice(1);
}

const DUNGEON_SUFFIX = ['Halls', 'Depths', 'Catacombs', 'Barrow', 'Warrens', 'Vaults', 'Undercroft', 'Tombs'];
const DUNGEON_OF = ['Sorrow', 'the Drowned King', 'Whispers', 'the Pale Flame', 'Broken Chains', 'the Last Vigil', 'the Silent Choir', 'Rust and Ash'];
const REGION_SUFFIX = ['March', 'Reach', 'Wilds', 'Coast', 'Vale', 'Expanse', 'Lowlands', 'Frontier'];
const TAVERN_ADJ = ['Drowned', 'Gilded', 'Prancing', 'Rusty', 'Laughing', 'Salty', 'Crooked', 'Sleeping', 'Thirsty', 'Wandering'];
const TAVERN_NOUN = ['Rat', 'Goblet', 'Pony', 'Anchor', 'Kraken', 'Lantern', 'Griffin', 'Barrel', 'Crow', 'Boar'];

/**
 * @param {import('./rng.js').Rng} rng
 * @param {'dungeon'|'region'|'settlement'|'village'|'city'|'tavern'|'person'|string} kind
 */
export function nameFor(rng, kind) {
    switch (kind) {
        case 'dungeon':
            return rng.chance(0.35)
                ? `The ${rng.pick(DUNGEON_SUFFIX)} of ${rng.pick(DUNGEON_OF)}`
                : `${word(rng)} ${rng.pick(DUNGEON_SUFFIX)}`;
        case 'region':
            return `The ${word(rng)} ${rng.pick(REGION_SUFFIX)}`;
        case 'village':
            return word(rng, { end: VILLAGE_END });
        case 'city':
            return word(rng, { end: CITY_END });
        case 'tavern':
            return `The ${rng.pick(TAVERN_ADJ)} ${rng.pick(TAVERN_NOUN)}`;
        case 'person':
            return word(rng, { midChance: 0.2 });
        default:
            return word(rng);
    }
}

/* ------------------------------------------------------------------
 *  Dungeon room purposes & features
 * ------------------------------------------------------------------ */
export const DUNGEON_ROOMS = {
    entrance: 'entry hall',
    deadEnd: ['shrine', 'treasury', 'crypt', 'ossuary', 'hidden vault', 'flooded cell', 'oubliette'],
    hub: ['guard room', 'pillared hall', 'junction chamber'],
    common: {
        crypt: ['embalming room', 'bone gallery', 'tomb chamber', 'offering room', 'sarcophagus hall', "mourner's cell"],
        ruins: ['collapsed hall', 'overgrown court', 'broken library', 'dusty archive', 'fallen gallery', 'shattered atrium'],
        stronghold: ['barracks', 'armory', 'mess hall', 'training yard', "commander's quarters", 'storeroom'],
        sewer: ['sluice chamber', 'cistern', 'drainage hall', 'rat warren', 'maintenance room', 'overflow basin'],
        caves: ['fungal grotto', 'dripping cavern', 'crystal pocket', 'underground pool', 'bat roost', 'narrow squeeze'],
    },
};

export const DUNGEON_FEATURES = {
    'shrine': ['a cracked altar to a forgotten god', 'melted candle stubs in wall niches', 'a defaced stone idol'],
    'treasury': ['empty iron-bound chests', 'scattered copper coins', 'a broken scale and torn ledgers'],
    'crypt': ['stone sarcophagi with pried lids', 'burial niches in the walls', 'a faint smell of dust and myrrh'],
    'ossuary': ['walls lined with stacked skulls', 'bone heaps sorted by kind'],
    'hidden vault': ['a false wall left ajar', 'scratch marks around a hairline seam'],
    'flooded cell': ['knee-deep dark water', 'rusted bars and a drowned cot'],
    'guard room': ['rusted weapon racks', 'a table with abandoned dice', 'an arrow-slit overlooking the corridor'],
    'entry hall': ['a broken portcullis', 'faded warning signs', 'old torch sconces, long cold'],
    default: ['rubble in the corners', 'scratch marks on the floor', 'a cold draft', 'old bloodstains',
        'broken furniture', 'strange fungi on the walls', 'a shallow pool of dark water',
        'faded wall carvings', 'bones scattered about', 'a rusted chain bolted to the wall'],
};

export function featureFor(rng, purpose) {
    const pool = DUNGEON_FEATURES[purpose] || DUNGEON_FEATURES.default;
    return rng.pick(pool);
}

/* ------------------------------------------------------------------
 *  Building interiors: room plans + furniture landmarks
 * ------------------------------------------------------------------ */
export const INTERIOR_PLANS = {
    tavern: { hub: 'common room', rooms: ['kitchen', 'pantry', 'cellar stair', 'private booth', 'guest room', 'guest room', 'brewing room', "owner's room"] },
    house: { hub: 'hearth room', rooms: ['bedroom', 'larder', 'workshop', 'storage', "children's room", 'bedroom'] },
    shop: { hub: 'shopfront', rooms: ['workshop', 'storage', 'office', 'living quarters', 'cellar stair'] },
    temple: { hub: 'nave', rooms: ['sanctum', 'vestry', 'reliquary', 'cloister cell', 'archive', 'offering room'] },
    manor: { hub: 'grand hall', rooms: ['dining room', 'library', 'study', 'master bedroom', 'guest bedroom', 'kitchen', "servants' quarters", 'gallery'] },
    keep: { hub: 'great hall', rooms: ['armory', 'guard room', "lord's chamber", 'solar', 'kitchen', 'storeroom', 'chapel'] },
};

export const FURNITURE = {
    'common room': ['a long oak counter', 'a soot-blackened hearth', 'heavy trestle tables', 'a small corner stage', 'a notice board by the door'],
    'kitchen': ['an iron cauldron over coals', 'bundles of hanging herbs', 'a brick oven', 'a scarred butcher block'],
    'pantry': ['sacks of flour and root vegetables', 'wheels of cheese on shelves'],
    'cellar stair': ['a trapdoor and steep steps down', 'racked barrels visible below'],
    'guest room': ['a narrow bed and a washbasin', 'a chest with a stubborn lock'],
    'nave': ['rows of worn benches', 'a stone altar', 'tall bronze candlesticks'],
    'sanctum': ['a relic under glass', 'an inner altar draped in cloth'],
    'great hall': ['a long feasting table', 'faded banners on the walls', 'a massive fireplace'],
    'grand hall': ['a sweeping staircase', 'portraits of stern ancestors', 'a crystal-drop chandelier'],
    'armory': ['weapon racks and armor stands', 'a whetstone wheel'],
    'library': ['floor-to-ceiling bookshelves', 'a reading desk with a snuffed lamp'],
    'study': ['a cluttered writing desk', 'maps pinned to the wall'],
    'workshop': ['a sturdy workbench with tools', 'half-finished wares'],
    'shopfront': ['a display counter', 'shelves of goods', 'a hanging scale'],
    'hearth room': ['a broad hearth with a cook-pot', 'a spinning wheel', 'a heavy family table'],
    default: ['a sturdy table', 'a battered chest', 'shelves along the wall', 'a woven rug', 'an old cabinet'],
};

export function furnitureFor(rng, purpose) {
    const pool = FURNITURE[purpose] || FURNITURE.default;
    return rng.pick(pool);
}

/* ------------------------------------------------------------------
 *  Town: landmarks & building purposes
 * ------------------------------------------------------------------ */
export const TOWN_LANDMARKS = {
    village: ['tavern', 'well', 'smithy', 'shrine'],
    town: ['tavern', 'market', 'temple', 'smithy', 'well', 'mill'],
    city: ['tavern', 'market', 'temple', 'smithy', 'guildhall', 'manor', 'gatehouse inn', 'stables'],
};

export const BUILDING_KINDS = [['house', 70], ['shop', 12], ['workshop', 10], ['barn', 8]];

export const DISTRICT_FLAVOR = ['Ward', 'End', 'Quarter', 'Row', 'Yard', 'Side'];
export const DISTRICT_ADJ = ['Old', 'Low', 'High', 'Fish', 'Tanner\'s', 'Temple', 'Market', 'Mill', 'Cart', 'Stone'];

/* ------------------------------------------------------------------
 *  Region: biomes & points of interest
 * ------------------------------------------------------------------ */
export const BIOME_LABELS = {
    ocean: 'open water', lake: 'lake', beach: 'shoreline',
    grassland: 'grassland', forest: 'forest', rainforest: 'deep forest',
    desert: 'dry steppe', swamp: 'swamp', mountains: 'mountains', snow: 'snowbound peaks',
};

const BIOME_NAME_SUFFIX = {
    forest: ['wood', 'weald', 'shaw'],
    rainforest: ['wood', 'tangle'],
    swamp: ['fen', 'mire', 'marsh'],
    mountains: ['peaks', 'crags', 'teeth'],
    snow: ['peaks', 'crown'],
    desert: ['wastes', 'flats'],
    grassland: ['meads', 'downs', 'plain'],
};

/** Named biome patch ("the Eldwood") — null for unnameable biomes. */
export function biomeName(rng, biome) {
    const sfx = BIOME_NAME_SUFFIX[biome];
    if (!sfx) return null;
    const base = word(rng, { midChance: 0.3 }).replace(/(dor|wick|burg|stead|port|gate)$/, '');
    return `the ${base}${rng.pick(sfx)}`;
}

export const POI_KINDS = ['ruin', 'watchtower', 'shrine', 'cave', 'standing stones', 'hermitage'];
