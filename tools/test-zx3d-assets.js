/* Run with: node tools/test-zx3d-assets.js. No packages or WebGL required. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '../Mall/Apps/ZX3d_v2');
const storage = new Map();
let fullStorage = false;
const context = vm.createContext({
  console, Uint8Array, Int32Array, DataView, TextEncoder, TextDecoder, performance,
  navigator: {}, THREE: require(path.join(root, 'vendor/three.min.js')),
  btoa: s => Buffer.from(s, 'binary').toString('base64'),
  atob: s => Buffer.from(s, 'base64').toString('binary'),
  localStorage: {
    getItem: key => storage.get(key) || null,
    setItem: (key, value) => { if (fullStorage) throw Error('quota'); storage.set(key, value); }
  }
});
context.window = context;
for (const name of ['zxconst', 'memory', 'world', 'basic', 'tape', 'assets', 'assetpanel']) {
  vm.runInContext(fs.readFileSync(path.join(root, 'js', name + '.js'), 'utf8'), context, { filename: name + '.js' });
}
const ZX = context.ZX;
ZX.Mem.budget = 512 * 1024 * 1024;
const world = new ZX.World(24, 20, 24);
const screen = { ink: 7, bright: 0, col: 0, println() {}, newline() {}, cls() {}, print() {}, setBorder() {} };
const env = { world, scr: screen, inkey: () => '' };
env.tape = new ZX.Tape(env);
const basic = new ZX.Basic(env), tape = env.tape, A = ZX.Assets;
let passed = 0;
function test(name, fn) { fn(); passed++; console.log('PASS ' + name); }
function direct(source) {
  basic.runDirect(source);
  let steps = 0;
  while (basic.running && ++steps < 100) basic.step(50);
  assert.equal(basic.running, false, source + ' did not finish');
  assert.match(basic.lastReport, /^0 OK/, source + ': ' + basic.lastReport);
}
function same(a, b) { assert.deepEqual(Buffer.from(a), Buffer.from(b)); }
function rewrite(bytes, change) {
  const len = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(8, true);
  const h = JSON.parse(new TextDecoder().decode(bytes.subarray(12, 12 + len)));
  change(h);
  const json = new TextEncoder().encode(JSON.stringify(h)), tail = bytes.subarray(12 + len);
  const out = new Uint8Array(12 + json.length + tail.length);
  out.set(bytes.subarray(0, 8)); new DataView(out.buffer).setUint32(8, json.length, true);
  out.set(json, 12); out.set(tail, 12 + json.length);
  return out;
}
let scene, sceneBytes, sprite, spriteBytes;
test('scenery round-trip restores floor, emptiness, all colours/materials and mesh counts', () => {
  for (let z = 0; z < world.D; z++) for (let x = 0; x < world.W; x++) world.set(x, 0, z, ZX.vox(7, 0));
  for (let v = 1; v <= 48; v++) world.set(v % 16, 1 + Math.floor(v / 16), v % 7, v);
  scene = A.captureScene(world, 'SCENERY'); sceneBytes = A.encode(scene);
  const expected = world.data.slice();
  world.clearAll(2); basic.putSaves[99] = {};
  A.applyScene(basic, A.decode(sceneBytes));
  same(world.data, expected);
  assert.equal(Object.keys(basic.putSaves).length, 0);
  assert.equal(world.solidCount.reduce((a, b) => a + b, 0), expected.filter(Boolean).length);
  assert.ok(world.dirty.length);
});
test('smaller scenery loads at BASIC origin with correct depth orientation', () => {
  const small = new ZX.World(2, 2, 3);
  small.set(0, 0, 0, 17); small.set(1, 1, 2, 48);
  A.applyScene(basic, A.captureScene(small, 'SMALL'));
  assert.equal(world.get(0, 0, 0), 17); assert.equal(world.get(1, 1, 2), 48);
  assert.equal(world.data.filter(Boolean).length, 2);
});
test('sprite capture crops bounds, excludes floor, preserves top/down and depth', () => {
  world.clearAll(); world.set(0, 0, 0, 8);
  world.set(4, 2, 6, 1); world.set(5, 3, 6, 24); world.set(6, 2, 7, 48);
  sprite = A.captureSprite(world, 'HERO', {});
  assert.deepEqual(Array.from(sprite.origin), [4, 2, 6]);
  assert.deepEqual([sprite.w, sprite.h, sprite.d], [3, 2, 2]);
  same(sprite.frames[0], [0, 24, 0, 1, 0, 0, 0, 0, 0, 0, 0, 48]);
  assert.equal(A.captureSprite(world, 'FLOOR', { includeFloor: true }).origin[1], 0);
  assert.equal(A.captureSprite(world, 'PART', { bounds: { x: 5, y: 3, z: 6, w: 1, h: 1, d: 1 } }).frames[0][0], 24);
  assert.throws(() => A.captureSprite(world, 'BAD', { bounds: { x: 23, y: 1, z: 1, w: 2, h: 1, d: 1 } }), /bounds/);
  assert.throws(() => A.captureSprite(world, 'EMPTY', { bounds: { x: 10, y: 1, z: 1, w: 1, h: 1, d: 1 } }), /No voxels/);
  spriteBytes = A.encode(sprite);
});
test('import preserves editor and world; LOAD SPRITE installs without stamping', () => {
  basic.storeLine(10, 'REM GAME'); basic.vars.SCORE = 42;
  const before = world.data.slice(), listing = basic.listing().join('\n');
  tape.importAsset(spriteBytes); tape.importAsset(sceneBytes);
  same(world.data, before); assert.equal(basic.listing().join('\n'), listing);
  direct('LOAD "HERO" SPRITE 3');
  assert.equal(basic.vars.SCORE, 42); same(world.data, before);
  assert.equal(basic.sprites[3].materials, true);
});
test('PUT/MOVE/UNPUT keep per-voxel materials, transparency and overlapping background', () => {
  world.clearAll();
  for (let i = 0; i < world.data.length; i++) world.data[i] = 1 + i % 48;
  const before = world.data.slice(); basic.mat = 0;
  direct('PUT 3,10,8,10');
  assert.equal(world.get(10, 8, 10), 1);
  assert.equal(world.get(11, 9, 10), 24);
  assert.equal(world.get(12, 8, 11), 48);
  const emptyIndex = 10 + world.W * (world.D - 1 - 10 + world.D * 9);
  assert.equal(world.get(10, 9, 10), before[emptyIndex]);
  direct('MOVE 3,11,8,10'); direct('UNPUT 3'); same(world.data, before);
  direct('PUT 3,-1,19,23'); direct('UNPUT 3'); same(world.data, before);
});
test('classic SDATA sprites still use current MAT; SAVE/LOAD keeps animation frames', () => {
  direct('SPRITE 8,2,1,1,2: SDATA 8,0,0,"F.": SDATA 8,1,0,".2"');
  direct('MAT 1: PUT 8,0,2,0'); assert.equal(world.get(0, 2, 0), ZX.vox(15, 1)); direct('UNPUT 8');
  direct('SAVE "ANIM" SPRITE 8'); direct('LOAD "ANIM" SPRITE 9');
  assert.equal(basic.sprites[9].nf, 2); assert.equal(basic.sprites[9].materials, false);
  same(basic.sprites[9].f[1], [0, 3]);
  direct('MAT 2: SDATA 3,0,0,"1.."'); assert.equal(basic.sprites[3].f[0][0], ZX.vox(1, 2));
});
test('SAVE/LOAD SCREEN$ and in-program asset loads preserve game execution', () => {
  direct('SAVE "LEVEL" SCREEN$'); const expected = world.data.slice(); world.clearAll();
  direct('LOAD "LEVEL" SCREEN$'); same(world.data, expected);
  basic.lines = [];
  basic.storeLine(10, 'LOAD "SCENERY" SCREEN$');
  basic.storeLine(20, 'LOAD "HERO" SPRITE 4');
  basic.storeLine(30, 'LET score=99: PUT 4,1,2,3');
  direct('RUN'); assert.equal(basic.vars.SCORE, 99); assert.equal(basic.lines.length, 3);
  assert.equal(world.get(2, 3, 3), 24);
});
test('native assets survive tape persistence; .tap exports programs separately', () => {
  tape.saveFromBasic(basic, 'GAME', 'program');
  const restored = new ZX.Tape(env);
  same(restored.exportAsset('HERO', 'sprite'), spriteBytes);
  assert.equal(restored.loadSprite(basic, 'HERO', 5), true);
  const blocks = tape.parseTapBlocks(tape.exportTap());
  assert.equal(blocks.length, 2); assert.equal(blocks[0].data[0], 0);
  assert.match(tape.extractProgramFromTap(tape.exportTap()).src, /LOAD/);
});
test('dense full-screen assets larger than 64KB round-trip without TAP truncation', () => {
  const data = new Uint8Array(255 * 175 * 255);
  for (let i = 0; i < data.length; i++) data[i] = i % 49;
  const asset = { name: 'DENSE', kind: 'world', w: 255, h: 175, d: 255, origin: [0, 0, 0], materials: true, data };
  const bytes = A.encode(asset);
  assert.ok(bytes.length > 65535); assert.ok(bytes.length < data.length + 1024);
  same(A.decode(bytes).data, data);
});
test('invalid files are rejected atomically, including malformed RLE and dimensions', () => {
  const before = world.data.slice(), blocks = tape.blocks.length;
  const badVoxel = spriteBytes.slice(); badVoxel[badVoxel.length - 1] = 255;
  const zeroRun = sceneBytes.slice();
  const len = new DataView(zeroRun.buffer).getUint32(8, true);
  zeroRun[12 + len + 1] = 0; zeroRun[12 + len + 2] = 0;
  const tail = new Uint8Array(spriteBytes.length + 1); tail.set(spriteBytes);
  for (const bytes of [new Uint8Array(0), spriteBytes.subarray(0, 10), spriteBytes.subarray(0, spriteBytes.length - 1),
    badVoxel, zeroRun, tail, rewrite(spriteBytes, h => { h.version = 99; }),
    rewrite(spriteBytes, h => { h.w = 256; }), rewrite(spriteBytes, h => { h.frames[0].length += 1; })]) {
    assert.throws(() => tape.importAsset(bytes));
    assert.equal(tape.blocks.length, blocks); same(world.data, before);
  }
  const existing = basic.sprites[5];
  assert.throws(() => A.installSprite(basic, sprite, -1)); assert.equal(basic.sprites[5], existing);
  const budget = ZX.Mem.budget; ZX.Mem.budget = 0;
  assert.throws(() => tape.importAsset(spriteBytes), /memory/); ZX.Mem.budget = budget;
});
test('missing assets report BASIC errors and full storage is reported without losing RAM copy', () => {
  basic.runDirect('LOAD "MISSING" SPRITE 1'); basic.step(100); assert.match(basic.lastReport, /^R /);
  fullStorage = true; tape.saveAsset(sprite); assert.equal(tape.lastSavePersisted, false);
  assert.ok(tape.find('HERO', 'sprite')); fullStorage = false;
  assert.equal(tape.save(), true);
});
test('generated BASIC examples handle quoted names and do not replace the game', () => {
  const named = Object.assign({}, sprite, { name: 'THE "HERO"' }); tape.saveAsset(named);
  const source = ZX.AssetPanel.example(named.name, 'sprite', 11, named.origin);
  assert.match(source, /LOAD "THE ""HERO""" SPRITE 11/);
  direct(source.split('\n')[1].replace(/^20 /, ''));
  assert.ok(basic.sprites[11]);
});
test('save panel handlers download scenery/sprites and expose non-destructive import commands', () => {
  // Use IDs and defaults from the real page, so missing markup breaks the wiring test.
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8'), nodes = new Map();
  for (const match of html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)) {
    assert.equal(nodes.has(match[1]), false, 'Duplicate ID: ' + match[1]);
    const tag = match[0], classes = new Set((tag.match(/class="([^"]*)"/) || [0, ''])[1].split(' '));
    nodes.set(match[1], {
      value: (tag.match(/value="([^"]*)"/) || [0, ''])[1], checked: false, disabled: false,
      textContent: '', listeners: {}, classList: {
        toggle(c, yes) { if (yes) classes.add(c); else classes.delete(c); },
        contains(c) { return classes.has(c); }
      }, addEventListener(type, fn) { this.listeners[type] = fn; }, click() {}
    });
  }
  context.document = { getElementById: id => nodes.get(id) || null };
  let modal, downloaded, refreshes = 0;
  tape.download = (filename, bytes) => { downloaded = { filename, bytes }; };
  nodes.get('asset-kind').value = 'world'; nodes.get('asset-region').value = 'all';
  ZX.AssetPanel.bind({ world, machine: { tape } }, id => { modal = id; }, () => { refreshes++; }, () => {});
  nodes.get('hud-assets').listeners.click(); assert.equal(modal, 'assets');
  const before = world.data.slice(), listing = basic.listing().join('\n');
  const submit = () => nodes.get('asset-form').listeners.submit({ preventDefault() {} });
  nodes.get('asset-name').value = 'UI SCENE'; submit();
  assert.equal(downloaded.filename, 'UI-SCENE.zx3d');
  same(A.decode(downloaded.bytes).data, before);
  assert.equal(tape.find('UI SCENE', 'scene').data, downloaded.bytes);
  assert.match(nodes.get('asset-code').textContent, /LOAD "UI SCENE" SCREEN\$/);
  same(world.data, before); assert.equal(basic.listing().join('\n'), listing);
  nodes.get('asset-kind').value = 'sprite'; nodes.get('asset-kind').listeners.input();
  assert.equal(nodes.get('asset-sprite-options').disabled, false);
  nodes.get('asset-region').value = 'box'; nodes.get('asset-region').listeners.input();
  assert.equal(nodes.get('asset-bounds').disabled, false);
  for (const [key, value] of Object.entries({ x: 1, y: 2, z: 3, w: 3, h: 2, d: 2 })) nodes.get('asset-' + key).value = String(value);
  nodes.get('asset-name').value = 'UI HERO'; submit();
  assert.equal(downloaded.filename, 'UI-HERO.zx3d');
  assert.equal(A.decode(downloaded.bytes).kind, 'sprite');
  assert.equal(nodes.get('asset-status').classList.contains('error'), false);
  assert.equal(refreshes, 2);
  const imported = tape.importAsset(downloaded.bytes);
  ZX.AssetPanel.imported(imported, true); assert.equal(modal, 'assets');
  assert.match(nodes.get('asset-code').textContent, /LOAD "UI HERO" SPRITE 1/);
  same(world.data, before); assert.equal(basic.listing().join('\n'), listing);
  nodes.get('asset-x').value = '254'; submit();
  assert.equal(nodes.get('asset-status').classList.contains('error'), true);
  assert.equal(refreshes, 2);
});
console.log('\n' + passed + ' asset integration tests passed.');
