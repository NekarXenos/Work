/* ==========================================================================
   spectrum.js -- a 48K Spectrum wrapped around the Z80.

   Runs real software: .tap (fast-loaded through a ROM trap, or through a
   ROM-less turbo loader when no ROM image is present), .sna and .z80.
   Its 256x192 display can be projected into the solid world as a slab of
   voxels one block deep.
   ========================================================================== */
(function (ZX) {
  'use strict';

  var TS_FRAME = 69888;

  /* ---- the keyboard matrix ----------------------------------------------- */
  var MATRIX = [
    ['CAPSSHIFT', 'Z', 'X', 'C', 'V'],
    ['A', 'S', 'D', 'F', 'G'],
    ['Q', 'W', 'E', 'R', 'T'],
    ['1', '2', '3', '4', '5'],
    ['0', '9', '8', '7', '6'],
    ['P', 'O', 'I', 'U', 'Y'],
    ['ENTER', 'L', 'K', 'J', 'H'],
    ['SPACE', 'SYMSHIFT', 'M', 'N', 'B']
  ];

  /* ---- a compact substitute ROM ------------------------------------------
     Enough to sit still, service a 50 Hz interrupt and keep FRAMES ticking,
     which is all most snapshots actually ask of the ROM.                    */
  function stubRom() {
    var r = new Uint8Array(16384);
    r.fill(0xFF);
    // reset: DI / LD SP,$FFFF / IM 1 / EI / loop
    var boot = [0xF3, 0x31, 0xFF, 0xFF, 0xED, 0x56, 0xFB, 0x18, 0xFE];
    r.set(boot, 0x0000);
    // 0x0038 interrupt: bump the 24-bit FRAMES counter at 23672 and return
    var isr = [
      0xF5, 0xC5, 0xE5,             // PUSH AF / BC / HL
      0x21, 0x78, 0x5C,             // LD HL,23672
      0x34, 0x20, 0x06,             // INC (HL) / JR NZ,done
      0x23, 0x34, 0x20, 0x02,       // INC HL / INC (HL) / JR NZ,done
      0x23, 0x34,                   // INC HL / INC (HL)
      0xE1, 0xC1, 0xF1,             // done: POP HL / BC / AF
      0xFB, 0xC9                    // EI / RET
    ];
    r.set(isr, 0x0038);
    r.set([0xED, 0x45], 0x0066);    // NMI: RETN
    r.set([0xED, 0xF0, 0xC9], 0x0556); // LD_BYTES: trap, then RET
    return r;
  }

  /* ======================================================================== */

  function Spectrum(env) {
    this.env = env;
    this.mem = new Uint8Array(65536);
    ZX.Mem.claim('spectrum', 65536 + 49152);

    this.romLoaded = false;
    this.installRom(stubRom());

    this.keys = new Uint8Array(8).fill(0x1F);
    this.kempston = 0;
    this.border = 0;
    this.speaker = 0;
    this.earBit = 0;

    this.frame = 0;
    this.flashPhase = 0;
    this.running = false;

    this.pixels = new Uint8Array(256 * 192);
    this.tapeBlocks = null;
    this.tapePos = 0;
    this.trapLoad = true;

    this.audio = null;
    this.edges = [];

    var self = this;
    this.bus = {
      read: function (a) { return self.mem[a & 0xFFFF]; },
      write: function (a, v) { a &= 0xFFFF; if (a >= 0x4000) self.mem[a] = v & 255; },
      in: function (p) { return self.portIn(p); },
      out: function (p, v) { self.portOut(p, v); },
      edhook: function (op) { return self.edHook(op); }
    };
    this.cpu = ZX.Z80(this.bus);
    this.cpu.reset();
  }
  ZX.Spectrum = Spectrum;

  Spectrum.prototype.installRom = function (bytes) {
    this.mem.set(bytes.subarray(0, 16384), 0);
    this.rom = bytes.subarray(0, 16384).slice();
  };

  Spectrum.prototype.loadRomImage = function (bytes) {
    if (bytes.length < 16384) return false;
    var r = bytes.slice(0, 16384);
    // Patch LD_BYTES so standard tape blocks land instantly instead of in
    // real time. The original bytes are never needed again.
    r[0x0556] = 0xED; r[0x0557] = 0xF0; r[0x0558] = 0xC9;
    this.installRom(r);
    this.romLoaded = true;
    this.reset();
    return true;
  };

  Spectrum.prototype.reset = function () {
    this.mem.set(this.rom, 0);
    this.mem.fill(0, 16384);
    this.cpu.reset();
    this.cpu.setState({ a: 0xFF, f: 0xFF, b: 0, c: 0, d: 0, e: 0, h: 0, l: 0,
      a_: 0, f_: 0, b_: 0, c_: 0, d_: 0, e_: 0, h_: 0, l_: 0,
      ix: 0, iy: 0x5C3A, i: 0x3F, r: 0, pc: 0, sp: 0xFFFF,
      iff1: 0, iff2: 0, im: 1, halted: 0, t: 0 });
    this.border = 7;
    this.tapePos = 0;
  };

  /* ---- ports -------------------------------------------------------------- */

  Spectrum.prototype.portIn = function (port) {
    if ((port & 0x01) === 0) {                   // ULA
      var res = 0x1F;
      var hi = (port >> 8) & 0xFF;
      for (var r = 0; r < 8; r++) {
        if (!(hi & (1 << r))) res &= this.keys[r];
      }
      return res | 0xA0 | (this.earBit ? 0x40 : 0);
    }
    if ((port & 0xFF) === 0x1F) return this.kempston;
    return 0xFF;
  };

  Spectrum.prototype.portOut = function (port, v) {
    if ((port & 0x01) === 0) {
      this.border = v & 7;
      var spk = (v >> 4) & 1;
      if (spk !== this.speaker) {
        this.speaker = spk;
        this.edges.push(this.cpu.t, spk);
      }
    }
  };

  /* ---- ROM trap: instant tape load --------------------------------------- */

  Spectrum.prototype.edHook = function (op) {
    if (op !== 0xF0) return false;
    var s = this.cpu.getState();

    var blk = this.nextTapeBlock();
    if (!blk) { s.f &= ~0x01; this.cpu.setState(s); return true; }

    var wantFlag = s.a;
    var len = ((s.d << 8) | s.e);
    var addr = s.ix;
    var verify = !(s.f & 0x01);

    if (blk[0] !== wantFlag) {                   // wrong block type: keep looking
      s.f &= ~0x01; this.cpu.setState(s); return true;
    }
    var body = blk.subarray(1, blk.length - 1);
    var n = Math.min(len, body.length);
    if (!verify) {
      for (var i = 0; i < n; i++) {
        var a = (addr + i) & 0xFFFF;
        if (a >= 0x4000) this.mem[a] = body[i];
      }
    }
    s.ix = (addr + n) & 0xFFFF;
    s.d = 0; s.e = 0;
    s.f |= 0x01;                                 // carry: loaded cleanly
    s.h = blk[blk.length - 1];
    this.cpu.setState(s);
    return true;
  };

  Spectrum.prototype.nextTapeBlock = function () {
    if (!this.tapeBlocks || this.tapePos >= this.tapeBlocks.length) return null;
    return this.tapeBlocks[this.tapePos++];
  };

  /* ---- loading ------------------------------------------------------------ */

  /** Split a .tap image into raw blocks (flag byte .. checksum inclusive). */
  Spectrum.prototype.splitTap = function (bytes) {
    var out = [], p = 0;
    while (p + 2 <= bytes.length) {
      var len = bytes[p] | (bytes[p + 1] << 8);
      p += 2;
      if (len < 2 || p + len > bytes.length) break;
      out.push(bytes.subarray(p, p + len));
      p += len;
    }
    return out;
  };

  Spectrum.prototype.insertTap = function (bytes) {
    this.tapeBlocks = this.splitTap(bytes);
    this.tapePos = 0;
    return this.tapeBlocks.length;
  };

  /**
   * Start a .tap. With a real ROM we boot it and let LOAD "" do the work
   * (the trap makes it instant). Without one, read the BASIC loader
   * ourselves, drop the CODE blocks where their headers say, and jump to
   * the address the loader would have used.
   */
  Spectrum.prototype.startTap = function (bytes) {
    this.reset();
    this.insertTap(bytes);
    if (this.romLoaded) {
      // Type LOAD "" <ENTER> for the user by poking the keyword straight in.
      this.autoType = ['J', 'SYMSHIFT+P', 'SYMSHIFT+P', 'ENTER'];
      this.autoTypeAt = 60;
      this.running = true;
      return { mode: 'rom' };
    }
    return this.turboLoad();
  };

  Spectrum.prototype.turboLoad = function () {
    var blocks = this.tapeBlocks || [];
    var start = null, i, j;

    for (i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      if (b[0] !== 0x00 || b.length < 19) continue;       // want a header
      var type = b[1];
      var length = b[12] | (b[13] << 8);
      var p1 = b[14] | (b[15] << 8);
      var body = blocks[i + 1];
      if (!body || body[0] !== 0xFF) continue;
      var data = body.subarray(1, body.length - 1);

      if (type === 3) {                                    // CODE
        var addr = p1;
        for (j = 0; j < data.length && j < length; j++) {
          var a = (addr + j) & 0xFFFF;
          if (a >= 0x4000) this.mem[a] = data[j];
        }
        if (start === null && addr >= 0x8000 && addr < 0xFF00) { /* candidate */ }
      } else if (type === 0) {                             // BASIC loader
        var varsAt = b[16] | (b[17] << 8);
        var src = ZX.detokenise(data, 0, Math.min(varsAt || data.length, data.length));
        var m = src.match(/USR\s*([0-9]+)/i);
        if (m) start = parseInt(m[1], 10);
        var m2 = src.match(/RANDOMIZE\s*USR\s*([0-9]+)/i);
        if (m2) start = parseInt(m2[1], 10);
      }
      i++;                                                 // skip the data block
    }

    if (start === null) {
      // Last resort: the longest CODE block's load address.
      var best = -1, bestLen = 0;
      for (i = 0; i < blocks.length; i++) {
        var h = blocks[i];
        if (h[0] !== 0x00 || h.length < 19 || h[1] !== 3) continue;
        var ln = h[12] | (h[13] << 8);
        if (ln > bestLen) { bestLen = ln; best = h[14] | (h[15] << 8); }
      }
      start = best;
    }
    if (start === null || start < 0) return { mode: 'failed' };

    var s = this.cpu.getState();
    s.pc = start & 0xFFFF;
    s.sp = 0xFF00;
    s.iff1 = 0; s.iff2 = 0; s.im = 1;
    s.i = 0x3F;
    this.cpu.setState(s);
    this.running = true;
    return { mode: 'turbo', start: start };
  };

  /* ---- snapshots ---------------------------------------------------------- */

  Spectrum.prototype.loadSna = function (b) {
    if (b.length < 27 + 49152) return false;
    var g = function (o) { return b[o] | (b[o + 1] << 8); };
    var s = {
      i: b[0],
      h_: b[2], l_: b[1], d_: b[4], e_: b[3], b_: b[6], c_: b[5],
      a_: b[8], f_: b[7],
      h: b[10], l: b[9], d: b[12], e: b[11], b: b[14], c: b[13],
      iy: g(15), ix: g(17),
      iff1: (b[19] & 4) ? 1 : 0, iff2: (b[19] & 4) ? 1 : 0,
      r: b[20], a: b[22], f: b[21],
      sp: g(23), im: b[25] & 3, halted: 0, pc: 0, t: 0
    };
    this.border = b[26] & 7;
    for (var i = 0; i < 49152; i++) this.mem[0x4000 + i] = b[27 + i];
    // .sna keeps PC on the stack
    var sp = s.sp;
    s.pc = this.mem[sp] | (this.mem[(sp + 1) & 0xFFFF] << 8);
    s.sp = (sp + 2) & 0xFFFF;
    this.cpu.setState(s);
    this.running = true;
    return true;
  };

  Spectrum.prototype.loadZ80 = function (b) {
    if (b.length < 30) return false;
    var s = {
      a: b[0], f: b[1], c: b[2], b: b[3], l: b[4], h: b[5],
      pc: b[6] | (b[7] << 8), sp: b[8] | (b[9] << 8),
      i: b[10], r: (b[11] & 0x7F), e: b[13], d: b[14],
      c_: b[15], b_: b[16], e_: b[17], d_: b[18], l_: b[19], h_: b[20],
      a_: b[21], f_: b[22],
      iy: b[23] | (b[24] << 8), ix: b[25] | (b[26] << 8),
      iff1: b[27] ? 1 : 0, iff2: b[28] ? 1 : 0,
      im: b[29] & 3, halted: 0, t: 0
    };
    var info = b[12] === 255 ? 1 : b[12];
    if (info & 0x01) s.r |= 0x80;
    this.border = (info >> 1) & 7;
    var compressed = !!(info & 0x20);

    var pos = 30, version = 1;
    if (s.pc === 0) {
      var hlen = b[30] | (b[31] << 8);
      version = hlen > 23 ? 3 : 2;
      s.pc = b[32] | (b[33] << 8);
      var hw = b[34];
      pos = 32 + hlen;
      if (hw >= 3 && version === 2) return this.load128Pages(b, pos, s);
      if (hw >= 4 && version === 3) return this.load128Pages(b, pos, s);
      return this.loadZ80Pages(b, pos, s);
    }

    // v1: one 48K chunk at 0x4000
    if (!compressed) {
      for (var i = 0; i < 49152 && pos + i < b.length; i++) this.mem[0x4000 + i] = b[pos + i];
    } else {
      this.decompressZ80(b, pos, b.length, 0x4000, 49152);
    }
    this.cpu.setState(s);
    this.running = true;
    return true;
  };

  Spectrum.prototype.loadZ80Pages = function (b, pos, s) {
    var PAGE48 = { 4: 0x8000, 5: 0xC000, 8: 0x4000 };
    while (pos + 3 <= b.length) {
      var len = b[pos] | (b[pos + 1] << 8);
      var page = b[pos + 2];
      pos += 3;
      var dest = PAGE48[page];
      if (dest !== undefined) {
        if (len === 0xFFFF) {
          for (var i = 0; i < 16384 && pos + i < b.length; i++) this.mem[dest + i] = b[pos + i];
          pos += 16384;
        } else {
          this.decompressZ80(b, pos, pos + len, dest, 16384);
          pos += len;
        }
      } else {
        pos += (len === 0xFFFF) ? 16384 : len;
      }
    }
    this.cpu.setState(s);
    this.running = true;
    return true;
  };

  /** 128K snapshots run here as a 48K machine using pages 5, 2 and 0. */
  Spectrum.prototype.load128Pages = function (b, pos, s) {
    var MAP = { 8: 0x4000, 4: 0x8000, 5: 0xC000 };
    return this.loadZ80PagesWithMap(b, pos, s, MAP);
  };

  Spectrum.prototype.loadZ80PagesWithMap = function (b, pos, s, MAP) {
    while (pos + 3 <= b.length) {
      var len = b[pos] | (b[pos + 1] << 8);
      var page = b[pos + 2];
      pos += 3;
      var dest = MAP[page];
      if (dest !== undefined) {
        if (len === 0xFFFF) {
          for (var i = 0; i < 16384 && pos + i < b.length; i++) this.mem[dest + i] = b[pos + i];
          pos += 16384;
        } else {
          this.decompressZ80(b, pos, pos + len, dest, 16384);
          pos += len;
        }
      } else {
        pos += (len === 0xFFFF) ? 16384 : len;
      }
    }
    this.cpu.setState(s);
    this.running = true;
    return true;
  };

  Spectrum.prototype.decompressZ80 = function (b, from, to, dest, max) {
    var o = 0, p = from;
    while (p < to && o < max) {
      if (b[p] === 0x00 && b[p + 1] === 0xED && b[p + 2] === 0xED && b[p + 3] === 0x00) break;
      if (b[p] === 0xED && b[p + 1] === 0xED) {
        var count = b[p + 2], val = b[p + 3];
        p += 4;
        while (count-- > 0 && o < max) { this.poke(dest + o, val); o++; }
      } else {
        this.poke(dest + o, b[p]); o++; p++;
      }
    }
  };
  Spectrum.prototype.poke = function (a, v) {
    a &= 0xFFFF;
    if (a >= 0x4000) this.mem[a] = v;
  };

  /* ---- running ------------------------------------------------------------ */

  Spectrum.prototype.runFrame = function () {
    if (!this.running) return;
    this.edges.length = 0;
    this.cpu.t = 0;
    this.cpu.interrupt();
    try {
      this.cpu.run(TS_FRAME);
    } catch (e) {
      this.running = false;
      if (this.env.onError) this.env.onError(e);
      return;
    }
    this.frame++;
    if ((this.frame & 15) === 0) this.flashPhase ^= 1;

    if (this.autoType && this.frame > this.autoTypeAt) this.doAutoType();
    if (this.audioOn) this.pushAudio();
  };

  /** Press a short canned sequence for the user, one key every few frames. */
  Spectrum.prototype.doAutoType = function () {
    if ((this.frame % 8) !== 0) return;
    if (!this.autoType.length) { this.autoType = null; this.releaseAll(); return; }
    if (this.autoHeld) { this.releaseAll(); this.autoHeld = false; return; }
    var item = this.autoType.shift();
    var parts = item.split('+');
    for (var i = 0; i < parts.length; i++) this.setKey(parts[i], true);
    this.autoHeld = true;
  };

  Spectrum.prototype.releaseAll = function () { this.keys.fill(0x1F); };

  Spectrum.prototype.setKey = function (id, down) {
    for (var r = 0; r < 8; r++) {
      var idx = MATRIX[r].indexOf(id);
      if (idx < 0) continue;
      if (down) this.keys[r] &= ~(1 << idx);
      else this.keys[r] |= (1 << idx);
      return true;
    }
    return false;
  };

  /* ---- display ------------------------------------------------------------ */

  Spectrum.prototype.renderPixels = function () {
    var m = this.mem, out = this.pixels, flash = this.flashPhase;
    for (var y = 0; y < 192; y++) {
      var addr = 0x4000 + ((y & 0xC0) << 5) + ((y & 0x07) << 8) + ((y & 0x38) << 2);
      var attrRow = 0x5800 + ((y >> 3) << 5);
      var o = y * 256;
      for (var cx = 0; cx < 32; cx++) {
        var bits = m[addr + cx];
        var at = m[attrRow + cx];
        var bright = (at & 0x40) ? 8 : 0;
        var ink = (at & 7) | bright;
        var paper = ((at >> 3) & 7) | bright;
        if ((at & 0x80) && flash) { var t = ink; ink = paper; paper = t; }
        var base = o + cx * 8;
        out[base] = (bits & 0x80) ? ink : paper;
        out[base + 1] = (bits & 0x40) ? ink : paper;
        out[base + 2] = (bits & 0x20) ? ink : paper;
        out[base + 3] = (bits & 0x10) ? ink : paper;
        out[base + 4] = (bits & 0x08) ? ink : paper;
        out[base + 5] = (bits & 0x04) ? ink : paper;
        out[base + 6] = (bits & 0x02) ? ink : paper;
        out[base + 7] = (bits & 0x01) ? ink : paper;
      }
    }
    return out;
  };

  /**
   * Rebuild the emulated display as a one-block-deep slab of voxels.
   * 192 rows are sampled down to the 175 the solid display has.
   */
  Spectrum.prototype.projectToWorld = function (world, z, mat) {
    var px = this.pixels, W = ZX.SCREEN_W, H = ZX.SCREEN_H;
    for (var y = 0; y < H; y++) {
      var sr = Math.floor((H - 1 - y) * 192 / H);
      var row = sr * 256;
      for (var x = 0; x < W; x++) {
        var sc = Math.floor(x * 256 / W);
        var c = px[row + sc];
        world.set(x, y, z, c === 0 ? 0 : ZX.vox(c, mat || 0));
      }
    }
  };

  /* ---- beeper ------------------------------------------------------------- */

  Spectrum.prototype.enableAudio = function () {
    if (this.audio) { this.audioOn = true; return; }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      this.audio = new AC();
      this.gain = this.audio.createGain();
      this.gain.gain.value = 0.16;
      this.gain.connect(this.audio.destination);
      this.nextTime = 0;
      this.audioOn = true;
    } catch (e) { this.audio = null; }
  };

  Spectrum.prototype.pushAudio = function () {
    if (!this.audio) return;
    var rate = this.audio.sampleRate;
    var n = Math.floor(rate / 50);
    var buf = this.audio.createBuffer(1, n, rate);
    var ch = buf.getChannelData(0);
    var level = this.lastLevel || 0, ei = 0, edges = this.edges;
    for (var i = 0; i < n; i++) {
      var t = (i / n) * TS_FRAME;
      while (ei < edges.length && edges[ei] <= t) { level = edges[ei + 1]; ei += 2; }
      ch[i] = level ? 0.5 : -0.5;
    }
    this.lastLevel = level;
    var src = this.audio.createBufferSource();
    src.buffer = buf;
    src.connect(this.gain);
    var now = this.audio.currentTime;
    if (this.nextTime < now + 0.02) this.nextTime = now + 0.05;
    src.start(this.nextTime);
    this.nextTime += n / rate;
  };

  Spectrum.prototype.stop = function () {
    this.running = false;
    this.autoType = null;
    this.releaseAll();
  };

  /* ---- a friendly notice when there is no ROM ----------------------------- */
  Spectrum.prototype.showNotice = function (lines) {
    this.mem.fill(0, 0x4000, 0x5800);
    this.mem.fill(0x38, 0x5800, 0x5B00);           // white on black
    for (var r = 0; r < lines.length && r < 24; r++) {
      var s = lines[r];
      for (var c = 0; c < s.length && c < 32; c++) {
        var g = ZX.glyph(s.charCodeAt(c));
        for (var y = 0; y < 8; y++) {
          var row = r * 8 + y;
          var addr = 0x4000 + ((row & 0xC0) << 5) + ((row & 0x07) << 8) + ((row & 0x38) << 2) + c;
          this.mem[addr] = g[y];
        }
      }
    }
  };

})(window.ZX = window.ZX || {});
