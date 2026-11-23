/* Scan view test: the 3D Home page showing a 3D scan (Gaussian splat) instead of a drawn floor plan.
 *
 *   npm run test:splat [-- --dist]
 *
 * A fictional room (tools/mock/build-sample-splat.js) stands in for a phone scan; the fake integration answers the file
 * and scan endpoints. Checks: an empty page offers to make a scan, uploading a scan file saves it and shows it, placing
 * a device by tapping the scan, levelling the floor from three taps, Save, live pins (tap toggles, the light glows),
 * taking photos with a (fake) camera and starting a build, the build's progress, "Draw a floor plan instead", non-admins.
 */
const path = require("path");
const { OUT, launch, panelPage, serve, check, report } = require("./harness");
const { sampleRoom, toSplat, scanPoint } = require("./mock/build-sample-splat");

const SPLAT = toSplat(sampleRoom());
const states = {
  "light.lamp": {
    state: "off",
    attributes: { friendly_name: "Floor lamp", brightness: 200, rgb_color: [255, 180, 90] },
  },
  "sensor.lounge_temp": {
    state: "21.5",
    attributes: { friendly_name: "Lounge", unit_of_measurement: "°C", device_class: "temperature" },
  },
  "sun.sun": { state: "above_horizon", attributes: { elevation: 30 } },
};

/** the fake integration's file and scan endpoints; `seen` records every request */
function endpoints(seen) {
  return (r, u) => {
    const url = new URL(u);
    if (!url.pathname.startsWith("/api/ha_3dhome/")) return null;
    const req = r.request();
    seen.push({ method: req.method(), path: url.pathname + url.search, auth: req.headers()["authorization"] || "" });
    if (req.method() === "GET" && url.pathname === "/api/ha_3dhome/splat/E1/room.splat")
      return r.fulfill({ body: SPLAT, contentType: "application/octet-stream" });
    if (req.method() === "POST" && url.pathname === "/api/ha_3dhome/splat/E1")
      return r.fulfill({
        body: JSON.stringify({ src: url.searchParams.get("name") }),
        contentType: "application/json",
      });
    if (req.method() === "POST" && url.pathname.startsWith("/api/ha_3dhome/scan/E1/"))
      return r.fulfill({ body: "{}", contentType: "application/json" });
    return r.fulfill({ status: 404, body: "{}" });
  };
}

// the scan job subscription and the build call, in the page
const head = `window.jobSubs=[];window.wsLog=[];
window.extraSub=async(cb,m)=>{jobSubs.push(cb);setTimeout(()=>cb({job:null}),0);return async()=>{}};
window.pushJob=(job)=>jobSubs.forEach((cb)=>cb({job}));
window.extraWS=async(m)=>{wsLog.push(m);
  if(m.type==='auth/sign_path')return {path:m.path+'?authSig=SIG'};
  if(m.type==='ha_3dhome/scan/build'){const job={scan_id:m.scan_id,state:'queued'};setTimeout(()=>pushJob(job),0);return job}
  return null};`;

