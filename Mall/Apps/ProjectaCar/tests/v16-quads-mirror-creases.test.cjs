'use strict';

// v16, second round: a rebuild into triangles or quads, one side rebuilt and
// mirrored onto the other while the mirror is on, and creases — lines kept
// sharp without cutting a panel — that no rebuild wipes out.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', 'WrapaCar_v16.html'), 'utf8').replace(/\r\n/g, '\n');
const core = { module: { exports: {} } };
vm.runInNewContext(html.match(/<script>\s*(\/\* PanelCore[\s\S]*?)<\/script>/)[1], core);
const PC = core.module.exports;

function appFunction(name) {
  const start = html.search(new RegExp('\n  (?:async )?function ' + name + '\\('));
  assert.ok(start >= 0, 'App function exists: ' + name);
  return html.slice(start + 1, html.indexOf('\n  }\n', start + 1) + 4);
}
// the one in the page's app, where the core has one of the same name
function lastFunction(name) {
  const start = html.lastIndexOf('\n  function ' + name + '(');
  assert.ok(start >= 0, 'App function exists: ' + name);
  return html.slice(start + 1, html.indexOf('\n  }\n', start + 1) + 4);
}

// A sheet over [-1, 1]² with n cells a side, bent round the y axis into
// part of a cylinder when bend is given, wound one way throughout.
function sheet(n, bend) {
  const pos = [], tris = [];
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    const x = -1 + 2 * i / n, y = -1 + 2 * j / n;
    if (bend) pos.push(Math.sin(x * bend) / bend, y, (Math.cos(x * bend) - 1) / bend);
    else pos.push(x, y, 0);
  }
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const a = j * (n + 1) + i;
    tris.push(a, a + 1, a + n + 2, a, a + n + 2, a + n + 1);
  }
  return PC.makeMesh(pos, tris);
}
function onSheet(u, v, bend) {
  return bend ? [Math.sin(u * bend) / bend, v, (Math.cos(u * bend) - 1) / bend] : [u, v, 0];
}
const plain = x => JSON.parse(JSON.stringify(x));
const V = (P, v) => [P[3 * v], P[3 * v + 1], P[3 * v + 2]];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function label(mesh) {
  const edgeMap = PC.buildEdgeMap(mesh), r = PC.computePanels(mesh, edgeMap);
  mesh.panel = Array.from(r.label);
  return edgeMap;
}
function picksOn(mesh, points) {
  const loc = PC.faceLocator(mesh);
  return points.map(p => { const h = loc.closest(p); return { tri: h.tri, p: h.p }; });
}
// a seam, or with mark 'crease' a crease, through points near the surface,
// mirrored across plane when one is given, as the page lays them
function trace(mesh, points, closed, mark, plane) {
  const edgeMap = PC.buildEdgeMap(mesh);
  const r = PC.traceSeam(mesh, edgeMap, picksOn(mesh, points), !!closed, plane || null);
  assert.ok(r.complete && r.chords.length, 'The line traces');
  PC.applyCuts(mesh, r.chords, edgeMap, mark ? { mark } : undefined);
  return label(mesh);
}
function slivered() {
  const mesh = sheet(16, 1.1);
  label(mesh);
  trace(mesh, [onSheet(-1, -0.93, 1.1), onSheet(1, 0.71, 1.1)], false);
  trace(mesh, [[-0.43, 0.33], [0.31, 0.29], [0.37, 0.81], [-0.39, 0.77]].map(p => onSheet(p[0], p[1], 1.1)), true);
  return mesh;
}
function asMesh(out) {
  const m = PC.makeMesh(out.pos, out.tris);
  m.panel = out.panel; m.cut = out.cut; m.crease = out.crease; m.quad = out.quad;
  return m;
}
// the vertices of a set of edges
const verts = set => new Set([...set].flatMap(k => k.split(':').map(Number)));
function lineLength(mesh, set) {
  let l = 0;
  set.forEach(k => { const [a, b] = k.split(':').map(Number); l += dist(V(mesh.pos, a), V(mesh.pos, b)); });
  return l;
}
function areas(mesh) {
  const out = new Map();
  for (let f = 0; f < mesh.tris.length / 3; f++) out.set(mesh.panel[f], (out.get(mesh.panel[f]) || 0) + PC.faceArea(mesh, f));
  return out;
}
// the distance from q to a polyline
function offLine(q, line) {
  let best = Infinity;
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i], b = line[i + 1], ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], dd = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
    const t = Math.max(0, Math.min(1, ((q[0] - a[0]) * ab[0] + (q[1] - a[1]) * ab[1] + (q[2] - a[2]) * ab[2]) / dd));
    best = Math.min(best, dist(q, [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t]));
  }
  return best;
}
// each quad's two triangles, its corners in order, and their angles
function quadsOf(mesh) {
  const edgeMap = PC.buildEdgeMap(mesh), partner = PC.quadPartners(mesh, edgeMap), out = [];
  mesh.quad.forEach(k => {
    const fs = edgeMap.get(k);
    assert.ok(fs && fs.length === 2 && partner[fs[0]] === fs[1] && partner[fs[1]] === fs[0], 'A quad is two faces paired');
    const e = PC.sharedEdge(mesh.tris, fs[0], fs[1]), ring = PC.quadRing(mesh.tris, fs[0], fs[1], e[0], e[1]);
    out.push({ faces: fs, ring, angles: PC.quadAngles(mesh.pos, ring) });
  });
  return out;
}
// every panel with the one it reflects to (itself across the plane)
function twins(mesh, axis, offset) {
  const out = new Map();
  PC.panelPairs(mesh, mesh.panel, axis, offset).pairs.forEach((pr, id) => {
    if (pr.self) out.set(id, id); else if (pr.twin >= 0) out.set(id, pr.twin);
  });
  return out;
}
// each vertex's reflection across x = 0, or -1
function reflections(mesh) {
  const key = p => p.map(x => Math.round(x * 1e7)).join(','), at = new Map(), n = mesh.pos.length / 3;
  for (let v = 0; v < n; v++) at.set(key(V(mesh.pos, v)), v);
  const out = new Int32Array(n);
  for (let v = 0; v < n; v++) {
    const p = V(mesh.pos, v);
    p[0] = -p[0];
    out[v] = at.has(key(p)) ? at.get(key(p)) : -1;
  }
  return out;
}

