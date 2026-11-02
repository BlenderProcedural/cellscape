// MarkovJunior interpreter in JavaScript: the rule-rewriting core (one / all / prl / markov / sequence / path).
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

function loadRule(xelem, grid) {
  if ('file' in xelem.attrs || 'fin' in xelem.attrs || 'fout' in xelem.attrs)
    throw new MJError('rules from image files are not supported in the web demo');
  const inS = attr(xelem, 'in'), outS = attr(xelem, 'out');
  if (inS === undefined) throw new MJError('no input in a rule');
  if (outS === undefined) throw new MJError('no output in a rule');
  const [inRect, IMX, IMY, IMZ] = parsePattern(inS);
  const [outRect, OMX, OMY, OMZ] = parsePattern(outS);
  if (OMZ !== IMZ || OMY !== IMY || OMX !== IMX) throw new MJError(`non-matching pattern sizes in rule in='${inS}' out='${outS}'`);
  const inp = inRect.map((c) => {
    if (!grid.waves.has(c)) throw new MJError(`input code ${c} is not found in codes`);
    return grid.waves.get(c);
  });
  const out = outRect.map((c) => {
    if (c === '*') return 0xff;
    if (!grid.values.has(c)) throw new MJError(`output code ${c} is not found in codes`);
    return grid.values.get(c);
  });
  return new Rule(inp, IMX, IMY, IMZ, out, OMX, OMY, OMZ, grid.C, attrFloat(xelem, 'p', 1.0));
}

function matchesAt(rule, state, si) {
  const c = rule.checks;
  for (let k = 0; k < c.length; k += 2) if (!((c[k + 1] >> state[si + c[k]]) & 1)) return false;
  return true;
}

// ---------------------------------------------------------------------------------------------
// Nodes

const NODE_NAMES = ['one', 'all', 'prl', 'markov', 'sequence', 'path'];
const UNSUPPORTED = ['map', 'convolution', 'convchain', 'wfc'];

function nodeFactory(xelem, symmetry, ip, grid) {
  const classes = { one: OneNode, all: AllNode, prl: ParallelNode, markov: MarkovNode, sequence: SequenceNode, path: PathNode };
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
      if (child instanceof Branch) child.parent = this;
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
      const rule = loadRule(xr, grid);
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
// Interpreter

export class Interpreter {
  constructor(xml, MX, MY, MZ) {
    const xelem = typeof xml === 'string' ? parseXML(xml) : xml;
    this.origin = attrBool(xelem, 'origin');
    this.grid = new Grid(xelem, MX, MY, MZ);
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
  }

  start(seed, steps = 50000) {
    this.random = new NetRandom(seed);
    this.steps = steps;
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
