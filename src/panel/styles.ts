/* The panel's own stylesheet: the card fills the page, the sidebar button sits over its top-left corner on narrow
 * screens, and the offer to open Home Assistant here floats at the top, above the card's own "empty" hint in the middle.
 * Safe areas (status bar, notch, home bar): the integration tells Home Assistant the panel handles them
 * (handle_safe_area), so the page fills the screen and the map draws under the status and home bars. Home Assistant
 * reports the insets as --safe-area-inset-* (env(safe-area-inset-*), or the values the companion app reports); they go
 * to the map as --ha-3dhome-safe-* so its controls stay clear of them.
 */
export const panelStyles = `
  :host { display: block; position: relative; overflow: hidden; height: 100vh; height: 100dvh;
    background: var(--ha-3dhome-bg, #1b1a18); }
  ha-3dhome-map { display: block; height: 100%; --header-height: 0px;
    --ha-3dhome-safe-top: var(--safe-area-inset-top, env(safe-area-inset-top, 0px));
    --ha-3dhome-safe-bottom: var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px));
    --ha-3dhome-safe-left: var(--safe-area-content-inset-left, var(--safe-area-inset-left, env(safe-area-inset-left, 0px)));
    --ha-3dhome-safe-right: var(--safe-area-content-inset-right, var(--safe-area-inset-right, env(safe-area-inset-right, 0px))); }
  .menu { display: none; position: absolute; z-index: 5; color: #f2ebe0; --mdc-icon-button-size: 44px;
    top: calc(4px + var(--safe-area-inset-top, env(safe-area-inset-top, 0px)));
    left: calc(4px + var(--safe-area-content-inset-left, var(--safe-area-inset-left, env(safe-area-inset-left, 0px)))); }
  :host([narrow]) .menu { display: block; }
  :host([narrow]) ha-3dhome-map { --ha-3dhome-inset-left: 44px; }
  .offer { position: absolute; left: 50%; top: calc(16px + var(--safe-area-inset-top, env(safe-area-inset-top, 0px)));
    transform: translateX(-50%); z-index: 6;
    width: min(380px, calc(100% - 32px)); box-sizing: border-box; display: grid; gap: 8px; padding: 16px;
    border-radius: 14px; background: rgba(20,18,16,.92); border: 1px solid rgba(255,255,255,.12); color: #f2ebe0;
    font: 14px/1.45 var(--paper-font-body1_-_font-family, system-ui, sans-serif); box-shadow: 0 10px 30px rgba(0,0,0,.4); }
  .offer span { opacity: .8; }
  .offer button { font: inherit; padding: 9px 14px; border-radius: 999px; border: 0; cursor: pointer;
    background: #f2c76b; color: #1b1a18; font-weight: 600; }
  :host([narrow]) .offer { top: calc(56px + var(--safe-area-inset-top, env(safe-area-inset-top, 0px))); }
  .offer .row { display: flex; gap: 8px; } .offer .row button { flex: 1; }
  .offer button.quiet { background: none; color: #f2ebe0; border: 1px solid rgba(255,255,255,.25); }
  .hide { display: none; }
`;
