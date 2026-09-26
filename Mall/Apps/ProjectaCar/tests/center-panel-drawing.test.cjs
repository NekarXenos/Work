'use strict';

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

function grid() {
  const pos = [], tris = [];
  for (const y of [-2, -1, 0, 1, 2]) for (const x of [-2, -1, 0, 1, 2]) pos.push(x, y, 0);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
    const a = y * 5 + x;
    tris.push(a, a + 1, a + 6, a, a + 6, a + 5);
  }
  return PC.makeMesh(pos, tris);
}

function harness() {
  const elements = new Map(), keys = {}, messages = [], traces = [];
  const $ = id => {
    if (!elements.has(id)) elements.set(id, { checked: false, value: '0', textContent: '', innerHTML: '' });
    return elements.get(id);
  };
  $('mirrorOn').checked = true;
  const S = { mesh: grid(), mode: 'draw', points: [], segs: [], live: null, radius: 2,
    history: [], selected: -1, unwrap: null, panels: [], suggestions: [],
    plane: { axis: 0, offset: 0, extent: [4, 4, 0], diag: Math.sqrt(32) } };
  S.edgeMap = PC.buildEdgeMap(S.mesh);
  const group = () => ({ children: [], add(value) { this.children.push(value); },
    remove(value) { this.children.splice(this.children.indexOf(value), 1); } });
  class Marker {
    constructor() { this.position = { set() {} }; this.scale = { setScalar() {} }; }
  }
  const app = vm.createContext({ $, S, DL: null, THREE: { Mesh: Marker },
    PC: Object.assign({}, PC, {
      traceSeam(...args) { traces.push(args[2]); return PC.traceSeam(...args); }
    }),
    dots: group(), ghostDots: group(), leadDots: group(), dotGeo: {}, dotMat: {}, snapDotMat: {}, cursor: {},
    vnCache: Array.from({ length: S.mesh.pos.length / 3 }, () => [0, 0, 1]).flat(),
    window: { addEventListener(name, callback) { keys[name] = callback; } },
    toast: message => messages.push(message), fmt: String,
    // Keep the real drawing, keyboard, geometry, and control logic; only omit rendering.
    rebuildPath() {}, syncGhostDots() {}, setAtlasEmpty() {}, syncAll() {}, renderSuggestions() {}, showErase() {},
    recomputePanels() {
      S.edgeMap = PC.buildEdgeMap(S.mesh);
      const regions = PC.computePanels(S.mesh, S.edgeMap);
      S.mesh.panel = Array.from(regions.label);
      S.panels = regions.comps.map((faces, id) => ({ faces, id }));
    }
  });
  for (const name of ['mirrorEnabled', 'activePlane', 'planeOffset', 'mirrorTolerance',
    'seamOnPlane', 'drawingOutline', 'drawingAnchor', 'syncDrawingSegments',
    'symmetricPanelReady', 'centerPanelStarted', 'canCloseSeam',
    'traceSeg', 'crossPoint', 'segPoints', 'addPoint', 'clearPoints', 'undoPoint', 'snapshot',
    'doCut', 'updateButtons', 'updateHud', 'leadPoint', 'seamNet', 'seamPick', 'seamStretch', 'hasLooseEnds', 'isCreaseEnd', 'withSeamTail', 'seamHooks',
    'stretchPoints', 'liftStretch', 'allJoined', 'closingPreview', 'pruneSuggestions']) vm.runInContext(appFunction(name), app);
  const keyStart = scripts[1].indexOf("  window.addEventListener('keydown',");
  const keyEnd = scripts[1].indexOf('\n  });', keyStart) + '\n  });'.length;
  assert.ok(keyStart >= 0 && keyEnd > keyStart, 'Actual keyboard handler exists');
  vm.runInContext(scripts[1].slice(keyStart, keyEnd), app);
  function click(p) {
    const hit = PC.closestOnSurface(S.mesh, p);
    assert.ok(hit && hit.tri >= 0 && hit.d < 1e-10, 'Click lies on the test surface');
    app.addPoint(hit);
    return hit;
  }
  function enter() {
    let prevented = false;
    keys.keydown({ key: 'Enter', target: { tagName: 'BODY' }, preventDefault() { prevented = true; } });
    return prevented;
  }
  return { app, S, $, click, enter, messages, traces };
}

function nearPoint(actual, expected) {
  for (let axis = 0; axis < 3; axis++) assert.ok(Math.abs(actual[axis] - expected[axis]) < 1e-9,
    `Coordinate ${axis}: expected ${expected[axis]}, got ${actual[axis]}`);
}

