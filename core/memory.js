/* ------------------------------------------------------------------
 *  AI memory:  lorebook entry  and/or  prompt injection
 * ------------------------------------------------------------------ */
import {
    setExtensionPrompt,
    extension_prompt_types,
    extension_prompt_roles,
} from '../../../../../script.js';
import { getContext } from '../../../../extensions.js';
import { callGenericPopup, POPUP_TYPE, POPUP_RESULT } from '../../../../popup.js';
import {
    loadWorldInfo,
    saveWorldInfo,
    createWorldInfoEntry,
    updateWorldInfoList,
    METADATA_KEY,
} from '../../../../world-info.js';

import { t } from './i18n.js';
import { getSettings, toast } from './settings.js';
import { getChatMaps, persistChat, injectKey, formatForAi } from './store.js';

const activeInjectKeys = new Set();

/** Suggested lorebook name: "<Character> - <chat>". */
function suggestedLorebookName() {
    const ctx = getContext();
    const char = ctx?.name2 || ctx?.characters?.[ctx?.characterId]?.name || 'Char';
    const chat = ctx?.chatId || 'chat';
    return `${char} - ${chat}`;
}

/**
 * Ensure the current chat has a bound lorebook. If a map already points
 * at one, reuse it. If the chat has one bound, reuse it. Otherwise warn
 * the user and offer to auto-create "<Character> - <chat>".
 * @returns {Promise<string|null>} bound lorebook name, or null if declined.
 */
async function ensureChatLorebook(map) {
    const ctx = getContext();
    if (map?.memory?.lorebook) return map.memory.lorebook;
    const bound = ctx?.chatMetadata?.[METADATA_KEY];
    if (bound) return bound;

    const suggested = suggestedLorebookName();
    const ok = await callGenericPopup(
        t('no_lorebook_msg').replace('{name}', suggested),
        POPUP_TYPE.CONFIRM, '',
        { okButton: t('no_lorebook_create'), cancelButton: t('cancel') },
    );
    if (ok !== POPUP_RESULT.AFFIRMATIVE) return null;

    // Create an empty lorebook and bind it to the chat.
    await saveWorldInfo(suggested, { entries: {} }, true);
    await updateWorldInfoList();
    if (ctx?.chatMetadata) {
        ctx.chatMetadata[METADATA_KEY] = suggested;
        persistChat();
    }
    toast(t('lorebook_created').replace('{name}', suggested), 'success');
    return suggested;
}

/** @returns {Promise<boolean>} whether the entry was written. */
export async function applyLorebook(map) {
    const name = await ensureChatLorebook(map);
    if (!name) return false;   // user declined to create a lorebook

    let data;
    try { data = await loadWorldInfo(name); } catch { data = null; }
    if (!data || typeof data !== 'object' || !data.entries) data = { entries: {} };

    let entry = (map.memory.entryUid != null) ? data.entries[map.memory.entryUid] : null;
    if (!entry) {
        entry = createWorldInfoEntry(name, data);
        if (!entry) { toast(t('lore_entry_fail'), 'error'); return false; }
        map.memory.entryUid = entry.uid;
    }
    entry.key = [map.title].filter(Boolean);
    entry.comment = `[Map] ${map.title}`;
    entry.content = formatForAi(map);
    entry.constant = false;   // keyword-triggered on the place name
    entry.disable = false;

    await saveWorldInfo(name, data, true);
    await updateWorldInfoList();
    map.memory.lorebook = name;
    return true;
}

export async function disableLorebookEntry(map) {
    if (!map.memory.lorebook || map.memory.entryUid == null) return;
    let data;
    try { data = await loadWorldInfo(map.memory.lorebook); } catch { return; }
    if (data?.entries?.[map.memory.entryUid]) {
        data.entries[map.memory.entryUid].disable = true;
        await saveWorldInfo(map.memory.lorebook, data, true);
    }
}

export function applyInject(map) {
    const depth = Number(map.memory.depth ?? getSettings().defaultDepth ?? 4);
    const key = injectKey(map);
    setExtensionPrompt(
        key,
        `[Map: ${map.title}] ${formatForAi(map)}`,
        extension_prompt_types.IN_CHAT,
        depth,
        false,
        extension_prompt_roles.SYSTEM,
    );
    activeInjectKeys.add(key);
}

export function clearInject(map) {
    const key = injectKey(map);
    setExtensionPrompt(key, '', extension_prompt_types.IN_CHAT, 0);
    activeInjectKeys.delete(key);
}

/** Drop every active prompt injection (used on chat switch and reset). */
export function clearAllInjects() {
    for (const key of [...activeInjectKeys]) {
        setExtensionPrompt(key, '', extension_prompt_types.IN_CHAT, 0);
    }
    activeInjectKeys.clear();
}

/** Apply a map's chosen memory mode, clearing the other mode. */
export async function applyMemory(map, { quiet = false } = {}) {
    if (!getSettings().enabled) return;
    const mode = map.memory?.mode || 'none';
    if (mode === 'lorebook') {
        clearInject(map);
        const ok = await applyLorebook(map);
        if (!ok) { map.memory.mode = 'none'; persistChat(); return; }  // declined lorebook creation
        if (!quiet) toast(t('applied_lore'), 'success');
    } else if (mode === 'inject') {
        await disableLorebookEntry(map);
        applyInject(map);
        if (!quiet) toast(t('applied_inject'), 'success');
    } else {
        clearInject(map);
        await disableLorebookEntry(map);
        if (!quiet) toast(t('memory_off'));
    }
}

/** On chat switch: clear all injects, then re-apply this chat's inject maps. */
export function reinjectForCurrentChat() {
    clearAllInjects();
    if (!getSettings().enabled) return;
    for (const map of getChatMaps()) {
        if (map.memory?.mode === 'inject') applyInject(map);
    }
}
