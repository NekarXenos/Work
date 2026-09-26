'use strict';

// v11: floating seams, snapping to panel corners and edges (open borders
// included), moving seam nodes, and seams suggested to fit printable vinyl.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'WrapaCar_v11.html'), 'utf8');
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

// A flat sheet of vertices on z = 0 at integer x and y from -n to n.
function grid(n = 4) {
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
const at = (x, y, n = 4) => (y + n) * (2 * n + 1) + (x + n);
function cut(mesh, ...corners) {
  const n = mesh.n || 4;
  for (let i = 1; i < corners.length; i++) mesh.cut.add(PC.ekey(at(...corners[i - 1], n), at(...corners[i], n)));
}
const key = (mesh, a, b) => PC.ekey(at(...a, mesh.n), at(...b, mesh.n));

// A flat sheet w by h (model units), `per` cells to a unit, with cells for
// which hole(x, y) is true left out.
function sheet(w, h, per = 10, hole = null) {
  const nx = Math.round(w * per), ny = Math.round(h * per), pos = [], tris = [];
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) pos.push(i / per, j / per, 0);
  const id = (i, j) => j * (nx + 1) + i;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    if (hole && hole((i + 0.5) / per, (j + 0.5) / per)) continue;
    tris.push(id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j), id(i + 1, j + 1), id(i, j + 1));
  }
  const used = new Map(), P = [], T = [];
  for (const v of tris) if (!used.has(v)) { used.set(v, P.length / 3); P.push(pos[3 * v], pos[3 * v + 1], pos[3 * v + 2]); }
  for (const v of tris) T.push(used.get(v));
  return PC.makeMesh(P, T);
}

function applyPaths(mesh, paths) {
  for (const pts of paths) {
    const locator = PC.faceLocator(mesh), edges = PC.buildEdgeMap(mesh);
    const picks = pts.map(p => { const h = locator.closest(p); return { tri: h.tri, p: h.p }; });
    const trace = PC.traceSeam(mesh, edges, picks, false, null);
    assert.equal(trace.complete, true, 'Every suggested seam traces on the surface');
    if (trace.chords.length) PC.applyCuts(mesh, trace.chords, edges);
  }
}
function applyAll(mesh, list) {
  for (const sg of list) applyPaths(mesh, sg.paths.concat(sg.twin ? sg.twin.paths : []).map(p => p.points));
}

// Every panel flattened as the unwrap does, with its narrowest width in mm.
function widths(mesh, unit, flat) {
  const regions = PC.computePanels(mesh, PC.buildEdgeMap(mesh));
  return regions.comps.map(faces => {
    const tri = new Int32Array(3 * faces.length);
    faces.forEach((f, j) => { for (let c = 0; c < 3; c++) tri[3 * j + c] = mesh.tris[3 * f + c]; });
    const is = PC.flattenIsland(mesh.pos, tri, Object.assign({ iterations: 26, sweeps: 8, topBias: 0.5, keepOrient: true }, flat));
    let best = Infinity;
    for (let a = 0; a < 180; a++) {
      const ca = Math.cos(a * Math.PI / 180), sa = Math.sin(a * Math.PI / 180);
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < is.nv; i++) { const s = -sa * is.U[2 * i] + ca * is.U[2 * i + 1]; lo = Math.min(lo, s); hi = Math.max(hi, s); }
      best = Math.min(best, hi - lo);
    }
    return best * unit;
  });
}

function carBody() {
  const app = vm.createContext({ PC, TAU: Math.PI * 2 });
  for (const name of ['gridMesh', 'orientOutward', 'carBody']) vm.runInContext(appFunction(name), app);
  const mesh = app.carBody(), P = mesh.pos, lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], P[i + k]); hi[k] = Math.max(hi[k], P[i + k]); }
  const c = [0, 1, 2].map(k => (lo[k] + hi[k]) / 2), s = 3 / Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
  for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) P[i + k] = (P[i + k] - c[k]) * s;
  return mesh;
}

