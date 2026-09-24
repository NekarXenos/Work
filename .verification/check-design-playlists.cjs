'use strict';

// Exercise the actual inline production functions without a renderer or DOM.
// Run: node .verification/check-design-playlists.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'Xeno_Plaza.html'), 'utf8');
const playlistStart = html.indexOf('const PLAYLISTS = [];');
const playlistEnd = html.indexOf('function codeCanvas(', playlistStart);
assert(playlistStart >= 0 && playlistEnd > playlistStart, 'Production playlist block exists');
const designStart = html.indexOf('function buildDesign(items) {');
const designEnd = html.indexOf('scene.add(new THREE.HemisphereLight', designStart);
assert(designStart >= 0 && designEnd > designStart, 'Production Design Studio block exists');
const production = [
  html.match(/^const clamp = .*;$/m)[0],
  html.match(/^const lerp = .*;$/m)[0],
  html.slice(playlistStart, playlistEnd),
  html.slice(designStart, designEnd),
  'globalThis.subject = { PLAYLISTS, SCREEN_REDUCED_MOTION, DESIGN_MOTION_CAPABLE, screenFitProgress, makeScreen, updatePlaylists, buildDesign };'
].join('\n');

class Vector {
  constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); }
  set(x, y, z) { Object.assign(this, { x, y, z }); return this; }
  copy(v) { return this.set(v.x, v.y, v.z); }
}
class Group {
  constructor() { this.children = []; this.position = new Vector(); this.rotation = new Vector(); }
  add(child) { this.children.push(child); }
}
class UV {
  constructor(values = [0, 1, 1, 1, 0, 0, 1, 0]) { this.array = [...values]; this.count = 4; this.needsUpdate = false; }
  setUsage(usage) { this.usage = usage; return this; }
  setXY(index, x, y) { this.array[index * 2] = x; this.array[index * 2 + 1] = y; return this; }
}
class Geometry {
  constructor(values) { this.attributes = { uv: new UV(values) }; }
  clone() { return new Geometry(this.attributes.uv.array); }
}
class Material { constructor(options = {}) { Object.assign(this, options); } }
class Light extends Group { constructor(...args) { super(); this.args = args; } }

function boot(options = {}) {
  const { lowGPU = false, reduced = false } = options;
  const cpu = Object.hasOwn(options, 'cpu') ? options.cpu : 8;
  const ram = Object.hasOwn(options, 'ram') ? options.ram : 8;
  const sharedPlane = new Geometry();
  const preference = { matches: reduced };
  const noOp = () => {};
  function plate(w, h, material, x, y, z, rx = 0, ry = 0, parent) {
    const mesh = { geometry: sharedPlane, material, scale: new Vector(w, h, 1), position: new Vector(x, y, z), rotation: new Vector(rx, ry, 0), userData: {} };
    if (parent) parent.add(mesh);
    return mesh;
  }
  const context = vm.createContext({
    navigator: { hardwareConcurrency: cpu, deviceMemory: ram },
    window: { matchMedia: () => preference },
    LOW_GPU: lowGPU, HIGH: !lowGPU,
    THREE: { Group, MeshBasicMaterial: Material, MeshStandardMaterial: Material, PointLight: Light, DoubleSide: 2, DynamicDrawUsage: 'dynamic', AdditiveBlending: 'additive' },
    MAT: { aluDark: {}, black: {}, alu: {}, whiteSoft: {}, dark: {} },
    world: new Group(), RH: 4, PICKABLE: [],
    plate,
    box: (w, h, d, material, x, y, z, parent) => plate(w, h, material, x, y, z, 0, 0, parent),
    cyl: (r1, r2, h, material, x, y, z, parent) => plate(r1, h, material, x, y, z, 0, 0, parent),
    addInteract: noOp, openArt: noOp, roomCeiling: noOp, signPlane: noOp,
    obstruct: noOp, contact: noOp, planter: noOp, openEmail: noOp
  });
  vm.runInContext(production, context, { filename: 'Xeno_Plaza.playlists.production.js' });
  return { ...context.subject, sharedPlane, preference, world: context.world };
}

const originalUVs = [0, 1, 1, 1, 0, 0, 1, 0];
const near = (actual, expected, label, epsilon = 1e-9) => assert(Math.abs(actual - expected) <= epsilon, `${label}: ${actual} != ${expected}`);
const makeItems = (aspects = [3, 0.4, 1]) => aspects.map((aspect, i) => ({ aspect, title: `Image ${i}`, tex: Object.freeze({ id: i, repeat: Object.freeze({ x: 1, y: 1 }), offset: Object.freeze({ x: 0, y: 0 }) }) }));
const createScreen = (harness, options = {}) => harness.makeScreen(4, 2.4, 0, 0, 0, 0, new Group(), { background: 0xffffff, reframe: true, list: makeItems(), hold: 6, ...options });

