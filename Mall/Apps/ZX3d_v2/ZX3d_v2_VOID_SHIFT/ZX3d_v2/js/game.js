/* VOID SHIFT host interface. Maps, AI, damage, pickups and progression are
   executed by games/DOOM.bas. This module only exposes the 3D player to BASIC,
   routes input, and displays BASIC's output ports. No game rules live here. */
(function (ZX) {
  'use strict';

  var BASE = 64000, PIX = ZX.PIX;
  var MESSAGES = [
    'Clear the hostiles. Find the green lift. Press E to shift.',
    'Building the next sector...', 'Press E near a yellow door.',
    'Lift locked. Clear the remaining hostiles.', 'Door opened.',
    'Ammo collected.', 'Medkit collected.', 'Target hit.', 'Hostile down.',
    'Out of ammo. Look for yellow ammo packs.', 'Shift complete. New sector.',
    'Signal lost.', 'All sectors secured.', 'Press E to use the green lift.',
    'Weapon cooling.', 'Taking damage. Keep moving!'
  ];
  var NAMES = ['', 'REACTOR', 'FOUNDRY', 'VOID CORE'];
  function el(id) { return document.getElementById(id); }
  function hide(id, yes) { var e = el(id); if (e) e.classList.toggle('hidden', !!yes); }
  function text(id, value) { var e = el(id); if (e) e.textContent = String(value); }
  function now() { return performance.now(); }

  function GameBridge(G, hooks) {
    this.G = G; this.hooks = hooks || {};
    this.state = 0; this.paused = false; this.saved = null;
    this.ports = new Uint8Array(32);
    this.live = new Uint8Array(16);
    this.shot = null; this.latched = null; this.useQueued = false;
    this.fireHeld = false; this.turn = 0; this.lastShot = -1000;
    this.shotUntil = 0; this.damageUntil = 0; this.messageUntil = 0;
    this.direction = new THREE.Vector3();
    var self = this;
    ['doom-start', 'doom-launch'].forEach(function (id) {
      var e = el(id); if (e) e.addEventListener('click', function () { self.start(); });
    });
    var e = el('doom-resume'); if (e) e.addEventListener('click', function () { self.resume(); });
    e = el('doom-restart'); if (e) e.addEventListener('click', function () { self.start(); });
    e = el('doom-exit'); if (e) e.addEventListener('click', function () { self.exit(); });
    document.addEventListener('visibilitychange', function () { if (document.hidden) self.pause(); });
    window.addEventListener('blur', function () { self.pause(); });
  }
  ZX.GameBridge = GameBridge;

  GameBridge.prototype.captureSandbox = function () {
    if (this.saved) return;
    var G = this.G, b = G.machine.basic, p = G.player;
    this.saved = {
      voxels: G.world.data.slice(), pos: p.pos.clone(), yaw: p.yaw, pitch: p.pitch,
      flying: p.flying, program: b.listing(), sprites: b.sprites, putSaves: b.putSaves,
      vars: b.vars, svars: b.svars, arrays: b.arrays, fns: b.fns, mode3d: b.mode3d,
      ink: b.ink, paper: b.paper, bright: b.bright, mat: b.mat,
      fog: G.scene && G.scene.fog ? G.scene.fog.clone() : null
    };
  };

  GameBridge.prototype.requestLock = function () {
    var canvas = el('gl');
    if (!canvas || !canvas.requestPointerLock) return;
    try {
      var r = canvas.requestPointerLock();
      if (r && r.catch) r.catch(function () { /* Resume/click can retry. Arrow keys also aim. */ });
    } catch (e) { /* Browser may require another click. */ }
  };

  GameBridge.prototype.start = function () {
    var G = this.G, b = G.machine.basic;
    this.captureSandbox();
    if (this.hooks.leaveTerminal) this.hooks.leaveTerminal();
    G.started = true;
    hide('start', true); hide('hud', false);
    document.querySelectorAll('.modal').forEach(function (m) { m.classList.add('hidden'); });
    if (G.machine.stopEmulator) G.machine.stopEmulator();
    b.running = false; b.waiting = null; b.lines.length = 0; b.clearVars();
    b.sprites = {}; b.putSaves = {};
    var source = ZX.DOOM_SOURCE || (ZX.BUILTIN_PROGRAMS && ZX.BUILTIN_PROGRAMS.DOOM);
    if (!source) { this.exit(); throw new Error('The bundled DOOM BASIC listing is missing'); }
    source.split(/\r?\n/).forEach(function (line) { if (line.trim()) b.submit(line); });
    this.ports.fill(0); this.paused = false;
    this.shot = null; this.latched = null; this.useQueued = false; this.fireHeld = false;
    this.lastShot = -1000; this.turn = 0;
    this.setState(1);
    b.runDirect('RUN');
    this.requestLock();
  };

  GameBridge.prototype.setState = function (state) {
    var G = this.G, p = G.player;
    if (state === 0) { if (this.state) this.exit(); return; }
    if (!this.state) {
      this.captureSandbox();
      if (this.hooks.leaveTerminal) this.hooks.leaveTerminal();
      p.flying = false; p.pitch = 0;
      if (G.scene) {
        G.scene.fog = new THREE.FogExp2(0x100d19, 0.023);
        this.lamp = new THREE.PointLight(0xd1dfff, 0.65, 14);
        G.scene.add(this.lamp);
      }
      document.body.classList.add('doom-playing');
      hide('doom-hud', false);
    }
    this.state = state; this.ports[0] = state;
    p.gameMode = true; p.enabled = state === 2 && !this.paused;
    if (state !== 2) {
      p.keys = {}; p.vel.set(0, 0, 0);
      this.fireHeld = false; this.shot = null; this.latched = null; this.useQueued = false;
    }
    if (state === 1 || state === 2) {
      if (this.paused) this.showOverlay('SHIFT PAUSED', 'Resume the run, restart, or return to the BASIC sandbox.');
      else hide('doom-overlay', true);
    }
    if (state === 3 || state === 4) {
      this.paused = false;
      this.showOverlay(state === 3 ? 'SIGNAL LOST' : 'SECTORS SECURED',
        state === 3 ? 'The hostiles got you. Restart for another run.' : 'Three maps cleared. The shift network is yours.');
      if (document.exitPointerLock) document.exitPointerLock();
    }
  };

  GameBridge.prototype.peek = function (addr) {
    var i = addr - BASE;
    if (i < 0 || i >= 32) return undefined;
    if (i === 13) {
      this.latched = this.shot;
      this.shot = null;
      return this.latched ? 1 : 0;
    }
    if (i === 14) { var use = this.useQueued; this.useQueued = false; return use ? 1 : 0; }
    if (i >= 5 && i <= 9 && this.latched) return this.latched[i];
    if (i >= 1 && i <= 12) return this.live[i];
    return this.ports[i];
  };

  GameBridge.prototype.poke = function (addr, value) {
    var i = addr - BASE;
    if (i < 0 || i >= 32) return;
    value &= 255; this.ports[i] = value;
    if (i === 0) { this.setState(value); return; }
    if (i === 25) this.messageUntil = now() + (value === 1 ? 600000 : 2400);
    if (i === 26 && value) this.shotUntil = now() + 130;
    if (i === 27 && value) this.damageUntil = now() + 200;
    if (i === 28) {
      this.G.player.yaw = value / 256 * Math.PI * 2;
      this.G.player.pitch = 0;
    }
  };

  GameBridge.prototype.snapshot = function () {
    var G = this.G, p = G.player, w = G.world, a = this.live;
    a[1] = ZX.clamp(Math.floor(p.pos.x / PIX), 0, w.W - 1);
    a[2] = ZX.clamp(Math.floor(p.pos.y / PIX), 0, w.H - 1);
    a[3] = ZX.clamp(w.D - 1 - Math.floor(p.pos.z / PIX), 0, w.D - 1);
    a[4] = ((Math.round(p.yaw / (Math.PI * 2) * 256) % 256) + 256) % 256;
    p.forward(this.direction);
    var eye = p.eye - (p.keys.ctrl ? 0.45 : 0);
    var hit = w.raycast(p.pos.x, p.pos.y + eye, p.pos.z,
      this.direction.x, this.direction.y, this.direction.z, 40);
    a[8] = hit ? 1 : 0;
    a[5] = hit ? hit.x : 0; a[6] = hit ? hit.y : 0; a[7] = hit ? hit.z : 0;
    a[9] = hit ? Math.min(255, Math.round(hit.t / PIX)) : 255;
    a[10] = Math.round(this.direction.x * 127) + 128;
    a[11] = Math.round(this.direction.y * 127) + 128;
    a[12] = Math.round(-this.direction.z * 127) + 128;
  };

  GameBridge.prototype.fire = function () {
    if (this.state !== 2 || this.paused || this.shot || now() - this.lastShot < 220) return;
    this.snapshot();
    this.shot = this.live.slice(); this.lastShot = now();
  };
  GameBridge.prototype.use = function () { if (this.state === 2 && !this.paused) this.useQueued = true; };

  GameBridge.prototype.showOverlay = function (title, message) {
    text('doom-overlay-title', title); text('doom-overlay-text', message);
    hide('doom-resume', this.state !== 2 && this.state !== 1); hide('doom-overlay', false);
    var button = el(this.state === 2 || this.state === 1 ? 'doom-resume' : 'doom-restart');
    if (button && button.focus) button.focus();
  };
  GameBridge.prototype.pause = function () {
    if (!this.state || this.paused || this.state === 3 || this.state === 4) return;
    this.paused = true; this.G.player.enabled = false; this.G.player.keys = {};
    this.fireHeld = false; this.turn = 0; this.shot = null; this.useQueued = false;
    this.showOverlay('SHIFT PAUSED', 'Resume the run, restart, or return to the BASIC sandbox.');
  };
  GameBridge.prototype.resume = function () {
    if (this.state !== 2 && this.state !== 1) return;
    this.paused = false; this.G.player.enabled = this.state === 2;
    // PAUSE uses host time; start a new interval on resume rather than catching up.
    var b = this.G.machine.basic;
    if (b.waiting === 'pause') b.waitUntil = now() + 100;
    hide('doom-overlay', true); this.requestLock();
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  };
  GameBridge.prototype.onPointerLock = function (locked) {
    if (this.state === 2 && !locked) this.pause();
    if (locked && (this.state === 1 || this.state === 2)) {
      this.paused = false; this.G.player.enabled = this.state === 2; hide('doom-overlay', true);
    }
  };

  GameBridge.prototype.keyDown = function (e) {
    if (!this.state) return false;
    if (e.code === 'Escape') {
      this.pause(); if (document.exitPointerLock) document.exitPointerLock(); return true;
    }
    if (this.paused || this.state === 3 || this.state === 4) {
      return e.code !== 'Tab' && e.code !== 'Enter' && e.code !== 'Space';
    }
    if (this.state !== 2) return true;
    var k = this.G.player.keys;
    switch (e.code) {
      case 'KeyW': case 'ArrowUp': k.w = 1; break;
      case 'KeyS': case 'ArrowDown': k.s = 1; break;
      case 'KeyA': k.a = 1; break;
      case 'KeyD': k.d = 1; break;
      case 'ShiftLeft': case 'ShiftRight': k.shift = 1; break;
      case 'ControlLeft': case 'ControlRight': k.ctrl = 1; break;
      case 'Space': this.fireHeld = true; this.fire(); break;
      case 'KeyE': if (!e.repeat) this.use(); break;
      case 'ArrowLeft': this.turn = 1; break;
      case 'ArrowRight': this.turn = -1; break;
    }
    return true;
  };
  GameBridge.prototype.keyUp = function (e) {
    if (!this.state) return false;
    var k = this.G.player.keys;
    switch (e.code) {
      case 'KeyW': case 'ArrowUp': k.w = 0; break;
      case 'KeyS': case 'ArrowDown': k.s = 0; break;
      case 'KeyA': k.a = 0; break;
      case 'KeyD': k.d = 0; break;
      case 'ShiftLeft': case 'ShiftRight': k.shift = 0; break;
      case 'ControlLeft': case 'ControlRight': k.ctrl = 0; break;
      case 'Space': this.fireHeld = false; break;
      case 'ArrowLeft': case 'ArrowRight': this.turn = 0; break;
    }
    return true;
  };

  GameBridge.prototype.beforeFrame = function (dt) {
    if (!this.state) return true;
    this.G.player.enabled = this.state === 2 && !this.paused;
    if (this.state === 2 && !this.paused) {
      this.G.player.yaw += this.turn * dt * 1.8;
      if (this.fireHeld) this.fire();
    }
    return !this.paused && this.state !== 3 && this.state !== 4;
  };

  GameBridge.prototype.afterFrame = function () {
    if (!this.state) return;
    var p = this.ports, time = now();
    text('doom-health', p[20]); text('doom-ammo', p[21]); text('doom-level', p[22] || 1);
    text('doom-name', NAMES[p[22]] || 'VOID SHIFT');
    text('doom-kills', p[23]); text('doom-total', p[24]);
    text('doom-message', MESSAGES[time < this.messageUntil ? p[25] : 0] || MESSAGES[0]);
    var weapon = el('doom-weapon'); if (weapon) weapon.classList.toggle('firing', time < this.shotUntil);
    var hud = el('doom-hud'); if (hud) hud.classList.toggle('low-health', p[20] < 25);
    var flash = el('doom-flash');
    if (flash) { flash.classList.toggle('damage', time < this.damageUntil); flash.classList.toggle('warp', this.state === 1); }
    if (this.lamp) this.lamp.position.copy(this.G.camera.position);
    if (this.state === 2 && !this.paused && !this.G.machine.basic.running && !this.G.machine.basic.waiting) {
      this.pause();
      this.showOverlay('BASIC STOPPED', this.G.machine.basic.lastReport || 'The program stopped. Restart to run it again.');
    }
  };

  GameBridge.prototype.exit = function () {
    var G = this.G, b = G.machine.basic, saved = this.saved;
    b.running = false; b.waiting = null; b.contPc = null;
    this.state = 0; this.ports[0] = 0; this.paused = false;
    this.shot = null; this.latched = null; this.useQueued = false; this.fireHeld = false;
    this.turn = 0; this.G.player.gameMode = false; this.G.player.enabled = true; this.G.player.keys = {};
    document.body.classList.remove('doom-playing'); hide('doom-hud', true); hide('doom-overlay', true);
    if (this.lamp && G.scene) G.scene.remove(this.lamp); this.lamp = null;
    if (saved) {
      G.world.data.set(saved.voxels);
      for (var ci = 0; ci < G.world.nchunks; ci++) { G.world.recount(ci); G.world.markDirty(ci); }
      G.player.teleport(saved.pos.x, saved.pos.y, saved.pos.z);
      G.player.yaw = saved.yaw; G.player.pitch = saved.pitch; G.player.flying = saved.flying;
      b.lines.length = 0;
      saved.program.forEach(function (line) { b.submit(line); });
      ['sprites', 'putSaves', 'vars', 'svars', 'arrays', 'fns', 'mode3d', 'ink', 'paper', 'bright', 'mat'].forEach(function (k) { b[k] = saved[k]; });
      if (G.scene) G.scene.fog = saved.fog;
    }
    this.saved = null;
    this.requestLock();
  };
})(window.ZX = window.ZX || {});
