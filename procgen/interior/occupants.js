/* ------------------------------------------------------------------
 *  Building-interior occupants pass.
 *
 *  assignOccupants(rooms, opts) → { occupants, formerOwner }.
 *
 *  The owner is drawn FIRST and unconditionally, so a given seed yields
 *  the SAME owner whether the building is lived-in, abandoned, or looted
 *  — describe.js can then write «Once kept by …» for the empty ones.
 *  Only lived-in buildings return live `occupants` (owner + household);
 *  abandoned/looted return an empty occupants list but a stable
 *  formerOwner.
 *
 *  Determinism: this pass owns its stream (`${seed}/occupants:${kind}`),
 *  independent of layout/content, so re-rolling names never disturbs
 *  the walls.
 * ------------------------------------------------------------------ */
import { Rng } from '../rng.js';
import { nameFor, RESIDENT_TRAITS } from '../names.js';

/* Owner role for each building kind. */
const OWNER_ROLE = {
    tavern: 'innkeeper', smithy: 'blacksmith', barracks: 'captain',
    caravanserai: 'merchant', mill: 'miller', warehouse: 'harbormaster',
    manor: 'noble', keep: 'castellan', temple: 'priest',
    shop: 'shopkeeper', house: 'householder',
};

/* Household roles by kind (lived-in only); count is capped by size. */
const SECONDARY = {
    tavern: ['cook', 'maid', 'guest', 'guest'],
    manor: ['maid', 'cook', 'stablehand'],
    keep: ['soldier', 'soldier', 'cook'],
    barracks: ['soldier', 'soldier', 'soldier'],
    caravanserai: ['stablehand', 'guest', 'guest', 'cook'],
    temple: ['apprentice'],
    smithy: ['apprentice'],
    mill: ['apprentice'],
    warehouse: ['watchman'],
};

/* Preferred room purpose for a household role. */
const ROLE_ROOM = {
    guest: 'guest room', cook: 'kitchen', stablehand: 'stables',
    soldier: 'bunkroom', watchman: "watchman's nook",
};

const SIZE_COUNT = { small: 1, medium: 2, large: null };  // large → 3-4 (rng)

const idNum = id => parseInt(String(id).replace(/\D/g, ''), 10) || 0;

/**
 * @param {Array} rooms  { id, purpose, tags, ... }
 * @param {object} opts  { kind, size, condition, seed }
 * @returns {{ occupants: Array, formerOwner: {name, role} }}
 */
export function assignOccupants(rooms, opts) {
    const { kind, size = 'medium', condition = 'lived-in', seed } = opts;
    const rng = new Rng(`${seed}/occupants:${kind}`);

    // ---- owner: drawn FIRST, unconditionally (seed-stable across conditions) ----
    const ownerRole = OWNER_ROLE[kind] || 'householder';
    const ownerName = nameFor(rng, 'person');
    const formerOwner = { name: ownerName, role: ownerRole };

    if (condition !== 'lived-in') return { occupants: [], formerOwner };

    // ---- room helpers ----
    const hub = rooms.find(r => (r.tags || []).includes('entrance')) || rooms[0];
    const nonHub = rooms.filter(r => r.id !== (hub && hub.id)).sort((a, b) => idNum(a.id) - idNum(b.id));
    const purposeSlots = {};   // purpose → next round-robin index
    let rr = 0;
    function roomForRole(role) {
        const pref = ROLE_ROOM[role];
        if (pref) {
            const list = rooms.filter(r => r.purpose === pref).sort((a, b) => idNum(a.id) - idNum(b.id));
            if (list.length) {
                const i = purposeSlots[pref] || 0;
                purposeSlots[pref] = i + 1;
                return list[i % list.length].id;
            }
        }
        if (nonHub.length) return nonHub[rr++ % nonHub.length].id;
        return hub ? hub.id : (rooms[0] && rooms[0].id);
    }
    const traitFor = role => rng.pick(RESIDENT_TRAITS[role] || RESIDENT_TRAITS.default);

    // ---- owner room: the hub for tavern/shop/smithy; else an owner-style room ----
    let ownerRoom = hub;
    if (!(kind === 'tavern' || kind === 'shop' || kind === 'smithy')) {
        const m = rooms.find(r => /keeper's|captain's|owner's|lord's|master/.test(r.purpose || ''));
        if (m) ownerRoom = m;
    }

    const occupants = [];
    let n = 0;
    occupants.push({
        id: 'oc' + (++n), kind: 'occupant', name: ownerName,
        purpose: ownerRole, room: ownerRoom ? ownerRoom.id : undefined, notes: traitFor(ownerRole),
    });

    // ---- household (secondary) occupants ----
    let count = SIZE_COUNT[size];
    if (count === null || count === undefined) count = rng.int(3, 4);   // large / unknown
    const roles = kind === 'shop' || kind === 'house'
        ? (rng.chance(0.5) ? ['apprentice', 'maid'] : ['maid', 'apprentice'])
        : (SECONDARY[kind] || ['maid']);
    for (let i = 0; i < count; i++) {
        const role = roles[i % roles.length];
        occupants.push({
            id: 'oc' + (++n), kind: 'occupant', name: nameFor(rng, 'person'),
            purpose: role, room: roomForRole(role), notes: traitFor(role),
        });
    }

    return { occupants, formerOwner };
}
