/* ============================================================
   Spectrum · machine.js
   The hardware around the CPU: paged memory, the ULA, the
   keyboard matrix, the beeper, the AY, and the tape and snapshot
   formats real Spectrum software arrives in.

   No ROM image ships with the plaza — Sinclair's ROM is not ours
   to hand out. Drop 48.rom (and 128.rom for a 128K) beside this
   file, or load one from the terminal's own panel, and the
   emulator switches itself on. Until then the desks run the
   native BASIC session, which needs no ROM at all.
   ============================================================ */
import { createZ80 } from './z80.js';
import { AY, SAMPLE_RATE } from './audio.js';
import { MATRIX_POS } from './tokens.js';

export const MODELS = {
  '16k': { name: 'ZX Spectrum 16K', ram: 16, ts: 69888, ay: false, rom: 1 },
  '48k': { name: 'ZX Spectrum 48K', ram: 48, ts: 69888, ay: false, rom: 1 },
  '128k': { name: 'ZX Spectrum 128K', ram: 128, ts: 70908, ay: true, rom: 2 },
  'plus2': { name: 'ZX Spectrum +2', ram: 128, ts: 70908, ay: true, rom: 2 }
};

const FRAME_SAMPLES = Math.round(SAMPLE_RATE / 50);

export class Machine {
  constructor(opts = {}) {
    this.sound = opts.sound || null;
    this.model = opts.model && MODELS[opts.model] ? opts.model : '48k';
    this.ram = []; for (let i = 0; i < 8; i++) this.ram.push(new Uint8Array(16384));
    this.roms = [new Uint8Array(16384), new Uint8Array(16384)];
    this.hasRom = false;
    this.romName = '';
    this.slots = [this.roms[0], this.ram[5], this.ram[2], this.ram[0]];
    this.port7ffd = 0;
    this.border = 7;
    this.kbd = new Uint8Array(8).fill(0x1f);
    this.kempston = 0;
    this.ear = 0;
    this.spkLevel = 0;
    this.sbuf = new Float32Array(FRAME_SAMPLES + 16);
    this.sIdx = 0;
    this.ay = new AY(SAMPLE_RATE);
    this.tape = null;            // { blocks: [Uint8Array], idx, name }
    this.fastLoad = true;
    this.frames = 0;
    this.running = false;
    this.lastTapeBlock = 0;

    const self = this;
    this.cpu = createZ80({
      read: a => self.slots[a >> 14][a & 0x3fff],
      write: (a, v) => { if (a >= 0x4000) self.slots[a >> 14][a & 0x3fff] = v & 255; },
      readPort: p => self.readPort(p),
      writePort: (p, v) => self.writePort(p, v)
    });
    this.setModel(this.model);
  }

  /* --- ROMs --------------------------------------------------- */
  setRom(bytes, which = 0) {
    const b = new Uint8Array(bytes);
    if (b.length === 32768) {           // a 128K pair in one file
      this.roms[0].set(b.subarray(0, 16384));
      this.roms[1].set(b.subarray(16384, 32768));
      this.hasRom = true;
    } else if (b.length >= 16384) {
      this.roms[which].set(b.subarray(0, 16384));
      if (which === 0) this.hasRom = true;
    } else return false;
    this.applyPaging();
    return true;
  }
  /* The ROM's own character set, so the BASIC session's text matches a
     real machine once a ROM is around. CHARS holds 0x3C00 — one bias
     short of the table, which actually starts at 0x3D00 with a space. */
  romFont() {
    if (!this.hasRom) return null;
    const r = this.roms[this.is128 ? 1 : 0];
    const f = r.subarray(0x3d00, 0x3d00 + 768);
    /* a sanity check: a space is blank and "A" is not */
    let blank = true, filled = false;
    for (let i = 0; i < 8; i++) { if (f[i]) blank = false; if (f[(65 - 32) * 8 + i]) filled = true; }
    return (blank && filled) ? f : null;
  }

  setModel(m) {
    if (!MODELS[m]) return;
    this.model = m;
    this.tsPerFrame = MODELS[m].ts;
    this.reset();
  }
  get is128() { return this.model === '128k' || this.model === 'plus2'; }

