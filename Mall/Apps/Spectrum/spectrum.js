/* ============================================================
   Spectrum · spectrum.js
   One desk terminal: the ZX Spectrum 3D machine's monitor and
   +2 keyboard, a native ZX BASIC session drawn on a no-clash
   screen, and a Z80 machine for real software.

   The plaza only ever talks to this file.
   ============================================================ */
import * as THREE from 'three';
import { Raster, Screen } from './display.js';
import { Basic, naturalTokenise, listText } from './basic.js';
import { Machine, MODELS } from './machine.js';
import { createZ80 } from './z80.js';
import { Keyboard3D, KeyboardAtlas, KEYBOARD_W, KEYBOARD_D } from './keyboard.js';
import { Sound } from './audio.js';
import { KEYCAPS, CAP_BY_ID, capLegend } from './tokens.js';
import { DEMOS } from './demos.js';

export { listText, MODELS };

/* ------------------------------------------------------------
   1. How much machine this browser can be
   ------------------------------------------------------------ */
/* `budget` is BASIC statements per 50Hz frame at the Fast setting, which
   is what the terminals run at. Authentic is ten, because that is roughly
   what a real 48K managed — an empty FOR/NEXT to 1000 took it four and a
   half seconds. Turbo is ten times Fast, which is where a wireframe
   rotator stops being a slideshow. */
export const PROFILES = {
  '16k': { id: '16k', label: 'ZX Spectrum 16K', model: '16k', basicRam: 9216, budget: 160, note: 'a small machine, for a small device' },
  '48k': { id: '48k', label: 'ZX Spectrum 48K', model: '48k', basicRam: 41472, budget: 400, note: 'the classic' },
  '128k': { id: '128k', label: 'ZX Spectrum 128K', model: '128k', basicRam: 41472, budget: 700, note: '128K, with the AY' },
  'plus2': { id: 'plus2', label: 'ZX Spectrum +2', model: 'plus2', basicRam: 41472, budget: 900, note: '128K and a tape deck' },
  'nx': { id: 'nx', label: 'NX 1024', model: 'plus2', basicRam: 917504, budget: 2600, note: 'a Spectrum with the brakes off — 1024K and a fast BASIC' }
};

export function detectProfile() {
  const gb = navigator.deviceMemory || 0;
  const cores = navigator.hardwareConcurrency || 2;
  const coarse = window.matchMedia('(pointer:coarse)').matches;
  const small = window.innerWidth < 820;
  let id;
  if ((gb && gb <= 1) || (coarse && cores <= 2) || small) id = '16k';
  else if ((gb && gb <= 2) || cores <= 3) id = '48k';
  else if (gb >= 8 && cores >= 8 && !coarse) id = 'nx';
  else if (gb >= 4 && cores >= 4) id = 'plus2';
  else id = '128k';
  return PROFILES[id];
}
export function formatBytes(n) {
  return n >= 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + 'M' : n >= 1024 ? Math.round(n / 1024) + 'K' : n + 'B';
}

/* ------------------------------------------------------------
   2. The desk, as ZX Spectrum 3D lays it out
   ------------------------------------------------------------ */
/* Full-size metres, measured up from the desk surface and out from the
   centre of the desk towards the typist. The monitor is exactly as wide
   as the keyboard; the board is raked back so its caps face you; and the
   seat is where the whole CRT fills the top half of the view and the
   whole board the bottom half. A Terminal is built at `scale` of all of
   it, so from the seat a desk looks just as the 3D machine does. */
export const LAYOUT = {
  console: { y: 0.12, z: 0.20, rake: 0.30, caseH: 0.20, marginW: 0.14, marginD: 0.16 },
  monitor: { y: 0.06, z: -0.35, lean: -0.13 },
  seat: { y: 0.86, z: 1.41 },
  look: { y: 0.58, z: 0.06 },
  fov: 72
};

/* ------------------------------------------------------------
   3. Shared bits — one keyboard atlas and one audio context
      serve every desk, because only one is ever being typed on
   ------------------------------------------------------------ */
let sharedAtlas = null, sharedSound = null;
function atlas() { return (sharedAtlas = sharedAtlas || new KeyboardAtlas()); }
export function sound() { return (sharedSound = sharedSound || new Sound()); }