/* ------------------------------------------------------------ quads */
test('a rebuild into quads pairs every triangle into convex, even quads', () => {
  const mesh = slivered(), edgeMap = PC.buildEdgeMap(mesh), before = areas(mesh);
  const out = PC.retopologize(mesh, { panels: [0, 1, 2], edgeMap, edgeLength: 0.1, quads: true }), m = asMesh(out);
  const quads = quadsOf(m);
  assert.equal(2 * quads.length, m.tris.length / 3, 'Every triangle is half of a quad');
  const sides = [];
  quads.forEach(q => {
    assert.ok(q.angles, 'Convex');
    q.angles.forEach(a => assert.ok(a > Math.PI / 6 && a < Math.PI * 5 / 6, 'No corner under 30° or over 150°'));
    for (let i = 0; i < 4; i++) sides.push(dist(V(m.pos, q.ring[i]), V(m.pos, q.ring[(i + 1) % 4])));
    // the corners run the way the two faces wind
    const directed = new Set();
    q.faces.forEach(f => { for (let e = 0; e < 3; e++) directed.add(m.tris[3 * f + e] + '>' + m.tris[3 * f + (e + 1) % 3]); });
    for (let i = 0; i < 4; i++) assert.ok(directed.has(q.ring[i] + '>' + q.ring[(i + 1) % 4]));
  });
  sides.sort((a, b) => a - b);
  const median = sides[sides.length >> 1];
  assert.ok(median > 0.05 && median < 0.13, 'Sides about the size asked for, ' + median);
  // the hidden edge is never a seam or a crease, and the panels keep their areas and seams
  m.quad.forEach(k => assert.ok(!m.cut.has(k) && !m.crease.has(k)));
  const after = areas(m);
  before.forEach((a, id) => assert.ok(Math.abs(after.get(id) - a) / a < 0.02, 'Panel ' + id + ' keeps its area'));
  assert.ok(Math.abs(lineLength(m, m.cut) - lineLength(mesh, mesh.cut)) < 0.01 * lineLength(mesh, mesh.cut));
  assert.equal(PC.checkManifold(m).nonManifold, 0);
  // triangles unless quads are asked for
  assert.equal(PC.retopologize(mesh, { panels: [0, 1, 2], edgeMap, edgeLength: 0.1 }).quad.size, 0);
});

