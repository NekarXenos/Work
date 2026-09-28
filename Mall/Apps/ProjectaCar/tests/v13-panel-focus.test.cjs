'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const THREE = require('../../ZX3d_v2/vendor/three.min.js');
const html = fs.readFileSync(path.join(__dirname, '..', 'WrapaCar_v13.html'), 'utf8').replace(/\r\n/g, '\n');
const core = { module: { exports: {} } };
vm.runInNewContext(html.match(/<script>\s*(\/\* PanelCore[\s\S]*?)<\/script>/)[1], core);
const PC = core.module.exports;

function appFunction(name) {
  const start = html.search(new RegExp('  (?:async )?function ' + name + '\\('));
  assert.ok(start >= 0, name);
  return html.slice(start, html.indexOf('\n  }', start) + 4);
}

function harness() {
  const nodes = new Map();
  const document = { activeElement: null, createElement: tag => new Element(tag), getElementById: id => nodes.get(id) };
  class Element {
    constructor(tag = 'div') {
      Object.assign(this, { tagName: tag, children: [], dataset: {}, style: {}, attributes: {}, events: {},
        className: '', checked: false, value: '0', scrollTop: 0, clientHeight: 60, offsetTop: 0, offsetHeight: 30 });
      this.classList = { toggle: (name, on) => {
        const values = new Set(this.className.split(' ').filter(Boolean));
        if (on) values.add(name); else values.delete(name);
        this.className = [...values].join(' ');
      } };
    }
    set id(id) { this._id = id; nodes.set(id, this); }
    get id() { return this._id; }
    set innerHTML(value) { assert.equal(value, ''); this.children = []; }
    setAttribute(key, value) { this.attributes[key] = value; }
    appendChild(child) { child.offsetTop = this.children.length * 30; this.children.push(child); }
    addEventListener(name, handler) { this.events[name] = handler; }
    querySelector(query) { const id = query.match(/data-panel-id="(-?\d+)"/)[1]; return this.children.find(c => String(c.dataset.panelId) === id); }
    scrollIntoView(options) { this.scrolled = options; }
    focus() { document.activeElement = this; }
  }
  const $ = id => {
    if (!nodes.has(id)) { const node = new Element(); node.id = id; }
    return nodes.get(id);
  };
  $('mirrorWrap').checked = /<input\b[^>]*id="mirrorWrap"[^>]*\bchecked/.test(html);
  $('mirrorOn').checked = true;
  $('baseSel').value = 'white';
  $('upSel').value = 'auto';
  $('modeSel').value = 'arap';
  $('padRange').value = '8';
  $('splitMirror').checked = true;
  const mesh = PC.makeMesh([
    -2, -0.5, -1, -2, 0.5, -1, -2, 0.5, 1, -2, -0.5, 1,
     2, -0.5, -1,  2, 0.5, -1,  2, 0.5, 1,  2, -0.5, 1
  ], [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7]);
  mesh.panel = [17, 17, 42, 42];
  const S = { mesh, panels: [], selected: -1, busy: false, radius: 2.5, mode: 'wrap',
    excludedPanels: new Set(), unwrap: null, suggestions: [], vec: { paths: [] }, colourFor: new Map(), tweaks: new Map(), colourSeed: 0,
    plane: { axis: 0, offset: 0, extent: [4, 1, 2], diag: Math.sqrt(21), up: [0, 1, 0], forward: [0, 0, 1] } };
  const camera = new THREE.PerspectiveCamera(42, 1.6, 0.02, 120);
  camera.position.set(3.2, 2, 4.2);
  const controls = { target: new THREE.Vector3(), enableDamping: true,
    update() { camera.lookAt(this.target); camera.updateMatrixWorld(); } };
  const ctx = vm.createContext({ PC, THREE, document, S, $, camera, controls, scene: new THREE.Scene(),
    meshObj: new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial()), fmt: String });
  for (const name of ['updateButtons', 'updateMirrorStats', 'buildWire', 'buildSeamLines', 'updateHud', 'renderSuggestions',
    'busy', 'paintAtlas', 'reportUnwrap', 'applyAtlasToggle', 'refreshVecUI', 'buildVecOverlay']) ctx[name] = () => {};
  ctx.nextFrame = async () => {};
  ctx.toast = text => { ctx.message = text; };
  ctx.setAtlasEmpty = () => { ctx.atlasCleared = (ctx.atlasCleared || 0) + 1; };
  ctx.drawAtlasUI = () => { ctx.atlasDraws = (ctx.atlasDraws || 0) + 1; };
  vm.runInContext(html.slice(html.indexOf('  var panelFocusObj ='), html.indexOf('  var bottomMat =')), ctx);
  for (const name of ['recomputePanels', 'recomputePairs', 'mirrorEnabled', 'activePlane', 'planeOffset', 'upVector', 'forwardVector', 'runUnwrap',
    'rebuildColours', 'seedColour', 'hsl2hex', 'hexStr', 'colourOf', 'vertexNormals', 'syncAll',
    'panelOutline', 'updatePanelHighlight', 'setLines', 'selectedWrapTwin', 'refreshPanelList',
    'focusPanelInList', 'framePanel', 'selectPanel', 'setPanelWrap', 'setAllPanelsWrap', 'wrapSelectionChanged']) {
    vm.runInContext(appFunction(name), ctx);
  }
  ctx.recomputePanels();
  ctx.syncAll();
  const row = id => $('panelList').children.find(c => c.dataset.panelId === id);
  return { ctx, S, $, row, camera, controls, document };
}

