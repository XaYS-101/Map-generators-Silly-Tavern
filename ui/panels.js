/* ------------------------------------------------------------------
 *  Docked floating viewers (map beside the chat). Two INDEPENDENT
 *  panels (A and B) share one factory; each floats over the character
 *  chat (not bound to any message) and is dragged via our own
 *  Pointer-Events handler (works on touch + mouse), with position
 *  persisted in settings.
 * ------------------------------------------------------------------ */
import { saveSettingsDebounced } from '../../../../../script.js';

import { defFor, buildUrl, randomSeed } from '../core/generators.js';
import * as Local from '../procgen/index.js';
import { t } from '../core/i18n.js';
import { getSettings, toast } from '../core/settings.js';
import { getChatMaps, persistChat } from '../core/store.js';
import { applyMemory } from '../core/memory.js';
import { openMapEditor } from './editor.js';
import { openLibrary } from './library.js';
import { createNewMap } from './popups.js';
import { insertMapLink, openExport } from './actions.js';

export function panelState(key) {
    const s = getSettings();
    if (!s.panels) s.panels = { a: { open: false, mapId: null }, b: { open: false, mapId: null } };
    if (!s.panels[key]) s.panels[key] = { open: false, mapId: null };
    return s.panels[key];
}

/* --- geometry: our own Pointer-Events drag (ST's dragElement is mouse-only,
       so it does NOT work on touch screens). Position is persisted in
       settings so it survives reloads on every device. --- */
function saveRect(key, el) {
    const r = el.getBoundingClientRect();
    panelState(key).rect = { left: Math.round(r.left), top: Math.round(r.top), width: el.offsetWidth, height: el.offsetHeight };
    saveSettingsDebounced();
}
function applyRect(key, el) {
    const rect = panelState(key).rect;
    if (!rect) return;
    el.style.right = 'auto';
    el.style.left = `${rect.left || 0}px`;
    el.style.top = `${rect.top || 0}px`;
    if (rect.width) el.style.width = `${rect.width}px`;
    if (rect.height) el.style.height = `${rect.height}px`;
}
function applyMax(key, el) {
    el.classList.toggle('mg-maximized', !!panelState(key).maximized);
}
function toggleMax(key, el) {
    panelState(key).maximized = !panelState(key).maximized;
    saveSettingsDebounced();
    applyMax(key, el);
}
/** Make a panel draggable by its handle via Pointer Events (mouse + touch). */
function makeMovable(el, handle, key) {
    let sx = 0, sy = 0, sl = 0, st = 0, dragging = false;
    handle.style.touchAction = 'none';   // stop the page scrolling while dragging
    handle.addEventListener('pointerdown', (e) => {
        if (panelState(key).maximized) return;  // don't drag while maximized
        dragging = true;
        const r = el.getBoundingClientRect();
        sx = e.clientX; sy = e.clientY; sl = r.left; st = r.top;
        el.style.right = 'auto'; el.style.left = `${r.left}px`; el.style.top = `${r.top}px`;
        try { handle.setPointerCapture(e.pointerId); } catch { /* noop */ }
        e.preventDefault();
    });
    handle.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        let nl = sl + (e.clientX - sx);
        let nt = st + (e.clientY - sy);
        nl = Math.max(0, Math.min(nl, window.innerWidth - 60));
        nt = Math.max(0, Math.min(nt, window.innerHeight - 30));
        el.style.left = `${nl}px`; el.style.top = `${nt}px`;
    });
    const end = (e) => {
        if (!dragging) return;
        dragging = false;
        try { handle.releasePointerCapture(e.pointerId); } catch { /* noop */ }
        saveRect(key, el);
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
}