test('a quad lasts only while its two triangles make one', () => {
  const mesh = slivered(), edgeMap = PC.buildEdgeMap(mesh);
  const m = asMesh(PC.retopologize(mesh, { panels: [0, 1, 2], edgeMap, edgeLength: 0.15, quads: true }));
  const em = PC.buildEdgeMap(m), keys = [...m.quad];
  assert.equal(PC.sanitizeQuads(m, em).size, keys.length, 'All stand as they are');
  // a seam cut along a hidden edge, a crease along another, one face moved to
  // another panel, and a key for an edge no longer there
  m.cut.add(keys[0]);
  m.crease.add(keys[1]);
  const moved = em.get(keys[2])[0];
  m.panel[moved] = 99;
  m.quad.add('0:999999');
  const kept = PC.sanitizeQuads(m, em);
  assert.equal(kept.size, keys.length - 3);
  for (const k of [keys[0], keys[1], keys[2], '0:999999']) assert.ok(!kept.has(k));
});

/* ----------------------------------------------------------- mirror */
function mirrored() {
  // a bent sheet symmetric across x = 0, with a loop and its reflection
  const mesh = sheet(14, 0.9);
  label(mesh);
  const loop = [[0.25, -0.4], [0.75, -0.35], [0.7, 0.45], [0.3, 0.4]];
  trace(mesh, loop.map(p => onSheet(p[0], p[1], 0.9)), true);
  trace(mesh, loop.map(p => onSheet(-p[0], p[1], 0.9)), true);
  return mesh;
}

test('split along the mirror plane, no face straddles it and nothing is lost', () => {
  const mesh = slivered(), s = PC.slicePlane(mesh, 0, 0.137, 1e-9);
  let straddle = 0;
  for (let f = 0; f < s.tris.length / 3; f++) {
    const d = [0, 1, 2].map(k => s.pos[3 * s.tris[3 * f + k]] - 0.137);
    if (d.some(x => x > 1e-9) && d.some(x => x < -1e-9)) straddle++;
  }
  assert.equal(straddle, 0);
  assert.ok(s.tris.length > mesh.tris.length, 'Faces across it were split');
  const a0 = areas(mesh), a1 = areas(s);
  a0.forEach((a, id) => assert.ok(Math.abs(a1.get(id) - a) < 1e-9, 'Panel ' + id + ' keeps its area'));
  assert.ok(Math.abs(lineLength(s, s.cut) - lineLength(mesh, mesh.cut)) < 1e-9, 'Seams split, not lost');
});