/* localStorage, standing in for a cassette */
const STORE_PREFIX = 'xeno_spectrum_prog_';
const storage = {
  save(name, body) { try { localStorage.setItem(STORE_PREFIX + name.toLowerCase(), body); } catch (e) { } },
  load(name) { try { return localStorage.getItem(STORE_PREFIX + name.toLowerCase()); } catch (e) { return null; } },
  list() {
    const out = [];
    try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(STORE_PREFIX)) out.push(k.slice(STORE_PREFIX.length)); } } catch (e) { }
    return out.sort();
  }
};

/* ------------------------------------------------------------
   4. A PC keyboard, mapped onto a Spectrum one
   ------------------------------------------------------------ */
const PC_TO_CAP = {
  Enter: 'ENTER', NumpadEnter: 'ENTER', Space: 'SPACE', Backspace: 'DELETE', Delete: 'DELETE',
  ArrowLeft: 'LEFT', ArrowRight: 'RIGHT', ArrowUp: 'UP', ArrowDown: 'DOWN',
  ShiftLeft: 'CAPS', ShiftRight: 'CAPS2', ControlLeft: 'SYM', ControlRight: 'SYM',
  AltLeft: 'SYM', AltRight: 'EXTEND', CapsLock: 'CAPSLOCK', Tab: 'EXTEND',
  Semicolon: 'SEMI', Quote: 'QUOTE', Comma: 'COMMA', Period: 'STOP'
};
function capForEvent(e) {
  if (PC_TO_CAP[e.code]) return PC_TO_CAP[e.code];
  if (/^Key[A-Z]$/.test(e.code)) return e.code.slice(3);
  if (/^Digit[0-9]$/.test(e.code)) return e.code.slice(5);
  if (/^Numpad[0-9]$/.test(e.code)) return e.code.slice(6);
  return null;
}
/* typing a character straight in: which cap lights up for it */
function capForChar(ch) {
  const u = ch.toUpperCase();
  if (/^[A-Z0-9]$/.test(u)) return u;
  if (ch === ' ') return 'SPACE';
  if (ch === ';') return 'SEMI';
  if (ch === '"') return 'QUOTE';
  if (ch === ',') return 'COMMA';
  if (ch === '.') return 'STOP';
  for (const cap of KEYCAPS) if (cap.sym === ch) return cap.id;
  return null;
}

/* ------------------------------------------------------------
   5. The terminal
   ------------------------------------------------------------ */
export class Terminal {
  constructor(opts = {}) {
    this.profile = opts.profile || detectProfile();
    this.sound = opts.sound || sound();
    this.speed = opts.speed || 'fast';        // authentic | fast | turbo
    this.inputMode = opts.inputMode || 'natural';   // natural | spectrum
    this.label = opts.label || 'NX Dev';
    this.onStatus = opts.onStatus || null;
    this.scale = opts.scale || 0.4;
    this.fov = LAYOUT.fov;

    /* the native BASIC side: its own 64K, so PEEK and POKE mean something */
    this.mem = new Uint8Array(65536);
    this.screen = new Screen(this.mem, 0x4000);
    this.raster = new Raster();
    this.basic = new Basic(this.screen, {
      sound: this.sound,
      ramLimit: this.profile.basicRam,
      machineName: this.profile.label,
      stepBudget: this.budget(),
      storage
    });
    /* machine code POKEd into the BASIC session really does run */
    this.usrZ80 = null;
    this.basic.usrHook = addr => this.runUsr(addr);
    this.basic.portIn = () => 255;
    this.basic.naturalMode = (this.inputMode === 'natural');

    /* the emulated machine, idle until a ROM turns up */
    this.machine = new Machine({ model: this.profile.model, sound: this.sound });
    this.mode = 'basic';
    this.romTried = false;

    this.surfaceY = 0;
    this.buildMonitor();
    this.buildConsole();
    /* 57 keycaps per desk is a lot of geometry to carry around a mall, so
       the keys are only put on a board when somebody walks up to it, and
       then kept. The case is there from the start. */
    this.keyboard = null;
    if (!opts.deferKeyboard) this.ensureKeyboard();

    this.caps = false; this.sym = false;
    this.held = new Set();
    this.flashPhase = 0;
    this.frameAcc = 0;
    this.renderAcc = 0;
    this.focused = false;
    this.near = false;
    this.status = '';
    this.tapeName = '';

    this.boot();
  }
  budget() {
    const b = this.profile.budget;
    return this.speed === 'authentic' ? 10 : this.speed === 'turbo' ? b * 10 : b;
  }
  ensureKeyboard() {
    if (this.keyboard) return this.keyboard;
    this.keyboard = new Keyboard3D({ atlas: atlas(), scale: this.scale });
    this.console.add(this.keyboard.group);
    this.syncKeyboard();
    return this.keyboard;
  }