// The supplied Car.glb, decoded and welded as the importer does, centred
// and scaled so its longest side spans 3.
function suppliedCar() {
  const file = fs.readFileSync(path.join(root, 'Car.glb'));
  let json, binary;
  for (let offset = 12; offset < file.length;) {
    const length = file.readUInt32LE(offset), type = file.readUInt32LE(offset + 4);
    const chunk = file.subarray(offset + 8, offset + 8 + length);
    if (type === 0x4e4f534a) json = JSON.parse(chunk.toString('utf8'));
    if (type === 0x004e4942) binary = chunk;
    offset += 8 + length;
  }
  function accessor(index) {
    const a = json.accessors[index], view = json.bufferViews[a.bufferView];
    const size = a.type === 'VEC3' ? 3 : 1, bytes = a.componentType === 5123 ? 2 : 4, values = [];
    const offset = (view.byteOffset || 0) + (a.byteOffset || 0);
    for (let i = 0; i < a.count; i++) for (let k = 0; k < size; k++) {
      const at2 = offset + i * (view.byteStride || size * bytes) + k * bytes;
      values.push(a.componentType === 5126 ? binary.readFloatLE(at2) : bytes === 2 ? binary.readUInt16LE(at2) : binary.readUInt32LE(at2));
    }
    return values;
  }
  const primitive = json.meshes[0].primitives[0];
  const positions = accessor(primitive.attributes.POSITION), indices = accessor(primitive.indices);
  const welded = PC.weld(positions, indices, Math.max(...PC.meshBounds(positions).ext) * 1e-5);
  const P = welded.pos, lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], P[i + k]); hi[k] = Math.max(hi[k], P[i + k]); }
  const c = [0, 1, 2].map(k => (lo[k] + hi[k]) / 2), s = 3 / Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
  for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) P[i + k] = (P[i + k] - c[k]) * s;
  return PC.makeMesh(P, welded.tris);
}

/* -------------------------------------------------------- floating seams */

test('floating seams are trimmed back until every seam closes or runs from edge to edge', () => {
  const mesh = grid();
  cut(mesh, [-4, 0], [-3, 0], [-2, 0], [-1, 0], [0, 0], [1, 0], [2, 0], [3, 0], [4, 0]); // border to border
  cut(mesh, [0, 0], [0, 1], [0, 2]);                                                       // a branch into the panel
  cut(mesh, [-2, -2], [-1, -2], [-1, -3]);                                                 // loose at both ends
  cut(mesh, [2, -1], [3, -1], [3, -2], [2, -2], [2, -1]);                                  // a closed loop
  cut(mesh, [-3, 2], [-3, 3], [-3, 4]);                                                    // stops inside at one end
  cut(mesh, [1, 2], [2, 2], [3, 2], [2, 2], [2, 3]);                                       // a loose little tree
  const found = PC.floatingSeams(mesh, PC.buildEdgeMap(mesh));
  const dropped = new Set(found.edges);
  for (const k of [key(mesh, [0, 0], [0, 1]), key(mesh, [0, 1], [0, 2]), key(mesh, [-2, -2], [-1, -2]),
    key(mesh, [-1, -2], [-1, -3]), key(mesh, [-3, 2], [-3, 3]), key(mesh, [-3, 3], [-3, 4]),
    key(mesh, [1, 2], [2, 2]), key(mesh, [2, 2], [3, 2]), key(mesh, [2, 2], [2, 3])]) assert.ok(dropped.has(k), 'floats: ' + k);
  for (const k of [key(mesh, [-4, 0], [-3, 0]), key(mesh, [0, 0], [1, 0]), key(mesh, [2, -1], [3, -1])])
    assert.ok(!dropped.has(k), 'stays: ' + k);
  assert.equal(found.edges.length, 9);
  assert.ok(found.runs >= 4);
  found.edges.forEach(k => mesh.cut.delete(k));
  assert.equal(PC.floatingSeams(mesh, PC.buildEdgeMap(mesh)).edges.length, 0, 'Nothing floats afterwards');
  assert.equal(PC.computePanels(mesh, PC.buildEdgeMap(mesh)).comps.length, 3, 'The panels are the same as before');
});

