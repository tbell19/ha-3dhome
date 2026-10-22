/* The panel's own stylesheet: the card fills the page, the sidebar button sits over its top-left corner on narrow
 * screens, and the import offer (or the one to open Home Assistant here) floats at the top, above the card's own "empty" hint in the middle.
 * Home Assistant pads a custom panel by the device's safe areas (status bar, notch, home bar), using its
 * --safe-area-inset-* variables (env(safe-area-inset-*), or the values the companion app reports). So the page is the
 * screen height less those insets, and nothing inside adds them again.
 */
export const panelStyles = `
  :host { display: block; position: relative; overflow: hidden;
    height: calc(100vh - var(--safe-area-inset-top, 0px) - var(--safe-area-inset-bottom, 0px));
    height: calc(100dvh - var(--safe-area-inset-top, 0px) - var(--safe-area-inset-bottom, 0px));
    background: var(--ha-3dhome-bg, #1b1a18); }
  ha-3dhome-map { display: block; height: 100%; --header-height: 0px; }
  .menu { display: none; position: absolute; left: 4px; top: 4px; z-index: 5;
    color: #f2ebe0; --mdc-icon-button-size: 44px; }
  :host([narrow]) .menu { display: block; }
  :host([narrow]) ha-3dhome-map { --ha-3dhome-inset-left: 44px; }
  .import, .offer { position: absolute; left: 50%; top: 16px; transform: translateX(-50%); z-index: 6;
    width: min(380px, calc(100% - 32px)); box-sizing: border-box; display: grid; gap: 8px; padding: 16px;
    border-radius: 14px; background: rgba(20,18,16,.92); border: 1px solid rgba(255,255,255,.12); color: #f2ebe0;
    font: 14px/1.45 var(--paper-font-body1_-_font-family, system-ui, sans-serif); box-shadow: 0 10px 30px rgba(0,0,0,.4); }
  .import span, .offer span { opacity: .8; }
  .import button, .offer button { font: inherit; padding: 9px 14px; border-radius: 999px; border: 0; cursor: pointer;
    background: #f2c76b; color: #1b1a18; font-weight: 600; }
  .import button:disabled { opacity: .5; cursor: default; }
  :host([narrow]) :is(.import, .offer) { top: 56px; }
  .offer .row { display: flex; gap: 8px; } .offer .row button { flex: 1; }
  .offer button.quiet { background: none; color: #f2ebe0; border: 1px solid rgba(255,255,255,.25); }
  .hide { display: none; }
`;