function assertPreview(h, orderedPoints) {
  assert.deepEqual([...h.app.drawingOutline()], orderedPoints);
  assert.equal(h.S.segs.length, orderedPoints.length - 1);
  for (let i = 0; i < h.S.segs.length; i++) {
    assert.strictEqual(h.S.segs[i][0], orderedPoints[i].p, 'Preview starts each segment at the ordered point');
    assert.strictEqual(h.S.segs[i].at(-1), orderedPoints[i + 1].p, 'Preview has no connector across the outline');
  }
}

function assertCenterPanel(h, interior) {
  assert.equal(h.S.panels.length, 2, h.messages.join('; '));
  const labelAt = p => h.S.mesh.panel[PC.closestOnSurface(h.S.mesh, p).tri];
  assert.equal(labelAt(interior), labelAt([-interior[0], interior[1], interior[2]]),
    'Both mirrored halves belong to the same center panel');
  assert.notEqual(labelAt(interior), labelAt([1.7, 1.7, 0]), 'The outline separates the panel from the outside');
  for (const edge of h.S.mesh.cut) {
    const [a, b] = edge.split(':').map(Number);
    assert.ok(Math.abs(h.S.mesh.pos[3 * a]) > 1e-9 || Math.abs(h.S.mesh.pos[3 * b]) > 1e-9,
      'No seam cuts down the mirror plane');
  }
  assert.equal(h.S.points.length, 0);
  assert.equal(h.S.history.length, 1);
  assert.match(h.messages.at(-1), /Symmetrical panel completed/);
  assert.equal(PC.checkManifold(h.S.mesh).nonManifold, 0);
}

test('plane start immediately offers Finish panel, and consecutive clicks join the actual first point', () => {
  const h = harness();
  h.app.updateButtons();
  assert.equal(h.$('closeCutBtn').textContent, 'Close loop');
  const first = h.click([0, -0.8, 0]);
  assert.equal(h.$('closeCutBtn').textContent, 'Finish panel');
  assert.equal(h.$('closeCutBtn').disabled, true);
  assert.equal(h.enter(), false);
  assert.match(h.$('hud').innerHTML, /mirror plane/);
  const second = h.click([0.8, 0.5, 0]);
  assert.equal(h.S.points.length, 2);
  assert.equal(h.S.segs.length, 1);
  assert.strictEqual(h.S.segs[0][0], first.p);
  assert.strictEqual(h.S.segs[0].at(-1), second.p);
  assert.equal(h.$('closeCutBtn').disabled, false);
  assert.equal(h.enter(), true, 'The actual Enter handler accepts a two-click center outline');
  assert.equal(h.traces[0].length, 3);
  nearPoint(h.traces[0].at(-1).p, [0, 0.5, 0]);
  assertCenterPanel(h, [0.1, 0.1, 0]);
});

test('reaching the plane switches drawing back to the first clicked point, and undo restores click order', () => {
  const h = harness();
  const a = h.click([0.8, -0.2, 0]), b = h.click([0.6, -0.6, 0]);
  assert.strictEqual(h.app.drawingAnchor(), b);
  assertPreview(h, [a, b]);
  const c = h.click([0, -0.8, 0]);
  assert.deepEqual([...h.S.points], [a, b, c], 'Confirmed clicks stay chronological for undo');
  assert.strictEqual(h.app.drawingAnchor(), a, 'The next point extends the original first point');
  assertPreview(h, [c, b, a]);
  assert.equal(h.$('closeCutBtn').textContent, 'Finish panel');
  const d = h.click([0.7, 0.6, 0]);
  assert.deepEqual([...h.S.points], [a, b, c, d]);
  assertPreview(h, [c, b, a, d]);
  assert.strictEqual(h.app.drawingAnchor(), d);
  assert.equal(h.app.dots.children.length, 4, 'The direction change adds no extra clicked point');
  h.app.undoPoint();
  assert.deepEqual([...h.S.points], [a, b, c]);
  assert.strictEqual(h.app.drawingAnchor(), a);
  assertPreview(h, [c, b, a]);
  h.app.undoPoint();
  assert.deepEqual([...h.S.points], [a, b]);
  assert.strictEqual(h.app.drawingAnchor(), b, 'Removing the plane click restores the original drawing direction');
  assertPreview(h, [a, b]);
  assert.equal(h.app.dots.children.length, 2);
  assert.equal(h.$('closeCutBtn').textContent, 'Close loop');
  assert.equal(h.$('closeCutBtn').disabled, true);
});

