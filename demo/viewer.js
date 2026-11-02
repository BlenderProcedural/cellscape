// Cellscape web demo: runs a MarkovJunior model step by step and shows the grid as voxels with three.js.
// mountDemo(element) builds the whole widget inside the element.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Interpreter } from './mj.js';
import { MODELS, PALETTE } from './models.js';

const BASE = new URL('.', import.meta.url).href;
const POP = 0.42;             // seconds a new voxel takes to settle
const RUN = 7;                // seconds a model takes to grow at 1×
const SPEEDS = [0.25, 0.5, 1, 2, 4, 8, Infinity];  // multiples of the model's own pace
const ICON = {
  play: '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l10.5-6.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M7 5h3.6v14H7zM13.4 5H17v14h-3.6z"/></svg>',
  step: '<svg viewBox="0 0 24 24"><path d="M6 5.5v13l9-6.5zM16 5h2.6v14H16z"/></svg>',
  restart: '<svg viewBox="0 0 24 24"><path d="M12 5a7 7 0 1 1-6.6 4.7l1.9.6A5 5 0 1 0 12 7v3L7.5 6 12 2z"/></svg>',
  dice: '<svg viewBox="0 0 24 24"><path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm2.5 3a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm9 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM12 10.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM7.5 15a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm9 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z"/></svg>',
  orbit: '<svg viewBox="0 0 24 24"><path d="M12 4c4.97 0 9 1.8 9 4.5 0 1.6-1.4 3-3.6 3.8l-.7-1.8c1.4-.5 2.3-1.3 2.3-2C19 7.2 16 6 12 6S5 7.2 5 8.5c0 1 2 2.2 5.5 2.5V9l3.5 3-3.5 3v-2C6.3 12.7 3 10.9 3 8.5 3 5.8 7.03 4 12 4zm-1 10h2v6h-2z"/></svg>',
};