function checkImageGeometry(screen, mesh, aspect) {
  assert(mesh.scale.x > 0 && mesh.scale.x <= screen.w + 1e-9, 'Image width stays inside border');
  assert(mesh.scale.y > 0 && mesh.scale.y <= screen.h + 1e-9, 'Image height stays inside border');
  const uv = mesh.geometry.attributes.uv.array;
  uv.forEach(value => assert(Number.isFinite(value) && value >= -1e-9 && value <= 1 + 1e-9, 'UV stays within image'));
  const fractionU = uv[2] - uv[0], fractionV = uv[1] - uv[5];
  assert(fractionU > 0 && fractionV > 0, 'Image crop has positive area');
  near((mesh.scale.x / fractionU) / (mesh.scale.y / fractionV), aspect, 'Image preserves source aspect ratio');
  near(uv[0] + uv[2], 1, 'Crop horizontally centered');
  near(uv[1] + uv[5], 1, 'Crop vertically centered');
}

let checks = 0;
function test(name, check) { check(); checks++; process.stdout.write(`PASS ${name}\n`); }

test('CPU, RAM, GPU and reduced-motion gates', () => {
  const cases = [
    [{ cpu: 4, ram: 4 }, true], [{ cpu: 8, ram: 8 }, true],
    [{ cpu: 2, ram: 8 }, false], [{ cpu: 8, ram: 2 }, false],
    [{ cpu: undefined, ram: 8 }, false], [{ cpu: 8, ram: undefined }, false],
    [{ cpu: null, ram: 8 }, false], [{ cpu: 8, ram: null }, false],
    [{ cpu: NaN, ram: 8 }, false], [{ cpu: 8, ram: NaN }, false],
    [{ cpu: 8, ram: 8, lowGPU: true }, false]
  ];
  for (const [device, enabled] of cases) {
    const harness = boot(device), screen = createScreen(harness);
    assert.equal(harness.DESIGN_MOTION_CAPABLE, enabled);
    assert.equal(screen.reframe, enabled);
    assert.equal(screen.a.userData.fitProgress, enabled ? 0 : 1);
    assert.equal(screen.a.geometry === harness.sharedPlane, !enabled);
  }
  const reduced = boot({ reduced: true }), screen = createScreen(reduced);
  assert.equal(screen.a.userData.fitProgress, 1);
  for (let i = 0; i < 180; i++) {
    reduced.updatePlaylists(1 / 60);
    assert.equal(screen.a.userData.fitProgress, 1);
  }
});

test('Fit/fill geometry remains bounded and undistorted for wide, portrait and square images', () => {
  for (const [width, height] of [[4, 2.4], [1.5, 2.1], [2.6, 1.5]]) {
    for (const aspect of [0.1, 0.4, 1, 1.5, 3, 10]) {
      const harness = boot(), items = makeItems([aspect, 1]);
      const screen = harness.makeScreen(width, height, 0, 0, 0, 0, new Group(), { reframe: true, list: items });
      assert.notEqual(screen.a.geometry, harness.sharedPlane);
      assert.notEqual(screen.a.geometry, screen.b.geometry);
      for (let step = 0; step <= 100; step++) {
        screen.fit(screen.a, items[0], step / 100);
        checkImageGeometry(screen, screen.a, aspect);
      }
      screen.fit(screen.a, items[0], 0);
      near(screen.a.scale.x, screen.w, 'Fill reaches border width');
      near(screen.a.scale.y, screen.h, 'Fill reaches border height');
      screen.fit(screen.a, items[0], 1);
      assert.deepEqual(screen.a.geometry.attributes.uv.array, originalUVs, 'Fit reveals the complete source image');
      assert.deepEqual(harness.sharedPlane.attributes.uv.array, originalUVs, 'Shared geometry stays unchanged');
      assert.deepEqual(items[0].tex.repeat, { x: 1, y: 1 });
      assert.deepEqual(items[0].tex.offset, { x: 0, y: 0 });
    }
  }
});