function createPanel(cfg) {
    // cfg = { key:'a'|'b', id:'mapGenPanel'|'mapGenPanel2' }
    const sel = `#${cfg.id}`;
    let built = false;

    function activeMap() {
        const maps = getChatMaps();
        if (!maps.length) return null;
        const id = panelState(cfg.key).mapId;
        return maps.find(m => m.id === id) || maps[0];
    }

    function renderBody() {
        const $body = $(`${sel} .mg-panel-body`);
        if (!$body.length) return;
        $body.empty();
        const map = activeMap();
        if (!map) { $body.append($(`<p class="mg-empty">${t('panel_empty')}</p>`)); return; }
        const def = defFor(map);
        if (def.embed === 'local') {
            const src = Local.getRenderDataUrl(map);
            $body.append($('<img class="mg-localimg" alt="map" />').attr('src', src || ''));
        } else if (def.embed === 'itch') {
            $body.append($(`<div class="mg-itchcard"><p>${t('itch_note')}</p>
                <a class="menu_button" target="_blank" rel="noopener" href="${map.url}">${t('gen_open_new')}</a></div>`));
        } else {
            $body.append($(`<iframe class="mg-frame" referrerpolicy="no-referrer" src="${map.url}"></iframe>`));
        }
    }

    function refreshSelect() {
        const $s = $(`${sel} .mg-panel-select`);
        if (!$s.length) return;
        const maps = getChatMaps();
        const active = activeMap();
        $s.empty();
        if (!maps.length) { $s.append($(`<option>${t('panel_empty')}</option>`)); return; }
        for (const m of maps) {
            const o = $(`<option></option>`).val(m.id).text(m.title);
            if (active && m.id === active.id) o.prop('selected', true);
            $s.append(o);
        }
    }

    // Only render a panel that is actually open — avoids loading the
    // iframe of a hidden/closed/disabled viewer on every chat change.
    function render() {
        if (!built || !panelState(cfg.key).open) return;
        refreshSelect();
        renderBody();
    }

    function build() {
        if (built || !$('#movingDivs').length) return;
        const $panel = $(`
            <div id="${cfg.id}" class="drawer-content flexGap5 mg-panel" style="display:none">
                <div id="${cfg.id}header" class="fa-fw fa-solid fa-grip drag-grabber"></div>
                <div class="mg-panel-bar">
                    <select class="text_pole mg-panel-select"></select>
                    <button class="menu_button mg-panel-new" title="${t('lib_new')}">＋</button>
                    <button class="menu_button mg-panel-rand" title="${t('gen_random')}">🎲</button>
                    <button class="menu_button mg-panel-max" title="${t('panel_max')}">⛶</button>
                    <button class="menu_button mg-panel-close" title="${t('panel_close')}">✕</button>
                </div>
                <div class="mg-panel-body"></div>
                <div class="mg-panel-actions">
                    <button class="menu_button mg-panel-link" title="${t('insert_link')}">🔗</button>
                    <button class="menu_button mg-panel-export" title="${t('open_export')}">⬇</button>
                    <button class="menu_button mg-panel-edit" title="${t('col_edit')}">✎</button>
                    <button class="menu_button mg-panel-full" title="${t('open_library')}">⤢</button>
                </div>
            </div>`);
        $('#movingDivs').append($panel);
        const el = $panel[0];
        const grabber = $panel.find('.drag-grabber')[0];
        makeMovable(el, grabber, cfg.key);   // touch + mouse drag
        applyRect(cfg.key, el);
        applyMax(cfg.key, el);

        // Persist manual resizing (CSS `resize: both`) — but not while
        // maximized (that geometry must not overwrite the saved rect).
        try {
            new ResizeObserver(() => {
                if (panelState(cfg.key).open && !panelState(cfg.key).maximized) saveRect(cfg.key, el);
            }).observe(el);
        } catch { /* ResizeObserver unsupported — drag still persists size */ }

        $panel.find('.mg-panel-max').on('click', () => toggleMax(cfg.key, el));
        $panel.find('.mg-panel-select').on('change', function () {
            panelState(cfg.key).mapId = $(this).val(); saveSettingsDebounced();
            renderBody();
        });
        $panel.find('.mg-panel-new').on('click', async () => {
            const map = await createNewMap();
            if (!map) return;
            // mirror the library flow: editor pushes the map on save → no orphan on cancel
            if (await openMapEditor(map, { isNew: true })) {
                panelState(cfg.key).mapId = map.id; saveSettingsDebounced();
                renderAllPanels();
            }
        });
        $panel.find('.mg-panel-rand').on('click', async () => {
            const map = activeMap();
            if (!map) return;
            const def = defFor(map);
            if (def.embed === 'local') {
                map.seed = randomSeed();
                map.thumbnail = Local.getThumbDataUrl(map);
                if (map.descSource === 'local') {
                    map.description = Local.describeMap(map);
                    // keep the lorebook entry / injection in sync with the new map
                    if (map.memory?.mode && map.memory.mode !== 'none') {
                        try { await applyMemory(map, { quiet: true }); } catch (e) { console.error('[MapGenerators] reroll memory sync failed', e); }
                    }
                }
                persistChat();
                renderBody();
                return;
            }
            if (def.embed !== 'gh' || !def.seedable) { toast(t('no_seed')); return; }
            map.seed = randomSeed();
            map.url = buildUrl(map.generator, map.seed, map.params);
            persistChat();
            renderBody();
        });
        $panel.find('.mg-panel-close').on('click', () => toggle(false));
        $panel.find('.mg-panel-link').on('click', () => insertMapLink(activeMap()));
        $panel.find('.mg-panel-export').on('click', () => openExport(activeMap()));
        $panel.find('.mg-panel-edit').on('click', async () => {
            const map = activeMap();
            if (map && await openMapEditor(map)) render();
        });
        $panel.find('.mg-panel-full').on('click', openLibrary);
        built = true;
    }

    function toggle(forceOpen) {
        build();
        if (!built) return;
        const st = panelState(cfg.key);
        const open = (forceOpen === undefined) ? !st.open : forceOpen;
        st.open = open;
        saveSettingsDebounced();
        $(sel).toggle(open);
        if (open) { applyRect(cfg.key, $(sel)[0]); applyMax(cfg.key, $(sel)[0]); render(); }
    }

    return { cfg, build, render, toggle, get built() { return built; } };
}