  /* --- the desk ------------------------------------------------ */
  buildMonitor() {
    const s = this.scale;
    const w = KEYBOARD_W * s, h = w * 0.75;
    const g = new THREE.Group();
    const caseMat = new THREE.MeshStandardMaterial({ color: 0x1c1c22, roughness: .6, metalness: .12 });
    const box = (bw, bh, bd, x, y, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), caseMat);
      m.position.set(x, y, z);
      m.castShadow = true; m.receiveShadow = true;
      g.add(m);
      return m;
    };
    /* bezel, and a foot that reaches down to the desk */
    box(w + .12 * s, h + .14 * s, .14 * s, 0, h / 2 + .12 * s, -.06 * s);
    box(.34 * s, .16 * s, .26 * s, 0, -.01 * s, -.02 * s);

    this.screenTex = new THREE.CanvasTexture(this.raster.canvas);
    this.screenTex.colorSpace = THREE.SRGBColorSpace;
    this.screenTex.magFilter = THREE.NearestFilter;
    this.screenTex.minFilter = THREE.LinearFilter;
    this.screenTex.generateMipmaps = false;
    this.screenMat = new THREE.MeshBasicMaterial({ map: this.screenTex, toneMapped: false });
    this.screenMesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), this.screenMat);
    this.screenMesh.position.set(0, h / 2 + .12 * s, .012 * s);
    g.add(this.screenMesh);
    /* the glow that makes a CRT look switched on */
    this.glow = new THREE.Mesh(new THREE.PlaneGeometry(w * 1.3, h * 1.35),
      new THREE.MeshBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: .06, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    this.glow.position.set(0, h / 2 + .12 * s, .03 * s);
    g.add(this.glow);

    this.monitor = g;
  }
  buildConsole() {
    const s = this.scale, C = LAYOUT.console;
    const g = new THREE.Group();
    const caseW = (KEYBOARD_W + C.marginW) * s, caseD = (KEYBOARD_D + C.marginD) * s;
    this.caseMesh = new THREE.Mesh(new THREE.BoxGeometry(caseW, C.caseH * s, caseD),
      new THREE.MeshStandardMaterial({ color: 0x1c1c22, roughness: .62, metalness: .12 }));
    this.caseMesh.position.y = -C.caseH * s / 2;
    this.caseMesh.castShadow = true; this.caseMesh.receiveShadow = true;
    g.add(this.caseMesh);
    this.console = g;
  }
  /* Put the monitor and the board on a desk. `parent` is the desk's own
     frame — x across, z towards the typist — and surfaceY its top. */
  mount(parent, surfaceY) {
    const s = this.scale;
    this.surfaceY = surfaceY;
    this.monitor.position.set(0, surfaceY + LAYOUT.monitor.y * s, LAYOUT.monitor.z * s);
    this.monitor.rotation.x = LAYOUT.monitor.lean;
    this.console.position.set(0, surfaceY + LAYOUT.console.y * s, LAYOUT.console.z * s);
    this.console.rotation.x = LAYOUT.console.rake;
    parent.add(this.monitor, this.console);
  }
  /* where the typist's eye goes, and what it looks at, in the desk's frame */
  seatPoint(out) { return out.set(0, this.surfaceY + LAYOUT.seat.y * this.scale, LAYOUT.seat.z * this.scale); }
  lookPoint(out) { return out.set(0, this.surfaceY + LAYOUT.look.y * this.scale, LAYOUT.look.z * this.scale); }

  /* --- boot --------------------------------------------------- */
  boot() {
    const s = this.screen;
    s.reset();
    s.border = 7;
    s.ink = 0; s.paper = 7;
    s.printString(this.label + ' Terminal');
    s.newline();
    s.printString(this.profile.label);
    s.newline(); s.newline();
    s.printString(this.basic.free() + ' bytes free');
    s.newline(); s.newline();
    s.ink = 1;
    s.printString('16 colours a pixel, no clash.');
    s.newline();
    s.printString('ZX BASIC. Type and press ENTER.');
    s.newline();
    s.ink = 0;
    this.basic.editReset();
    this.basic.renderInput();
    this.raster.drawScreen(s, false);
    this.screenTex.needsUpdate = true;
  }

  setProfile(p) {
    this.profile = typeof p === 'string' ? (PROFILES[p] || this.profile) : p;
    this.basic.ramLimit = this.profile.basicRam;
    this.basic.machineName = this.profile.label;
    this.basic.stepBudget = this.budget();
    if (this.machine.model !== this.profile.model) this.machine.setModel(this.profile.model);
    this.say(this.profile.label + ' · ' + formatBytes(this.profile.basicRam) + ' for BASIC');
  }
  setSpeed(s) { this.speed = s; this.basic.stepBudget = this.budget(); this.say('Speed: ' + s); }
  setInputMode(m) {
    this.inputMode = m;
    this.basic.naturalMode = (m === 'natural');
    this.basic.refreshMode();
    this.afterEdit();
    this.say(m === 'natural' ? 'Type normally — keywords are recognised on ENTER' : 'Spectrum keys — one key, one keyword');
  }
  say(msg) { this.status = msg; if (this.onStatus) this.onStatus(msg); }

  /* --- USR, for machine code poked into the BASIC session ------
     A Z80 sharing the session's own 64K. There is no ROM behind it, so
     a routine has to come back with RET; it returns to a marker address
     the loop watches for, and BC is the answer, exactly as on a real
     machine. A runaway routine is cut off rather than hanging the page. */
  runUsr(addr) {
    const m = this.mem;
    if (!this.usrZ80) {
      this.usrZ80 = createZ80({
        read: a => m[a & 0xffff],
        write: (a, v) => { m[a & 0xffff] = v & 255; },
        readPort: () => 255,
        writePort: () => { }
      });
    }
    /* whatever the routine writes into the display file is shown after */
    const before = m.slice(0x4000, 0x5b00);
    const cpu = this.usrZ80, z = cpu.state;
    const RET_MARK = 0xfffe;
    z.pc = addr & 0xffff;
    z.sp = 0xff00;
    m[0xff00] = RET_MARK & 255; m[0xff01] = (RET_MARK >> 8) & 255;
    z.iff1 = z.iff2 = 0; z.halted = false; z.t = 0;
    let guard = 2000000;
    while (z.pc !== RET_MARK && !z.halted && guard-- > 0) cpu.step();
    for (let i = 0; i < before.length; i++) if (before[i] !== m[0x4000 + i]) this.screen.syncFromMem(0x4000 + i);
    return cpu.BC;
  }

  /* --- ROMs and files ----------------------------------------- */
  async tryRoms(baseUrl) {
    if (this.romTried) return this.machine.hasRom;
    this.romTried = true;
    const cached = loadCachedRom();
    if (cached) { this.applyRom(cached, 'cached'); return true; }
    for (const [file, slot] of [['48.rom', 0], ['128.rom', -1]]) {
      try {
        const r = await fetch(baseUrl + file, { cache: 'force-cache' });
        if (!r.ok) continue;
        const b = new Uint8Array(await r.arrayBuffer());
        if (slot === -1) { this.machine.setRom(b, 0); this.machine.setRom(b.subarray(16384), 1); }
        else this.applyRom(b, file);
      } catch (e) { }
    }
    return this.machine.hasRom;
  }
  applyRom(bytes, name) {
    if (!this.machine.setRom(bytes)) return false;
    this.machine.romName = name || 'rom';
    const f = this.machine.romFont();
    if (f) this.screen.romFont = f;
    cacheRom(bytes);
    return true;
  }
  /* the one entry point for anything dropped on a terminal */
  loadFile(name, buffer) {
    const bytes = new Uint8Array(buffer);
    const kind = Machine.kindOf(name, bytes);
    if (kind === 'bas') {
      const text = new TextDecoder().decode(bytes);
      this.loadBasicText(text);
      this.say('Loaded ' + name + ' into BASIC');
      return 'bas';
    }
    if (kind === 'rom') {
      if (!this.applyRom(bytes, name)) { this.say('That ROM is the wrong size'); return ''; }
      this.say('ROM loaded — real Spectrum software will run now');
      return 'rom';
    }
    if (!this.machine.hasRom) {
      this.say('Drop a 48.rom in first — real software needs the Sinclair ROM');
      return '';
    }
    const got = this.machine.load(name, bytes);
    if (!got) { this.say('Could not read ' + name); return ''; }
    this.enterMachineMode();
    if (got === 'tape') {
      this.tapeName = name;
      this.machine.autoLoad();
      this.say('Loading ' + name + '…');
    } else {
      this.say(name + ' running');
    }
    return got;
  }
  loadBasicText(text) {
    this.basic.reset(true);
    this.screen.reset();
    const lines = text.replace(/\r/g, '').split('\n');
    for (const raw of lines) {
      const m = /^\s*(\d+)\s?(.*)$/.exec(raw);
      if (!m) continue;
      try { this.basic.storeLine(+m[1], naturalTokenise(m[2])); } catch (e) { }
    }
    this.basic.editCursorLine = 0;
    this.basic.editReset();
    this.mode = 'basic';
    this.basic.renderListing();
    this.basic.renderInput();
  }
  enterMachineMode() {
    this.mode = 'machine';
    this.machine.clearKeys();
    this.sound.startStream();
    this.syncKeyboard();
  }
  enterBasicMode() {
    this.mode = 'basic';
    this.sound.stopStream();
    this.machine.clearKeys();
    this.basic.editReset();
    this.basic.renderInput();
    this.syncKeyboard();
    this.say('Back to the BASIC session');
  }
  resetMachine() {
    if (this.mode === 'machine') { this.machine.reset(); this.say('Machine reset'); }
    else { this.basic.reset(true); this.screen.reset(); this.boot(); this.say('NEW'); }
  }
  /* the toolbar's RUN and LIST: typed as a direct command */
  command(text) {
    if (this.mode !== 'basic') return false;
    const b = this.basic;
    if (b.state !== 'idle') return false;
    this.flashCap(capForChar(text[0]));
    b.execDirect(naturalTokenise(text));
    this.afterEdit();
    return true;
  }
  exportTap(name = 'program') {
    if (this.mode !== 'basic' || !this.basic.prog.length) return null;
    const program = [];
    for (const line of this.basic.prog) {
      const body = Array.from(line.txt, ch => ch.charCodeAt(0));
      body.push(13);
      program.push((line.n >> 8) & 255, line.n & 255, body.length & 255, (body.length >> 8) & 255, ...body);
    }
    const data = new Uint8Array(program);
    const header = new Uint8Array(17);
    header[0] = 0;
    const title = String(name).toUpperCase().slice(0, 10);
    for (let i = 0; i < 10; i++) header[1 + i] = i < title.length ? title.charCodeAt(i) : 32;
    header[11] = 17; header[12] = 0;
    header[13] = 0x00; header[14] = 0x80;
    header[15] = data.length & 255; header[16] = data.length >> 8;
    const block = bytes => {
      const out = new Uint8Array(bytes.length + 3);
      out[0] = (bytes.length + 1) & 255; out[1] = (bytes.length + 1) >> 8;
      out.set(bytes, 2);
      let checksum = 0;
      for (const byte of bytes) checksum ^= byte;
      out[out.length - 1] = checksum;
      return out;
    };
    const headerBlock = block(Uint8Array.of(0, ...header));
    const dataBlock = block(Uint8Array.of(255, ...data));
    const tap = new Uint8Array(headerBlock.length + dataBlock.length);
    tap.set(headerBlock); tap.set(dataBlock, headerBlock.length);
    return tap;
  }
  breakKey() {
    if (this.mode === 'machine') { this.clickCap('BREAK'); return; }
    this.flashCap('BREAK');
    this.basic.breakIn();
    this.afterEdit();
  }

  /* --- keys ---------------------------------------------------- */
  shiftState() { return { caps: this.caps, sym: this.sym }; }
  /* what the caps should say right now */
  legendState() {
    const b = this.basic;
    if (this.mode === 'machine') return { mode: 'L', caps: this.caps, sym: this.sym, capsLock: false };
    const mode = (b.mode === 'K' || b.mode === 'E' || b.mode === 'G') ? b.mode : (b.capsLock ? 'C' : 'L');
    return { mode, caps: this.caps, sym: this.sym, capsLock: b.capsLock, natural: this.inputMode === 'natural' };
  }
  syncKeyboard() { atlas().set(this.legendState()); }
  /* the NEXT readout: what a cap would type if it were pressed now */
  preview(capId) {
    const cap = CAP_BY_ID[capId];
    if (!cap) return '';
    const l = capLegend(cap, this.legendState());
    return l.text === ' ' ? 'SPACE' : l.text;
  }
  /* A cap held down — from the PC keyboard in Spectrum-keys mode, or
     while a real program is running. */
  capDown(capId) {
    const cap = CAP_BY_ID[capId];
    if (!cap) return;
    if (capId === 'CAPS' || capId === 'CAPS2') this.caps = true;
    if (capId === 'SYM') this.sym = true;
    this.held.add(capId);
    if (this.keyboard) this.keyboard.press(capId);
    if (this.mode === 'machine') {
      for (const k of cap.keys) this.machine.keyDown(k);
      this.syncKeyboard();
      return;
    }
    this.basic.pressCap(capId, this.shiftState(), this.inputMode === 'natural');
    this.afterEdit();
  }
  capUp(capId) {
    const cap = CAP_BY_ID[capId];
    if (!cap) return;
    if (capId === 'CAPS' || capId === 'CAPS2') this.caps = false;
    if (capId === 'SYM') this.sym = false;
    this.held.delete(capId);
    if (this.keyboard) this.keyboard.release(capId);
    if (this.mode === 'machine') {
      for (const k of cap.keys) {
        /* a shift is only lifted when nothing else still wants it */
        if ((k === 'CAPS' || k === 'SYM') && this.stillHolding(k)) continue;
        this.machine.keyUp(k);
      }
    } else if (!this.held.size) this.basic.inkey = '';
    this.syncKeyboard();
  }
  stillHolding(matrixKey) {
    for (const id of this.held) {
      const c = CAP_BY_ID[id];
      if (c && c.keys.includes(matrixKey)) return true;
    }
    if (matrixKey === 'CAPS' && this.caps) return true;
    if (matrixKey === 'SYM' && this.sym) return true;
    return false;
  }
  /* A cap clicked with the pointer, the way ZX Spectrum 3D does it: the
     shifts latch on and off, and any other key fires with whatever is
     latched and then lets the shifts go. */
  clickCap(capId) {
    const cap = CAP_BY_ID[capId];
    if (!cap) return;
    if (this.keyboard) this.keyboard.bump(capId, 140);
    if (capId === 'CAPS' || capId === 'SYM') {
      const on = capId === 'CAPS' ? (this.caps = !this.caps) : (this.sym = !this.sym);
      if (this.mode === 'machine') { if (on) this.machine.keyDown(capId); else if (!this.stillHolding(capId)) this.machine.keyUp(capId); }
      this.syncKeyboard();
      return;
    }
    if (this.mode === 'machine') {
      /* a real program polls the matrix, so the key stays down a few frames */
      for (const k of cap.keys) this.machine.keyDown(k);
      const latched = { caps: this.caps, sym: this.sym };
      this.caps = this.sym = false;
      setTimeout(() => {
        const up = new Set(cap.keys);
        if (latched.caps) up.add('CAPS');
        if (latched.sym) up.add('SYM');
        for (const k of up) if (!this.stillHolding(k)) this.machine.keyUp(k);
      }, 140);
      this.syncKeyboard();
      return;
    }
    this.basic.pressCap(capId, this.shiftState(), this.inputMode === 'natural');
    setTimeout(() => { if (!this.held.size) this.basic.inkey = ''; }, 140);
    this.caps = this.sym = false;
    this.afterEdit();
  }
  releaseAll() {
    for (const id of Array.from(this.held)) this.capUp(id);
    if (this.keyboard) this.keyboard.releaseAll();
    this.machine.clearKeys();
    this.caps = this.sym = false;
    this.syncKeyboard();
  }
  afterEdit() {
    if (this.mode !== 'basic') return;
    if (this.basic.state === 'idle' || this.basic.state === 'input') this.basic.renderInput();
    this.syncKeyboard();
  }

  /* A real keydown from the page. Returns true if it was consumed. */
  pcKeyDown(e) {
    /* F2 swaps the two ways of typing, as it does on the 3D machine */
    if (e.code === 'F2') {
      this.setInputMode(this.inputMode === 'natural' ? 'spectrum' : 'natural');
      return true;
    }
    if (this.mode === 'machine' || this.inputMode === 'spectrum') {
      const cap = capForEvent(e);
      if (!cap) return false;
      /* shift and control are the Spectrum's two shifts here */
      if (!e.repeat || !/^(CAPS|CAPS2|SYM)$/.test(cap)) this.capDown(cap);
      return true;
    }
    const b = this.basic;
    const cap = capForEvent(e);
    /* The shifts drive the live caps whichever way you are typing, so you
       can always read what a key is about to do. */
    if (cap === 'CAPS' || cap === 'CAPS2' || cap === 'SYM') {
      if (cap === 'SYM') this.sym = true; else this.caps = true;
      if (this.keyboard) this.keyboard.press(cap);
      this.syncKeyboard();
      return cap === 'SYM';
    }
    /* while a program runs, the keyboard only feeds INKEY$ */
    if (b.state === 'run' || b.state === 'pause') {
      if (e.key === ' ' && e.shiftKey) { this.flashCap('BREAK'); b.breakIn(); this.afterEdit(); return true; }
      if (e.key === 'Enter') { b.inkey = '\r'; this.flashCap('ENTER'); return true; }
      if (e.key.length === 1) { b.inkey = e.key; this.flashCap(capForChar(e.key)); return true; }
      return false;
    }
    /* EXTEND, and a letter or digit under SYMBOL SHIFT, EXTEND or GRAPHICS,
       type exactly what the cap says */
    if (cap === 'EXTEND') { this.flashCap(cap); b.pressCap(cap, this.shiftState(), true); this.afterEdit(); return true; }
    if (cap && /^[A-Z0-9]$/.test(cap) && (this.sym || b.mode === 'E' || b.mode === 'G')) {
      this.flashCap(cap);
      b.pressCap(cap, this.shiftState(), true);
      this.afterEdit();
      return true;
    }
    /* natural typing: the characters go straight in */
    if (e.key === 'Enter') { this.flashCap('ENTER'); b.enter(true); this.afterEdit(); return true; }
    if (e.key === 'Backspace') { this.flashCap('DELETE'); b.backspace(); this.afterEdit(); return true; }
    if (e.key === 'ArrowLeft') { this.flashCap('LEFT'); b.moveCursor(-1); this.afterEdit(); return true; }
    if (e.key === 'ArrowRight') { this.flashCap('RIGHT'); b.moveCursor(1); this.afterEdit(); return true; }
    if (e.key === 'ArrowUp') { this.flashCap('UP'); b.recallLine(-1); this.afterEdit(); return true; }
    if (e.key === 'ArrowDown') { this.flashCap('DOWN'); b.recallLine(1); this.afterEdit(); return true; }
    if (e.key === 'Delete') { this.flashCap('DELETE'); b.moveCursor(1); b.backspace(); this.afterEdit(); return true; }
    if (e.key === 'CapsLock') { this.flashCap('CAPSLOCK'); b.pressCap('CAPSLOCK', this.shiftState(), true); this.afterEdit(); return true; }
    if (e.key === ' ' && e.shiftKey) { this.flashCap('BREAK'); b.breakIn(); this.afterEdit(); return true; }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      b.typeChar(e.key);
      this.flashCap(capForChar(e.key));
      this.afterEdit();
      return true;
    }
    return false;
  }
  pcKeyUp(e) {
    if (this.mode === 'machine' || this.inputMode === 'spectrum') {
      const cap = capForEvent(e);
      if (cap) { this.capUp(cap); return true; }
      return false;
    }
    const cap = capForEvent(e);
    if (cap === 'CAPS' || cap === 'CAPS2' || cap === 'SYM') {
      if (cap === 'SYM') this.sym = false; else this.caps = false;
      if (this.keyboard) this.keyboard.release(cap);
      this.syncKeyboard();
      return true;
    }
    if (e.key.length === 1) this.basic.inkey = '';
    return false;
  }
  /* light a cap for a moment, so natural typing still shows on the board */
  flashCap(capId) {
    if (capId && this.keyboard) this.keyboard.bump(capId);
  }

  /* --- per frame ------------------------------------------------ */
  update(dt, ctx) {
    const focused = !!(ctx && ctx.focused);
    const near = !!(ctx && ctx.near);
    this.focused = focused; this.near = near;
    if (!focused && !near) return;                 // a far desk is frozen
    if (this.keyboard) this.keyboard.update(performance.now());

    const hz = focused ? 50 : 12.5;
    this.frameAcc += dt;
    const period = 1 / hz;
    let steps = 0;
    while (this.frameAcc >= period && steps < 4) {
      this.frameAcc -= period; steps++;
      this.tickFrame(focused ? 1 : 4);
    }

    this.renderAcc += dt;
    const rhz = focused ? 25 : 6;
    if (this.renderAcc >= 1 / rhz) {
      this.renderAcc = 0;
      this.paint();
    }
  }
  tickFrame(mult) {
    this.flashPhase = (this.flashPhase + mult) % 32;
    if (this.mode === 'machine') {
      for (let i = 0; i < mult; i++) if (!this.machine.frame()) { this.mode = 'basic'; break; }
      return;
    }
    /* When a program stops, the report it left on the bottom line stays
       there. Typing anything replaces it with the edit line, which is how
       the real machine behaves — so nothing is redrawn here. */
    const was = this.basic.state;
    this.basic.frame(this.budget() * mult);
    if (was !== this.basic.state) this.syncKeyboard();
  }
  paint() {
    if (this.mode === 'machine' && this.machine.hasRom) {
      this.raster.draw(this.machine.screenRam, 0, this.machine.border, this.flashPhase >= 16);
    } else {
      this.raster.drawScreen(this.screen, this.flashPhase >= 16);
    }
    this.screenTex.needsUpdate = true;
  }

  /* --- pointer over the keyboard -------------------------------- */
  hover(raycaster) {
    if (!this.keyboard) return null;
    const id = this.keyboard.hit(raycaster);
    this.keyboard.setHover(id);
    return id;
  }
  clearHover() { if (this.keyboard) this.keyboard.setHover(null); }

  /* --- readouts for the panel ----------------------------------- */
  info() {
    const l = this.legendState();
    return {
      profile: this.profile.label,
      free: this.mode === 'basic' ? this.basic.free() : null,
      mode: this.mode,
      rom: this.machine.hasRom ? (this.machine.romName || 'loaded') : '',
      tape: this.tapeName,
      speed: this.speed,
      input: this.inputMode,
      cursor: this.basic.cursorMode(),
      state: this.basic.state,
      caps: this.caps, sym: this.sym, ext: l.mode === 'E', graph: l.mode === 'G'
    };
  }
  dispose() {
    if (this.keyboard) this.keyboard.dispose();
    this.screenTex.dispose();
    this.sound.stopStream();
  }
}

/* the ROM a visitor supplies is kept so the next visit starts loaded */
const ROM_KEY = 'xeno_spectrum_rom48';
function cacheRom(bytes) {
  try {
    let s = '';
    const b = new Uint8Array(bytes);
    for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    localStorage.setItem(ROM_KEY, btoa(s));
  } catch (e) { }
}
function loadCachedRom() {
  try {
    const s = localStorage.getItem(ROM_KEY);
    if (!s) return null;
    const raw = atob(s);
    const b = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) b[i] = raw.charCodeAt(i);
    return b;
  } catch (e) { return null; }
}


export { Machine, Basic, naturalTokenise, DEMOS };
