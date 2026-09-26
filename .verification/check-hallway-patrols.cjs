// Run from the repository root: node .verification/check-hallway-patrols.cjs
// Exercise production AI functions with real THREE vectors/collision and a
// minimal world. Rendering, audio, elevators, and built floor meshes are omitted.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'Mall/Games/EscalatedMayhem/Index.html'), 'utf8');
const THREE = require(path.join(root, 'Mall/Apps/ZX3d_v2/vendor/three.min.js'));
const names = [
  'mulberry32', 'planHallPatrols', 'spawnEnemy', 'rayBox', 'losBlocked',
  'stepBody', 'resolve', 'rampY', 'safeSpot', 'nextWaypoint', 'inOffice',
  'escRoute', 'liftHeldBy', 'liftRoute', 'planTransit', 'enemyCallLift',
  'escStep', 'liftStep', 'huntTarget', 'updateRemote', 'alertNoise',
  'updateEnemies', 'doorAt', 'alertReticleEnemy'
];
function extract(name) {
  const match = html.match(new RegExp(`^function ${name}\\([^]*?^\\}`, 'm'));
  assert.ok(match, `Production function ${name} exists`);
  return match[0];
}
const config = html.slice(html.indexOf('const VERSION '), html.indexOf('/* ------------------------------- 2. UTILS'));
const utils = html.slice(html.indexOf('const rnd = mulberry32'), html.indexOf('function shuffled'));
const floorPlan = html.slice(html.indexOf('const ROOMS = [];'), html.indexOf('/** Patrol the clear corridor'));
const gates = html.slice(html.indexOf('const GATES = ['), html.indexOf('/** Nobody stands in an open hoistway'));
const bodyBox = html.match(/^const bodyBox = [^]*?^\}\);/m)[0];
const context = vm.createContext({ THREE });
vm.runInContext([
  config, utils, floorPlan, gates, bodyBox, ...names.map(extract),
  `
  const world = { enemies: [], elevators: [], levels: {} };
  const player = { level: 21, pos: new THREE.Vector3(0, ROOF_Y, 0), riding: null, inCar: false };
  const game = { state: 'play' };
  const scene = { add() {}, remove() {} };
  const camera = new THREE.PerspectiveCamera();
  const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3();
  const FALL_KILL_V = Math.sqrt(2 * GRAV * (FH - 1.5));
  let extraCols = [];
  function colsFor(f) {
    return [{ x0: -50, x1: 50, z0: -10, z1: 10, y0: levelY(f) - 0.5, y1: levelY(f) }, ...extraCols];
  }
  function rampsFor() { return []; }
  function carUnder() { return null; }
  function mobRig() { return { group: new THREE.Group(), yaw: 0, aimTo: 0 }; }
  function mobDrive() {}
  function huntTip() {}
  function openDoor(d) { d.open = true; }
  function killEnemy() { throw new Error('Unexpected death'); }
  function mobMuzzle() { throw new Error('Unexpected shot'); }
  function hurtPlayer() { throw new Error('Unexpected player damage'); }
  const SFX = { crush() {}, thud() {} };
  function reset(floor, x = 20, playerFloor = 21) {
    world.enemies.length = 0; world.elevators.length = 0; extraCols = [];
    player.level = playerFloor; player.pos.set(-40, levelY(playerFloor), 0);
    camera.position.copy(player.pos); camera.position.y += P.eye;
    camera.rotation.set(0, 0, 0);
    const p = { lo: 12, hi: 28, x, dir: 1 };
    const e = spawnEnemy({ idx: floor }, x, levelY(floor), 0, null, p);
    e.fireCd = 1e6;
    return e;
  }
  globalThis.api = {
    ${names.join(', ')}, world, player, camera, reset, levelY, PATROL_SPEED,
    aimAt(e, height = E.eye) {
      camera.position.copy(player.pos); camera.position.y += P.eye;
      camera.lookAt(e.pos.x, e.pos.y + height, e.pos.z);
    },
    setCols(cols) { extraCols = cols; }
  };`
].join('\n'), context, { filename: 'extracted-hallway-patrols.js' });
const a = context.api;
const close = (actual, expected, message, eps = 1e-8) => assert.ok(Math.abs(actual - expected) < eps, `${message}: got ${actual}, expected ${expected}`);
let passed = 0;
function check(name, run) { run(); passed++; console.log(`PASS ${name}`); }

