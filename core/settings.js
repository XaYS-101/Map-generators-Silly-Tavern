/* ------------------------------------------------------------------
 *  Settings bootstrap (forward-compatible migration) + toast helper.
 * ------------------------------------------------------------------ */
import { extension_settings } from '../../../../extensions.js';

export const MODULE_NAME = 'MapGenerators';

export const DEFAULT_SETTINGS = {
    enabled: true,
    language: 'en',
    defaultDepth: 4,        // injection depth for "inject" memory mode
    globalMaps: [],         // cross-chat library (copies of map objects)
    panels: { a: { open: false, mapId: null }, b: { open: false, mapId: null } }, // two docked viewers
    secondEnabled: false,   // is the second floating viewer (B) enabled
};

export function getSettings() {
    if (!extension_settings[MODULE_NAME]) {
        extension_settings[MODULE_NAME] = structuredClone(DEFAULT_SETTINGS);
        return extension_settings[MODULE_NAME];
    }
    const s = extension_settings[MODULE_NAME];
    // Migrate the pre-v2 single panel state into panels.a.
    if (s.panel && !s.panels) {
        s.panels = { a: { open: !!s.panel.open, mapId: s.panel.mapId ?? null }, b: { open: false, mapId: null } };
        delete s.panel;
    }
    for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
        if (s[k] === undefined) s[k] = structuredClone(v);
    }
    return s;
}

export function toast(msg, type = 'info') {
    try { window.toastr?.[type]?.(msg); } catch { /* noop */ }
}
