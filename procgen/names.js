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
const WORLD_SUFFIX = ['Realms', 'World', 'Spheres', 'Lands Entire', 'Circle'];
const WORLD_END = ['ia', 'os', 'ara', 'eth', 'ion', 'ador'];
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
        case 'world':
            return rng.chance(0.4)
                ? `The ${word(rng)} ${rng.pick(WORLD_SUFFIX)}`
                : word(rng, { midChance: 0.6, end: WORLD_END });
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
    smithy: { hub: 'forge', rooms: ['workshop', 'storeroom', 'fuel store', 'office', 'living quarters'] },
    barracks: { hub: 'mess hall', rooms: ['bunkroom', 'bunkroom', 'armory', "captain's quarters", 'storeroom', 'washroom'] },
    warehouse: { hub: 'loading bay', rooms: ['storage bay', 'office', 'strongroom', "watchman's nook"] },
    caravanserai: { hub: 'courtyard', rooms: ['common room', 'guest room', 'guest room', 'stables', 'kitchen', 'storeroom', "keeper's room"] },
    mill: { hub: 'mill room', rooms: ['grain store', 'office', 'living quarters'] },
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
    'hallway': ['a row of coat hooks', 'a threadbare runner rug', 'an oil lamp on a wall bracket'],
    'hearth room': ['a broad hearth with a cook-pot', 'a spinning wheel', 'a heavy family table'],
    'forge': ['a stone forge banked with glowing coals', 'a great anvil scarred by a thousand blows', 'a quenching trough skinned with soot', 'racks of tongs and hammers'],
    'fuel store': ['heaped charcoal in slatted bins', 'stacked cordwood under a tarp', 'a shovel leaning by a coal-dark corner'],
    'mess hall': ['long benches worn smooth by elbows', 'a cauldron kept forever at a simmer', 'a rack of dented tin bowls', 'a duty roster chalked on a board'],
    'bunkroom': ['tiers of narrow cots with rolled bedding', 'kit-bags hung from iron pegs', 'a footlocker at every bunk'],
    'loading bay': ['a block-and-tackle hoist on a roof beam', 'a broad weighing scale by the doors', 'a hand-cart parked against the wall', 'chalk tallies scrawled on the boards'],
    'storage bay': ['crates stacked to the rafters', 'bales lashed under waxed canvas', 'a narrow aisle between towering goods'],
    'strongroom': ['an iron-banded strongbox bolted down', 'a ledger chained to a lectern', 'a wall of numbered lockboxes'],
    'loft': ['a low crawl of exposed rafters', 'trunks furred with dust under the eaves', 'a shuttered gable window'],
    'courtyard': ['a stone well ringed by a worn trough', 'a mounting block by the gate', 'benches shaded under a portico', 'ruts worn deep by cart-wheels'],
    'stables': ['a row of straw-bedded stalls', 'a tack wall of bridles and saddles', 'a water trough and a hayrack', 'a swept aisle smelling of horse'],
    'mill room': ['great grinding stones on a squat spindle', 'a dusted hopper feeding the wheel', 'a web of drive-shafts and gears', 'flour-pale beams overhead'],
    'grain loft': ['sacks of grain stacked chest-high', 'a chute dropping to the stones below', 'a wooden grain-scoop worn smooth'],
    'grain store': ['bins brimming with threshed grain', 'a wooden measure and a hanging scale', 'a cat asleep on the sacks'],
    'cellar': ['racked barrels sweating in the cool', 'crocks and preserves on low shelves', 'a dirt floor stamped hard by years'],
    'wine cellar': ['dusty bottles binned by vintage', 'oak casks resting on cradles', 'a tasting table with a single guttered candle'],
    'root cellar': ['bins of turnips and sprouting potatoes', 'onions and herbs braided from the beams', 'a damp earthen smell that never lifts'],
    'crypt': ['stone sarcophagi lined in silent rows', 'niches stacked with shrouded remains', 'a cold altar veined with old candle-wax'],
    'washroom': ['a copper tub and a pump-handle basin', 'a bench of grey soap and folded linen', 'a floor drain and a bucket of lye'],
    'office': ['a writing desk drifted with ledgers', 'a wall of pigeonhole cubbies', 'a strongbox tucked beneath the desk'],
    'storeroom': ['shelves crammed to the ceiling', 'stacked crates and coiled rope', 'a tally-board hung by the door'],
    'living quarters': ['a curtained cot in the corner', 'a small stove and a battered kettle', 'a shelf of personal keepsakes'],
    "watchman's nook": ['a stool set square before the door', 'a shuttered lantern and a knobbed cudgel', 'a cold brazier and a half-drained mug'],
    "keeper's room": ['a corner desk with the day-book open', 'a ring of keys on a wall-hook', 'a narrow bed and a locked cash-drawer'],
    "captain's quarters": ['a campaign desk spread with maps', 'a sword-belt hung above a hard cot', 'a locked chest bearing a garrison seal'],
    'upstairs bedroom': ['a curtained bed under a sloping ceiling', 'a washstand with a chipped ewer', 'a clothes-chest at the bed-foot'],
    'upper landing': ['a rail overlooking the hall below', 'a wall-sconce and a runner of faded carpet', 'a narrow window seat'],
    'pilgrim house': ['rows of plain pallets on the floor', 'a shared water-jar and tin cups', 'a wall niche with a guttered votive'],
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
    taiga: 'pine forest', tundra: 'frozen tundra', savanna: 'savanna',
    badlands: 'badlands', ashland: 'volcanic ashland', blight: 'blighted waste',
    iceshelf: 'pack ice',
};

