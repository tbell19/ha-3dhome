/* Panel test: the 3D Home sidebar page (<ha-3dhome-panel>) the way the ha_3dhome integration shows it.
 *
 * A fake hass plays the integration's side in the page: ha_3dhome/config/subscribe pushes the stored config and every
 * later save, ha_3dhome/config/save checks the revision it started from. The sample home sits on a dashboard, ready to
 * be imported.
 *
 *   npm run test:panel [-- --dist]
 *
 * Checks: an empty panel offers the dashboard's map and copies it in, Save writes to the integration and not to a
 * dashboard, a save from another device appears without a new WebGL context, edits in progress aren't pulled away and
 * their Save reports the clash, the sidebar button on narrow screens, the offer (asked once) and the ⋮ menu item that make Home Assistant open on the page,
 * nothing offered to non-admins.
 */
const path = require("path");
const { OUT, CODE, SAMPLE_HOME, launch, check, report } = require("./harness");

/* the sample home as an old (pre-v6) dashboard held it: in the iso-home strategy, with a railing and an old-style
 * string light, which the import leaves out and brings up to date */
const OLD_DASHBOARD = {
  strategy: {
    type: "custom:iso-home",
    title: "Home",
    ...SAMPLE_HOME,
    scene: {
      ...SAMPLE_HOME.scene,
      overlays: [...SAMPLE_HOME.scene.overlays, { type: "railing", x: 500, x_end: 450, y1: 500, y2: 540, h: 20 }],
    },
    lights: [
      ...SAMPLE_HOME.lights,
      {
        entity: "light.old_string",
        kind: "string",
        z: 37,
        points: [
          [200, 400],
          [300, 400],
        ],
      },
    ],
  },
};