for (const quads of [false, true]) {
  test('with the mirror on, one side is rebuilt into ' + (quads ? 'quads' : 'triangles') + ' and mirrored onto the other', () => {
    const mesh = mirrored();
    // a crease on the panel across the plane, drawn once and mirrored
    trace(mesh, [[0.15, 0.62], [0.5, 0.8], [0.85, 0.66]].map(p => onSheet(p[0], p[1], 0.9)), false, 'crease', { axis: 0, offset: 0 });
    const edgeMap = PC.buildEdgeMap(mesh), twin = twins(mesh, 0, 0);
    assert.deepEqual(plain([...twin].sort()), [[0, 0], [1, 2], [2, 1]]);
    const out = PC.retopologize(mesh, { panels: [0, 1, 2], edgeMap, edgeLength: 0.12, quads, mirror: { axis: 0, offset: 0, twin } });
    assert.equal(out.mirrored, true, out.why);
    const m = asMesh(out), refl = reflections(m);
    assert.ok(refl.every(w => w >= 0), 'Every vertex has its reflection');
    // face for face, winding reversed, twin panel for twin panel
    const faces = new Map();
    for (let f = 0; f < m.tris.length / 3; f++) faces.set([0, 1, 2].map(k => m.tris[3 * f + k]).join(','), f);
    for (let f = 0; f < m.tris.length / 3; f++) {
      const r = [2, 1, 0].map(k => refl[m.tris[3 * f + k]]);
      const g = faces.get(r.join(',')) ?? faces.get([r[1], r[2], r[0]].join(',')) ?? faces.get([r[2], r[0], r[1]].join(','));
      assert.ok(g != null, 'Face ' + f + ' has its reflection');
      assert.equal(m.panel[g], twin.get(m.panel[f]));
    }
    for (const set of ['cut', 'crease', 'quad']) {
      m[set].forEach(k => { const [a, b] = k.split(':').map(Number); assert.ok(m[set].has(PC.ekey(refl[a], refl[b])), set + ' mirrored'); });
    }
    if (quads) assert.equal(2 * m.quad.size, m.tris.length / 3);
    else assert.equal(m.quad.size, 0);
    assert.ok(Math.abs(lineLength(m, m.crease) - lineLength(mesh, mesh.crease)) < 1e-3 * lineLength(mesh, mesh.crease), 'The crease holds its line');
    assert.equal(PC.checkManifold(m).nonManifold, 0);
  });
}

test('a seam up the plane that turns off it at its end still parts its panels once mirrored', () => {
  // a seam across the sheet, and one up the middle that leaves the plane
  // just before meeting it, as one snapped to a node beside the plane does
  const mesh = sheet(14);
  label(mesh);
  trace(mesh, [[-1, 0.6, 0], [1, 0.6, 0]], false);
  trace(mesh, [[0, -1, 0], [0, 0.55, 0], [-0.03, 0.6, 0]], false);
  const edgeMap = PC.buildEdgeMap(mesh), twin = twins(mesh, 0, 0);
  assert.deepEqual(plain([...twin].sort()), [[0, 1], [1, 0], [2, 2]]);
  for (const quads of [false, true]) {
    const out = PC.retopologize(mesh, { panels: [0, 1, 2], edgeMap, edgeLength: 0.2, quads, mirror: { axis: 0, offset: 0, twin } });
    assert.equal(out.mirrored, true, out.why);
    const m = asMesh(out), em = PC.buildEdgeMap(m);
    assert.equal(PC.computePanels(m, em).comps.length, 3, 'The two halves stay apart');
    // no panel meets another but across a seam, and both sides match
    em.forEach((fs, k) => { if (fs.length === 2 && m.panel[fs[0]] !== m.panel[fs[1]]) assert.ok(m.cut.has(k)); });
    const refl = reflections(m);
    assert.ok(refl.every(w => w >= 0));
    m.cut.forEach(k => { const [a, b] = k.split(':').map(Number); assert.ok(m.cut.has(PC.ekey(refl[a], refl[b]))); });
  }
});

test('panels without a twin are rebuilt without the mirror, and say why', () => {
  const mesh = sheet(14, 0.9);
  label(mesh);
  trace(mesh, [[0.25, -0.4], [0.75, -0.35], [0.7, 0.45], [0.3, 0.4]].map(p => onSheet(p[0], p[1], 0.9)), true);
  const edgeMap = PC.buildEdgeMap(mesh), twin = twins(mesh, 0, 0);
  const out = PC.retopologize(mesh, { panels: [0, 1], edgeMap, edgeLength: 0.12, mirror: { axis: 0, offset: 0, twin } });
  assert.equal(out.mirrored, false);
  assert.equal(out.why, 'panel 1 has no mirror twin');
  assert.ok(out.tris.length > 0 && new Set(out.panel).size === 2, 'Still rebuilt');
  // the same seams on both sides, but one side's crease missing
  const lop = mirrored();
  trace(lop, [[0.15, 0.62], [0.5, 0.8], [0.85, 0.66]].map(p => onSheet(p[0], p[1], 0.9)), false, 'crease');
  const r = PC.retopologize(lop, { panels: [0, 1, 2], edgeMap: PC.buildEdgeMap(lop), edgeLength: 0.12,
    mirror: { axis: 0, offset: 0, twin: twins(lop, 0, 0) } });
  assert.equal(r.mirrored, false);
  assert.equal(r.why, 'the creases on the two sides differ');
});

