'use strict';

// v14: vector artwork mirrored across the vehicle's mirror plane. Shapes
// drawn while the option is on carry their own mirror flag, so turning it
// off leaves them mirrored; Mirror all mirrors everything and turns it on.
// Nodes near the plane snap onto it, so a shape meets its mirrored copy there.
// And tools to select a shape and move, rotate or scale it over the surface.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', 'WrapaCar_v14.html'), 'utf8').replace(/\r\n/g, '\n');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);
const context = vm.createContext({});
vm.runInContext(scripts.find(source => source.includes('/* PanelCore')), context);
vm.runInContext(scripts.find(source => source.includes('/* VectorCore')), context);
const PC = context.PanelCore;
const VC = context.VectorCore;
const appScript = scripts.find(source => source.includes('window.PanelCore;'));

function appFunction(name) {
  const start = appScript.indexOf('  function ' + name + '(');
  assert.ok(start >= 0, 'App function exists: ' + name);
  return appScript.slice(start, appScript.indexOf('\n  }\n', start) + 4);
}

function near3(actual, expected, message, epsilon = 1e-9) {
  for (let k = 0; k < 3; k++) {
    assert.ok(Math.abs(actual[k] - expected[k]) <= epsilon, `${message}: expected ${expected}, received ${actual}`);
  }
}

// A 2×1×1 box, each side an n×n grid, symmetric across x = 0, cut along its
// creases into six panels and unwrapped.
function unwrappedBox(n = 8) {
  const pos = [], tris = [], size = [2, 1, 1];
  const sides = [[[-1, -1, 1], [2, 0, 0], [0, 2, 0]], [[1, -1, -1], [-2, 0, 0], [0, 2, 0]], [[1, -1, 1], [0, 0, -2], [0, 2, 0]],
    [[-1, -1, -1], [0, 0, 2], [0, 2, 0]], [[-1, 1, 1], [2, 0, 0], [0, 0, -2]], [[-1, -1, -1], [2, 0, 0], [0, 0, 2]]];
  for (const [o, u, v] of sides) {
    const base = pos.length / 3;
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
      for (let k = 0; k < 3; k++) pos.push((o[k] + u[k] * i / n + v[k] * j / n) * size[k] / 2);
    }
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const a = base + j * (n + 1) + i;
      tris.push(a, a + 1, a + n + 2, a, a + n + 2, a + n + 1);
    }
  }
  const welded = PC.weld(pos, tris, 1e-6);
  const mesh = PC.makeMesh(welded.pos, welded.tris);
  const edgeMap = PC.buildEdgeMap(mesh);
  PC.markCreases(mesh, edgeMap, 35);
  mesh.panel = Array.from(PC.computePanels(mesh, edgeMap).label);
  const unwrap = PC.unwrap(mesh, mesh.panel, { mode: 'arap', iterations: 20 });
  return { mesh, edgeMap, unwrap };
}

