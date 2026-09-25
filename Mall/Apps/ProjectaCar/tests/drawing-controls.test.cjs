const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', 'WrapaCar_v9.html'), 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const coreContext = vm.createContext({});
vm.runInContext(scripts[0], coreContext);
const PC = coreContext.PanelCore;
function appFunction(name) {
  const start = scripts[1].indexOf('  function ' + name + '(');
  assert.ok(start >= 0, name);
  const end = scripts[1].indexOf('\n  }', start) + 4;
  return scripts[1].slice(start, end);
}

function harness() {
  const elements = new Map();
  const $ = id => {
    if (!elements.has(id)) elements.set(id, { checked: false, value: '0', textContent: '', innerHTML: '' });
    return elements.get(id);
  };
  $('mirrorOn').checked = $('snapMirror').checked = true;
  const mesh = PC.makeMesh([-1,-1,0, 1,-1,0, 1,1,0, -1,1,0], [0,1,2, 0,2,3]);
  const S = { mesh, mode: 'draw', points: [], history: [], selected: -1, unwrap: null, panels: [], suggestions: [],
    plane: { axis: 0, offset: 0, extent: [2,2,0], diag: Math.sqrt(8) } };
  const canvas = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 1000 }) };
  class Vector3 {
    constructor(x,y,z) { Object.assign(this, {x,y,z}); }
    project() { this.x /= 5; this.y /= 5; return this; }
  }
  let hit = { faceIndex: 0, point: { x: 0.02, y: 0, z: 0 }, distance: 5 };
  const raycaster = { setFromCamera() {}, intersectObject() { return hit ? [hit] : []; } };
  const ctx = vm.createContext({ $, PC, S, canvas, raycaster, meshObj: {}, DL: null,
    camera: { fov: 42 }, THREE: { Vector2: class {}, Vector3 }, renderSuggestions() {}, showErase() {} });
  for (const name of ['mirrorEnabled', 'activePlane', 'planeOffset', 'mirrorTolerance',
    'symmetricPanelReady', 'drawingOutline', 'drawingAnchor', 'centerPanelStarted', 'canCloseSeam', 'seamOnPlane', 'pick', 'updateButtons', 'updateHud',
    'leadPoint', 'seamNet', 'seamPick', 'seamStretch', 'hasLooseEnds', 'isCreaseEnd', 'withSeamTail', 'seamHooks',
    'stretchPoints', 'liftStretch', 'allJoined', 'closingPreview', 'pruneSuggestions']) {
    vm.runInContext(appFunction(name), ctx);
  }
  return { ctx, $, S, setHit: value => { hit = value; } };
}

test('both app scripts compile and mirror snapping defaults on', () => {
  for (const script of scripts) new vm.Script(script);
  assert.match(html, /id="snapMirror" checked/);
});

test('drawing pick snaps to surface-plane intersection and respects controls', () => {
  const { ctx, $, S, setHit } = harness();
  let pick = ctx.pick({ clientX: 502, clientY: 500 });
  assert.equal(pick.snapped, true);
  assert.equal(pick.p[0], 0);
  assert.equal(pick.p[2], 0);
  $('snapMirror').checked = false;
  assert.ok(Math.abs(ctx.pick({ clientX: 502, clientY: 500 }).p[0] - 0.02) < 1e-12);
  $('snapMirror').checked = true;
  $('mirrorOn').checked = false;
  assert.ok(Math.abs(ctx.pick({ clientX: 502, clientY: 500 }).p[0] - 0.02) < 1e-12);
  $('mirrorOn').checked = true;
  S.mode = 'pick';
  assert.ok(Math.abs(ctx.pick({ clientX: 502, clientY: 500 }).p[0] - 0.02) < 1e-12);
  S.mode = 'draw';
  setHit({ faceIndex: 0, point: { x: 0.2, y: 0, z: 0 }, distance: 5 });
  assert.ok(Math.abs(ctx.pick({ clientX: 520, clientY: 500 }).p[0] - 0.2) < 1e-12);
  setHit(null);
  assert.equal(ctx.pick({ clientX: 520, clientY: 500 }), null);
});

test('snap radius follows zoom and rejects a projected candidate too far from pointer', () => {
  const { ctx, setHit } = harness();
  assert.equal(ctx.pick({ clientX: 550, clientY: 500 }).snapped, undefined);
  setHit({ faceIndex: 0, point: { x: 0.02, y: 0, z: 0 }, distance: 0.5 });
  assert.equal(ctx.pick({ clientX: 502, clientY: 500 }).snapped, undefined);
});

