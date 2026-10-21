/* The panel's own stylesheet: the card fills the page, the sidebar button sits over its top-left corner on narrow
 * screens, and the import offer floats at the top, above the card's own "empty" hint in the middle.
 */
export const panelStyles = `
  :host { display: block; position: relative; height: 100vh; height: 100dvh; overflow: hidden;
    background: var(--ha-3dhome-bg, #1b1a18); }
  ha-3dhome-card { display: block; height: 100%; --header-height: 0px; }
  .menu { display: none; position: absolute; left: 4px; top: calc(4px + env(safe-area-inset-top, 0px)); z-index: 5;
    color: #f2ebe0; --mdc-icon-button-size: 44px; }
  :host([narrow]) .menu { display: block; }
  :host([narrow]) ha-3dhome-card { --ha-3dhome-inset-left: 44px; }
  .import { position: absolute; left: 50%; top: calc(16px + env(safe-area-inset-top, 0px)); transform: translateX(-50%); z-index: 6;
    width: min(380px, calc(100% - 32px)); box-sizing: border-box; display: grid; gap: 8px; padding: 16px;
    border-radius: 14px; background: rgba(20,18,16,.92); border: 1px solid rgba(255,255,255,.12); color: #f2ebe0;
    font: 14px/1.45 var(--paper-font-body1_-_font-family, system-ui, sans-serif); box-shadow: 0 10px 30px rgba(0,0,0,.4); }
  .import span { opacity: .8; }
  .import button { font: inherit; padding: 9px 14px; border-radius: 999px; border: 0; cursor: pointer;
    background: #f2c76b; color: #1b1a18; font-weight: 600; }
  .import button:disabled { opacity: .5; cursor: default; }
  :host([narrow]) .import { top: calc(56px + env(safe-area-inset-top, 0px)); }
  .hide { display: none; }
`;
