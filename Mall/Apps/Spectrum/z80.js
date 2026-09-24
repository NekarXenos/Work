/* ============================================================
   Spectrum · z80.js
   A Zilog Z80 core. Complete instruction set including the CB,
   ED, DD, FD, DDCB and FDCB pages, the undocumented IXH/IXL half
   registers and SLL, all three interrupt modes, and the memory
   pointer bits (F3/F5) that a few loaders lean on.

   Timing is per-instruction rather than per-T-state: no memory
   contention, which costs nothing for the vast majority of games
   and keeps the whole thing fast enough to run four terminals at
   once inside a three.js frame.
   ============================================================ */

const FC = 0x01, FN = 0x02, FPV = 0x04, F3 = 0x08, FH = 0x10, F5 = 0x20, FZ = 0x40, FS = 0x80;

/* sz53 for a byte, plus parity variants */
const SZ53 = new Uint8Array(256), SZ53P = new Uint8Array(256), PARITY = new Uint8Array(256);
for (let i = 0; i < 256; i++) {
  let p = 0, v = i;
  for (let b = 0; b < 8; b++) { p ^= v & 1; v >>= 1; }
  PARITY[i] = p ? 0 : FPV;
  SZ53[i] = (i & (FS | F3 | F5)) | (i === 0 ? FZ : 0);
  SZ53P[i] = SZ53[i] | PARITY[i];
}

/* base T-states, unprefixed. Conditional forms carry the not-taken
   count here and add the rest when they branch. */
const T_MAIN = [
  4, 10, 7, 6, 4, 4, 7, 4, 4, 11, 7, 6, 4, 4, 7, 4,
  8, 10, 7, 6, 4, 4, 7, 4, 12, 11, 7, 6, 4, 4, 7, 4,
  7, 10, 16, 6, 4, 4, 7, 4, 7, 11, 16, 6, 4, 4, 7, 4,
  7, 10, 13, 6, 11, 11, 10, 4, 7, 11, 13, 6, 4, 4, 7, 4,
  4, 4, 4, 4, 4, 4, 7, 4, 4, 4, 4, 4, 4, 4, 7, 4,
  4, 4, 4, 4, 4, 4, 7, 4, 4, 4, 4, 4, 4, 4, 7, 4,
  4, 4, 4, 4, 4, 4, 7, 4, 4, 4, 4, 4, 4, 4, 7, 4,
  7, 7, 7, 7, 7, 7, 4, 7, 4, 4, 4, 4, 4, 4, 7, 4,
  4, 4, 4, 4, 4, 4, 7, 4, 4, 4, 4, 4, 4, 4, 7, 4,
  4, 4, 4, 4, 4, 4, 7, 4, 4, 4, 4, 4, 4, 4, 7, 4,
  4, 4, 4, 4, 4, 4, 7, 4, 4, 4, 4, 4, 4, 4, 7, 4,
  4, 4, 4, 4, 4, 4, 7, 4, 4, 4, 4, 4, 4, 4, 7, 4,
  5, 10, 10, 10, 10, 11, 7, 11, 5, 10, 10, 4, 10, 17, 7, 11,
  5, 10, 10, 11, 10, 11, 7, 11, 5, 4, 10, 11, 10, 4, 7, 11,
  5, 10, 10, 19, 10, 11, 7, 11, 5, 4, 10, 4, 10, 4, 7, 11,
  5, 10, 10, 4, 10, 11, 7, 11, 5, 6, 10, 4, 10, 4, 7, 11
];

