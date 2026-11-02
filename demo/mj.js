// MarkovJunior interpreter in JavaScript: one / all / prl / markov / sequence / path, map and tile-based WFC.
// Port of Cellscape's Python port of MarkovJunior (https://github.com/mxgmn/MarkovJunior) by Maxim Gumin,
// MIT License. It uses the same .NET random number generator, so a seed walks through the same choices as
// the original and as Cellscape in Blender.

// ---------------------------------------------------------------------------------------------
// .NET System.Random (Knuth subtractive generator)

const MBIG = 2147483647;
const MSEED = 161803398;

export class NetRandom {
  constructor(seed) {
    seed |= 0;
    const s = new Int32Array(56);
    const subtraction = seed === -2147483648 ? MBIG : Math.abs(seed);
    let mj = (MSEED - subtraction) | 0;
    s[55] = mj;
    let mk = 1, ii = 0;
    for (let i = 1; i < 55; i++) {
      ii += 21;
      if (ii >= 55) ii -= 55;
      s[ii] = mk;
      mk = (mj - mk) | 0;
      if (mk < 0) mk += MBIG;
      mj = s[ii];
    }
    for (let k = 1; k < 5; k++) {
      for (let i = 1; i < 56; i++) {
        let n = i + 30;
        if (n >= 55) n -= 55;
        let v = (s[i] - s[1 + n]) | 0;
        if (v < 0) v += MBIG;
        s[i] = v;
      }
    }
    this.s = s;
    this.inext = 0;
    this.inextp = 21;
  }

  sample() {
    const s = this.s;
    let a = this.inext + 1;
    if (a >= 56) a = 1;
    let b = this.inextp + 1;
    if (b >= 56) b = 1;
    let r = s[a] - s[b];
    if (r === MBIG) r--;
    if (r < 0) r += MBIG;
    s[a] = r;
    this.inext = a;
    this.inextp = b;
    return r;
  }

  next(max) {
    if (max === undefined) return this.sample();
    return Math.floor(this.sample() * (1 / MBIG) * max);
  }

  nextDouble() {
    return this.sample() * (1 / MBIG);
  }
}

// ---------------------------------------------------------------------------------------------
// A small XML reader (enough for model files: elements, attributes, comments)

const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