check('floor counts, opposite sides, safe endpoints, and randomized upper floors', () => {
  const counts = Array.from({ length: 21 }, () => new Set());
  const sides = Array.from({ length: 21 }, () => new Set());
  for (let seed = 0; seed < 256; seed++) {
    const random = a.mulberry32(seed);
    for (let floor = 1; floor <= 20; floor++) {
      const patrols = a.planHallPatrols(floor, random);
      counts[floor].add(patrols.length);
      if (floor <= 7) {
        assert.equal(patrols.length, 2);
        assert.ok(patrols[0].hi < 0 && patrols[1].lo > 0);
      } else if (floor <= 15) assert.equal(patrols.length, 1);
      else assert.ok(patrols.length === 0 || patrols.length === 1);
      for (const p of patrols) {
        assert.ok(p.lo < p.hi && p.x >= p.lo && p.x <= p.hi);
        assert.ok((p.lo >= 12 && p.hi <= 28) || (p.lo >= -28 && p.hi <= -12));
        assert.ok(p.dir === -1 || p.dir === 1);
        sides[floor].add(Math.sign(p.x));
      }
    }
  }
  for (let floor = 16; floor <= 20; floor++) assert.deepEqual([...counts[floor]].sort(), [0, 1]);
  for (let floor = 8; floor <= 20; floor++) assert.deepEqual([...sides[floor]].sort(), [-1, 1]);
});

check('spawn keeps patrol state independent of the plan and other guards', () => {
  a.reset(8);
  const plan = { lo: -28, hi: -12, x: -20, dir: -1 };
  const e1 = a.spawnEnemy({ idx: 5 }, plan.x, a.levelY(5), 0, null, plan);
  const e2 = a.spawnEnemy({ idx: 5 }, plan.x, a.levelY(5), 0, null, plan);
  assert.equal(e1.home, 5); assert.equal(e1.room, null);
  close(e1.face, -Math.PI / 2, 'faces starting patrol direction');
  e1.patrol.dir = 1;
  assert.equal(plan.dir, -1); assert.equal(e2.patrol.dir, -1);
});

for (const mode of ['near', 'remote']) check(`${mode} guards walk at patrol speed, reverse endpoints, and do not falsely stick`, () => {
  const e = a.reset(8, 20, mode === 'near' ? 9 : 21);
  const dt = 1 / 60;
  a.updateEnemies(dt);
  close(e.pos.x, 20 + a.PATROL_SPEED * dt, `${mode} initial displacement`);
  let reversals = 0, dir = e.patrol.dir, min = e.pos.x, max = e.pos.x;
  for (let i = 0; i < 60 * 65; i++) {
    a.updateEnemies(dt);
    if (dir !== e.patrol.dir) { reversals++; dir = e.patrol.dir; }
    min = Math.min(min, e.pos.x); max = Math.max(max, e.pos.x);
    assert.equal(e.alert, false); assert.equal(e.dead, false);
    assert.equal(e.sideT, 0); assert.equal(e.stuck, 0);
    close(e.pos.z, 0, 'stays in corridor center');
    close(e.pos.y, a.levelY(8), 'stays on floor');
  }
  assert.ok(reversals >= 4, `${mode} completes repeated back-and-forth patrols`);
  assert.ok(min < 12.6 && max > 27.4 && min >= 12 && max <= 28);
  assert.equal(e.group.visible, mode === 'near');
});

check('aiming at a quiet patrol alerts it and immediately starts pursuit', () => {
  const e = a.reset(8, 20, 8);
  a.player.pos.set(24, a.levelY(8), 0);
  a.aimAt(e);
  a.updateEnemies(1 / 60);
  assert.equal(e.alert, true); assert.equal(e.los, true);
  assert.equal(e.hunt.level, 8); assert.equal(e.hunt.x, 24);
  assert.ok(e.seenT > 0);
  assert.ok(e.moving && e.vel.x > 0);
});

check('walls, distance, and other floors prevent quiet patrol detection', () => {
  let e = a.reset(8, 20, 8);
  a.player.pos.set(24, a.levelY(8), 0);
  a.aimAt(e);
  a.setCols([{ x0: 21.9, x1: 22.1, y0: a.levelY(8), y1: a.levelY(8) + 6, z0: -2, z1: 2 }]);
  a.updateEnemies(0.1);
  assert.equal(e.alert, false); assert.equal(e.los, false);
  e = a.reset(8, 20, 8);
  a.aimAt(e);
  a.updateEnemies(0.1); assert.equal(e.alert, false);
  e = a.reset(8, 20, 9);
  a.player.pos.set(21, a.levelY(9), 0);
  a.aimAt(e);
  a.updateEnemies(0.1); assert.equal(e.alert, false);
});

