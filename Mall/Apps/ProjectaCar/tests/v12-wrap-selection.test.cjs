'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const html = fs.readFileSync(path.join(__dirname, '..', 'WrapaCar_v12.html'), 'utf8');
const core = { module: { exports: {} } };
vm.runInNewContext(html.match(/<script>\s*(\/\* PanelCore[\s\S]*?)<\/script>/)[1], core);
const PC = core.module.exports;

function appFunction(name) {
  const start = html.search(new RegExp('  (?:async )?function ' + name + '\\('));
  assert.ok(start >= 0, name);
  return html.slice(start, html.indexOf('\n  }', start) + 4);
}

function harness() {
  const inputs = new Map();
  const $ = id => {
    if (!inputs.has(id)) inputs.set(id, { value: 0, checked: false, disabled: false, textContent: '' });
    return inputs.get(id);
  };
  $('modeSel').value = 'arap';
  $('padRange').value = 8;
  $('topRange').value = 0;
  $('splitMirror').checked = true;
  const mesh = PC.makeMesh(
    [-2, 0, 0, -1, 0, 0, -1, 1, 0, -2, 1, 0, 2, 0, 0, 1, 0, 0, 1, 1, 0, 2, 1, 0],
    [0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6]
  );
  mesh.panel = [0, 0, 1, 1];
  const S = { mesh, panels: [], excludedPanels: new Set(), history: [], suggestions: [], selected: -1,
    points: [], vec: { paths: [] }, busy: false, unwrap: null, bottomPanel: null };
  const messages = [];
  const ctx = vm.createContext({ PC, S, $, Set, Map, Float64Array, Int32Array,
    toast: text => messages.push(text),
    activePlane: () => ({ axis: 0, offset: 0 }), upVector: () => [0, 0, 1], forwardVector: () => [0, 1, 0],
    nextFrame: async () => {}, colourOf: () => 0x888888,
    vnCache: Array(mesh.pos.length).fill(0),
    recomputePairs: () => {
      for (const p of S.panels) { p.twin = 1 - p.id; p.rep = 0; }
    }
  });
  for (const name of ['busy', 'syncAll', 'paintAtlas', 'reportUnwrap', 'applyAtlasToggle',
    'refreshVecUI', 'buildVecOverlay', 'refreshPanelList', 'renderSuggestions', 'updateHud',
    'clearPoints', 'showErase', 'buildNodeDots']) ctx[name] = () => {};
  ctx.setAtlasEmpty = () => { ctx.atlasCleared = true; };
  ctx.centerPanelStarted = ctx.leadPoint = ctx.canCloseSeam = () => false;
  for (const name of ['recomputePanels', 'snapshot', 'undoCut', 'setPanelWrap', 'setAllPanelsWrap',
    'wrapSelectionChanged', 'runUnwrap', 'buildOBJ', 'buildMTL', 'n6', 'updateButtons']) {
    vm.runInContext(appFunction(name), ctx);
  }
  ctx.recomputePanels();
  return { ctx, S, $, messages };
}

test('all inline scripts parse', () => {
  for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
});

test('individual choice invalidates the atlas, keeps the full mesh, and clears old seam proposals', () => {
  const { ctx, S } = harness();
  const original = JSON.stringify(S.mesh);
  S.unwrap = { old: true };
  S.suggestions = [{ panel: 1 }];
  S.selected = 1;
  ctx.setPanelWrap(1, false);
  assert.equal(S.unwrap, null);
  assert.equal(ctx.atlasCleared, true);
  assert.deepEqual([...S.excludedPanels], [1]);
  assert.equal(S.selected, 1, 'Inspection is independent of wrap inclusion');
  assert.equal(S.suggestions.length, 0);
  assert.equal(JSON.stringify(S.mesh), original);
});

test('Deselect All blocks unwrap and Select All restores it without deleting panels', async () => {
  const { ctx, S, $, messages } = harness();
  ctx.setAllPanelsWrap(false);
  ctx.updateButtons();
  assert.equal($('unwrapBtn').disabled, true);
  assert.equal($('deselectAllPanelsBtn').disabled, true);
  await ctx.runUnwrap();
  assert.equal(S.unwrap, null);
  assert.match(messages.at(-1), /at least one/);
  assert.equal(S.panels.length, 2);
  ctx.setAllPanelsWrap(true);
  ctx.updateButtons();
  assert.equal($('unwrapBtn').disabled, false);
  assert.equal($('selectAllPanelsBtn').disabled, true);
  await ctx.runUnwrap();
  assert.deepEqual(Array.from(S.unwrap.islands, p => p.panel), [0, 1]);
  assert.equal($('unwrapBtn').disabled, false, 'Controls recover after asynchronous unwrap');
});