/* ---------------------------------------------------------- creases */
test('a crease is drawn like a seam but splits nothing', () => {
  const mesh = sheet(12);
  label(mesh);
  trace(mesh, [[-0.8, -0.6, 0], [-0.1, 0.05, 0], [0.7, 0.55, 0]], false, 'crease');
  assert.equal(mesh.cut.size, 0);
  assert.ok(mesh.crease.size > 10);
  assert.equal(new Set(mesh.panel).size, 1, 'Still one panel');
});

for (const quads of [false, true]) {
  test('a drawn crease survives a rebuild into ' + (quads ? 'quads' : 'triangles'), () => {
    const mesh = sheet(12), line = [[-0.8, -0.6, 0], [-0.1, 0.05, 0], [0.7, 0.55, 0]];
    label(mesh);
    trace(mesh, line, false, 'crease');
    const out = PC.retopologize(mesh, { panels: [0], edgeMap: PC.buildEdgeMap(mesh), edgeLength: 0.09, quads }), m = asMesh(out);
    assert.notEqual(m.tris.length, mesh.tris.length, 'The panel was rebuilt');
    // along the whole line, and nowhere off it
    assert.ok(Math.abs(lineLength(m, m.crease) - lineLength(mesh, mesh.crease)) < 1e-3);
    m.crease.forEach(k => k.split(':').forEach(v => assert.ok(offLine(V(m.pos, +v), line) < 1e-9)));
    m.quad.forEach(k => assert.ok(!m.crease.has(k), 'No quad folds across it'));
  });
}

test('a floating seam turned into a crease holds its line through a rebuild', () => {
  const mesh = sheet(12);
  label(mesh);
  // from the border into the middle: it splits nothing
  const line = [[-1, 0.3, 0], [-0.2, 0.1, 0], [0.4, -0.3, 0]];
  trace(mesh, line, false);
  const floating = PC.floatingSeams(mesh, PC.buildEdgeMap(mesh));
  assert.equal(floating.runs, 1);
  assert.equal(floating.edges.length, mesh.cut.size);
  floating.edges.forEach(k => { mesh.cut.delete(k); mesh.crease.add(k); });
  const out = PC.retopologize(mesh, { panels: [0], edgeMap: PC.buildEdgeMap(mesh), edgeLength: 0.1 }), m = asMesh(out);
  assert.ok(Math.abs(lineLength(m, m.crease) - lineLength(mesh, mesh.crease)) < 1e-9);
  m.crease.forEach(k => k.split(':').forEach(v => assert.ok(offLine(V(m.pos, +v), line) < 1e-9)));
  // its corner of 20° is kept where it was: a seam would round it off
  assert.ok([...verts(m.crease)].some(v => dist(V(m.pos, v), line[1]) < 1e-9));
});

test('sharp edges are marked as creases, leaving seams be', () => {
  // a sheet folded to a right angle along x = 0, with a seam along part of the fold
  const mesh = sheet(10);
  for (let v = 0; v < mesh.pos.length / 3; v++) if (mesh.pos[3 * v] > 0) { mesh.pos[3 * v + 2] = -mesh.pos[3 * v]; mesh.pos[3 * v] = 0; }
  const edgeMap = label(mesh);
  const low = k => Math.min(...k.split(':').map(v => mesh.pos[3 * v + 1]));
  const fold = [...edgeMap.keys()].filter(k => {
    const [a, b] = k.split(':').map(Number);
    return mesh.pos[3 * a] === 0 && mesh.pos[3 * b] === 0 && mesh.pos[3 * a + 2] === 0 && mesh.pos[3 * b + 2] === 0;
  }).sort((j, k) => low(j) - low(k));
  assert.equal(fold.length, 10);
  // the first tenth of the fold is a seam: the rest, 1.8 long, is a crease
  mesh.cut.add(fold[0]);
  assert.equal(PC.markCreaseLines(mesh, edgeMap, 35, 1.9), 0, 'Shorter than asked for');
  assert.equal(PC.markCreaseLines(mesh, edgeMap, 35, 1.7), 9);
  assert.ok(!mesh.crease.has(fold[0]));
  assert.equal(PC.markCreaseLines(mesh, edgeMap, 35), 0, 'Nothing left to mark');
});