test('Enter immediately after reaching the plane projects the original first point', () => {
  const h = harness();
  const a = h.click([0.8, -0.2, 0]), b = h.click([0.6, -0.6, 0]), c = h.click([0, -0.8, 0]);
  assert.equal(h.enter(), true);
  assert.equal(h.traces[0].length, 4);
  assert.deepEqual([...h.traces[0].slice(0, 3)], [c, b, a]);
  nearPoint(h.traces[0].at(-1).p, [0, -0.2, 0]);
  assertCenterPanel(h, [0.15, -0.5, 0]);
});

test('mirror changes keep the drawing anchor and ordered preview consistent', () => {
  const h = harness();
  const a = h.click([0.8, -0.2, 0]), b = h.click([0.6, -0.6, 0]), c = h.click([0, -0.8, 0]);
  assertPreview(h, [c, b, a]);
  h.$('mirrorOn').checked = false;
  h.app.syncDrawingSegments();
  assert.strictEqual(h.app.drawingAnchor(), c);
  assertPreview(h, [a, b, c]);
  h.$('mirrorOn').checked = true;
  h.app.syncDrawingSegments();
  assert.strictEqual(h.app.drawingAnchor(), a);
  assertPreview(h, [c, b, a]);
  assert.deepEqual([...h.S.points], [a, b, c], 'Toggling mirroring does not reorder the click history');
});

for (const manual of [false, true]) test(`a center outline starting off-plane finishes with ${manual ? 'a second plane click' : 'Enter projection'}`, () => {
  const h = harness();
  const a = h.click([0.8, -0.2, 0]), b = h.click([0.6, -0.6, 0]);
  const c = h.click([0, -0.8, 0]), d = h.click([0.7, 0.6, 0]);
  const e = manual ? h.click([0, 0.8, 0]) : null;
  const ordered = [c, b, a, d].concat(e ? [e] : []);
  assertPreview(h, ordered);
  assert.equal(h.S.points.length, manual ? 5 : 4);
  if (manual) h.app.PC.projectToMirrorPlane = () => assert.fail('The second plane click already supplies the endpoint');
  assert.equal(h.enter(), true);
  assert.equal(h.traces[0].length, 5);
  assert.deepEqual([...h.traces[0].slice(0, 4)], [c, b, a, d], 'Cutting uses the same continuous outline as the preview');
  if (manual) assert.strictEqual(h.traces[0].at(-1), e);
  else nearPoint(h.traces[0].at(-1).p, [0, 0.6, 0]);
  assertCenterPanel(h, [0.15, 0.1, 0]);
});

for (const side of [1, -1]) test(`Enter extends an unfinished center outline on side ${side} to its reflected midpoint`, () => {
  const h = harness();
  for (const p of [[0, -0.8, 0], [side * 0.7, -0.5, 0], [side * 0.8, 0.6, 0]]) h.click(p);
  const last = h.S.points.at(-1);
  const reflected = PC.mirrorPoint(last.p, 0, 0);
  const midpoint = last.p.map((value, axis) => (value + reflected[axis]) / 2);
  assert.equal(h.enter(), true);
  assert.equal(h.traces[0].length, 4);
  nearPoint(h.traces[0].at(-1).p, midpoint);
  assertCenterPanel(h, [0.15, 0.1, 0]);
});

test('manually ending on the mirror plane finishes without adding another endpoint', () => {
  const h = harness();
  h.app.PC.projectToMirrorPlane = () => assert.fail('A manually finished outline needs no projection');
  for (const p of [[0, -0.8, 0], [0.8, 0, 0], [0, 0.8, 0]]) h.click(p);
  const last = h.S.points.at(-1);
  assert.match(h.$('hud').innerHTML, /Symmetrical panel ready/);
  h.enter();
  assert.equal(h.traces[0].length, 3);
  assert.strictEqual(h.traces[0].at(-1), last);
  assertCenterPanel(h, [0.1, 0.1, 0]);
});

test('controls require a usable outline and follow mirror settings', () => {
  const h = harness();
  h.click([0, -0.8, 0]); h.click([0, 0.5, 0]);
  assert.equal(h.$('closeCutBtn').disabled, true, 'Two points along the plane cannot enclose a panel');
  assert.equal(h.enter(), false);
  h.app.clearPoints();
  h.click([0, -0.8, 0]); h.click([0.8, 0.5, 0]);
  h.$('mirrorOn').checked = false;
  h.app.updateButtons();
  assert.equal(h.$('closeCutBtn').textContent, 'Close loop');
  assert.equal(h.$('closeCutBtn').disabled, true);
  h.$('mirrorOn').checked = true;
  h.$('mirrorRange').value = '100';
  h.app.updateButtons();
  assert.equal(h.$('closeCutBtn').textContent, 'Close loop', 'Moving the plane changes whether the first point is central');
});