const BIOME_NAME_SUFFIX = {
    forest: ['wood', 'weald', 'shaw'],
    rainforest: ['wood', 'tangle'],
    swamp: ['fen', 'mire', 'marsh'],
    mountains: ['peaks', 'crags', 'teeth'],
    snow: ['peaks', 'crown'],
    desert: ['wastes', 'flats'],
    grassland: ['meads', 'downs', 'plain'],
    taiga: ['wood', 'pines'],
    tundra: ['barrens', 'waste'],
    savanna: ['plains', 'veld'],
    badlands: ['scars', 'mesas'],
    ashland: ['ashes', 'cinders'],
    blight: ['blight', 'rot'],
};

/** Named biome patch ("the Eldwood") — null for unnameable biomes. */
export function biomeName(rng, biome) {
    const sfx = BIOME_NAME_SUFFIX[biome];
    if (!sfx) return null;
    const base = word(rng, { midChance: 0.3 }).replace(/(dor|wick|burg|stead|port|gate)$/, '');
    return `the ${base}${rng.pick(sfx)}`;
}

export const POI_KINDS = ['ruin', 'watchtower', 'shrine', 'cave', 'standing stones', 'hermitage'];

/* ------------------------------------------------------------------
 *  Region: hydronyms (river / lake names) & biome-keyed POI kinds
 * ------------------------------------------------------------------ */

/* settlement suffixes stripped so a river reads as a natural feature */
const HYDRO_STRIP = /(dor|wick|holm|mere|fell|burg|stead|haven|moor|ford|gate|march|crag|deep|watch|vale|shaw|den|port|ley)$/;
const RIVER_END = ['run', 'water', 'flow', 'rush', 'wash', 'stream'];
const LAKE_END = ['mere', 'tarn', 'loch'];

/** River name, e.g. "the Ashwater". */
export function riverName(rng) {
    const base = word(rng, { midChance: 0.3 }).replace(HYDRO_STRIP, '');
    return `the ${base}${rng.pick(RIVER_END)}`;
}

/** Lake name, e.g. "Lake Bel" or "Belmere". */
export function lakeName(rng) {
    const base = word(rng, { midChance: 0.3 }).replace(HYDRO_STRIP, '');
    return rng.chance(0.5) ? `Lake ${base}` : `${base}${rng.pick(LAKE_END)}`;
}

/** POI kinds keyed by the biome at the site (fallback: POI_KINDS). */
export const REGION_POI = {
    desert: ['oasis', 'buried ruin', 'caravanserai'],
    badlands: ['hoodoo spires', 'abandoned mine', 'dry gulch camp'],
    ashland: ['geyser field', 'lava tube', 'obsidian flow'],
    blight: ['blighted ruin', 'bone field', 'twisted grove'],
    swamp: ['sunken shrine', 'witch hut', 'drowned village'],
    mountains: ['high pass', 'watchtower', 'hermitage'],
    tundra: ['mammoth graveyard', 'frozen cairn', 'hunter camp'],
    taiga: ['trapper lodge', 'old shrine', 'logging camp'],
    savanna: ['watering hole', 'termite spires', 'hunting ground'],
    default: POI_KINDS,
};