function harness() {
  const fixture = unwrappedBox();
  const elements = new Map();
  const $ = id => {
    if (!elements.has(id)) elements.set(id, { id, value: '0', checked: false, disabled: false, textContent: '', innerHTML: '' });
    return elements.get(id);
  };
  Object.assign($('realLen'), { value: '4500' });
  Object.assign($('pdfScale'), { value: '10' });
  Object.assign($('sizeSel'), { value: '1024' });
  $('pdfCut').checked = false;
  $('showAtlas').checked = true;
  $('upSel').value = 'auto';
  // the checkbox starts as the page ships it
  $('vecMirror').checked = /<input\b[^>]*id="vecMirror"[^>]*\bchecked/.test(html);
  $('vecSnap').checked = /<input\b[^>]*id="vecSnap"[^>]*\bchecked/.test(html);
  const S = { mesh: fixture.mesh, edgeMap: fixture.edgeMap, unwrap: fixture.unwrap, radius: 1.2,
    plane: { axis: 0, offset: 0, extent: [2, 1, 1], diag: Math.sqrt(6), up: [0, 1, 0], forward: [0, 0, 1] },
    vec: { paths: [], draft: null, history: [], serial: 0, selected: -1, fill: [0, 100, 100, 0], stroke: null, width: 5,
      derived: new Map(), cache: new Map(), regions: new Map(), model: null, twins: new WeakMap(),
      tool: 'pen', frames: new WeakMap(), normals: null, normalsTris: null, editing: null } };
  const app = vm.createContext({ $, S, PC, VC, Map, Set, WeakMap, Math, Array, JSON });
  app.toast = (text, warn) => { app.message = text; app.warned = !!warn; };
  app.commits = 0;
  app.commitArt = () => { app.commits++; };
  for (const name of ['refreshVecUI', 'scheduleVec', 'draftChanged', 'applyAtlasToggle', 'updateHud']) app[name] = () => {};
  app.pixelReach = () => 1e-3;
  for (const name of ['vecSync', 'vecModel', 'vecLocator', 'typicalEdge', 'mmPerUnit', 'mmPerAtlas', 'texBleed', 'printBleed',
    'derived', 'pdfLayout', 'squareSegs', 'triangleSegs', 'artMirrorOn', 'artPlane', 'planeOffset', 'reflectNode',
    'reflectHandle', 'twinOf', 'withTwins', 'artMirrorChanged', 'toggleArtMirror', 'mirrorAll', 'artPlaneChanged',
    'canClose', 'finishDraft', 'vecSnapshot', 'vecUndo', 'selectShape', 'selectedPath', 'shapeAt', 'shapeHit', 'refreshVecButtons',
    'canCloseDraft', 'tangentPart', 'dot3', 'cross3', 'unit3', 'smoothNormal', 'turnBetween', 'tangentAt', 'shapeFrame',
    'sideFrame', 'carryNodes', 'copyNode', 'vertexNormals', 'forwardVector', 'upVector', 'startTransform', 'dragTransform',
    'finishTransform', 'shapeName', 'fmtLen', 'insideOutline', 'planeSnapOn', 'onArtPlane', 'snapPick', 'squareToPlane',
    'mirrorTolerance']) vm.runInContext(appFunction(name), app);
  return { app, S, $, fixture };
}

// a filled square on the +x end of the box, nowhere near the plane
const endSquare = () => ({ id: 1, closed: true, fill: [0, 100, 100, 0], stroke: null, width: 5, nodes: [
  { p: [1, -0.2, -0.2], n: [1, 0, 0], hin: null, hout: null }, { p: [1, 0.2, -0.2], n: [1, 0, 0], hin: null, hout: null },
  { p: [1, 0.2, 0.2], n: [1, 0, 0], hin: null, hout: null }, { p: [1, -0.2, 0.2], n: [1, 0, 0], hin: null, hout: null }] });

test('the page mirrors new artwork by default, with Mirror all beside it and M as a shortcut', () => {
  assert.match(html, /<input type="checkbox" id="vecMirror" checked> Mirror new artwork/);
  assert.match(html, /<button class="btn sm" id="vecMirrorAll" type="button"[^>]*>Mirror all<\/button>/);
  assert.match(html, /\$\('vecMirror'\)\.addEventListener\('change', artMirrorChanged\)/);
  assert.match(html, /\$\('vecMirrorAll'\)\.addEventListener\('click', mirrorAll\)/);
  assert.match(appFunction('vecKey'), /k\.toLowerCase\(\) === 'm'[^\n]*toggleArtMirror\(\)/);
  assert.match(html, /vector art · v14/);
});