test('an edge shared by more than two faces joins them, so it anchors no seam', () => {
  // a closed tetrahedron standing on a flat sheet, sharing one edge with it
  const mesh = grid(2), P = mesh.pos, A = P.length / 3, B = A + 1, u = at(0, 0, 2), w = at(0, 1, 2);
  P.push(0.3, 0.5, 1, -0.3, 0.5, 1);
  mesh.tris.push(u, w, A, w, u, B, u, A, B, w, B, A);
  mesh.panel.push(0, 0, 0, 0);
  mesh.cut.add(PC.ekey(at(-2, 0, 2), at(-1, 0, 2)));
  mesh.cut.add(PC.ekey(at(-1, 0, 2), u));
  const edges = PC.buildEdgeMap(mesh);
  assert.equal(edges.get(PC.ekey(u, w)).length, 4, 'A four-face edge');
  assert.equal(PC.floatingSeams(mesh, edges).edges.length, 2, 'A seam from the border to the shared edge still floats');
  const rim = PC.rimNet(mesh, edges);
  assert.ok(!rim.edges.includes(PC.ekey(u, w)), 'The shared edge is no panel outline');
});

test('the unwrap removes floating seams first when asked, and says how many went', () => {
  assert.match(html, /id="floatBtn"/);
  assert.match(html, /<input type="checkbox" id="floatAuto" checked>/);
  const start = scripts[1].indexOf('  async function runUnwrap(');
  const unwrap = scripts[1].slice(start, scripts[1].indexOf('\n  function ', start));
  assert.match(unwrap, /var floated = \$\('floatAuto'\)\.checked \? removeFloating\(true\) : 0;/);
  assert.ok(unwrap.indexOf('removeFloating(true)') < unwrap.indexOf('S.busy = true'), 'Before the unwrap starts');
  assert.match(unwrap, /floating seam/);
});

/* ------------------------------------------------- outlines and snapping */

test('panel outlines include the open border; corners win over edges', () => {
  const mesh = grid();
  cut(mesh, [-4, 0], [-3, 0], [-2, 0], [-1, 0], [0, 0], [1, 0], [2, 0], [3, 0], [4, 0]);
  cut(mesh, [0, 0], [0, 1], [0, 2]);
  const edges = PC.buildEdgeMap(mesh), rim = PC.rimNet(mesh, edges);
  assert.ok(rim.edges.includes(key(mesh, [1, 4], [2, 4])), 'The open border is an outline');
  assert.ok(rim.cut.has(key(mesh, [0, 0], [1, 0])));
  assert.equal(rim.nodes.get(at(0, 0)).kind, 'junction');
  assert.equal(rim.nodes.get(at(-4, 0)).kind, 'junction', 'Where a seam meets the border');
  assert.equal(rim.nodes.get(at(0, 2)).kind, 'end');
  assert.equal(rim.nodes.get(at(4, 4)).kind, 'corner', 'A sharp turn of the border');
  const node = PC.nearestRim(mesh, rim, [0.3, 0.2, 0], 0.5, 0.3);
  assert.equal(node.v, at(0, 0)); assert.equal(node.node, 'junction');
  const edge = PC.nearestRim(mesh, rim, [1.5, 3.9, 0], 0.3, 0.3);
  assert.equal(edge.e, key(mesh, [1, 4], [2, 4])); assert.equal(edge.border, true);
  assert.deepEqual(Array.from(edge.p), [1.5, 4, 0]);
  const skipped = PC.nearestRim(mesh, rim, [0.3, 0.2, 0], 0.5, 0.3, { skip: new Set([at(0, 0)]) });
  assert.equal(skipped, null, 'A skipped node, and the edges at it, are passed over');
  const further = PC.nearestRim(mesh, rim, [1.5, 0.2, 0], 0.5, 0.3, { skip: new Set([at(0, 0)]) });
  assert.equal(further.e, key(mesh, [1, 0], [2, 0]), 'Other edges still hold');
  assert.equal(PC.nearestRim(mesh, rim, [2.5, -2.5, 0], 0.2, 0.2), null, 'Nothing out of reach');
});

// the drawing picker, with a camera looking straight down at the sheet
function picker(mesh) {
  const elements = new Map();
  const $ = id => {
    if (!elements.has(id)) elements.set(id, { checked: false, value: '0', textContent: '', innerHTML: '' });
    return elements.get(id);
  };
  $('snapSeams').checked = true;
  const S = { mesh, mode: 'draw', points: [], history: [], selected: -1, unwrap: null, panels: [], suggestions: [],
    plane: null, edgeMap: PC.buildEdgeMap(mesh) };
  const canvas = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 1000 }) };
  // one screen pixel is 0.01 units: x right, y up
  class Vector3 {
    constructor(x, y, z) { Object.assign(this, { x, y, z }); }
    project() { this.x /= 5; this.y /= 5; this.z = 0; return this; }
  }
  let hit = null;
  const raycaster = { setFromCamera() {}, intersectObject() { return hit ? [hit] : []; } };
  const ctx = vm.createContext({ $, PC, S, canvas, raycaster, meshObj: {}, camera: { fov: 90 },
    THREE: { Vector2: class {}, Vector3 } });
  for (const name of ['pick', 'activePlane', 'mirrorEnabled', 'panelRim', 'seamNet', 'seamPick']) vm.runInContext(appFunction(name), ctx);
  return (x, y) => {
    const tri = PC.closestOnSurface(mesh, [x, y, 0]).tri;
    hit = { faceIndex: tri, point: { x, y, z: 0 }, distance: 5 };
    return ctx.pick({ clientX: 500 + x * 100, clientY: 500 - y * 100, pointerType: 'mouse' });
  };
}

