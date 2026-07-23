[English](README.md) | [Русский](README_ru.md)

# Map Generators — SillyTavern extension

Embed [Watabou](https://watabou.itch.io/)'s procedural map generators inside
SillyTavern, keep a per-chat library of maps, and feed a text description of
each map to the AI so it understands and remembers the places in your story.

## Installation

In SillyTavern, go to **Extensions → Install extension** and paste this repo URL:

```
https://github.com/XaYS-101/Map-generators-Silly-Tavern
```

## Features

- **Built-in local generators (since 1.1)**: five fully offline procedural
  generators written for this extension (no iframe, no internet).
  **Dungeon** (BSP rooms & corridors, or cellular-automata caves),
  **Region** (staged pipeline: hydrology, climate biomes, settlements, roads),
  **World** (whole-planet map: plate tectonics, climate belts, nations),
  **Town / Village** (road network, buildings, landmarks, optional walls) and
  **Building Interior** (floor plans: tavern, house, shop, temple, manor, keep).
  Every local map is deterministic from its seed + options and produces all
  three artifacts at once:
  - a hand-drawn parchment-style PNG rendered on a local canvas. Download
    it, attach it to the chat, or caption it with a vision model, with no manual
    export/import round-trip;
  - a structured JSON model (rooms, connections, biomes, landmarks),
    downloadable from the editor;
  - an auto-generated text description for the AI (compass directions,
    room-by-room exits and features) that plugs straight into the
    lorebook/injection memory below. Rerolling a map updates the description
    automatically unless you've edited it by hand.
  Interiors have realistic circulation (a hallway behind the tavern common
  room, a central corridor in manors and keeps), so you never walk through the
  kitchen to reach a guest room. Only the seed, options and a small thumbnail
  are stored in chat metadata; the full map is regenerated on demand.
- **The local dungeon, in detail**: themes change the layout itself, not just
  the names. A crypt is a warren of small chambers, a stronghold has large
  connected halls, a sewer gets long flooded galleries, ruins get collapsed
  walls and rubble. Rooms come in shapes picked to fit the theme (rotundas,
  octagons, cross-shaped chapels, columned halls), neighbouring rooms open
  into each other through real doors, and walls are drawn with clean chamfered
  corners instead of pixel staircases. Every room is filled from a content
  database: themed enemies, loot, traps, hazards, room dressing, and the
  occasional plot clue, so the AI reads about a place where something is going
  on, not a bare floor plan. Most maps hide one locked door or gate. The key
  waits in another chamber on your side of the lock, and the map marks both
  the lock (a dark barred door) and any secret doors (a dashed "S"). Small ink
  icons under each room number show what's inside: monster, treasure, trap,
  key. The Map icons checkbox turns them off if you want a clean map for your
  players. A **Danger** setting (safe to deadly) decides how occupied and
  lethal the place is, and a free **Tags** field biases the contents
  (`undead, treasure, deadly, empty`) or reshapes the dungeon itself
  (`den`, `huge`, `small`, `large`, `loops`, `linear`).
- **The local region, in detail** (reworked in 1.7.0): the region generator now
  runs as a staged pipeline instead of a single heightmap pass. Realistic
  **hydrology** carves lakes and rivers that widen as they flow downstream and
  fan out into deltas at the coast. A **climate** model (cold / temperate / hot)
  combined with elevation and moisture paints **16 biomes**, including tundra,
  taiga, savanna, badlands, volcanic ashland and blight. A **World flavor**
  preset reshapes the whole map — `normal`, `wasteland`, `volcanic` or
  `blighted` — so you can roll a green frontier or a scorched wasteland from the
  same seed. Roads are laid with terrain-aware A* pathfinding that prefers
  gentle ground and crosses rivers only at **bridges or fords**. A **Rivers**
  control (dry / normal / wet) and a **map size** (small / medium / large)
  round out the options.
- **The local world, in detail** (new in 1.8.0): a whole-planet generator built
  on **plate tectonics** — drifting plates raise mountain ranges at collisions
  and open oceans at rifts. A **planetary climate** model lays down latitude
  temperature belts with **polar ice caps**, deserts in the rain shadows and
  rainforests at the equator (an **iceage / temperate / hot** control shifts the
  whole climate, and a **Seas** slider sets how much of the surface is ocean).
  The land is carved into **nations** with drawn **borders, cultures and
  relations**, linked by **trade routes and sea lanes**, and dotted with
  **wonders**. **Ancient** worlds are seeded with the **ruins of fallen
  empires**. Controls: continents (pangea / continents / archipelago /
  shattered), seas, size, climate, nations (few / some / many), world age
  (young / ancient) and rivers. From a saved world you can **zoom into any
  spot**: open the world in the editor and click **Region from this spot…**,
  then click a point on the map to spawn a matching **Region (local)** map for
  that cell, saved straight into the chat library.
- **Floating viewer beside the chat**: a draggable, resizable window (touch &
  mouse; drag it by its toolbar or the grip strip) that keeps a map next to
  the chat so you see both at once. Open it from the wand menu (🗺️). You can
  also enable a second independent viewer to show, say, a city map and a
  dungeon side by side (closing it with ✕ turns the setting off again).
  There's also a full-screen library/editor (`/map`).
- **Online generators**: Medieval Fantasy City, Village, One Page Dungeon,
  Perilous Shores, Dwellings (live in the panel via `?seed=`), plus Taverns,
  Urban Places, Icons, Tiny Pubs, Constellations, the Watabou Sigil Generator
  and Histomap (itch.io tools that open in a new tab). You can also add any
  generator by URL via the **Custom URL…** tile in the picker.
- **Save & restore**: a map's full state is its URL (`?seed=…&tags=…`), stored
  in the chat's metadata, so it survives reloads. Keep as many maps as you like,
  including several from the same generator.
- **Make the AI remember a map**: per map, choose one of:
  - **Chat lorebook**: writes a World Info entry bound to the current chat,
    triggered by the map's name (token-efficient).
  - **Prompt injection**: always present in context (like an Author's Note),
    via `setExtensionPrompt`.
- **Four ways to describe a map** (all editable):
  1. **Import JSON**: drop in a generator's exported JSON; City / Perilous Shores
     get a structured summary, others a generic extraction (never truncated).
  2. **Import Markdown**: drop in the One Page Dungeon markdown (room text) etc.
  3. **AI vision**: set a PNG preview and let a multimodal model caption it.
  4. **Manual text**.
- **Preview into chat**: optionally attach the PNG preview to the last message
  (also makes it visible to a vision model).
- EN / RU UI, mobile-friendly.

## Usage

1. Open the library: the **`/map`** slash command, or the **Open Map Library**
   button in `Extensions → Map Generators`.
2. Click **+ New map**, pick a generator (local ones are grouped first), tweak
   seed/options in the popup with a live preview, then **Save this map**.
3. In the editor, the description is pre-filled for local maps (or
   write/import/caption one), then pick an **AI memory** mode. That's what the
   model reads.
4. To reroll a saved local map, open it in the editor and click **Open
   generator**. The description, preview and lorebook entry stay in sync.

> Cross-origin note (online generators only): the extension can't read state
> back out of the generator iframe, so its own seed/size/tags controls drive
> the map. If you used the generator's own buttons, paste the resulting URL
> into the *"…or paste a map URL"* field.

## Project layout

```
index.js     entry point (bootstrap)
core/        settings, i18n, per-chat store, AI memory, files, vision, registry
ui/          popups, map editor, library, floating panels, settings drawer
procgen/     local generators: RNG, algorithms, canvas renderer, describer
```

## Attribution & licensing

The local generators (`procgen/`) are original code in this repository (MIT).
The Watabou attribution below does not apply to maps they produce.

Online maps are generated by **Watabou**'s tools, hosted on `watabou.github.io`.
Generated maps are free to use, copy and modify (attribution appreciated). This
extension only frames the public generators and does not redistribute their
code. Please credit Watabou and consider supporting the tools on
[itch.io](https://watabou.itch.io/).

## Notes

- The `taverns` and `urban` generator base URLs should be confirmed against the
  current itch.io "Run game" host on first use; the others are verified.
- itch.io tools (Taverns, Urban, Icons, Tiny Pubs, Constellations, Sigil,
  Histomap) open in a new tab; they have no seed/URL state and can't be framed.
- AI vision requires a multimodal model configured in SillyTavern.
- Deleting a map or disabling its memory only *disables* its lorebook entry
  (never deletes it), so nothing is lost by accident.

## Changed in 1.11.0

- **Dungeons overhauled again.** Dungeons can now descend up to three levels
  (new **Depth** param, or the `deep` tag) — each level down is darker and
  deadlier, stairs link the floors, and the bottom may break through into
  natural caves. Dungeons are inhabited *sometimes*: a named boss in a lair
  ("Norshaw the Hollow, a necromancer, laired in The Depths"), rival factions
  holding territories with war, truce or siege between them, prisoners with
  their own wants — none of it guaranteed, every seed rolls its own. Places
  now carry a history (who built it, how it fell, what rules it now — full,
  fragmentary or lost), traps show a telltale sign for observant players, and
  vaults hold itemized hoards. The `den`/`huge` sizes joined the size select.
  Existing seeds keep their exact top-level layout; deeper levels extend it.

## Changed in 1.10.0

- **Building interiors overhauled.** Eleven building types (adding smithy,
  barracks, warehouse, caravanserai with an open courtyard, and mill), multiple
  floors — cellars and upper storeys drawn side by side with stairs linking
  them — plus new **Size**, **Wealth** and **Condition** params. Interiors are
  now inhabited: a named owner and household with quirks, typed room content
  (furnishings by wealth, `[hidden]` caches, locked doors whose keys hang
  somewhere findable, no softlocks), and condition traces — warm hearth embers
  in a lived-in house, dust sheets in an abandoned one, forced doors after a
  looting — capped by a one-line story hook per building. Regenerated interiors
  will look different; saved descriptions and thumbnails are untouched.

## Changed in 1.9.0

- **Town / Village overhauled.** A staged pipeline with real water data (no more
  buildings in the surf), bridges where main roads cross the river, hillside
  towns with contour-hugging streets and a citadel, crossroads towns grown
  around through-roads, and functional quarters driven by a new
  **Specialization** param (farming / trade / fishing / mining / garrison /
  temple): docks with piers, spoil heaps, barracks yards, temple closes,
  caravanserais, fields and orchards outside the walls. New **Wealth**
  (building size, stone vs wood, noble quarter or slums), **Terrain** and
  **Condition** (thriving / declining / ruined — boarded-up houses, rubble,
  breached walls) params. Landmarks now have names and notable residents
  ("The Gilded Kraken, kept by Marga — never forgets a debt") that flow into
  the AI description. Regenerated town maps will look different; saved
  descriptions and thumbnails are untouched.

## Changed in 1.8.0

- **New local World generator.** A whole-planet map built on plate tectonics,
  with a planetary climate model (polar ice caps, deserts, rainforests),
  nations with borders / cultures / relations, trade routes and sea lanes,
  wonders, and — for ancient worlds — the ruins of fallen empires.
- **World → region zoom.** Open a saved world in the editor and click **Region
  from this spot…**, then click a point on the map to generate a matching
  **Region (local)** map for that world cell, added to the chat library.
- The **Region** generator is unchanged from 1.7.0.

## Changed in 1.7.0

- The local **Region** generator was overhauled (new staged pipeline). Seeds now
  feed the new hydrology/climate/roads pipeline, so **regenerating an existing
  region map will produce a different-looking map** than in earlier versions.
  Your **saved descriptions and thumbnails are untouched** — nothing is
  rewritten until you actually reroll a map.
- **Region and World are now split.** This generator is just **Region (local)**
  (it was labelled *Region / World* before). A separate large-scale **World**
  generator is planned for a future version.

## License

MIT