const css = `
.csd { --csd-bg: #0d0f14; --csd-panel: rgba(20, 23, 31, .82); --csd-line: rgba(255,255,255,.09); --csd-text: #eef0f4;
  --csd-muted: #9aa1ad; --csd-accent: #ffb547; position: relative; display: grid; grid-template-rows: auto 1fr auto;
  height: 100%; min-height: 520px; color: var(--csd-text); background: var(--csd-bg); border-radius: 16px; overflow: hidden;
  font: 14px/1.4 "Inter", "Segoe UI", system-ui, -apple-system, sans-serif; border: 1px solid var(--csd-line);
  user-select: none; -webkit-user-select: none; }
.csd * { box-sizing: border-box; }
.csd-models { display: flex; gap: 8px; padding: 10px; overflow-x: auto; scrollbar-width: thin; border-bottom: 1px solid var(--csd-line);
  background: #11141b; scroll-snap-type: x proximity; }
.csd-models { scrollbar-color: #2b303c transparent; }
.csd-models::-webkit-scrollbar { height: 6px; } .csd-models::-webkit-scrollbar-track { background: transparent; }
.csd-models::-webkit-scrollbar-thumb { background: #2b303c; border-radius: 3px; }
.csd-m { flex: none; width: 84px; padding: 6px 4px 7px; border-radius: 11px; border: 1px solid transparent; background: none; color: var(--csd-muted);
  cursor: pointer; text-align: center; font: inherit; font-size: 12px; font-weight: 600; scroll-snap-align: start; transition: background .15s, color .15s; }
.csd-m img { width: 56px; height: 56px; display: block; margin: 0 auto 4px; filter: drop-shadow(0 4px 6px rgba(0,0,0,.4)); }
.csd-m:hover { background: rgba(255,255,255,.05); color: var(--csd-text); }
.csd-m.on { background: rgba(255,181,71,.12); border-color: rgba(255,181,71,.5); color: #fff; }
.csd-m .g { display: block; font-size: 10px; font-weight: 500; color: #6f7684; letter-spacing: .4px; text-transform: uppercase; }
.csd-stage { position: relative; min-height: 0; background: radial-gradient(ellipse 90% 80% at 50% 35%, #2a3140 0%, #161a23 55%, #0d0f14 100%); }
.csd-stage canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; cursor: grab; touch-action: none; }
.csd-stage canvas:active { cursor: grabbing; }
.csd-info { position: absolute; left: 14px; top: 12px; max-width: min(360px, 70%); pointer-events: none; }
.csd-info h4 { margin: 0 0 2px; font-size: 20px; font-weight: 800; letter-spacing: -.02em; }
.csd-info p { margin: 0; color: #c3c8d1; font-size: 13px; }
.csd-info .dims { color: var(--csd-muted); font-size: 12px; margin-top: 4px; }
.csd-rule { position: absolute; left: 14px; bottom: 12px; right: 14px; display: flex; justify-content: space-between; align-items: flex-end;
  gap: 12px; pointer-events: none; }
.csd-now { background: var(--csd-panel); border: 1px solid var(--csd-line); border-radius: 10px; padding: 7px 11px; max-width: 70%;
  backdrop-filter: blur(6px); font-size: 12.5px; color: #cdd2db; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.csd-now b { color: var(--csd-accent); font-weight: 700; margin-right: 6px; }
.csd-now code { font-family: ui-monospace, Consolas, monospace; font-size: 12px; color: #e9edf3; }
.csd-stats { background: var(--csd-panel); border: 1px solid var(--csd-line); border-radius: 10px; padding: 7px 11px; font-size: 12.5px;
  color: #cdd2db; white-space: nowrap; backdrop-filter: blur(6px); font-variant-numeric: tabular-nums; }
.csd-stats b { color: #fff; }
.csd-done { position: absolute; right: 14px; top: 12px; padding: 5px 11px; border-radius: 999px; font-size: 12px; font-weight: 700;
  background: rgba(67,196,122,.15); border: 1px solid rgba(67,196,122,.45); color: #9fe8bd; opacity: 0; transition: opacity .3s; pointer-events: none; }
.csd-done.show { opacity: 1; }
.csd-err { position: absolute; inset: 0; display: none; place-items: center; text-align: center; padding: 30px; color: #ffb4a8; }
.csd-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; padding: 10px 12px; border-top: 1px solid var(--csd-line); background: #11141b; }
.csd-grp { display: flex; align-items: center; gap: 6px; }
.csd-btn { display: inline-grid; place-items: center; height: 36px; min-width: 36px; padding: 0 10px; border-radius: 10px; border: 1px solid var(--csd-line);
  background: #1b1f29; color: var(--csd-text); cursor: pointer; font: inherit; font-weight: 600; gap: 6px; grid-auto-flow: column; transition: background .15s, border-color .15s; }
.csd-btn:hover { background: #242a37; border-color: rgba(255,255,255,.18); }
.csd-btn svg { width: 18px; height: 18px; fill: currentColor; }
.csd-btn.main { background: var(--csd-accent); color: #1c1407; border-color: transparent; min-width: 44px; }
.csd-btn.main:hover { background: #ffc46b; }
.csd-btn.tog.on { color: var(--csd-accent); border-color: rgba(255,181,71,.5); }
.csd-lbl { color: var(--csd-muted); font-size: 12px; font-weight: 600; letter-spacing: .3px; text-transform: uppercase; }
.csd-seed { width: 92px; height: 36px; border-radius: 10px; border: 1px solid var(--csd-line); background: #0d1016; color: #fff;
  font: 600 14px ui-monospace, Consolas, monospace; padding: 0 10px; }
.csd-seed:focus { outline: none; border-color: rgba(255,181,71,.6); }
.csd-speed { width: 110px; accent-color: var(--csd-accent); }
.csd-spv { min-width: 34px; color: #cdd2db; font-size: 12px; font-variant-numeric: tabular-nums; }
.csd-prog { position: absolute; left: 0; right: 0; bottom: 0; height: 3px; background: transparent; }
.csd-prog i { display: block; height: 100%; width: 0; background: linear-gradient(90deg, #ffcf7a, #ff9b3d); transition: width .2s; }
.csd-sp { flex: 1; }
@media (max-width: 640px) {
  .csd { min-height: 480px; font-size: 13px; }
  .csd-m { width: 72px; } .csd-m img { width: 46px; height: 46px; }
  .csd-info h4 { font-size: 17px; } .csd-info p { display: none; }
  .csd-now { max-width: 55%; } .csd-speed { width: 80px; } .csd-sp { display: none; }
}`;

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