/* ------------------------------------------------------------------
 *  World layer: nations, wonders, and planetary hydronyms/toponyms.
 *
 *  APPENDED — the tables above are untouched, so region seeds and the
 *  region test snapshots keep producing identical output. Every helper
 *  is a pure function of its Rng; the world generator draws them in a
 *  single fixed NAMES order (see gen-world.js).
 * ------------------------------------------------------------------ */

/** Per-flavor adjectives + government forms; enrich freely. */
export const NATION_FLAVORS = {
    maritime: { adj: ['Tidal', 'Coral', 'Pearl', 'Azure', 'Saffron', 'Salt'], gov: ['Republic', 'Thalassocracy', 'League', 'Free Cities'] },
    steppe: { adj: ['Golden', 'Iron', 'Storm', 'Wind', 'Red'], gov: ['Khanate', 'Horde', 'Khaganate'] },
    forest: { adj: ['Green', 'Elder', 'Silver', 'Thorn', 'Wolf'], gov: ['Kingdom', 'Principality', 'Duchy'] },
    desert: { adj: ['Scarlet', 'Amber', 'Sun', 'Bronze', 'Gilded'], gov: ['Caliphate', 'Sultanate', 'Emirate'] },
    mountain: { adj: ['Grey', 'High', 'Stone', 'Iron', 'Deep'], gov: ['Holds', 'Clans', 'Under-Kingdom'] },
    fen: { adj: ['Pale', 'Mist', 'Reed', 'Grey', 'Bog'], gov: ['Marshland', 'Covenant'] },
    jungle: { adj: ['Verdant', 'Jade', 'Emerald', 'Feathered'], gov: ['Empire', 'Temple-Realm'] },
    ashen: { adj: ['Ashen', 'Cinder', 'Ember', 'Black'], gov: ['Dominion', 'Ash Court'] },
};

const NATION_END = ['ia', 'or', 'and', 'mark', 'gard', 'esh', 'oria', 'wen'];

/** Nation name, e.g. "Keloria" or "the Golden Vinmark". */
export function nationName(rng, flavor) {
    const base = word(rng, { midChance: 0.5, end: NATION_END });
    const f = NATION_FLAVORS[flavor];
    if (f && f.adj && rng.chance(0.4)) return `${rng.pick(f.adj)} ${base}`;
    return base;
}

/** Government form keyed to the nation flavor. */
export function governmentFor(rng, flavor) {
    const f = NATION_FLAVORS[flavor] || NATION_FLAVORS.forest;
    return rng.pick(f.gov);
}

/** Biome-keyed dramatic world wonders (the strings ARE the names). */
export const WORLD_WONDERS = {
    mountains: ['the Shattered Spire', 'the Sky Anvil'],
    snow: ['the Shattered Spire', 'the Sky Anvil'],
    desert: ['the Sea of Glass', 'the Singing Dunes'],
    badlands: ['the Sea of Glass', 'the Singing Dunes'],
    forest: ['the Worldtree', 'the Verdant Maw'],
    rainforest: ['the Worldtree', 'the Verdant Maw'],
    ocean: ['the Maelstrom', 'the Drowned Bell'],
    beach: ['the Maelstrom', 'the Drowned Bell'],
    ashland: ['the Ashen Throne'],
    blight: ['the Weeping Scar'],
    tundra: ['the Frozen Titan'],
    taiga: ['the Frozen Titan'],
    swamp: ['the Sunken Cathedral'],
    default: ['the Standing Gods'],
};

const WONDER_ADJ = ['Pale', 'Broken', 'Weeping', 'Silent', 'Burning', 'Sunken', 'Hollow', 'Riven'];
const WONDER_NOUN = ['Spire', 'Throne', 'Titan', 'Bell', 'Crown', 'Maw', 'Sepulchre', 'Colossus'];

/** Wonder name: usually a fixed evocative string, sometimes a generated
 *  variant. Pass a Set as `used` to guarantee uniqueness within one world. */