/* --------------------------------------------------------- the page */
// the crease tool with what it needs from the page, over a flat sheet
function page(mesh, plane) {
  const edgeMap = label(mesh);
  const S = { mesh, edgeMap, points: [], mode: 'crease', history: [], busy: false, unwrap: {}, meshVersion: 1, retopoSkip: -1,
    rebuilt: null, seams: null, creases: null, floating: null, panels: [] };
  const toasts = [];
  const ctx = vm.createContext({ PC, S, Set, Map, Math, Array, fmt: String,
    toast: (msg, warn) => toasts.push({ msg, warn: !!warn }),
    snapshot: () => S.history.push(1), clearPoints: () => { S.points = []; }, setAtlasEmpty: () => { S.unwrap = null; },
    syncAll: () => {}, pruneSuggestions: () => {}, renderSuggestions: () => {}, showCreaseHover: () => {}, showErase: () => {},
    recomputePanels: () => {
      S.edgeMap = label(S.mesh); S.meshVersion++; S.seams = S.creases = S.floating = null;
      S.panels = [...new Set(S.mesh.panel)].map(id => ({ id }));
    },
    activePlane: () => plane || null, pixelReach: () => 0.04, mirrorTolerance: () => 1e-8 });
  for (const name of ['seamOnPlane', 'creaseAcross', 'doCrease', 'counted', 'sameTriangles', 'toCreases', 'floatingEdges',
    'floatingNear', 'seamNet', 'creaseNet', 'mirrorRun', 'linesNear', 'removeLines', 'finishLine']) vm.runInContext(lastFunction(name), ctx);
  ctx.doCut = () => { throw new Error('a seam was cut'); };
  const at = points => { S.points = picksOn(S.mesh, points); };
  return { ctx, S, toasts, at };
}

test('Crease mode draws a crease where a seam would be cut', () => {
  const { ctx, S, toasts, at } = page(sheet(12));
  at([[-0.8, -0.6, 0], [-0.1, 0.05, 0], [0.7, 0.55, 0]]);
  ctx.finishLine(false);
  assert.equal(S.mesh.cut.size, 0);
  assert.ok(S.mesh.crease.size > 10);
  assert.equal(S.points.length, 0);
  assert.equal(S.history.length, 1, 'Undo cut takes it back');
  assert.equal(toasts.pop().msg, 'Crease added — a rebuild keeps it sharp');
  // a closed crease: every one of its vertices joins two of its edges
  const loop = page(sheet(12));
  loop.at([[-0.5, -0.5, 0], [0.5, -0.45, 0], [0.45, 0.5, 0], [-0.5, 0.45, 0]]);
  loop.ctx.finishLine(true);
  const degree = new Map();
  loop.S.mesh.crease.forEach(k => k.split(':').forEach(v => degree.set(v, (degree.get(v) || 0) + 1)));
  assert.ok([...degree.values()].every(d => d === 2));
  assert.equal(new Set(loop.S.mesh.panel).size, 1, 'A crease loop cuts no panel out');
});

test('with the mirror on, a crease is mirrored, unless drawn across the plane', () => {
  const plane = { axis: 0, offset: 0 };
  const one = page(sheet(12), plane);
  one.at([[0.2, -0.6, 0], [0.5, 0, 0], [0.8, 0.6, 0]]);
  one.ctx.doCrease(false);
  const xs = [...verts(one.S.mesh.crease)].map(v => one.S.mesh.pos[3 * v]);
  assert.ok(xs.some(x => x > 0.15) && xs.some(x => x < -0.15), 'Both sides');
  assert.match(one.toasts.pop().msg, /on both sides/);
  // across the plane it already has both sides
  const across = page(sheet(12), plane), line = [[-0.7, -0.6, 0], [0.1, 0, 0], [0.7, 0.5, 0]];
  across.at(line);
  across.ctx.doCrease(false);
  verts(across.S.mesh.crease).forEach(v => assert.ok(offLine(V(across.S.mesh.pos, v), line) < 1e-9, 'Only the line drawn'));
  assert.doesNotMatch(across.toasts.pop().msg, /both sides/);
});