  reset() {
    for (const p of this.ram) p.fill(0);
    this.port7ffd = 0;
    this.border = 7;
    this.kbd.fill(0x1f);
    this.cpu.reset();
    this.ay.reg.fill(0);
    this.applyPaging();
    this.frames = 0;
  }
  applyPaging() {
    if (this.is128) {
      this.slots[0] = this.roms[(this.port7ffd & 0x10) ? 1 : 0];
      this.slots[1] = this.ram[5];
      this.slots[2] = this.ram[2];
      this.slots[3] = this.ram[this.port7ffd & 7];
    } else {
      this.slots[0] = this.roms[0];
      this.slots[1] = this.ram[5];
      this.slots[2] = this.ram[2];
      this.slots[3] = this.ram[0];
    }
  }
  get screenRam() { return this.ram[(this.is128 && (this.port7ffd & 8)) ? 7 : 5]; }
  /* the 48K BASIC ROM is what the tape trap belongs to */
  get basicRomPaged() { return !this.is128 || !!(this.port7ffd & 0x10); }

  /* --- ports -------------------------------------------------- */
  readPort(port) {
    if ((port & 1) === 0) {                     // ULA
      let v = 0x1f;
      const hi = port >> 8;
      for (let r = 0; r < 8; r++) if (!(hi & (1 << r))) v &= this.kbd[r];
      return v | 0x40 * this.ear | 0xa0;
    }
    if ((port & 0x20) === 0) return this.kempston;             // Kempston joystick
    if (this.is128 && (port & 0xc002) === 0xc000) return this.ay.read();
    return 0xff;
  }
  writePort(port, v) {
    if ((port & 1) === 0) {
      this.border = v & 7;
      const level = ((v >> 4) & 1) * 0.16 + ((v >> 3) & 1) * 0.015;
      if (level !== this.spkLevel) this.flushSpeaker(level);
      return;
    }
    if (this.is128 && (port & 0x8002) === 0) {
      if (this.port7ffd & 0x20) return;         // paging locked until reset
      this.port7ffd = v & 255;
      this.applyPaging();
      return;
    }
    if (this.is128 && (port & 0xc002) === 0xc000) { this.ay.sel = v & 15; return; }
    if (this.is128 && (port & 0xc002) === 0x8000) { this.ay.write(v & 255); return; }
  }

  /* --- keyboard ----------------------------------------------- */
  keyDown(name) {
    const p = MATRIX_POS[name]; if (!p) return;
    this.kbd[p[0]] &= ~(1 << p[1]);
  }
  keyUp(name) {
    const p = MATRIX_POS[name]; if (!p) return;
    this.kbd[p[0]] |= (1 << p[1]);
  }
  clearKeys() { this.kbd.fill(0x1f); this.kempston = 0; }
  /* bits: right, left, down, up, fire */
  setJoystick(bits) { this.kempston = bits & 31; }

  /* --- sound -------------------------------------------------- */
  flushSpeaker(level) {
    const idx = Math.min(FRAME_SAMPLES, Math.floor(this.cpu.state.t * FRAME_SAMPLES / this.tsPerFrame));
    while (this.sIdx < idx) this.sbuf[this.sIdx++] = this.spkLevel;
    this.spkLevel = level;
  }
  audioFrame() {
    while (this.sIdx < FRAME_SAMPLES) this.sbuf[this.sIdx++] = this.spkLevel;
    if (this.is128) for (let i = 0; i < FRAME_SAMPLES; i++) this.sbuf[i] += this.ay.sample() * 0.5;
    if (this.sound) this.sound.push(this.sbuf, FRAME_SAMPLES);
    this.sIdx = 0;
  }

  /* --- running ------------------------------------------------ */
  frame() {
    if (!this.hasRom) return false;
    this.tickAuto();
    const cpu = this.cpu, z = cpu.state;
    if (z.iff1) { if (z.eiPending) cpu.step(); cpu.interrupt(); }
    const target = this.tsPerFrame;
    const trap = this.fastLoad && this.tape;
    while (z.t < target) {
      if (trap && z.pc === 0x0556 && this.basicRomPaged) this.tapeTrap();
      cpu.step();
    }
    z.t -= target;
    this.audioFrame();
    this.frames++;
    return true;
  }
  /* several frames at once, for the fast-forward that gets past a loader */
  runFrames(n) { for (let i = 0; i < n; i++) this.frame(); }