// soft edge darkening on every face, so single voxels stay readable
function faceTexture() {
  const s = 64, c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, s, s);
  const edge = (x0, y0, x1, y1) => {
    const gr = g.createLinearGradient(x0, y0, x1, y1);
    gr.addColorStop(0, 'rgba(0,0,0,.30)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    return gr;
  };
  const w = 9;
  g.fillStyle = edge(0, 0, w, 0); g.fillRect(0, 0, w, s);
  g.fillStyle = edge(s, 0, s - w, 0); g.fillRect(s - w, 0, w, s);
  g.fillStyle = edge(0, 0, 0, w); g.fillRect(0, 0, s, w);
  g.fillStyle = edge(0, s, 0, s - w); g.fillRect(0, s - w, s, w);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function describe(node, branch) {
  if (!node || !node.xelem) return '';
  const x = node.xelem;
  const tag = x.tag;
  const comment = x.attrs.comment || (branch && branch.xelem.attrs.comment) || '';
  let rule = '';
  const r = x.attrs.in !== undefined ? x.attrs : (x.children.find((c) => c.tag === 'rule') || {}).attrs;
  if (r && r.in !== undefined) {
    if (r.in.length <= 18) {
      rule = `<code>${r.in} → ${r.out}</code>`;
    } else {
      const layers = r.in.split(' '), rows = layers[0].split('/');
      rule = `<code>${rows[0].length}×${rows.length}×${layers.length} pattern</code>`;
    }
  }
  return `<b>${tag}</b>${comment ? comment + (rule ? ' · ' : '') : ''}${rule}`;
}

export function mountDemo(root, opts = {}) {
  if (!document.getElementById('csd-style')) {
    const st = el('style');
    st.id = 'csd-style';
    st.textContent = css;
    document.head.appendChild(st);
  }
  const box = el('div', 'csd');
  root.appendChild(box);
  const strip = el('div', 'csd-models');
  const stage = el('div', 'csd-stage');
  const bar = el('div', 'csd-bar');
  box.append(strip, stage, bar);

  const info = el('div', 'csd-info', '<h4></h4><p></p><div class="dims"></div>');
  const ruleRow = el('div', 'csd-rule', '<div class="csd-now"></div><div class="csd-stats"></div>');
  const done = el('div', 'csd-done', 'Finished');
  const err = el('div', 'csd-err');
  const prog = el('div', 'csd-prog', '<i></i>');
  stage.append(info, ruleRow, done, err, prog);

  const btnPlay = el('button', 'csd-btn main', ICON.pause);
  btnPlay.title = 'Play / pause (Space)';
  const btnStep = el('button', 'csd-btn', ICON.step);
  btnStep.title = 'One step';
  const btnRestart = el('button', 'csd-btn', ICON.restart);
  btnRestart.title = 'Run again with the same seed';
  const seedIn = el('input', 'csd-seed');
  seedIn.type = 'number'; seedIn.min = 0; seedIn.max = 2147483647; seedIn.title = 'Seed';
  const btnDice = el('button', 'csd-btn', ICON.dice + '<span>New seed</span>');
  btnDice.title = 'Generate with a new random seed';
  const speed = el('input', 'csd-speed');
  speed.type = 'range'; speed.min = 0; speed.max = SPEEDS.length - 1; speed.value = 2; speed.title = 'Speed';
  const speedV = el('span', 'csd-spv');
  const btnOrbit = el('button', 'csd-btn tog on', ICON.orbit);
  btnOrbit.title = 'Turntable';
  const g1 = el('div', 'csd-grp'); g1.append(btnPlay, btnStep, btnRestart);
  const g2 = el('div', 'csd-grp'); g2.append(el('span', 'csd-lbl', 'Seed'), seedIn, btnDice);
  const g3 = el('div', 'csd-grp'); g3.append(el('span', 'csd-lbl', 'Speed'), speed, speedV);
  bar.append(g1, g2, el('div', 'csd-sp'), g3, btnOrbit);

  const buttons = MODELS.map((m, k) => {
    const b = el('button', 'csd-m', `<img src="${BASE}icons/${m.name}.png" alt="" loading="lazy" draggable="false">${m.label}<span class="g">${m.group}</span>`);
    b.title = m.desc;
    b.addEventListener('click', () => select(k, randomSeed()));
    strip.appendChild(b);
    return b;
  });

  // --- three.js scene
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  stage.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.5, 2000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.7;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.enablePan = false;
  controls.addEventListener('start', () => { userTouched = performance.now(); });

  scene.add(new THREE.HemisphereLight(0xdfe9ff, 0x4a3b2c, 1.15));
  const sun = new THREE.DirectionalLight(0xfff0dc, 2.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(0x9ab8ff, 0.45);
  scene.add(fill);

  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshStandardMaterial({ map: faceTexture(), roughness: 0.82, metalness: 0 });
  let mesh = null, base = null, ground = null;

  // --- state
  let model = null, ip = null, palette = [], visible = null, born = null, bornSeen = 0;
  let playing = true, finished = false, seenChanges = 0, dirty = true, userTouched = -1e9;
  let estSteps = 0, inView = !('IntersectionObserver' in window), lastNow = '', budget = 0, lastFrame = 0;
  const tmp = new THREE.Matrix4();
  const col = new THREE.Color();

  function randomSeed() {
    return Math.floor(Math.random() * 1000000);
  }

  function setPlaying(p) {
    playing = p;
    btnPlay.innerHTML = p && !finished ? ICON.pause : ICON.play;
  }

  function select(k, seed) {
    const m = MODELS[k];
    buttons.forEach((b, i) => b.classList.toggle('on', i === k));
    if (opts.scrollStrip !== false) {
      const b = buttons[k];
      strip.scrollTo({ left: b.offsetLeft - strip.clientWidth / 2 + b.clientWidth / 2, behavior: 'smooth' });
    }
    err.style.display = 'none';
    try {
      ip = new Interpreter(m.xml, m.MX, m.MY, m.MZ);
    } catch (e) {
      err.textContent = 'Could not load ' + m.label + ': ' + e.message;
      err.style.display = 'grid';
      return;
    }
    model = m;
    const colors = { ...PALETTE, ...m.colors };
    palette = ip.grid.characters.map((ch) => new THREE.Color().setHex(parseInt(colors[ch] || 'ff00ff', 16), THREE.SRGBColorSpace));
    info.querySelector('h4').textContent = m.label;
    info.querySelector('p').textContent = m.desc;
    info.querySelector('.dims').textContent = `${m.MX} × ${m.MY} × ${m.MZ} grid · ${ip.grid.C} symbols`;
    buildScene(m);
    start(seed);
  }

  function start(seed) {
    seedIn.value = seed;
    ip.start(seed, model.steps);
    const n = model.MX * model.MY * model.MZ;
    born = new Float32Array(n).fill(-1e9);
    seenChanges = 0;
    bornSeen = 0;
    finished = false;
    estSteps = 0;
    done.classList.remove('show');
    lastNow = '';
    ruleRow.querySelector('.csd-now').innerHTML = '<b>start</b>' + (ip.origin ? 'one cell in the middle' : 'empty grid');
    const now = performance.now() / 1000;
    for (let i = 0; i < n; i++) if (ip.grid.state[i]) born[i] = now;
    dirty = true;
    setPlaying(true);
  }

  function buildScene(m) {
    if (mesh) { scene.remove(mesh); mesh.dispose(); }
    if (base) { scene.remove(base); base.geometry.dispose(); base.material.dispose(); }
    if (ground) { scene.remove(ground); ground.geometry.dispose(); ground.material.dispose(); }
    const n = m.MX * m.MY * m.MZ;
    mesh = new THREE.InstancedMesh(geo, mat, n);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    scene.add(mesh);
    // a dark plinth under the grid, like a diorama base
    const pad = 1.5;
    base = new THREE.Mesh(new THREE.BoxGeometry(m.MX + pad * 2, 1.2, m.MY + pad * 2),
      new THREE.MeshStandardMaterial({ color: 0x232833, roughness: 0.9 }));
    base.position.y = -0.6;
    base.receiveShadow = true;
    scene.add(base);
    ground = new THREE.Mesh(new THREE.CircleGeometry(Math.max(m.MX, m.MY) * 3, 64), new THREE.ShadowMaterial({ opacity: 0.32 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -1.2;
    ground.receiveShadow = true;
    scene.add(ground);
    visible = new Uint8Array(n);

    const R = Math.hypot(m.MX, m.MY, m.MZ) * 0.5;
    const cy = m.MZ * 0.32;
    controls.target.set(0, cy, 0);
    const dist = R / Math.sin(THREE.MathUtils.degToRad(camera.fov * 0.5)) * 0.8;
    const dir = new THREE.Vector3(1, 0.62, 1.15).normalize();
    camera.position.copy(controls.target).addScaledVector(dir, dist);
    camera.near = dist * 0.05;
    camera.far = dist * 6;
    camera.updateProjectionMatrix();
    controls.minDistance = R * 0.8;
    controls.maxDistance = dist * 2.2;
    const sh = sun.shadow.camera;
    const s = R * 1.25;
    sh.left = -s; sh.right = s; sh.top = s; sh.bottom = -s; sh.near = 1; sh.far = R * 6;
    sh.updateProjectionMatrix();
    sun.position.set(R * 1.6, R * 2.6, R * 0.9);
    sun.target.position.set(0, 0, 0);
    fill.position.set(-R, R * 0.6, -R * 1.4);
    resize();
  }

  // instance buffer from the grid: hidden symbol 0, voxels buried on all six sides are skipped
  function rebuild(now) {
    const { MX, MY, MZ } = model;
    const state = ip.grid.state;
    const MXY = MX * MY;
    const mArr = mesh.instanceMatrix.array, cArr = mesh.instanceColor.array;
    const ox = (MX - 1) / 2, oy = (MY - 1) / 2;
    let count = 0, animating = false;
    for (let z = 0, i = 0; z < MZ; z++) {
      for (let y = 0; y < MY; y++) {
        for (let x = 0; x < MX; x++, i++) {
          const v = state[i];
          if (!v) continue;
          const age = now - born[i];
          if (age > POP && x > 0 && y > 0 && z > 0 && x < MX - 1 && y < MY - 1 && z < MZ - 1 &&
              state[i - 1] && state[i + 1] && state[i - MX] && state[i + MX] && state[i - MXY] && state[i + MXY]) continue;
          let s = 1, drop = 0, glow = 0;
          if (age < POP) {
            const t = Math.max(age, 0) / POP;
            const e = 1 - (1 - t) * (1 - t) * (1 - t);
            s = 0.25 + 0.75 * e;
            drop = (1 - e) * 1.6;
            glow = (1 - t) * 1.6;
            animating = true;
          }
          const o = count * 16;
          mArr[o] = s; mArr[o + 1] = 0; mArr[o + 2] = 0; mArr[o + 3] = 0;
          mArr[o + 4] = 0; mArr[o + 5] = s; mArr[o + 6] = 0; mArr[o + 7] = 0;
          mArr[o + 8] = 0; mArr[o + 9] = 0; mArr[o + 10] = s; mArr[o + 11] = 0;
          mArr[o + 12] = x - ox; mArr[o + 13] = z + 0.5 + drop; mArr[o + 14] = -(y - oy); mArr[o + 15] = 1;
          const c = palette[v] || palette[0];
          const k = count * 3;
          cArr[k] = c.r * (1 + glow) + glow * 0.25;
          cArr[k + 1] = c.g * (1 + glow) + glow * 0.18;
          cArr[k + 2] = c.b * (1 + glow) + glow * 0.08;
          count++;
        }
      }
    }
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    return animating;
  }

  function stats() {
    let vox = 0;
    for (const v of ip.grid.state) if (v) vox++;
    ruleRow.querySelector('.csd-stats').innerHTML = `step <b>${ip.counter.toLocaleString('en-US')}</b> · <b>${vox.toLocaleString('en-US')}</b> voxels`;
    if (estSteps) prog.firstChild.style.width = Math.min(100, (100 * ip.counter) / estSteps) + '%';
  }

  function runSteps(n) {
    const t0 = performance.now();
    let k = 0;
    while (k < n && !ip.finished) {
      ip.step();
      k++;
      if (performance.now() - t0 > 14) break;
    }
    if (ip.finished && !finished) {
      finished = true;
      done.classList.add('show');
      prog.firstChild.style.width = '100%';
      setPlaying(false);
    }
    return k;
  }

  function absorbChanges(now) {
    const ch = ip.changes;
    if (ch.length === seenChanges) return;
    const n = ch.length - seenChanges;
    // big parallel steps light up over a short wave instead of all at once
    for (let j = seenChanges; j < ch.length; j++) {
      const i = ch[j];
      born[i] = ip.grid.state[i] ? now + (n > 400 ? ((j - seenChanges) / n) * 0.25 : 0) : -1e9;
    }
    seenChanges = ch.length;
    dirty = true;
    const d = describe(ip.active, ip.activeBranch);
    if (d && d !== lastNow) {
      ruleRow.querySelector('.csd-now').innerHTML = d;
      lastNow = d;
    }
  }

  function resize() {
    const w = stage.clientWidth, h = stage.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    dirty = true;
  }

  let animating = false;
  function frame() {
    requestAnimationFrame(frame);
    const now = performance.now() / 1000;
    const dt = Math.min(now - lastFrame, 0.1);
    lastFrame = now;
    if (!model || !inView || document.hidden) return;
    if (playing && !finished) {
      const mult = SPEEDS[speed.value];
      const rate = Math.max((estSteps || 200) / RUN, 4) * mult;
      budget = mult === Infinity ? Infinity : Math.min(budget + dt * rate, rate * 0.25 + 1);
      const n = Math.floor(budget);
      if (n > 0) {
        budget -= runSteps(n);
        absorbChanges(now);
        stats();
      }
    }
    if (dirty || animating) {
      animating = rebuild(now);
      dirty = false;
    }
    controls.autoRotate = btnOrbit.classList.contains('on') && performance.now() - userTouched > 2500;
    controls.update();
    renderer.render(scene, camera);
  }

  // --- events
  btnPlay.addEventListener('click', () => {
    if (finished) start(+seedIn.value || 0);
    else setPlaying(!playing);
  });
  btnStep.addEventListener('click', () => {
    if (finished) return;
    setPlaying(false);
    runSteps(1);
    absorbChanges(performance.now() / 1000);
    stats();
  });
  btnRestart.addEventListener('click', () => start(+seedIn.value || 0));
  btnDice.addEventListener('click', () => start(randomSeed()));
  seedIn.addEventListener('change', () => start(Math.max(0, Math.min(2147483647, Math.floor(+seedIn.value || 0)))));
  const showSpeed = () => { const v = SPEEDS[speed.value]; speedV.textContent = v === Infinity ? 'max' : v + '×'; budget = 0; };
  speed.addEventListener('input', showSpeed);
  showSpeed();
  btnOrbit.addEventListener('click', () => btnOrbit.classList.toggle('on'));
  box.tabIndex = 0;
  box.addEventListener('keydown', (e) => {
    if (e.target === seedIn) return;
    if (e.code === 'Space') { e.preventDefault(); btnPlay.click(); }
    if (e.key === 'n' || e.key === 'N') btnDice.click();
  });
  new ResizeObserver(resize).observe(stage);
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((es) => { inView = es[0].isIntersecting; }, { threshold: 0.05 }).observe(box);
  }

  const first = Math.max(0, MODELS.findIndex((m) => m.name === (opts.model || 'Pagoda')));
  select(first, opts.seed ?? randomSeed());
  // estimate the run length once for the progress bar (the demo models finish in well under a second)
  const estimate = () => {
    if (!model) return;
    try {
      const probe = new Interpreter(model.xml, model.MX, model.MY, model.MZ);
      probe.run(+seedIn.value, model.steps);
      estSteps = probe.counter;
    } catch (e) { estSteps = 0; }
  };
  const origStart = start;
  start = (seed) => { origStart(seed); setTimeout(estimate, 0); };
  setTimeout(estimate, 0);
  requestAnimationFrame(frame);
  return { select: (name, seed) => select(Math.max(0, MODELS.findIndex((m) => m.name === name)), seed ?? randomSeed()) };
}