test('a tap on a floating seam turns it into a crease, and changes no triangle', () => {
  const mesh = sheet(12);
  label(mesh);
  trace(mesh, [[-1, 0.3, 0], [-0.2, 0.1, 0], [0.4, -0.3, 0]], false);
  trace(mesh, [[0.3, 0.3, 0], [0.8, 0.3, 0], [0.8, 0.8, 0], [0.3, 0.8, 0]], true);
  const { ctx, S, toasts } = page(mesh), tris = mesh.tris.slice(), loop = mesh.cut.size;
  // on the closed loop, nothing to turn
  assert.equal(ctx.floatingNear({ p: [0.55, 0.3, 0] }, 12), null);
  const run = ctx.floatingNear({ p: [-0.6, 0.2, 0] }, 12);
  const floating = PC.floatingSeams(mesh, PC.buildEdgeMap(mesh)).edges;
  assert.deepEqual(plain([...run].sort()), plain([...floating].sort()), 'The whole floating seam');
  S.retopoSkip = S.meshVersion;
  ctx.toCreases(run);
  assert.equal(S.mesh.cut.size, loop - floating.length);
  assert.deepEqual(plain([...S.mesh.crease].sort()), plain([...floating].sort()));
  assert.deepEqual(plain(S.mesh.tris), plain(tris));
  assert.equal(S.retopoSkip, S.meshVersion, 'Unwrap as is still stands');
  assert.ok(S.unwrap, 'The unwrap still fits');
  assert.match(toasts.pop().msg, /into a crease/);
  assert.equal(ctx.floatingNear({ p: [-0.6, 0.2, 0] }, 12), null, 'Nothing floating is left');
});

test('Remove seam takes out whichever of a seam and a crease is nearer', () => {
  const mesh = sheet(12);
  label(mesh);
  trace(mesh, [[0.3, 0.3, 0], [0.8, 0.3, 0], [0.8, 0.8, 0], [0.3, 0.8, 0]], true);
  trace(mesh, [[-0.8, -0.6, 0], [-0.1, -0.4, 0], [0.6, -0.5, 0]], false, 'crease');
  const { ctx, S } = page(mesh), seams = mesh.cut.size;
  assert.equal(ctx.linesNear({ p: [0.55, 0.31, 0] }, 12).kind, 'seam');
  assert.equal(ctx.linesNear({ p: [0.8, 0.5, 0] }, 12).kind, 'seam');
  const sel = ctx.linesNear({ p: [-0.1, -0.41, 0] }, 12);
  assert.equal(sel.kind, 'crease');
  assert.equal(ctx.linesNear({ p: [-0.5, 0.5, 0] }, 12), null, 'Nothing in reach');
  S.retopoSkip = S.meshVersion;
  ctx.removeLines(sel);
  assert.equal(S.mesh.crease.size, 0);
  assert.equal(S.mesh.cut.size, seams, 'The seam stays');
  assert.equal(S.retopoSkip, S.meshVersion, 'No triangle changed');
});

