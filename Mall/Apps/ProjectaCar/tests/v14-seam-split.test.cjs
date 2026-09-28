'use strict';

// v14: a seam drawn from one seam (or the open border) to another is cut as
// one seam when Enter is pressed, splitting the panel it crosses, instead
// of being closed into a loop.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', 'WrapaCar_v14.html'), 'utf8').replace(/\r\n/g, '\n');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1])
  .filter(source => !source.includes('/* VectorCore'));
const core = vm.createContext({});
vm.runInContext(scripts[0], core);
const PC = core.PanelCore;

function appFunction(name) {
  const start = scripts[1].indexOf('  function ' + name + '(');
  assert.ok(start >= 0, 'App function exists: ' + name);
  return scripts[1].slice(start, scripts[1].indexOf('\n  }\n', start) + 4);
}

// A flat sheet of vertices on z = 0 at integer x and y from -2 to 2.
function grid(n = 2) {
  const w = 2 * n + 1, pos = [], tris = [];
  for (let y = -n; y <= n; y++) for (let x = -n; x <= n; x++) pos.push(x, y, 0);
  for (let y = 0; y < w - 1; y++) for (let x = 0; x < w - 1; x++) {
    const a = y * w + x;
    tris.push(a, a + 1, a + w + 1, a, a + w + 1, a + w);
  }
  return PC.makeMesh(pos, tris);
}
const at = (x, y) => (y + 2) * 5 + (x + 2);
function cut(mesh, ...corners) {
  for (let i = 1; i < corners.length; i++) mesh.cut.add(PC.ekey(at(...corners[i - 1]), at(...corners[i])));
}
function panelAt(mesh, p) {
  const regions = PC.computePanels(mesh, PC.buildEdgeMap(mesh));
  return { label: regions.label[PC.closestOnSurface(mesh, p).tri], count: regions.comps.length };
}
const isCut = (mesh, a, b) => mesh.cut.has(PC.ekey(at(...a), at(...b)));

function harness(options = {}) {
  const elements = new Map(), keys = {}, messages = [];
  const $ = id => {
    if (!elements.has(id)) {
      const el = { checked: false, value: '0', textContent: '', innerHTML: '', className: '', disabled: false };
      el.classList = { toggle: (name, on) => {
        const names = new Set(el.className.split(' ').filter(Boolean));
        if (on) names.add(name); else names.delete(name);
        el.className = [...names].join(' ');
      } };
      elements.set(id, el);
    }
    return elements.get(id);
  };
  $('mirrorOn').checked = !!options.mirror;
  $('snapSeams').checked = true;
  $('floatAuto').checked = true;
  const S = { mesh: grid(), mode: 'draw', points: [], segs: [], live: null, radius: 2,
    history: [], selected: -1, unwrap: null, panels: [], suggestions: [], seams: null, excludedPanels: new Set(),
    plane: { axis: 0, offset: 0, extent: [4, 4, 0], diag: Math.sqrt(32) } };
  const group = () => ({ children: [], add(value) { this.children.push(value); },
    remove(value) { this.children.splice(this.children.indexOf(value), 1); } });
  class Marker { constructor() { this.position = { set() {} }; this.scale = { setScalar() {} }; } }
  const app = vm.createContext({ $, S, PC, THREE: { Mesh: Marker },
    dots: group(), ghostDots: group(), leadDots: group(), dotGeo: {}, dotMat: {}, snapDotMat: {}, cursor: {},
    vnCache: new Array(3 * 5000).fill(0).map((_, i) => (i % 3 === 2 ? 1 : 0)),
    window: { addEventListener(name, callback) { keys[name] = callback; } },
    toast: message => messages.push(message), fmt: String,
    rebuildPath() {}, syncGhostDots() {}, setAtlasEmpty() {}, syncAll() {}, renderSuggestions() {}, showErase() {}, buildNodeDots() {},
    recomputePanels() {
      S.edgeMap = PC.buildEdgeMap(S.mesh);
      const regions = PC.computePanels(S.mesh, S.edgeMap);
      S.mesh.panel = Array.from(regions.label);
      S.panels = regions.comps.map((faces, id) => ({ faces, id }));
      S.seams = null; S.rim = null; S.graph = null;
    }
  });
  for (const name of ['mirrorEnabled', 'activePlane', 'planeOffset', 'mirrorTolerance', 'seamOnPlane',
    'drawingOutline', 'leadPoint', 'seamNet', 'panelRim', 'seamPick', 'seamStretch', 'hasLooseEnds', 'isCreaseEnd', 'withSeamTail',
    'seamHooks', 'drawingAnchor', 'centerPanelStarted', 'splitsPanel', 'canCloseSeam', 'symmetricPanelReady', 'syncDrawingSegments',
    'stretchPoints', 'liftStretch', 'allJoined', 'closingPreview', 'traceSeg', 'crossPoint', 'segPoints',
    'addPoint', 'clearPoints', 'undoPoint', 'snapshot', 'undoCut', 'doCut', 'updateButtons', 'updateHud',
    'pruneSuggestions']) vm.runInContext(appFunction(name), app);
  const keyStart = scripts[1].indexOf("  window.addEventListener('keydown',");
  vm.runInContext(scripts[1].slice(keyStart, scripts[1].indexOf('\n  });', keyStart) + '\n  });'.length), app);
  app.recomputePanels();
  const press = key => keys.keydown({ key, target: { tagName: 'BODY' }, preventDefault() {} });
  // a click as the real picker delivers it: held on a panel outline — a
  // seam or the open border — when it is on one
  function click(x, y) {
    const p = [x, y, 0], rim = app.panelRim();
    const spot = rim.edges.length ? PC.nearestRim(S.mesh, rim, p, 1e-6, 1e-6) : null;
    const hit = (spot && app.seamPick(spot)) || (h => ({ tri: h.tri, p: h.p }))(PC.closestOnSurface(S.mesh, p));
    app.addPoint(hit);
    return hit;
  }
  return { app, S, $, click, press, messages };
}

