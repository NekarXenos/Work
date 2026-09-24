/* ==========================================================================
   screen2d.js -- the terminal CRT: 256 x 192, plus border.

   There is no attribute file. Every pixel carries its own colour, the way
   the SAM Coupe did it, so nothing ever clashes. A second colour per pixel
   holds the FLASH alternate.
   ========================================================================== */
(function (ZX) {
  'use strict';

  var W = 256, H = 192, BX = 32, BY = 24;
  var CW = W + BX * 2, CH2 = H + BY * 2;

  function Screen2D() {
    this.W = W; this.H = H;
    this.pix = new Uint8Array(W * H);
    this.alt = new Uint8Array(W * H);
    this.flash = new Uint8Array(W * H);
    this.chars = new Uint8Array(32 * 24);       // shadow copy for SCREEN$
    ZX.Mem.claim('crt', W * H * 3 + 768);

    this.border = 7;
    this.ink = 0; this.paper = 7; this.bright = 0;
    this.flashOn = 0; this.inverse = 0; this.over = 0;
    this.col = 0; this.row = 0;
    this.regionTop = 0; this.regionBottom = 23;
    this.flashPhase = 0;
    this.dirty = true;

    this.canvas = document.createElement('canvas');
    this.canvas.width = CW; this.canvas.height = CH2;
    this.ctx = this.canvas.getContext('2d', { alpha: false });
    this.imgd = this.ctx.createImageData(CW, CH2);
    this.buf32 = new Uint32Array(this.imgd.data.buffer);

    this.rgba = new Uint32Array(16);
    for (var i = 0; i < 16; i++) {
      var c = ZX.PALETTE[i];
      this.rgba[i] = 0xFF000000 | ((c & 255) << 16) | (((c >> 8) & 255) << 8) | ((c >> 16) & 255);
    }
    this.cls();
  }
  ZX.Screen2D = Screen2D;

  /* ---- colour helpers ---------------------------------------------------- */
  Screen2D.prototype.inkC = function () { return (this.ink & 7) | (this.bright ? 8 : 0); };
  Screen2D.prototype.paperC = function () { return (this.paper & 7) | (this.bright ? 8 : 0); };

  /* ---- clearing ---------------------------------------------------------- */
  Screen2D.prototype.cls = function () {
    var p = this.paperC();
    this.pix.fill(p); this.alt.fill(p); this.flash.fill(0);
    this.chars.fill(32);
    this.col = 0; this.row = this.regionTop | 0; this.dirty = true;
  };

  /* ---- raw pixels -------------------------------------------------------- */
  /** py counts down from the top, as the hardware does. */
  Screen2D.prototype.setPixel = function (px, py, colour, altColour, flash) {
    if (px < 0 || py < 0 || px >= W || py >= H) return;
    var i = py * W + px;
    this.pix[i] = colour & 15;
    this.alt[i] = (altColour === undefined ? colour : altColour) & 15;
    this.flash[i] = flash ? 1 : 0;
    this.dirty = true;
  };
  Screen2D.prototype.getPixel = function (px, py) {
    if (px < 0 || py < 0 || px >= W || py >= H) return 0;
    return this.pix[py * W + px];
  };

  /** PLOT-style: y counts up from the bottom of the 256x176 plotting area. */
  Screen2D.prototype.plot = function (x, y) {
    x = x | 0; y = y | 0;
    if (x < 0 || x > 255 || y < 0 || y > 175) return;
    var py = 175 - y, i = py * W + x;
    if (this.over && this.pix[i] === this.inkC()) {
      this.pix[i] = this.paperC(); this.alt[i] = this.paperC();
    } else {
      this.pix[i] = this.inverse ? this.paperC() : this.inkC();
      this.alt[i] = this.inverse ? this.inkC() : this.paperC();
    }
    this.flash[i] = this.flashOn ? 1 : 0;
    this.dirty = true;
  };

  Screen2D.prototype.line = function (x0, y0, x1, y1) {
    x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
    var dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    var sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1, err = dx + dy;
    for (;;) {
      this.plot(x0, y0);
      if (x0 === x1 && y0 === y1) break;
      var e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  };

  Screen2D.prototype.circle = function (cx, cy, r) {
    cx |= 0; cy |= 0; r = Math.abs(Math.round(r));
    var x = r, y = 0, err = 1 - r;
    while (x >= y) {
      this.plot(cx + x, cy + y); this.plot(cx + y, cy + x);
      this.plot(cx - y, cy + x); this.plot(cx - x, cy + y);
      this.plot(cx - x, cy - y); this.plot(cx - y, cy - x);
      this.plot(cx + y, cy - x); this.plot(cx + x, cy - y);
      y++;
      if (err < 0) err += 2 * y + 1; else { x--; err += 2 * (y - x) + 1; }
    }
  };

  /* ---- text -------------------------------------------------------------- */
  Screen2D.prototype.putChar = function (col, row, code, ink, paper, inv, flash) {
    if (col < 0 || row < 0 || col > 31 || row > 23) return;
    if (ink === undefined) ink = this.inkC();
    if (paper === undefined) paper = this.paperC();
    if (inv === undefined) inv = this.inverse;
    if (flash === undefined) flash = this.flashOn;
    if (inv) { var t = ink; ink = paper; paper = t; }

    this.chars[row * 32 + col] = code;
    var g = ZX.glyph(code), base = row * 8 * W + col * 8;
    for (var r = 0; r < 8; r++) {
      var bits = g[r], o = base + r * W;
      for (var b = 0; b < 8; b++) {
        var on = (bits & (0x80 >> b)) !== 0;
        var i = o + b;
        this.pix[i] = on ? ink : paper;
        this.alt[i] = on ? paper : ink;
        this.flash[i] = flash ? 1 : 0;
      }
    }
    this.dirty = true;
  };

  Screen2D.prototype.charAt = function (col, row) {
    if (col < 0 || row < 0 || col > 31 || row > 23) return 32;
    return this.chars[row * 32 + col];
  };

  /** Scroll the active region up by one character row.
      The editor keeps the last two rows for its input line, so printing
      must not drag that line up into the listing. */
  Screen2D.prototype.scroll = function () {
    var r0 = this.regionTop, r1 = this.regionBottom;
    var top = r0 * 8 * W, bot = (r1 + 1) * 8 * W;
    this.pix.copyWithin(top, top + 8 * W, bot);
    this.alt.copyWithin(top, top + 8 * W, bot);
    this.flash.copyWithin(top, top + 8 * W, bot);
    var p = this.paperC();
    this.pix.fill(p, bot - 8 * W, bot);
    this.alt.fill(p, bot - 8 * W, bot);
    this.flash.fill(0, bot - 8 * W, bot);
    this.chars.copyWithin(r0 * 32, (r0 + 1) * 32, (r1 + 1) * 32);
    this.chars.fill(32, r1 * 32, (r1 + 1) * 32);
    this.dirty = true;
  };

  Screen2D.prototype.newline = function () {
    this.col = 0; this.row++;
    if (this.row > this.regionBottom) { this.scroll(); this.row = this.regionBottom; }
  };

  Screen2D.prototype.print = function (str) {
    for (var i = 0; i < str.length; i++) {
      var ch = str.charCodeAt(i);
      if (ch === 13 || ch === 10) { this.newline(); continue; }
      if (this.col > 31) this.newline();
      this.putChar(this.col, this.row, ch);
      this.col++;
    }
  };

  Screen2D.prototype.println = function (str) {
    if (str) this.print(str);
    this.newline();
  };

  Screen2D.prototype.at = function (row, col) {
    this.row = ZX.clamp(row | 0, 0, 23);
    this.col = ZX.clamp(col | 0, 0, 31);
  };

  /** One row of large 8x8 text drawn double height, for banners. */
  Screen2D.prototype.banner = function (row, str, ink) {
    var startCol = Math.max(0, (32 - str.length) >> 1);
    var old = this.ink;
    if (ink !== undefined) this.ink = ink;
    for (var i = 0; i < str.length && startCol + i < 32; i++) {
      this.putChar(startCol + i, row, str.charCodeAt(i));
    }
    this.ink = old;
  };

  /* ---- fast path for the emulator ---------------------------------------- */
  /** Blit a 256x192 colour-index bitmap straight in. */
  Screen2D.prototype.blitIndexed = function (src) {
    this.pix.set(src);
    this.alt.set(src);
    this.flash.fill(0);
    this.dirty = true;
  };

  /* ---- rendering --------------------------------------------------------- */
  Screen2D.prototype.render = function (force) {
    if (!this.dirty && !force) return false;
    this.dirty = false;
    var b32 = this.buf32, rgba = this.rgba, ph = this.flashPhase;
    var bc = rgba[this.border & 15];

    // border
    var y, x, o;
    for (y = 0; y < BY; y++) {
      o = y * CW;
      for (x = 0; x < CW; x++) b32[o + x] = bc;
      o = (CH2 - 1 - y) * CW;
      for (x = 0; x < CW; x++) b32[o + x] = bc;
    }
    for (y = BY; y < CH2 - BY; y++) {
      o = y * CW;
      for (x = 0; x < BX; x++) { b32[o + x] = bc; b32[o + CW - 1 - x] = bc; }
    }
    // display
    var pix = this.pix, alt = this.alt, fl = this.flash, i = 0;
    for (y = 0; y < H; y++) {
      o = (y + BY) * CW + BX;
      for (x = 0; x < W; x++, i++) {
        b32[o + x] = rgba[(ph && fl[i]) ? alt[i] : pix[i]];
      }
    }
    this.ctx.putImageData(this.imgd, 0, 0);
    return true;
  };

  Screen2D.prototype.tickFlash = function () {
    var p = this.flashPhase;
    this.flashPhase ^= 1;
    if (p !== this.flashPhase) this.dirty = true;
  };

})(window.ZX = window.ZX || {});