test('an OBJ export writes each quad as one face of four corners', () => {
  const mesh = slivered();
  const m = asMesh(PC.retopologize(mesh, { panels: [0, 1, 2], edgeMap: PC.buildEdgeMap(mesh), edgeLength: 0.15, quads: true }));
  // and three of them taken apart, into triangles
  [...m.quad].slice(0, 3).forEach(k => m.quad.delete(k));
  const edgeMap = PC.buildEdgeMap(m), nT = m.tris.length / 3, uv = new Float64Array(6 * nT);
  for (let i = 0; i < uv.length; i++) uv[i] = (i % 7) / 7;
  const groups = new Map();
  for (let f = 0; f < nT; f++) { if (!groups.has(m.panel[f])) groups.set(m.panel[f], []); groups.get(m.panel[f]).push(f); }
  const S = { mesh: m, unwrap: { uv }, edgeMap, excludedPanels: new Set(), panels: [...groups].map(([id, faces]) => ({ id, faces })) };
  const ctx = vm.createContext({ PC, S, Math, vnCache: new Float32Array(m.pos.length) });
  vm.runInContext(appFunction('buildOBJ') + appFunction('n6'), ctx);
  const lines = ctx.buildOBJ().split('\n').filter(l => l.startsWith('f ')).map(l => l.slice(2).split(' ').map(c => c.split('/').map(Number)));
  const fours = lines.filter(c => c.length === 4), threes = lines.filter(c => c.length === 3);
  assert.equal(fours.length, m.quad.size);
  assert.equal(threes.length, nT - 2 * m.quad.size);
  assert.equal(threes.length, 6, 'The three quads taken apart');
  const directed = new Set();
  for (let f = 0; f < nT; f++) for (let e = 0; e < 3; e++) directed.add(m.tris[3 * f + e] + '>' + m.tris[3 * f + (e + 1) % 3]);
  lines.forEach(c => {
    c.forEach(([v, t, n]) => {
      // the texture corner is one of this vertex's own
      assert.equal(n, v);
      assert.equal(m.tris[3 * Math.floor((t - 1) / 3) + (t - 1) % 3], v - 1);
    });
    // round the face the way its triangles wind
    for (let i = 0; i < c.length; i++) assert.ok(directed.has((c[i][0] - 1) + '>' + (c[(i + 1) % c.length][0] - 1)));
  });
});

test('the page has the crease tool, the shape of a rebuild and the mirror in it', () => {
  assert.match(html, /<button data-mode="crease">Crease<span class="long"> line<\/span><\/button>/);
  assert.match(html, /else if \(e\.key === '7'\) setMode\('crease'\);/);
  const seams = html.indexOf('<h2>Seams</h2>'), creases = html.indexOf('<h2>Creases</h2>'), mirror = html.indexOf('<h2>Mirror</h2>');
  assert.ok(seams > 0 && seams < creases && creases < mirror, 'Creases between Seams and Mirror');
  for (const id of ['floatCreaseBtn', 'markCreaseBtn', 'statCreases', 'clearCreaseBtn', 'showCreases', 'statQuads', 'retopoShape']) {
    assert.match(html, new RegExp('id="' + id + '"'));
  }
  assert.match(html, /<option value="tri" selected>Triangles<\/option>\s*<option value="quad">Quads<\/option>/);
  const apply = appFunction('applyRetopology');
  assert.match(apply, /quads = \$\('retopoShape'\)\.value === 'quad'/);
  assert.match(apply, /quads: quads, mirror: plane \? \{ axis: plane\.axis, offset: plane\.offset, twin: twin \} : null/);
  assert.match(apply, /S\.mesh\.crease = out\.crease; S\.mesh\.quad = out\.quad;/);
  assert.match(apply, /S\.rebuilt = \{ version: S\.meshVersion, panels: rebuilt \};/);
  // undo brings creases and quads back, and panels keep only what still fits
  assert.match(appFunction('snapshot'), /crease: new Set\(S\.mesh\.crease \|\| \[\]\), quad: new Set\(S\.mesh\.quad \|\| \[\]\)/);
  assert.match(appFunction('undoCut'), /S\.mesh\.crease = h\.crease \|\| new Set\(\); S\.mesh\.quad = h\.quad \|\| new Set\(\);/);
  assert.match(appFunction('recomputePanels'), /S\.mesh\.quad = PC\.sanitizeQuads\(S\.mesh, edges\);/);
  assert.match(appFunction('buildWire'), /if \(seen\.has\(k\) \|\| hidden\.has\(k\)\) continue;/);
  // Close loop and Cut open finish a crease in Crease mode
  assert.match(html, /\$\('closeCutBtn'\)\.addEventListener\('click', function \(\) \{ finishLine\(true\); \}\);/);
  assert.match(html, /\$\('openCutBtn'\)\.addEventListener\('click', function \(\) \{ finishLine\(false\); \}\);/);
});