for (const selected of [0, 1]) for (const separate of [false, true]) {
  test(`unwrap packs only panel ${selected}, mirrored twins separate=${separate}`, async () => {
    const { ctx, S, $ } = harness();
    $('splitMirror').checked = separate;
    ctx.setPanelWrap(1 - selected, false);
    await ctx.runUnwrap();
    assert.ok(S.unwrap);
    assert.equal(S.unwrap.islands.length, 1);
    const island = S.unwrap.islands[0];
    assert.equal(island.panel, selected);
    assert.ok(!island.shared, 'An excluded representative cannot own the selected twin UVs');
    assert.ok(island.box.w > 0 && island.box.h > 0);
    assert.ok(Array.from(S.unwrap.uv).every(Number.isFinite));
    assert.equal(island.faceList.length, 2);
  });
}

test('OBJ preserves all surfaces while only selected materials sample the atlas', async () => {
  const { ctx, S } = harness();
  ctx.setPanelWrap(1, false);
  await ctx.runUnwrap();
  const obj = ctx.buildOBJ(), mtl = ctx.buildMTL();
  assert.equal(obj.split('\n').filter(l => l.startsWith('f ')).length, S.mesh.tris.length / 3);
  assert.match(obj.split('g panel_0')[1].split('g panel_1')[0], /f \d+\/\d+\/\d+/);
  assert.match(obj.split('g panel_1')[1], /f \d+\/\/\d+/);
  assert.match(mtl.split('newmtl panel_0')[1].split('newmtl panel_1')[0], /map_Kd atlas.png/);
  assert.doesNotMatch(mtl.split('newmtl panel_1')[1], /map_Kd/);
});

test('print PDF contains artwork and cut contours only for selected panels', async () => {
  const { ctx, S, $ } = harness();
  const vector = { module: { exports: {} } };
  vm.runInNewContext(html.match(/<script>\s*(\/\* VectorCore[\s\S]*?)<\/script>/)[1], vector);
  ctx.VC = vector.module.exports;
  ctx.setPanelWrap(1, false);
  await ctx.runUnwrap();
  ctx.mmPerAtlas = () => 4500;
  ctx.printBleed = () => 0;
  ctx.vecModel = () => ({ index: new Map(S.unwrap.islands.map((p, i) => [p.panel, i])) });
  // A pre-existing shape may cross selected and unchecked surfaces.
  S.vec.paths.push({ closed: true, fill: [0, 100, 100, 0] });
  ctx.derived = () => ({ islands: [{ panel: 0, full: true }, { panel: 1, full: true }] });
  $('pdfCut').checked = true;
  for (const name of ['pdfLayout', 'squareSegs']) vm.runInContext(appFunction(name), ctx);
  const layout = ctx.pdfLayout();
  assert.equal(layout.groups.length, 1);
  assert.equal(layout.cut.lines.length, 1);
  assert.ok(layout.groups[0].clip.length > 0);
});

test('split panels inherit wrap choices and undo restores those choices', () => {
  const { ctx, S } = harness();
  ctx.setPanelWrap(0, false);
  ctx.snapshot();
  S.mesh.cut.add(PC.ekey(0, 2));
  ctx.recomputePanels();
  assert.equal(S.panels.length, 3);
  for (const p of S.panels) assert.equal(S.excludedPanels.has(p.id), p.faces.includes(0) || p.faces.includes(1));
  ctx.undoCut();
  assert.equal(S.panels.length, 2);
  assert.deepEqual([...S.excludedPanels], [0]);
});

test('merged panels include the surface if either former panel was selected', () => {
  const { ctx, S } = harness();
  S.mesh.cut.add(PC.ekey(0, 2));
  ctx.recomputePanels();
  const first = S.panels.find(p => p.faces.includes(0)).id;
  ctx.setPanelWrap(first, false);
  S.mesh.cut.clear();
  ctx.recomputePanels();
  assert.equal(S.excludedPanels.size, 0);
});

test('selection cannot change during unwrap', () => {
  const { ctx, S } = harness();
  S.busy = true;
  ctx.setPanelWrap(0, false);
  ctx.setAllPanelsWrap(false);
  assert.equal(S.excludedPanels.size, 0);
});