test('a mirrored path has a copy reflected onto the surface, handles and all, that follows the path and the plane', () => {
  const { app, S, $ } = harness();
  const p = { id: 1, closed: false, fill: null, stroke: [0, 0, 0, 100], width: 5, mirror: true, nodes: [
    { p: [0.3, 0.5, -0.1], n: [0, 1, 0], hin: null, hout: [0.1, 0, 0.05], smooth: true },
    { p: [0.6, 0.5, 0.2], n: [0, 1, 0], hin: [-0.1, 0, -0.05], hout: null, smooth: true }] };
  const twin = app.twinOf(p);
  assert.ok(twin.twin && twin.source === p);
  near3(twin.nodes[0].p, [-0.3, 0.5, -0.1], 'Node reflected across x = 0');
  near3(twin.nodes[1].p, [-0.6, 0.5, 0.2], 'Second node');
  near3(twin.nodes[0].n, [0, 1, 0], 'Normal of the top face');
  near3(twin.nodes[0].hout, [-0.1, 0, 0.05], 'Handle reflected');
  near3(twin.nodes[1].hin, [0.1, 0, -0.05], 'Other handle reflected');
  assert.equal(twin.nodes[0].hin, null, 'No handle stays none');
  assert.deepEqual(Array.from(twin.stroke), [0, 0, 0, 100], 'Same ink');
  assert.equal(app.twinOf(p), twin, 'One copy object per path, so its layout is kept');
  const firstNodes = twin.nodes;
  assert.equal(app.twinOf(p).nodes, firstNodes, 'Not worked out again while nothing changes');

  // reflecting the copy gives the path back
  const back = app.reflectNode(twin.nodes[0], app.artPlane());
  near3(back.p, p.nodes[0].p, 'Round trip');
  near3(back.hout, p.nodes[0].hout, 'Handle round trip');

  p.nodes[0].p = [0.4, 0.5, -0.1];
  near3(app.twinOf(p).nodes[0].p, [-0.4, 0.5, -0.1], 'A moved node moves its copy');

  // the Mirror section's offset slider moves the plane 10% of the length: to x = 0.2
  $('mirrorRange').value = '100';
  near3(app.twinOf(p).nodes[0].p, [0, 0.5, -0.1], 'The copy follows the plane');

  p.mirror = false;
  assert.equal(app.twinOf(p), null, 'An unmirrored path has no copy');
  S.plane = null;
  p.mirror = true;
  assert.equal(app.twinOf(p), null, 'Nor does any path without a plane');
});

test('mirrored copies are painted and printed on the far side; unmirrored shapes are not', () => {
  const { app, S, fixture } = harness();
  const shape = endSquare();
  S.vec.paths.push(shape);
  assert.equal(app.withTwins(S.vec.paths).length, 1);
  assert.equal(app.pdfLayout().groups.length, 1, 'Only the +x end is printed');

  shape.mirror = true;
  const all = app.withTwins(S.vec.paths);
  assert.equal(all.length, 2);
  assert.equal(all[0], shape);
  assert.equal(all[1].source, shape, 'The copy follows its shape, keeping the drawing order');
  const layout = app.pdfLayout();
  assert.equal(layout.groups.length, 2, 'Both ends are printed');
  for (const group of layout.groups) assert.deepEqual(Array.from(group.shapes[0].fill), [0, 100, 100, 0]);

  const ends = new Set(app.derived(all[1]).islands.map(it => it.panel));
  const minusX = fixture.mesh.panel[PC.faceLocator(fixture.mesh).closest([-1, 0.05, 0.05]).tri];
  assert.ok(ends.has(minusX), 'The copy is laid into the -x end panel');
});

test('a tap on the mirrored copy picks the shape it copies', () => {
  const { app, S, fixture } = harness();
  const shape = endSquare();
  shape.mirror = true;
  S.vec.paths.push(shape);
  const hit = PC.faceLocator(fixture.mesh).closest([-1, 0.06, 0.03]);
  assert.equal(app.shapeAt({ tri: hit.tri, p: hit.p }, { pointerType: 'mouse' }), shape);
  shape.mirror = false;
  assert.equal(app.shapeAt({ tri: hit.tri, p: hit.p }, { pointerType: 'mouse' }), null, 'Nothing there without the copy');
});

test('turning mirroring off keeps what is mirrored; only new shapes stay on one side', () => {
  const { app, S, $ } = harness();
  assert.equal($('vecMirror').checked, true, 'On by default');
  const draw = () => {
    S.vec.draft = { nodes: endSquare().nodes.map(nd => Object.assign({}, nd)) };
    app.finishDraft(true);
    return S.vec.paths[S.vec.paths.length - 1];
  };
  const first = draw();
  assert.equal(first.mirror, true);
  assert.match(app.message, /^Shape closed and mirrored — on 2 panels/);

  app.toggleArtMirror();
  assert.equal($('vecMirror').checked, false);
  assert.match(app.message, /Mirroring off/);
  assert.equal(first.mirror, true, 'The shape drawn before stays mirrored');
  const second = draw();
  assert.equal(second.mirror, false, 'A shape drawn with mirroring off is not');
  assert.match(app.message, /^Shape closed — on 1 panel\./);

  $('vecMirror').checked = true;
  app.artMirrorChanged();
  const third = draw();
  assert.equal(third.mirror, true, 'Turned back on, new shapes are mirrored again');
  assert.equal(second.mirror, false, 'And the one-sided shape stays as it was');
});