(async () => {
  const {
    browser,
    page: p,
    errors,
    ev,
    wait,
    until,
  } = await launch({
    viewport: { width: 1100, height: 720 },
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      "--unsafely-treat-insecure-origin-as-secure=http://ha.test", // the camera needs a secure page, as Home Assistant over https is
    ],
  });
  const seen = [];
  await serve(
    p,
    panelPage({ config: {}, states, head, hass: "{auth:{data:{access_token:'TOKEN'}}}" }),
    endpoints(seen),
  );

  /* ----- an empty page ----- */
  check("an empty page shows the scan view", await until(`card?.localName==='ha-3dhome-splat'`));
  check("it offers to make a scan", await until(`!!card.shadowRoot?.querySelector('.start .scan-camera')`));
  check(
    "three ways in: camera, video, upload",
    await ev(`['.scan-camera','.scan-video','.upload'].every((s)=>card.shadowRoot.querySelector(s))`),
  );
  check("no floor plan map was started", await ev(`!panel.shadowRoot.querySelector('ha-3dhome-map')`));
  await p.screenshot({ path: path.join(OUT, "splat-start.png") });

  /* ----- upload a scan file ----- */
  const chooser = p.waitForEvent("filechooser");
  await ev(`card.shadowRoot.querySelector('.upload').click()`);
  await (await chooser).setFiles({ name: "room.splat", mimeType: "application/octet-stream", buffer: SPLAT });
  check("the file goes to the integration", await until(`server.rev===2`), JSON.stringify(seen.slice(-1)));
  const up = seen.find((s) => s.method === "POST" && s.path.startsWith("/api/ha_3dhome/splat/E1"));
  check("…with the user's token", up?.auth === "Bearer TOKEN");
  check("Save keeps it in the config", await ev(`server.config.splat?.src==='room.splat'`));
  check("the scan loads", await until(`card._load?.phase==='done'`, 30000), await ev(`JSON.stringify(card._load)`));
  check(
    "…from a signed URL",
    seen.some((s) => s.method === "GET" && s.path.includes("authSig=SIG")),
  );
  check("every splat is there", (await ev(`card._drop.splatMesh.getSplatCount()`)) === SPLAT.length / 32);
  await wait(1500);
  const pixels = await ev(`(()=>{const c=card._renderer.domElement;const g=card._renderer.getContext();
    const px=new Uint8Array(4*64);card._renderer.render(card._scene,card._camera);
    g.readPixels(c.width/2-32,c.height/2,64,1,g.RGBA,g.UNSIGNED_BYTE,px);let lit=0;for(let i=0;i<64;i++)if(Math.abs(px[i*4]-0x1b)>12)lit++;return lit})()`);
  check("the scan is drawn", pixels > 20, `${pixels}/64 pixels`);
  check("it suggests levelling the floor", await ev(`!!card.shadowRoot.querySelector('.level-tip')`));
  await p.screenshot({ path: path.join(OUT, "splat-loaded.png") });

  /* ----- edit: level the floor from three taps ----- */
  const canvasAt = async (pt) =>
    ev(`(()=>{const v=card._level.localToWorld(new card._three.Vector3(${pt.join(",")})).project(card._camera);
      const r=card._renderer.domElement.getBoundingClientRect();return [r.left+(v.x+1)/2*r.width, r.top+(1-v.y)/2*r.height]})()`);
  const tap = async (pt) => {
    const [x, y] = await canvasAt(pt);
    await p.mouse.click(x, y);
    await wait(150);
  };
  await ev(`card.shadowRoot.querySelector('.level-tip button').click()`);
  check("Level the floor starts editing", await until(`card._edit?.tool==='level'`));
  const floor = [
    [0.6, 0, 3.6],
    [4.5, 0, 3.7],
    [4.6, 0, 1.6],
  ].map(scanPoint);
  for (const pt of floor) await tap(pt);
  check(
    "three taps level it",
    await until(`!!card._edit.work.align`),
    await ev(`JSON.stringify(card._edit.work.align)`),
  );
  const levelled = await ev(`(()=>{const a=card._edit.work.align;const o=new card._three.Object3D();
    o.quaternion.set(...a.q);o.position.set(...a.t);o.updateMatrixWorld();
    return ${JSON.stringify(
      [
        [1, 0, 1], // floor
        [4, 0, 3], // floor
        [2.5, 0, 0.2], // floor, by the back wall
        [2.5, 2.4, 0.01], // the top of the back wall
      ].map((p) => scanPoint(p)),
    )}
      .map((p)=>o.localToWorld(new card._three.Vector3(...p)).y)})()`);
  check(
    "the floor is now level at height 0",
    levelled.slice(0, 3).every((y) => Math.abs(y) < 0.04),
    levelled.map((y) => y.toFixed(3)).join(", "),
  );
  check("and the walls go up", levelled[3] > 2.3, levelled[3].toFixed(2));
  await wait(500);
  await p.screenshot({ path: path.join(OUT, "splat-levelled.png") });

  /* ----- edit: place a device by tapping the scan ----- */
  await ev(`card.shadowRoot.querySelector('.bar .add').click()`);
  check("Add device asks which", await until(`!!card.shadowRoot.querySelector('.add-entity input')`));
  await p.fill(".add-entity input", "light.lamp");
  await ev(`card.shadowRoot.querySelector('.add-entity .place').click()`);
  check("then waits for a tap", await until(`card._edit.tool==='place'`));
  const shade = scanPoint([4.25, 1.8, 0.8]); // the front of the lamp shade
  await tap(shade);
  const pin = await ev(`card._edit.work.pins[0]`);
  check("a tap on the scan places it", pin?.entity === "light.lamp", JSON.stringify(pin));
  const off = pin && Math.hypot(...pin.p.map((v, k) => v - shade[k]));
  check("…on the lamp, where it was tapped", off < 0.3, off?.toFixed(3));
  check("…and selects it", await until(`!!card.shadowRoot.querySelector('.insp')`));
  check("its chip shows", await until(`!!card.shadowRoot.querySelector('.pin[data-entity="light.lamp"]')`));
  await tap(scanPoint([3.2, 0, 3.5]));
  await ev(`card._startPlace('sensor.lounge_temp')`);
  await tap(scanPoint([2.0, 0.45, 0.7])); // the sofa seat
  check("a second device", await until(`card._edit.work.pins.length===2`));
  await ev(`card._setStartView()`);
  await ev(`card.shadowRoot.querySelector('.save').click()`);
  check("Save writes the scan's layout", await until(`server.rev===3 && !card._edit`));
  check(
    "…pins, levelling and the start view",
    await ev(
      `(()=>{const s=server.config.splat;return s.pins.length===2&&!!s.align&&!!s.view&&s.src==='room.splat'})()`,
    ),
  );

  /* ----- live pins ----- */
  await ev(
    `card.shadowRoot.querySelector('.pin[data-entity="light.lamp"]').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))`,
  );
  await ev(
    `card.shadowRoot.querySelector('.pin[data-entity="light.lamp"]').dispatchEvent(new PointerEvent('pointerup',{bubbles:true}))`,
  );
  check(
    "a tap on a light toggles it",
    await until(`calls.some((c)=>c[0]==='homeassistant'&&c[1]==='toggle'&&c[2].entity_id==='light.lamp')`),
  );
  check("the light's glow is off while it's off", await ev(`card._glows[0] && !card._glows[0].visible`));
  await ev(
    `panel.hass=makeHass({states:{...card.hass.states,'light.lamp':{state:'on',attributes:{...card.hass.states['light.lamp'].attributes}}}})`,
  );
  check("it glows once on", await until(`card._glows[0].visible && card._glows[0].material.opacity>0.5`));
  check("the scan takes live lighting", await ev(`card._lit`));
  await ev(
    `panel.hass=makeHass({states:{...card.hass.states,'sun.sun':{state:'below_horizon',attributes:{elevation:-20}}}})`,
  );
  await until(`card._drop.splatMesh.material.uniforms.ha3dAmbient.value<1`);
  const u = (n) => ev(`card._drop.splatMesh.material.uniforms.${n}.value`);
  check("after dark the scan dims", Math.abs((await u("ha3dAmbient")) - 0.25) < 1e-6, String(await u("ha3dAmbient")));
  check("the lamp lights the scan around it", (await u("ha3dCount")) === 1);
  // the floor near the lamp, with its halo hidden: brighter with the lamp on than off
  const floorNear = scanPoint([3.7, 0, 1.2]);
  const bright = () =>
    ev(`(()=>{card._glows.forEach((g)=>g&&(g.visible=false));const v=card._level.localToWorld(new card._three.Vector3(${floorNear.join(",")})).project(card._camera);
      const c=card._renderer.domElement,g=card._renderer.getContext();card._renderer.render(card._scene,card._camera);
      const x=Math.round((v.x+1)/2*c.width),y=Math.round((v.y+1)/2*c.height),px=new Uint8Array(4*25);
      g.readPixels(x-2,y-2,5,5,g.RGBA,g.UNSIGNED_BYTE,px);let s=0;for(let i=0;i<25;i++)s+=px[i*4]+px[i*4+1]+px[i*4+2];return s/25})()`);
  const on = await bright();
  await ev(
    `panel.hass=makeHass({states:{...card.hass.states,'light.lamp':{state:'off',attributes:{...card.hass.states['light.lamp'].attributes}}}})`,
  );
  await until(`card._drop.splatMesh.material.uniforms.ha3dCount.value===0`);
  const offB = await bright();
  check("the floor near the lamp is lit by it", on > offB * 1.3, `${on.toFixed(0)} on vs ${offB.toFixed(0)} off`);
  await ev(
    `panel.hass=makeHass({states:{...card.hass.states,'sun.sun':{state:'above_horizon',attributes:{elevation:30}}}})`,
  );
  check("by day the scan is as filmed", await until(`card._drop.splatMesh.material.uniforms.ha3dAmbient.value===1`));
  await ev(
    `panel.hass=makeHass({states:{...card.hass.states,'sun.sun':{state:'below_horizon',attributes:{elevation:-20}},'light.lamp':{state:'on',attributes:{...card.hass.states['light.lamp'].attributes}}}})`,
  );
  await until(`card._glows[0].visible`);
  check(
    "its chip shows it on",
    await until(`card.shadowRoot.querySelector('.pin[data-entity="light.lamp"]').classList.contains('act')`),
  );
  check(
    "the sensor's chip shows its value",
    await ev(`card.shadowRoot.querySelector('.pin[data-entity="sensor.lounge_temp"]').textContent.includes('21.5')`),
  );
  const more =
    await ev(`new Promise((ok)=>{panel.addEventListener('hass-more-info',(e)=>ok(e.detail.entityId),{once:true});
    const el=card.shadowRoot.querySelector('.pin[data-entity="sensor.lounge_temp"]');
    el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));el.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}))})`);
  check("a tap on a sensor opens its details", more === "sensor.lounge_temp");
  await wait(600);
  await p.screenshot({ path: path.join(OUT, "splat-pins.png") });

  /* ----- take photos with the camera, then build ----- */
  await ev(`card._openScan(null)`);
  check("the photo screen opens", await until(`!!card.shadowRoot.querySelector('.scan video')`));
  check(
    "the camera starts",
    await until(`card._taker?.state.source==='camera'`),
    await ev(`card.shadowRoot.querySelector('.tips')?.textContent`),
  );
  await ev(`card._taker.picker.opts.minDifference=0.5`); // the fake camera's picture hardly changes
  await ev(`card.shadowRoot.querySelector('.scan .rec').click()`);
  check(
    "recording keeps photos",
    await until(`card._taker.state.kept>=3`, 20000),
    await ev(`JSON.stringify(card._taker.state)`),
  );
  check("…and uploads them", await until(`card._taker.state.uploaded>=3`));
  const photos = seen.filter((s) => s.method === "POST" && s.path.startsWith("/api/ha_3dhome/scan/E1/"));
  check(
    "photos go to the scan's folder, numbered",
    /\/scan\/E1\/[\w-]+\/1$/.test(photos[0]?.path || ""),
    photos[0]?.path,
  );
  check("Build waits for enough photos", await ev(`card.shadowRoot.querySelector('.scan .finish').disabled`));
  await p.screenshot({ path: path.join(OUT, "splat-scan.png") });
  await ev(`card._taker.state.kept=60`); // as if the walk round the room were done
  await ev(`new Promise((ok)=>setTimeout(ok,50))`);
  await ev(`card.shadowRoot.querySelector('.scan .finish').click()`);
  check("Build asks the integration to build", await until(`wsLog.some((m)=>m.type==='ha_3dhome/scan/build')`));
  check("…and closes the photo screen", await until(`!card._scanning`));
  check("the camera is let go", await ev(`!card.shadowRoot.querySelector('.scan')`));
  await ev(`pushJob({scan_id:'x',state:'building',progress:0.42,message:'Training: step 2900 of 7000'})`);
  check(
    "the build's progress shows",
    await until(`card.shadowRoot.querySelector('.banner .job')?.textContent.includes('Building')`),
  );
  check("…with its percentage", await ev(`card.shadowRoot.querySelector('.banner .job').textContent.includes('42%')`));
  await p.screenshot({ path: path.join(OUT, "splat-building.png") });
  await ev(`pushJob({scan_id:'x',state:'done'})`);
  check("a finished build hides it", await until(`!card.shadowRoot.querySelector('.banner .job')`));

  /* ----- phone width ----- */
  await p.setViewportSize({ width: 390, height: 800 });
  await ev(`card._enterEdit()`);
  await ev(`card._edit.sel=0;card._ui()`);
  await wait(600);
  check(
    "at phone width the tools fit across",
    await ev(
      `(()=>{const b=card.shadowRoot.querySelector('.bar.top').getBoundingClientRect();return b.right<=390&&b.left>=0})()`,
    ),
  );
  check(
    "the inspector is a bottom sheet",
    await ev(
      `(()=>{const r=card.shadowRoot.querySelector('.insp').getBoundingClientRect();return r.left>=0&&r.right<=390&&r.bottom>600})()`,
    ),
  );
  await p.screenshot({ path: path.join(OUT, "splat-phone.png") });
  await ev(`card._exitEdit()`);
  await ev(`card._teardown()`);
  check("teardown lets go of the scan and WebGL", await ev(`!card._renderer && !card._drop && !card._glows.length`));

  /* ----- an empty page: draw a floor plan instead ----- */
  const p2 = await p.context().newPage();
  await serve(p2, panelPage({ config: {}, states, head }), endpoints([]));
  const ev2 = (s) => p2.evaluate(s);
  const until2 = async (expr, ms = 15000) => {
    for (const t = Date.now(); Date.now() - t < ms; await p2.waitForTimeout(100)) if (await ev2(expr)) return true;
    return false;
  };
  await until2(`!!card?.shadowRoot?.querySelector('.plan')`);
  await ev2(`card.shadowRoot.querySelector('.plan').click()`);
  check("Draw a floor plan instead shows the map", await until2(`card?.localName==='ha-3dhome-map'`));
  check("…with its how-to-start hint", await until2(`!!card.shadowRoot?.querySelector('.empty')`));
  await p2.close();

  /* ----- someone who isn't an admin ----- */
  const p3 = await p.context().newPage();
  await serve(p3, panelPage({ config: {}, states, head, admin: false }), endpoints([]));
  await p3.waitForFunction(() => window.card?.shadowRoot?.querySelector(".start"), null, { timeout: 15000 });
  check("non-admins aren't offered a scan", await p3.evaluate(`!card.shadowRoot.querySelector('.scan-camera')`));
  await p3.close();

  check("no page errors", !errors.length, errors.slice(0, 3).join(" | "));
  await browser.close();
  report("scan view checks");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
