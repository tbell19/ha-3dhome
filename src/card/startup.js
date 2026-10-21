/* Card startup: loads Three.js, builds the renderer, camera, controls and DOM, and wires up input.
 */
import { THREE_URL, ORBIT_URL, CX, CY } from "../core/constants.js";
import { ic } from "../core/util.js";

export const StartupMixin = (Base) =>
  class Startup extends Base {
    async _init() {
      const cfg = this._config,
        gen = this._gen;
      const T = (this.T = await import(cfg.three_url || THREE_URL));
      const { OrbitControls } = await import(cfg.orbit_url || ORBIT_URL);
      if (gen !== this._gen || !this.isConnected) {
        this._loading = false;
        return;
      } // torn down / detached meanwhile
      const root = this.shadowRoot || this.attachShadow({ mode: "open" });
      root.innerHTML = `
      <style>
        ha-card { overflow: hidden; background: var(--ha-3dhome-bg, var(--iso-bg, #1b1a18)); ${cfg.fill ? "border-radius: 0; border: 0;" : ""} }
        .wrap { position: relative; width: 100%; container-type: inline-size; touch-action: none; font-family: var(--ha-font-family-body, system-ui);
          ${cfg.fill ? "height: calc(100vh - var(--header-height, 56px) - env(safe-area-inset-top, 0px)); min-height: 360px;" : `aspect-ratio: ${cfg.aspect_ratio || "16 / 10"};`} }
        canvas { display: block; width: 100% !important; height: 100% !important; }
        .ov { position: absolute; inset: 0; pointer-events: none; }
        .editing .ov { opacity: .45; } .editing .ov * { pointer-events: none !important; }
        .chip { position: absolute; transform: translate(-50%,-50%); display: flex; gap: .55em; align-items: center; pointer-events: auto;
          padding: .28em .7em; border-radius: 999px; background: rgba(20,18,16,.72); color: #f2ebe0; cursor: pointer; user-select: none;
          font: 500 max(9px, 1.1cqw)/1.2 var(--ha-font-family-body, system-ui); white-space: nowrap; border: 1px solid rgba(255,255,255,.08); }
        .chip ha-icon { --mdc-icon-size: 1.15em; opacity: .85; }
        .chip .occ { color: #ffd27a; } .chip .item { display: inline-flex; gap: .2em; align-items: center; }
        .door { position: absolute; transform: translate(-50%,-50%); width: max(14px,1.8cqw); height: max(14px,1.8cqw); pointer-events: auto;
          border-radius: 50%; display: grid; place-items: center; cursor: pointer; color: #fff; }
        .door ha-icon { --mdc-icon-size: 70%; }
        .door.open { background: #c2483d; box-shadow: 0 0 0 3px rgba(194,72,61,.3); } .door.closed { background: rgba(40,90,60,.85); }
        .weather { position: absolute; left: 2.5%; top: 3.5%; color: #f2ebe0; pointer-events: auto;
          display: grid; grid-template-columns: auto auto; column-gap: .6em; align-items: center; cursor: pointer; }
        .weather ha-icon { --mdc-icon-size: max(26px, 4cqw); color: #f5d27a; grid-row: span 2; }
        .weather .t { font-size: max(18px, 3.2cqw); font-weight: 600; line-height: 1; } .weather .s { font-size: max(9px, 1.1cqw); opacity: .8; }
        .pill, .bar button, .insp button, .lib button { background: rgba(20,18,16,.78); color: #f2ebe0; border: 1px solid rgba(255,255,255,.12);
          border-radius: 999px; padding: .38em .85em; font: 500 12px var(--ha-font-family-body, system-ui); cursor: pointer; white-space: nowrap; }
        .nav { position: absolute; right: 12px; bottom: 12px; display: flex; gap: 2px; padding: 3px; border-radius: 999px;
          background: rgba(20,18,16,.72); border: 1px solid rgba(255,255,255,.1); backdrop-filter: blur(6px); }
        .nav button { background: none; border: 0; color: #f2ebe0; min-width: 32px; height: 32px; border-radius: 999px; cursor: pointer;
          font: 500 15px/1 var(--ha-font-family-body, system-ui); padding: 0 8px; }
        .nav button:hover { background: rgba(255,255,255,.1); } .nav button.on { background: #f2c76b; color: #1b1a18; }
        .nav .edbtn { font-size: 12px; border-left: 1px solid rgba(255,255,255,.12); border-radius: 0 999px 999px 0; padding: 0 12px; }
        .rooms { position: absolute; left: 12px; bottom: 12px; right: 290px; display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none;
          mask-image: linear-gradient(90deg, #000 85%, transparent); padding-right: 24px; }
        .rooms::-webkit-scrollbar { display: none; }
        .rooms button { flex: none; background: rgba(20,18,16,.72); color: #f2ebe0; border: 1px solid rgba(255,255,255,.1); border-radius: 999px;
          padding: 7px 12px; font: 500 12px var(--ha-font-family-body, system-ui); cursor: pointer; backdrop-filter: blur(6px); }
        .rooms button:hover { background: rgba(60,54,46,.9); }
        .rooms button.on { background: #f2c76b; color: #1b1a18; border-color: #f2c76b; }
        @container (max-width: 640px) { .rooms { right: 12px; bottom: 58px; } }
        .bar button:hover, .insp button:hover, .lib button:hover, .pill:hover { background: rgba(60,54,46,.9); }
        .bar button.on { background: #f2c76b; color: #1b1a18; border-color: #f2c76b; }
        .bar button.primary, .lib button.primary { background: #3f7d5a; border-color: #4f9a6f; }
        .bar button:disabled, .insp button:disabled { opacity: .4; cursor: default; }
        .bar { position: absolute; left: 0; right: 0; margin: 0 auto; width: max-content; top: 10px; display: flex; flex-wrap: wrap; gap: 6px; justify-content: center;
          max-width: calc(100% - 20px); padding: 6px; border-radius: 16px; background: rgba(12,11,10,.55); backdrop-filter: blur(6px); }
        .bar .sep { width: 1px; background: rgba(255,255,255,.15); margin: 2px 2px; }
        .bar .top, .bar .tools { display: contents; } .bar .tools > * { order: 1; }
        .bar .acts { order: 2; display: inline-flex; gap: 6px; padding-left: 8px; border-left: 1px solid rgba(255,255,255,.15); }
        .bar [data-m] ha-icon:last-child { --mdc-icon-size: 14px; margin-left: -3px; opacity: .7; }
        .bar [data-m].open { background: rgba(60,54,46,.9); }
        .pop { z-index: 7; min-width: 190px; box-shadow: 0 10px 30px rgba(0,0,0,.45); }
        .pop button { background: none; color: #f2ebe0; border: 0; padding: 8px 10px; font: 500 13px var(--ha-font-family-body, system-ui); cursor: pointer; white-space: nowrap; }
        .bar button, .pop button { -webkit-tap-highlight-color: transparent; }
        .pop button:hover { background: rgba(255,255,255,.08); } .pop button.on { background: #f2c76b; color: #1b1a18; }
        .pop button:disabled { opacity: .4; cursor: default; background: none; }
        .menu { position: absolute; z-index: 5; display: grid; gap: 4px; padding: 6px; border-radius: 12px; background: #24211d; border: 1px solid rgba(255,255,255,.12); }
        .menu button { border-radius: 8px; text-align: left; }
        .insp { position: absolute; left: 10px; top: 112px; width: min(290px, 46%); max-height: calc(100% - 180px); overflow: auto; color: #f2ebe0;
          background: rgba(12,11,10,.78); backdrop-filter: blur(6px); border: 1px solid rgba(255,255,255,.1); border-radius: 14px; padding: 10px 12px; font-size: 12px; }
        .insp h4 { margin: 0 0 6px; font-size: 13px; font-weight: 600; } .insp .sub { opacity: .65; margin-bottom: 8px; }
        .insp .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-bottom: 8px; }
        .insp label { display: grid; gap: 2px; font-size: 10px; opacity: .85; text-transform: uppercase; letter-spacing: .04em; }
        .insp input, .insp textarea, .lib input, .lib select { background: #11100e; color: #f2ebe0; border: 1px solid rgba(255,255,255,.15); border-radius: 6px;
          padding: 4px 6px; font: 12px ui-monospace, monospace; min-width: 0; width: 100%; box-sizing: border-box; }
        .insp input[type=color] { padding: 0; height: 24px; }
        .insp textarea { height: 110px; resize: vertical; }
        .insp .row { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; }
        .insp .credit { margin-top: 8px; opacity: .7; font-size: 11px; }
        .toast { position: absolute; left: 50%; bottom: 14px; transform: translateX(-50%); background: rgba(12,11,10,.85); color: #f2ebe0; padding: 6px 12px;
          border-radius: 999px; font-size: 12px; pointer-events: none; transition: opacity .3s; }
        .lib { position: absolute; inset: 3%; z-index: 6; display: flex; flex-direction: column; background: #1f1d1a; color: #f2ebe0; border-radius: 16px;
          border: 1px solid rgba(255,255,255,.12); box-shadow: 0 10px 40px rgba(0,0,0,.5); font-size: 13px; overflow: hidden; }
        .lib header { display: flex; gap: 8px; align-items: center; padding: 10px 12px; border-bottom: 1px solid rgba(255,255,255,.08); }
        .lib header .ttl { font-weight: 600; flex: 1; }
        .lib .body { flex: 1; overflow: auto; padding: 10px 12px; }
        .lib .libs { display: grid; gap: 6px; }
        .lib .librow { display: grid; grid-template-columns: 1fr auto auto; gap: 10px; align-items: center; padding: 8px 10px; border-radius: 10px; background: rgba(255,255,255,.04); }
        .lib .librow .meta { opacity: .65; font-size: 11px; }
        .lib .tools { display: flex; gap: 8px; } .lib .tools input { flex: 1; } .lib .tools select { width: auto; }
        .lib .items { display: grid; grid-template-columns: repeat(auto-fill, minmax(104px, 1fr)); gap: 8px; margin-top: 10px; }
        .lib .it { background: rgba(255,255,255,.05); border-radius: 10px; padding: 6px; cursor: pointer; text-align: center; font-size: 11px; border: 1px solid transparent; }
        .lib .it:hover { border-color: #f2c76b; }
        .lib .it img { width: 100%; aspect-ratio: 1; object-fit: contain; background: #f4f1ea; border-radius: 6px; }
        .lib .it .n { margin-top: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .lib .note { opacity: .7; font-size: 11px; margin: 8px 0; line-height: 1.4; }
        .chip.act ha-icon { color: #ffd27a; opacity: 1; }
        .lookp { position: absolute; right: 10px; top: 112px; width: min(260px, calc(100% - 20px)); box-sizing: border-box; display: grid; gap: 10px; padding: 0 12px 12px; color: #f2ebe0;
          background: rgba(12,11,10,.86); backdrop-filter: blur(6px); border: 1px solid rgba(255,255,255,.1); border-radius: 14px; font-size: 12px; z-index: 4; max-height: calc(100% - 122px); overflow-y: auto; }
        .lookp header { display: flex; align-items: center; margin: 0 -12px; padding: 8px 10px 8px 12px; border-bottom: 1px solid rgba(255,255,255,.08); }
        .lookp header .ttl { flex: 1; font-weight: 600; font-size: 13px; }
        .lookp header button { background: rgba(255,255,255,.06); color: #f2ebe0; border: 1px solid rgba(255,255,255,.12); border-radius: 999px; padding: 4px 10px; cursor: pointer; }
        .lookp label { display: grid; grid-template-columns: 1fr auto; gap: 2px 8px; align-items: center; }
        .lookp .n { font-weight: 600; } .lookp output { opacity: .75; font-variant-numeric: tabular-nums; }
        .lookp input { grid-column: 1 / -1; width: 100%; margin: 2px 0; accent-color: #f2c76b; }
        .lookp .d { grid-column: 1 / -1; opacity: .6; font-size: 11px; }
        .lookp .idle { display: grid; gap: 6px; padding-top: 10px; border-top: 1px solid rgba(255,255,255,.08); }
        .lookp select { width: 100%; box-sizing: border-box; background: rgba(255,255,255,.06); color: #f2ebe0; border: 1px solid rgba(255,255,255,.14); border-radius: 8px; padding: 6px 8px; font: inherit; }
        .lookp select option { background: #2a2622; color: #f2ebe0; }
        .lookp select:disabled { opacity: .45; }
        .ltune { margin: 0 0 8px; } .ltune summary { cursor: pointer; opacity: .85; margin-bottom: 6px; }
        .ltune label { text-transform: none; letter-spacing: normal; font-size: 12px; display: grid; grid-template-columns: 1fr auto; gap: 2px 8px; align-items: center; margin-bottom: 6px; }
        .ltune .n { font-weight: 600; } .ltune output { opacity: .75; font-variant-numeric: tabular-nums; }
        .ltune input { grid-column: 1 / -1; width: 100%; margin: 2px 0; accent-color: #f2c76b; }
        .ltune .d { grid-column: 1 / -1; opacity: .6; font-size: 11px; }
        .ents { position: absolute; right: 10px; top: 112px; bottom: 64px; width: min(300px, 44%); display: flex; flex-direction: column; color: #f2ebe0;
          background: rgba(12,11,10,.86); backdrop-filter: blur(6px); border: 1px solid rgba(255,255,255,.1); border-radius: 14px; font-size: 12px; overflow: hidden; z-index: 4; }
        .ents header { display: flex; align-items: center; gap: 6px; padding: 8px 10px; border-bottom: 1px solid rgba(255,255,255,.08); }
        .ents header .ttl { flex: 1; font-weight: 600; font-size: 13px; }
        .ents button { background: rgba(255,255,255,.06); color: #f2ebe0; border: 1px solid rgba(255,255,255,.12); border-radius: 999px; padding: 4px 10px;
          font: 500 11.5px var(--ha-font-family-body, system-ui); cursor: pointer; }
        .ents button.on { background: #f2c76b; color: #1b1a18; border-color: #f2c76b; }
        .ents .quick, .ents .doms { display: flex; gap: 5px; flex-wrap: wrap; padding: 8px 10px 0; }
        .ents input { margin: 8px 10px 0; width: calc(100% - 20px); box-sizing: border-box; background: #11100e; color: #f2ebe0; border: 1px solid rgba(255,255,255,.15);
          border-radius: 8px; padding: 6px 8px; font: 12px var(--ha-font-family-body, system-ui); }
        .ents .list { flex: 1; overflow: auto; padding: 6px 6px 10px; margin-top: 6px; }
        .ents .erow { display: grid; grid-template-columns: 22px 1fr auto; gap: 8px; align-items: center; padding: 6px 6px; border-radius: 8px; cursor: grab;
          user-select: none; touch-action: none; }
        .ents .erow:hover { background: rgba(255,255,255,.07); }
        .ents .list { touch-action: pan-y; overscroll-behavior: contain; } @media (pointer: coarse) { .ents .erow { touch-action: pan-y; cursor: pointer; } }
        .ents .erow ha-icon { --mdc-icon-size: 18px; opacity: .85; } .ents .erow.act ha-icon { color: #ffd27a; opacity: 1; }
        .ents .erow .n { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .ents .erow .id { opacity: .5; font-size: 10.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .ents .erow .ok { color: #6fd39a; font-size: 11px; }
        .ents .hint { padding: 6px 10px 0; opacity: .6; font-size: 11px; }
        .ghost { position: absolute; z-index: 9; pointer-events: none; transform: translate(-50%, -130%); background: #f2c76b; color: #1b1a18;
          padding: 5px 10px; border-radius: 999px; font: 600 12px var(--ha-font-family-body, system-ui); white-space: nowrap; box-shadow: 0 6px 18px rgba(0,0,0,.4); }
        .ghost.off { background: rgba(20,18,16,.85); color: #f2ebe0; }
        .insp select { background: #11100e; color: #f2ebe0; border: 1px solid rgba(255,255,255,.15); border-radius: 6px; padding: 4px 6px; font: 12px var(--ha-font-family-body, system-ui); }
        .insp h4 { cursor: pointer; display: flex; gap: 6px; align-items: center; } .insp h4 .tw { margin-left: auto; opacity: .55; font-size: 11px; }
        .insp.min > :not(h4) { display: none; } .insp.min h4 { margin: 0; }
        .insp details.tips summary { cursor: pointer; opacity: .7; margin-top: 4px; }
        @container (max-width: 640px) {
          .bar { left: 8px; right: 8px; width: auto; transform: none; max-width: none; flex-direction: column; flex-wrap: nowrap; padding: 4px; border-radius: 12px; gap: 4px; }
          .bar .top { display: flex; justify-content: space-between; gap: 4px; }
          .bar .acts { display: flex; gap: 4px; padding-left: 0; border-left: 0; }
          .bar .tools { display: flex; gap: 4px; overflow-x: auto; scrollbar-width: none; } .bar .tools::-webkit-scrollbar { display: none; }
          .bar button { flex: none; padding: .5em .7em; font-size: 13px; }
          .bar .ico .lbl, .bar .modes button:not(.on) .lbl { display: none; }
          .insp { top: auto; bottom: 108px; left: 8px; right: 8px; width: auto; max-height: 32%; padding: 8px 10px; }
          .ents { top: auto; bottom: 108px; left: 8px; right: 8px; width: auto; height: 60%; }
          .ents .doms { flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; padding-bottom: 2px; } .ents .doms::-webkit-scrollbar { display: none; } .ents .doms button { flex: none; }
          .weather { display: none; }
        }
        .bar .seg { display: inline-flex; border: 1px solid rgba(255,255,255,.14); border-radius: 999px; overflow: hidden; flex: none; }
        .bar .seg button { border: 0; border-radius: 0; }
        .plan .ov { display: none; }
        .rlabels { position: absolute; inset: 0; pointer-events: none; }
        .rlabel { position: absolute; transform: translate(-50%, -50%); display: grid; text-align: center; padding: 3px 9px; border-radius: 10px;
          background: rgba(255,255,255,.72); color: #1b1a18; font: 600 11px/1.25 var(--ha-font-family-body, system-ui); white-space: nowrap; }
        .rlabel small { font-weight: 500; opacity: .65; font-size: 10px; }
        @container (max-width: 640px) { .rlabel { font-size: 10px; padding: 2px 6px; } .rlabel small { display: none; } }
        .editing .toast { bottom: 62px; }
        @container (max-width: 640px) { .editing .toast { bottom: auto; top: 96px; max-width: calc(100% - 32px); white-space: normal; text-align: center; } }
        .tool canvas { cursor: crosshair !important; }
        .tip { position: absolute; z-index: 8; pointer-events: none; transform: translate(14px, -140%); background: #f2c76b; color: #1b1a18;
          padding: 3px 9px; border-radius: 999px; font: 600 12px var(--ha-font-family-body, system-ui); white-space: nowrap; box-shadow: 0 4px 14px rgba(0,0,0,.35); }
        .xf { display: grid; grid-template-columns: 54px repeat(3, minmax(0, 1fr)); gap: 4px 5px; align-items: center; margin-bottom: 5px; }
        .xf > b { font-size: 11px; font-weight: 600; opacity: .85; } .xf > b button { font-size: 10px; padding: 0 4px; margin-left: 2px; }
        .insp .xf label { display: flex; align-items: center; gap: 3px; text-transform: none; letter-spacing: 0; font-size: 11px; }
        .xf label i { font-style: normal; font-weight: 700; width: 9px; } .xf .ax-x i { color: #ef6b5b; } .xf .ax-y i { color: #6fd39a; } .xf .ax-z i { color: #5aa9ff; }
        .xf input { min-width: 0; width: 100%; } .xf input:disabled { opacity: .3; }
        .insp label.chk { display: flex; gap: 8px; align-items: center; text-transform: none; letter-spacing: 0; font-size: 12px; margin: 4px 0; }
        .insp label.chk input { width: auto; }
        .insp input[type=range] { padding: 0; accent-color: #f2c76b; }
        .insp .row .primary, .insp button.primary { background: #3f7d5a; border-color: #4f9a6f; }
        .rcards { position: absolute; right: 10px; top: 10px; width: min(340px, 42%); max-height: calc(100% - 76px); display: flex; flex-direction: column;
          z-index: 3; color: #f2ebe0; font-family: var(--ha-font-family-body, system-ui); }
        .rcards header { flex: none; display: flex; align-items: center; gap: 6px; align-self: flex-end; margin-bottom: 6px; padding: 4px 4px 4px 12px; border-radius: 999px;
          background: rgba(20,18,16,.72); border: 1px solid rgba(255,255,255,.1); backdrop-filter: blur(6px); font: 600 12px var(--ha-font-family-body, system-ui); cursor: pointer; user-select: none; }
        .rcards header button { background: none; border: 0; color: inherit; width: 24px; height: 24px; border-radius: 999px; cursor: pointer; font: 600 13px/1 var(--ha-font-family-body, system-ui); }
        .rcards header button:hover { background: rgba(255,255,255,.1); }
        .rcards .rcbody { overflow: auto; display: flex; flex-direction: column; gap: 8px; touch-action: pan-y; overscroll-behavior: contain; scrollbar-width: thin; border-radius: var(--ha-card-border-radius, 12px); }
        .rcards .rcbody > * { flex: none; }
        /* Room controls keep the map's dark palette whatever the HA theme: a light theme's dark text on pale cards is unreadable here.
         * Theme variables inherit into the cards' shadow DOM, so redefining them here restyles built-in and most custom cards. */
        .rcards .rcbody, .rcp .rcprev { color-scheme: dark; color: #f2ebe0;
          --primary-text-color: #f2ebe0; --secondary-text-color: rgba(242,235,224,.68); --disabled-text-color: rgba(242,235,224,.38); --text-primary-color: #f2ebe0;
          --rgb-primary-text-color: 242, 235, 224; --rgb-secondary-text-color: 242, 235, 224; --rgb-card-background-color: 28, 26, 23;
          --card-background-color: rgba(28,26,23,.86); --ha-card-background: rgba(28,26,23,.86); --primary-background-color: #1b1a18; --secondary-background-color: #24211d;
          --ha-card-border-color: rgba(255,255,255,.1); --ha-card-border-width: 1px; --ha-card-box-shadow: 0 4px 16px rgba(0,0,0,.35); --divider-color: rgba(255,255,255,.12);
          --state-icon-color: rgba(242,235,224,.8); --paper-item-icon-color: rgba(242,235,224,.8); --state-inactive-color: rgba(242,235,224,.55);
          --mdc-theme-surface: #24211d; --mdc-theme-text-primary-on-background: #f2ebe0; --mdc-theme-on-surface: #f2ebe0; --mdc-dialog-content-ink-color: #f2ebe0;
          --input-fill-color: rgba(255,255,255,.06); --input-ink-color: #f2ebe0; --input-label-ink-color: rgba(242,235,224,.68); --slider-track-color: rgba(255,255,255,.2);
          --ha-color-text-primary: #f2ebe0; --ha-color-text-secondary: rgba(242,235,224,.68); --ha-color-surface-default: #1b1a18; --ha-color-surface-low: #24211d;
          --ha-color-fill-neutral-quiet-resting: rgba(255,255,255,.06); --ha-color-fill-neutral-normal-resting: rgba(255,255,255,.1); --ha-color-border-neutral-quiet: rgba(255,255,255,.1); }
        .rcards .rcbody > *, .rcp .rcprev > * { backdrop-filter: blur(6px); border-radius: var(--ha-card-border-radius, 12px); }
        .rcards.min .rcbody { display: none; }
        .editing .rcards { display: none; }
        @container (max-width: 640px) { .rcards { left: 8px; right: 8px; top: 8px; width: auto; max-height: 44%; } }
        .rcp { position: absolute; right: 10px; top: 112px; bottom: 64px; width: min(320px, 46%); display: flex; flex-direction: column; color: #f2ebe0; z-index: 4;
          background: rgba(12,11,10,.9); backdrop-filter: blur(6px); border: 1px solid rgba(255,255,255,.1); border-radius: 14px; font-size: 12px; overflow: hidden; }
        .rcp header { display: flex; align-items: center; gap: 6px; padding: 8px 10px; border-bottom: 1px solid rgba(255,255,255,.08); }
        .rcp header .ttl { flex: 1; font-weight: 600; font-size: 13px; }
        .rcp button { background: rgba(255,255,255,.06); color: #f2ebe0; border: 1px solid rgba(255,255,255,.12); border-radius: 999px; padding: 4px 10px;
          font: 500 11.5px var(--ha-font-family-body, system-ui); cursor: pointer; }
        .rcp button:disabled { opacity: .35; cursor: default; } .rcp button.primary { background: #3f7d5a; border-color: #4f9a6f; }
        .rcp .rcb { flex: 1; overflow: auto; padding: 8px 10px 12px; display: flex; flex-direction: column; gap: 8px; touch-action: pan-y; }
        .rcp select, .rcp input, .rcp textarea { background: #11100e; color: #f2ebe0; border: 1px solid rgba(255,255,255,.15); border-radius: 8px; padding: 6px 8px;
          font: 12px var(--ha-font-family-body, system-ui); box-sizing: border-box; width: 100%; min-width: 0; }
        .rcp textarea { height: 160px; resize: vertical; font: 11.5px ui-monospace, monospace; }
        .rcp .hint { opacity: .6; font-size: 11px; line-height: 1.35; }
        .rcp .rcadd { display: flex; gap: 6px; flex-wrap: wrap; } .rcp .rcadd input { flex: 1; width: auto; }
        .rcp .rccode { display: grid; gap: 6px; }
        .rcp .rcl { display: grid; gap: 4px; }
        .rcp .rcrow { display: grid; grid-template-columns: 1fr auto; gap: 8px; align-items: center; padding: 6px 8px; border-radius: 8px; background: rgba(255,255,255,.05); }
        .rcp .rcrow .n { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .rcp .rcrow .id { opacity: .5; font-size: 10.5px; }
        .rcp .rcrow button { padding: 2px 7px; margin-left: 2px; }
        .rcp .rcprev { display: flex; flex-direction: column; gap: 8px; }
        @container (max-width: 640px) { .rcp { top: auto; bottom: 108px; left: 8px; right: 8px; width: auto; height: 52%; } }
        .nav button, .bar button, .insp button, .lib button, .ents button, .rcp button, .menu button, .rooms button, .lookp header button, .rcards header button {
          display: inline-flex; align-items: center; justify-content: center; gap: .4em; }
        .menu button { justify-content: flex-start; }
        :is(.bar, .insp, .lib, .ents, .rcp, .menu, .rooms, .lookp, .rcards) button ha-icon { --mdc-icon-size: 16px; flex: none; }
        .nav button ha-icon { --mdc-icon-size: 18px; } .nav .edbtn ha-icon { --mdc-icon-size: 15px; }
        .ents .erow .ok { display: inline-flex; align-items: center; gap: 2px; } .ents .erow .ok ha-icon { --mdc-icon-size: 14px; }
        .insp h4 .tw ha-icon { --mdc-icon-size: 16px; transition: transform .15s; } .insp.min h4 .tw ha-icon { transform: rotate(-90deg); }
        .empty { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: min(360px, calc(100% - 32px)); box-sizing: border-box; z-index: 2;
          display: grid; gap: 6px; padding: 16px 18px; border-radius: 14px; text-align: center; pointer-events: none; color: #f2ebe0;
          background: rgba(20,18,16,.78); border: 1px solid rgba(255,255,255,.1); backdrop-filter: blur(6px); font: 13px/1.45 var(--ha-font-family-body, system-ui); }
        .empty b { font-size: 15px; } .empty span { opacity: .8; } .empty ha-icon { --mdc-icon-size: 14px; margin: 0 2px 0 4px; }
        .conn { position: absolute; left: 50%; top: 10px; transform: translateX(-50%); z-index: 7; display: flex; gap: 8px; align-items: center;
          padding: 6px 12px; border-radius: 999px; background: rgba(20,18,16,.85); color: #f2ebe0; border: 1px solid rgba(255,255,255,.12);
          font: 500 12px var(--ha-font-family-body, system-ui); pointer-events: none; white-space: nowrap; }
        .conn i { width: 8px; height: 8px; border-radius: 50%; background: #e0a050; animation: connp 1.4s ease-in-out infinite; }
        @keyframes connp { 50% { opacity: .3; } }
        .editing .conn { top: 58px; }
        canvas, .ov { transition: filter .6s; } .offline canvas, .offline .ov { filter: saturate(.35) brightness(.8); }
        .hide { display: none !important; }
      </style>
      <ha-card><div class="wrap"><div class="ov"></div><div class="ed"></div><div class="conn hide" role="status"><i></i>Reconnecting to Home Assistant…</div>
        <div class="rooms"></div><div class="rcards hide"><header><span class="ttl"></span><button data-m title="Hide controls">${ic("chevron-up")}</button></header><div class="rcbody"></div></div>
        <div class="nav">
          <button data-v="left" title="Rotate view left">${ic("rotate-left")}</button><button data-v="right" title="Rotate view right">${ic("rotate-right")}</button>
          <button data-v="top" title="Top-down / angled">${ic("floor-plan")}</button><button data-v="out" title="Zoom out">${ic("minus")}</button><button data-v="in" title="Zoom in">${ic("plus")}</button>
          <button data-v="home" title="Whole home">${ic("home-outline")}</button><button class="edbtn" style="display:none" title="Edit the map">${ic("pencil-outline")}Edit</button>
        </div></div></ha-card>`;
      const wrap = (this._wrap = root.querySelector(".wrap"));
      this._ov = root.querySelector(".ov");
      this._ed = root.querySelector(".ed");
      this._edBtn = root.querySelector(".edbtn");
      this._conn = root.querySelector(".conn");
      this._edBtn.addEventListener("click", () => this._enterEdit?.());

      const renderer = (this._renderer = new T.WebGLRenderer({ antialias: true, alpha: true }));
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, cfg.max_pixel_ratio || 2));
      renderer.outputColorSpace = T.SRGBColorSpace;
      renderer.toneMapping = T.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.0;
      renderer.shadowMap.enabled = cfg.shadows !== false;
      renderer.shadowMap.type = T.PCFSoftShadowMap;
      renderer.shadowMap.autoUpdate = false;
      wrap.prepend(renderer.domElement);
      const canvas = renderer.domElement; // three.js keeps the context restorable (it preventDefault()s the loss)
      canvas.addEventListener("webglcontextlost", () => {
        if (this._renderer?.domElement === canvas) {
          this._ctxLost = Date.now();
          this._ctxCheck();
        }
      });
      canvas.addEventListener("webglcontextrestored", () => {
        if (this._renderer?.domElement !== canvas) return;
        this._ctxLost = 0;
        clearTimeout(this._ctxT);
        this._ctxT = null;
        this._renderer.shadowMap.needsUpdate = true;
        this._requestRender();
      });

      this._scene = new T.Scene();
      const cam = (this._cam = new T.OrthographicCamera(-1, 1, 1, -1, -2000, 4000));
      this._home = { pos: new T.Vector3(330, 360, 330), target: new T.Vector3(-10, 5, -10), zoom: 1 };
      cam.position.copy(this._home.pos);
      cam.lookAt(this._home.target);
      this._homeSph = new T.Spherical().setFromVector3(this._home.pos.clone().sub(this._home.target));
      const controls = (this._controls = new OrbitControls(cam, renderer.domElement));
      controls.target.copy(this._home.target);
      controls.enableDamping = true;
      controls.dampingFactor = 0.14;
      controls.minPolarAngle = 0.02;
      controls.maxPolarAngle = 1.2;
      controls.minZoom = 0.6;
      controls.maxZoom = 8;
      controls.screenSpacePanning = false; // pan glides along the floor, not the screen
      controls.zoomToCursor = true; // wheel / pinch zooms toward the pointer
      controls.rotateSpeed = 0.7;
      controls.panSpeed = 1.1;
      controls.zoomSpeed = 1.2;
      // map-style: drag pans, right-drag (or Ctrl/Shift-drag) rotates; touch: one finger pans, two pinch + twist
      controls.mouseButtons = { LEFT: T.MOUSE.PAN, MIDDLE: T.MOUSE.DOLLY, RIGHT: T.MOUSE.ROTATE };
      controls.touches = { ONE: T.TOUCH.PAN, TWO: T.TOUCH.DOLLY_ROTATE };
      // three r160's OrbitControls reports a change on every update() for an orthographic camera (it always flags the zoom),
      // which kept the render loop spinning at full frame rate forever. Only a real camera move counts (_camMoved).
      controls.addEventListener("change", () => {
        this._clampPan();
        if (!this._camMoved()) return;
        this._camMv = true;
        this._syncNav();
        const f = this._focus,
          t = controls.target;
        if (f && !this._fly) {
          // panning well away from the framed room ends the see-through view
          const [x1, x2, y1, y2] = f.room.rect,
            x = t.x + CX,
            y = t.z + CY,
            M = 40;
          if (x < x1 - M || x > x2 + M || y < y1 - M || y > y2 + M) this._setFocus(null);
        }
        this._requestRender();
      });
      controls.addEventListener("start", () => {
        this._fly = null;
        this._moved = true;
        this._setActiveRoom(null);
      });
      const nav = root.querySelector(".nav");
      nav.addEventListener("click", (ev) => {
        const a = ev.target.closest("button")?.dataset.v;
        if (!a) return;
        if (a !== "home") this._moved = true;
        if (a === "home") this._focusRoom(null);
        else if (a === "left" || a === "right") this._orbitBy(a === "left" ? -Math.PI / 2 : Math.PI / 2);
        else if (a === "top") this._toggleTop();
        else if (a === "in" || a === "out") this._flyTo({ zoom: cam.zoom * (a === "in" ? 1.4 : 1 / 1.4) }, 250);
      });
      this._buildRoomBar();
      root.querySelector(".rcards header").addEventListener("click", () => {
        // open/collapse the controls, then re-frame the view for the new space
        this._rcMin = !this._rcMin;
        this._showRoomCards(this._rcRoom);
        this._fitRoom = this._rcRoom === "home" ? null : this._rooms().find((r) => r.name === this._rcRoom) || null;
        this._moved = false;
        this._setActiveRoom(this._fitRoom ? this._fitRoom.name : "");
        requestAnimationFrame(() => {
          if (this._renderer) {
            this._applyOffset();
            this._frame(this._fitRoom, 450);
            this._requestRender();
          }
        });
      });
      this._showRoomCards("home");
      this._setActiveRoom(""); // the whole-home view is where it starts
      this._idleKick = () => this._armIdle(); // any touch, click, wheel or key restarts the idle countdown
      for (const t of ["pointerdown", "wheel", "keydown"])
        wrap.addEventListener(t, this._idleKick, { capture: true, passive: true });
      renderer.domElement.addEventListener("dblclick", (ev) => {
        if (!this._edit) {
          const r = this._roomAt(ev);
          if (r) this._focusRoom(r);
        }
      });
      renderer.domElement.addEventListener("contextmenu", (ev) => ev.preventDefault());
      this._texListener = () => this._renderer && this._requestRender();
      document.addEventListener("ha-3dhome-tex", this._texListener);
      this._visListener = () => {
        if (document.hidden) {
          this._hiddenAt = Date.now();
          return;
        }
        if (!this._renderer) return;
        this._shownAt = Date.now();
        this._requestRender();
        this._ctxCheck();
        if (this._shownAt - (this._hiddenAt || this._shownAt) > 60000) this._probeConn(); // back from a long sleep
      };
      document.addEventListener("visibilitychange", this._visListener);
      // the browser's own network state: going offline counts even before the socket notices, and coming online or
      // a page restored from the back/forward cache checks the socket still works
      this._netListener = (ev) => {
        if (!this._renderer) return;
        this._connState();
        if (ev.type !== "offline") {
          this._requestRender();
          this._probeConn();
        }
      };
      for (const t of ["online", "offline", "pageshow"]) window.addEventListener(t, this._netListener);
      this._rebuild();
      this._bindPicking();
      this._ro = new ResizeObserver(() => this._resize());
      this._ro.observe(wrap);
      this._ro.observe(root.querySelector(".rcards")); // the room controls resizing moves the safe area (see _safeArea)
      if (this._camKeep) {
        // rebuilt after a lost context: keep the view the user had
        const k = this._camKeep;
        this._camKeep = null;
        this._fitRoom = null;
        this._fly = null;
        this._moved = true;
        cam.position.fromArray(k.pos);
        controls.target.fromArray(k.target);
        cam.zoom = k.zoom;
        cam.updateProjectionMatrix();
      }
      this._resize();
      this._ready = true;
      this._connState();
      this._update();
      if (this._hass?.user?.is_admin && this._enterEdit) this._edBtn.style.display = "";
      this._edReady = () => {
        if (this._edBtn && this._hass?.user?.is_admin && !this._edit) this._edBtn.style.display = "";
      };
      window.addEventListener("ha-3dhome-editor-ready", this._edReady);
    }
  };