test('drawing snaps to a panel corner first, then onto a seam or the open border', () => {
  const mesh = grid();
  cut(mesh, [-4, 0], [-3, 0], [-2, 0], [-1, 0], [0, 0], [1, 0], [2, 0], [3, 0], [4, 0]);
  const pick = picker(mesh);
  const corner = pick(-3.92, 0.12);
  assert.equal(corner.node, true, 'Where the seam meets the border is a corner');
  assert.deepEqual(Array.from(corner.p, v => +v.toFixed(9)), [-4, 0, 0]);
  const onSeam = pick(1.5, 0.08);
  assert.ok(onSeam.seam && onSeam.seam.e === key(mesh, [1, 0], [2, 0]), 'Onto the seam');
  assert.deepEqual(Array.from(onSeam.p, v => +v.toFixed(9)), [1.5, 0, 0]);
  const onBorder = pick(2.5, -3.93);
  assert.ok(onBorder.seam && onBorder.seam.e === key(mesh, [2, -4], [3, -4]), 'Onto the open border');
  assert.equal(onBorder.snapped, true);
  const free = pick(1.5, 1.5);
  assert.equal(free.seam, undefined, 'Away from outlines a point stays where it is');
  assert.deepEqual(Array.from(free.p, v => +v.toFixed(9)), [1.5, 1.5, 0]);
});

/* ----------------------------------------------------------- moving nodes */

test('the seam graph links nodes: junctions, ends, borders and sharp turns', () => {
  const mesh = grid();
  cut(mesh, [-4, 0], [-3, 0], [-2, 0], [-1, 0], [0, 0], [1, 0], [2, 0], [3, 0], [4, 0]);
  cut(mesh, [0, 0], [0, 1], [0, 2], [1, 2], [2, 2], [2, 3], [2, 4]);
  const g = PC.seamGraph(mesh, PC.buildEdgeMap(mesh));
  assert.equal(g.nodes.get(at(0, 0)).links.length, 3, 'A T-junction has three links');
  assert.ok(g.nodes.get(at(0, 2)), 'The turn at (0, 2) is a node');
  assert.ok(g.nodes.get(at(2, 4)).border, 'The end on the border');
  const total = g.links.reduce((n, l) => n + l.edges.length, 0);
  assert.equal(total, mesh.cut.size, 'Every seam edge belongs to exactly one link');
});

test('reshaping a path moves its ends and bends the rest along', () => {
  const mesh = grid(), edges = PC.buildEdgeMap(mesh), locator = PC.faceLocator(mesh);
  const place = p => { const h = locator.closest(p); return { tri: h.tri, p: h.p }; };
  const pts = [[-4, 0, 0], [-2, 0, 0], [0, 0, 0], [2, 0, 0], [4, 0, 0]];
  const r = PC.reshapePath(mesh, edges, pts, null, place([4, 2, 0]), { locator });
  assert.equal(r.complete, true);
  assert.deepEqual(Array.from(r.points[0]), [-4, 0, 0], 'The fixed end stays');
  assert.deepEqual(Array.from(r.points.at(-1)), [4, 2, 0]);
  for (const p of r.points) assert.ok(Math.abs(p[1] - (p[0] + 4) / 4) < 1e-9, 'A straight path stays straight');
  const kept = PC.reshapePath(mesh, edges, pts, null, place([4, 2, 0]), { locator, allow: f => PC.faceNormal(mesh, f) && centroidY(mesh, f) < 1 });
  assert.equal(kept.complete, false, 'A path kept out of faces cannot reach there');
});
function centroidY(mesh, f) { return [0, 1, 2].reduce((s, c) => s + mesh.pos[3 * mesh.tris[3 * f + c] + 1], 0) / 3; }