  /* --- tape --------------------------------------------------- */
  insertTape(blocks, name) {
    this.tape = { blocks, idx: 0, name: name || 'tape' };
    this.lastTapeBlock = 0;
  }
  rewind() { if (this.tape) this.tape.idx = 0; }
  ejectTape() { this.tape = null; }
  /* LD-BYTES, done in one go rather than a pulse at a time. On entry A
     holds the block type the ROM is hunting for and carry says load
     rather than verify; on exit carry reports success and we return the
     way the routine would have. */
  tapeTrap() {
    const z = this.cpu.state, cpu = this.cpu;
    const want = z.a;
    const isLoad = (z.f & 1) !== 0;
    const ret = () => {
      z.pc = this.readMem(z.sp) | (this.readMem((z.sp + 1) & 0xffff) << 8);
      z.sp = (z.sp + 2) & 0xffff;
    };
    const t = this.tape;
    if (!t || t.idx >= t.blocks.length) { z.f &= ~1; ret(); return; }
    const block = t.blocks[t.idx++];
    this.lastTapeBlock = t.idx;
    if (!block || block.length < 2) { z.f &= ~1; ret(); return; }
    if (block[0] !== want) { z.f &= ~1; ret(); return; }     // wrong kind: the ROM just looks again
    let len = cpu.DE;
    const avail = block.length - 2;
    const n = Math.min(len, avail);
    let addr = cpu.IX;
    if (isLoad) {
      for (let i = 0; i < n; i++) {
        const a = (addr + i) & 0xffff;
        if (a >= 0x4000) this.slots[a >> 14][a & 0x3fff] = block[1 + i];
      }
    }
    cpu.IX = (addr + n) & 0xffff;
    cpu.DE = (len - n) & 0xffff;
    z.a = 0;
    if (avail >= len) z.f |= 1; else z.f &= ~1;
    ret();
  }