export function wonderName(rng, biome, used = null) {
    const pool = WORLD_WONDERS[biome] || WORLD_WONDERS.default;
    let name = rng.chance(0.65) ? rng.pick(pool) : `the ${rng.pick(WONDER_ADJ)} ${rng.pick(WONDER_NOUN)}`;
    if (used) {
        for (let guard = 0; guard < 8 && used.has(name); guard++) {
            name = `the ${rng.pick(WONDER_ADJ)} ${rng.pick(WONDER_NOUN)}`;
        }
        used.add(name);
    }
    return name;
}

const SEA_ADJ = ['Shivering', 'Sundered', 'Ashen', 'Whispering', 'Iron', 'Jade', 'Silent', 'Sapphire'];
/** Sea name, e.g. "the Jade Sea" or "the Sea of Bel". */
export function seaName(rng) {
    return rng.chance(0.45)
        ? `the ${rng.pick(SEA_ADJ)} Sea`
        : `the Sea of ${word(rng, { midChance: 0.3 }).replace(HYDRO_STRIP, '')}`;
}

const OCEAN_ADJ = ['Endless', 'Sunless', 'Boundless', 'Wandering', 'Titan', 'Deep'];
/** Ocean name, e.g. "the Sunless Ocean" or "the Veloria Ocean". */
export function oceanName(rng) {
    return rng.chance(0.5)
        ? `the ${rng.pick(OCEAN_ADJ)} Ocean`
        : `the ${word(rng, { midChance: 0.4, end: WORLD_END })} Ocean`;
}

const CONTINENT_SUFFIX = ['Reaches', 'Expanse', 'Continent', 'Lands', 'Shelf'];
/** Continent name, e.g. "Ostador" or "the Wynshaw Reaches". */
export function continentName(rng) {
    return rng.chance(0.5)
        ? word(rng, { midChance: 0.6, end: WORLD_END })
        : `the ${word(rng)} ${rng.pick(CONTINENT_SUFFIX)}`;
}

const EMPIRE_ADJ = ['First', 'Old', 'Sunken', 'Elder', 'Forgotten', 'Fallen'];
const EMPIRE_SUFFIX = ['Imperium', 'Ascendancy', 'Dominion', 'Empire', 'Hegemony', 'Concord'];
/** Fallen-empire name for ancient worlds, e.g. "the Sunken Imperium". */
export function deadEmpireName(rng) {
    return rng.chance(0.5)
        ? `the ${word(rng, { midChance: 0.5, end: WORLD_END })} ${rng.pick(EMPIRE_SUFFIX)}`
        : `the ${rng.pick(EMPIRE_ADJ)} ${rng.pick(EMPIRE_SUFFIX)}`;
}

const RUIN_SITE = ['the Broken Court', 'the Fallen Keep', 'the Sunken Vault', 'the Ashen Halls',
    'the Silent Throne', 'the Ruined Spire', 'the Lost Bastion', 'the Weeping Gate', 'the Hollow Crown'];
/** Ruin name tied to a dead empire, e.g. "the Broken Court of Elder Imperium". */
export function ruinName(rng, empire) {
    const site = rng.pick(RUIN_SITE);
    return empire ? `${site} of ${String(empire).replace(/^the /, '')}` : site;
}

/* ------------------------------------------------------------------
 *  Town life layer: deities, guild crafts, caravanserai flavor, and
 *  resident traits. APPENDED — every table above is untouched, so the
 *  region/world snapshots keep producing identical output. Consumed by
 *  town/life.js from the NAMES stream in a single fixed order.
 * ------------------------------------------------------------------ */

const DEITY_ADJ = ['Pale', 'Deep', 'Golden', 'Silent', 'Weeping', 'Radiant',
    'Hollow', 'Iron', 'Ashen', 'Everliving', 'Twin', 'Nameless', 'Drowned', 'Kindly'];
const DEITY_ASPECT = ['Mother', 'Father', 'Watcher', 'Judge', 'Maiden', 'Smith',
    'Shepherd', 'Warden', 'Lantern', 'Twins', 'Stranger', 'Widow', 'Mariner'];