export function createZ80(bus) {
  const rd = bus.read, wr = bus.write, inp = bus.readPort, outp = bus.writePort;

  const z = {
    a: 0xff, f: 0xff, b: 0, c: 0, d: 0, e: 0, h: 0, l: 0,
    a_: 0, f_: 0, b_: 0, c_: 0, d_: 0, e_: 0, h_: 0, l_: 0,
    ixh: 0xff, ixl: 0xff, iyh: 0xff, iyl: 0xff,
    sp: 0xffff, pc: 0, i: 0, r: 0, r7: 0,
    iff1: 0, iff2: 0, im: 0, halted: false,
    memptr: 0, t: 0, eiPending: false
  };

  /* --- 16 bit views ------------------------------------------ */
  const getBC = () => (z.b << 8) | z.c, setBC = v => { z.b = (v >> 8) & 255; z.c = v & 255; };
  const getDE = () => (z.d << 8) | z.e, setDE = v => { z.d = (v >> 8) & 255; z.e = v & 255; };
  const getHL = () => (z.h << 8) | z.l, setHL = v => { z.h = (v >> 8) & 255; z.l = v & 255; };
  const getIX = () => (z.ixh << 8) | z.ixl, setIX = v => { z.ixh = (v >> 8) & 255; z.ixl = v & 255; };
  const getIY = () => (z.iyh << 8) | z.iyl, setIY = v => { z.iyh = (v >> 8) & 255; z.iyl = v & 255; };

  const fetch = () => { const v = rd(z.pc); z.pc = (z.pc + 1) & 0xffff; return v; };
  const fetch16 = () => { const lo = fetch(); return lo | (fetch() << 8); };
  const push = v => { z.sp = (z.sp - 1) & 0xffff; wr(z.sp, (v >> 8) & 255); z.sp = (z.sp - 1) & 0xffff; wr(z.sp, v & 255); };
  const pop = () => { const lo = rd(z.sp); z.sp = (z.sp + 1) & 0xffff; const hi = rd(z.sp); z.sp = (z.sp + 1) & 0xffff; return lo | (hi << 8); };
  const bump = () => { z.r = (z.r + 1) & 0x7f; };

  /* --- ALU --------------------------------------------------- */
  function add8(v) {
    const r = z.a + v;
    const lu = r & 255;
    z.f = (r & 0x100 ? FC : 0) | (((z.a ^ ~v) & (z.a ^ r) & 0x80) ? FPV : 0) |
      (((z.a & 0x0f) + (v & 0x0f)) & 0x10 ? FH : 0) | SZ53[lu];
    z.a = lu;
  }
  function adc8(v) {
    const cy = z.f & FC ? 1 : 0, r = z.a + v + cy, lu = r & 255;
    z.f = (r & 0x100 ? FC : 0) | (((z.a ^ ~v) & (z.a ^ r) & 0x80) ? FPV : 0) |
      (((z.a & 0x0f) + (v & 0x0f) + cy) & 0x10 ? FH : 0) | SZ53[lu];
    z.a = lu;
  }
  function sub8(v) {
    const r = z.a - v, lu = r & 255;
    z.f = FN | (r & 0x100 ? FC : 0) | (((z.a ^ v) & (z.a ^ r) & 0x80) ? FPV : 0) |
      (((z.a & 0x0f) - (v & 0x0f)) & 0x10 ? FH : 0) | SZ53[lu];
    z.a = lu;
  }
  function sbc8(v) {
    const cy = z.f & FC ? 1 : 0, r = z.a - v - cy, lu = r & 255;
    z.f = FN | (r & 0x100 ? FC : 0) | (((z.a ^ v) & (z.a ^ r) & 0x80) ? FPV : 0) |
      (((z.a & 0x0f) - (v & 0x0f) - cy) & 0x10 ? FH : 0) | SZ53[lu];
    z.a = lu;
  }
  function and8(v) { z.a &= v; z.f = FH | SZ53P[z.a]; }
  function xor8(v) { z.a ^= v; z.f = SZ53P[z.a]; }
  function or8(v) { z.a |= v; z.f = SZ53P[z.a]; }
  function cp8(v) {
    const r = z.a - v, lu = r & 255;
    z.f = FN | (r & 0x100 ? FC : 0) | (((z.a ^ v) & (z.a ^ r) & 0x80) ? FPV : 0) |
      (((z.a & 0x0f) - (v & 0x0f)) & 0x10 ? FH : 0) | (lu === 0 ? FZ : 0) | (lu & FS) | (v & (F3 | F5));
  }
  const ALU = [add8, adc8, sub8, sbc8, and8, xor8, or8, cp8];

  function inc8(v) {
    const r = (v + 1) & 255;
    z.f = (z.f & FC) | (r === 0x80 ? FPV : 0) | ((r & 0x0f) === 0 ? FH : 0) | SZ53[r];
    return r;
  }
  function dec8(v) {
    const r = (v - 1) & 255;
    z.f = (z.f & FC) | FN | (r === 0x7f ? FPV : 0) | ((r & 0x0f) === 0x0f ? FH : 0) | SZ53[r];
    return r;
  }
  function add16(a, b) {
    const r = a + b;
    z.memptr = (a + 1) & 0xffff;
    z.f = (z.f & (FS | FZ | FPV)) | (r & 0x10000 ? FC : 0) |
      (((a & 0x0fff) + (b & 0x0fff)) & 0x1000 ? FH : 0) | ((r >> 8) & (F3 | F5));
    return r & 0xffff;
  }
  function adc16(b) {
    const a = getHL(), cy = z.f & FC ? 1 : 0, r = a + b + cy, lu = r & 0xffff;
    z.memptr = (a + 1) & 0xffff;
    z.f = (r & 0x10000 ? FC : 0) | (((a ^ ~b) & (a ^ r) & 0x8000) ? FPV : 0) |
      (((a & 0x0fff) + (b & 0x0fff) + cy) & 0x1000 ? FH : 0) |
      (lu === 0 ? FZ : 0) | ((lu >> 8) & (FS | F3 | F5));
    setHL(lu);
  }
  function sbc16(b) {
    const a = getHL(), cy = z.f & FC ? 1 : 0, r = a - b - cy, lu = r & 0xffff;
    z.memptr = (a + 1) & 0xffff;
    z.f = FN | (r & 0x10000 ? FC : 0) | (((a ^ b) & (a ^ r) & 0x8000) ? FPV : 0) |
      (((a & 0x0fff) - (b & 0x0fff) - cy) & 0x1000 ? FH : 0) |
      (lu === 0 ? FZ : 0) | ((lu >> 8) & (FS | F3 | F5));
    setHL(lu);
  }
  function daa() {
    let add = 0, carry = z.f & FC;
    if ((z.f & FH) || ((z.a & 0x0f) > 9)) add = 6;
    if (carry || z.a > 0x99) add |= 0x60;
    if (z.a > 0x99) carry = FC;
    const before = z.a;
    if (z.f & FN) { z.a = (z.a - add) & 255; z.f = FN | (((before & 0x0f) - (add & 0x0f)) & 0x10 ? FH : 0); }
    else { z.a = (z.a + add) & 255; z.f = (((before & 0x0f) + (add & 0x0f)) & 0x10 ? FH : 0); }
    z.f |= carry | SZ53P[z.a];
  }

  /* --- rotates and shifts ------------------------------------ */
  function rlc(v) { const c = (v >> 7) & 1; const r = ((v << 1) | c) & 255; z.f = c | SZ53P[r]; return r; }
  function rrc(v) { const c = v & 1; const r = ((v >> 1) | (c << 7)) & 255; z.f = c | SZ53P[r]; return r; }
  function rl(v) { const c = (v >> 7) & 1; const r = ((v << 1) | (z.f & FC ? 1 : 0)) & 255; z.f = c | SZ53P[r]; return r; }
  function rr(v) { const c = v & 1; const r = ((v >> 1) | (z.f & FC ? 0x80 : 0)) & 255; z.f = c | SZ53P[r]; return r; }
  function sla(v) { const c = (v >> 7) & 1; const r = (v << 1) & 255; z.f = c | SZ53P[r]; return r; }
  function sra(v) { const c = v & 1; const r = ((v >> 1) | (v & 0x80)) & 255; z.f = c | SZ53P[r]; return r; }
  function sll(v) { const c = (v >> 7) & 1; const r = ((v << 1) | 1) & 255; z.f = c | SZ53P[r]; return r; }
  function srl(v) { const c = v & 1; const r = (v >> 1) & 255; z.f = c | SZ53P[r]; return r; }
  const ROT = [rlc, rrc, rl, rr, sla, sra, sll, srl];

  function bitTest(bit, v, hi35) {
    const r = v & (1 << bit);
    z.f = (z.f & FC) | FH | (r ? 0 : (FZ | FPV)) | (bit === 7 && r ? FS : 0) |
      ((hi35 === undefined ? v : hi35) & (F3 | F5));
  }

  /* --- register file plumbing -------------------------------- */
  function getR(i) {
    switch (i) {
      case 0: return z.b; case 1: return z.c; case 2: return z.d; case 3: return z.e;
      case 4: return z.h; case 5: return z.l; case 6: return rd(getHL()); default: return z.a;
    }
  }
  function setR(i, v) {
    switch (i) {
      case 0: z.b = v; break; case 1: z.c = v; break; case 2: z.d = v; break; case 3: z.e = v; break;
      case 4: z.h = v; break; case 5: z.l = v; break; case 6: wr(getHL(), v); break; default: z.a = v;
    }
  }
  function getRP(p) { return p === 0 ? getBC() : p === 1 ? getDE() : p === 2 ? getHL() : z.sp; }
  function setRP(p, v) { if (p === 0) setBC(v); else if (p === 1) setDE(v); else if (p === 2) setHL(v); else z.sp = v & 0xffff; }
  function getRP2(p) { return p === 3 ? ((z.a << 8) | z.f) : getRP(p); }
  function setRP2(p, v) { if (p === 3) { z.a = (v >> 8) & 255; z.f = v & 255; } else setRP(p, v); }
  function cond(y) {
    switch (y) {
      case 0: return !(z.f & FZ); case 1: return !!(z.f & FZ);
      case 2: return !(z.f & FC); case 3: return !!(z.f & FC);
      case 4: return !(z.f & FPV); case 5: return !!(z.f & FPV);
      case 6: return !(z.f & FS); default: return !!(z.f & FS);
    }
  }

  /* --- ports -------------------------------------------------- */
  function inC() {
    const port = getBC();
    z.memptr = (port + 1) & 0xffff;
    const v = inp(port) & 255;
    z.f = (z.f & FC) | SZ53P[v];
    return v;
  }

  /* --- block instructions ------------------------------------ */
  function ldi(dir) {
    const v = rd(getHL());
    wr(getDE(), v);
    setDE((getDE() + dir) & 0xffff);
    setHL((getHL() + dir) & 0xffff);
    setBC((getBC() - 1) & 0xffff);
    const n = (v + z.a) & 255;
    z.f = (z.f & (FC | FZ | FS)) | (getBC() ? FPV : 0) | (n & F3) | ((n & 0x02) ? F5 : 0);
  }
  function cpi(dir) {
    const v = rd(getHL());
    const r = (z.a - v) & 255;
    const h = ((z.a & 0x0f) - (v & 0x0f)) & 0x10;
    setHL((getHL() + dir) & 0xffff);
    setBC((getBC() - 1) & 0xffff);
    const n = (r - (h ? 1 : 0)) & 255;
    z.f = (z.f & FC) | FN | (h ? FH : 0) | (getBC() ? FPV : 0) | (r === 0 ? FZ : 0) | (r & FS) |
      (n & F3) | ((n & 0x02) ? F5 : 0);
    z.memptr = (z.memptr + dir) & 0xffff;
  }
  function ini(dir) {
    const v = inp(getBC()) & 255;
    wr(getHL(), v);
    z.b = (z.b - 1) & 255;
    setHL((getHL() + dir) & 0xffff);
    const k = (v + ((z.c + dir) & 255)) & 0x1ff;
    z.f = SZ53[z.b] | ((v & 0x80) ? FN : 0) | (k > 255 ? (FH | FC) : 0) | PARITY[(k & 7) ^ z.b];
  }
  function outi(dir) {
    const v = rd(getHL());
    setHL((getHL() + dir) & 0xffff);
    z.b = (z.b - 1) & 255;
    outp(getBC(), v);
    const k = (v + z.l) & 0x1ff;
    z.f = SZ53[z.b] | ((v & 0x80) ? FN : 0) | (k > 255 ? (FH | FC) : 0) | PARITY[(k & 7) ^ z.b];
  }

  /* ------------------------------------------------------------
     CB page, optionally through an index register
     ------------------------------------------------------------ */
  function doCB() {
    bump();
    const op = fetch();
    const x = op >> 6, y = (op >> 3) & 7, zz = op & 7;
    const onHL = zz === 6;
    z.t += onHL ? (x === 1 ? 12 : 15) : 8;
    if (x === 0) { setR(zz, ROT[y](getR(zz))); return; }
    if (x === 1) { const v = getR(zz); bitTest(y, v, onHL ? (z.memptr >> 8) : v); return; }
    const v = getR(zz);
    setR(zz, x === 2 ? (v & ~(1 << y)) : (v | (1 << y)));
  }
  function doIndexCB(getI) {
    const d = (fetch() << 24) >> 24;
    const op = fetch();
    const addr = (getI() + d) & 0xffff;
    z.memptr = addr;
    const x = op >> 6, y = (op >> 3) & 7, zz = op & 7;
    z.t += x === 1 ? 20 : 23;
    const v = rd(addr);
    if (x === 1) { bitTest(y, v, addr >> 8); return; }
    let r;
    if (x === 0) r = ROT[y](v);
    else if (x === 2) r = v & ~(1 << y);
    else r = v | (1 << y);
    wr(addr, r);
    if (zz !== 6) setR(zz, r);            // the undocumented copy to a register
  }

  /* ------------------------------------------------------------
     ED page
     ------------------------------------------------------------ */
  function doED() {
    bump();
    const op = fetch();
    const x = op >> 6, y = (op >> 3) & 7, zz = op & 7, p = y >> 1, q = y & 1;
    if (x === 1) {
      switch (zz) {
        case 0: { z.t += 12; const v = inC(); if (y !== 6) setR(y, v); return; }
        case 1: { z.t += 12; const port = getBC(); z.memptr = (port + 1) & 0xffff; outp(port, y === 6 ? 0 : getR(y)); return; }
        case 2: { z.t += 15; if (q) adc16(getRP(p)); else sbc16(getRP(p)); return; }
        case 3: {
          z.t += 20; const nn = fetch16(); z.memptr = (nn + 1) & 0xffff;
          if (q) { const lo = rd(nn), hi = rd((nn + 1) & 0xffff); setRP(p, lo | (hi << 8)); }
          else { const v = getRP(p); wr(nn, v & 255); wr((nn + 1) & 0xffff, (v >> 8) & 255); }
          return;
        }
        case 4: { z.t += 8; const v = z.a; z.a = 0; sub8(v); return; }
        case 5: { z.t += 14; z.iff1 = z.iff2; z.pc = pop(); z.memptr = z.pc; return; }
        case 6: { z.t += 8; z.im = [0, 0, 1, 2, 0, 0, 1, 2][y]; return; }
        default:
          switch (y) {
            case 0: z.t += 9; z.i = z.a; return;
            case 1: z.t += 9; z.r = z.a & 0x7f; z.r7 = z.a & 0x80; return;
            case 2: z.t += 9; z.a = z.i; z.f = (z.f & FC) | SZ53[z.a] | (z.iff2 ? FPV : 0); return;
            case 3: z.t += 9; z.a = (z.r & 0x7f) | z.r7; z.f = (z.f & FC) | SZ53[z.a] | (z.iff2 ? FPV : 0); return;
            case 4: {                                   // RRD
              z.t += 18; const v = rd(getHL());
              wr(getHL(), ((v >> 4) | (z.a << 4)) & 255);
              z.a = (z.a & 0xf0) | (v & 0x0f);
              z.f = (z.f & FC) | SZ53P[z.a]; z.memptr = (getHL() + 1) & 0xffff; return;
            }
            case 5: {                                   // RLD
              z.t += 18; const v = rd(getHL());
              wr(getHL(), ((v << 4) | (z.a & 0x0f)) & 255);
              z.a = (z.a & 0xf0) | ((v >> 4) & 0x0f);
              z.f = (z.f & FC) | SZ53P[z.a]; z.memptr = (getHL() + 1) & 0xffff; return;
            }
            default: z.t += 8; return;
          }
      }
    }
    if (x === 2 && zz <= 3 && y >= 4) {
      const dir = (y & 1) ? -1 : 1;
      const rep = y >= 6;
      z.t += 16;
      switch (zz) {
        case 0: ldi(dir); if (rep && getBC()) { z.pc = (z.pc - 2) & 0xffff; z.t += 5; z.memptr = (z.pc + 1) & 0xffff; } return;
        case 1: cpi(dir); if (rep && getBC() && !(z.f & FZ)) { z.pc = (z.pc - 2) & 0xffff; z.t += 5; z.memptr = (z.pc + 1) & 0xffff; } return;
        case 2: ini(dir); if (rep && z.b) { z.pc = (z.pc - 2) & 0xffff; z.t += 5; } return;
        default: outi(dir); if (rep && z.b) { z.pc = (z.pc - 2) & 0xffff; z.t += 5; } return;
      }
    }
    z.t += 8;                                            // everything else on this page is a NOP
  }

  /* ------------------------------------------------------------
     DD / FD pages — IX or IY stands in for HL
     ------------------------------------------------------------ */
  function doIndex(getI, setI, hiName, loName) {
    bump();
    const op = fetch();
    const x = op >> 6, y = (op >> 3) & 7, zz = op & 7, p = y >> 1, q = y & 1;
    const gh = () => z[hiName], sh = v => { z[hiName] = v & 255; };
    const gl = () => z[loName], sl = v => { z[loName] = v & 255; };
    /* r[] with H and L swapped for the index halves, and (HL) for (I+d) */
    const disp = () => { const d = (fetch() << 24) >> 24; const a = (getI() + d) & 0xffff; z.memptr = a; return a; };
    const getIR = i => i === 4 ? gh() : i === 5 ? gl() : i === 6 ? rd(disp()) : getR(i);
    const setIR = (i, v) => { if (i === 4) sh(v); else if (i === 5) sl(v); else if (i === 6) wr(disp(), v); else setR(i, v); };

    if (op === 0xcb) { doIndexCB(getI); return; }
    if (op === 0xdd || op === 0xfd || op === 0xed) { z.pc = (z.pc - 1) & 0xffff; z.t += 4; return; }

    switch (x) {
      case 0:
        if (zz === 1 && q === 0 && p === 2) { z.t += 14; setI(fetch16()); return; }
        if (zz === 1 && q === 1) { z.t += 15; setI(add16(getI(), p === 2 ? getI() : getRP(p))); return; }
        if (zz === 2 && p === 2) {
          z.t += 20; const nn = fetch16(); z.memptr = (nn + 1) & 0xffff;
          if (q) { setI(rd(nn) | (rd((nn + 1) & 0xffff) << 8)); }
          else { const v = getI(); wr(nn, v & 255); wr((nn + 1) & 0xffff, (v >> 8) & 255); }
          return;
        }
        if (zz === 3 && p === 2) { z.t += 10; setI((getI() + (q ? -1 : 1)) & 0xffff); return; }
        if (zz === 4 || zz === 5) {
          if (y === 6) {
            z.t += 23; const a = disp(); const v = rd(a);
            wr(a, zz === 4 ? inc8(v) : dec8(v)); return;
          }
          z.t += 8;
          const v = getIR(y);
          setIR(y, zz === 4 ? inc8(v) : dec8(v)); return;
        }
        if (zz === 6) {
          if (y === 6) { z.t += 19; const a = disp(); wr(a, fetch()); return; }
          z.t += 11; setIR(y, fetch()); return;
        }
        /* anything else on this page behaves as the unprefixed opcode */
        z.t += 4; z.pc = (z.pc - 1) & 0xffff; return;
      case 1: {
        if (y === 6 && zz === 6) { z.t += 4; z.pc = (z.pc - 1) & 0xffff; return; }   // HALT
        if (y === 6) { z.t += 19; const a = disp(); wr(a, getR(zz === 4 ? 4 : zz === 5 ? 5 : zz)); return; }
        if (zz === 6) { z.t += 19; const a = disp(); setR(y, rd(a)); return; }
        z.t += 8;
        const v = (zz === 4) ? gh() : (zz === 5) ? gl() : getR(zz);
        if (y === 4) sh(v); else if (y === 5) sl(v); else setR(y, v);
        return;
      }
      case 2: {
        if (zz === 6) { z.t += 19; ALU[y](rd(disp())); return; }
        z.t += 8;
        ALU[y]((zz === 4) ? gh() : (zz === 5) ? gl() : getR(zz));
        return;
      }
      default:
        if (op === 0xe1) { z.t += 14; setI(pop()); return; }              // POP IX
        if (op === 0xe5) { z.t += 15; push(getI()); return; }             // PUSH IX
        if (op === 0xe9) { z.t += 8; z.pc = getI(); return; }             // JP (IX)
        if (op === 0xe3) {                                                // EX (SP),IX
          z.t += 23;
          const lo = rd(z.sp), hi = rd((z.sp + 1) & 0xffff), v = getI();
          wr(z.sp, v & 255); wr((z.sp + 1) & 0xffff, (v >> 8) & 255);
          setI(lo | (hi << 8)); z.memptr = getI(); return;
        }
        if (op === 0xf9) { z.t += 10; z.sp = getI(); return; }            // LD SP,IX
        z.t += 4; z.pc = (z.pc - 1) & 0xffff; return;
    }
  }

  /* ------------------------------------------------------------
     one instruction
     ------------------------------------------------------------ */
  function step() {
    if (z.eiPending) z.eiPending = false;
    if (z.halted) { z.t += 4; bump(); return 4; }
    const t0 = z.t;
    bump();
    const op = fetch();
    z.t += T_MAIN[op];
    const x = op >> 6, y = (op >> 3) & 7, zz = op & 7, p = y >> 1, q = y & 1;

    switch (x) {
      case 0:
        switch (zz) {
          case 0:
            if (y === 0) break;                                    // NOP
            if (y === 1) {                                         // EX AF,AF'
              let t = z.a; z.a = z.a_; z.a_ = t; t = z.f; z.f = z.f_; z.f_ = t; break;
            }
            if (y === 2) {                                         // DJNZ
              const d = (fetch() << 24) >> 24;
              z.b = (z.b - 1) & 255;
              if (z.b) { z.pc = (z.pc + d) & 0xffff; z.t += 5; z.memptr = z.pc; }
              break;
            }
            if (y === 3) { const d = (fetch() << 24) >> 24; z.pc = (z.pc + d) & 0xffff; z.memptr = z.pc; break; }
            {
              const d = (fetch() << 24) >> 24;
              if (cond(y - 4)) { z.pc = (z.pc + d) & 0xffff; z.t += 5; z.memptr = z.pc; }
            }
            break;
          case 1:
            if (q === 0) setRP(p, fetch16());
            else setHL(add16(getHL(), getRP(p)));
            break;
          case 2:
            if (q === 0) {
              if (p === 0) { wr(getBC(), z.a); z.memptr = ((z.a << 8) | ((getBC() + 1) & 255)); }
              else if (p === 1) { wr(getDE(), z.a); z.memptr = ((z.a << 8) | ((getDE() + 1) & 255)); }
              else if (p === 2) { const nn = fetch16(); wr(nn, z.l); wr((nn + 1) & 0xffff, z.h); z.memptr = (nn + 1) & 0xffff; }
              else { const nn = fetch16(); wr(nn, z.a); z.memptr = ((z.a << 8) | ((nn + 1) & 255)); }
            } else {
              if (p === 0) { z.a = rd(getBC()); z.memptr = (getBC() + 1) & 0xffff; }
              else if (p === 1) { z.a = rd(getDE()); z.memptr = (getDE() + 1) & 0xffff; }
              else if (p === 2) { const nn = fetch16(); z.l = rd(nn); z.h = rd((nn + 1) & 0xffff); z.memptr = (nn + 1) & 0xffff; }
              else { const nn = fetch16(); z.a = rd(nn); z.memptr = (nn + 1) & 0xffff; }
            }
            break;
          case 3: setRP(p, (getRP(p) + (q ? -1 : 1)) & 0xffff); break;
          case 4: setR(y, inc8(getR(y))); break;
          case 5: setR(y, dec8(getR(y))); break;
          case 6: setR(y, fetch()); break;
          default:
            switch (y) {
              case 0: { const c = (z.a >> 7) & 1; z.a = ((z.a << 1) | c) & 255; z.f = (z.f & (FS | FZ | FPV)) | c | (z.a & (F3 | F5)); break; }
              case 1: { const c = z.a & 1; z.a = ((z.a >> 1) | (c << 7)) & 255; z.f = (z.f & (FS | FZ | FPV)) | c | (z.a & (F3 | F5)); break; }
              case 2: { const c = (z.a >> 7) & 1; z.a = ((z.a << 1) | (z.f & FC ? 1 : 0)) & 255; z.f = (z.f & (FS | FZ | FPV)) | c | (z.a & (F3 | F5)); break; }
              case 3: { const c = z.a & 1; z.a = ((z.a >> 1) | (z.f & FC ? 0x80 : 0)) & 255; z.f = (z.f & (FS | FZ | FPV)) | c | (z.a & (F3 | F5)); break; }
              case 4: daa(); break;
              case 5: z.a = (~z.a) & 255; z.f = (z.f & (FS | FZ | FPV | FC)) | FH | FN | (z.a & (F3 | F5)); break;
              case 6: z.f = (z.f & (FS | FZ | FPV)) | FC | (z.a & (F3 | F5)); break;
              default: z.f = (z.f & (FS | FZ | FPV)) | ((z.f & FC) ? FH : FC) | (z.a & (F3 | F5)); break;
            }
        }
        break;
      case 1:
        if (y === 6 && zz === 6) { z.halted = true; z.pc = (z.pc - 1) & 0xffff; }
        else setR(y, getR(zz));
        break;
      case 2: ALU[y](getR(zz)); break;
      default:
        switch (zz) {
          case 0: if (cond(y)) { z.pc = pop(); z.memptr = z.pc; z.t += 6; } break;
          case 1:
            if (q === 0) setRP2(p, pop());
            else if (p === 0) { z.pc = pop(); z.memptr = z.pc; }
            else if (p === 1) {                                    // EXX
              let t;
              t = z.b; z.b = z.b_; z.b_ = t; t = z.c; z.c = z.c_; z.c_ = t;
              t = z.d; z.d = z.d_; z.d_ = t; t = z.e; z.e = z.e_; z.e_ = t;
              t = z.h; z.h = z.h_; z.h_ = t; t = z.l; z.l = z.l_; z.l_ = t;
            }
            else if (p === 2) z.pc = getHL();
            else z.sp = getHL();
            break;
          case 2: { const nn = fetch16(); z.memptr = nn; if (cond(y)) z.pc = nn; break; }
          case 3:
            switch (y) {
              case 0: { const nn = fetch16(); z.pc = nn; z.memptr = nn; break; }
              case 1: doCB(); break;
              case 2: { const n = fetch(); const port = (z.a << 8) | n; outp(port, z.a); z.memptr = ((z.a << 8) | ((n + 1) & 255)); break; }
              case 3: { const n = fetch(); const port = (z.a << 8) | n; z.a = inp(port) & 255; z.memptr = (port + 1) & 0xffff; break; }
              case 4: {                                            // EX (SP),HL
                const lo = rd(z.sp), hi = rd((z.sp + 1) & 0xffff);
                wr(z.sp, z.l); wr((z.sp + 1) & 0xffff, z.h);
                z.l = lo; z.h = hi; z.memptr = getHL(); break;
              }
              case 5: { let t = z.d; z.d = z.h; z.h = t; t = z.e; z.e = z.l; z.l = t; break; }
              case 6: z.iff1 = z.iff2 = 0; break;
              default: z.iff1 = z.iff2 = 1; z.eiPending = true; break;
            }
            break;
          case 4: { const nn = fetch16(); z.memptr = nn; if (cond(y)) { push(z.pc); z.pc = nn; z.t += 7; } break; }
          case 5:
            if (q === 0) push(getRP2(p));
            else if (p === 0) { const nn = fetch16(); z.memptr = nn; push(z.pc); z.pc = nn; }
            else if (p === 1) doIndex(getIX, setIX, 'ixh', 'ixl');
            else if (p === 2) doED();
            else doIndex(getIY, setIY, 'iyh', 'iyl');
            break;
          case 6: ALU[y](fetch()); break;
          default: push(z.pc); z.pc = y * 8; z.memptr = z.pc; break;
        }
    }
    return z.t - t0;
  }

  /* maskable interrupt, once a frame on a Spectrum */
  function interrupt() {
    if (!z.iff1 || z.eiPending) return 0;
    if (z.halted) { z.halted = false; z.pc = (z.pc + 1) & 0xffff; }
    z.iff1 = z.iff2 = 0;
    bump();
    push(z.pc);
    if (z.im === 2) {
      const v = ((z.i << 8) | 0xff) & 0xffff;
      z.pc = rd(v) | (rd((v + 1) & 0xffff) << 8);
      z.t += 19; z.memptr = z.pc;
      return 19;
    }
    z.pc = 0x38; z.t += 13; z.memptr = 0x38;
    return 13;
  }

  function reset() {
    z.pc = 0; z.i = 0; z.r = 0; z.r7 = 0;
    z.iff1 = z.iff2 = 0; z.im = 0; z.halted = false;
    z.a = z.f = 0xff; z.sp = 0xffff; z.t = 0; z.eiPending = false;
  }

  return {
    state: z, step, interrupt, reset,
    get BC() { return getBC(); }, set BC(v) { setBC(v); },
    get DE() { return getDE(); }, set DE(v) { setDE(v); },
    get HL() { return getHL(); }, set HL(v) { setHL(v); },
    get IX() { return getIX(); }, set IX(v) { setIX(v); },
    get IY() { return getIY(); }, set IY(v) { setIY(v); }
  };
}
