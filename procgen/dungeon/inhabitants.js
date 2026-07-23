/* ------------------------------------------------------------------
 *  Dungeon inhabitants pass.
 *
 *  assignInhabitants(ctx) → { boss, factions, prisoners, entities }.
 *
 *  Three layers — boss, factions, prisoners — each drawn from its OWN
 *  independent sub-stream (`.sub('boss')`, `.sub('factions')`,
 *  `.sub('prisoners')`), so the presence of any one layer is a pure
 *  function of the seed regardless of whether the others fired. The pass
 *  MUTATES the shared room objects the structure agent handed us:
 *    - lair room     : tags.push('lair'), r.lair = true   (keeps 'exit')
 *    - faction rooms : r.faction = facId
 *    - border rooms  : r.borderTrace = true
 *    - prisoner rooms: r.prisoner  = id
 *
 *  Determinism: no Date.now()/Math.random() — every draw comes from the
 *  seeded stream `${seed}/inhabitants:${theme}:${danger}:${sortedTags}`.
 * ------------------------------------------------------------------ */
import { Rng } from '../rng.js';
import { bossName, factionName, BOSS_TRAITS, PRISONER_WANTS, nameFor } from '../names.js';

/* creature-tag → boss kind pool (overrides the layout theme, mirroring
 * content/dungeon.js CREATURE_TAG). Order fixes tag precedence. */
const BOSS_KIND_TAG = {
    undead: ['lich', 'necromancer', 'wight-lord'],
    bandits: ['bandit chief', 'warlord'],
    beasts: ['alpha beast', 'broodmother'],
    vermin: ['swarm-queen'],
    haunted: ['restless shade'],
};
const BOSS_TAG_ORDER = ['undead', 'bandits', 'beasts', 'vermin', 'haunted'];

function bossKindPool(tagSet, theme) {
    for (const t of BOSS_TAG_ORDER) if (tagSet.has(t)) return BOSS_KIND_TAG[t];
    if (theme === 'crypt') return ['lich', 'wight-lord', 'necromancer'];
    if (theme === 'stronghold') return ['warlord', 'mercenary king'];
    return ['cult leader', 'mad hermit-sorcerer'];
}

/* creature theme → the faction's "purpose" word (what they are). */
const FACTION_PURPOSE = {
    undead: 'the restless dead', haunted: 'the restless dead', crypt: 'the restless dead',
    bandits: 'a bandit crew', guards: 'a garrison remnant', stronghold: 'a mercenary company',
    beasts: 'a feral pack', caves: 'a feral pack', vermin: 'a vermin swarm', sewer: 'a vermin swarm',
    ruins: 'a band of squatters',
};
const CREATURE_TAG = ['undead', 'haunted', 'bandits', 'guards', 'beasts', 'vermin'];

function creatureTheme(tagSet, theme) {
    for (const t of CREATURE_TAG) if (tagSet.has(t)) return t;
    return theme;
}

const FACTION_FLAVOR = [
    'holds its ground by force and old grievance',
    'contests every doorway with its rival',
    'has fortified the halls it claims',
    'answers to a captain no one has seen in weeks',
    'takes tribute from anything that passes through',
    'keeps its dead close and its borders closer',
];

const idNum = id => parseInt(String(id).replace(/\D/g, ''), 10) || 0;

/* ---- graph helpers (defensive: edge endpoints may be ids or numbers) ---- */
function buildAdj(roomsAll, edges, stairEdges) {
    const adj = new Map();
    for (const r of roomsAll) adj.set(r.id, []);
    const norm = v => {
        if (adj.has(v)) return v;
        if (adj.has('r' + v)) return 'r' + v;
        if (adj.has(String(v))) return String(v);
        return v;
    };
    const add = (a, b) => {
        a = norm(a); b = norm(b);
        if (adj.has(a) && adj.has(b) && a !== b) { adj.get(a).push(b); adj.get(b).push(a); }
    };
    for (const e of edges) if (e) add(e.a, e.b);
    for (const e of stairEdges) if (e) add(e.a, e.b);
    return adj;
}