// the app with everything but rendering
function harness(mesh, options = {}) {
  const elements = new Map(), messages = [];
  const $ = id => {
    if (!elements.has(id)) elements.set(id, { checked: false, value: '0', textContent: '', innerHTML: '', hidden: false });
    return elements.get(id);
  };
  $('mirrorOn').checked = !!options.mirror;
  $('snapSeams').checked = true;
  const S = { mesh, mode: 'draw', points: [], segs: [], live: null, radius: 2, history: [], selected: -1, unwrap: null,
    panels: [], suggestions: [], suggestFocus: -1, seams: null, rim: null, graph: null,
    plane: { axis: 0, offset: 0, extent: [8, 8, 0], diag: Math.sqrt(128) } };
  const app = vm.createContext({ $, S, PC, toast: m => messages.push(m), fmt: String,
    setAtlasEmpty() {}, syncAll() {}, renderSuggestions() {}, showErase() {}, updateButtons() {},
    recomputePanels() {
      S.edgeMap = PC.buildEdgeMap(S.mesh);
      const regions = PC.computePanels(S.mesh, S.edgeMap);
      S.mesh.panel = Array.from(regions.label);
      S.panels = regions.comps.map((faces, id) => ({ faces, id }));
      S.seams = null; S.rim = null; S.graph = null; S.locator = null;
    } });
  for (const name of ['mirrorEnabled', 'activePlane', 'planeOffset', 'snapshot', 'undoCut', 'clearPoints', 'seamNet', 'panelRim',
    'seamGraphNow', 'surfaceLocator', 'seamPick', 'mirrorNode', 'planNodeMove', 'moveNode', 'removeFloating',
    'findSuggestion', 'suggestionPaths', 'samePoint', 'suggestionEnds', 'applySuggestions', 'applySuggestion',
    'afterSuggestedCut', 'withNeeds', 'dropSuggestions', 'acceptSuggestion', 'rejectSuggestion', 'acceptAllSuggestions',
    'rejectAllSuggestions', 'pruneSuggestions', 'planEndMove']) vm.runInContext(appFunction(name), app);
  // clearPoints touches the scene; nothing is drawn here
  app.clearPoints = () => { S.points = []; };
  app.recomputePanels();
  return { app, S, $, messages };
}

test('dragging a node re-routes its seams to the new spot, and undo puts them back', () => {
  const mesh = grid();
  cut(mesh, [-4, 0], [-3, 0], [-2, 0], [-1, 0], [0, 0], [1, 0], [2, 0], [3, 0], [4, 0]);
  cut(mesh, [0, 0], [0, 1], [0, 2], [0, 3], [0, 4]);
  const h = harness(mesh);
  assert.equal(h.S.panels.length, 3);
  const cutBefore = new Set(h.S.mesh.cut);
  const to = (p => ({ tri: p.tri, p: p.p }))(PC.closestOnSurface(h.S.mesh, [1.5, 1.5, 0]));
  assert.equal(h.app.moveNode(at(0, 0), to), true, h.messages.join('; '));
  assert.match(h.messages.at(-1), /Node moved — 3 seams follow/);
  assert.equal(h.S.panels.length, 3, 'Still three panels');
  const net = PC.seamRuns(h.S.mesh), P = h.S.mesh.pos;
  const junction = [...net.adj.entries()].find(([, ns]) => ns.length === 3);
  assert.ok(junction, 'The seams meet again');
  const v = junction[0];
  assert.deepEqual([P[3 * v], P[3 * v + 1], P[3 * v + 2]].map(x => +x.toFixed(9) || 0), [1.5, 1.5, 0], 'at the new spot');
  assert.equal(PC.floatingSeams(h.S.mesh, h.S.edgeMap).edges.length, 0, 'Nothing is left floating');
  h.app.undoCut();
  assert.deepEqual([...h.S.mesh.cut].sort(), [...cutBefore].sort(), 'Undo brings the old seams back');
});