(async () => {
  const { browser, page: p, errors, ev, wait, until } = await launch({ viewport: { width: 1100, height: 700 } });
  const html = `<!doctype html><meta charset=utf-8><body style="margin:0"><div id=host></div>
<script>customElements.define('ha-card',class extends HTMLElement{connectedCallback(){this.style.display='block'}});
customElements.define('ha-icon',class extends HTMLElement{});
customElements.define('ha-menu-button',class extends HTMLElement{connectedCallback(){this.textContent='☰'}});
window.__ctx=0; const _gc=HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext=function(t,...a){const c=_gc.call(this,t,...a); if(c&&/webgl/.test(t)&&!this.__counted){this.__counted=1;__ctx++} return c};
// the integration's side: one stored config per panel, pushed to followers on every save
window.server={E1:{config:{},rev:0,subs:[]},E2:{config:{},rev:0,subs:[]},saves:[],calls:[],
  push(id){const s=this[id];for(const cb of s.subs)cb(JSON.parse(JSON.stringify({config:s.config,rev:s.rev})))},
  saveFrom(id,config){const s=this[id];s.config=config;s.rev++;this.push(id)}};
const __dash=${JSON.stringify(OLD_DASHBOARD)};
window.makeHass=(admin)=>({states:{},user:{is_admin:admin},services:{},callService:async()=>{},
  connection:{subscribeEvents:async()=>()=>{},
    subscribeMessage:async(cb,m)=>{const s=server[m.entry_id];s.subs.push(cb);setTimeout(()=>server.push(m.entry_id),0);return async()=>{s.subs.splice(s.subs.indexOf(cb),1)}}},
  callWS:async(m)=>{server.calls.push(m.type);
    if(m.type==='ha_3dhome/config/save'){const s=server[m.entry_id];server.saves.push(m);
      if(m.rev!==s.rev)throw {code:'conflict',message:'The map was saved from another device meanwhile. Cancel to see it, then edit again.'};
      s.config=m.config;s.rev++;server.push(m.entry_id);return {rev:s.rev}}
    if(m.type==='frontend/set_user_data'){if(m.key==='ha_3dhome')server.own=m.value;else server.userData=m.value;return null}
    if(m.type==='frontend/get_user_data')return {value:m.key==='ha_3dhome'?server.own||null:null};
    if(m.type==='lovelace/dashboards/list')return [{url_path:'juniper',title:'Juniper House',mode:'storage'},{url_path:'energy-plus',title:'Energy'}];
    if(m.type==='lovelace/config')return m.url_path==='juniper'?JSON.parse(JSON.stringify(__dash)):{views:[{cards:[]}]};
    throw new Error('unexpected '+m.type)}});
</script>
<script type=module>${CODE.editor}</script>
<script type=module>${CODE.core}
const __panel=document.createElement('ha-3dhome-panel');
__panel.hass=makeHass(true); __panel.narrow=false; __panel.panel={url_path:'3d-home',config:{entry_id:'E1'}};
document.getElementById('host').append(__panel);
window.panel=__panel; window.card=__panel.shadowRoot.querySelector('ha-3dhome-map');</script>`;
  await p.route("http://ha.test/**", (r) => r.fulfill({ body: html, contentType: "text/html" }));

  const rooms = () => ev(`[...card.shadowRoot.querySelectorAll('.rooms button')].map(b=>b.textContent)`);
  const importBox = `panel.shadowRoot.querySelector('.import')`;

  await p.goto("http://ha.test/3d-home");
  check("the panel element is registered", await ev(`!!customElements.get('ha-3dhome-panel')`));
  check("an empty panel shows the card's how-to-start hint", await until(`!!card.shadowRoot?.querySelector('.empty')`));
  check(
    "the hint says Save keeps the map here",
    await ev(`card.shadowRoot.querySelector('.empty').textContent.includes('Save keeps them here')`),
  );
  check(
    "it offers the map found on a dashboard",
    await until(`!${importBox}.classList.contains('hide')`),
    await ev(`${importBox}.textContent`),
  );
  check(
    "only dashboards that have a map are offered",
    (await ev(`[...${importBox}.querySelectorAll('button')].map(b=>b.textContent).join()`)) ===
      "Copy from Juniper House",
  );
  await p.screenshot({ path: path.join(OUT, "panel-empty.png") });
  await ev(`${importBox}.querySelector('button').click()`);
  check("copying stores the map in the integration", await until(`server.E1.rev===1 && !!server.E1.config.scene`));
  check(
    "the stored config leaves out what the panel sets itself",
    await ev(`!('type' in server.E1.config) && !('fill' in server.E1.config) && !('dashboard' in server.E1.config)`),
  );
  check(
    "the copied map shows",
    await until(`card.shadowRoot.querySelectorAll('.rooms button').length>=8`),
    (await rooms()).join(),
  );
  check(
    "the copy is brought up to date (retired pieces left out, old string lights converted)",
    await ev(
      `!server.E1.config.scene.overlays.some(o=>o.type==='railing') && server.E1.config.lights.at(-1).fixture==='string' && !('kind' in server.E1.config.lights.at(-1)) && !('title' in server.E1.config)`,
    ),
  );
  check("it says where the map came from", await ev(`${importBox}.textContent.includes('Juniper House')`));
  await ev(`${importBox}.querySelector('button').click()`);
  check("the note can be closed", await ev(`${importBox}.classList.contains('hide')`));
  await wait(500);
  await p.screenshot({ path: path.join(OUT, "panel-map.png") });

  // edit and save: to the integration, not a dashboard, and without restarting the scene
  await ev(`window.__r=card._renderer`);
  const ctx0 = await ev(`__ctx`); // WebGL contexts made so far
  await ev(`card._openEditor()`);
  check("Edit works in the panel", await until(`!!card._edit`));
  await ev(`card._editor._mutate(()=>{card._work.scene.floors[0].name='snug';return []})`);
  await ev(`card._editor._save()`);
  check("Save writes to the integration", await until(`server.E1.rev===2 && !card._edit`));
  check("Save started from the revision shown", await ev(`server.saves.at(-1).rev===1`));
  check("Save doesn't touch any dashboard", await ev(`!server.calls.includes('lovelace/config/save')`));
  check("the scene is kept (same renderer)", await ev(`card._renderer===__r`));
  check(
    "the saved map shows",
    (await rooms()).some((r) => /snug/i.test(r)),
    (await rooms()).join(),
  );
  check("the toast says Saved", await ev(`(card.shadowRoot.querySelector('.toast')?.textContent||'Saved')==='Saved'`));

  // a save on another device
  await ev(
    `(()=>{const c=JSON.parse(JSON.stringify(server.E1.config));c.scene.floors[0].name='den';server.saveFrom('E1',c)})()`,
  );
  check(
    "a save on another device shows up",
    await until(`[...card.shadowRoot.querySelectorAll('.rooms button')].some(b=>/den/i.test(b.textContent))`),
  );
  check("…in the running scene (same renderer, no new context)", await ev(`card._renderer===__r && __ctx===${ctx0}`));

  // another device saves while editing here
  await ev(`card._openEditor()`);
  await until(`!!card._edit`);
  await ev(`card._editor._mutate(()=>{card._work.scene.floors[0].name='library';return []})`);
  await ev(
    `(()=>{const c=JSON.parse(JSON.stringify(server.E1.config));c.scene.floors[0].name='parlour';server.saveFrom('E1',c)})()`,
  );
  await wait(300);
  check(
    "edits in progress aren't pulled away",
    await ev(`!!card._edit && card._work.scene.floors[0].name==='library'`),
  );
  await ev(`card._editor._save()`);
  await wait(300);
  check(
    "their Save reports the clash and keeps editing",
    await ev(`!!card._edit && /another device/.test(card.shadowRoot.querySelector('.toast')?.textContent||'')`),
    await ev(`card.shadowRoot.querySelector('.toast')?.textContent`),
  );
  check("nothing was overwritten", await ev(`server.E1.config.scene.floors[0].name==='parlour'`));
  await ev(`card._editor._exitEdit(false)`);
  check(
    "leaving the editor shows the other device's map",
    await until(`[...card.shadowRoot.querySelectorAll('.rooms button')].some(b=>/parlour/i.test(b.textContent))`),
    (await rooms()).join(),
  );

  // narrow screens: the sidebar button
  check(
    "no sidebar button on a wide screen",
    await ev(`getComputedStyle(panel.shadowRoot.querySelector('.menu')).display==='none'`),
  );
  await ev(`panel.narrow=true`);
  check(
    "narrow screens get the sidebar button",
    await ev(
      `getComputedStyle(panel.shadowRoot.querySelector('.menu')).display!=='none' && panel.shadowRoot.querySelector('.menu').narrow===true`,
    ),
  );
  await p.screenshot({ path: path.join(OUT, "panel-narrow.png") });

  // safe areas: where Home Assistant leaves them to the panel, the map fills the screen and only its controls move in
  const edge = (q) =>
    `(()=>{const r=card.shadowRoot.querySelector('${q}').getBoundingClientRect();return [r.top,r.bottom]})()`;
  const rooms0 = await ev(edge(".rooms"));
  await ev(`document.documentElement.style.setProperty('--safe-area-inset-top','40px');
    document.documentElement.style.setProperty('--safe-area-inset-bottom','30px');
    panel.panel={url_path:'3d-home',config:{entry_id:'E1',_panel_custom:{handle_safe_area:true}}}`);
  await wait(300);
  check(
    "edge to edge: the map fills the screen",
    await ev(`panel.hasAttribute('edge-to-edge') && Math.abs(card.getBoundingClientRect().height-innerHeight)<1`),
  );
  const rooms1 = await ev(edge(".rooms"));
  check("edge to edge: the room bar clears the bottom inset", Math.abs(rooms0[1] - 30 - rooms1[1]) < 1, rooms1.join());
  check(
    "edge to edge: the sidebar button clears the top inset",
    await ev(`Math.abs(panel.shadowRoot.querySelector('.menu').getBoundingClientRect().top-44)<1`),
  );
  check("edge to edge: the camera keeps the view out of the insets", await ev(`card._safeArea().y>=40`));
  await ev(`card._openEditor()`);
  await until(`!!card._edit`);
  check(
    "edge to edge: the editor's toolbar clears the top inset",
    await ev(`card.shadowRoot.querySelector('.bar').getBoundingClientRect().top>=40`),
  );
  await ev(`card._editor._exitEdit(false)`);
  await until(`!card._edit`);
  await ev(`document.documentElement.style.removeProperty('--safe-area-inset-top');
    document.documentElement.style.removeProperty('--safe-area-inset-bottom');
    panel.panel={url_path:'3d-home',config:{entry_id:'E1'}}`);
  await wait(300);

  // Home Assistant may make a new panel element for the same page: the map moves over, scene and all
  await ev(`(()=>{const q=document.createElement('ha-3dhome-panel');panel.remove();q.hass=makeHass(true);q.panel={url_path:'3d-home',config:{entry_id:'E1'}};
    document.getElementById('host').append(q);window.panel=q})()`);
  await wait(500);
  check(
    "a new panel element for the same page keeps the map's scene",
    await ev(`panel.shadowRoot.querySelector('ha-3dhome-map')===card && card._renderer===__r && __ctx===${ctx0}`),
  );
  check("…and still follows saves", await ev(`server.E1.subs.length===1`));

  // opening Home Assistant on this page (the user's default_panel): asked once, then in the map's ⋮ menu
  const offer = `panel.shadowRoot.querySelector('.offer')`;
  const more = `card.shadowRoot.querySelector('.nav .morebtn')`;
  const item = `card.shadowRoot.querySelector('.moremenu .homeitem')`;
  // Home Assistant hands every panel a new hass once the user's settings change
  const userData = (data) => ev(`panel.hass=Object.assign(makeHass(true),{userData:${JSON.stringify(data)}})`);
  check(
    "nothing is asked before Home Assistant has the user's settings",
    await ev(`${offer}.classList.contains('hide')`),
  );
  await userData({ showEntityIdPicker: true });
  check(
    "a page with a map asks once whether Home Assistant should open on it",
    await until(`!${offer}.classList.contains('hide')`),
  );
  await ev(`${offer}.querySelector('[data-a="yes"]').click()`);
  await wait(100);
  check(
    "Open here makes this page the user's default, keeping their other settings",
    await ev(`server.userData.default_panel==='3d-home' && server.userData.showEntityIdPicker===true`),
  );
  check(
    "…and remembers it asked, for the user",
    await ev(`${offer}.classList.contains('hide') && server.own.home_asked.includes('3d-home')`),
  );
  await userData({ showEntityIdPicker: true, default_panel: "3d-home" });
  check(
    "the ⋮ menu shows it ticked",
    await until(`!${more}.classList.contains('hide') && /checkbox-marked/.test(${item}.innerHTML)`),
  );
  await ev(`${more}.click()`);
  check("⋮ opens the menu", await ev(`!card.shadowRoot.querySelector('.moremenu').classList.contains('hide')`));
  await p.screenshot({ path: path.join(OUT, "panel-more-menu.png") });
  await ev(`${item}.click()`);
  await wait(100);
  check(
    "unticking goes back to the page Home Assistant picks, and closes the menu",
    await ev(
      `!('default_panel' in JSON.parse(JSON.stringify(server.userData))) && server.userData.showEntityIdPicker===true && card.shadowRoot.querySelector('.moremenu').classList.contains('hide')`,
    ),
  );
  await userData({ showEntityIdPicker: true });
  // a new page element (another device, or a reload): already asked, so it doesn't ask again
  await ev(`(()=>{const q=document.createElement('ha-3dhome-panel');panel.remove();q.hass=Object.assign(makeHass(true),{userData:{}});q.panel={url_path:'3d-home',config:{entry_id:'E1'}};
    document.getElementById('host').append(q);window.panel=q})()`);
  await wait(500);
  check("it isn't asked again once answered", await ev(`${offer}.classList.contains('hide')`));

  // someone who isn't an administrator, on another empty panel
  await ev(`(()=>{const q=document.createElement('ha-3dhome-panel');q.hass=makeHass(false);q.panel={url_path:'other',config:{entry_id:'E2'}};
    q.style.cssText='position:fixed;left:0;top:0;width:400px;height:300px';document.body.append(q);window.panel2=q})()`);
  await wait(1500);
  check(
    "non-admins get no import offer",
    await ev(`panel2.shadowRoot.querySelector('.import').classList.contains('hide')`),
  );
  check(
    "…and no Edit button",
    await ev(
      `(()=>{const b=panel2.shadowRoot.querySelector('ha-3dhome-map').shadowRoot?.querySelector('.edbtn');return !b||b.style.display==='none'})()`,
    ),
  );

  check("no page errors", errors.length === 0, errors.join(" | "));
  await browser.close();
  report("panel checks");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