export function parseXML(text) {
  text = text.replace(/^﻿/, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<\?[\s\S]*?\?>/g, '');
  const root = { tag: '#root', attrs: {}, children: [] };
  const stack = [root];
  const re = /<(\/?)([A-Za-z_][\w.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
  let m;
  while ((m = re.exec(text))) {
    if (m[1]) {
      stack.pop();
      continue;
    }
    const el = { tag: m[2], attrs: {}, children: [] };
    for (const a of m[3].matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      el.attrs[a[1]] = (a[2] ?? a[3]).replace(/&(\w+);/g, (_, e) => ENTITIES[e] ?? `&${e};`);
    }
    stack[stack.length - 1].children.push(el);
    if (!m[4]) stack.push(el);
  }
  return root.children[0];
}

export class MJError extends Error {}

const attr = (e, name, dflt) => (name in e.attrs ? e.attrs[name] : dflt);
const attrInt = (e, name, dflt) => (name in e.attrs ? parseInt(e.attrs[name], 10) : dflt);
const attrFloat = (e, name, dflt) => (name in e.attrs ? parseFloat(e.attrs[name]) : dflt);
const attrBool = (e, name, dflt = false) => (name in e.attrs ? e.attrs[name].trim().toLowerCase() === 'true' : dflt);
const children = (e, tags) => e.children.filter((c) => tags.includes(c.tag));

function* myDescendants(e, tags) {
  const q = [e];
  for (let h = 0; h < q.length; h++) {
    const x = q[h];
    if (x !== e) yield x;
    for (const c of children(x, tags)) q.push(c);
  }
}

// ---------------------------------------------------------------------------------------------
// Symmetries

const SQUARE_SUBGROUPS = {
  '()': [true, false, false, false, false, false, false, false],
  '(x)': [true, true, false, false, false, false, false, false],
  '(y)': [true, false, false, false, false, true, false, false],
  '(x)(y)': [true, true, false, false, true, true, false, false],
  '(xy+)': [true, false, true, false, true, false, true, false],
  '(xy)': Array(8).fill(true),
};

const range48 = Array.from({ length: 48 }, (_, l) => l);
const CUBE_SUBGROUPS = {
  '()': range48.map((l) => l === 0),
  '(x)': range48.map((l) => l === 0 || l === 1),
  '(z)': range48.map((l) => l === 0 || l === 17),
  '(xy)': range48.map((l) => l < 8),
  '(xyz+)': range48.map((l) => l % 2 === 0),
  '(xyz)': Array(48).fill(true),
};

function getSymmetry(d2, s, dflt) {
  if (s === undefined) return dflt;
  const table = d2 ? SQUARE_SUBGROUPS : CUBE_SUBGROUPS;
  if (!(s in table)) throw new MJError(`unknown symmetry ${s}`);
  return table[s];
}

function squareSymmetries(thing, rotation, reflection, same, subgroup) {
  const t = Array(8);
  t[0] = thing;
  t[1] = reflection(t[0]);
  t[2] = rotation(t[0]);
  t[3] = reflection(t[2]);
  t[4] = rotation(t[2]);
  t[5] = reflection(t[4]);
  t[6] = rotation(t[4]);
  t[7] = reflection(t[6]);
  const result = [];
  for (let i = 0; i < 8; i++) {
    if ((!subgroup || subgroup[i]) && !result.some((s) => same(s, t[i]))) result.push(t[i]);
  }
  return result;
}

function cubeSymmetries(thing, a, b, r, same, subgroup) {
  const s = Array(48);
  s[0] = thing;
  s[1] = r(s[0]);
  s[2] = a(s[0]); s[3] = r(s[2]);
  s[4] = a(s[2]); s[5] = r(s[4]);
  s[6] = a(s[4]); s[7] = r(s[6]);
  s[8] = b(s[0]); s[9] = r(s[8]);
  s[10] = b(s[2]); s[11] = r(s[10]);
  s[12] = b(s[4]); s[13] = r(s[12]);
  s[14] = b(s[6]); s[15] = r(s[14]);
  s[16] = b(s[8]); s[17] = r(s[16]);
  s[18] = b(s[10]); s[19] = r(s[18]);
  s[20] = b(s[12]); s[21] = r(s[20]);
  s[22] = b(s[14]); s[23] = r(s[22]);
  s[24] = b(s[16]); s[25] = r(s[24]);
  s[26] = b(s[18]); s[27] = r(s[26]);
  s[28] = b(s[20]); s[29] = r(s[28]);
  s[30] = b(s[22]); s[31] = r(s[30]);
  s[32] = a(s[8]); s[33] = r(s[32]);
  s[34] = a(s[10]); s[35] = r(s[34]);
  s[36] = a(s[12]); s[37] = r(s[36]);
  s[38] = a(s[14]); s[39] = r(s[38]);
  s[40] = a(s[24]); s[41] = r(s[40]);
  s[42] = a(s[26]); s[43] = r(s[42]);
  s[44] = a(s[28]); s[45] = r(s[44]);
  s[46] = a(s[30]); s[47] = r(s[46]);
  const result = [];
  for (let i = 0; i < 48; i++) {
    if ((!subgroup || subgroup[i]) && !result.some((t) => same(t, s[i]))) result.push(s[i]);
  }
  return result;
}

// ---------------------------------------------------------------------------------------------
// Grid

export class Grid {
  constructor(xelem, MX, MY, MZ) {
    this.MX = MX; this.MY = MY; this.MZ = MZ;
    const vs = attr(xelem, 'values');
    if (vs === undefined) throw new MJError('no values specified');
    const chars = [...vs.replace(/ /g, '')];
    this.C = chars.length;
    if (this.C > 31) throw new MJError('too many values (max 31)');
    this.values = new Map();
    this.waves = new Map();
    this.characters = chars;
    chars.forEach((ch, i) => {
      if (this.values.has(ch)) throw new MJError(`repeating value ${ch}`);
      this.values.set(ch, i);
      this.waves.set(ch, 2 ** i);
    });
    this.waves.set('*', 2 ** this.C - 1);
    for (const xu of myDescendants(xelem, ['markov', 'sequence', 'union'])) {
      if (xu.tag !== 'union') continue;
      const sym = attr(xu, 'symbol');
      if (this.waves.has(sym)) throw new MJError(`repeating union type ${sym}`);
      this.waves.set(sym, this.wave(attr(xu, 'values')));
    }
    const n = MX * MY * MZ;
    this.state = new Uint8Array(n);
    this.mask = new Uint8Array(n);
    this.folder = attr(xelem, 'folder');
  }

  clear() {
    this.state.fill(0);
  }

  wave(values) {
    let s = 0;
    for (const ch of values) {
      if (!this.values.has(ch)) throw new MJError(`unknown value '${ch}' in '${values}'`);
      s += 2 ** this.values.get(ch);
    }
    return s;
  }
}

// ---------------------------------------------------------------------------------------------
// Rules

class Rule {
  constructor(input, IMX, IMY, IMZ, output, OMX, OMY, OMZ, C, p) {
    this.input = input;
    this.output = output;
    this.IMX = IMX; this.IMY = IMY; this.IMZ = IMZ;
    this.OMX = OMX; this.OMY = OMY; this.OMZ = OMZ;
    this.C = C;
    this.p = p;
    const lists = Array.from({ length: C }, () => []);
    for (let z = 0; z < IMZ; z++) {
      for (let y = 0; y < IMY; y++) {
        for (let x = 0; x < IMX; x++) {
          const w = input[x + y * IMX + z * IMX * IMY];
          for (let c = 0; c < C; c++) if ((w >> c) & 1) lists[c].push([x, y, z]);
        }
      }
    }
    this.ishifts = lists;
  }

  zRotated() {
    const { IMX, IMY, IMZ, OMX, OMY, OMZ } = this;
    const ni = Array(this.input.length);
    for (let z = 0; z < IMZ; z++) for (let y = 0; y < IMX; y++) for (let x = 0; x < IMY; x++)
      ni[x + y * IMY + z * IMX * IMY] = this.input[IMX - 1 - y + x * IMX + z * IMX * IMY];
    const no = Array(this.output.length);
    for (let z = 0; z < OMZ; z++) for (let y = 0; y < OMX; y++) for (let x = 0; x < OMY; x++)
      no[x + y * OMY + z * OMX * OMY] = this.output[OMX - 1 - y + x * OMX + z * OMX * OMY];
    return new Rule(ni, IMY, IMX, IMZ, no, OMY, OMX, OMZ, this.C, this.p);
  }

  yRotated() {
    const { IMX, IMY, IMZ, OMX, OMY, OMZ } = this;
    const ni = Array(this.input.length);
    for (let z = 0; z < IMX; z++) for (let y = 0; y < IMY; y++) for (let x = 0; x < IMZ; x++)
      ni[x + y * IMZ + z * IMZ * IMY] = this.input[IMX - 1 - z + y * IMX + x * IMX * IMY];
    const no = Array(this.output.length);
    for (let z = 0; z < OMX; z++) for (let y = 0; y < OMY; y++) for (let x = 0; x < OMZ; x++)
      no[x + y * OMZ + z * OMZ * OMY] = this.output[OMX - 1 - z + y * OMX + x * OMX * OMY];
    return new Rule(ni, IMZ, IMY, IMX, no, OMZ, OMY, OMX, this.C, this.p);
  }

  reflected() {
    const { IMX, IMY, IMZ, OMX, OMY, OMZ } = this;
    const ni = Array(this.input.length);
    for (let z = 0; z < IMZ; z++) for (let y = 0; y < IMY; y++) for (let x = 0; x < IMX; x++)
      ni[x + y * IMX + z * IMX * IMY] = this.input[IMX - 1 - x + y * IMX + z * IMX * IMY];
    const no = Array(this.output.length);
    for (let z = 0; z < OMZ; z++) for (let y = 0; y < OMY; y++) for (let x = 0; x < OMX; x++)
      no[x + y * OMX + z * OMX * OMY] = this.output[OMX - 1 - x + y * OMX + z * OMX * OMY];
    return new Rule(ni, IMX, IMY, IMZ, no, OMX, OMY, OMZ, this.C, this.p);
  }

  static same(a, b) {
    if (a.IMX !== b.IMX || a.IMY !== b.IMY || a.IMZ !== b.IMZ || a.OMX !== b.OMX || a.OMY !== b.OMY || a.OMZ !== b.OMZ)
      return false;
    for (let i = 0; i < a.input.length; i++) if (a.input[i] !== b.input[i]) return false;
    for (let i = 0; i < a.output.length; i++) if (a.output[i] !== b.output[i]) return false;
    return true;
  }

  symmetries(subgroup, d2) {
    if (d2) return squareSymmetries(this, (r) => r.zRotated(), (r) => r.reflected(), Rule.same, subgroup);
    return cubeSymmetries(this, (r) => r.zRotated(), (r) => r.yRotated(), (r) => r.reflected(), Rule.same, subgroup);
  }

  // flat offsets for the grid size, so matching and writing work on flat indices
  prepare(MX, MY) {
    const { IMX, IMY, OMX, OMY } = this;
    const full = 2 ** this.C - 1;
    const checks = [];
    for (let z = 0; z < this.IMZ; z++) for (let y = 0; y < IMY; y++) for (let x = 0; x < IMX; x++) {
      const w = this.input[x + y * IMX + z * IMX * IMY];
      if (w !== full) checks.push(x + y * MX + z * MX * MY, w);
    }
    this.checks = checks;
    const outs = [];
    for (let z = 0; z < this.OMZ; z++) for (let y = 0; y < OMY; y++) for (let x = 0; x < OMX; x++) {
      const v = this.output[x + y * OMX + z * OMX * OMY];
      if (v !== 0xff) outs.push(x + y * MX + z * MX * MY, v);
    }
    this.outs = outs;
    this.ishiftOffs = this.ishifts.map((lst) => {
      const a = new Int32Array(lst.length * 4);
      lst.forEach(([sx, sy, sz], k) => a.set([sx, sy, sz, sx + sy * MX + sz * MX * MY], k * 4));
      return a;
    });
  }
}

function parsePattern(s) {
  const layers = s.split(' ').map((layer) => layer.split('/'));
  const MX = layers[0][0].length, MY = layers[0].length, MZ = layers.length;
  const result = Array(MX * MY * MZ);
  for (let z = 0; z < MZ; z++) {
    const lz = layers[MZ - 1 - z];
    if (lz.length !== MY) throw new MJError(`non-rectangular pattern '${s}'`);
    for (let y = 0; y < MY; y++) {
      const line = [...lz[y]];
      if (line.length !== MX) throw new MJError(`non-rectangular pattern '${s}'`);
      for (let x = 0; x < MX; x++) result[x + y * MX + z * MX * MY] = line[x];
    }
  }
  return [result, MX, MY, MZ];
}

// first-appearance ordinals of the values in `data` (shared `uniques` keep several tiles consistent)
function ords(data, uniques = []) {
  const index = new Map(uniques.map((u, k) => [u, k]));
  const result = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    let o = index.get(data[i]);
    if (o === undefined) {
      o = uniques.length;
      uniques.push(data[i]);
      index.set(data[i], o);
    }
    result[i] = o;
  }
  return [result, uniques.length];
}

// a .vox rule resource with its legend: every colour becomes the legend's symbol of the same rank
function loadResource(ip, path, legend) {
  if (legend === undefined) throw new MJError(`no legend for ${path}`);
  const v = ip.vox(path);
  const [o, amount] = ords(v.data);
  if (amount > legend.length) throw new MJError(`the amount of colors ${amount} in ${path} is more than ${legend.length}`);
  return [Array.from(o, (k) => legend[k]), v.MX, v.MY, v.MZ];
}

function loadRule(xelem, gin, gout, ip) {
  const inS = attr(xelem, 'in'), outS = attr(xelem, 'out');
  const finS = attr(xelem, 'fin'), foutS = attr(xelem, 'fout'), fileS = attr(xelem, 'file');
  const legend = attr(xelem, 'legend');
  if (gin.MZ === 1 && (finS || foutS || fileS)) throw new MJError('image rules are not supported in the web demo');
  const filepath = (name) => `rules/${gout.folder ? gout.folder + '/' : ''}${name}.vox`;
  let inRect, IMX, IMY, IMZ, outRect, OMX, OMY, OMZ;
  if (fileS === undefined) {
    if (inS === undefined && finS === undefined) throw new MJError('no input in a rule');
    if (outS === undefined && foutS === undefined) throw new MJError('no output in a rule');
    [inRect, IMX, IMY, IMZ] = inS !== undefined ? parsePattern(inS) : loadResource(ip, filepath(finS), legend);
    [outRect, OMX, OMY, OMZ] = outS !== undefined ? parsePattern(outS) : loadResource(ip, filepath(foutS), legend);
    if (gin === gout && (OMZ !== IMZ || OMY !== IMY || OMX !== IMX))
      throw new MJError(`non-matching pattern sizes in rule in='${inS}' out='${outS}'`);
  } else {
    const [rect, FX, FY, FZ] = loadResource(ip, filepath(fileS), legend);
    if (FX % 2 !== 0) throw new MJError(`odd width ${FX} in ${fileS}`);
    IMX = OMX = FX / 2; IMY = OMY = FY; IMZ = OMZ = FZ;
    inRect = []; outRect = [];
    for (let z = 0; z < FZ; z++) for (let y = 0; y < FY; y++) for (let x = 0; x < FX / 2; x++) {
      inRect.push(rect[x + y * FX + z * FX * FY]);
      outRect.push(rect[x + FX / 2 + y * FX + z * FX * FY]);
    }
  }
  const inp = inRect.map((c) => {
    if (!gin.waves.has(c)) throw new MJError(`input code ${c} is not found in codes`);
    return gin.waves.get(c);
  });
  const out = outRect.map((c) => {
    if (c === '*') return 0xff;
    if (!gout.values.has(c)) throw new MJError(`output code ${c} is not found in codes`);
    return gout.values.get(c);
  });
  return new Rule(inp, IMX, IMY, IMZ, out, OMX, OMY, OMZ, gin.C, attrFloat(xelem, 'p', 1.0));
}

function matchesAt(rule, state, si) {
  const c = rule.checks;
  for (let k = 0; k < c.length; k += 2) if (!((c[k + 1] >> state[si + c[k]]) & 1)) return false;
  return true;
}

// ---------------------------------------------------------------------------------------------
// Nodes

const NODE_NAMES = ['one', 'all', 'prl', 'markov', 'sequence', 'path', 'map', 'wfc'];
const UNSUPPORTED = ['convolution', 'convchain'];

function nodeFactory(xelem, symmetry, ip, grid) {
  const classes = { one: OneNode, all: AllNode, prl: ParallelNode, markov: MarkovNode, sequence: SequenceNode, path: PathNode,
    map: MapNode, wfc: TileNode };
  if (xelem.tag === 'wfc' && !('tileset' in xelem.attrs)) throw new MJError('sample-based WFC is not supported in the web demo');
  const cls = classes[xelem.tag];
  if (!cls) throw new MJError(`node <${xelem.tag}> is not supported in the web demo`);
  const node = new cls();
  node.ip = ip;
  node.grid = grid;
  node.xelem = xelem;
  node.load(xelem, symmetry, grid);
  return node;
}

class Branch {
  constructor() {
    this.nodes = [];
    this.n = 0;
    this.parent = null;
  }

  load(xelem, parentSymmetry, grid) {
    const symmetry = getSymmetry(this.ip.grid.MZ === 1, attr(xelem, 'symmetry'), parentSymmetry);
    for (const xc of xelem.children) {
      if (UNSUPPORTED.includes(xc.tag)) throw new MJError(`node <${xc.tag}> is not supported in the web demo`);
    }
    this.nodes = children(xelem, NODE_NAMES).map((xc) => {
      const child = nodeFactory(xc, symmetry, this.ip, grid);
      // like the original, a map or wfc node ends the program when it is done
      if (child instanceof Branch) child.parent = child instanceof MapNode || child instanceof WFCNode ? null : this;
      return child;
    });
  }

  go() {
    const ip = this.ip;
    while (this.n < this.nodes.length) {
      const node = this.nodes[this.n];
      if (node instanceof Branch) ip.current = node;
      if (node.go()) {
        if (!(node instanceof Branch)) {
          ip.active = node;
          ip.activeBranch = this;
        }
        return true;
      }
      this.n++;
    }
    ip.current = ip.current.parent;
    this.reset();
    return false;
  }

  reset() {
    for (const node of this.nodes) node.reset();
    this.n = 0;
  }
}

class SequenceNode extends Branch {}

class MarkovNode extends Branch {
  go() {
    this.n = 0;
    return super.go();
  }
}

class BitSet {
  constructor(n) {
    this.a = new Uint32Array((n >>> 5) + 1);
  }
  has(i) { return (this.a[i >>> 5] >>> (i & 31)) & 1; }
  add(i) { this.a[i >>> 5] |= 1 << (i & 31); }
  discard(i) { this.a[i >>> 5] &= ~(1 << (i & 31)); }
  clear() { this.a.fill(0); }
}

class RuleNode {
  constructor() {
    this.rules = [];
    this.counter = 0;
    this.steps = 0;
    this.matches = [];
    this.matchCount = 0;
    this.lastMatchedTurn = -1;
  }

  load(xelem, parentSymmetry, grid) {
    const d2 = grid.MZ === 1;
    const symmetry = getSymmetry(d2, attr(xelem, 'symmetry'), parentSymmetry);
    if (children(xelem, ['field', 'observe']).length) throw new MJError('fields and observations are not supported in the web demo');
    const xrules = children(xelem, ['rule']);
    const rules = [];
    for (const xr of xrules.length ? xrules : [xelem]) {
      const rule = loadRule(xr, grid, grid, this.ip);
      rules.push(...rule.symmetries(getSymmetry(d2, attr(xr, 'symmetry'), symmetry), d2));
    }
    for (const r of rules) r.prepare(grid.MX, grid.MY);
    this.rules = rules;
    this.steps = attrInt(xelem, 'steps', 0);
    this.N = grid.MX * grid.MY * grid.MZ;
    this.mask = new BitSet(rules.length * this.N);
  }

  reset() {
    this.lastMatchedTurn = -1;
    this.counter = 0;
  }

  add(r, si) {
    this.mask.add(r * this.N + si);
    this.matches.push(r * this.N + si);
  }

  baseGo() {
    if (this.steps > 0 && this.counter >= this.steps) return false;
    const grid = this.grid, ip = this.ip;
    const { MX, MY, MZ } = grid;
    const MXY = MX * MY, N = this.N;
    const state = grid.state, rules = this.rules, mask = this.mask;

    if (this.lastMatchedTurn >= 0) {
      const changes = ip.changes;
      for (let n = ip.first[this.lastMatchedTurn]; n < changes.length; n++) {
        const i = changes[n];
        const x = i % MX, y = Math.floor(i / MX) % MY, z = Math.floor(i / MXY);
        const value = state[i];
        for (let r = 0; r < rules.length; r++) {
          const rule = rules[r];
          const { IMX, IMY, IMZ } = rule;
          const offs = rule.ishiftOffs[value];
          const base = r * N;
          for (let l = 0; l < offs.length; l += 4) {
            const sx = x - offs[l], sy = y - offs[l + 1], sz = z - offs[l + 2];
            if (sx < 0 || sy < 0 || sz < 0 || sx + IMX > MX || sy + IMY > MY || sz + IMZ > MZ) continue;
            const si = i - offs[l + 3];
            if (mask.has(base + si)) continue;
            if (matchesAt(rule, state, si)) this.add(r, si);
          }
        }
      }
    } else {
      this.matches = [];
      this.matchCount = 0;
      for (let r = 0; r < rules.length; r++) {
        const rule = rules[r];
        const { IMX, IMY, IMZ } = rule;
        const base = r * N;
        for (let z = IMZ - 1; z < MZ; z += IMZ) {
          for (let y = IMY - 1; y < MY; y += IMY) {
            for (let x = IMX - 1; x < MX; x += IMX) {
              const i = x + y * MX + z * MXY;
              const offs = rule.ishiftOffs[state[i]];
              for (let l = 0; l < offs.length; l += 4) {
                const sx = x - offs[l], sy = y - offs[l + 1], sz = z - offs[l + 2];
                if (sx < 0 || sy < 0 || sz < 0 || sx + IMX > MX || sy + IMY > MY || sz + IMZ > MZ) continue;
                const si = i - offs[l + 3];
                if (!mask.has(base + si) && matchesAt(rule, state, si)) this.add(r, si);
              }
            }
          }
        }
      }
    }
    return true;
  }
}

class OneNode extends RuleNode {
  reset() {
    super.reset();
    if (this.matches.length) {
      this.mask.clear();
      this.matches = [];
    }
  }

  apply(rule, si) {
    const state = this.grid.state, changes = this.ip.changes, outs = rule.outs;
    for (let k = 0; k < outs.length; k += 2) {
      const idx = si + outs[k], v = outs[k + 1];
      if (state[idx] !== v) {
        state[idx] = v;
        changes.push(idx);
      }
    }
  }

  go() {
    if (!this.baseGo()) return false;
    this.lastMatchedTurn = this.ip.counter;
    const [r, si] = this.randomMatch(this.ip.random);
    if (r < 0) return false;
    this.apply(this.rules[r], si);
    this.counter++;
    return true;
  }

  randomMatch(random) {
    const state = this.grid.state, matches = this.matches, N = this.N;
    while (matches.length) {
      const mi = random.next(matches.length);
      const code = matches[mi];
      this.mask.discard(code);
      matches[mi] = matches[matches.length - 1];
      matches.pop();
      const r = Math.floor(code / N), si = code - r * N;
      if (matchesAt(this.rules[r], state, si)) return [r, si];
    }
    return [-1, -1];
  }
}

class AllNode extends RuleNode {
  fit(r, si, newstate) {
    const outs = this.rules[r].outs;
    for (let k = 0; k < outs.length; k += 2) if (newstate[si + outs[k]]) return;
    const state = this.grid.state, changes = this.ip.changes;
    for (let k = 0; k < outs.length; k += 2) {
      const idx = si + outs[k];
      newstate[idx] = 1;
      state[idx] = outs[k + 1];
      changes.push(idx);
    }
  }

  go() {
    if (!this.baseGo()) return false;
    const ip = this.ip, grid = this.grid;
    this.lastMatchedTurn = ip.counter;
    const matches = this.matches;
    if (!matches.length) return false;
    const N = this.N, count = matches.length;
    const shuffle = new Int32Array(count);
    for (let i = 0; i < count; i++) {
      const j = ip.random.next(i + 1);
      shuffle[i] = shuffle[j];
      shuffle[j] = i;
    }
    const gmask = grid.mask;
    for (let k = 0; k < count; k++) {
      const code = matches[shuffle[k]];
      this.mask.discard(code);
      const r = Math.floor(code / N);
      this.fit(r, code - r * N, gmask);
    }
    const changes = ip.changes;
    for (let n = ip.first[this.lastMatchedTurn]; n < changes.length; n++) gmask[changes[n]] = 0;
    this.counter++;
    this.matches = [];
    return true;
  }
}

class ParallelNode extends RuleNode {
  load(xelem, parentSymmetry, grid) {
    super.load(xelem, parentSymmetry, grid);
    this.newstate = new Uint8Array(grid.state.length);
  }

  add(r, si) {
    const rule = this.rules[r], ip = this.ip;
    if (ip.random.nextDouble() > rule.p) return;
    const state = this.grid.state, newstate = this.newstate, changes = ip.changes, outs = rule.outs;
    for (let k = 0; k < outs.length; k += 2) {
      const idx = si + outs[k], v = outs[k + 1];
      if (v !== state[idx]) {
        newstate[idx] = v;
        changes.push(idx);
      }
    }
    this.matchCount++;
  }

  go() {
    if (!this.baseGo()) return false;
    const ip = this.ip, state = this.grid.state, newstate = this.newstate, changes = ip.changes;
    for (let n = ip.first[ip.counter]; n < changes.length; n++) state[changes[n]] = newstate[changes[n]];
    this.counter++;
    return this.matchCount > 0;
  }
}

function directions(x, y, z, MX, MY, MZ, edges, vertices) {
  const result = [];
  if (x > 0) result.push([-1, 0, 0]);
  if (x < MX - 1) result.push([1, 0, 0]);
  if (y > 0) result.push([0, -1, 0]);
  if (y < MY - 1) result.push([0, 1, 0]);
  if (MZ === 1) {
    if (edges) {
      if (x > 0 && y > 0) result.push([-1, -1, 0]);
      if (x > 0 && y < MY - 1) result.push([-1, 1, 0]);
      if (x < MX - 1 && y > 0) result.push([1, -1, 0]);
      if (x < MX - 1 && y < MY - 1) result.push([1, 1, 0]);
    }
    return result;
  }
  if (z > 0) result.push([0, 0, -1]);
  if (z < MZ - 1) result.push([0, 0, 1]);
  if (edges) {
    if (x > 0 && y > 0) result.push([-1, -1, 0]);
    if (x > 0 && y < MY - 1) result.push([-1, 1, 0]);
    if (x < MX - 1 && y > 0) result.push([1, -1, 0]);
    if (x < MX - 1 && y < MY - 1) result.push([1, 1, 0]);
    if (x > 0 && z > 0) result.push([-1, 0, -1]);
    if (x > 0 && z < MZ - 1) result.push([-1, 0, 1]);
    if (x < MX - 1 && z > 0) result.push([1, 0, -1]);
    if (x < MX - 1 && z < MZ - 1) result.push([1, 0, 1]);
    if (y > 0 && z > 0) result.push([0, -1, -1]);
    if (y > 0 && z < MZ - 1) result.push([0, -1, 1]);
    if (y < MY - 1 && z > 0) result.push([0, 1, -1]);
    if (y < MY - 1 && z < MZ - 1) result.push([0, 1, 1]);
  }
  if (vertices) {
    if (x > 0 && y > 0 && z > 0) result.push([-1, -1, -1]);
    if (x > 0 && y > 0 && z < MZ - 1) result.push([-1, -1, 1]);
    if (x > 0 && y < MY - 1 && z > 0) result.push([-1, 1, -1]);
    if (x > 0 && y < MY - 1 && z < MZ - 1) result.push([-1, 1, 1]);
    if (x < MX - 1 && y > 0 && z > 0) result.push([1, -1, -1]);
    if (x < MX - 1 && y > 0 && z < MZ - 1) result.push([1, -1, 1]);
    if (x < MX - 1 && y < MY - 1 && z > 0) result.push([1, 1, -1]);
    if (x < MX - 1 && y < MY - 1 && z < MZ - 1) result.push([1, 1, 1]);
  }
  return result;
}

class PathNode {
  load(xelem, parentSymmetry, grid) {
    const startSymbols = attr(xelem, 'from');
    this.start = grid.wave(startSymbols);
    this.value = grid.values.get(attr(xelem, 'color', startSymbols[0]));
    this.finish = grid.wave(attr(xelem, 'to'));
    this.inertia = attrBool(xelem, 'inertia');
    this.longest = attrBool(xelem, 'longest');
    this.edges = attrBool(xelem, 'edges');
    this.vertices = attrBool(xelem, 'vertices');
    this.substrate = grid.wave(attr(xelem, 'on'));
  }

  reset() {}

  go() {
    const grid = this.grid, ip = this.ip;
    const { MX, MY, MZ } = grid;
    const MXY = MX * MY, state = grid.state;
    const has = (w, v) => (w >> v) & 1;
    const generations = new Int32Array(MX * MY * MZ).fill(-1);
    const startPositions = [];
    const frontier = [];
    let i = 0;
    for (let z = 0; z < MZ; z++) for (let y = 0; y < MY; y++) for (let x = 0; x < MX; x++, i++) {
      const s = state[i];
      if (has(this.start, s)) startPositions.push([x, y, z]);
      if (has(this.finish, s)) {
        generations[i] = 0;
        frontier.push([0, x, y, z]);
      }
    }
    if (!startPositions.length || !frontier.length) return false;
    for (let h = 0; h < frontier.length; h++) {
      const [t, x, y, z] = frontier[h];
      for (const [dx, dy, dz] of directions(x, y, z, MX, MY, MZ, this.edges, this.vertices)) {
        const X = x + dx, Y = y + dy, Z = z + dz, j = X + Y * MX + Z * MXY, v = state[j];
        if (generations[j] === -1 && (has(this.substrate, v) || has(this.start, v))) {
          if (has(this.substrate, v)) frontier.push([t + 1, X, Y, Z]);
          generations[j] = t + 1;
        }
      }
    }
    if (!startPositions.some((p) => generations[p[0] + p[1] * MX + p[2] * MXY] > 0)) return false;

    const local = new NetRandom(ip.random.next());
    let mn = MX * MY * MZ, mx = -2;
    let argmin = [-1, -1, -1], argmax = [-1, -1, -1];
    for (const p of startPositions) {
      const g = generations[p[0] + p[1] * MX + p[2] * MXY];
      if (g === -1) continue;
      const noise = 0.1 * local.nextDouble();
      if (g + noise < mn) { mn = g + noise; argmin = p; }
      if (g + noise > mx) { mx = g + noise; argmax = p; }
    }
    let [px, py, pz] = this.longest ? argmax : argmin;
    let [dx, dy, dz] = this.direction(px, py, pz, 0, 0, 0, generations, local);
    px += dx; py += dy; pz += dz;
    const changes = ip.changes;
    while (generations[px + py * MX + pz * MXY] !== 0) {
      const k = px + py * MX + pz * MXY;
      state[k] = this.value;
      changes.push(k);
      [dx, dy, dz] = this.direction(px, py, pz, dx, dy, dz, generations, local);
      px += dx; py += dy; pz += dz;
    }
    return true;
  }

  direction(x, y, z, dx, dy, dz, generations, random) {
    const { MX, MY, MZ } = this.grid;
    const MXY = MX * MY;
    const g = generations[x + y * MX + z * MXY];
    const candidates = [];
    const add = (DX, DY, DZ) => {
      if (generations[x + DX + (y + DY) * MX + (z + DZ) * MXY] === g - 1) candidates.push([DX, DY, DZ]);
    };
    if (!this.vertices && !this.edges) {
      if (dx !== 0 || dy !== 0 || dz !== 0) {
        const cx = x + dx, cy = y + dy, cz = z + dz;
        if (this.inertia && cx >= 0 && cx < MX && cy >= 0 && cy < MY && cz >= 0 && cz < MZ &&
            generations[cx + cy * MX + cz * MXY] === g - 1) return [dx, dy, dz];
      }
      if (x > 0) add(-1, 0, 0);
      if (x < MX - 1) add(1, 0, 0);
      if (y > 0) add(0, -1, 0);
      if (y < MY - 1) add(0, 1, 0);
      if (z > 0) add(0, 0, -1);
      if (z < MZ - 1) add(0, 0, 1);
      return candidates[random.next(candidates.length)];
    }
    for (const p of directions(x, y, z, MX, MY, MZ, this.edges, this.vertices)) add(...p);
    let result = [-1, -1, -1];
    if (this.inertia && (dx !== 0 || dy !== 0 || dz !== 0)) {
      let maxScalar = -4;
      for (const c of candidates) {
        const noise = 0.1 * random.nextDouble();
        const cos = (c[0] * dx + c[1] * dy + c[2] * dz) /
          Math.sqrt((c[0] * c[0] + c[1] * c[1] + c[2] * c[2]) * (dx * dx + dy * dy + dz * dz));
        if (cos + noise > maxScalar) { maxScalar = cos + noise; result = c; }
      }
    } else {
      result = candidates[random.next(candidates.length)];
    }
    return result;
  }
}

// ---------------------------------------------------------------------------------------------
// Map: a rewrite into a new grid of another size

class MapNode extends Branch {
  load(xelem, parentSymmetry, grid) {
    const scale = attr(xelem, 'scale');
    if (scale === undefined) throw new MJError('scale should be specified in map node');
    const parts = scale.split(' ');
    if (parts.length !== 3) throw new MJError(`scale attribute '${scale}' should have 3 components separated by space`);
    const read = (s) => (s.includes('/') ? s.split('/').map(Number) : [Number(s), 1]);
    [[this.NX, this.DX], [this.NY, this.DY], [this.NZ, this.DZ]] = parts.map(read);
    this.newgrid = new Grid(xelem, Math.floor(grid.MX * this.NX / this.DX), Math.floor(grid.MY * this.NY / this.DY),
      Math.floor(grid.MZ * this.NZ / this.DZ));
    super.load(xelem, parentSymmetry, this.newgrid);
    const d2 = grid.MZ === 1;
    const symmetry = getSymmetry(d2, attr(xelem, 'symmetry'), parentSymmetry);
    this.rules = [];
    for (const xr of children(xelem, ['rule'])) {
      this.rules.push(...loadRule(xr, grid, this.newgrid, this.ip).symmetries(symmetry, d2));
    }
    this.n = -1;
  }

  go() {
    if (this.n >= 0) return super.go();
    const grid = this.grid, ng = this.newgrid;
    ng.clear();
    const { MX, MY, MZ } = grid, NMX = ng.MX, NMY = ng.MY, NMZ = ng.MZ;
    const src = grid.state, dst = ng.state;
    for (const rule of this.rules) {
      const { IMX, IMY, IMZ, OMX, OMY, OMZ } = rule, inp = rule.input, out = rule.output;
      for (let z = 0; z < MZ; z++) for (let y = 0; y < MY; y++) for (let x = 0; x < MX; x++) {
        let ok = true;
        for (let dz = 0, di = 0; dz < IMZ && ok; dz++) {
          let sz = z + dz;
          if (sz >= MZ) sz -= MZ;
          for (let dy = 0; dy < IMY && ok; dy++) {
            let sy = y + dy;
            if (sy >= MY) sy -= MY;
            for (let dx = 0; dx < IMX; dx++, di++) {
              let sx = x + dx;
              if (sx >= MX) sx -= MX;
              if (!((inp[di] >> src[sx + sy * MX + sz * MX * MY]) & 1)) { ok = false; break; }
            }
          }
        }
        if (!ok) continue;
        const X = Math.floor(x * this.NX / this.DX), Y = Math.floor(y * this.NY / this.DY), Z = Math.floor(z * this.NZ / this.DZ);
        for (let dz = 0; dz < OMZ; dz++) for (let dy = 0; dy < OMY; dy++) for (let dx = 0; dx < OMX; dx++) {
          const v = out[dx + dy * OMX + dz * OMX * OMY];
          if (v === 0xff) continue;
          let sx = X + dx, sy = Y + dy, sz = Z + dz;
          if (sx >= NMX) sx -= NMX;
          if (sy >= NMY) sy -= NMY;
          if (sz >= NMZ) sz -= NMZ;
          dst[sx + sy * NMX + sz * NMX * NMY] = v;
        }
      }
    }
    this.ip.grid = ng;
    this.ip.active = this;
    this.ip.activeBranch = null;
    this.n++;
    return true;
  }

  reset() {
    super.reset();
    this.n = -1;
  }
}

// ---------------------------------------------------------------------------------------------
// Tile-based Wave Function Collapse (WaveFunctionCollapse.cs + TileModel.cs)

const WDX = [1, 0, -1, 0, 0, 0];
const WDY = [0, 1, 0, -1, 0, 0];
const WDZ = [0, 0, 0, 0, 1, -1];
const OPPOSITE = [2, 3, 0, 1, 5, 4];

function randomIndex(weights, r) {
  let sum = 0;
  for (const w of weights) sum += w;
  const threshold = r * sum;
  let partial = 0;
  for (let i = 0; i < weights.length; i++) {
    partial += weights[i];
    if (partial >= threshold) return i;
  }
  return 0;
}

class Wave {
  constructor(length, P, D, shannon) {
    this.length = length; this.P = P; this.D = D; this.shannon = shannon;
    this.data = new Uint8Array(length * P).fill(1);
    this.compatible = new Int32Array(length * P * D);
    this.sumsOfOnes = new Int32Array(length);
    if (shannon) {
      this.sumsOfWeights = new Float64Array(length);
      this.sumsOfWlw = new Float64Array(length);
      this.entropies = new Float64Array(length);
    }
  }

  init(propagator, sumW, sumWlw, startEntropy) {
    const { P, D } = this;
    const perTile = new Int32Array(P * D);
    for (let p = 0; p < P; p++) for (let d = 0; d < D; d++) perTile[p * D + d] = propagator[OPPOSITE[d]][p].length;
    this.data.fill(1);
    for (let i = 0; i < this.length; i++) this.compatible.set(perTile, i * P * D);
    this.sumsOfOnes.fill(P);
    if (this.shannon) {
      this.sumsOfWeights.fill(sumW);
      this.sumsOfWlw.fill(sumWlw);
      this.entropies.fill(startEntropy);
    }
  }

  copyFrom(o) {
    this.data.set(o.data);
    this.compatible.set(o.compatible);
    this.sumsOfOnes.set(o.sumsOfOnes);
    if (this.shannon) {
      this.sumsOfWeights.set(o.sumsOfWeights);
      this.sumsOfWlw.set(o.sumsOfWlw);
      this.entropies.set(o.entropies);
    }
  }
}

class WFCNode extends Branch {
  wfcLoad(xelem, parentSymmetry) {
    this.shannon = attrBool(xelem, 'shannon');
    this.tries = attrInt(xelem, 'tries', 1000);
    const L = this.grid.state.length, D = this.propagator.length;
    this.wave = new Wave(L, this.P, D, this.shannon);
    this.startwave = new Wave(L, this.P, D, this.shannon);
    this.stack = [];
    this.dirty = new Uint8Array(L);
    this.sumW = this.sumWlw = this.startEntropy = 0;
    if (this.shannon) {
      this.wlw = this.weights.map((w) => w * Math.log(w));
      this.sumW = this.weights.reduce((a, b) => a + b, 0);
      this.sumWlw = this.wlw.reduce((a, b) => a + b, 0);
      this.startEntropy = Math.log(this.sumW) - this.sumWlw / this.sumW;
    }
    super.load(xelem, parentSymmetry, this.newgrid);
    this.n = -1;
    this.firstgo = true;
  }

  reset() {
    super.reset();
    this.n = -1;
    this.firstgo = true;
  }

  go() {
    if (this.n >= 0) return super.go();
    const ip = this.ip, grid = this.grid, wave = this.wave, P = this.P;
    ip.active = this;
    ip.activeBranch = null;
    if (this.firstgo) {
      wave.init(this.propagator, this.sumW, this.sumWlw, this.startEntropy);
      this.stack = [];
      for (let i = 0; i < wave.length; i++) {
        const sw = this.map.get(grid.state[i]);
        if (sw) for (let t = 0; t < P; t++) if (!sw[t]) this.ban(i, t);
      }
      if (!this.propagate()) {
        ip.failed = true;
        return false;
      }
      this.startwave.copyFrom(wave);
      const goodseed = this.goodSeed();
      if (goodseed === null) {
        ip.failed = true;
        return false;
      }
      this.random = new NetRandom(goodseed);
      this.stack = [];
      wave.copyFrom(this.startwave);
      this.dirty.fill(1);
      this.firstgo = false;
      this.newgrid.clear();
      ip.grid = this.newgrid;
      return true;
    }
    const node = this.nextUnobservedNode(this.random);
    if (node >= 0) {
      this.observe(node, this.random);
      this.propagate();
    } else {
      this.n++;
    }
    if (this.n >= 0) this.updateState(false);
    else if (ip.gif) this.updateState(true);
    return true;
  }

  goodSeed() {
    const ip = this.ip;
    for (let k = 0; k < this.tries; k++) {
      const seed = ip.random.next();
      this.random = new NetRandom(seed);
      this.stack = [];
      this.wave.copyFrom(this.startwave);
      for (;;) {
        const node = this.nextUnobservedNode(this.random);
        if (node < 0) return seed;
        this.observe(node, this.random);
        if (!this.propagate()) break;
      }
    }
    return null;
  }

  nextUnobservedNode(random) {
    const { MX, MY, MZ } = this.grid, N = this.N, sums = this.wave.sumsOfOnes;
    const ent = this.shannon ? this.wave.entropies : null;
    let min = 1e4, argmin = -1;
    for (let z = 0, i = 0; z < MZ; z++) for (let y = 0; y < MY; y++) for (let x = 0; x < MX; x++, i++) {
      if (!this.periodic && (x + N > MX || y + N > MY || z + 1 > MZ)) continue;
      const rv = sums[i];
      if (rv > 1) {
        const e = ent ? ent[i] : rv;
        if (e <= min) {
          const noise = 1e-6 * random.nextDouble();
          if (e + noise < min) {
            min = e + noise;
            argmin = i;
          }
        }
      }
    }
    return argmin;
  }

  observe(node, random) {
    const P = this.P, data = this.wave.data, base = node * P;
    const dist = new Array(P);
    for (let t = 0; t < P; t++) dist[t] = data[base + t] ? this.weights[t] : 0;
    const r = randomIndex(dist, random.nextDouble());
    for (let t = 0; t < P; t++) if ((data[base + t] !== 0) !== (t === r)) this.ban(node, t);
  }

  propagate() {
    const { MX, MY, MZ } = this.grid, MXY = MX * MY, N = this.N, P = this.P;
    const stack = this.stack, propagator = this.propagator, compat = this.wave.compatible, D = propagator.length;
    while (stack.length) {
      const p1 = stack.pop(), i1 = stack.pop();
      const x1 = i1 % MX, y1 = Math.floor((i1 % MXY) / MX), z1 = Math.floor(i1 / MXY);
      for (let d = 0; d < D; d++) {
        let x2 = x1 + WDX[d], y2 = y1 + WDY[d], z2 = z1 + WDZ[d];
        if (!this.periodic && (x2 < 0 || y2 < 0 || z2 < 0 || x2 + N > MX || y2 + N > MY || z2 + 1 > MZ)) continue;
        if (x2 < 0) x2 += MX; else if (x2 >= MX) x2 -= MX;
        if (y2 < 0) y2 += MY; else if (y2 >= MY) y2 -= MY;
        if (z2 < 0) z2 += MZ; else if (z2 >= MZ) z2 -= MZ;
        const i2 = x2 + y2 * MX + z2 * MXY, base = i2 * P;
        const p = propagator[d][p1];
        for (let l = 0; l < p.length; l++) {
          const t2 = p[l], ci = (base + t2) * D + d;
          const c = --compat[ci];
          if (c === 0) this.ban(i2, t2);
        }
      }
    }
    return this.wave.sumsOfOnes[0] > 0;
  }

  ban(i, t) {
    const wave = this.wave, P = this.P, D = wave.D;
    wave.data[i * P + t] = 0;
    const ci = (i * P + t) * D;
    wave.compatible.fill(0, ci, ci + D);
    this.stack.push(i, t);
    wave.sumsOfOnes[i]--;
    this.dirty[i] = 1;
    if (this.shannon) {
      let s = wave.sumsOfWeights[i];
      wave.entropies[i] += wave.sumsOfWlw[i] / s - Math.log(s);
      wave.sumsOfWeights[i] -= this.weights[t];
      wave.sumsOfWlw[i] -= this.wlw[t];
      s = wave.sumsOfWeights[i];
      if (s > 0) wave.entropies[i] -= wave.sumsOfWlw[i] / s - Math.log(s);
    }
  }
}

class TileNode extends WFCNode {
  load(xelem, parentSymmetry, grid) {
    const ip = this.ip;
    this.N = 1;
    this.periodic = attrBool(xelem, 'periodic');
    const name = attr(xelem, 'tileset');
    this.name = name;
    const tilesname = attr(xelem, 'tiles', name);
    this.overlap = attrInt(xelem, 'overlap', 0);
    this.overlapz = attrInt(xelem, 'overlapz', 0);
    const xroot = parseXML(ip.resource(`tilesets/${name}.xml`));
    const fullSymmetry = attrBool(xroot, 'fullSymmetry');
    const xtiles = children(children(xroot, ['tiles'])[0], ['tile']);
    const first = ip.vox(`tilesets/${tilesname}/${attr(xtiles[0], 'name')}.vox`);
    const S = first.MX, SZ = first.MZ;
    if (S !== first.MY) throw new MJError(`tiles should be square shaped: ${S} != ${first.MY}`);
    if (fullSymmetry && S !== SZ) throw new MJError(`tiles should be cubes for the full symmetry option: ${S} != ${SZ}`);
    this.S = S;
    this.SZ = SZ;
    const ov = this.overlap, ovz = this.overlapz;
    this.newgrid = new Grid(xelem, (S - ov) * grid.MX + ov, (S - ov) * grid.MY + ov, (SZ - ovz) * grid.MZ + ovz);

    const newtile = (f) => {
      const a = new Uint8Array(S * S * SZ);
      for (let z = 0, k = 0; z < SZ; z++) for (let y = 0; y < S; y++) for (let x = 0; x < S; x++, k++) a[k] = f(x, y, z);
      return a;
    };
    const zRotate = (p) => newtile((x, y, z) => p[y + (S - 1 - x) * S + z * S * S]);
    const yRotate = (p) => newtile((x, y, z) => p[z + y * S + (S - 1 - x) * S * S]);
    const xRotate = (p) => newtile((x, y, z) => p[x + z * S + (S - 1 - y) * S * S]);
    const xReflect = (p) => newtile((x, y, z) => p[(S - 1 - x) + y * S + z * S * S]);
    const yReflect = (p) => newtile((x, y, z) => p[x + (S - 1 - y) * S + z * S * S]);
    const zReflect = (p) => newtile((x, y, z) => p[x + y * S + (S - 1 - z) * S * S]);
    const key = (a) => a.join(',');
    const same = (a, b) => key(a) === key(b);
    const never = () => false;

    const tiledata = [], positions = new Map(), named = new Map(), weights = [], uniques = [];
    for (const xt of xtiles) {
      const tilename = attr(xt, 'name');
      const weight = attrFloat(xt, 'weight', 1.0);
      const [flat, C] = ords(ip.vox(`tilesets/${tilesname}/${tilename}.vox`).data, uniques);
      if (C > this.newgrid.C) throw new MJError(`there were more than ${this.newgrid.C} colors in vox files`);
      const local = fullSymmetry ? cubeSymmetries(flat, zRotate, yRotate, xReflect, same)
        : squareSymmetries(flat, zRotate, xReflect, same);
      named.set(tilename, local);
      const position = [];
      for (const p of local) {
        position.push(tiledata.length);
        tiledata.push(p);
        weights.push(weight);
      }
      positions.set(tilename, position);
    }
    const P = this.P = tiledata.length;
    this.tiledata = tiledata;
    this.weights = weights;

    this.map = new Map();
    for (const xr of children(xelem, ['rule'])) {
      const position = new Array(P).fill(false);
      for (const s of attr(xr, 'out').split('|')) {
        if (!positions.has(s)) throw new MJError(`unknown tilename ${s}`);
        for (const p of positions.get(s)) position[p] = true;
      }
      this.map.set(grid.values.get(attr(xr, 'in')), position);
    }
    if (!this.map.has(0)) this.map.set(0, new Array(P).fill(true));

    const temp = Array.from({ length: 6 }, () => new Uint8Array(P * P));
    const indexOf = new Map();
    tiledata.forEach((t, i) => { if (!indexOf.has(key(t))) indexOf.set(key(t), i); });
    const index = (p) => {
      const k = indexOf.get(key(p));
      if (k === undefined) throw new MJError(`tileset ${name}: a transformed tile is not among the tile variants`);
      return k;
    };
    const last = (s) => s.split(' ').pop();
    const tile = (s) => {
      const code = s.split(' ');
      const action = code.length === 2 ? code[0] : '';
      let t = named.get(last(s))[0];
      for (const sym of [...action].reverse()) {
        if (sym === 'x') t = xRotate(t);
        else if (sym === 'y') t = yRotate(t);
        else if (sym === 'z') t = zRotate(t);
        else throw new MJError(`unknown symmetry ${sym}`);
      }
      return t;
    };
    const set = (d, a, b) => { temp[d][index(a) * P + index(b)] = 1; };
    const tilenames = xtiles.map((x) => attr(x, 'name'));
    for (const xn of children(children(xroot, ['neighbors'])[0], ['neighbor'])) {
      if (fullSymmetry) {
        const left = attr(xn, 'left'), right = attr(xn, 'right');
        if (!tilenames.includes(last(left)) || !tilenames.includes(last(right))) throw new MJError(`unknown tile ${last(left)} or ${last(right)}`);
        const ltile = tile(left), rtile = tile(right);
        const lsym = squareSymmetries(ltile, xRotate, yReflect, never), rsym = squareSymmetries(rtile, xRotate, yReflect, never);
        for (let i = 0; i < lsym.length; i++) {
          set(0, lsym[i], rsym[i]);
          set(0, xReflect(rsym[i]), xReflect(lsym[i]));
        }
        const dtile = zRotate(ltile), utile = zRotate(rtile);
        const dsym = squareSymmetries(dtile, yRotate, zReflect, never), usym = squareSymmetries(utile, yRotate, zReflect, never);
        for (let i = 0; i < dsym.length; i++) {
          set(1, dsym[i], usym[i]);
          set(1, yReflect(usym[i]), yReflect(dsym[i]));
        }
        const btile = yRotate(ltile), ttile = yRotate(rtile);
        const bsym = squareSymmetries(btile, zRotate, xReflect, never), tsym = squareSymmetries(ttile, zRotate, xReflect, never);
        for (let i = 0; i < bsym.length; i++) {
          set(4, bsym[i], tsym[i]);
          set(4, zReflect(tsym[i]), zReflect(bsym[i]));
        }
      } else if (attr(xn, 'left') !== undefined) {
        const left = attr(xn, 'left'), right = attr(xn, 'right');
        if (!tilenames.includes(last(left)) || !tilenames.includes(last(right))) throw new MJError(`unknown tile ${last(left)} or ${last(right)}`);
        const ltile = tile(left), rtile = tile(right);
        set(0, ltile, rtile);
        set(0, yReflect(ltile), yReflect(rtile));
        set(0, xReflect(rtile), xReflect(ltile));
        set(0, yReflect(xReflect(rtile)), yReflect(xReflect(ltile)));
        const dtile = zRotate(ltile), utile = zRotate(rtile);
        set(1, dtile, utile);
        set(1, xReflect(dtile), xReflect(utile));
        set(1, yReflect(utile), yReflect(dtile));
        set(1, xReflect(yReflect(utile)), xReflect(yReflect(dtile)));
      } else {
        const top = attr(xn, 'top'), bottom = attr(xn, 'bottom');
        if (!tilenames.includes(last(top)) || !tilenames.includes(last(bottom))) throw new MJError(`unknown tile ${last(top)} or ${last(bottom)}`);
        const tsym = squareSymmetries(tile(top), zRotate, xReflect, never);
        const bsym = squareSymmetries(tile(bottom), zRotate, xReflect, never);
        for (let i = 0; i < tsym.length; i++) set(4, bsym[i], tsym[i]);
      }
    }
    for (let p2 = 0; p2 < P; p2++) for (let p1 = 0; p1 < P; p1++) {
      temp[2][p2 * P + p1] = temp[0][p1 * P + p2];
      temp[3][p2 * P + p1] = temp[1][p1 * P + p2];
      temp[5][p2 * P + p1] = temp[4][p1 * P + p2];
    }
    this.propagator = temp.map((td) => Array.from({ length: P }, (_, p1) => {
      const list = [];
      for (let p2 = 0; p2 < P; p2++) if (td[p1 * P + p2]) list.push(p2);
      return Int32Array.from(list);
    }));
    this.wfcLoad(xelem, parentSymmetry);
  }

  // writes the tiles into the new grid; `decidedOnly` (live view) touches only the cells that are now settled
  updateState(decidedOnly) {
    const grid = this.grid, ng = this.newgrid, S = this.S, SZ = this.SZ, P = this.P;
    const ov = this.overlap, ovz = this.overlapz, data = this.wave.data, C = ng.C;
    const NMX = ng.MX, NMY = ng.MY, cells = S * S * SZ, dirty = this.dirty;
    for (let z = 0, i = 0; z < grid.MZ; z++) for (let y = 0; y < grid.MY; y++) for (let x = 0; x < grid.MX; x++, i++) {
      if (decidedOnly && (!dirty[i] || this.wave.sumsOfOnes[i] !== 1)) continue;
      dirty[i] = 0;
      const base = i * P;
      const alive = [];
      for (let t = 0; t < P; t++) if (data[base + t]) alive.push(t);
      let winners;
      if (alive.length === 1) {
        winners = this.tiledata[alive[0]];
      } else {
        winners = new Uint8Array(cells);
        const votes = new Int32Array(cells * C);
        for (const t of alive) {
          const tile = this.tiledata[t];
          for (let di = 0; di < cells; di++) votes[di * C + tile[di]]++;
        }
        for (let di = 0; di < cells; di++) {
          let best = -1, arg = 0xff;
          for (let c = 0; c < C; c++) {
            const vote = votes[di * C + c] + 0.1 * Math.random();
            if (vote > best) { best = vote; arg = c; }
          }
          winners[di] = arg;
        }
      }
      for (let dz = 0; dz < SZ; dz++) for (let dy = 0; dy < S; dy++) for (let dx = 0; dx < S; dx++) {
        const sx = x * (S - ov) + dx, sy = y * (S - ov) + dy, sz = z * (SZ - ovz) + dz;
        ng.state[sx + sy * NMX + sz * NMX * NMY] = winners[dx + dy * S + dz * S * S];
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Interpreter

const B64 = typeof atob === 'function' ? atob : (s) => Buffer.from(s, 'base64').toString('latin1');

export class Interpreter {
  // opts.resources: { 'tilesets/X.xml': text, 'tilesets/X/T.vox' | 'rules/F/R.vox': {MX, MY, MZ, d: base64} }
  // opts.gif: refresh the wfc output after every observation (for watching; the result is the same)
  constructor(xml, MX, MY, MZ, opts = {}) {
    const xelem = typeof xml === 'string' ? parseXML(xml) : xml;
    this.resources = opts.resources || {};
    this.gif = !!opts.gif;
    this.voxCache = new Map();
    this.origin = attrBool(xelem, 'origin');
    this.grid = new Grid(xelem, MX, MY, MZ);
    this.startgrid = this.grid;
    const d2 = MZ === 1;
    const symmetry = getSymmetry(d2, attr(xelem, 'symmetry'), Array(d2 ? 8 : 48).fill(true));
    const top = nodeFactory(xelem, symmetry, this, this.grid);
    if (top instanceof Branch) {
      this.root = top;
    } else {
      const root = new MarkovNode();
      root.ip = this;
      root.grid = this.grid;
      root.nodes = [top];
      this.root = root;
    }
    this.changes = [];
    this.first = [];
    this.counter = 0;
    this.current = null;
    this.active = null;  // the rule node that made the last step
    this.failed = false;
  }

  resource(path) {
    if (!(path in this.resources)) throw new MJError(`missing resource ${path}`);
    return this.resources[path];
  }

  vox(path) {
    let v = this.voxCache.get(path);
    if (!v) {
      const r = this.resource(path), s = B64(r.d);
      const data = new Uint8Array(s.length);
      for (let i = 0; i < s.length; i++) data[i] = s.charCodeAt(i);
      v = { MX: r.MX, MY: r.MY, MZ: r.MZ, data };
      this.voxCache.set(path, v);
    }
    return v;
  }

  start(seed, steps = 50000) {
    this.random = new NetRandom(seed);
    this.steps = steps;
    this.grid = this.startgrid;
    this.failed = false;
    const g = this.grid;
    g.clear();
    if (this.origin) g.state[(g.MX >> 1) + (g.MY >> 1) * g.MX + (g.MZ >> 1) * g.MX * g.MY] = 1;
    this.changes = [];
    this.first = [0];
    this.root.reset();
    this.current = this.root;
    this.counter = 0;
    this.active = null;
  }

  get finished() {
    return this.current === null || (this.steps > 0 && this.counter >= this.steps);
  }

  // one interpreter step; false once the program has finished
  step() {
    if (this.finished) return false;
    this.current.go();
    this.counter++;
    this.first.push(this.changes.length);
    return !this.finished;
  }

  run(seed, steps = 50000) {
    this.start(seed, steps);
    while (this.step());
    return this.grid.state;
  }
}