function bfsDist(adj, start) {
    const dist = new Map([[start, 0]]);
    const q = [start];
    for (let i = 0; i < q.length; i++) {
        for (const v of adj.get(q[i]) || []) if (!dist.has(v)) { dist.set(v, dist.get(q[i]) + 1); q.push(v); }
    }
    return dist;
}

/** Farthest node in a dist map; deterministic tie → smallest room id. */
function farthest(dist) {
    let best = null, bd = -1;
    for (const [id, d] of dist) {
        if (d > bd || (d === bd && idNum(id) < idNum(best))) { bd = d; best = id; }
    }
    return best;
}

function degreeOf(adj, r) {
    if (adj.has(r.id)) return (adj.get(r.id) || []).length;
    return r.deg ?? 0;
}

/** Lair = the bottom level's 'exit'-tagged room (fallback: its farthest /
 *  highest-id room). The 'exit' tag is KEPT; 'lair' is added alongside. */
function pickLairRoom(roomsAll) {
    if (!roomsAll.length) return null;
    const maxLevel = Math.max(...roomsAll.map(r => r.level ?? 0));
    const bottom = roomsAll.filter(r => (r.level ?? 0) === maxLevel);
    const pool = bottom.length ? bottom : roomsAll;
    return pool.find(r => (r.tags || []).includes('exit'))
        || [...pool].sort((a, b) => idNum(b.id) - idNum(a.id))[0];
}

/**
 * @param {object} ctx { floors, roomsAll, stairs, stairEdges, edges, p, seed, tagSet, depth }
 * @returns {{ boss:object|null, factions:Array, prisoners:Array, entities:Array }}
 */
