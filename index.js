/* ==================================================================
 *  Map Generators — SillyTavern extension (entry point)
 *
 *  Embeds Watabou's procedural map generators AND ships its own
 *  offline generators (procgen/), keeps a per-chat library of maps,
 *  and feeds a text description of each map to the AI (via a
 *  chat-bound lorebook entry OR a prompt injection) so the model
 *  "remembers" the places. State persists across reloads.
 *
 *  Layout:
 *    core/     settings, i18n, per-chat store, AI memory, file/vision helpers,
 *              generator registry
 *    ui/       popups, map editor, library, docked panels, settings drawer
 *    procgen/  the local procedural generators (RNG, algorithms, canvas
 *              renderer, LLM describer)
 * ================================================================== */

import { eventSource, event_types } from '../../../../script.js';
import { SlashCommandParser } from '../../../slash-commands/SlashCommandParser.js';
import { SlashCommand } from '../../../slash-commands/SlashCommand.js';

import { applyTranslations } from './core/i18n.js';
import { getSettings } from './core/settings.js';
import { reinjectForCurrentChat } from './core/memory.js';
import { SETTINGS_HTML, wireSettings } from './ui/settings-drawer.js';
import { addWandButton, buildAllPanels, renderAllPanels, restorePanels } from './ui/panels.js';
import { openLibrary } from './ui/library.js';

jQuery(async () => {
    try {
        getSettings();

        const $host = $('#extensions_settings2').length
            ? $('#extensions_settings2')
            : ($('#extensions_settings').length ? $('#extensions_settings') : $('body'));
        $host.append(SETTINGS_HTML);
        applyTranslations(document.querySelector('.map-generators-settings'));
        wireSettings();

        // /map slash command opens the library.
        try {
            SlashCommandParser.addCommandObject(SlashCommand.fromProps({
                name: 'map',
                helpString: 'Open the Map Generators library',
                callback: () => { openLibrary(); return ''; },
            }));
        } catch (e) { console.warn('[MapGenerators] slash command registration failed', e); }

        // Docked floating viewers + wand-menu button(s) near the chat.
        addWandButton();
        buildAllPanels();

        const onChatChanged = () => { reinjectForCurrentChat(); renderAllPanels(); };

        // Re-apply prompt injections + refresh the viewers when the chat changes.
        if (event_types?.CHAT_CHANGED) {
            eventSource.on(event_types.CHAT_CHANGED, onChatChanged);
        }
        if (event_types?.APP_READY) {
            eventSource.on(event_types.APP_READY, () => {
                reinjectForCurrentChat();
                addWandButton();
                restorePanels();          // restore docked viewers
            });
        }
        // If APP_READY already fired, restore the viewers now.
        restorePanels();

        console.log('[MapGenerators] loaded');
    } catch (e) {
        console.error('[MapGenerators] init failed', e);
    }
});
