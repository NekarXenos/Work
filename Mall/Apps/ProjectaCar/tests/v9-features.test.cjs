'use strict';

// v9: separate mirrored islands, suggested seams, removing seams, and
// snapping to seams (a crease taken into a drawn seam).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', 'WrapaCar_v10.html'), 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1])
  .filter(source => !source.includes('/* VectorCore'));
const core = vm.createContext({});
vm.runInContext(scripts[0], core);
const PC = core.PanelCore;

function appFunction(name) {
  const start = scripts[1].indexOf('  function ' + name + '(');
  const end = scripts[1].indexOf('\n  function ', start + 1);
  assert.ok(start >= 0 && end > start, 'App function exists: ' + name);
  return scripts[1].slice(start, end);
}

function near(actual, expected, message, epsilon = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${message}: expected ${expected}, received ${actual}`);
}

// A flat sheet of vertices on z = 0 at integer x and y from -n to n.
function grid(n = 2) {
  const w = 2 * n + 1, pos = [], tris = [];
  for (let y = -n; y <= n; y++) for (let x = -n; x <= n; x++) pos.push(x, y, 0);
  for (let y = 0; y < w - 1; y++) for (let x = 0; x < w - 1; x++) {
    const a = y * w + x;
    tris.push(a, a + 1, a + w + 1, a, a + w + 1, a + w);
  }
  const mesh = PC.makeMesh(pos, tris);
  mesh.n = n;
  return mesh;
}
const at = (x, y, n = 2) => (y + n) * (2 * n + 1) + (x + n);
function cut(mesh, ...corners) {
  const n = mesh.n || 2;
  for (let i = 1; i < corners.length; i++) mesh.cut.add(PC.ekey(at(...corners[i - 1], n), at(...corners[i], n)));
}
const plain = value => JSON.parse(JSON.stringify(Array.from(value)));
function panelAt(mesh, p) {
  const regions = PC.computePanels(mesh, PC.buildEdgeMap(mesh));
  return { label: regions.label[PC.closestOnSurface(mesh, p).tri], count: regions.comps.length };
}

/* ------------------------------------------------------ seam network */

test('seam runs split the cut network at junctions and loose ends', () => {
  const mesh = grid();
  cut(mesh, [-2, 0], [-1, 0], [0, 0], [1, 0], [2, 0]);
  cut(mesh, [0, 0], [0, 1], [0, 2]);
  const net = PC.seamRuns(mesh);
  assert.equal(net.runs.length, 3, 'A T-junction makes three runs');
  for (const run of net.runs) {
    assert.equal(run.edges.length, 2);
    assert.equal(run.closed, false);
    assert.ok(run.verts[0] === at(0, 0) || run.verts.at(-1) === at(0, 0), 'Every run ends at the junction');
  }
  assert.equal(net.runsAt.get(at(0, 0)).length, 3);
  assert.deepEqual([...net.adj.entries()].filter(([, ns]) => ns.length === 1).map(([v]) => v).sort((a, b) => a - b),
    [at(-2, 0), at(2, 0), at(0, 2)].sort((a, b) => a - b));

  const ring = grid();
  cut(ring, [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]);
  const loop = PC.seamRuns(ring);
  assert.equal(loop.runs.length, 1);
  assert.equal(loop.runs[0].closed, true);
  assert.equal(loop.runs[0].edges.length, 8);
});

test('nearest seam prefers loose ends, then settles edge spots onto nearby vertices', () => {
  const mesh = grid();
  cut(mesh, [-1, 1], [0, 1], [1, 1]);
  const net = PC.seamRuns(mesh);
  const end = PC.nearestSeam(mesh, net, [-0.8, 1.02, 0], 0.5);
  assert.equal(end.v, at(-1, 1), 'A loose end in reach wins over a closer edge');
  assert.equal(end.end, true);
  const mid = PC.nearestSeam(mesh, net, [0.5, 1.03, 0], 0.1);
  assert.equal(mid.e, PC.ekey(at(0, 1), at(1, 1)));
  near(mid.p[0], 0.5, 'The spot lies on the seam');
  const settled = PC.nearestSeam(mesh, net, [0.1, 1.02, 0], 0.1);
  assert.equal(settled.v, at(0, 1), 'A spot right beside a vertex settles on it');
  assert.equal(settled.end, false);
  assert.ok(PC.nearestSeam(mesh, net, [0.1, 1.02, 0], 0.1, { edgesOnly: true }).e, 'edgesOnly keeps the edge spot');
  assert.equal(PC.nearestSeam(mesh, net, [0, -1, 0], 0.5), null, 'Nothing out of reach');
});

test('seam links follow the shared run, the short way round a ring', () => {
  const mesh = grid();
  cut(mesh, [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]);
  const net = PC.seamRuns(mesh);
  const link = PC.seamLink(mesh, net, { v: at(-1, -1) }, { v: at(1, -1) });
  assert.deepEqual(plain(link.points).map(p => p.slice(0, 2)), [[-1, -1], [0, -1], [1, -1]]);
  assert.deepEqual([...link.ids], [at(-1, -1), at(0, -1), at(1, -1)]);
  near(link.length, 2, 'Short way round');
  const back = PC.seamLink(mesh, net, { v: at(-1, 0) }, { v: at(0, -1) });
  near(back.length, 2, 'Crossing the ring start still takes the short way');
  const spot = PC.seamLink(mesh, net, { e: PC.ekey(at(0, -1), at(1, -1)), a: at(0, -1), b: at(1, -1), t: 0.5 }, { v: at(1, 1) });
  near(spot.length, 2.5, 'A spot part way along an edge is a valid end');
  assert.equal(spot.ids[0], -1);

  const apart = grid();
  cut(apart, [-1, 1], [1, 1]);
  cut(apart, [-1, -1], [1, -1]);
  assert.equal(PC.seamLink(apart, PC.seamRuns(apart), { v: at(-1, 1) }, { v: at(-1, -1) }), null, 'Separate runs are not linked');
});

test('a loose end leads along its run to the far end, or to the mirror plane', () => {
  const mesh = grid();
  cut(mesh, [-1, 1], [0, 1], [1, 1]);
  const net = PC.seamRuns(mesh);
  assert.equal(PC.seamRunEnd(mesh, net, at(-1, 1), null).v, at(1, 1));
  const plane = PC.seamRunEnd(mesh, net, at(-1, 1), { axis: 0, offset: 0 }, 1e-9);
  assert.equal(plane.v, at(0, 1), 'Stops at the vertex on the plane');
  const between = PC.seamRunEnd(mesh, net, at(-1, 1), { axis: 0, offset: 0.5 }, 1e-9);
  assert.equal(between.e, PC.ekey(at(0, 1), at(1, 1)));
  assert.deepEqual(plain(between.p), [0.5, 1, 0], 'Stops where an edge crosses the plane');
  assert.equal(PC.seamRunEnd(mesh, net, at(0, 1), null), null, 'Only loose ends lead anywhere');
  const crossing = PC.seamPlaneCrossing(mesh, net, [0.45, 1.1, 0], 0, 0.5, 0.3);
  assert.deepEqual(plain(crossing.p), [0.5, 1, 0]);
});

/* ------------------------------------------------- traceSeam hooks */

test('traceSeam hooks skip stretches, route through points, and override reflections', () => {
  const mesh = grid(), edges = PC.buildEdgeMap(mesh);
  const pick = p => { const h = PC.closestOnSurface(mesh, p); return { tri: h.tri, p: h.p }; };
  const a = pick([-1.5, -1.3, 0]), b = pick([-0.4, -1.1, 0]), c = pick([-0.6, 0.7, 0]);
  const plain = PC.traceSeam(mesh, edges, [b, c], false, null);
  const skipped = PC.traceSeam(mesh, edges, [a, b, c], false, null, { link: (x, y) => x === a && y === b ? 'skip' : null });
  assert.equal(skipped.chords.length, plain.chords.length, 'The skipped stretch adds no chords');

  const via = pick([-1.7, 1.4, 0]);
  const routed = PC.traceSeam(mesh, edges, [b, c], false, null, { link: () => ({ via: [via] }) });
  const touches = routed.chords.some(ch => [ch.A, ch.B].some(e => e.p && Math.hypot(e.p[0] - via.p[0], e.p[1] - via.p[1]) < 1e-9));
  assert.ok(touches, 'The routed seam passes through the via point');

  const target = pick([1.3, -1.25, 0]), seen = [];
  const mirrored = PC.traceSeam(mesh, edges, [a, b], false, { axis: 0, offset: 0 }, {
    reflect: pt => { seen.push(pt); return pt === a ? target : null; }
  });
  assert.equal(mirrored.mirrored, true);
  assert.deepEqual(seen, [a, b], 'Every point is offered to the hook once');
  assert.ok(mirrored.chords.some(ch => [ch.A, ch.B].some(e => e.p && Math.hypot(e.p[0] - 1.3, e.p[1] + 1.25) < 1e-9)),
    'The overridden reflection is used');
});

/* -------------------------------------------------- suggested seams */

function carMesh() {
  const app = vm.createContext({ PC, TAU: Math.PI * 2 });
  for (const name of ['gridMesh', 'orientOutward', 'carBody']) vm.runInContext(appFunction(name), app);
  const mesh = app.carBody(), P = mesh.pos, lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], P[i + k]); hi[k] = Math.max(hi[k], P[i + k]); }
  const c = [0, 1, 2].map(k => (lo[k] + hi[k]) / 2), s = 3 / Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
  for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) P[i + k] = (P[i + k] - c[k]) * s;
  return mesh;
}

function applyPath(mesh, points) {
  const locator = PC.faceLocator(mesh);
  const picks = points.map(p => { const h = locator.closest(p); return { tri: h.tri, p: h.p }; });
  const trace = PC.traceSeam(mesh, PC.buildEdgeMap(mesh), picks, false, null);
  assert.equal(trace.complete, true);
  PC.applyCuts(mesh, trace.chords, PC.buildEdgeMap(mesh));
}

test('suggested seams join the car\'s open crease ends, one mirrored suggestion per end of the car', () => {
  const mesh = carMesh(), edges = PC.buildEdgeMap(mesh);
  PC.markCreases(mesh, edges, 35);
  assert.equal(PC.computePanels(mesh, edges).comps.length, 1, 'The creases alone close no panel');
  const plane = PC.detectMirror(mesh);
  const suggestions = PC.suggestSeams(mesh, edges, { plane: { axis: plane.axis, offset: plane.offset } });
  assert.equal(suggestions.length, 2);
  for (const s of suggestions) {
    assert.equal(s.kind, 'ends');
    assert.ok(s.twin, 'Each side of the car pairs with its reflection');
    assert.ok(s.length < 0.3 && s.length >= Math.hypot(...s.pa.map((v, i) => v - s.pb[i])) - 1e-9);
    assert.deepEqual(plain(s.points[0]), plain(s.pa));
    assert.deepEqual(plain(s.points.at(-1)), plain(s.pb));
    for (const end of [s.a, s.b, s.twin.a, s.twin.b]) {
      assert.equal([...mesh.cut].filter(k => k.split(':').map(Number).includes(end)).length, 1, 'Endpoints are crease ends');
    }
  }
  const before = mesh.tris.length;
  for (const s of suggestions) { applyPath(mesh, s.points); applyPath(mesh, s.twin.points); }
  assert.ok(mesh.tris.length > before);
  const panels = PC.computePanels(mesh, PC.buildEdgeMap(mesh));
  assert.equal(panels.comps.length, 3, 'Nose and tail close into panels');
  const check = PC.checkManifold(mesh);
  assert.equal(check.nonManifold, 0);
  assert.equal(check.boundary, 0);
  assert.equal(PC.suggestSeams(mesh, PC.buildEdgeMap(mesh), { plane }).length, 0, 'Nothing left to suggest');
});

test('an L-shaped panel is split from its inner corner to the far corner, and convex panels are left alone', () => {
  const pos = [], tris = [], id = (x, y) => y * 5 + x;
  for (let y = 0; y <= 4; y++) for (let x = 0; x <= 4; x++) pos.push(x, y, 0);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
    if (x >= 2 && y >= 2) continue;
    tris.push(id(x, y), id(x + 1, y), id(x + 1, y + 1), id(x, y), id(x + 1, y + 1), id(x, y + 1));
  }
  const L = PC.makeMesh(pos, tris);
  const found = PC.suggestSeams(L, PC.buildEdgeMap(L));
  assert.equal(found.length, 1, JSON.stringify(found.map(s => [s.pa, s.pb])));
  assert.equal(found[0].kind, 'corners');
  assert.deepEqual([found[0].a, found[0].b].sort((a, b) => a - b), [id(0, 0), id(2, 2)].sort((a, b) => a - b));
  near(found[0].length, Math.SQRT2 * 2, 'The split runs straight across the panel', 1e-9);

  assert.equal(PC.suggestSeams(grid(), PC.buildEdgeMap(grid())).length, 0, 'A square panel needs no split');
});

test('two open creases in a flat panel are joined at their closest ends', () => {
  const mesh = grid(4);
  cut(mesh, [-1, 1], [0, 1], [1, 1]);
  cut(mesh, [-1, -1], [0, -1], [1, -1]);
  const edges = PC.buildEdgeMap(mesh);
  const single = PC.suggestSeams(mesh, edges);
  assert.equal(single.length, 2);
  for (const s of single) {
    assert.equal(s.kind, 'ends');
    near(Math.abs(s.pa[0]), 1, 'Joins ends on the same side');
    near(s.pa[0], s.pb[0], 'Straight down the side');
    near(s.length, 2, 'Closest ends');
  }
  const paired = PC.suggestSeams(mesh, edges, { plane: { axis: 0, offset: 0 } });
  assert.equal(paired.length, 1, 'With the mirror, the two sides make one suggestion');
  assert.ok(paired[0].twin);
  applyPath(mesh, paired[0].points); applyPath(mesh, paired[0].twin.points);
  const inside = panelAt(mesh, [0.3, 0.2, 0]), outside = panelAt(mesh, [1.6, 0.2, 0]);
  assert.equal(inside.count, 2);
  assert.notEqual(inside.label, outside.label);

  const edge = grid();
  cut(edge, [-1, 1], [0, 1], [1, 1]);
  cut(edge, [-1, -1], [0, -1], [1, -1]);
  const toBorder = PC.suggestSeams(edge, PC.buildEdgeMap(edge));
  assert.ok(toBorder.every(s => s.kind === 'end' && s.length <= 1 + 1e-9),
    'On a small open sheet the closest thing to each crease end is the sheet\'s own border');
});

/* ------------------------------------------------ separate twin islands */

function uvWinding(u, faces) {
  let pos = 0, neg = 0;
  for (const f of faces) {
    const a = u.uv.slice(6 * f, 6 * f + 6), s = (a[2] - a[0]) * (a[5] - a[1]) - (a[3] - a[1]) * (a[4] - a[0]);
    if (s > 0) pos++; else if (s < 0) neg++;
  }
  return { pos, neg };
}

// where world "up" points in an island's layout, averaged over its faces
function upInLayout(mesh, u, faces) {
  let gu = 0, gv = 0;
  for (const f of faces) {
    const v = [0, 1, 2].map(c => mesh.pos.slice(3 * mesh.tris[3 * f + c], 3 * mesh.tris[3 * f + c] + 3));
    const uv = u.uv.slice(6 * f, 6 * f + 6);
    const e1 = v[1].map((x, i) => x - v[0][i]), e2 = v[2].map((x, i) => x - v[0][i]);
    const d = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
    const g11 = d(e1, e1), g12 = d(e1, e2), g22 = d(e2, e2), det = g11 * g22 - g12 * g12;
    if (Math.abs(det) < 1e-20) continue;
    const r1 = e1[1], r2 = e2[1], a = (r1 * g22 - r2 * g12) / det, b = (r2 * g11 - r1 * g12) / det;
    gu += a * (uv[2] - uv[0]) + b * (uv[4] - uv[0]); gv += a * (uv[3] - uv[1]) + b * (uv[5] - uv[1]);
  }
  return [gu, gv];
}

test('mirrored twins get their own correctly handed island, laid out as a mirror image', () => {
  const mesh = carMesh(), plane = PC.detectMirror(mesh), mirror = { axis: plane.axis, offset: plane.offset };
  const locator = PC.faceLocator(mesh);
  const side = (x, y) => {
    let best = null;
    for (let z = 1; z > 0; z -= 0.01) { const h = locator.closest([x, y, z]); if (!best || h.d < best.d) best = h; }
    return { tri: best.tri, p: best.p };
  };
  const door = [[-0.3, 0.05], [0.4, 0.05], [0.4, -0.25], [-0.3, -0.25]].map(([x, y]) => side(x, y));
  const trace = PC.traceSeam(mesh, PC.buildEdgeMap(mesh), door, true, mirror);
  assert.equal(trace.mirrored, true);
  PC.applyCuts(mesh, trace.chords, PC.buildEdgeMap(mesh));
  const regions = PC.computePanels(mesh, PC.buildEdgeMap(mesh));
  mesh.panel = Array.from(regions.label);
  const opts = { mirror, up: plane.up, forward: plane.forward, topBias: 0.5, keepOrient: true, iterations: 12 };

  const shared = PC.unwrap(mesh, mesh.panel, opts);
  const sharedTwin = shared.islands.find(is => is.shared);
  assert.ok(sharedTwin, 'Without the option the twin borrows its partner\'s island');
  assert.deepEqual(sharedTwin.box, shared.islands.find(is => is.panel === sharedTwin.mirrorOf).box);
  assert.equal(uvWinding(shared, sharedTwin.faceList).pos, 0, 'A borrowed island reads back to front on the twin');

  const apart = PC.unwrap(mesh, mesh.panel, Object.assign({ separateMirror: true }, opts));
  assert.equal(apart.islands.filter(is => is.shared).length, 0);
  const twin = apart.islands.find(is => is.separate), rep = apart.islands.find(is => is.panel === twin.mirrorOf);
  assert.ok(twin && rep);
  const boxes = [twin.box, rep.box];
  assert.ok(boxes[0].x + boxes[0].w <= boxes[1].x + 1e-9 || boxes[1].x + boxes[1].w <= boxes[0].x + 1e-9 ||
    boxes[0].y + boxes[0].h <= boxes[1].y + 1e-9 || boxes[1].y + boxes[1].h <= boxes[0].y + 1e-9, 'Each side has its own atlas space');
  near(twin.box.w, rep.box.w, 'Same size as its partner', 1e-12);
  near(twin.box.h, rep.box.h, 'Same size as its partner', 1e-12);
  assert.deepEqual(uvWinding(apart, twin.faceList), { pos: twin.faceList.length, neg: 0 }, 'Text reads the right way round');
  assert.deepEqual(uvWinding(apart, rep.faceList), { pos: rep.faceList.length, neg: 0 });
  const upTwin = upInLayout(mesh, apart, twin.faceList), upRep = upInLayout(mesh, apart, rep.faceList);
  assert.ok(upTwin[0] * upRep[0] + upTwin[1] * upRep[1] > 0, 'Up points the same way on both islands');
});

/* ----------------------------------------------- the drawing app itself */

function harness(options = {}) {
  const elements = new Map(), keys = {}, messages = [];
  const $ = id => {
    if (!elements.has(id)) elements.set(id, { checked: false, value: '0', textContent: '', innerHTML: '' });
    return elements.get(id);
  };
  $('mirrorOn').checked = !!options.mirror;
  $('snapSeams').checked = options.snap !== false;
  const S = { mesh: options.mesh || grid(), mode: 'draw', points: [], segs: [], live: null, radius: 2,
    history: [], selected: -1, unwrap: null, panels: [], suggestions: [], seams: null,
    plane: { axis: 0, offset: 0, extent: [4, 4, 0], diag: Math.sqrt(32) } };
  const group = () => ({ children: [], add(value) { this.children.push(value); },
    remove(value) { this.children.splice(this.children.indexOf(value), 1); } });
  class Marker { constructor() { this.position = { set() {} }; this.scale = { setScalar() {} }; } }
  const app = vm.createContext({ $, S, PC, DL: null, THREE: { Mesh: Marker },
    dots: group(), ghostDots: group(), leadDots: group(), dotGeo: {}, dotMat: {}, snapDotMat: {}, cursor: {},
    vnCache: new Array(3 * 5000).fill(0).map((_, i) => (i % 3 === 2 ? 1 : 0)),
    window: { addEventListener(name, callback) { keys[name] = callback; } },
    toast: message => messages.push(message), fmt: String,
    rebuildPath() {}, syncGhostDots() {}, setAtlasEmpty() {}, syncAll() {}, renderSuggestions() {}, showErase() {},
    recomputePanels() {
      S.edgeMap = PC.buildEdgeMap(S.mesh);
      const regions = PC.computePanels(S.mesh, S.edgeMap);
      S.mesh.panel = Array.from(regions.label);
      S.panels = regions.comps.map((faces, id) => ({ faces, id }));
      S.seams = null;
    }
  });
  for (const name of ['mirrorEnabled', 'activePlane', 'planeOffset', 'mirrorTolerance', 'seamOnPlane',
    'drawingOutline', 'leadPoint', 'seamNet', 'seamPick', 'seamStretch', 'hasLooseEnds', 'isCreaseEnd', 'withSeamTail',
    'seamHooks', 'drawingAnchor', 'centerPanelStarted', 'canCloseSeam', 'symmetricPanelReady', 'syncDrawingSegments',
    'stretchPoints', 'liftStretch', 'allJoined', 'closingPreview', 'traceSeg', 'crossPoint', 'segPoints',
    'addPoint', 'clearPoints', 'undoPoint', 'snapshot', 'undoCut', 'doCut', 'updateButtons', 'updateHud',
    'pruneSuggestions', 'mirrorRun', 'removeSeams', 'findSuggestion', 'applySuggestion', 'afterSuggestedCut',
    'acceptSuggestion', 'rejectSuggestion', 'acceptAllSuggestions', 'rejectAllSuggestions']) vm.runInContext(appFunction(name), app);
  const keyStart = scripts[1].indexOf("  window.addEventListener('keydown',");
  const keyEnd = scripts[1].indexOf('\n  });', keyStart) + '\n  });'.length;
  vm.runInContext(scripts[1].slice(keyStart, keyEnd), app);
  app.recomputePanels();
  const press = key => keys.keydown({ key, target: { tagName: 'BODY' }, preventDefault() {} });
  // a click as the real picker would deliver it, held on a seam when it is on one
  function click(p) {
    const net = S.mesh.cut.size ? PC.seamRuns(S.mesh) : null;
    const spot = net && $('snapSeams').checked ? PC.nearestSeam(S.mesh, net, p, 1e-6) : null;
    const hit = spot ? app.seamPick(spot) : (h => ({ tri: h.tri, p: h.p }))(PC.closestOnSurface(S.mesh, p));
    app.addPoint(hit);
    return hit;
  }
  return { app, S, $, click, press, messages };
}

test('starting on a crease end takes the crease in, and Enter closes at its other end', () => {
  const h = harness();
  cut(h.S.mesh, [-1, 1], [0, 1], [1, 1]);
  h.app.recomputePanels();
  h.click([-1, 1, 0]);
  const lead = h.app.leadPoint();
  assert.ok(lead, 'The crease is taken in');
  assert.deepEqual(plain(lead.p), [1, 1, 0], 'The outline begins at the crease\'s far end');
  assert.equal(h.app.drawingOutline()[0], lead);
  assert.equal(h.app.canCloseSeam(), true, 'One more point is not even needed to close');
  h.app.updateButtons();
  assert.equal(h.$('closeCutBtn').textContent, 'Close panel');
  assert.match(h.$('hud').innerHTML, /Crease taken in/);
  h.click([-0.5, -1.5, 0]);
  assert.equal(h.S.segs.length, 2);
  assert.equal(h.S.segs[0].length, 3, 'The preview follows the crease through its middle vertex');
  h.press('Enter');
  assert.match(h.messages.at(-1), /Panel closed along the crease/);
  const inside = panelAt(h.S.mesh, [0, 0.2, 0]), outside = panelAt(h.S.mesh, [1.5, -1.5, 0]);
  assert.equal(inside.count, 2);
  assert.notEqual(inside.label, outside.label);
  assert.equal(PC.checkManifold(h.S.mesh).nonManifold, 0);
  assert.equal(h.S.points.length, 0);
});

test('without snapping, or off a loose end, drawing behaves as before', () => {
  const off = harness({ snap: false });
  cut(off.S.mesh, [-1, 1], [0, 1], [1, 1]);
  off.app.recomputePanels();
  off.click([-1, 1, 0]);
  assert.equal(off.app.leadPoint(), null);
  assert.equal(off.app.canCloseSeam(), false);

  const middle = harness();
  cut(middle.S.mesh, [-1, 1], [0, 1], [1, 1]);
  middle.app.recomputePanels();
  middle.click([0, 1, 0]);
  assert.equal(middle.app.leadPoint(), null, 'Only a loose end takes its crease in');
});

test('Backspace on the crease end drops the crease again', () => {
  const h = harness();
  cut(h.S.mesh, [-1, 1], [0, 1], [1, 1]);
  h.app.recomputePanels();
  h.click([-1, 1, 0]);
  assert.ok(h.app.leadPoint());
  h.press('Backspace');
  assert.equal(h.S.points.length, 0);
  assert.equal(h.app.leadPoint(), null);
  assert.equal(h.app.drawingOutline().length, 0);
});

test('with only the crease drawn, Enter closes it with a straight seam between its ends', () => {
  const h = harness();
  cut(h.S.mesh, [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1]);
  h.app.recomputePanels();
  h.click([-1, 1, 0]);
  h.press('Enter');
  const inside = panelAt(h.S.mesh, [0, 0, 0]), outside = panelAt(h.S.mesh, [0, 1.6, 0]);
  assert.equal(inside.count, 2, h.messages.join('; '));
  assert.notEqual(inside.label, outside.label);
});

test('ending on another crease end takes that crease in too', () => {
  for (const mirror of [false, true]) {
    const h = harness({ mirror });
    cut(h.S.mesh, [-1, 1], [0, 1], [1, 1]);
    cut(h.S.mesh, [-1, -1], [0, -1], [1, -1]);
    h.app.recomputePanels();
    h.click([-1, 1, 0]);
    if (mirror) {
      assert.deepEqual(plain(h.app.leadPoint().p), [0, 1, 0], 'With the mirror, the crease counts up to the centre plane');
      assert.equal(h.app.centerPanelStarted(), true);
    }
    h.click([-1, -1, 0]);
    h.press('Enter');
    assert.match(h.messages.at(-1), mirror ? /Symmetrical panel completed/ : /Panel closed along the crease/);
    const inside = panelAt(h.S.mesh, [0.4, 0, 0]), left = panelAt(h.S.mesh, [-0.4, 0, 0]), outside = panelAt(h.S.mesh, [1.6, 0, 0]);
    assert.equal(inside.count, 2, `mirror ${mirror}: ${h.messages.join('; ')}`);
    assert.equal(inside.label, left.label, 'Both halves form one panel');
    assert.notEqual(inside.label, outside.label);
    for (const edge of h.S.mesh.cut) {
      const [a, b] = edge.split(':').map(Number);
      const xa = h.S.mesh.pos[3 * a], xb = h.S.mesh.pos[3 * b];
      assert.ok(!(Math.abs(xa) < 1e-9 && Math.abs(xb) < 1e-9), 'No seam runs down the mirror plane');
    }
  }
});

test('a mirrored seam from a crease end also closes on the far side, along the mirrored crease', () => {
  const h = harness({ mirror: true });
  cut(h.S.mesh, [-2, 1], [-1, 1]);
  cut(h.S.mesh, [1, 1], [2, 1]);
  h.app.recomputePanels();
  const before = h.S.mesh.cut.size;
  h.click([-1, 1, 0]);
  assert.deepEqual(plain(h.app.leadPoint().p), [-2, 1, 0]);
  h.click([-1.5, -0.5, 0]);
  h.press('Enter');
  assert.match(h.messages.at(-1), /mirrored to both flanks/);
  const left = panelAt(h.S.mesh, [-1.6, 0.5, 0]), right = panelAt(h.S.mesh, [1.6, 0.5, 0]), middle = panelAt(h.S.mesh, [0, 0, 0]);
  assert.equal(middle.count, 3, h.messages.join('; '));
  assert.notEqual(left.label, middle.label);
  assert.notEqual(right.label, middle.label);
  assert.ok(h.S.mesh.cut.size > before);
});

test('removing a seam takes its mirror image with it, and undo puts both back', () => {
  const h = harness({ mirror: true });
  cut(h.S.mesh, [-1, -1], [-1, 0], [-1, 1]);
  cut(h.S.mesh, [1, -1], [1, 0], [1, 1]);
  cut(h.S.mesh, [-2, 2], [-1, 2]);
  h.app.recomputePanels();
  const net = h.app.seamNet(), left = net.runOf.get(PC.ekey(at(-1, -1), at(-1, 0)));
  const twin = h.app.mirrorRun(left);
  assert.equal(twin, net.runOf.get(PC.ekey(at(1, -1), at(1, 0))));
  assert.equal(h.app.mirrorRun(net.runOf.get(PC.ekey(at(-2, 2), at(-1, 2)))), -1, 'An unmatched seam has no twin');
  h.app.removeSeams([left, twin]);
  assert.equal(h.S.mesh.cut.size, 1);
  assert.match(h.messages.at(-1), /Seam and its mirror removed/);
  h.app.undoCut();
  assert.equal(h.S.mesh.cut.size, 5);
});

test('suggestions can be accepted, rejected, and brought back by undo', () => {
  const h = harness({ mirror: true });
  cut(h.S.mesh, [-1, 1], [0, 1], [1, 1]);
  cut(h.S.mesh, [-1, -1], [0, -1], [1, -1]);
  cut(h.S.mesh, [-2, 2], [-1, 2]);
  h.app.recomputePanels();
  const list = PC.suggestSeams(h.S.mesh, h.S.edgeMap, { plane: { axis: 0, offset: 0 } });
  assert.ok(list.length >= 1);
  list.forEach((s, i) => { s.id = i + 1; });
  h.S.suggestions = list.slice();
  const first = list.find(s => s.twin);
  h.app.acceptSuggestion(first.id);
  assert.match(h.messages.at(-1), /Seam accepted on both sides/);
  assert.equal(h.S.suggestions.includes(first), false);
  assert.equal(panelAt(h.S.mesh, [0, 0, 0]).count >= 2, true);
  h.app.undoCut();
  assert.equal(h.S.suggestions.includes(first), true, 'Undo brings the accepted suggestion back');
  assert.equal(panelAt(h.S.mesh, [0, 0, 0]).count, 1);
  h.app.rejectSuggestion(first.id);
  assert.equal(h.S.suggestions.includes(first), false);
  assert.equal(h.S.history.length, 0, 'Rejecting never touches the mesh');
  h.S.suggestions = list.slice();
  h.app.acceptAllSuggestions();
  assert.equal(h.S.suggestions.length, 0);
  assert.equal(h.S.history.length, 1, 'Accept all is one undo step');
  h.S.suggestions = list.slice();
  h.press('Escape');
  assert.equal(h.S.suggestions.length, 0, 'Escape dismisses the list');
});

test('suggestions whose corners are no longer on a seam are dropped', () => {
  const h = harness({ mesh: grid(4) });
  cut(h.S.mesh, [-1, 1], [0, 1], [1, 1]);
  cut(h.S.mesh, [-1, -1], [0, -1], [1, -1]);
  h.app.recomputePanels();
  h.S.suggestions = PC.suggestSeams(h.S.mesh, h.S.edgeMap).map((s, i) => Object.assign(s, { id: i + 1 }));
  assert.equal(h.S.suggestions.length, 2);
  const net = h.app.seamNet();
  h.app.removeSeams([net.runOf.get(PC.ekey(at(-1, 1, 4), at(0, 1, 4)))]);
  assert.equal(h.S.suggestions.length, 0, 'Both suggestions used an end of the removed crease');
});