for (const stage of ['projection', 'trace', 'apply']) test(`failed ${stage} preserves clicked points, preview, mesh, and full undo history`, () => {
  const h = harness();
  h.click([0, -0.8, 0]); h.click([0.8, 0.5, 0]);
  h.S.history = Array.from({ length: 12 }, (_, id) => ({ id }));
  const points = h.S.points, segments = h.S.segs, originalPoints = [...points], history = [...h.S.history];
  const before = PC.cloneMesh(h.S.mesh);
  if (stage === 'projection') h.app.PC.projectToMirrorPlane = () => null;
  if (stage === 'trace') h.app.PC.traceSeam = (mesh, edgeMap, attempted) => {
    assert.equal(attempted.length, 3, 'Only the temporary outline contains the projected endpoint');
    return { complete: false, mirrored: true, chords: [] };
  };
  if (stage === 'apply') h.app.PC.applyCuts = () => { throw new Error('Cannot triangulate'); };
  h.enter();
  assert.strictEqual(h.S.points, points);
  assert.deepEqual([...h.S.points], originalPoints, 'No synthetic endpoint remains in the drawing');
  assert.strictEqual(h.S.segs, segments);
  assert.equal(h.S.segs.length, 1);
  assert.deepEqual([...h.S.history], history);
  assert.deepEqual(h.S.mesh.pos, before.pos);
  assert.deepEqual(h.S.mesh.tris, before.tris);
  assert.deepEqual(h.S.mesh.panel, before.panel);
  assert.deepEqual([...h.S.mesh.cut], [...before.cut]);
  assert.match(h.messages.at(-1), /[Cc]ould not/);
});

for (const mirrored of [false, true]) test(`ordinary off-plane loops retain their behavior with mirroring ${mirrored ? 'on' : 'off'}`, () => {
  const h = harness();
  h.$('mirrorOn').checked = mirrored;
  h.app.PC.projectToMirrorPlane = () => assert.fail('Off-plane starts are ordinary loops');
  for (const p of [[0.25, -0.6, 0], [0.9, -0.5, 0], [0.8, 0.6, 0], [0.25, 0.5, 0]]) h.click(p);
  assert.equal(h.$('closeCutBtn').textContent, 'Close loop');
  h.enter();
  assert.equal(h.traces[0].length, 4);
  assert.equal(h.S.panels.length, mirrored ? 3 : 2, h.messages.join('; '));
  assert.match(h.messages.at(-1), /Seam applied/);
});

test('with mirroring off a plane-starting outline closes back to its first point', () => {
  const h = harness();
  h.$('mirrorOn').checked = false;
  h.app.PC.projectToMirrorPlane = () => assert.fail('Disabled mirroring cannot project an endpoint');
  for (const p of [[0, -0.8, 0], [0.8, -0.4, 0], [0.7, 0.6, 0]]) h.click(p);
  h.enter();
  assert.equal(h.traces[0].length, 3);
  assert.equal(h.S.panels.length, 2, h.messages.join('; '));
  assert.match(h.messages.at(-1), /Seam applied/);
});

for (const [name, outline] of [
  ['projected endpoint coincides with the first point', [[0, -0.8, 0], [0.8, -0.8, 0]]],
  ['intermediate plane anchor pinches the center panel',
    [[0, -0.8, 0], [0.8, -0.5, 0], [0, 0, 0], [0.8, 0.6, 0]]]
]) test(`invalid center outline is retained when ${name}`, () => {
  const h = harness();
  for (const p of outline) h.click(p);
  assert.equal(h.S.points.length, outline.length);
  const points = h.S.points, originalPoints = [...points], before = PC.cloneMesh(h.S.mesh);
  h.enter();
  assert.strictEqual(h.S.points, points);
  assert.deepEqual([...h.S.points], originalPoints);
  assert.equal(h.S.history.length, 0);
  assert.equal(h.traces.length, 0, 'Reject the invalid outline before tracing or applying a cut');
  assert.deepEqual(h.S.mesh.pos, before.pos);
  assert.deepEqual(h.S.mesh.tris, before.tris);
  assert.deepEqual(h.S.mesh.panel, before.panel);
  assert.equal(h.S.mesh.cut.size, 0);
  assert.match(h.messages.at(-1), /distinct start and end points/);
});