test('Mirror all mirrors everything, turns mirroring on, and Undo takes it back', () => {
  const { app, S, $ } = harness();
  $('vecMirror').checked = false;
  const a = Object.assign(endSquare(), { id: 1, mirror: false });
  const b = Object.assign(endSquare(), { id: 2, mirror: true });
  const c = Object.assign(endSquare(), { id: 3, mirror: false });
  S.vec.paths.push(a, b, c);

  app.refreshVecButtons();
  assert.equal($('vecMirrorAll').disabled, false);
  app.mirrorAll();
  assert.ok(S.vec.paths.every(p => p.mirror), 'Every shape mirrored');
  assert.equal($('vecMirror').checked, true, 'New artwork is mirrored too');
  assert.match(app.message, /Mirrored 2 shapes/);
  assert.equal(S.vec.history.length, 1, 'One undo step');
  app.refreshVecButtons();
  assert.equal($('vecMirrorAll').disabled, true, 'Nothing left to mirror');

  $('vecMirror').checked = false;
  app.refreshVecButtons();
  assert.equal($('vecMirrorAll').disabled, false, 'Still useful to turn mirroring back on');
  app.mirrorAll();
  assert.equal($('vecMirror').checked, true);
  assert.equal(S.vec.history.length, 1, 'Nothing changed in the artwork, so no undo step');
  assert.match(app.message, /All the artwork is mirrored/);

  app.vecUndo();
  assert.deepEqual(S.vec.paths.map(p => p.mirror), [false, true, false], 'Undo brings back the one-sided shapes');
});

test('moving the mirror plane repaints mirrored artwork, and leaves one-sided artwork alone', () => {
  const { app, S } = harness();
  S.vec.paths.push(Object.assign(endSquare(), { mirror: false }));
  app.artPlaneChanged();
  assert.equal(app.commits, 0);
  S.vec.paths[0].mirror = true;
  app.artPlaneChanged();
  assert.equal(app.commits, 1);
});

/* ------------------------------------------------ move, rotate, scale */

// a 0.4 square on the flat top of the box, centred at (0.5, 0.5, 0), with
// one handle; its frame has t1 along +z and t2 = n × t1 along +x. The top's
// faces are 0.25 along x, so no whole face lies inside the square.
const topSquare = () => ({ id: 1, closed: true, fill: [0, 100, 100, 0], stroke: null, width: 5, nodes: [
  { p: [0.3, 0.5, -0.2], n: [0, 1, 0], hin: null, hout: [0.1, 0, 0], smooth: false },
  { p: [0.7, 0.5, -0.2], n: [0, 1, 0], hin: null, hout: null, smooth: false },
  { p: [0.7, 0.5, 0.2], n: [0, 1, 0], hin: null, hout: null, smooth: false },
  { p: [0.3, 0.5, 0.2], n: [0, 1, 0], hin: null, hout: null, smooth: false }] });

function toolHarness(tool) {
  const h = harness();
  h.S.vec.tool = tool;
  h.app.toScreen = () => ({ x: 100, y: 100 });
  h.app.camera = { position: { x: 0.5, y: 10, z: 0 } };   // looking down on the top
  h.app.vecPick = e => e.hit;
  return h;
}
const tapAt = (app, mesh, p) => {
  const hit = PC.faceLocator(mesh).closest(p);
  return app.shapeHit({ tri: hit.tri, p: hit.p }, { pointerType: 'mouse' });
};

test('the toolbar offers Pen, Select, Move, Rotate and Scale, with P, V, G, R and S', () => {
  for (const [tool, key] of [['pen', 'P'], ['select', 'V'], ['move', 'G'], ['rotate', 'R'], ['scale', 'S']]) {
    assert.match(html, new RegExp('<button type="button" data-tool="' + tool + '"[^>]*>\\w+ <kbd>' + key + '</kbd></button>'));
  }
  assert.match(html, /var VEC_TOOL_KEYS = \{ p: 'pen', v: 'select', g: 'move', r: 'rotate', s: 'scale' \};/);
  assert.match(appFunction('setMode'), /\$\('vecTools'\)\.hidden = mode !== 'vector';/);
  assert.match(appFunction('vecDown'), /if \(V\.tool !== 'pen'\) \{ toolDown\(e\); return; \}/);
});