export function assignInhabitants(ctx) {
    const {
        roomsAll = [], stairEdges = [], p = {}, seed,
        tagSet = new Set(), depth = 1,
    } = ctx;
    const edges = ctx.edges || [];
    const sortedTags = [...tagSet].sort().join(',');
    const rng = new Rng(`${seed}/inhabitants:${p.theme}:${p.danger}:${sortedTags}`);
    const bossRng = rng.sub('boss');
    const facRng = rng.sub('factions');
    const priRng = rng.sub('prisoners');

    const empty = tagSet.has('empty');
    const entities = [];

    /* ---------------- boss ---------------- */
    let boss = null;
    const bossP = Math.min(0.9, 0.5 + (p.danger === 'deadly' ? 0.2 : 0) + (depth >= 2 ? 0.15 : 0));
    const wantBoss = tagSet.has('boss') ? true : empty ? false : bossRng.chance(bossP);
    if (wantBoss && roomsAll.length) {
        const kind = bossRng.pick(bossKindPool(tagSet, p.theme));
        const name = bossName(bossRng, kind);
        const trait = bossRng.pick(BOSS_TRAITS);
        const lair = pickLairRoom(roomsAll);
        if (lair) {
            lair.tags = lair.tags || [];
            if (!lair.tags.includes('lair')) lair.tags.push('lair');
            lair.lair = true;
            boss = { id: 'boss1', kind, name, trait, room: lair.id, level: lair.level ?? 0 };
            entities.push({
                id: 'boss1', kind: 'occupant', level: lair.level ?? 0,
                name, purpose: kind, room: lair.id, notes: trait, tags: ['boss'],
            });
        }
    }

    /* ---------------- factions ---------------- */
    const factions = [];
    if (!empty && roomsAll.length >= 10 && facRng.chance(0.4)) {
        const count = facRng.weighted([[1, 7], [2, 3]]);
        const used = new Set();
        const purposeWord = FACTION_PURPOSE[creatureTheme(tagSet, p.theme)] || 'a warband';
        const adj = buildAdj(roomsAll, edges, stairEdges);
        const claimable = roomsAll.filter(r => !r.lair);
        const byId = arr => [...arr].sort((a, b) => idNum(a.id) - idNum(b.id));

        for (let n = 0; n < count; n++) {
            factions.push({
                id: 'fac' + (n + 1), kind: 'faction', name: factionName(facRng, used),
                purpose: purposeWord, tags: [], rooms: [], notes: facRng.pick(FACTION_FLAVOR),
            });
        }

        if (count === 2) {
            /* split along the graph diameter — nearer end wins each room */
            const entrance = roomsAll.find(r => (r.tags || []).includes('entrance')) || byId(roomsAll)[0];
            const u = farthest(bfsDist(adj, entrance.id));
            const v = farthest(bfsDist(adj, u));
            const dU = bfsDist(adj, u), dV = bfsDist(adj, v);
            const seedIds = [u, v].sort((a, b) => idNum(a) - idNum(b)); // stable tie order
            const owner = new Map();
            for (const r of byId(claimable)) {
                const a = dU.has(r.id) ? dU.get(r.id) : Infinity;
                const b = dV.has(r.id) ? dV.get(r.id) : Infinity;
                let side;
                if (a < b) side = u; else if (b < a) side = v;
                else side = seedIds[0];            // equidistant / unreachable → lower-id seed
                const fi = (side === u) ? (u === seedIds[0] ? 0 : 1) : (v === seedIds[0] ? 0 : 1);
                owner.set(r.id, fi);
                factions[fi].rooms.push(r.id);
                r.faction = factions[fi].id;
            }
            /* border rooms: any claimed room touching the rival faction */
            for (const r of claimable) {
                const mine = owner.get(r.id);
                for (const nb of adj.get(r.id) || []) {
                    if (owner.has(nb) && owner.get(nb) !== mine) { r.borderTrace = true; break; }
                }
            }
            const relation = facRng.weighted([['war', 3], ['truce', 2], ['siege', 2]]);
            factions[0].tags = [relation];
            factions[1].tags = [relation];
        } else {
            /* single faction claims the deeper half (dist from entrance > median) */
            const entrance = roomsAll.find(r => (r.tags || []).includes('entrance')) || byId(roomsAll)[0];
            const dist = bfsDist(adj, entrance.id);
            const ds = byId(claimable).map(r => (dist.has(r.id) ? dist.get(r.id) : 0)).sort((a, b) => a - b);
            const median = ds.length ? ds[ds.length >> 1] : 0;
            for (const r of byId(claimable)) {
                const d = dist.has(r.id) ? dist.get(r.id) : 0;
                if (d > median) { factions[0].rooms.push(r.id); r.faction = factions[0].id; }
            }
        }
        entities.push(...factions.map(f => ({
            id: f.id, kind: 'faction', name: f.name, purpose: f.purpose,
            tags: f.tags, rooms: f.rooms, notes: f.notes,
        })));
    }

    /* ---------------- prisoners ---------------- */
    const prisoners = [];
    if (!empty && priRng.chance(0.3)) {
        const adj = buildAdj(roomsAll, edges, stairEdges);
        const CELL = new Set(['oubliette', 'flooded cell']);
        const cand = roomsAll.filter(r =>
            !r.lair
            && !(r.tags || []).includes('entrance')
            && (degreeOf(adj, r) <= 1 || CELL.has(r.purpose)));
        const KINDS = ['prisoner', 'hermit', 'trapped merchant', 'lost scholar'];
        const want = priRng.int(1, 2);
        const chosen = priRng.shuffle([...cand].sort((a, b) => idNum(a.id) - idNum(b.id))).slice(0, want);
        chosen.forEach((r, i) => {
            const id = 'pr' + (i + 1);
            const kind = priRng.pick(KINDS);
            const name = nameFor(priRng, 'person');
            const notes = priRng.pick(PRISONER_WANTS);
            r.prisoner = id;
            prisoners.push({ id, kind, name, room: r.id, level: r.level ?? 0, notes });
            entities.push({
                id, kind: 'occupant', level: r.level ?? 0,
                name, purpose: kind, room: r.id, notes,
            });
        });
    }

    return { boss, factions, prisoners, entities };
}