const DEITY_DOMAIN = ['the Deep', 'the Dawn', 'the Harvest', 'the Storm', 'the Grave',
    'the Forge', 'the Tides', 'the Wilds', 'the Hearth', 'the Long Road', 'the Green', 'the Ember'];

/** Deity name for a temple/shrine dedication, e.g. "the Pale Mother" or
 *  "Torvan of the Deep". */
export function deityName(rng) {
    return rng.chance(0.5)
        ? `the ${rng.pick(DEITY_ADJ)} ${rng.pick(DEITY_ASPECT)}`
        : `${word(rng, { midChance: 0.3 })} of ${rng.pick(DEITY_DOMAIN)}`;
}

/** Guild trades — for "<Craft> Guildhall". */
export const GUILD_CRAFTS = ['Masons', 'Weavers', 'Coopers', 'Tanners', 'Smiths',
    'Merchants', 'Goldsmiths', 'Stonecutters', 'Potters', 'Vintners', 'Fletchers',
    'Wrights', 'Bakers', 'Dyers'];

/** Caravanserai adjectives — for "The <Adj> Caravanserai". */
export const CARAVANSERAI_ADJ = ['Weary', 'Long', 'Distant', 'Golden', 'Dusty',
    'Painted', 'Amber', 'Wandering', 'Silk', 'Spice'];

/** Fortress words — for "Castle <Word>" / "The <Word> Keep". */
export const CITADEL_WORD = ['Blackstone', 'Ironhold', 'Grimwatch', 'Highgate',
    'Ravenspire', 'Dourhold', 'Stormcrag', 'Wolfden'];

/** Short evocative resident traits, keyed by role with a rich default pool.
 *  One clause each; life.js picks with the NAMES stream. */