test('a tap anywhere inside a filled shape finds it, even inside faces its outline crosses', () => {
  const { app, S } = harness();
  const shape = Object.assign(topSquare(), { mirror: true });
  S.vec.paths.push(shape);
  assert.equal(app.derived(shape).inside.size, 0, 'No whole face inside the square');
  assert.equal(tapAt(app, S.mesh, [0.5, 0.5, 0.05]).path, shape, 'Its middle');
  assert.equal(tapAt(app, S.mesh, [0.32, 0.5, -0.18]).path, shape, 'Just inside a corner');
  assert.equal(tapAt(app, S.mesh, [0.26, 0.5, 0.05]), null, 'Just outside, in a face the outline crosses');
  const copy = tapAt(app, S.mesh, [-0.5, 0.5, 0.05]);
  assert.equal(copy.path, shape);
  assert.equal(copy.twin, true, 'A tap on the copy says so');
  assert.equal(tapAt(app, S.mesh, [0.5, 0.5, 0.05]).twin, false);
});

test("a shape's frame sits at the middle of its extent, facing out of the surface", () => {
  const { app } = harness();
  const fr = app.shapeFrame(topSquare());
  near3(fr.c, [0.5, 0.5, 0], 'Centre');
  near3(fr.n, [0, 1, 0], 'Facing up');
  near3(fr.t1, [0, 0, 1], 'Heading along the model forward axis');
  near3(fr.t2, [1, 0, 0], 't2 = n × t1');
  assert.ok(Math.abs(fr.size - 0.4) < 1e-6, 'Size across');
  const same = app.carryNodes(topSquare().nodes, fr, fr, 0, 1);
  same.forEach((nd, i) => near3(nd.p, topSquare().nodes[i].p, 'Left alone, a node stays put'));
  near3(same[0].hout, [0.1, 0, 0], 'And so does its handle');
});

test('rotate turns a shape about its centre, the way the pointer goes round on screen', () => {
  const { app, S } = toolHarness('rotate');
  const shape = topSquare();
  S.vec.paths.push(shape);
  const g = app.startTransform({ clientX: 200, clientY: 100 }, shape, null, { path: shape, twin: false });
  assert.equal(g.facing, 1);
  // a quarter turn anticlockwise on screen: the pointer from right of the centre to above it
  app.dragTransform({ clientX: 100, clientY: 0 }, g);
  assert.equal(g.readout, '90°');
  near3(shape.nodes[0].p, [0.3, 0.5, 0.2], 'Corner turned a quarter about +y');
  near3(shape.nodes[2].p, [0.7, 0.5, -0.2], 'Opposite corner');
  near3(shape.nodes[0].hout, [0, 0, -0.1], 'Handle turned with it');
  app.dragTransform({ clientX: 194, clientY: 66, shiftKey: true }, g);
  assert.equal(g.readout, '15°', 'Shift snaps to 15°');

  // right round: the turn keeps counting past half a circle
  const h = toolHarness('rotate'), again = topSquare();
  const g2 = h.app.startTransform({ clientX: 200, clientY: 100 }, again, null, { path: again, twin: false });
  for (const [x, y] of [[100, 0], [0, 100], [100, 200], [200, 100]]) h.app.dragTransform({ clientX: x, clientY: y }, g2);
  assert.equal(g2.readout, '360°');
  again.nodes.forEach((nd, i) => near3(nd.p, topSquare().nodes[i].p, 'A full turn comes back', 1e-9));
});

test('scale grows and shrinks a shape about its centre, handles and all', () => {
  const { app, S } = toolHarness('scale');
  const shape = topSquare();
  S.vec.paths.push(shape);
  const g = app.startTransform({ clientX: 200, clientY: 100 }, shape, null, { path: shape, twin: false });
  app.dragTransform({ clientX: 300, clientY: 100 }, g);
  assert.equal(g.readout, '200%, 1.20 m across');
  near3(shape.nodes[0].p, [0.1, 0.5, -0.4], 'Corner twice as far out');
  near3(shape.nodes[0].hout, [0.2, 0, 0], 'Handle twice as long');
  app.dragTransform({ clientX: 150, clientY: 100 }, g);
  assert.equal(g.readout, '50%, 300 mm across');
  near3(shape.nodes[2].p, [0.6, 0.5, 0.1], 'Half size');
  app.dragTransform({ clientX: 262, clientY: 100, shiftKey: true }, g);
  assert.equal(g.readout, '160%, 960 mm across', 'Shift snaps to 5%');
});