  /* --- file formats ------------------------------------------- */
  /* .TAP — length-prefixed blocks, exactly what the trap wants */
  static parseTAP(bytes) {
    const b = new Uint8Array(bytes), out = [];
    let i = 0;
    while (i + 2 <= b.length) {
      const len = b[i] | (b[i + 1] << 8);
      i += 2;
      if (!len || i + len > b.length) break;
      out.push(b.subarray(i, i + len));
      i += len;
    }
    return out;
  }
  /* .TZX — the data-carrying blocks; timing-only blocks are skipped,
     which is what trap loading wants anyway */
  static parseTZX(bytes) {
    const b = new Uint8Array(bytes);
    if (String.fromCharCode(...b.subarray(0, 7)) !== 'ZXTape!') return null;
    let i = 10;
    const out = [];
    const u16 = o => b[o] | (b[o + 1] << 8);
    const u24 = o => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);
    while (i < b.length) {
      const id = b[i++];
      switch (id) {
        case 0x10: { const len = u16(i + 2); i += 4; out.push(b.subarray(i, i + len)); i += len; break; }
        case 0x11: { const len = u24(i + 0x0f); i += 0x12; out.push(b.subarray(i, i + len)); i += len; break; }
        case 0x12: i += 4; break;
        case 0x13: i += 1 + b[i] * 2; break;
        case 0x14: { const len = u24(i + 7); i += 10; out.push(b.subarray(i, i + len)); i += len; break; }
        case 0x15: { const len = u24(i + 5); i += 8; i += len; break; }
        case 0x18: case 0x19: { const len = b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24); i += 4 + len; break; }
        case 0x20: i += 2; break;
        case 0x21: i += 1 + b[i]; break;
        case 0x22: break;
        case 0x23: i += 2; break;
        case 0x24: i += 2; break;
        case 0x25: break;
        case 0x26: i += 2 + u16(i) * 2; break;
        case 0x27: break;
        case 0x28: { const len = u16(i); i += 2 + len; break; }
        case 0x2a: i += 4; break;
        case 0x2b: i += 5; break;
        case 0x30: i += 1 + b[i]; break;
        case 0x31: i += 2 + b[i + 1]; break;
        case 0x32: { const len = u16(i); i += 2 + len; break; }
        case 0x33: i += 1 + b[i] * 3; break;
        case 0x35: { const len = b[i + 0x10] | (b[i + 0x11] << 8) | (b[i + 0x12] << 16) | (b[i + 0x13] << 24); i += 0x14 + len; break; }
        case 0x5a: i += 9; break;
        default: return out;                     // an unknown block: stop while we are ahead
      }
    }
    return out;
  }

  /* .SNA — 48K and 128K */
  loadSNA(bytes) {
    const b = new Uint8Array(bytes);
    if (b.length < 49179) return false;
    const z = this.cpu.state, cpu = this.cpu;
    z.i = b[0];
    z.l_ = b[1]; z.h_ = b[2];
    z.e_ = b[3]; z.d_ = b[4];
    z.c_ = b[5]; z.b_ = b[6];
    z.f_ = b[7]; z.a_ = b[8];
    cpu.HL = b[9] | (b[10] << 8);
    cpu.DE = b[11] | (b[12] << 8);
    cpu.BC = b[13] | (b[14] << 8);
    cpu.IY = b[15] | (b[16] << 8);
    cpu.IX = b[17] | (b[18] << 8);
    z.iff2 = (b[19] & 4) ? 1 : 0; z.iff1 = z.iff2;
    z.r = b[20] & 0x7f; z.r7 = b[20] & 0x80;
    z.f = b[21]; z.a = b[22];
    z.sp = b[23] | (b[24] << 8);
    z.im = b[25] & 3;
    this.border = b[26] & 7;
    const is128 = b.length >= 131103;
    if (!is128) {
      if (this.is128) this.setModel('48k');
      const flat = b.subarray(27, 27 + 49152);
      this.ram[5].set(flat.subarray(0, 16384));
      this.ram[2].set(flat.subarray(16384, 32768));
      this.ram[0].set(flat.subarray(32768, 49152));
      this.applyPaging();
      /* the program counter is the top of the stack */
      const lo = this.readMem(z.sp), hi = this.readMem((z.sp + 1) & 0xffff);
      z.pc = lo | (hi << 8);
      z.sp = (z.sp + 2) & 0xffff;
    } else {
      if (!this.is128) this.setModelKeepRam('128k');
      const body = b.subarray(27);
      this.ram[5].set(body.subarray(0, 16384));
      this.ram[2].set(body.subarray(16384, 32768));
      const pc = body[49152] | (body[49153] << 8);
      const port = body[49154];
      this.port7ffd = port;
      const cur = port & 7;
      this.ram[cur].set(body.subarray(32768, 49152));
      let off = 49152 + 4;
      for (let p = 0; p < 8; p++) {
        if (p === 5 || p === 2 || p === cur) continue;
        if (off + 16384 > body.length) break;
        this.ram[p].set(body.subarray(off, off + 16384));
        off += 16384;
      }
      this.applyPaging();
      z.pc = pc;
    }
    z.halted = false; z.t = 0;
    return true;
  }
  setModelKeepRam(m) { this.model = m; this.tsPerFrame = MODELS[m].ts; }
  readMem(a) { return this.slots[a >> 14][a & 0x3fff]; }
  writeMem(a, v) { if (a >= 0x4000) this.slots[a >> 14][a & 0x3fff] = v & 255; }

  /* .Z80 — v1, v2 and v3 */
  loadZ80(bytes) {
    const b = new Uint8Array(bytes);
    if (b.length < 30) return false;
    const z = this.cpu.state, cpu = this.cpu;
    z.a = b[0]; z.f = b[1];
    cpu.BC = b[2] | (b[3] << 8);
    cpu.HL = b[4] | (b[5] << 8);
    let pc = b[6] | (b[7] << 8);
    z.sp = b[8] | (b[9] << 8);
    z.i = b[10];
    let byte12 = b[12] === 255 ? 1 : b[12];
    z.r = b[11] & 0x7f; z.r7 = (byte12 & 1) ? 0x80 : 0;
    this.border = (byte12 >> 1) & 7;
    const compressedV1 = !!(byte12 & 0x20);
    cpu.DE = b[13] | (b[14] << 8);
    z.c_ = b[15]; z.b_ = b[16];
    z.e_ = b[17]; z.d_ = b[18];
    z.l_ = b[19]; z.h_ = b[20];
    z.a_ = b[21]; z.f_ = b[22];
    cpu.IY = b[23] | (b[24] << 8);
    cpu.IX = b[25] | (b[26] << 8);
    z.iff1 = b[27] ? 1 : 0; z.iff2 = b[28] ? 1 : 0;
    z.im = b[29] & 3;

    if (pc !== 0) {                                        // version 1: a flat 48K image
      if (this.is128) this.setModel('48k');
      const data = b.subarray(30);
      const flat = compressedV1 ? Machine.unpackZ80(data, 49152) : data.subarray(0, 49152);
      this.ram[5].set(flat.subarray(0, 16384));
      this.ram[2].set(flat.subarray(16384, 32768));
      this.ram[0].set(flat.subarray(32768, 49152));
      this.port7ffd = 0;
      this.applyPaging();
      z.pc = pc; z.halted = false; z.t = 0;
      return true;
    }
    const extraLen = b[30] | (b[31] << 8);
    pc = b[32] | (b[33] << 8);
    const hw = b[34];
    const v3 = extraLen > 23;
    const is128 = v3 ? (hw >= 4) : (hw >= 3);
    if (is128) {
      this.setModelKeepRam('128k');
      this.port7ffd = b[35];
      if (extraLen >= 24) for (let r = 0; r < 16; r++) this.ay.reg[r] = b[39 + r] || 0;
    } else {
      this.setModelKeepRam('48k');
      this.port7ffd = 0;
    }
    let i = 32 + extraLen;
    while (i + 3 <= b.length) {
      const len = b[i] | (b[i + 1] << 8);
      const page = b[i + 2];
      i += 3;
      const raw = len === 0xffff ? b.subarray(i, i + 16384) : Machine.unpackZ80(b.subarray(i, i + len), 16384);
      i += (len === 0xffff ? 16384 : len);
      let target = -1;
      if (is128) { if (page >= 3 && page <= 10) target = page - 3; }
      else { if (page === 4) target = 2; else if (page === 5) target = 0; else if (page === 8) target = 5; }
      if (target >= 0) this.ram[target].set(raw.subarray(0, 16384));
    }
    this.applyPaging();
    z.pc = pc; z.halted = false; z.t = 0;
    return true;
  }
  static unpackZ80(src, outLen) {
    const out = new Uint8Array(outLen);
    let i = 0, o = 0;
    while (i < src.length && o < outLen) {
      if (src[i] === 0xed && src[i + 1] === 0xed) {
        const n = src[i + 2], v = src[i + 3];
        i += 4;
        for (let k = 0; k < n && o < outLen; k++) out[o++] = v;
      } else out[o++] = src[i++];
    }
    return out;
  }

  /* what kind of file is this? */
  static kindOf(name, bytes) {
    const n = (name || '').toLowerCase();
    if (n.endsWith('.rom') || (bytes && bytes.length === 16384 && !n.match(/\.(tap|tzx|z80|sna)$/))) return 'rom';
    if (n.endsWith('.tap')) return 'tap';
    if (n.endsWith('.tzx')) return 'tzx';
    if (n.endsWith('.z80')) return 'z80';
    if (n.endsWith('.sna')) return 'sna';
    if (n.endsWith('.bas') || n.endsWith('.txt')) return 'bas';
    if (bytes && bytes.length === 32768) return 'rom';
    if (bytes && (bytes.length === 49179 || bytes.length === 131103 || bytes.length === 147487)) return 'sna';
    return '';
  }

  load(name, bytes) {
    const kind = Machine.kindOf(name, bytes);
    switch (kind) {
      case 'rom': return this.setRom(bytes) ? 'rom' : '';
      case 'tap': this.insertTape(Machine.parseTAP(bytes), name); return 'tape';
      case 'tzx': {
        const blocks = Machine.parseTZX(bytes);
        if (!blocks || !blocks.length) return '';
        this.insertTape(blocks, name); return 'tape';
      }
      case 'sna': return this.loadSNA(bytes) ? 'snapshot' : '';
      case 'z80': return this.loadZ80(bytes) ? 'snapshot' : '';
      default: return '';
    }
  }

  /* Type LOAD "" and press ENTER at the machine, so an inserted tape
     starts itself. The 128K boots into a menu, so it takes ENTER first
     to choose 48 BASIC, then the same three keys. */
  autoLoad() {
    this.reset();
    /* [keys, frame to press on] — held for four frames each, with a
       gap in between so the ROM sees a fresh key */
    const start = this.is128 ? [['ENTER', 60], ['DOWN', 70]] : [];
    this.autoScript = start.concat([['J', 120], ['SYM+P', 132], ['SYM+P', 144], ['ENTER', 156]]);
    this.autoFrame = 0;
    this.pendingAuto = 170;
  }
  /* called once a frame while an auto-load is in flight */
  tickAuto() {
    if (!this.pendingAuto) return;
    const f = this.autoFrame++;
    this.pendingAuto--;
    this.clearKeys();
    for (const [k, at] of this.autoScript) {
      if (f >= at && f < at + 5) {
        if (k === 'SYM+P') { this.keyDown('SYM'); this.keyDown('P'); }
        else if (k === 'DOWN') { this.keyDown('CAPS'); this.keyDown('6'); }
        else this.keyDown(k);
      }
    }
    if (!this.pendingAuto) this.clearKeys();
  }
}
