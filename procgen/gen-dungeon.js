/* ------------------------------------------------------------------
 *  Dungeon generator — orchestrator.
 *
 *  Pipeline: buildLevels (1–3 stacked floors of geometry + purposes +
 *  stairs) → inhabitants + story (parallel agents, defensive) → per-
 *  level content pass (encounters / loot / traps / hazards / dressing /
 *  hooks) → flatten notes → dungeon name → assemble the model.
 *
 *  Stream discipline (see dungeon/levels.js for the full note): the
 *  LAYOUT streams key on size/theme/density(+layout tags); CONTENT keys
 *  additionally on danger/tags; the NAME is drawn last from its own
 *  stream.  Level 0 uses the ORIGINAL (pre-multi-level) stream keys so
 *  every existing seed's top floor stays byte-identical; deeper levels
 *  use L-suffixed variants.
 *
 *  Tile codes: '#' wall  '.' floor  '+' door  '<' entrance  '>' exit
 *              '~' water (sewer channels / flooded basins)
 * ------------------------------------------------------------------ */
import { Rng } from './rng.js';
import { makeEnvelope, compass, rleEncode } from './schema.js';
import { nameFor } from './names.js';
import { populateDungeon } from './content/dungeon.js';
import { buildLevels, levelDanger, tagsOf } from './dungeon/levels.js';

/* Inhabitants + story live in sibling modules owned by another agent;
 * they may land AFTER this file. Import defensively so the generator
 * still produces a valid (if unpopulated) dungeon in the meantime. */
let assignInhabitants = null, buildStory = null;
try { assignInhabitants = (await import('./dungeon/inhabitants.js')).assignInhabitants ?? null; } catch { /* not landed yet */ }
try { buildStory = (await import('./dungeon/story.js')).buildStory ?? null; } catch { /* not landed yet */ }

export function generateDungeon(seed, params = {}) {
    const p = { size: 'm', theme: 'crypt', density: 0.5, secrets: true, danger: 'medium', tags: '', depth: 1, ...params };
    const tagSet = tagsOf(p);
    const model = makeEnvelope('dungeon', seed, p);

    // ---- geometry: 1–3 floors + stairs + global ids ----
    const { floors, roomsAll, stairs, stairEdges, W, H, depth } = buildLevels(seed, p, tagSet);
    model.size = { w: W, h: H, unit: 'tile' };
    // the inhabitants/story contract addresses rooms by entity id
    for (const r of roomsAll) r.id = r.globalId;

    // global-id view of the door graph (inhabitants need it for faction
    // territories and prisoner placement; assemble reuses it verbatim)
    const globalEdges = [];
    for (const f of floors) {
        for (const e of f.edges) {
            const out = {
                a: 'r' + (f.offset + e.a + 1),
                b: 'r' + (f.offset + e.b + 1),
                kind: e.kind,
                dir: compass(f.rooms[e.a].cx, f.rooms[e.a].cy, f.rooms[e.b].cx, f.rooms[e.b].cy),
            };
            if (e.locked) out.locked = true;
            if (e.at) out.at = e.at;
            if (e.at2) out.at2 = e.at2;
            globalEdges.push(out);
        }
    }

    // ---- inhabitants + story (parallel agents; defensive) ----
    let inhab = null, story = null;
    try { if (assignInhabitants) inhab = assignInhabitants({ floors, roomsAll, stairs, stairEdges, edges: globalEdges, p, seed, tagSet, depth }); }
    catch (err) { console.error('[MapGenerators] dungeon inhabitants failed', err); inhab = null; }
    try { if (buildStory) story = buildStory({ roomsAll, p, seed, tagSet, boss: inhab?.boss }); }
    catch (err) { console.error('[MapGenerators] dungeon story failed', err); story = null; }

    // ---- content pass, per level ----
    const tagsStr = [...tagSet].sort().join(',');
    for (const f of floors) {
        const theme = f.theme;
        const dangerForLevel = f.level === 0 ? p.danger : levelDanger(p.danger, f.level);
        // Level 0 keeps the LEGACY content stream key (identity gate);
        // deeper levels get an L-suffixed, danger-scaled key.
        const contentKey = f.level === 0
            ? `${seed}/content:${theme}:${p.danger}:${tagsStr}`
            : `${seed}/content:L${f.level}:${theme}:${dangerForLevel}:${tagsStr}`;
        const contentRng = new Rng(contentKey);
        const offset = f.offset;
        const ctx = {
            theme, danger: dangerForLevel, tags: tagSet,
            entranceI: f.entranceI, exitI: f.farI, secretI: f.secretI,
            degree: f.deg, lock: f.lock,
            // additive fields (content agent extends behavior on these):
            level: f.level, depth,
            globalNum: (i) => offset + i + 1,   // local room index → global room number
            inhabitants: inhab, story,
        };
        try { populateDungeon(f.rooms, ctx, contentRng); }
        catch (err) {
            console.error('[MapGenerators] dungeon content failed', err);
            for (const r of f.rooms) if (r.content == null) r.content = {};
        }
    }

    // ---- flatten atmosphere into the legacy `notes` string ----
    const bottomLevel = floors[floors.length - 1].level;
    for (const f of floors) {
        for (const r of f.rooms) {
            const parts = [...(r.content?.dressing || [])];
            if (r.content?.hazard) parts.push(r.content.hazard);
            if (r.flooded) parts.push('flooded with murky, waist-deep water');
            // the far room hosts the stairs down — except on the bottom floor
            // of a multi-level dungeon, where nothing lies below (depth-1
            // keeps the legacy note: its '>' is the way out/down of the map)
            const hasStairsDown = depth === 1 || f.level < bottomLevel;
            if (hasStairsDown && r.i === f.farI && f.farI !== f.entranceI) parts.push('a stair leads down into darkness');
            // story echoes live on the room object; content dressing may have
            // already absorbed one — don't repeat it
            if (r.storyEcho && !parts.includes(r.storyEcho)) parts.push(r.storyEcho);
            r.notes = parts.join('; ');
        }
    }

    // ---- name (drawn last, legacy stream) ----
    const nameRng = new Rng(`${seed}/names`);
    model.name = nameFor(nameRng, 'dungeon');

    // ---- assemble: rooms → doors → stairs → inhabitants → story ----
    for (const r of roomsAll) {
        const ent = {
            id: r.globalId, kind: 'room', level: r.level,
            name: r.name, purpose: r.purpose,
            x: r.x, y: r.y, w: r.w, h: r.h,
            tags: r.tags, notes: r.notes, content: r.content,
        };
        if (r.shape && r.shape !== 'rect') ent.shape = r.shape;
        model.entities.push(ent);
    }
    let dn = 0;
    for (const f of floors) {
        for (const [x, y] of f.doors) {
            model.entities.push({ id: 'd' + (++dn), kind: 'door', level: f.level, x, y });
        }
    }
    for (const s of stairs) model.entities.push(s);
    if (inhab?.entities) for (const e of inhab.entities) model.entities.push(e);
    if (story?.entities) for (const e of story.entities) model.entities.push(e);

    // ---- edges: remapped per-level edges (global ids) + stair edges ----
    model.edges = [...globalEdges, ...stairEdges];

    // ---- layers: one grid per floor ----
    model.layers.floors = floors.map(f => ({
        level: f.level, label: f.label,
        grid: rleEncode(f.grid.map(row => row.join(''))),
        w: W, h: H,
    }));
    return model;
}
