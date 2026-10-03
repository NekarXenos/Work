/* Run with: node tests/test-doom.js
   Uses the shipped BASIC interpreter, voxel collision world and player physics.
   Only rendering, sound and DOM presentation are replaced with headless stubs. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const root = path.resolve(__dirname, '..');
let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log('PASS ' + name);
}

function makeHarness() {
  let now = 1000;
  const elements = {};
  function element(id) {
    return elements[id] || (elements[id] = {
      id, textContent: '', innerHTML: '', style: {}, dataset: {}, children: [],
      classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
      appendChild(child) { this.children.push(child); },
      addEventListener() {}, setAttribute() {}, removeAttribute() {}, getAttribute() { return ''; },
      querySelector() { return element(id + '-child'); },
      querySelectorAll() { return []; }
    });
  }
  const context = {
    console, performance: { now: () => now },
    navigator: { deviceMemory: 8, hardwareConcurrency: 8 },
    document: { getElementById: element, createElement: () => element('created-' + Object.keys(elements).length),
      querySelector: element, querySelectorAll: () => [], addEventListener() {} },
    setTimeout() {}, clearTimeout() {}, requestAnimationFrame() {},
    addEventListener() {}, removeEventListener() {}
  };
  context.document.body = element('body');
  context.window = context;
  context.self = context;
  vm.createContext(context);
  for (const file of ['vendor/three.min.js', 'js/zxconst.js', 'js/memory.js',
    'js/world.js', 'js/player.js', 'js/basic.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  }
  const ZX = context.ZX;
  ZX.Mem.detect();
  const world = new ZX.World(ZX.SCREEN_W, ZX.SCREEN_H, ZX.SCREEN_D);
  const camera = new context.THREE.PerspectiveCamera(65, 1, 0.05, 100);
  const player = new ZX.Player(world, camera);
  const linesPrinted = [];
  const scr = {
    col: 0, row: 0, ink: 0, bright: 0,
    print(s) { linesPrinted.push(String(s)); this.col += String(s).length; },
    println(s) { this.print(s); this.newline(); },
    newline() { this.col = 0; this.row++; },
    cls() { this.col = 0; this.row = 0; },
    at(r, c) { this.row = r; this.col = c; },
    plot() {}, line() {}, circle() {}, getPixel() { return 0; }, charAt() { return 32; }
  };
  const env = {
    world, scr, floorY: 1,
    inkey: () => '', beep() {}, sun() {}, onInput() {}, onScreenMode() {},
    view(x, y, z) {
      player.teleport(x * ZX.PIX, y * ZX.PIX, (ZX.SCREEN_D - 1 - z) * ZX.PIX);
    }
  };
  const basic = new ZX.Basic(env);
  let bridge;
  const G = { world, camera, player, machine: { basic }, started: true, editing: null, current: null };
  function attachBridge() {
    vm.runInContext(fs.readFileSync(path.join(root, 'js/game.js'), 'utf8'), context, { filename: 'js/game.js' });
    bridge = new ZX.GameBridge(G, { leaveTerminal() {}, spawn() {}, generateWorld() {} });
    env.peek = addr => bridge.peek(addr);
    env.poke = (addr, value) => bridge.poke(addr, value);
    return bridge;
  }
  function advanceUntil(predicate, maxStatements = 2000000) {
    for (let n = 0; n < maxStatements; n++) {
      if (predicate()) return;
      assert(basic.running, 'BASIC stopped: ' + basic.lastReport);
      if (basic.waiting === 'pause') {
        now = Math.max(now, basic.waitUntil);
        basic.waiting = null;
      }
      assert(!basic.waiting, 'Unexpected BASIC wait: ' + basic.waiting);
      try { basic.execOne(); }
      catch (error) {
        throw new Error('BASIC line ' + basic.curLineNo() + ': ' + error.message, { cause: error });
      }
    }
    throw new Error('BASIC exceeded ' + maxStatements + ' statements at line ' + basic.curLineNo());
  }
  function untilPause() {
    advanceUntil(() => basic.waiting === 'pause' || basic.waiting === 'key');
  }
  function cycle() {
    if (basic.waiting === 'pause') {
      now = Math.max(now, basic.waitUntil);
      basic.waiting = null;
    }
    if (bridge) bridge.snapshot();
    untilPause();
  }
  function load(file) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    for (const line of source.split(/\r?\n/)) {
      if (line.trim()) basic.submit(line);
    }
    basic.submit('RUN');
    return source;
  }
  function at(x, z, y = 1) {
    player.teleport(x * ZX.PIX, y * ZX.PIX, (ZX.SCREEN_D - 1 - z) * ZX.PIX);
    player.pitch = 0;
    if (bridge) bridge.snapshot();
  }
  return { context, ZX, world, camera, player, env, basic, elements, linesPrinted,
    G, attachBridge, load, at, cycle, untilPause, advanceUntil, advanceTime(ms) { now += ms; } };
}

if (require.main === module) {
  const h = makeHarness();
  check('real voxel collision catches a wall and leaves floor spawn clear', () => {
    h.world.box(0, 0, 0, 255, 1, 255, { colour: 1, mat: 0 }, true);
    h.world.box(80, 1, 80, 16, 24, 16, { colour: 2, mat: 0 }, true);
    h.at(64, 88);
    assert.strictEqual(h.player.blocked(), false);
    h.at(88, 88);
    assert.strictEqual(h.player.blocked(), true);
    h.world.clearAll(0);
  });
  const bridge = h.attachBridge();
  check('player coordinates and yaw reach BASIC through the bridge', () => {
    bridge.poke(64000, 2);
    h.world.box(80, 1, 40, 4, 24, 20, { colour: 2, mat: 0 }, true);
    h.at(50, 50);
    bridge.poke(64028, 192);
    bridge.snapshot();
    assert.strictEqual(bridge.peek(64001), 50);
    assert.strictEqual(bridge.peek(64002), 1);
    assert.strictEqual(bridge.peek(64003), 50);
    assert.strictEqual(bridge.peek(64004), 192);
    h.basic.mem[65000] = 77;
    h.basic.runDirect('LET portx=PEEK 64001: LET legacy=PEEK 65000');
    h.advanceUntil(() => !h.basic.running);
    assert.strictEqual(h.basic.vars.PORTX, 50);
    assert.strictEqual(h.basic.vars.LEGACY, 77);
  });
  check('shots latch the actual voxel ray and inputs are consumed once', () => {
    bridge.fire();
    assert.strictEqual(bridge.peek(64013), 1);
    assert.strictEqual(bridge.peek(64008), 1);
    assert.strictEqual(bridge.peek(64005), 80);
    assert.strictEqual(bridge.peek(64007), 50);
    h.at(15, 15);
    bridge.poke(64028, 0);
    bridge.snapshot();
    assert.strictEqual(bridge.peek(64005), 80, 'latched ray changed after player moved');
    assert.strictEqual(bridge.peek(64013), 0);
    assert.strictEqual(bridge.peek(64008), 0);
    bridge.use();
    assert.strictEqual(bridge.peek(64014), 1);
    assert.strictEqual(bridge.peek(64014), 0);
  });
  check('pause freezes player and interpreter and rejects combat input', () => {
    bridge.pause();
    assert.strictEqual(h.player.enabled, false);
    assert.strictEqual(bridge.beforeFrame(0.016), false);
    bridge.fire(); bridge.use();
    assert.strictEqual(bridge.peek(64013), 0);
    assert.strictEqual(bridge.peek(64014), 0);
    bridge.resume();
    assert.strictEqual(h.player.enabled, true);
    assert.strictEqual(bridge.beforeFrame(0.016), true);
  });
  const game = makeHarness();
  const host = game.attachBridge();
  game.world.plot(5, 5, 5, 14, 0);
  game.basic.submit('10 REM SANDBOX TO RESTORE');
  const sandbox = game.world.data.slice();
  const gameSource = fs.readFileSync(path.join(root, 'games/DOOM.bas'), 'utf8').replace(/\r\n/g, '\n');
  check('the offline bundled program exactly matches the editable BASIC listing', () => {
    game.ZX.BUILTIN_PROGRAMS = {};
    vm.runInContext(fs.readFileSync(path.join(root, 'js/doom-program.js'), 'utf8'), game.context,
      { filename: 'js/doom-program.js' });
    assert.strictEqual(game.ZX.DOOM_SOURCE, gameSource, 'rebuild the bundle using tools/bundle-doom.js');
    assert.strictEqual(game.ZX.BUILTIN_PROGRAMS.DOOM, gameSource);
  });
  host.start();
  check('pausing during map construction can resume and finish the map', () => {
    assert.strictEqual(host.state, 1);
    host.pause();
    assert.strictEqual(host.beforeFrame(0.016), false);
    assert.strictEqual(game.player.enabled, false);
    host.resume();
    assert.strictEqual(host.beforeFrame(0.016), true);
    assert.strictEqual(game.player.enabled, false, 'player moved during map construction');
  });
  game.untilPause();
  const b = game.basic;
  const array = (name, ...indexes) => {
    const a = b.arrays[name.toUpperCase()];
    return a.data[b.arrayOffset(a, indexes)];
  };
  const setArray = (name, indexes, value) => b.setArray(name.toUpperCase(), indexes, value);
  const maps = [];
  function verifyMap() {
    maps.push(b.arrays.M.data.join(''));
    const reached = new Set(['2,6']), queue = [[2, 6]];
    for (let n = 0; n < queue.length; n++) {
      const [x, z] = queue[n];
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = x + dx, zz = z + dz, key = xx + ',' + zz;
        if (xx < 1 || xx > 11 || zz < 1 || zz > 11 || reached.has(key) || array('m', xx, zz) === 1) continue;
        reached.add(key); queue.push([xx, zz]);
      }
    }
    assert(reached.has('10,6'), 'lift cannot be reached even when doors open');
    for (let i = 1; i <= 6; i++) {
      const x = Math.floor((array('ex', i) - 17) / 20) + 1;
      const z = Math.floor((array('ez', i) - 17) / 20) + 1;
      assert(reached.has(x + ',' + z), 'enemy ' + i + ' is unreachable');
    }
    for (let p = 1; p <= 4; p++) {
      const x = Math.floor((array('px', p) - 17) / 20) + 1;
      const z = Math.floor((array('pz', p) - 17) / 20) + 1;
      assert(reached.has(x + ',' + z), 'pickup ' + p + ' is unreachable');
    }
  }
  function coolWeapon() {
    while (b.vars.CD > 0) game.cycle();
  }
  function aimAtEnemy(i) {
    const ex = array('ex', i), ez = array('ez', i);
    for (const [dx, dz, yaw] of [[-10, 0, 192], [10, 0, 64], [0, -10, 0], [0, 10, 128]]) {
      game.at(ex + dx, ez + dz);
      if (game.player.blocked()) continue;
      host.poke(64028, yaw); host.snapshot();
      const hx = host.peek(64005), hz = host.peek(64007), hy = host.peek(64006);
      if (host.peek(64008) && Math.abs(hx - ex) <= 3 && Math.abs(hz - ez) <= 2 && hy >= 1 && hy <= 19) return;
    }
    throw new Error('Could not aim at enemy ' + i + ' from a collision-free adjacent position');
  }
  function hitEnemy(i) {
    coolWeapon();
    aimAtEnemy(i);
    const hp = array('eh', i);
    game.advanceTime(300); host.fire(); game.cycle();
    assert.strictEqual(array('eh', i), hp - 1, 'shot did not damage the aimed enemy ' + i);
  }
  function killRemaining() {
    for (let i = 1; i <= 6; i++) {
      // Each combat fixture starts healthy so this tests every enemy, even
      // after intentionally taking damage in the earlier AI checks.
      b.vars.HP = 100;
      while (array('eh', i) > 0) hitEnemy(i);
    }
    assert.strictEqual(b.vars.ALIVE, 0);
  }
  function openDoors() {
    for (let d = 1; d <= 2; d++) {
      if (array('ds', d)) continue;
      const x = 27 + (array('dx', d) - 1) * 20;
      const z = 27 + (array('dz', d) - 1) * 20;
      assert(game.world.get(x, 14, z) > 0, 'closed door has no solid voxels');
      game.at(x - 20, z);
      host.use(); game.cycle();
      assert.strictEqual(array('ds', d), 1);
      assert.strictEqual(array('m', array('dx', d), array('dz', d)), 0);
      assert.strictEqual(game.world.get(x, 14, z), 0, 'door voxels did not restore empty air');
    }
  }
  check('the actual BASIC game builds SCREEN 4 and enters its game loop', () => {
    assert.strictEqual(b.lastReport, null);
    assert.strictEqual(b.mode3d, true);
    assert.strictEqual(host.state, 2);
    assert.strictEqual(b.vars.LE, 1);
    assert.strictEqual(b.vars.HP, 100);
    assert.strictEqual(b.vars.AM, 40);
    assert.strictEqual(b.vars.ALIVE, 6);
    assert.strictEqual(b.curLineNo(), 690);
    assert.strictEqual(b.waiting, 'pause');
  });
  check('the real player spawns clear of voxel collision', () => {
    assert.strictEqual(game.player.blocked(), false, 'initial spawn is inside a voxel');
    assert.strictEqual(Math.round(game.player.pos.x / game.ZX.PIX), 47);
    assert.strictEqual(Math.round(game.ZX.SCREEN_D - 1 - game.player.pos.z / game.ZX.PIX), 127);
  });
  check('all enemies, supplies and the lift are connected through openable doors', verifyMap);
  check('actual walking stops at a closed door and crosses it after E opens it', () => {
    const walking = makeHarness(), walkHost = walking.attachBridge();
    walking.ZX.DOOM_SOURCE = gameSource;
    walkHost.start(); walking.untilPause();
    const walk = frames => {
      walking.player.keys = { w: 1 };
      for (let n = 0; n < frames; n++) {
        walking.advanceTime(1000 / 60);
        if (walkHost.beforeFrame(1 / 60)) walking.player.update(1 / 60);
        if (n % 6 === 5) walking.cycle();
      }
      walking.player.keys = {};
    };
    walk(90);
    assert(walking.player.pos.x / walking.ZX.PIX > 70, 'player never reached the door');
    assert(walking.player.pos.x / walking.ZX.PIX < 77, 'player crossed the closed door');
    assert.strictEqual(walking.basic.arrays.DS.data[0], 0);
    walkHost.use(); walking.cycle();
    assert.strictEqual(walking.basic.arrays.DS.data[0], 1);
    walk(60);
    assert(walking.player.pos.x / walking.ZX.PIX > 97, 'player could not cross the open door');
    assert(Math.abs(walking.player.pos.y / walking.ZX.PIX - 1) < 0.01, 'player fell through the floor');
    assert.strictEqual(walking.player.blocked(), false);
  });
  check('enemy AI cannot see or move through a wall', () => {
    const ex = array('ex', 1), ez = array('ez', 1);
    game.at(127, 67);
    for (let n = 0; n < 4; n++) game.cycle();
    assert.strictEqual(array('ex', 1), ex);
    assert.strictEqual(array('ez', 1), ez);
  });
  check('visible enemies chase and deal level-dependent damage', () => {
    game.at(47, 67);
    const before = array('ex', 1);
    for (let n = 0; n < 2; n++) game.cycle();
    assert(array('ex', 1) < before, 'enemy did not chase the visible player');
    game.at(array('ex', 1) - 10, array('ez', 1));
    setArray('ec', [1], 0);
    b.vars.T = 1;
    const health = b.vars.HP;
    game.cycle();
    assert.strictEqual(b.vars.HP, health - 8);
    assert(host.ports[27] > 0, 'damage flash was not emitted');
  });
  check('walls block shots and misses spend ammunition', () => {
    coolWeapon();
    game.at(87, 67); host.poke(64028, 192); host.snapshot();
    assert.strictEqual(host.peek(64005), 97, 'aim ray did not hit the intervening wall');
    const enemies = b.arrays.EH.data.slice(), ammo = b.vars.AM;
    game.advanceTime(300); host.fire(); game.cycle();
    assert.strictEqual(b.vars.AM, ammo - 1);
    assert.deepStrictEqual(b.arrays.EH.data, enemies);
  });
  check('aimed shots damage enemies; cooldown prevents extra ammunition loss', () => {
    hitEnemy(1);
    const health = array('eh', 1), ammo = b.vars.AM;
    game.advanceTime(300); host.fire(); game.cycle();
    assert.strictEqual(array('eh', 1), health);
    assert.strictEqual(b.vars.AM, ammo);
    assert.strictEqual(b.vars.STATUS, 14);
    hitEnemy(1);
    assert.strictEqual(array('eh', 1), 0);
    assert.strictEqual(b.vars.KILLS, 1);
    assert.strictEqual(b.vars.ALIVE, 5);
    assert(!b.putSaves[1], 'dead enemy sprite remains in the world');
  });
  check('doors open through interaction and remove their collision voxels', openDoors);
  check('the lift remains locked while hostiles survive', () => {
    game.at(207, 127); host.use(); game.cycle();
    assert.strictEqual(b.vars.LE, 1);
    assert.strictEqual(host.state, 2);
    assert.strictEqual(b.vars.STATUS, 3);
  });
  check('ammo and health pickups work once and clamp to their limits', () => {
    b.vars.AM = 94; b.vars.T = 0;
    game.at(array('px', 2), array('pz', 2)); game.cycle();
    assert.strictEqual(b.vars.AM, 99);
    assert.strictEqual(array('ps', 2), 1);
    assert(!b.putSaves[21]);
    b.vars.AM = 30; b.vars.T = 0; game.cycle();
    assert.strictEqual(b.vars.AM, 30, 'ammo was collected twice');
    b.vars.HP = 85; b.vars.T = 0;
    game.at(array('px', 3), array('pz', 3)); game.cycle();
    assert.strictEqual(b.vars.HP, 100);
    assert.strictEqual(array('ps', 3), 1);
    assert(!b.putSaves[22]);
    b.vars.HP = 50; b.vars.T = 0; game.cycle();
    assert.strictEqual(b.vars.HP, 50, 'medkit was collected twice');
  });
  check('an empty gun does not damage an enemy or create negative ammo', () => {
    coolWeapon(); aimAtEnemy(2);
    b.vars.AM = 0;
    const health = array('eh', 2);
    game.advanceTime(300); host.fire(); game.cycle();
    assert.strictEqual(b.vars.AM, 0);
    assert.strictEqual(array('eh', 2), health);
    assert.strictEqual(b.vars.STATUS, 9);
    b.vars.AM = 40;
  });
  check('every first-level hostile can be killed using actual aimed voxel shots', () => {
    killRemaining();
    assert.strictEqual(b.vars.KILLS, 6);
  });
  check('east lift shifts to a different map at the west spawn and preserves supplies', () => {
    b.vars.HP = 73; b.vars.AM = 37;
    game.at(207, 127); host.use(); game.cycle();
    assert.strictEqual(b.vars.LE, 2);
    assert.strictEqual(b.vars.HP, 73);
    assert.strictEqual(b.vars.AM, 37);
    assert.strictEqual(b.vars.KILLS, 6);
    assert.strictEqual(b.vars.ALIVE, 6);
    assert.strictEqual(host.state, 2);
    assert.strictEqual(Math.round(game.player.pos.x / game.ZX.PIX), 47);
    assert.strictEqual(game.player.blocked(), false);
    verifyMap();
    assert.notStrictEqual(maps[0], maps[1]);
    game.cycle();
    assert.strictEqual(b.vars.LE, 2, 'arrival immediately shifted again');
  });
  check('the second map supports combat, doors and another opposite-side shift', () => {
    openDoors(); killRemaining();
    assert.strictEqual(b.vars.KILLS, 12);
    b.vars.HP = 61; b.vars.AM = 29;
    game.at(207, 127); host.use(); game.cycle();
    assert.strictEqual(b.vars.LE, 3);
    assert.strictEqual(b.vars.HP, 61);
    assert.strictEqual(b.vars.AM, 29);
    assert.strictEqual(b.vars.KILLS, 12);
    assert.strictEqual(Math.round(game.player.pos.x / game.ZX.PIX), 47);
    assert.strictEqual(game.player.blocked(), false);
    verifyMap();
    assert.strictEqual(new Set(maps).size, 3, 'maps did not change for all three levels');
  });
  check('clearing the third map and using the lift wins the campaign', () => {
    openDoors(); killRemaining();
    assert.strictEqual(b.vars.KILLS, 18);
    game.at(207, 127); host.use(); game.cycle();
    assert.strictEqual(host.state, 4);
    assert.strictEqual(host.beforeFrame(0.016), false);
    assert.strictEqual(game.player.enabled, false);
    assert.strictEqual(b.curLineNo(), 830);
  });
  check('pause and result overlays keep keyboard access to their buttons', () => {
    for (const state of [2, 3, 4]) {
      host.setState(state);
      if (state === 2) host.pause();
      for (const code of ['Tab', 'Enter', 'Space']) {
        assert.strictEqual(host.keyDown({ code }), false, code + ' was intercepted in overlay state ' + state);
      }
      assert.strictEqual(host.keyDown({ code: 'KeyW' }), true);
    }
    host.setState(2); host.resume();
    assert.strictEqual(host.keyDown({ code: 'Tab' }), true, 'gameplay focus escaped while moving');
  });
  check('restart rebuilds level one and resets campaign progress', () => {
    host.start(); game.untilPause();
    assert.strictEqual(host.state, 2);
    assert.strictEqual(b.vars.LE, 1);
    assert.strictEqual(b.vars.HP, 100);
    assert.strictEqual(b.vars.AM, 40);
    assert.strictEqual(b.vars.KILLS, 0);
    assert.strictEqual(b.vars.ALIVE, 6);
    assert.strictEqual(game.player.blocked(), false);
  });
  check('lethal attacks stop gameplay and expose the restart state', () => {
    game.at(array('ex', 1) - 10, array('ez', 1));
    b.vars.HP = 1; b.vars.T = 1; setArray('ec', [1], 0);
    game.cycle();
    assert.strictEqual(b.vars.HP, 0);
    assert.strictEqual(host.state, 3);
    assert.strictEqual(host.beforeFrame(0.016), false);
    assert.strictEqual(game.player.enabled, false);
  });
  check('exiting restores the original BASIC sandbox and every voxel', () => {
    host.exit();
    assert.strictEqual(host.state, 0);
    assert.strictEqual(game.player.gameMode, false);
    assert.deepStrictEqual(Array.from(b.listing()), ['10 REM SANDBOX TO RESTORE']);
    assert.strictEqual(Buffer.compare(Buffer.from(game.world.data), Buffer.from(sandbox)), 0);
    assert.strictEqual(game.world.solidCount.reduce((sum, count) => sum + count, 0), 1);
  });
  console.log(passed + ' checks passed');
}

module.exports = { makeHarness };