test('with the mirror on, a node\'s reflection moves with it', () => {
  const mesh = grid();
  cut(mesh, [-2, -4], [-2, -3], [-2, -2], [-2, -1], [-2, 0], [-2, 1], [-3, 1], [-4, 1]);
  cut(mesh, [2, -4], [2, -3], [2, -2], [2, -1], [2, 0], [2, 1], [3, 1], [4, 1]);
  const h = harness(mesh, { mirror: true });
  assert.ok(h.app.seamGraphNow().nodes.get(at(-2, 1)), 'The turn is a node');
  assert.equal(h.app.mirrorNode(at(-2, 1)), at(2, 1));
  const to = (p => ({ tri: p.tri, p: p.p }))(PC.closestOnSurface(h.S.mesh, [-1, 2, 0]));
  assert.equal(h.app.moveNode(at(-2, 1), to), true, h.messages.join('; '));
  assert.match(h.messages.at(-1), /Node and its reflection moved — 4 seams follow/);
  assert.equal(h.S.panels.length, 3);
  const net = PC.seamRuns(h.S.mesh), P = h.S.mesh.pos;
  const corners = [...net.adj.keys()].filter(v => Math.abs(P[3 * v + 1] - 2) < 1e-9 && Math.abs(Math.abs(P[3 * v]) - 1) < 1e-9);
  assert.equal(corners.length, 2, 'Both corners moved, mirror images of each other');
});

/* --------------------------------------------------------- vinyl splits */

test('a panel that fits the vinyl with little waste gets no suggestion', () => {
  const mesh = sheet(2, 1);
  assert.equal(PC.suggestSplits(mesh, PC.buildEdgeMap(mesh), { unit: 1000, width: 1340 }).length, 0);
});

test('a panel wider than the roll is split along its length into strips that fit', () => {
  const mesh = sheet(3, 1.6);
  const list = PC.suggestSplits(mesh, PC.buildEdgeMap(mesh), { unit: 1000, width: 1340 });
  assert.equal(list.length, 1);
  assert.equal(list[0].kind, 'width');
  assert.ok(Math.abs(list[0].width - 1600) < 1);
  assert.deepEqual(Array.from(list[0].widths, Math.round), [800, 800], 'Even strips');
  assert.equal(list[0].paths.length, 1);
  const pts = list[0].paths[0].points;
  assert.ok(pts.every(p => Math.abs(p[1] - 0.8) < 1e-9), 'Straight along the length');
  assert.deepEqual([pts[0][0], pts.at(-1)[0]].map(v => +v.toFixed(9)).sort(), [0, 3], 'From border to border');
  applyAll(mesh, list);
  assert.ok(widths(mesh, 1000, {}).every(w => w <= 1340), 'Every piece fits');

  const bleed = PC.suggestSplits(sheet(3, 1.25), PC.buildEdgeMap(sheet(3, 1.25)), { unit: 1000, width: 1340, bleed: 50 });
  assert.equal(bleed.length, 1, 'Bleed round the piece counts against the roll');

  const wide = sheet(4, 3, 8);
  const three = PC.suggestSplits(wide, PC.buildEdgeMap(wide), { unit: 1000, width: 1340 });
  applyAll(wide, three);
  const w = widths(wide, 1000, {});
  assert.ok(w.length >= 3 && w.every(x => x <= 1340), 'A panel over twice the roll takes more strips: ' + w.map(Math.round));
});

test('an L-shaped panel is split at its inner corner, a U across its arms, a frame into bars', () => {
  const L = sheet(2.4, 2.4, 10, (x, y) => x > 0.8 && y > 0.8);
  const l = PC.suggestSplits(L, PC.buildEdgeMap(L), { unit: 1000, width: 1340 });
  assert.equal(l.length, 1);
  assert.deepEqual(Array.from(l[0].widths, Math.round), [800, 800]);
  assert.ok(l[0].wasteAfter < 1, 'No waste left');
  const ends = [l[0].paths[0].points[0], l[0].paths[0].points.at(-1)].map(p => p.map(v => +v.toFixed(6)).join(','));
  assert.ok(ends.includes('0.8,0.8,0'), 'Starts in the inner corner');

  // big enough that the vinyl saved outweighs the seams and pieces it takes
  const U = sheet(4, 1.2, 5, (x, y) => x > 0.8 && x < 3.2 && y > 0.4);
  const u = PC.suggestSplits(U, PC.buildEdgeMap(U), { unit: 1000, width: 1340, space: 0.3 });
  assert.equal(u.length, 1);
  assert.equal(u[0].kind, 'waste');
  assert.equal(u[0].paths.length, 2, 'One cut across each arm');
  assert.ok(u[0].wasteAfter < 1);

  const frame = sheet(4, 1.2, 10, (x, y) => x > 0.3 && x < 3.7 && y > 0.3 && y < 0.9);
  assert.equal(PC.suggestSplits(frame, PC.buildEdgeMap(frame), { unit: 1000, width: 1340, space: 0.45 }).length, 0,
    'Within the waste allowed, a frame stays whole');
  const bars = PC.suggestSplits(frame, PC.buildEdgeMap(frame), { unit: 1000, width: 1340, space: 0.3 });
  assert.equal(bars.length, 1);
  assert.equal(bars[0].paths.length, 4, 'Four cuts make two bars and two posts');
  assert.ok(bars[0].wasteAfter < 1);
  applyAll(frame, bars);
  assert.equal(PC.computePanels(frame, PC.buildEdgeMap(frame)).comps.length, 4);
  assert.equal(PC.floatingSeams(frame, PC.buildEdgeMap(frame)).edges.length, 0);
});