export const PANELS = {
    a: createPanel({ key: 'a', id: 'mapGenPanel' }),
    b: createPanel({ key: 'b', id: 'mapGenPanel2' }),
};

export function renderAllPanels() { for (const p of Object.values(PANELS)) p.render(); }
export function buildAllPanels() { for (const p of Object.values(PANELS)) p.build(); }

/** Restore open panels after load (B only if the second viewer is enabled). */
export function restorePanels() {
    if (panelState('a').open) PANELS.a.toggle(true);
    if (getSettings().secondEnabled && panelState('b').open) PANELS.b.toggle(true);
}

export function addWandButton() {
    if (!$('#extensionsMenu').length) return;
    if (!$('#mapgen_wand_container').length) {
        const $a = $(`
            <div id="mapgen_wand_container" class="list-group-item flex-container flexGap5 interactable" tabindex="0">
                <div class="fa-fw fa-solid fa-map extensionsMenuExtensionButton"></div>
                <span>${t('wand_label')}</span>
            </div>`);
        $a.on('click', () => PANELS.a.toggle());
        $('#extensionsMenu').append($a);
    }
    // Second-viewer wand entry: present only while enabled in settings.
    const wantB = !!getSettings().secondEnabled;
    const $bExisting = $('#mapgen_wand_container2');
    if (wantB && !$bExisting.length) {
        const $b = $(`
            <div id="mapgen_wand_container2" class="list-group-item flex-container flexGap5 interactable" tabindex="0">
                <div class="fa-fw fa-solid fa-map-location-dot extensionsMenuExtensionButton"></div>
                <span>${t('wand_label2')}</span>
            </div>`);
        $b.on('click', () => PANELS.b.toggle());
        $('#extensionsMenu').append($b);
    } else if (!wantB && $bExisting.length) {
        $bExisting.remove();
    }
}