test('vinyl seam suggestions skip all excluded panels', () => {
  const { S } = harness();
  const suggestions = PC.suggestSplits(S.mesh, PC.buildEdgeMap(S.mesh), {
    unit: 1500, width: 500, includePanel: () => false
  });
  assert.equal(suggestions.length, 0);
});

function previewHarness() {
  const h = harness(), { ctx } = h;
  class Color {
    constructor(hex) { this.r = (hex >> 16 & 255) / 255; this.g = (hex >> 8 & 255) / 255; this.b = (hex & 255) / 255; }
    convertSRGBToLinear() {
      for (const k of ['r', 'g', 'b']) this[k] = this[k] <= 0.04045 ? this[k] / 12.92 : ((this[k] + 0.055) / 1.055) ** 2.4;
      return this;
    }
  }
  class Geometry {
    constructor() { this.attributes = {}; this.groups = []; }
    setAttribute(name, value) { this.attributes[name] = value; }
    addGroup(start, count, materialIndex) { this.groups.push({ start, count, materialIndex }); }
    computeBoundingSphere() {}
    dispose() {}
  }
  ctx.THREE = { Color, BufferGeometry: Geometry, BufferAttribute: class {
    constructor(array, itemSize) { Object.assign(this, { array, itemSize }); }
  } };
  ctx.meshObj = { geometry: new Geometry() };
  ctx.buildSeamLines = ctx.buildWire = () => {};
  ctx.fmt = String;
  vm.runInContext(appFunction('vertexNormals'), ctx);
  vm.runInContext(appFunction('syncAll'), ctx);
  return h;
}

test('preview assigns unchecked faces to a plain material and retains all picking geometry', async () => {
  const { ctx, S } = previewHarness();
  ctx.setPanelWrap(1, false);
  await ctx.runUnwrap();
  assert.deepEqual(ctx.meshObj.geometry.groups, [
    { start: 0, count: 6, materialIndex: 0 },
    { start: 6, count: 6, materialIndex: 1 }
  ]);
  assert.equal(ctx.meshObj.geometry.attributes.position.array.length, S.mesh.tris.length * 3);
});

test('Grey and White distinguishes wrap choices before unwrap and does not brighten an inspected excluded panel', () => {
  const { ctx, S, $ } = previewHarness();
  $('baseSel').value = 'white';
  S.selected = 1;
  ctx.setPanelWrap(1, false);
  const colours = ctx.meshObj.geometry.attributes.color.array;
  assert.equal(colours[0], 1);
  assert.ok(colours[18] > 0.18 && colours[18] < 0.19, 'Grey converts to linear space for rendering');
  assert.equal(colours[18], colours[19]);
  assert.equal(colours[18], colours[20]);
  assert.match(ctx.buildMTL().split('newmtl panel_0')[1].split('newmtl panel_1')[0], /Kd 1 1 1/);
  assert.match(ctx.buildMTL().split('newmtl panel_1')[1], /Kd 0.466667 0.466667 0.466667/);
  assert.equal(S.unwrap, null);
  S.selected = -1;
  $('baseSel').value = 'colour';
  ctx.syncAll();
  const panelColours = ctx.meshObj.geometry.attributes.color.array;
  assert.equal(panelColours[0], panelColours[18], 'Panel colours still use the assigned colour');
});

test('Wrap panels clicks toggle only the hit panel; orbit drags, right clicks and busy work do not toggle', () => {
  const { ctx, S } = harness();
  const events = new Map();
  ctx.canvas = { addEventListener: (name, handler) => events.set(name, handler) };
  ctx.performance = { now: () => 100 };
  ctx.pick = () => ({ tri: 2 });
  S.mode = 'wrap';
  const start = html.indexOf('  var down = null;');
  vm.runInContext(html.slice(start, html.indexOf("  canvas.addEventListener('pointermove'", start)), ctx);
  function click(up = {}) {
    events.get('pointerdown')({ clientX: 10, clientY: 20, button: 0 });
    events.get('pointerup')({ clientX: 10, clientY: 20, button: 0, ...up });
  }
  click();
  assert.deepEqual([...S.excludedPanels], [1]);
  click();
  assert.equal(S.excludedPanels.size, 0);
  click({ clientX: 40 });
  click({ button: 2 });
  S.busy = true;
  click();
  assert.equal(S.excludedPanels.size, 0);
});
