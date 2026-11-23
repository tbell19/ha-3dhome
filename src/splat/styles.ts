/* The scan view's stylesheet. Colours follow the map's: dark warm grey, cream text, amber for what's on or chosen.
 * Phone width: `.wrap` is a size container, and below 640 px the bars wrap and the inspector becomes a bottom sheet. */
export const splatStyles = `
  :host { display: block; position: relative; height: 100%; color: #f2ebe0;
    font: 14px/1.4 var(--paper-font-body1_-_font-family, system-ui, sans-serif); }
  .wrap { position: absolute; inset: 0; overflow: hidden; background: #1b1a18; container-type: inline-size; touch-action: none; }
  .gl { position: absolute; inset: 0; width: 100%; height: 100%; display: block; outline: none; }
  .pins { position: absolute; inset: 0; pointer-events: none; }
  .pin { position: absolute; left: 0; top: 0; pointer-events: auto; cursor: pointer; user-select: none;
    display: flex; align-items: center; gap: 4px; padding: 3px 8px 3px 4px; margin: -14px 0 0 -14px;
    border-radius: 999px; background: rgba(27,26,24,.78); border: 1px solid rgba(255,255,255,.18);
    backdrop-filter: blur(6px); font-size: 12px; white-space: nowrap; touch-action: none; will-change: transform; }
  .pin .dot { width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center;
    background: rgba(255,255,255,.12); --mdc-icon-size: 15px; }
  .pin.act .dot { background: #f2c76b; color: #1b1a18; }
  .pin .nm { opacity: .7; } .pin.sel { outline: 2px solid #f2c76b; }
  .pin.off-screen { display: none; }
  .ui { position: absolute; inset: 0; pointer-events: none; }
  .ui > * { pointer-events: auto; }
  button { font: inherit; color: inherit; cursor: pointer; }
  .btn { padding: 8px 14px; border-radius: 999px; border: 1px solid rgba(255,255,255,.2);
    background: rgba(27,26,24,.85); backdrop-filter: blur(6px); display: inline-flex; align-items: center; gap: 6px; }
  .btn.on, .btn.primary { background: #f2c76b; color: #1b1a18; border-color: #f2c76b; font-weight: 600; }
  .btn:disabled { opacity: .45; cursor: default; }
  .btn ha-icon { --mdc-icon-size: 18px; }
  .bar { position: absolute; display: flex; flex-wrap: wrap; gap: 6px; }
  .bar.top { top: calc(12px + var(--ha-3dhome-safe-top, 0px)); left: calc(12px + var(--ha-3dhome-inset-left, 0px) + var(--ha-3dhome-safe-left, 0px)); right: 12px; }
  .bar.corner { right: calc(12px + var(--ha-3dhome-safe-right, 0px)); bottom: calc(12px + var(--ha-3dhome-safe-bottom, 0px)); }
  .menu { position: absolute; right: calc(12px + var(--ha-3dhome-safe-right, 0px)); bottom: calc(60px + var(--ha-3dhome-safe-bottom, 0px));
    display: grid; gap: 2px; padding: 6px; border-radius: 12px; background: rgba(27,26,24,.95); border: 1px solid rgba(255,255,255,.14); }
  .menu button { text-align: left; background: none; border: 0; padding: 8px 12px; border-radius: 8px; }
  .menu button:hover { background: rgba(255,255,255,.08); }
  .card { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: min(440px, calc(100% - 32px));
    box-sizing: border-box; max-height: calc(100% - 32px); overflow: auto; display: grid; gap: 12px; padding: 20px;
    border-radius: 16px; background: rgba(27,26,24,.94); border: 1px solid rgba(255,255,255,.12); box-shadow: 0 12px 40px rgba(0,0,0,.45); }
  .card h2 { margin: 0; font-size: 18px; } .card p { margin: 0; opacity: .8; }
  .choice { display: grid; grid-template-columns: 36px 1fr; gap: 2px 10px; text-align: left; padding: 12px; border-radius: 12px;
    border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.04); }
  .choice:hover { background: rgba(255,255,255,.08); }
  .choice ha-icon { grid-row: span 2; --mdc-icon-size: 26px; color: #f2c76b; align-self: center; }
  .choice b { font-weight: 600; } .choice span { opacity: .7; font-size: 13px; }
  .link { background: none; border: 0; padding: 0; text-decoration: underline; opacity: .75; justify-self: start; }
  .progress { height: 6px; border-radius: 3px; background: rgba(255,255,255,.12); overflow: hidden; }
  .progress i { display: block; height: 100%; background: #f2c76b; transition: width .3s; }
  .banner { position: absolute; left: 50%; transform: translateX(-50%); bottom: calc(64px + var(--ha-3dhome-safe-bottom, 0px));
    width: min(420px, calc(100% - 32px)); box-sizing: border-box; display: grid; gap: 8px; padding: 12px 14px; border-radius: 14px;
    background: rgba(27,26,24,.92); border: 1px solid rgba(255,255,255,.14); }
  .banner .row { display: flex; gap: 8px; align-items: center; justify-content: space-between; }
  .toast { position: absolute; left: 50%; top: calc(64px + var(--ha-3dhome-safe-top, 0px)); transform: translateX(-50%);
    padding: 8px 14px; border-radius: 999px; background: rgba(20,18,16,.94); border: 1px solid rgba(255,255,255,.16);
    max-width: calc(100% - 32px); text-align: center; pointer-events: none; }
  .hint { position: absolute; left: 50%; transform: translateX(-50%); top: calc(64px + var(--ha-3dhome-safe-top, 0px));
    padding: 8px 14px; border-radius: 12px; background: #f2c76b; color: #1b1a18; font-weight: 600; text-align: center;
    max-width: calc(100% - 32px); pointer-events: none; }
  .insp { position: absolute; right: 12px; top: calc(64px + var(--ha-3dhome-safe-top, 0px)); width: 280px; display: grid; gap: 10px;
    padding: 14px; border-radius: 14px; background: rgba(27,26,24,.95); border: 1px solid rgba(255,255,255,.14); }
  .insp label { display: grid; gap: 4px; font-size: 12px; opacity: .9; }
  .insp input, .insp select, .card input, .card select { font: inherit; color: inherit; padding: 8px 10px; border-radius: 8px;
    border: 1px solid rgba(255,255,255,.2); background: rgba(255,255,255,.06); }
  .insp .row { display: flex; gap: 6px; justify-content: space-between; }
  .scan { position: absolute; inset: 0; background: #000; display: grid; }
  .scan video { width: 100%; height: 100%; object-fit: cover; }
  .scan .over { position: absolute; inset: 0; display: grid; grid-template-rows: auto 1fr auto; padding: calc(12px + var(--ha-3dhome-safe-top, 0px)) 12px calc(16px + var(--ha-3dhome-safe-bottom, 0px)); pointer-events: none; }
  .scan .over > * { pointer-events: auto; }
  .scan .tips { justify-self: center; max-width: 520px; padding: 10px 14px; border-radius: 12px; background: rgba(0,0,0,.6); text-align: center; }
  .scan .tips.warn { background: #f2c76b; color: #1b1a18; font-weight: 600; }
  .scan .foot { display: grid; gap: 10px; justify-items: center; }
  .scan .count { font-size: 15px; padding: 6px 12px; border-radius: 999px; background: rgba(0,0,0,.6); }
  .scan .rec { width: 72px; height: 72px; border-radius: 50%; border: 4px solid #fff; background: #d33; }
  .scan .rec.on { background: #fff; } .scan .rec.on::after { content: ""; display: block; width: 24px; height: 24px; margin: auto; background: #d33; border-radius: 4px; }
  .scan .row { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; }
  @container (max-width: 640px) {
    .insp { left: 12px; right: 12px; top: auto; bottom: calc(64px + var(--ha-3dhome-safe-bottom, 0px)); width: auto; }
    .btn .lbl { display: none; }
  }
`;