test('v13 inline scripts parse', () => {
  for (const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(script[1]);
});

test('mirror wrap selection defaults on and selecting either side updates both once', () => {
  for (const id of [17, 42]) {
    const { ctx, S, $ } = harness();
    assert.equal($('mirrorWrap').checked, true);
    ctx.setAllPanelsWrap(false);
    const before = ctx.atlasCleared;
    ctx.setPanelWrap(id, true);
    assert.equal(S.excludedPanels.size, 0);
    assert.equal(S.selected, id);
    assert.equal(ctx.atlasCleared, before + 1);
    assert.equal(ctx.selectedWrapTwin(), id === 17 ? 42 : 17);
    ctx.setPanelWrap(id, false);
    assert.deepEqual([...S.excludedPanels].sort(), [17, 42]);
    assert.equal(ctx.panelMirrorEdge.visible, false);
  }
});

test('disabling mirror wrap affects only the clicked panel and removes the mirror indication', () => {
  const { ctx, S, $ } = harness();
  $('mirrorWrap').checked = false;
  ctx.setPanelWrap(17, false);
  assert.deepEqual([...S.excludedPanels], [17]);
  ctx.setPanelWrap(17, true);
  assert.equal(S.excludedPanels.size, 0);
  assert.equal(ctx.panelMirrorEdge.visible, false);
  assert.equal(ctx.selectedWrapTwin(), -1);
});

test('wrap mirroring works with seam mirroring disabled', () => {
  const { ctx, S, $ } = harness();
  $('mirrorOn').checked = false;
  ctx.recomputePairs();
  assert.equal(S.pairs, null);
  assert.equal(S.panels[0].twin, 42);
  ctx.setPanelWrap(17, false);
  assert.deepEqual([...S.excludedPanels].sort(), [17, 42]);
});

test('model selection highlights and reveals the list row without moving the camera', () => {
  const { ctx, S, row, camera, controls } = harness();
  const position = camera.position.clone(), target = controls.target.clone();
  ctx.setPanelWrap(42, true);
  assert.equal(S.selected, 42);
  assert.match(row(42).className, /\bon\b/);
  assert.equal(row(42).attributes['aria-current'], 'true');
  assert.equal(row(42).scrolled.block, 'nearest');
  assert.match(row(17).className, /mirror-on/);
  assert.deepEqual(camera.position, position);
  assert.deepEqual(controls.target, target);
  assert.equal(ctx.panelFocusObj.visible, true);
  assert.equal(ctx.panelFocusObj.geometry.attributes.position.count, 6);
});

test('list selection frames only the primary panel and fits its vertices on landscape and portrait views', () => {
  for (const aspect of [1.6, 0.55]) for (const id of [17, 42]) {
    const { ctx, row, camera, controls } = harness();
    camera.aspect = aspect;
    ctx.setAllPanelsWrap(false);
    row(id).events.click();
    const x = id === 17 ? -2 : 2;
    assert.equal(controls.target.x, x, 'Frame must not use the pair centre at zero');
    assert.equal(controls.target.y, 0);
    assert.equal(controls.target.z, 0);
    assert.ok(x * camera.position.x > 4, 'Camera faces the outside of the selected panel');
    assert.equal(controls.enableDamping, true);
    assert.equal(ctx.panelMirrorEdge.visible, true);
    for (const y of [-0.5, 0.5]) for (const z of [-1, 1]) {
      const projected = new THREE.Vector3(x, y, z).project(camera);
      assert.ok(Math.abs(projected.x) < 0.95 && Math.abs(projected.y) < 0.95);
      assert.ok(projected.z > -1 && projected.z < 1);
    }
  }
});

test('mirror outline uses only boundary edges and remains visible through the model', () => {
  const { ctx } = harness();
  ctx.selectPanel(17);
  const line = ctx.panelMirrorEdge;
  assert.equal(line.visible, true);
  assert.equal(line.material.isLineDashedMaterial, true);
  assert.equal(line.material.depthTest, false);
  assert.equal(line.material.depthWrite, false);
  assert.equal(line.geometry.attributes.position.count, 8, 'Four perimeter edges, no triangulation diagonal');
  const positions = line.geometry.attributes.position.array;
  for (let i = 0; i < positions.length; i += 3) assert.equal(positions[i], 2);
  assert.ok(line.geometry.attributes.lineDistance.array.some(n => n > 0));
  assert.ok(line.material.gapSize > line.material.dashSize);
});

test('checkbox changes frame the primary panel and preserve keyboard focus', () => {
  const { ctx, row, controls, document, $ } = harness();
  const checkbox = row(42).children[0];
  checkbox.focus(); checkbox.checked = false; checkbox.events.change();
  assert.equal(controls.target.x, 2);
  assert.equal(document.activeElement, $('wrapPanel_42'));
  assert.equal(ctx.panelFocusObj.visible, true);
});

test('inspection from the list frames without changing wrap membership outside Wrap mode', () => {
  const { S, row, controls } = harness();
  S.mode = 'pick';
  row(17).events.click();
  assert.equal(S.selected, 17);
  assert.equal(S.excludedPanels.size, 0);
  assert.equal(controls.target.x, -2);
  row(17).events.click();
  assert.equal(S.selected, 17, 'Clicking again retains the highlighted panel');
});

test('reselecting an included panel repairs asymmetric twins but otherwise preserves the atlas', () => {
  const { ctx, S } = harness();
  S.unwrap = { uv: new Float64Array(S.mesh.tris.length * 2) };
  ctx.setPanelWrap(17, true);
  assert.ok(S.unwrap);
  assert.equal(ctx.atlasDraws, 1);
  S.excludedPanels.add(42);
  ctx.setPanelWrap(17, true);
  assert.equal(S.excludedPanels.size, 0);
  assert.equal(S.unwrap, null);
});

test('busy work cannot change membership, focus or camera', () => {
  const { ctx, S, controls } = harness();
  S.busy = true;
  ctx.setPanelWrap(17, false, true);
  ctx.selectPanel(42, true);
  assert.equal(S.selected, -1);
  assert.equal(S.excludedPanels.size, 0);
  assert.equal(controls.target.x, 0);
});

test('unpaired panels can be selected without a phantom mirror outline', () => {
  const { ctx, S } = harness();
  S.plane = null;
  ctx.recomputePairs();
  ctx.setPanelWrap(17, false);
  assert.deepEqual([...S.excludedPanels], [17]);
  assert.equal(ctx.panelMirrorEdge.visible, false);
});

for (const id of [17, 42]) for (const separate of [false, true]) {
  test(`unwrap still packs only panel ${id} when mirror selection is off, separate islands=${separate}`, async () => {
    const { ctx, S, $ } = harness();
    ctx.setAllPanelsWrap(false);
    $('mirrorWrap').checked = false;
    $('splitMirror').checked = separate;
    ctx.setPanelWrap(id, true);
    await ctx.runUnwrap();
    assert.ok(S.unwrap, ctx.message);
    assert.deepEqual(Array.from(S.unwrap.islands, p => p.panel), [id]);
    assert.ok(S.unwrap.islands[0].box.w > 0);
    assert.equal(S.selected, id);
    assert.equal(ctx.panelMirrorEdge.visible, false);
  });
}

test('default paired selection unwraps both sides and keeps the clicked side focused', async () => {
  const { ctx, S } = harness();
  ctx.setAllPanelsWrap(false);
  ctx.setPanelWrap(42, true);
  await ctx.runUnwrap();
  assert.ok(S.unwrap, ctx.message);
  assert.deepEqual(Array.from(S.unwrap.islands, p => p.panel), [17, 42]);
  assert.equal(S.selected, 42);
  assert.equal(ctx.panelMirrorEdge.visible, true);
});