test('move carries a shape over the surface, turning it onto a new face without distorting it', () => {
  const { app, S } = toolHarness('move');
  const shape = topSquare();
  S.vec.paths.push(shape);
  const press = { p: [0.5, 0.5, 0], n: [0, 1, 0] };
  const g = app.startTransform({ hit: press }, shape, press, { path: shape, twin: false });
  app.dragTransform({ hit: { p: [0.2, 0.5, 0.1], n: [0, 1, 0] } }, g);
  near3(shape.nodes[0].p, [0, 0.5, -0.1], 'Slid along the top');
  near3(shape.nodes[0].hout, [0.1, 0, 0], 'Handle unchanged');
  assert.equal(g.readout, Math.round(Math.hypot(0.3, 0.1) * 1500) + ' mm');

  // over the edge onto the +z side: the square stands up on it, still 0.4 across
  app.dragTransform({ hit: { p: [0.5, 0, 0.5], n: [0, 0, 1] } }, g);
  near3(shape.nodes[0].p, [0.3, 0.2, 0.5], 'Corner on the side');
  near3(shape.nodes[2].p, [0.7, -0.2, 0.5], 'Opposite corner on the side');
  shape.nodes.forEach(nd => near3(nd.n, [0, 0, 1], 'Facing out of the side'));
  near3(shape.nodes[0].hout, [0.1, 0, 0], 'Handle still runs along the box');
});

test("dragging a mirrored shape's copy moves the shape the mirror way, so the copy follows the pointer", () => {
  const { app, S } = toolHarness('move');
  const shape = Object.assign(topSquare(), { mirror: true });
  S.vec.paths.push(shape);
  const press = { p: [-0.5, 0.5, 0], n: [0, 1, 0] };
  const g = app.startTransform({ hit: press }, shape, press, { path: shape, twin: true });
  app.dragTransform({ hit: { p: [-0.3, 0.5, 0.1], n: [0, 1, 0] } }, g);
  near3(shape.nodes[0].p, [0.1, 0.5, -0.1], 'The shape moved the other way along x');
  near3(app.twinOf(shape).nodes[0].p, [-0.1, 0.5, -0.1], 'Its copy went where the pointer went');

  // turned from the copy: the copy turns as the pointer does, the shape the other way
  const r = toolHarness('rotate'), turned = Object.assign(topSquare(), { mirror: true });
  r.S.vec.paths.push(turned);
  const gr = r.app.startTransform({ clientX: 200, clientY: 100 }, turned, null, { path: turned, twin: true });
  r.app.dragTransform({ clientX: 100, clientY: 0 }, gr);
  near3(turned.nodes[0].p, [0.7, 0.5, -0.2], 'The shape turned a quarter clockwise');
  near3(r.app.twinOf(turned).nodes[0].p, [-0.7, 0.5, -0.2], 'Its copy a quarter anticlockwise, with the pointer');
});

test('letting go keeps the transform with one undo step; a tap off every shape lets the selection go', () => {
  const { app, S } = toolHarness('move');
  const shape = topSquare();
  S.vec.paths.push(shape);
  S.vec.selected = shape.id;
  const press = { p: [0.5, 0.5, 0], n: [0, 1, 0] };
  let g = app.startTransform({ hit: press }, shape, press, null);
  app.finishTransform(g);
  assert.equal(S.vec.selected, -1, 'A tap on bare surface');

  S.vec.selected = shape.id;
  g = app.startTransform({ hit: press }, shape, press, { path: shape, twin: false });
  app.finishTransform(g);
  assert.equal(S.vec.selected, shape.id, 'A tap on the shape keeps it');

  app.vecSnapshot(); S.vec.editing = shape; g.dragged = true;
  app.dragTransform({ hit: { p: [0.2, 0.5, 0], n: [0, 1, 0] } }, g);
  app.finishTransform(g);
  assert.equal(S.vec.editing, null);
  assert.equal(app.commits, 1);
  assert.match(app.message, /^Shape 1 moved 450 mm — Undo puts it back$/);
  app.vecUndo();
  near3(S.vec.paths[0].nodes[0].p, [0.3, 0.5, -0.2], 'Undo puts it back');
});