test('plane-to-plane outline offers Finish panel and updates after mirror changes', () => {
  const { ctx, $, S } = harness();
  S.points = [{p:[0,-0.4,0]}, {p:[0.5,0,0]}, {p:[0,0.4,0]}];
  ctx.updateButtons(); ctx.updateHud();
  assert.equal($('closeCutBtn').textContent, 'Finish panel');
  assert.equal($('closeCutBtn').disabled, false);
  assert.match($('hud').innerHTML, /Symmetrical panel ready/);
  $('mirrorRange').value = '100';
  ctx.updateButtons(); ctx.updateHud();
  assert.equal($('closeCutBtn').textContent, 'Close loop');
  assert.doesNotMatch($('hud').innerHTML, /Symmetrical panel ready/);
  $('mirrorRange').value = '0';
  $('mirrorOn').checked = false;
  ctx.updateButtons();
  assert.equal($('closeCutBtn').textContent, 'Close loop');
});

test('failed cut keeps drawing points and the complete undo history', () => {
  const { ctx, S } = harness();
  S.points = [{p:[0,-0.4,0]}, {p:[0.5,0,0]}, {p:[0,0.4,0]}];
  S.history = Array.from({length:12}, (_,i) => ({id:i}));
  const previous = S.history.slice();
  const messages = [];
  ctx.PC = Object.assign({}, PC, {
    traceSeam: () => ({ complete: true, symmetric: true, chords: [{}] }),
    applyCuts: () => { throw new Error('Cannot triangulate'); }
  });
  ctx.toast = message => messages.push(message);
  vm.runInContext(appFunction('snapshot') + '\n' + appFunction('doCut'), ctx);
  ctx.doCut(true);
  assert.deepEqual([...S.history], previous);
  assert.equal(S.points.length, 3);
  assert.match(messages[0], /Could not apply/);
});

for (const closed of [false, true]) test(`${closed ? 'Finish panel' : 'Cut open'} joins both halves, and Undo restores the original surface`, () => {
  const { ctx, S } = harness();
  const before = PC.cloneMesh(S.mesh);
  S.points = [[0,-0.4,0], [0.5,0,0], [0,0.4,0]].map(p => PC.closestOnSurface(S.mesh, p));
  S.edgeMap = PC.buildEdgeMap(S.mesh);
  const messages = [];
  ctx.toast = message => messages.push(message);
  ctx.fmt = String;
  ctx.setAtlasEmpty = () => {};
  ctx.syncAll = () => {};
  ctx.clearPoints = () => { S.points = []; };
  ctx.recomputePanels = () => {
    S.edgeMap = PC.buildEdgeMap(S.mesh);
    const regions = PC.computePanels(S.mesh, S.edgeMap);
    S.mesh.panel = Array.from(regions.label);
    S.panels = regions.comps.map((faces, id) => ({ faces, id }));
  };
  for (const name of ['snapshot', 'doCut', 'undoCut']) vm.runInContext(appFunction(name), ctx);
  ctx.doCut(closed);
  assert.equal(S.panels.length, 2);
  const left = PC.closestOnSurface(S.mesh, [-0.1,0,0]);
  const right = PC.closestOnSurface(S.mesh, [0.1,0,0]);
  assert.equal(S.mesh.panel[left.tri], S.mesh.panel[right.tri]);
  assert.equal(S.points.length, 0);
  assert.equal(S.history.length, 1);
  assert.match(messages[0], /Symmetrical panel completed/);
  S.points = [{ tri: S.mesh.tris.length / 3 - 1, p: [0.1,0,0] }];
  ctx.undoCut();
  assert.equal(S.panels.length, 1);
  assert.equal(S.points.length, 0, 'Undo clears picks that referenced the previous triangle numbering');
  assert.deepEqual(S.mesh.pos, before.pos);
  assert.deepEqual(S.mesh.tris, before.tris);
  assert.equal(S.mesh.cut.size, 0);
  assert.equal(S.history.length, 0);
});