test('Animated cycle starts filled, eases to fit, pauses, returns to fill, then changes image', () => {
  const harness = boot(), screen = createScreen(harness, { offset: 1 });
  const initialItem = screen.item;
  assert.equal(screen.t, 0, 'Offset selects image without skipping the first transition');
  const checkpoints = [[1, 0], [3, 0.5], [5, 1], [9, 1], [11, 0.5], [13, 0], [14, 0]];
  let elapsed = 0;
  for (const [time, progress] of checkpoints) {
    while (elapsed < time - 1e-9) {
      const dt = Math.min(1 / 60, time - elapsed);
      harness.updatePlaylists(dt); elapsed += dt;
      checkImageGeometry(screen, screen.a, initialItem.aspect);
    }
    near(screen.a.userData.fitProgress, progress, `Framing at ${time} seconds`, 1e-8);
    assert.equal(screen.item, initialItem, 'Current image stays selected throughout framing cycle');
  }
  harness.updatePlaylists(1 / 60);
  assert.equal(screen.fade, 0, 'Image change follows completed return to fill');
  assert.equal(screen.a.userData.fitProgress, 0);
  assert.equal(screen.b.userData.fitProgress, 0);
  const incoming = screen.next;
  assert.notEqual(incoming, initialItem);
  let previousOpacity = 0;
  while (screen.fade >= 0) {
    harness.updatePlaylists(1 / 60);
    if (screen.fade >= 0) {
      assert(screen.matB.opacity >= previousOpacity && screen.matB.opacity <= 1);
      previousOpacity = screen.matB.opacity;
      assert.equal(screen.item, initialItem);
      assert.equal(screen.a.userData.fitProgress, 0);
      assert.equal(screen.b.userData.fitProgress, 0);
    }
  }
  assert.equal(screen.item, incoming);
  assert.equal(screen.matA.map, incoming.tex);
  assert.equal(screen.matB.opacity, 0);
  assert.equal(screen.t, 0);
  assert.deepEqual(screen.a.geometry.attributes.uv.array, screen.b.geometry.attributes.uv.array, 'Crossfade transfers crop as well as scale');
  checkImageGeometry(screen, screen.a, incoming.aspect);
});

test('Reduced-motion preference responds during a cycle and during crossfade', () => {
  const harness = boot(), screen = createScreen(harness);
  harness.updatePlaylists(3);
  near(screen.a.userData.fitProgress, 0.5, 'Initially animating');
  harness.preference.matches = true;
  harness.updatePlaylists(0.01);
  assert.equal(screen.a.userData.fitProgress, 1);
  assert.deepEqual(screen.a.geometry.attributes.uv.array, originalUVs);
  harness.updatePlaylists(4);
  assert.equal(screen.fade, 0);
  assert.equal(screen.b.userData.fitProgress, 1);
  harness.updatePlaylists(0.5);
  assert.equal(screen.a.userData.fitProgress, 1);
  assert.equal(screen.b.userData.fitProgress, 1);
  harness.updatePlaylists(0.7);
  assert.equal(screen.fade, -1);
  harness.preference.matches = false;
  harness.updatePlaylists(0.01);
  assert.equal(screen.a.userData.fitProgress, 0);
});

test('Non-animated, empty and single-image screens preserve their static behavior', () => {
  const harness = boot();
  const ordinary = createScreen(harness, { reframe: false });
  const single = createScreen(harness, { list: makeItems([0.5]) });
  const empty = createScreen(harness, { list: [] });
  assert.equal(ordinary.reframe, false);
  assert.equal(single.reframe, false);
  assert.equal(empty.matA.opacity, 0);
  harness.updatePlaylists(6.1);
  assert.equal(ordinary.fade, 0);
  assert.equal(single.fade, -1);
  assert.equal(empty.fade, -1);
  assert.equal(ordinary.a.userData.fitProgress, 1);
  assert.equal(ordinary.b.userData.fitProgress, 1);
  assert.deepEqual(harness.sharedPlane.attributes.uv.array, originalUVs);
});

test('All six Design Studio displays have white backgrounds and opt into capability-gated framing', () => {
  for (const device of [{ cpu: 8, ram: 8 }, { cpu: 2, ram: 2 }]) {
    const harness = boot(device);
    harness.buildDesign(makeItems());
    assert.equal(harness.PLAYLISTS.length, 6);
    for (const screen of harness.PLAYLISTS) {
      assert.equal(screen.g.children[2].material.color, 0xffffff);
      assert.equal(screen.reframe, harness.DESIGN_MOTION_CAPABLE);
    }
  }
  const harness = boot();
  const normal = harness.makeScreen(4, 2.4, 0, 0, 0, 0, new Group(), { tex: {}, texAspect: 1.6 });
  assert.equal(normal.g.children[2].material.color, 0x0a0d10, 'Other rooms retain original display background');
});

process.stdout.write(`\n${checks} production regression checks passed.\n`);
