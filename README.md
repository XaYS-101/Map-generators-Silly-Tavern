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

- **Built-in local generators (since 1.1)**: four fully offline procedural
  generators written for this extension (no iframe, no internet).
  **Dungeon** (BSP rooms & corridors, or cellular-automata caves),
  **Region / World** (noise heightmap into biomes, rivers, settlements, roads),
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

## License

MIT