for (const mirrored of [false, true]) test(`Float32 render hits accept consecutive door-outline clicks and close a panel with mirroring ${mirrored ? 'on' : 'off'}`, () => {
  const { ctx, $, S, setHit } = harness();
  $('mirrorOn').checked = mirrored;
  // Rendering converts these non-binary-exact coordinates to Float32. The
  // raycaster's barycentric hit is consequently slightly off the core surface.
  const pos = [], tris = [];
  for (const y of [-1.19, 0, 1.19]) for (const x of [-1.37, 0, 1.37]) {
    pos.push(x, y, 0.23456789 + 0.123456789 * y);
  }
  for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
    const a = y * 3 + x, b = a + 1, d = a + 3, c = d + 1;
    tris.push(a, b, c, a, c, d);
  }
  S.mesh = PC.makeMesh(pos, tris);
  S.edgeMap = PC.buildEdgeMap(S.mesh);
  S.segs = []; S.live = null; S.radius = 2;
  class Geometry {
    constructor() { this.attributes = {}; }
    setAttribute(name, attribute) { this.attributes[name] = attribute; }
    dispose() {}
  }
  class Marker {
    constructor(geometry, material) {
      this.geometry = geometry; this.material = material;
      this.position = { set() {} }; this.scale = { setScalar() {} };
    }
  }
  const group = () => ({ children: [], add(value) { this.children.push(value); },
    remove(value) { this.children.splice(this.children.indexOf(value), 1); } });
  Object.assign(ctx.THREE, { Mesh: Marker, BufferGeometry: Geometry,
    Float32BufferAttribute: class { constructor(array, itemSize) { Object.assign(this, { array, itemSize }); } } });
  Object.assign(ctx, { dots: group(), ghostDots: group(), leadDots: group(), dotGeo: {}, dotMat: {}, snapDotMat: {},
    ghostDotMat: {}, cursor: {}, pathObj: { geometry: new Geometry() }, ghostObj: { geometry: new Geometry() },
    closeObj: { geometry: new Geometry() },
    vnCache: Array.from({ length: pos.length / 3 }, () => [0, -0.123456789, 1]).flat(),
    fmt: String, setAtlasEmpty() {}, syncAll() {} });
  const messages = [];
  ctx.toast = message => messages.push(message);
  ctx.recomputePanels = () => {
    S.edgeMap = PC.buildEdgeMap(S.mesh);
    const regions = PC.computePanels(S.mesh, S.edgeMap);
    S.mesh.panel = Array.from(regions.label);
    S.panels = regions.comps.map((faces, id) => ({ faces, id }));
  };
  for (const name of ['traceSeg', 'crossPoint', 'segPoints', 'syncGhostDots', 'syncDrawingSegments', 'rebuildPath',
    'addPoint', 'clearPoints', 'snapshot', 'doCut']) vm.runInContext(appFunction(name), ctx);

  const clicks = [[3, [0.45, 0.2, 0.35]], [2, [0.3, 0.15, 0.55]],
    [6, [0.3, 0.25, 0.45]], [7, [0.55, 0.2, 0.25]]];
  for (let index = 0; index < clicks.length; index++) {
    const [faceIndex, weights] = clicks[index];
    const raw = [0, 1, 2].map(axis => weights.reduce((sum, weight, corner) =>
      sum + weight * Math.fround(pos[3 * tris[3 * faceIndex + corner] + axis]), 0));
    assert.ok(PC.closestOnSurface(S.mesh, raw).d > 1e-10, 'Fixture reproduces render/core precision mismatch');
    setHit({ faceIndex, point: { x: raw[0], y: raw[1], z: raw[2] }, distance: 5 });
    const picked = ctx.pick({ clientX: 500 + raw[0] * 100, clientY: 500 - raw[1] * 100 });
    ctx.addPoint(picked);
    assert.equal(S.points.length, index + 1,
      `Click ${index + 1} must be accepted; messages: ${messages.join('; ')}`);
    assert.equal(S.segs.length, index, 'Every accepted point extends the preview');
  }
  assert.equal(ctx.dots.children.length, 4);
  assert.equal(ctx.pathObj.visible, true);
  assert.equal(messages.length, 0);
  ctx.doCut(true);
  assert.equal(S.panels.length, mirrored ? 3 : 2, 'The door panel closes, with a separate reflected panel when enabled');
  assert.equal(S.points.length, 0);
  assert.equal(S.history.length, 1);
  assert.match(messages[0], /Seam applied/);
});