test('the built-in car is divided where it turns, then cut to fit the vinyl, symmetrically', () => {
  const mesh = carBody(), plane = PC.detectMirror(mesh), mirror = { axis: plane.axis, offset: plane.offset };
  const opts = { unit: 1500, width: 1340, plane: mirror, up: plane.up, forward: plane.forward };
  const list = PC.suggestSplits(mesh, PC.buildEdgeMap(mesh), opts);
  assert.equal(list[0].kind, 'turn', 'First the body is divided where it turns');
  assert.ok(list[0].pieces >= 4);
  assert.ok(list.some(s => s.kind === 'width'), 'Then pieces wider than the roll are split');
  for (const s of list.slice(1)) assert.ok(s.needs.includes(0) || s.needs.length === 0);
  // symmetrical: every seam point has a reflection on some seam of the same suggestion set
  const pts = [].concat(...list.map(s => [].concat(...s.paths.concat(s.twin ? s.twin.paths : []).map(p => p.points))));
  const locSeam = pts.map(p => PC.mirrorPoint(p, mirror.axis, mirror.offset));
  let worst = 0;
  for (const q of locSeam.filter((_, i) => i % 7 === 0)) worst = Math.max(worst, Math.min(...pts.map(p => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]))));
  assert.ok(worst < 0.03, 'Suggestions are mirror images across the car: ' + worst);
  applyAll(mesh, list);
  const w = widths(mesh, 1500, { up: plane.up, forward: plane.forward });
  assert.ok(w.every(x => x <= 1340), 'Every panel fits the roll: ' + w.map(Math.round).join(', '));
  assert.equal(PC.floatingSeams(mesh, PC.buildEdgeMap(mesh)).edges.length, 0, 'Every suggested seam splits something');
});

test('the supplied car: after creases and floating seams, the suggestions leave every panel within the roll', () => {
  const mesh = suppliedCar(), edges = PC.buildEdgeMap(mesh);
  PC.markCreases(mesh, edges, 35);
  const floating = PC.floatingSeams(mesh, edges);
  assert.ok(floating.runs > 10, 'Creases leave loose ends on this model');
  floating.edges.forEach(k => mesh.cut.delete(k));
  const plane = PC.detectMirror(mesh), mirror = { axis: plane.axis, offset: plane.offset };
  const before = widths(mesh, 1500, { up: plane.up, forward: plane.forward });
  assert.ok(before.some(x => x > 1340), 'The leftover body is too wide to start with');
  const list = PC.suggestSplits(mesh, PC.buildEdgeMap(mesh), { unit: 1500, width: 1340, plane: mirror, up: plane.up, forward: plane.forward });
  assert.ok(list.length >= 2);
  assert.ok(list.some(s => s.kind === 'turn' && s.panel === 0), 'The main body is divided where it turns');
  applyAll(mesh, list);
  const after = widths(mesh, 1500, { up: plane.up, forward: plane.forward });
  assert.ok(after.every(x => x <= 1340), 'Every panel fits: ' + after.filter(x => x > 1340).map(Math.round));
  assert.equal(PC.floatingSeams(mesh, PC.buildEdgeMap(mesh)).edges.length, 0);
});

/* ------------------------------------------------ reviewing suggestions */