/* ---------------------------------------- snapping to the mirror plane */

const node = (p, extra = {}) => Object.assign({ p, n: [0, 1, 0], hin: null, hout: null, smooth: false }, extra);
const rounded = path => Array.from(path.nodes, nd => Array.from(nd.p, v => Math.round(v * 1e9) / 1e9 + 0));
function drawOnTop(app, S, nodes, closed = false) {
  S.vec.draft = { nodes };
  app.finishDraft(closed);
  return S.vec.paths[S.vec.paths.length - 1];
}

test('the pen snaps onto the mirror plane within a few pixels, where the faces cross it', () => {
  const { app, $ } = harness();
  assert.equal($('vecSnap').checked, true, 'On by default');
  app.toScreen = p => ({ x: p[0] * 1000, y: 0 });
  app.vecPick = () => ({ tri: 0, p: [0.004, 0.5, 0.1], n: [0, 1, 0] });
  app.pixelReach = () => 0.01;
  const hit = app.snapPick({ clientX: 4, clientY: 0, pointerType: 'mouse' });
  assert.equal(hit.snapped, true);
  near3(hit.p, [0, 0.5, 0.1], 'On the plane and the surface');
  near3(hit.n, [0, 1, 0], 'Facing out');
  app.pixelReach = () => 0.001;
  assert.equal(app.snapPick({ clientX: 4, clientY: 0 }).snapped, undefined, 'Too far to snap');
  app.pixelReach = () => 0.01;
  $('vecSnap').checked = false;
  assert.equal(app.snapPick({ clientX: 4, clientY: 0 }).snapped, undefined, 'Snapping off');
  $('vecSnap').checked = true; $('vecMirror').checked = false;
  assert.equal(app.snapPick({ clientX: 4, clientY: 0 }).snapped, undefined, 'Nor without mirroring');
});

test('a curve dragged out of a node on the plane crosses it square, so the halves join smoothly', () => {
  const { app } = harness();
  near3(app.squareToPlane([0.1, 0, 0.05], node([0, 0.5, 0])), [0.1, 0, 0], 'Across the plane only');
  near3(app.squareToPlane([0.1, 0, 0.05], node([0.3, 0.5, 0])), [0.1, 0, 0.05], 'Off the plane, as dragged');
});

test('half a shape from plane to plane stays one half with its mirrored copy, meeting it on the plane', () => {
  const { app, S } = harness();
  const shape = drawOnTop(app, S, [node([0, 0.5, -0.2], { hout: [0.1, 0, 0] }), node([0.3, 0.5, -0.2]), node([0.3, 0.5, 0.2]),
    node([0, 0.5, 0.2], { hin: [0.1, 0, 0] })], true);
  assert.match(app.message, /^Shape closed and mirrored — on 1 panel\./);
  assert.equal(shape.mirror, true);
  assert.equal(shape.welded, undefined, 'Not welded into one piece');
  assert.deepEqual(rounded(shape), [[0, 0.5, -0.2], [0.3, 0.5, -0.2], [0.3, 0.5, 0.2], [0, 0.5, 0.2]], 'Only the half drawn');
  const copy = app.twinOf(shape);
  near3(copy.nodes[0].p, shape.nodes[0].p, 'The copy meets the shape on the plane');
  near3(copy.nodes[3].p, shape.nodes[3].p, 'At both ends');
  near3(copy.nodes[0].hout, [-0.1, 0, 0], 'Its handle square across the other way');

  // it turns about its own centre, not the plane
  near3(app.shapeFrame(shape).c, [0.15, 0.5, 0], 'The half has its own centre');

  // and an edit to it shows in the copy
  shape.nodes[1].p = [0.4, 0.5, -0.2];
  near3(app.twinOf(shape).nodes[1].p, [-0.4, 0.5, -0.2], 'Edits still mirror');
  assert.equal(S.vec.paths.length, 1);
});
