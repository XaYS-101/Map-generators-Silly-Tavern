/* ------------------------------------------------------------------
 *  Town stage 6: life — establishment names & notable residents.
 *
 *  Consumes ONLY the NAMES stream (ctx.nameRng), visiting landmark
 *  buildings in ctx.buildings array order. For each landmark we draw
 *  its establishment name (some kinds stay unnamed / descriptive) then
 *  its resident (name + trait); structures with no keeper get none.
 *  The town name is the LAST draw, so appending residents never
 *  reshuffles the settlement's own title.
 * ------------------------------------------------------------------ */
import {
    nameFor, word, deityName,
    GUILD_CRAFTS, CARAVANSERAI_ADJ, CITADEL_WORD, RESIDENT_TRAITS,
} from '../names.js';

/* Role for each people-run landmark kind; kinds absent here (well outside
 * a village, drill yard, and unknown structures) get no resident. */
const ROLE_BY_KIND = {
    'tavern': 'innkeeper',
    'gatehouse inn': 'innkeeper',
    'caravanserai': 'merchant',
    'smithy': 'blacksmith',
    'temple': 'priest',
    'shrine': 'priest',
    'cloister': 'abbot',
    'manor': 'noble',
    'citadel': 'castellan',
    'barracks': 'captain',
    'mill': 'miller',
    'granary': 'reeve',
    'warehouse': 'harbormaster',
    'market': 'merchant',
    'fish market': 'fishmonger',
    'ore works': 'mine foreman',
    'stables': 'stablemaster',
    'guildhall': 'guildmaster',
    'temple guildhall': 'guildmaster',
};

/** Establishment name for a landmark (null → descriptive/unnamed). */
function landmarkName(rng, kind) {
    switch (kind) {
        case 'tavern':
        case 'gatehouse inn':
            return nameFor(rng, 'tavern');
        case 'caravanserai':
            return rng.chance(0.5)
                ? nameFor(rng, 'tavern')
                : `The ${rng.pick(CARAVANSERAI_ADJ)} Caravanserai`;
        case 'temple':
            return `Temple of ${deityName(rng)}`;
        case 'shrine':
            return `Shrine of ${deityName(rng)}`;
        case 'cloister':
            return `Cloister of ${deityName(rng)}`;
        case 'smithy':
            return `${nameFor(rng, 'person')}'s Forge`;
        case 'guildhall':
            return `${rng.pick(GUILD_CRAFTS)} Guildhall`;
        case 'manor':
            return `${nameFor(rng, 'person')} Manor`;
        case 'citadel':
            return rng.chance(0.5)
                ? `Castle ${word(rng)}`
                : `The ${rng.pick(CITADEL_WORD)} Keep`;
        default:
            // fish market, market, warehouse, granary, mill, barracks,
            // ore works, stables, well, drill yard, pilgrim houses… → descriptive.
            return null;
    }
}

/** Role for a landmark kind, honoring the village-only well elder. */
function landmarkRole(kind, size) {
    if (kind === 'drill yard') return null;
    if (kind === 'well') return size === 'village' ? 'elder' : null;
    return ROLE_BY_KIND[kind] || null;
}

export function buildLife(ctx) {
    const rng = ctx.nameRng;
    const size = ctx.p?.size;
    const residents = [];

    for (const b of ctx.buildings) {
        if (!b.landmark) continue;
        const kind = b.landmark;

        // 1) name (some kinds draw nothing, staying descriptive)
        b.name = landmarkName(rng, kind);

        // 2) resident (name + trait) for people-run landmarks
        const role = landmarkRole(kind, size);
        if (role) {
            const pool = RESIDENT_TRAITS[role] || RESIDENT_TRAITS.default;
            const resident = {
                name: nameFor(rng, 'person'),
                role,
                trait: rng.pick(pool),
            };
            b.resident = resident;
            residents.push(resident);
        } else {
            b.resident = null;
        }
    }

    // 3) town name — the LAST NAMES draw.
    ctx.townName = nameFor(rng, size === 'village' ? 'village' : 'city');
    ctx.residents = residents;
}