check('quiet guards stay unaware when the reticle points away, including nearby patrols', () => {
  const e = a.reset(8, 20, 8);
  a.player.pos.set(24, a.levelY(8), 0);
  a.aimAt(e);
  a.camera.rotation.y += Math.PI;
  a.updateEnemies(0.1);
  assert.equal(e.alert, false);
});

check('reticle detection also works for stationary office guards without any noise', () => {
  const e = a.reset(8, 20, 8);
  e.patrol = null;
  a.player.pos.set(24, a.levelY(8), 0);
  a.aimAt(e);
  a.updateEnemies(0.1);
  assert.equal(e.alert, true);
  assert.ok(e.moving && e.vel.x > 0);
});

check('eye-height wall blocks detection even when the reticle can hit the enemy below it', () => {
  const e = a.reset(8, 20, 8), y = a.levelY(8);
  a.player.pos.set(24, y, 0);
  a.aimAt(e, 0.3);
  a.setCols([{ x0: 21.9, x1: 22.1, y0: y + 1.45, y1: y + 1.8, z0: -2, z1: 2 }]);
  a.alertReticleEnemy();
  assert.equal(e.alert, false);
  a.setCols([]);
  a.alertReticleEnemy();
  assert.equal(e.alert, true);
});

check('a wall under the reticle takes precedence even with a clear eye-level view', () => {
  const e = a.reset(8, 20, 8), y = a.levelY(8);
  a.player.pos.set(24, y, 0);
  a.aimAt(e, 0.3);
  a.setCols([{ x0: 21.9, x1: 22.1, y0: y, y1: y + 1.2, z0: -2, z1: 2 }]);
  a.alertReticleEnemy();
  assert.equal(e.alert, false);
  a.aimAt(e);
  a.alertReticleEnemy();
  assert.equal(e.alert, true);
});

check('only the nearest living enemy under the reticle gets the visual alert', () => {
  const e = a.reset(8, 20, 8);
  const behind = a.spawnEnemy({ idx: 8 }, 16, a.levelY(8), 0, null);
  a.player.pos.set(24, a.levelY(8), 0);
  a.aimAt(e);
  a.alertReticleEnemy();
  assert.equal(e.alert, true); assert.equal(behind.alert, false);
  a.alertReticleEnemy();
  assert.equal(behind.alert, false);
  e.dead = true;
  a.alertReticleEnemy();
  assert.equal(behind.alert, true);
});

check('noise interrupts patrol, uses pursuit speed, and search expiry resumes it', () => {
  const e = a.reset(8);
  a.alertNoise(8, 26, 0, 0);
  assert.equal(e.alert, true); assert.equal(e.hunt.x, 26);
  a.updateEnemies(0.1);
  close(e.pos.x, 20.31, 'alert pursuit speed');
  e.hunt = { level: 8, x: e.pos.x, z: 0 };
  e.casting = true; e.searchT = 15.99;
  a.updateEnemies(0.1);
  assert.equal(e.alert, false); assert.equal(e.hunt, null);
  const x = e.pos.x;
  a.updateEnemies(0.1);
  assert.equal(e.hunt.level, e.home);
  close(e.pos.x - x, a.PATROL_SPEED * 0.1, 'resumed patrol speed');
});

check('expired off-floor search returns to the home floor and resumes its own route', () => {
  const e = a.reset(8, 20);
  e.level = 9; e.pos.y = a.levelY(9);
  e.alert = true; e.hunt = { level: 9, x: 20, z: 0 };
  e.casting = true; e.searchT = 15.99;
  a.updateEnemies(0.1); a.updateEnemies(0.1);
  assert.equal(e.alert, false); assert.equal(e.hunt.level, 8);
  assert.equal(e.act.k, 'esc'); assert.equal(e.act.to, 8);
  for (let i = 0; i < 1800; i++) a.updateEnemies(0.1);
  assert.equal(e.level, 8); assert.equal(e.act, null);
  assert.ok(e.pos.x >= e.patrol.lo && e.pos.x <= e.patrol.hi);
  close(e.pos.z, 0, 'home corridor center', 0.001);
});

check('returning patrol retains an active lift claim, released on exit or death', () => {
  const e = a.reset(8);
  const other = {};
  const el = { duty: e };
  e.act = { k: 'lift', el };
  assert.equal(a.liftHeldBy(el, other), true);
  assert.equal(a.liftHeldBy(el, e), false);
  e.act = null; assert.equal(a.liftHeldBy(el, other), false);
  e.act = { k: 'lift', el }; e.dead = true;
  assert.equal(a.liftHeldBy(el, other), false);
});

console.log(`${passed} hallway patrol checks passed.`);
