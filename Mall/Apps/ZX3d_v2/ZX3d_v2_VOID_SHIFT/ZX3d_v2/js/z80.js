/* ==========================================================================
   z80.js -- a Zilog Z80 core.

   Complete documented instruction set including the DD/FD index prefixes and
   the ED and CB groups. Timings are the standard published figures; memory
   contention is left to the machine, which is close enough for tape work and
   for everything that does not chase the floating bus.
   ========================================================================== */
(function (ZX) {
  'use strict';

  var FC = 0x01, FN = 0x02, FPV = 0x04, F3 = 0x08, FH = 0x10, F5 = 0x20, FZ = 0x40, FS = 0x80;

  var SZ53 = new Uint8Array(256), SZ53P = new Uint8Array(256), PARITY = new Uint8Array(256);
  (function () {
    for (var k = 0; k < 256; k++) {
      var p = 0, v = k, j;
      for (j = 0; j < 8; j++) { p ^= v & 1; v >>= 1; }
      PARITY[k] = p ? 0 : FPV;
      SZ53[k] = (k & (F3 | F5 | FS)) | (k === 0 ? FZ : 0);
      SZ53P[k] = SZ53[k] | PARITY[k];
    }
  })();

  var HC_ADD = [0, FH, FH, FH, 0, 0, 0, FH];
  var HC_SUB = [0, 0, FH, 0, FH, 0, FH, FH];
  var OV_ADD = [0, 0, 0, FPV, FPV, 0, 0, 0];
  var OV_SUB = [0, FPV, 0, 0, 0, 0, FPV, 0];

  /* base T-states for the unprefixed opcodes */
  var TS = [
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

  /* ======================================================================== */

  ZX.Z80 = function (bus) {
    var A = 0, F = 0, B = 0, C = 0, D = 0, E = 0, H = 0, L = 0;
    var A_ = 0, F_ = 0, B_ = 0, C_ = 0, D_ = 0, E_ = 0, H_ = 0, L_ = 0;
    var IXH = 0, IXL = 0, IYH = 0, IYL = 0;
    var I = 0, R = 0, R7 = 0;
    var PC = 0, SP = 0xFFFF;
    var IFF1 = 0, IFF2 = 0, IM = 0, halted = 0;
    var T = 0;
    var memptr = 0;

    var rd = bus.read, wr = bus.write, pin = bus.in, pout = bus.out;

    function fetch() { var v = rd(PC); PC = (PC + 1) & 0xFFFF; return v; }
    function fetch16() { var lo = fetch(); return lo | (fetch() << 8); }
    function rd16(ad) { return rd(ad) | (rd((ad + 1) & 0xFFFF) << 8); }
    function wr16(ad, v) { wr(ad, v & 255); wr((ad + 1) & 0xFFFF, (v >> 8) & 255); }
    function push(v) { SP = (SP - 1) & 0xFFFF; wr(SP, (v >> 8) & 255); SP = (SP - 1) & 0xFFFF; wr(SP, v & 255); }
    function pop() { var v = rd(SP) | (rd((SP + 1) & 0xFFFF) << 8); SP = (SP + 2) & 0xFFFF; return v; }
    function bumpR() { R = (R + 1) & 0x7F; }

    function HL() { return (H << 8) | L; }
    function setHL(v) { H = (v >> 8) & 255; L = v & 255; }
    function IX() { return (IXH << 8) | IXL; }
    function IY() { return (IYH << 8) | IYL; }

    /* ---- ALU ------------------------------------------------------------ */
    function add8(v) {
      var r = A + v;
      var lk = ((A & 0x88) >> 3) | ((v & 0x88) >> 2) | ((r & 0x88) >> 1);
      A = r & 255;
      F = (r & 0x100 ? FC : 0) | HC_ADD[lk & 7] | OV_ADD[lk >> 4] | SZ53[A];
    }
    function adc8(v) {
      var r = A + v + (F & FC);
      var lk = ((A & 0x88) >> 3) | ((v & 0x88) >> 2) | ((r & 0x88) >> 1);
      A = r & 255;
      F = (r & 0x100 ? FC : 0) | HC_ADD[lk & 7] | OV_ADD[lk >> 4] | SZ53[A];
    }
    function sub8(v) {
      var r = A - v;
      var lk = ((A & 0x88) >> 3) | ((v & 0x88) >> 2) | ((r & 0x88) >> 1);
      A = r & 255;
      F = (r & 0x100 ? FC : 0) | FN | HC_SUB[lk & 7] | OV_SUB[lk >> 4] | SZ53[A];
    }
    function sbc8(v) {
      var r = A - v - (F & FC);
      var lk = ((A & 0x88) >> 3) | ((v & 0x88) >> 2) | ((r & 0x88) >> 1);
      A = r & 255;
      F = (r & 0x100 ? FC : 0) | FN | HC_SUB[lk & 7] | OV_SUB[lk >> 4] | SZ53[A];
    }
    function and8(v) { A &= v; F = FH | SZ53P[A]; }
    function xor8(v) { A ^= v; F = SZ53P[A]; }
    function or8(v) { A |= v; F = SZ53P[A]; }
    function cp8(v) {
      var r = (A - v) & 0x1FF;
      var lk = ((A & 0x88) >> 3) | ((v & 0x88) >> 2) | ((r & 0x88) >> 1);
      F = (r & 0x100 ? FC : 0) | FN | HC_SUB[lk & 7] | OV_SUB[lk >> 4] |
          (v & (F3 | F5)) | (r & 255 ? 0 : FZ) | (r & FS);
    }
    function inc8(v) {
      v = (v + 1) & 255;
      F = (F & FC) | (v === 0x80 ? FPV : 0) | ((v & 0x0F) ? 0 : FH) | SZ53[v];
      return v;
    }
    function dec8(v) {
      F = (F & FC) | ((v & 0x0F) ? 0 : FH) | FN;
      v = (v - 1) & 255;
      F |= (v === 0x7F ? FPV : 0) | SZ53[v];
      return v;
    }
    function add16(a1, a2) {
      var r = a1 + a2;
      var lk = ((a1 & 0x0800) >> 11) | ((a2 & 0x0800) >> 10) | ((r & 0x0800) >> 9);
      F = (F & (FPV | FZ | FS)) | (r & 0x10000 ? FC : 0) |
          ((r >> 8) & (F3 | F5)) | HC_ADD[lk];
      return r & 0xFFFF;
    }
    function adc16(v) {
      var hl = HL(), r = hl + v + (F & FC);
      var lk = ((hl & 0x8800) >> 11) | ((v & 0x8800) >> 10) | ((r & 0x8800) >> 9);
      setHL(r & 0xFFFF);
      F = (r & 0x10000 ? FC : 0) | OV_ADD[lk >> 4] | (H & (F3 | F5 | FS)) |
          (HL() ? 0 : FZ) | HC_ADD[lk & 7];
    }
    function sbc16(v) {
      var hl = HL(), r = hl - v - (F & FC);
      var lk = ((hl & 0x8800) >> 11) | ((v & 0x8800) >> 10) | ((r & 0x8800) >> 9);
      setHL(r & 0xFFFF);
      F = (r & 0x10000 ? FC : 0) | FN | OV_SUB[lk >> 4] | (H & (F3 | F5 | FS)) |
          (HL() ? 0 : FZ) | HC_SUB[lk & 7];
    }
    function daa() {
      var add = 0, carry = F & FC, t;
      if ((F & FH) || ((A & 0x0F) > 9)) add = 6;
      if (carry || A > 0x99) add |= 0x60;
      if (A > 0x99) carry = FC;
      t = A;
      if (F & FN) sub8(add); else add8(add);
      F = (F & ~(FC | FPV)) | carry | PARITY[A];
      void t;
    }
    function neg() { var v = A; A = 0; sub8(v); }

    /* rotates and shifts -------------------------------------------------- */
    function rlc(v) { v = ((v << 1) | (v >> 7)) & 255; F = (v & FC) | SZ53P[v]; return v; }
    function rrc(v) { F = v & FC; v = ((v >> 1) | (v << 7)) & 255; F |= SZ53P[v]; return v; }
    function rl(v) { var c = v >> 7; v = ((v << 1) | (F & FC)) & 255; F = c | SZ53P[v]; return v; }
    function rr(v) { var c = v & FC; v = ((v >> 1) | ((F & FC) << 7)) & 255; F = c | SZ53P[v]; return v; }
    function sla(v) { var c = v >> 7; v = (v << 1) & 255; F = c | SZ53P[v]; return v; }
    function sra(v) { var c = v & FC; v = ((v >> 1) | (v & 0x80)) & 255; F = c | SZ53P[v]; return v; }
    function sll(v) { var c = v >> 7; v = ((v << 1) | 1) & 255; F = c | SZ53P[v]; return v; }
    function srl(v) { var c = v & FC; v = (v >> 1) & 255; F = c | SZ53P[v]; return v; }
    function bit(n, v) {
      F = (F & FC) | FH | (v & (F3 | F5));
      if (!(v & (1 << n))) F |= FPV | FZ;
      if (n === 7 && (v & 0x80)) F |= FS;
    }

    /* ---- register file access ------------------------------------------- */
    // idx: 0 none, 1 IX, 2 IY.  `sub` says whether H/L become IXh/IXl.
    function getR(i, idx, disp, sub) {
      switch (i) {
        case 0: return B; case 1: return C; case 2: return D; case 3: return E;
        case 4: return sub ? (idx === 1 ? IXH : IYH) : H;
        case 5: return sub ? (idx === 1 ? IXL : IYL) : L;
        case 6: return rd(idx ? (((idx === 1 ? IX() : IY()) + disp) & 0xFFFF) : HL());
        default: return A;
      }
    }
    function setR(i, v, idx, disp, sub) {
      v &= 255;
      switch (i) {
        case 0: B = v; break; case 1: C = v; break; case 2: D = v; break; case 3: E = v; break;
        case 4: if (sub) { if (idx === 1) IXH = v; else IYH = v; } else H = v; break;
        case 5: if (sub) { if (idx === 1) IXL = v; else IYL = v; } else L = v; break;
        case 6: wr(idx ? (((idx === 1 ? IX() : IY()) + disp) & 0xFFFF) : HL(), v); break;
        default: A = v;
      }
    }
    function getRP(p, idx) {
      switch (p) {
        case 0: return (B << 8) | C;
        case 1: return (D << 8) | E;
        case 2: return idx === 1 ? IX() : idx === 2 ? IY() : HL();
        default: return SP;
      }
    }
    function setRP(p, v, idx) {
      v &= 0xFFFF;
      switch (p) {
        case 0: B = v >> 8; C = v & 255; break;
        case 1: D = v >> 8; E = v & 255; break;
        case 2:
          if (idx === 1) { IXH = v >> 8; IXL = v & 255; }
          else if (idx === 2) { IYH = v >> 8; IYL = v & 255; }
          else setHL(v);
          break;
        default: SP = v;
      }
    }
    function cond(y) {
      switch (y) {
        case 0: return !(F & FZ); case 1: return !!(F & FZ);
        case 2: return !(F & FC); case 3: return !!(F & FC);
        case 4: return !(F & FPV); case 5: return !!(F & FPV);
        case 6: return !(F & FS); default: return !!(F & FS);
      }
    }
    function alu(y, v) {
      switch (y) {
        case 0: add8(v); break; case 1: adc8(v); break; case 2: sub8(v); break;
        case 3: sbc8(v); break; case 4: and8(v); break; case 5: xor8(v); break;
        case 6: or8(v); break; default: cp8(v);
      }
    }
    function shiftOp(y, v) {
      switch (y) {
        case 0: return rlc(v); case 1: return rrc(v); case 2: return rl(v);
        case 3: return rr(v); case 4: return sla(v); case 5: return sra(v);
        case 6: return sll(v); default: return srl(v);
      }
    }

    /* ---- CB ------------------------------------------------------------- */
    function doCB() {
      var op = fetch(); bumpR();
      var x = op >> 6, y = (op >> 3) & 7, z = op & 7;
      var v = getR(z, 0, 0, false);
      if (x === 0) { setR(z, shiftOp(y, v), 0, 0, false); T += z === 6 ? 15 : 8; return; }
      if (x === 1) { bit(y, v); F = (F & ~(F3 | F5)) | (z === 6 ? ((memptr >> 8) & (F3 | F5)) : (v & (F3 | F5))); T += z === 6 ? 12 : 8; return; }
      if (x === 2) setR(z, v & ~(1 << y), 0, 0, false);
      else setR(z, v | (1 << y), 0, 0, false);
      T += z === 6 ? 15 : 8;
    }

    /* DD CB d op / FD CB d op: operate on (IX+d), optionally copying to a register */
    function doIdxCB(idx) {
      var disp = (fetch() ^ 0x80) - 0x80;
      var op = fetch();
      var addr = (((idx === 1 ? IX() : IY()) + disp) & 0xFFFF);
      memptr = addr;
      var x = op >> 6, y = (op >> 3) & 7, z = op & 7;
      var v = rd(addr);
      if (x === 1) {
        bit(y, v);
        F = (F & ~(F3 | F5)) | ((addr >> 8) & (F3 | F5));
        T += 20; return;
      }
      var res;
      if (x === 0) res = shiftOp(y, v);
      else if (x === 2) res = v & ~(1 << y);
      else res = v | (1 << y);
      wr(addr, res);
      if (z !== 6) setR(z, res, 0, 0, false);
      T += 23;
    }

    /* ---- ED ------------------------------------------------------------- */
    function doED() {
      var op = fetch(); bumpR();
      var x = op >> 6, y = (op >> 3) & 7, z = op & 7, p = y >> 1, q = y & 1;

      if (x === 1) {
        switch (z) {
          case 0: {                                 // IN r,(C)
            var v = pin((B << 8) | C) & 255;
            if (y !== 6) setR(y, v, 0, 0, false);
            F = (F & FC) | SZ53P[v];
            T += 12; return;
          }
          case 1:                                   // OUT (C),r
            pout((B << 8) | C, y === 6 ? 0 : getR(y, 0, 0, false));
            T += 12; return;
          case 2:
            if (q) adc16(getRP(p, 0)); else sbc16(getRP(p, 0));
            T += 15; return;
          case 3: {
            var ad = fetch16();
            if (q) setRP(p, rd16(ad), 0); else wr16(ad, getRP(p, 0));
            T += 20; return;
          }
          case 4: neg(); T += 8; return;
          case 5:                                   // RETN / RETI
            IFF1 = IFF2; PC = pop(); T += 14; return;
          case 6:
            IM = (y === 0 || y === 1 || y === 4 || y === 5) ? 0 : (y === 2 || y === 6) ? 1 : 2;
            T += 8; return;
          default:
            switch (y) {
              case 0: I = A; T += 9; return;
              case 1: R = A & 0x7F; R7 = A & 0x80; T += 9; return;
              case 2: A = I; F = (F & FC) | SZ53[A] | (IFF2 ? FPV : 0); T += 9; return;
              case 3: A = (R & 0x7F) | R7; F = (F & FC) | SZ53[A] | (IFF2 ? FPV : 0); T += 9; return;
              case 4: {                             // RRD
                var m = rd(HL());
                wr(HL(), ((m >> 4) | (A << 4)) & 255);
                A = (A & 0xF0) | (m & 0x0F);
                F = (F & FC) | SZ53P[A]; T += 18; return;
              }
              case 5: {                             // RLD
                var m2 = rd(HL());
                wr(HL(), ((m2 << 4) | (A & 0x0F)) & 255);
                A = (A & 0xF0) | (m2 >> 4);
                F = (F & FC) | SZ53P[A]; T += 18; return;
              }
              default: T += 8; return;              // NOP variants
            }
        }
      }

      if (x === 2 && z <= 3 && y >= 4) { doBlock(y, z); return; }
      // Undefined ED opcodes are NOPs on real hardware; the machine may claim
      // one as a trap (that is how instant tape loading gets its hook in).
      if (bus.edhook) bus.edhook(op);
      T += 8;
    }

    function doBlock(y, z) {
      var inc = (y & 1) ? -1 : 1;                   // y 4,6 = up   y 5,7 = down
      var rep = y >= 6;
      var hl = HL(), de = (D << 8) | E, bc = (B << 8) | C, v;

      if (z === 0) {                                // LDI/LDD/LDIR/LDDR
        v = rd(hl); wr(de, v);
        setHL((hl + inc) & 0xFFFF);
        de = (de + inc) & 0xFFFF; D = de >> 8; E = de & 255;
        bc = (bc - 1) & 0xFFFF; B = bc >> 8; C = bc & 255;
        var n1 = (v + A) & 255;
        F = (F & (FC | FZ | FS)) | (bc ? FPV : 0) | (n1 & F3) | ((n1 & 0x02) ? F5 : 0);
        T += 16;
        if (rep && bc) { PC = (PC - 2) & 0xFFFF; T += 5; }
        return;
      }
      if (z === 1) {                                // CPI/CPD/CPIR/CPDR
        v = rd(hl);
        var r = (A - v) & 0xFF;
        var lk = ((A & 0x08) >> 3) | ((v & 0x08) >> 2) | ((r & 0x08) >> 1);
        setHL((hl + inc) & 0xFFFF);
        bc = (bc - 1) & 0xFFFF; B = bc >> 8; C = bc & 255;
        F = (F & FC) | FN | (bc ? FPV : 0) | HC_SUB[lk] | (r ? 0 : FZ) | (r & FS);
        if (F & FH) r = (r - 1) & 255;
        F |= (r & F3) | ((r & 0x02) ? F5 : 0);
        T += 16;
        if (rep && bc && r !== 0 && !(F & FZ)) { PC = (PC - 2) & 0xFFFF; T += 5; }
        return;
      }
      if (z === 2) {                                // INI/IND/INIR/INDR
        v = pin(bc) & 255;
        wr(hl, v);
        B = (B - 1) & 255;
        setHL((hl + inc) & 0xFFFF);
        F = (v & 0x80 ? FN : 0) | SZ53[B];
        T += 16;
        if (rep && B) { PC = (PC - 2) & 0xFFFF; T += 5; }
        return;
      }
      // OUTI/OUTD/OTIR/OTDR
      v = rd(hl);
      B = (B - 1) & 255;
      setHL((hl + inc) & 0xFFFF);
      pout((B << 8) | C, v);
      F = (v & 0x80 ? FN : 0) | SZ53[B];
      T += 16;
      if (rep && B) { PC = (PC - 2) & 0xFFFF; T += 5; }
    }

    /* ---- main ------------------------------------------------------------ */
    function doMain(op, idx) {
      var x = op >> 6, y = (op >> 3) & 7, z = op & 7, p = y >> 1, q = y & 1;
      var disp = 0, sub = idx !== 0;
      T += TS[op] + (idx ? 4 : 0);

      // an index prefix with (HL) picks up a displacement byte first
      var needDisp = idx && ((x === 1 && (y === 6 || z === 6)) ||
                             (x === 2 && z === 6) ||
                             (x === 0 && z === 6 && y === 6) ||
                             (x === 0 && (z === 4 || z === 5) && y === 6));
      if (needDisp) { disp = (fetch() ^ 0x80) - 0x80; T += 8; }

      switch (x) {
        case 0:
          switch (z) {
            case 0:
              if (y === 0) return;
              if (y === 1) { var t1 = A; A = A_; A_ = t1; t1 = F; F = F_; F_ = t1; return; }
              if (y === 2) {                                    // DJNZ
                var d = (fetch() ^ 0x80) - 0x80;
                B = (B - 1) & 255;
                if (B) { PC = (PC + d) & 0xFFFF; T += 5; }
                return;
              }
              if (y === 3) { var d2 = (fetch() ^ 0x80) - 0x80; PC = (PC + d2) & 0xFFFF; return; }
              var d3 = (fetch() ^ 0x80) - 0x80;
              if (cond(y - 4)) { PC = (PC + d3) & 0xFFFF; T += 5; }
              return;

            case 1:
              if (q === 0) setRP(p, fetch16(), idx);
              else setRP(2, add16(getRP(2, idx), getRP(p, idx)), idx);
              return;

            case 2:
              if (q === 0) {
                if (p === 0) wr((B << 8) | C, A);
                else if (p === 1) wr((D << 8) | E, A);
                else if (p === 2) wr16(fetch16(), getRP(2, idx));
                else wr(fetch16(), A);
              } else {
                if (p === 0) A = rd((B << 8) | C);
                else if (p === 1) A = rd((D << 8) | E);
                else if (p === 2) setRP(2, rd16(fetch16()), idx);
                else A = rd(fetch16());
              }
              return;

            case 3:
              setRP(p, getRP(p, idx) + (q ? -1 : 1), idx);
              return;

            case 4: setR(y, inc8(getR(y, idx, disp, sub)), idx, disp, sub); return;
            case 5: setR(y, dec8(getR(y, idx, disp, sub)), idx, disp, sub); return;
            case 6: setR(y, fetch(), idx, disp, sub); return;

            default:
              switch (y) {
                case 0: { var c0 = A >> 7; A = ((A << 1) | c0) & 255; F = (F & (FPV | FZ | FS)) | c0 | (A & (F3 | F5)); return; }
                case 1: { var c1 = A & 1; A = ((A >> 1) | (c1 << 7)) & 255; F = (F & (FPV | FZ | FS)) | c1 | (A & (F3 | F5)); return; }
                case 2: { var c2 = A >> 7; A = ((A << 1) | (F & FC)) & 255; F = (F & (FPV | FZ | FS)) | c2 | (A & (F3 | F5)); return; }
                case 3: { var c3 = A & 1; A = ((A >> 1) | ((F & FC) << 7)) & 255; F = (F & (FPV | FZ | FS)) | c3 | (A & (F3 | F5)); return; }
                case 4: daa(); return;
                case 5: A = (~A) & 255; F = (F & (FC | FPV | FZ | FS)) | FH | FN | (A & (F3 | F5)); return;
                case 6: F = (F & (FPV | FZ | FS)) | FC | (A & (F3 | F5)); return;
                default: F = (F & (FPV | FZ | FS)) | ((F & FC) ? FH : FC) | (A & (F3 | F5)); return;
              }
          }

        case 1:
          if (y === 6 && z === 6) { halted = 1; PC = (PC - 1) & 0xFFFF; return; }
          if (idx && (y === 6 || z === 6)) {
            // only the memory side is indexed; the register side stays H or L
            if (y === 6) setR(6, getR(z, idx, disp, false), idx, disp, false);
            else setR(y, getR(6, idx, disp, false), 0, 0, false);
            return;
          }
          setR(y, getR(z, idx, disp, sub), idx, disp, sub);
          return;

        case 2:
          alu(y, getR(z, idx, disp, sub));
          return;

        default:
          switch (z) {
            case 0: if (cond(y)) { PC = pop(); T += 6; } return;
            case 1:
              if (q === 0) {
                if (p === 3) { var v = pop(); A = v >> 8; F = v & 255; }
                else setRP(p, pop(), idx);
              } else {
                if (p === 0) PC = pop();
                else if (p === 1) {
                  var t;
                  t = B; B = B_; B_ = t; t = C; C = C_; C_ = t;
                  t = D; D = D_; D_ = t; t = E; E = E_; E_ = t;
                  t = H; H = H_; H_ = t; t = L; L = L_; L_ = t;
                } else if (p === 2) PC = getRP(2, idx);
                else SP = getRP(2, idx);
              }
              return;
            case 2: { var a2 = fetch16(); if (cond(y)) PC = a2; return; }
            case 3:
              switch (y) {
                case 0: PC = fetch16(); return;
                case 1: if (idx) doIdxCB(idx); else doCB(); return;
                case 2: { var pt = fetch(); pout((A << 8) | pt, A); return; }
                case 3: { var pt2 = fetch(); A = pin((A << 8) | pt2) & 255; return; }
                case 4: {                                    // EX (SP),HL/IX/IY
                  var old = getRP(2, idx), nv = rd16(SP);
                  wr16(SP, old); setRP(2, nv, idx); return;
                }
                case 5: {                                    // EX DE,HL
                  var t2 = D; D = H; H = t2; t2 = E; E = L; L = t2; return;
                }
                case 6: IFF1 = IFF2 = 0; return;
                default: IFF1 = IFF2 = 1; justEnabled = true; return;
              }
            case 4: {
              var a4 = fetch16();
              if (cond(y)) { push(PC); PC = a4; T += 7; }
              return;
            }
            case 5:
              if (q === 0) {
                if (p === 3) push((A << 8) | F);
                else push(getRP(p, idx));
              } else {
                if (p === 0) { var a5 = fetch16(); push(PC); PC = a5; }
                // DD/ED/FD are consumed by step(), never reaching here
              }
              return;
            case 6: alu(y, fetch()); return;
            default: push(PC); PC = y * 8; return;
          }
      }
    }

    var justEnabled = false;

    function step() {
      justEnabled = false;
      var idx = 0, op;
      for (;;) {
        op = fetch(); bumpR();
        if (op === 0xDD) { idx = 1; T += 4; continue; }
        if (op === 0xFD) { idx = 2; T += 4; continue; }
        if (op === 0xED) { doED(); return; }
        if (op === 0xCB) { if (idx) { doIdxCB(idx); T += 4; } else doCB(); return; }
        doMain(op, idx);
        return;
      }
    }

    function interrupt() {
      if (!IFF1 || justEnabled) return false;
      if (halted) { halted = 0; PC = (PC + 1) & 0xFFFF; }
      IFF1 = IFF2 = 0;
      bumpR();
      push(PC);
      if (IM === 2) {
        var vec = (I << 8) | 0xFF;
        PC = rd16(vec);
        T += 19;
      } else {
        PC = 0x0038;
        T += 13;
      }
      return true;
    }

    function reset() {
      A = F = B = C = D = E = H = L = 0xFF;
      A_ = F_ = B_ = C_ = D_ = E_ = H_ = L_ = 0xFF;
      IXH = IXL = IYH = IYL = 0xFF;
      I = R = R7 = 0; PC = 0; SP = 0xFFFF;
      IFF1 = IFF2 = 0; IM = 0; halted = 0; T = 0;
    }

    return {
      step: step,
      interrupt: interrupt,
      reset: reset,
      /** Run until the T-state counter reaches `target`. */
      run: function (target) {
        while (T < target) {
          if (halted) { T += 4; bumpR(); continue; }
          step();
        }
      },
      get t() { return T; },
      set t(v) { T = v; },
      get halted() { return halted; },
      getState: function () {
        return {
          a: A, f: F, b: B, c: C, d: D, e: E, h: H, l: L,
          a_: A_, f_: F_, b_: B_, c_: C_, d_: D_, e_: E_, h_: H_, l_: L_,
          ix: IX(), iy: IY(), i: I, r: (R & 0x7F) | R7,
          pc: PC, sp: SP, iff1: IFF1, iff2: IFF2, im: IM, halted: halted, t: T
        };
      },
      setState: function (s) {
        A = s.a & 255; F = s.f & 255; B = s.b & 255; C = s.c & 255;
        D = s.d & 255; E = s.e & 255; H = s.h & 255; L = s.l & 255;
        A_ = s.a_ & 255; F_ = s.f_ & 255; B_ = s.b_ & 255; C_ = s.c_ & 255;
        D_ = s.d_ & 255; E_ = s.e_ & 255; H_ = s.h_ & 255; L_ = s.l_ & 255;
        IXH = (s.ix >> 8) & 255; IXL = s.ix & 255;
        IYH = (s.iy >> 8) & 255; IYL = s.iy & 255;
        I = s.i & 255; R = s.r & 0x7F; R7 = s.r & 0x80;
        PC = s.pc & 0xFFFF; SP = s.sp & 0xFFFF;
        IFF1 = s.iff1 ? 1 : 0; IFF2 = s.iff2 ? 1 : 0;
        IM = s.im | 0; halted = s.halted ? 1 : 0;
        if (s.t !== undefined) T = s.t;
      }
    };
  };

})(window.ZX = window.ZX || {});
