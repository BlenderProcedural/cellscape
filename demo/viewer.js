// Cellscape web demo: runs a MarkovJunior model step by step and shows the grid as voxels with three.js.
// mountDemo(element) builds the whole widget inside the element.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Interpreter } from './mj.js';
import { MODELS, PALETTE, RESOURCES } from './models.js';

const BASE = new URL('.', import.meta.url).href;
const POP = 0.42;             // seconds a new voxel takes to settle
const FOOT = 40;              // world units every grid footprint is scaled to
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
.csd-note { position: absolute; left: 50%; top: 14px; transform: translateX(-50%); padding: 6px 13px; border-radius: 999px; font-size: 12.5px;
  background: rgba(255,181,71,.16); border: 1px solid rgba(255,181,71,.45); color: #ffe2b3; opacity: 0; transition: opacity .3s; pointer-events: none;
  white-space: nowrap; max-width: 90%; overflow: hidden; text-overflow: ellipsis; }
.csd-note.show { opacity: 1; }
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
  const comment = x.attrs.comment || (branch && branch.xelem && branch.xelem.attrs.comment) || '';
  if (tag === 'wfc') return `<b>wfc</b>Wave Function Collapse · tileset <code>${x.attrs.tileset}</code>`;
  if (tag === 'map') return `<b>map</b>rewrite into a new grid · scale <code>${x.attrs.scale}</code>`;
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
  const note = el('div', 'csd-note');
  stage.append(info, ruleRow, done, err, prog, note);

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

  // --- state. Every grid is shown at the same footprint (FOOT world units), so a model whose grid is rewritten
  // into a finer one (map, wfc) keeps its size on screen.
  let model = null, ip = null, probe = null, palette = [];
  let shown = null;  // { grid, MX, MY, MZ, s, prev, born }
  let playing = true, finished = false, dirty = true, userTouched = -1e9, changedIdx = new Int32Array(0);
  let estSteps = 0, inView = !('IntersectionObserver' in window), lastNow = '', budget = 0, lastFrame = 0;

  function randomSeed() {
    return Math.floor(Math.random() * 1000000);
  }

  function setPlaying(p) {
    playing = p;
    btnPlay.innerHTML = p && !finished ? ICON.pause : ICON.play;
  }

  function toast(text) {
    note.textContent = text;
    note.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => note.classList.remove('show'), 4500);
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
      ip = new Interpreter(m.xml, m.MX, m.MY, m.MZ, { resources: RESOURCES, gif: true });
      probe = new Interpreter(m.xml, m.MX, m.MY, m.MZ, { resources: RESOURCES });
    } catch (e) {
      err.textContent = 'Could not load ' + m.label + ': ' + e.message;
      err.style.display = 'grid';
      return;
    }
    model = m;
    info.querySelector('h4').textContent = m.label;
    info.querySelector('p').textContent = m.desc;
    fitCamera(m.MX, m.MY, m.MZ);
    start(seed);
  }

  // runs the seed once off screen: the progress bar learns the length, and a seed that ends in a contradiction
  // (some WFC models have them) is skipped for the next one, like Cellscape's "Retry Failed Seeds"
  function start(seed) {
    let s = seed;
    for (let k = 0; k < 40; k++, s++) {
      probe.run(s, model.steps);
      if (!probe.failed) break;
    }
    if (probe.failed) s = seed;
    estSteps = probe.counter;
    if (s !== seed) toast(`Seed ${seed} runs into a contradiction – showing ${s}`);
    seedIn.value = s;
    ip.start(s, model.steps);
    finished = false;
    done.classList.remove('show');
    lastNow = '';
    ruleRow.querySelector('.csd-now').innerHTML = '<b>start</b>' + (ip.origin ? 'one cell in the middle' : 'empty grid');
    showGrid(ip.grid, performance.now() / 1000);
    stats();
    setPlaying(true);
  }

  function fitCamera(MX, MY, MZ) {
    const s = FOOT / Math.max(MX, MY);
    const W = MX * s, D = MY * s, H = MZ * s;
    const R = Math.hypot(W, D, H) * 0.5;
    controls.target.set(0, H * 0.32, 0);
    const dist = R / Math.sin(THREE.MathUtils.degToRad(camera.fov * 0.5)) * 0.8;
    camera.position.copy(controls.target).addScaledVector(new THREE.Vector3(1, 0.62, 1.15).normalize(), dist);
    camera.near = dist * 0.05;
    camera.far = dist * 6;
    camera.updateProjectionMatrix();
    controls.minDistance = R * 0.8;
    controls.maxDistance = dist * 2.2;
    const sh = sun.shadow.camera, e = R * 1.4;
    sh.left = -e; sh.right = e; sh.top = e; sh.bottom = -e; sh.near = 1; sh.far = R * 6;
    sh.updateProjectionMatrix();
    sun.position.set(R * 1.6, R * 2.6, R * 0.9);
    sun.target.position.set(0, 0, 0);
    fill.position.set(-R, R * 0.6, -R * 1.4);
    resize();
  }

  // a new grid on screen: instance buffer, plinth, palette; what is already there pops in as a wave from below
  function showGrid(g, now) {
    if (mesh) { scene.remove(mesh); mesh.dispose(); }
    if (base) { scene.remove(base); base.geometry.dispose(); base.material.dispose(); }
    if (ground) { scene.remove(ground); ground.geometry.dispose(); ground.material.dispose(); }
    const n = g.state.length, s = FOOT / Math.max(g.MX, g.MY);
    mesh = new THREE.InstancedMesh(geo, mat, n);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    scene.add(mesh);
    const pad = 1.5;
    base = new THREE.Mesh(new THREE.BoxGeometry(g.MX * s + pad * 2, 1.2, g.MY * s + pad * 2),
      new THREE.MeshStandardMaterial({ color: 0x232833, roughness: 0.9 }));
    base.position.y = -0.6;
    base.receiveShadow = true;
    scene.add(base);
    ground = new THREE.Mesh(new THREE.CircleGeometry(FOOT * 3, 64), new THREE.ShadowMaterial({ opacity: 0.32 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -1.2;
    ground.receiveShadow = true;
    scene.add(ground);
    const colors = { ...PALETTE, ...model.colors };
    palette = g.characters.map((ch) => new THREE.Color().setHex(parseInt(colors[ch] || 'ff00ff', 16), THREE.SRGBColorSpace));
    const born = new Float32Array(n).fill(-1e9);
    for (let i = 0; i < n; i++) if (g.state[i]) born[i] = now + (i / n) * 0.35;
    shown = { grid: g, MX: g.MX, MY: g.MY, MZ: g.MZ, s, prev: g.state.slice(), born };
    if (changedIdx.length < n) changedIdx = new Int32Array(n);
    info.querySelector('.dims').textContent = `${g.MX} × ${g.MY} × ${g.MZ} grid · ${g.C} symbols`;
    dirty = true;
  }

  // what changed since the last frame (rules log their changes, a wfc writes its tiles directly, so compare)
  function absorb(now) {
    const g = ip.grid;
    if (g !== shown.grid) {
      showGrid(g, now);
    } else {
      const st = g.state, prev = shown.prev, born = shown.born;
      let n = 0;
      for (let i = 0; i < st.length; i++) if (st[i] !== prev[i]) changedIdx[n++] = i;
      for (let j = 0; j < n; j++) {
        const i = changedIdx[j];
        born[i] = st[i] ? now + (n > 400 ? (j / n) * 0.25 : 0) : -1e9;  // big steps light up as a short wave
        prev[i] = st[i];
      }
      if (n) dirty = true;
    }
    const d = describe(ip.active, ip.activeBranch);
    if (d && d !== lastNow) {
      ruleRow.querySelector('.csd-now').innerHTML = d;
      lastNow = d;
    }
  }

  // instance buffer from the grid: hidden symbol 0, voxels buried on all six sides are skipped
  function rebuild(now) {
    const { MX, MY, MZ, s, born } = shown;
    const state = shown.grid.state;
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
          let k = 1, drop = 0, glow = 0;
          if (age < POP) {
            const t = Math.max(age, 0) / POP;
            const e = 1 - (1 - t) * (1 - t) * (1 - t);
            k = 0.25 + 0.75 * e;
            drop = (1 - e) * 1.6;
            glow = (1 - t) * 1.6;
            animating = true;
          }
          const o = count * 16, q = k * s;
          mArr[o] = q; mArr[o + 1] = 0; mArr[o + 2] = 0; mArr[o + 3] = 0;
          mArr[o + 4] = 0; mArr[o + 5] = q; mArr[o + 6] = 0; mArr[o + 7] = 0;
          mArr[o + 8] = 0; mArr[o + 9] = 0; mArr[o + 10] = q; mArr[o + 11] = 0;
          mArr[o + 12] = (x - ox) * s; mArr[o + 13] = (z + 0.5 + drop) * s; mArr[o + 14] = -(y - oy) * s; mArr[o + 15] = 1;
          const c = palette[v] || palette[0];
          const kc = count * 3;
          cArr[kc] = c.r * (1 + glow) + glow * 0.25;
          cArr[kc + 1] = c.g * (1 + glow) + glow * 0.18;
          cArr[kc + 2] = c.b * (1 + glow) + glow * 0.08;
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
        absorb(now);
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
    absorb(performance.now() / 1000);
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

  const first = Math.max(0, MODELS.findIndex((m) => m.name === opts.model));
  select(first, opts.seed ?? randomSeed());
  requestAnimationFrame(frame);
  return { select: (name, seed) => select(Math.max(0, MODELS.findIndex((m) => m.name === name)), seed ?? randomSeed()) };
}
