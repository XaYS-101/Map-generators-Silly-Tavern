/* ------------------------------------------------------------------
 *  Per-chat map library  (lives in chat_metadata → survives reloads)
 * ------------------------------------------------------------------ */
import { getContext } from '../../../../extensions.js';
import { MODULE_NAME } from './settings.js';
import { GENERATORS, randomSeed } from './generators.js';

export function chatStore() {
    const ctx = getContext();
    if (!ctx || !ctx.chatMetadata) return null;
    if (!ctx.chatMetadata[MODULE_NAME]) ctx.chatMetadata[MODULE_NAME] = { maps: [] };
    if (!Array.isArray(ctx.chatMetadata[MODULE_NAME].maps)) ctx.chatMetadata[MODULE_NAME].maps = [];
    return ctx.chatMetadata[MODULE_NAME];
}

export function getChatMaps() {
    return chatStore()?.maps ?? [];
}

export function persistChat() {
    getContext()?.saveMetadataDebounced?.();
}

export function newId() {
    return 'm' + randomSeed().toString(36) + Date.now().toString(36);
}

export function injectKey(map) {
    return `MapGen_${map.id}`;
}

/** Text actually fed to the AI for a map. */
export function formatForAi(map) {
    const desc = (map.description || '').trim() || `(${GENERATORS[map.generator]?.label || map.generator} map, no description)`;
    return desc;
}