test('from a seam through the panel to the border, Enter cuts one seam and splits the panel', () => {
  const h = harness();
  cut(h.S.mesh, [0, -2], [0, -1], [0, 0], [0, 1], [0, 2]);
  h.app.recomputePanels();
  assert.equal(h.S.panels.length, 2);
  assert.ok(h.click(0, 1).seam, 'Starts on the seam');
  assert.ok(!h.click(1, 0).seam);
  assert.equal(h.app.splitsPanel(), false, 'Not while the line ends inside the panel');
  assert.ok(h.click(2, 1).seam, 'Ends on the open border');
  assert.equal(h.app.splitsPanel(), true);
  h.app.updateButtons(); h.app.updateHud();
  assert.equal(h.$('openCutBtn').textContent, 'Split panel');
  assert.match(h.$('openCutBtn').className, /\bprimary\b/);
  assert.doesNotMatch(h.$('closeCutBtn').className, /\bprimary\b/);
  assert.match(h.$('hud').innerHTML, /Both ends on a seam\.<\/b> <kbd>Enter<\/kbd> cuts this line to split the panel in two/);

  h.press('Enter');
  assert.match(h.messages.at(-1), /^Panel split — /);
  assert.equal(h.S.points.length, 0);
  const above = panelAt(h.S.mesh, [1, 1.5, 0]), right = panelAt(h.S.mesh, [1.5, 0.8, 0]), below = panelAt(h.S.mesh, [1.5, -1, 0]);
  assert.equal(above.count, 3, 'The right panel split in two');
  assert.equal(above.label, right.label, 'No loop closed back across the top');
  assert.notEqual(above.label, below.label);
  assert.ok(!isCut(h.S.mesh, [0, 1], [1, 1]) && !isCut(h.S.mesh, [1, 1], [2, 1]), 'No closing seam from the last point back to the first');
  assert.equal(PC.checkManifold(h.S.mesh).nonManifold, 0);
  assert.equal(PC.floatingSeams(h.S.mesh, h.S.edgeMap).runs, 0, 'Nothing left dangling');
});

test('two points on seams are enough: Enter splits straight across', () => {
  const h = harness();
  cut(h.S.mesh, [0, -2], [0, -1], [0, 0], [0, 1], [0, 2]);
  h.app.recomputePanels();
  h.click(2, -1); h.click(0, -1);
  assert.equal(h.app.canCloseSeam(), false, 'Two points could never close a loop');
  h.press('Enter');
  assert.match(h.messages.at(-1), /^Panel split/);
  assert.equal(panelAt(h.S.mesh, [1, 0, 0]).count, 3);
  assert.notEqual(panelAt(h.S.mesh, [1, 0, 0]).label, panelAt(h.S.mesh, [1, -1.5, 0]).label);
});

test('with the mirror on, the split is mirrored to the other flank', () => {
  const h = harness({ mirror: true });
  cut(h.S.mesh, [-2, 0], [-1, 0], [0, 0], [1, 0], [2, 0]);
  h.app.recomputePanels();
  h.click(1, 0); h.click(1, 2);
  h.press('Enter');
  assert.match(h.messages.at(-1), /^Panel split, mirrored to both flanks/);
  assert.ok(isCut(h.S.mesh, [-1, 0], [-1, 1]) && isCut(h.S.mesh, [-1, 1], [-1, 2]), 'Mirrored at x = -1');
  const left = panelAt(h.S.mesh, [-1.5, 1, 0]), middle = panelAt(h.S.mesh, [0, 1, 0]), right = panelAt(h.S.mesh, [1.5, 1, 0]);
  assert.equal(middle.count, 4);
  assert.ok(left.label !== middle.label && right.label !== middle.label && left.label !== right.label);
});

test('a line ending inside a panel, back at its start, or taking a crease in still closes a loop', () => {
  const inside = harness();
  cut(inside.S.mesh, [0, -2], [0, -1], [0, 0], [0, 1], [0, 2]);
  inside.app.recomputePanels();
  inside.click(0, 1); inside.click(1, 0); inside.click(1, 1);
  assert.equal(inside.app.splitsPanel(), false);
  inside.app.updateButtons();
  assert.equal(inside.$('openCutBtn').textContent, 'Cut open');
  assert.match(inside.$('closeCutBtn').className, /\bprimary\b/);

  const loop = harness();
  cut(loop.S.mesh, [0, -2], [0, -1], [0, 0], [0, 1], [0, 2]);
  loop.app.recomputePanels();
  loop.click(0, 1); loop.click(1, 0); loop.click(1, 1); loop.click(0, 1);
  assert.equal(loop.app.splitsPanel(), false, 'Back on its own first point it is a loop');

  // starting on a crease's loose end takes the crease in and closes at its far end
  const crease = harness();
  cut(crease.S.mesh, [-1, 1], [0, 1], [1, 1]);
  crease.app.recomputePanels();
  crease.click(-1, 1); crease.click(-2, 0);
  assert.ok(crease.app.leadPoint());
  assert.equal(crease.app.splitsPanel(), false);
  crease.press('Enter');
  assert.match(crease.messages.at(-1), /Panel closed along the crease/);
});