export const RESIDENT_TRAITS = {
    innkeeper: [
        'never forgets a debt', 'pours a heavy hand for regulars', 'hears every rumor first',
        'keeps a cudgel behind the bar', 'waters the cheap wine, not the good',
        'widowed twice, unbothered', 'remembers every face, few names', 'runs an honest game of dice',
    ],
    blacksmith: [
        'deaf in one ear, sharp in both eyes', 'hums the same three notes all day',
        'never quotes the same price twice', 'missing two fingers, misses nothing',
        'proud of a blade sold to a lord', 'takes payment in favors as often as coin',
        'arms like knotted rope', 'apprenticed to a dead master, still argues with him',
    ],
    priest: [
        'quotes scripture no one can find', 'weeps at every wedding and funeral alike',
        'suspiciously well-fed for a fasting month', 'keeps the poor box heavier than the altar',
        'blesses coin and dagger with equal grace', 'has not slept a full night in years',
        'buries the dead cheap, marries the living dear', 'believes the old gods still listen',
    ],
    abbot: [
        'has taken a vow of silence, mostly', 'copies books faster than he reads them',
        'brews a beer worth the pilgrimage', 'rules the cloister like a small kingdom',
        'gentle with novices, ruthless with debtors', 'knows which relics are real',
    ],
    noble: [
        'has not paid a tradesman in a year', 'collects grievances like others collect coin',
        'quietly ruined, loudly proud', 'married for land, regrets it daily',
        'keeps a huntsman busier than a steward', 'signs everything, reads nothing',
        'terrified of the family they descend from', 'generous only when watched',
    ],
    castellan: [
        'walks the walls at the same hour nightly', 'trusts stone more than men',
        'keeps the garrison lean and loyal', 'holds a key to a door no one remembers',
        'answers to a lord who never visits', 'counts every arrow in the store',
    ],
    captain: [
        'drills the watch harder than a war', 'owes gambling debts to half the barracks',
        'promoted for a battle they slept through', 'fair with recruits, savage with deserters',
        'keeps a map of a country that no longer exists', 'never removes their gorget, even at supper',
    ],
    merchant: [
        'weighs every coin with narrowed eyes', 'smuggles a little, denies it warmly',
        'speaks four tongues and trusts none', 'always one caravan from ruin or fortune',
        'keeps two ledgers, shows one', 'wears last season’s fashion, this season’s rings',
    ],
    harbormaster: [
        'knows every hull that ever dodged the toll', 'reads the tide like a ledger',
        'takes a cut of everything that floats', 'lost a leg to a capstan, not a battle',
        'keeps the lamp lit out of superstition', 'remembers ships longer than sailors',
    ],
    fishmonger: [
        'weighs every catch twice', 'smells of brine and shrewd bargains',
        'undercuts rivals with a smile', 'saves the best eel for the temple',
        'louder than a gull at dawn', 'has never once cut a fair filet',
    ],
    'mine foreman': [
        'counts miners in and counts them out', 'reads the rock like weather',
        'lost a brother to a cave-in, says nothing', 'docks pay for a cracked timber',
        'keeps a caged bird for the deep shafts', 'superstitious about the third gallery',
    ],
    guildmaster: [
        'blackballs apprentices on a whim', 'keeps the guild’s secrets and its debts',
        'sets prices with a raised eyebrow', 'has outlived three rivals and gloats',
        'more politician than craftsman now', 'wears a chain of office worth a house',
    ],
    elder: [
        'remembers the last hard winter, all of them', 'settles disputes before they reach blows',
        'keeps the village’s few records in their head', 'suspicious of anyone from over the ridge',
        'planted half the trees on the green', 'outlived two spouses and every rival',
    ],
    shopkeeper: [
        'weighs a thumb on the scale for strangers', 'knows the worth of everything on the shelf',
        'keeps the good stock behind the counter', 'never short of a rumor with the change',
        'trusts credit to no one twice', 'dusts the display while sizing you up',
        'haggles for sport as much as coin', 'has a drawer that only opens for regulars',
    ],
    householder: [
        'keeps the doorstep swept and the latch oiled', 'suspicious of anything after dark',
        'owes a small debt and frets it nightly', 'proud of a garden the size of a table',
        'first to hear a neighbor’s quarrel, last to repeat it', 'saves candle-ends out of old habit',
        'quicker to feed you than to trust you',
    ],
    maid: [
        'sees everything, says nothing, forgets less', 'hums at her work and misses no dust',
        'saves the gossip for the well at dawn', 'sweet to guests, sharp with the cook',
        'keeps a sweetheart the master would not approve', 'knows which floorboards betray a step',
    ],
    cook: [
        'guards the spice-box like a dragon', 'tastes everything twice and trusts no palate but her own',
        'feeds the stray dogs off the good scraps', 'louder than the boiling pots',
        'nurses a grudge against the last cook', 'measures salt by the mood of the day',
        'saves the best cut for whoever flatters best',
    ],
    stablehand: [
        'talks to the horses more than the people', 'sleeps in the loft to save the walk',
        'smells of straw and honest work', 'knows every beast’s temper by its ears',
        'skims a little feed-money, means no harm', 'up before the cock and grumbling about it',
    ],
    apprentice: [
        'clumsy with the work, sharp with excuses', 'dreams of a shingle bearing their own name',
        'takes the blame the master won’t', 'sneaks out the back when the coast is clear',
        'earnest to a fault and twice as slow', 'copies the master’s every mannerism',
        'nurses burnt fingers and big ambitions',
    ],
    watchman: [
        'dozes on the slow watch, swears he never does', 'knows every creak the building makes',
        'keeps a flask against the cold, and the boredom', 'quicker with a whistle than a blade',
        'counts the hours by a lamp he never trusts', 'lets small things slide for a small coin',
    ],
    soldier: [
        'polishes kit when there’s nothing to fight', 'owes the whole barracks a round',
        'tells the same war-story three ways', 'first to the mess, last to the drill',
        'homesick for a village half a world off', 'sharpens a blade that’s never drawn blood',
        'gambles away his pay by the second night',
    ],
    guest: [
        'pays on time but tips like a miser', 'keeps odd hours and odder company',
        'travels with more locks than luggage', 'talks of business and names no trade',
        'lingers a day longer than paid for', 'watches the door more than the meal',
    ],
    default: [
        'never forgets a face', 'talks to a cat that answers, they swear',
        'owes money in three towns', 'quicker with a knife than a word',
        'keeps a secret worth killing for', 'laughs at the wrong moments',
        'once soldiered somewhere warmer', 'reads the weather better than the priest',
        'saves the good stock for friends', 'has a limp and a longer memory',
        'trusts the road more than any roof', 'lost everything once and rebuilt quietly',
        'kind to strangers, wary of neighbors', 'always seems to know what you came to ask',
    ],
};