test('suggestions come with the ones they end on, go with them, and undo brings them back', () => {
  const mesh = carBody(), plane = PC.detectMirror(mesh);
  const h = harness(mesh, { mirror: true });
  h.S.plane = { axis: plane.axis, offset: plane.offset, extent: [3, 1, 1], diag: 3.4 };
  const list = PC.suggestSplits(h.S.mesh, h.S.edgeMap, { unit: 1500, width: 1340, plane: { axis: plane.axis, offset: plane.offset }, up: plane.up, forward: plane.forward });
  list.forEach((s, i) => { s.id = i + 1; });
  list.forEach(s => { s.needs = s.needs.map(i => list[i].id); });
  const dependent = list.find(s => s.needs.length);
  assert.ok(dependent, 'A split inside a piece ends on the turn seams');
  h.S.suggestions = list.slice();
  h.app.acceptSuggestion(dependent.id);
  assert.match(h.messages.at(-1), /2 seams accepted, with the ones this one ends on/);
  assert.equal(h.S.suggestions.some(s => s.id === dependent.id || s.id === dependent.needs[0]), false);
  assert.equal(PC.floatingSeams(h.S.mesh, h.S.edgeMap).edges.length, 0);
  h.app.undoCut();
  assert.equal(h.S.suggestions.length, list.length, 'Undo brings them back');
  h.app.rejectSuggestion(dependent.needs[0]);
  assert.equal(h.S.suggestions.some(s => s.needs.length), false, 'Rejecting the turn seams takes what ended on them');
  assert.match(h.messages.at(-1), /ended on that one/);
  assert.equal(h.S.history.length, 0, 'Rejecting never touches the mesh');
  h.S.suggestions = list.slice();
  h.app.acceptAllSuggestions();
  assert.equal(h.S.suggestions.length, 0);
  assert.equal(h.S.history.length, 1, 'Accept all is one undo step');
});

test('a suggestion whose seam ended on a removed seam is dropped; its end can be dragged to another corner', () => {
  const mesh = sheet(3, 1.6, 10);
  const E = PC.buildEdgeMap(mesh);
  const h = harness(mesh);
  const list = PC.suggestSplits(h.S.mesh, E, { unit: 1000, width: 1340 });
  list.forEach((s, i) => { s.id = i + 1; });
  h.S.suggestions = list;
  h.S.suggestFocus = 1;
  h.app.pruneSuggestions();
  assert.equal(h.S.suggestions.length, 1, 'Ends on the border hold it');
  // drag the end at x = 3 down to the corner (3, 0)
  const sg = h.S.suggestions[0], pa = sg.paths[0];
  const endAt = [pa.points[0], pa.points.at(-1)].find(p => Math.abs(p[0] - 3) < 1e-9);
  const plan = h.app.planEndMove(sg, endAt, { p: [3, 0, 0] });
  assert.ok(plan && plan.length === 1);
  const moved = plan[0].points;
  const last = [moved[0], moved.at(-1)].find(p => Math.abs(p[0] - 3) < 1e-9);
  assert.deepEqual(Array.from(last, v => +v.toFixed(9)), [3, 0, 0]);
  plan.forEach(m => { m.path.points = m.points; m.path.normals = m.normals; });
  h.app.pruneSuggestions();
  assert.equal(h.S.suggestions.length, 1, 'Still on the outline after the move');
  // an end pulled off the outline no longer holds
  pa.points[0] = [1.5, 0.5, 0];
  h.app.pruneSuggestions();
  assert.equal(h.S.suggestions.length, 0);
});

test('v11 controls: vinyl width, waste allowed, floating seams, node dragging', () => {
  for (const script of scripts) new vm.Script(script);
  assert.match(html, /<title>WrapaCar v11 /);
  assert.match(html, /id="vinylWidth"[^>]*value="1340"/);
  assert.match(html, /id="spaceRange"[^>]*value="40"/);
  assert.match(appFunction('suggestOptions'), /width: \+\$\('vinylWidth'\)\.value/);
  assert.match(appFunction('suggestOptions'), /bleed: \+\$\('bleedRange'\)\.value/);
  assert.match(html, /canvas\.parentElement\.addEventListener\('pointerdown', function \(e\) \{\n    if \(e\.target !== canvas\) return;\n    if \(S\.mode === 'vector'\) \{ vecDown\(e\); return; \}\n    if \(endDown\(e\)\) return;\n    nodeDown\(e\);/);
});
