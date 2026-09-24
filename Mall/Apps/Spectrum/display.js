/* ============================================================
   Spectrum · display.js
   The screen end of things, in two halves.

   The native BASIC session draws on a SAM Coupé-style screen:
   256x192, and every pixel carries its own colour, any of the 16,
   so nothing ever clashes. A second colour per pixel holds the
   FLASH alternate. This is the ZX Spectrum 3D machine's CRT.

   Underneath it the ordinary display file is still kept — bitmap
   at 16384, attributes at 22528 — so PEEK, POINT, ATTR and SCREEN$
   mean what they always meant, and a POKE into it shows up.

   A real Z80 program only has the display file, so the emulated
   machine is drawn from bitmap and attributes, clash and all, the
   way the ULA draws it.
   ============================================================ */
import { FONT, UDG_DEFAULT } from './font.js';

/* 0-7 normal, 8-15 BRIGHT — the ZX Spectrum 3D palette */
export const PALETTE = [
  0x000000, 0x000095, 0x880000, 0xd60073, 0x00a800, 0x00afef, 0x888800, 0xcccccc,
  0x333333, 0x0000ff, 0xff0000, 0xff00ff, 0x00ff00, 0x00ffff, 0xffff00, 0xffffff
];

export const SCR_W = 256, SCR_H = 192;
export const BORDER_X = 32, BORDER_Y = 24;
export const RASTER_W = SCR_W + BORDER_X * 2;   // 320
export const RASTER_H = SCR_H + BORDER_Y * 2;   // 240

/* 0xAABBGGRR words, which is the byte order an ImageData buffer wants */
const ABGR = PALETTE.map(c => 0xff000000 | ((c & 0xff) << 16) | (c & 0xff00) | ((c >> 16) & 0xff));

/* ------------------------------------------------------------
   Raster — one canvas per terminal, uploaded to the monitor
   ------------------------------------------------------------ */
export class Raster {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = RASTER_W; this.canvas.height = RASTER_H;
    this.ctx = this.canvas.getContext('2d', { alpha: false, willReadFrequently: false });
    this.img = this.ctx.createImageData(RASTER_W, RASTER_H);
    this.buf = new Uint32Array(this.img.data.buffer);
  }
  border(colour) {
    const buf = this.buf, bc = ABGR[colour & 15];
    buf.fill(bc, 0, RASTER_W * BORDER_Y);
    buf.fill(bc, RASTER_W * (BORDER_Y + SCR_H));
    for (let y = 0; y < SCR_H; y++) {
      const o = (y + BORDER_Y) * RASTER_W;
      buf.fill(bc, o, o + BORDER_X);
      buf.fill(bc, o + BORDER_X + SCR_W, o + RASTER_W);
    }
  }
  /* The emulated machine: mem is a 64K view, base 0x4000 normally,
     0xC000 for the 128K shadow screen. flashOn inverts FLASH cells. */
  draw(mem, base, border, flashOn) {
    const buf = this.buf, attrBase = base + 0x1800;
    this.border(border & 7);
    for (let y = 0; y < SCR_H; y++) {
      const src = base + y * 32;
      const arow = attrBase + (y >> 3) * 32;
      let o = (y + BORDER_Y) * RASTER_W + BORDER_X;
      for (let col = 0; col < 32; col++) {
        const a = mem[arow + col];
        const bright = (a & 0x40) ? 8 : 0;
        let ink = ABGR[(a & 7) | bright], pap = ABGR[((a >> 3) & 7) | bright];
        if (flashOn && (a & 0x80)) { const t = ink; ink = pap; pap = t; }
        const b = mem[src + col];
        buf[o] = (b & 0x80) ? ink : pap;
        buf[o + 1] = (b & 0x40) ? ink : pap;
        buf[o + 2] = (b & 0x20) ? ink : pap;
        buf[o + 3] = (b & 0x10) ? ink : pap;
        buf[o + 4] = (b & 0x08) ? ink : pap;
        buf[o + 5] = (b & 0x04) ? ink : pap;
        buf[o + 6] = (b & 0x02) ? ink : pap;
        buf[o + 7] = (b & 0x01) ? ink : pap;
        o += 8;
      }
    }
    this.ctx.putImageData(this.img, 0, 0);
  }
  /* The BASIC session: one colour per pixel, no attribute cell at all */
  drawScreen(scr, flashOn) {
    const buf = this.buf, pix = scr.pix, alt = scr.alt, fl = scr.fl;
    this.border(scr.border);
    let i = 0;
    for (let y = 0; y < SCR_H; y++) {
      const o = (y + BORDER_Y) * RASTER_W + BORDER_X;
      for (let x = 0; x < SCR_W; x++, i++) buf[o + x] = ABGR[(flashOn && fl[i]) ? alt[i] : pix[i]];
    }
    this.ctx.putImageData(this.img, 0, 0);
  }
  /* the "no signal" state a terminal shows before it is switched on */
  blank(colour = 0) {
    this.buf.fill(ABGR[colour & 15]);
    this.ctx.putImageData(this.img, 0, 0);
  }
}

/* ------------------------------------------------------------
   Screen — the printing and plotting layer the BASIC draws through
   ------------------------------------------------------------ */
export class Screen {
  constructor(mem, base = 0x4000) {
    this.mem = mem;
    this.base = base;
    this.font = FONT;
    this.udg = UDG_DEFAULT.slice();
    this.romFont = null;              // set when a real ROM is loaded
    this.border = 7;
    this.pix = new Uint8Array(SCR_W * SCR_H);   // colour of each pixel
    this.alt = new Uint8Array(SCR_W * SCR_H);   // its FLASH alternate
    this.fl = new Uint8Array(SCR_W * SCR_H);    // 1 where it flashes
    this.reset();
  }
  reset() {
    this.ink = 0; this.paper = 7; this.bright = 0; this.flash = 0;
    this.inverse = 0; this.over = 0;
    this.row = 0; this.col = 0;       // upper screen cursor (rows 0..21)
    this.lrow = 0; this.lcol = 0;     // lower screen cursor (rows 22..23)
    this.lower = false;               // which one PRINT is talking to
    this.lowerSize = 2;
    this.plotX = 0; this.plotY = 0;
    this.cls();
  }
  /* INK and PAPER run 0..15; 8..15 are the BRIGHT colours, and BRIGHT 1
     brightens whatever is below 8 */
  inkC() { return (this.ink & 7) | (this.bright || this.ink >= 8 ? 8 : 0); }
  paperC() { return (this.paper & 7) | (this.bright || this.paper >= 8 ? 8 : 0); }
  /* what the attribute file records, for ATTR and PEEK */
  attrByte() {
    return (this.ink & 7) | ((this.paper & 7) << 3) | (this.bright || this.ink >= 8 ? 0x40 : 0) | (this.flash ? 0x80 : 0);
  }
  glyph(code) {
    if (code >= 144 && code <= 164) return { data: this.udg, off: (code - 144) * 8 };
    if (this.romFont) {
      /* the ROM font table starts at character 32 */
      if (code < 32 || code > 127) return { data: this.font, off: (code & 255) * 8 };
      return { data: this.romFont, off: (code - 32) * 8 };
    }
    return { data: this.font, off: (code & 255) * 8 };
  }
  cls() {
    const m = this.mem, b = this.base;
    m.fill(0, b, b + 6144);
    m.fill(this.attrByte(), b + 6144, b + 6912);
    this.pix.fill(this.paperC());
    this.alt.fill(this.inkC());
    this.fl.fill(this.flash ? 1 : 0);
    this.row = this.col = 0; this.lrow = this.lcol = 0;
    this.plotX = 0; this.plotY = 0;
  }
  clearLower() {
    const a = this.attrByte();
    for (let r = 24 - this.lowerSize; r < 24; r++) this.blankRow(r, a);
    this.lrow = 0; this.lcol = 0;
  }
  /* attr, when given, is an attribute byte; otherwise the current colours */
  blankRow(r, attr) {
    const m = this.mem, b = this.base;
    m.fill(0, b + r * 256, b + r * 256 + 256);
    const ao = b + 6144 + r * 32;
    m.fill(attr === undefined ? this.attrByte() : attr, ao, ao + 32);
    let pap, ink, fl;
    if (attr === undefined) { pap = this.paperC(); ink = this.inkC(); fl = this.flash ? 1 : 0; }
    else { const br = attr & 0x40 ? 8 : 0; pap = ((attr >> 3) & 7) | br; ink = (attr & 7) | br; fl = attr & 0x80 ? 1 : 0; }
    const p0 = r * 8 * SCR_W, p1 = p0 + 8 * SCR_W;
    this.pix.fill(pap, p0, p1); this.alt.fill(ink, p0, p1); this.fl.fill(fl, p0, p1);
  }
  /* roll the 22-line upper screen up one character row */
  scroll() {
    const m = this.mem, b = this.base;
    m.copyWithin(b, b + 256, b + 22 * 256);
    m.copyWithin(b + 6144, b + 6144 + 32, b + 6144 + 22 * 32);
    const rowPx = 8 * SCR_W, end = 22 * rowPx;
    this.pix.copyWithin(0, rowPx, end);
    this.alt.copyWithin(0, rowPx, end);
    this.fl.copyWithin(0, rowPx, end);
    this.blankRow(21);
  }
  /* --- character cells --------------------------------------- */
  putCharAt(col, row, code) {
    if (col < 0 || col > 31 || row < 0 || row > 23) return;
    const { data, off } = this.glyph(code);
    const m = this.mem, b = this.base;
    const ink = this.inkC(), pap = this.paperC(), fl = this.flash ? 1 : 0;
    const inv = this.inverse, ov = this.over;
    for (let i = 0; i < 8; i++) {
      let v = data[off + i];
      if (inv) v = (~v) & 255;
      const a = b + (row * 8 + i) * 32 + col;
      const bits = ov ? (m[a] ^ v) : v;
      m[a] = bits;
      let p = (row * 8 + i) * SCR_W + col * 8;
      for (let bit = 0x80; bit; bit >>= 1, p++) {
        /* OVER 1 only touches the pixels the glyph flips */
        if (ov && !(v & bit)) continue;
        const on = bits & bit;
        this.pix[p] = on ? ink : pap;
        this.alt[p] = on ? pap : ink;
        this.fl[p] = fl;
      }
    }
    m[b + 6144 + row * 32 + col] = this.attrByte();
  }
  /* --- printing ---------------------------------------------- */
  get curRow() { return this.lower ? 24 - this.lowerSize + this.lrow : this.row; }
  setCursor(col, row) {
    if (this.lower) { this.lcol = col; this.lrow = row; }
    else { this.col = col; this.row = row; }
  }
  newline() {
    if (this.lower) {
      this.lcol = 0; this.lrow++;
      if (this.lrow >= this.lowerSize) { this.growLower(); }
    } else {
      this.col = 0; this.row++;
      if (this.row > 21) { this.scroll(); this.row = 21; }
    }
  }
  growLower() {
    if (this.lowerSize < 18) {
      this.lowerSize++;
      this.scroll();
      this.blankRow(24 - this.lowerSize);
    } else { this.lrow = this.lowerSize - 1; }
  }
  printChar(code) {
    if (code === 13) { this.newline(); return; }
    if (code < 32 && code !== 8 && code !== 9) return;
    if (code === 8) { this.backspace(); return; }
    const c = this.lower ? this.lcol : this.col;
    if (c > 31) { this.newline(); }
    const col = this.lower ? this.lcol : this.col;
    this.putCharAt(col, this.curRow, code);
    if (this.lower) this.lcol++; else this.col++;
  }
  printString(s) {
    for (let i = 0; i < s.length; i++) this.printChar(s.charCodeAt(i) & 255);
  }
  backspace() {
    if (this.lower) {
      if (this.lcol > 0) this.lcol--;
      else if (this.lrow > 0) { this.lrow--; this.lcol = 31; }
    } else {
      if (this.col > 0) this.col--;
      else if (this.row > 0) { this.row--; this.col = 31; }
    }
    this.putCharAt(this.lower ? this.lcol : this.col, this.curRow, 32);
  }
  tab(n) {
    const target = n % 32;
    const c = this.lower ? this.lcol : this.col;
    if (c > target) this.newline();
    while ((this.lower ? this.lcol : this.col) < target) this.printChar(32);
  }
  /* --- graphics ---------------------------------------------- */
  /* ZX PLOT coordinates: x 0..255 left to right, y 0..175 bottom up,
     measured off the top of the two reserved lines at the foot. */
  point(x, y) {
    if (x < 0 || x > 255 || y < 0 || y > 175) return 0;
    const py = 175 - y;
    return (this.mem[this.base + py * 32 + (x >> 3)] >> (7 - (x & 7))) & 1;
  }
  plot(x, y) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || x > 255 || y < 0 || y > 175) { const e = new Error('plot'); e.zxReport = 'B'; throw e; }
    const py = 175 - y;
    const a = this.base + py * 32 + (x >> 3);
    const bit = 0x80 >> (x & 7);
    let v = this.mem[a];
    if (this.over) v ^= bit;
    else if (this.inverse) v &= ~bit;
    else v |= bit;
    this.mem[a] = v & 255;
    /* the pixel takes the colour; its neighbours in the cell keep theirs */
    const ink = this.inkC(), pap = this.paperC(), on = v & bit, p = py * SCR_W + x;
    this.pix[p] = on ? ink : pap;
    this.alt[p] = on ? pap : ink;
    this.fl[p] = this.flash ? 1 : 0;
    this.mem[this.base + 6144 + (py >> 3) * 32 + (x >> 3)] = this.attrByte();
    this.plotX = x; this.plotY = y;
  }
  drawTo(x1, y1) {
    const x0 = this.plotX, y0 = this.plotY;
    x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy, x = x0, y = y0;
    for (; ;) {
      if (x >= 0 && x < 256 && y >= 0 && y < 176) this.plot(x, y);
      if (x === x1 && y === y1) break;
      const e2 = err * 2;
      if (e2 > -dy) { err -= dy; x += sx; }
      if (e2 < dx) { err += dx; y += sy; }
    }
    this.plotX = x1; this.plotY = y1;
  }
  /* DRAW x,y,angle — the arc the ROM sweeps between the two ends */
  drawArc(dx, dy, ang) {
    const x0 = this.plotX, y0 = this.plotY;
    const x1 = x0 + dx, y1 = y0 + dy;
    if (Math.abs(ang) < 1e-6) { this.drawTo(x1, y1); return; }
    const len = Math.hypot(dx, dy);
    if (len < 1) { this.drawTo(x1, y1); return; }
    /* centre of the arc through both ends subtending `ang` */
    const r = len / (2 * Math.sin(ang / 2));
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    const h = r * Math.cos(ang / 2);
    const nx = -dy / len, ny = dx / len;
    const cx = mx + nx * h, cy = my + ny * h;
    const a0 = Math.atan2(y0 - cy, x0 - cx);
    const steps = Math.max(4, Math.min(512, Math.ceil(Math.abs(ang) * Math.abs(r) / 2)));
    for (let i = 1; i <= steps; i++) {
      const a = a0 - ang * (i / steps);
      const px = cx + Math.abs(r) * Math.cos(a), py = cy + Math.abs(r) * Math.sin(a);
      this.drawTo(px, py);
    }
    this.plotX = x1; this.plotY = y1;
  }
  circle(cx, cy, r) {
    cx = Math.round(cx); cy = Math.round(cy); r = Math.round(Math.abs(r));
    if (r === 0) { this.plot(cx, cy); return; }
    let x = r, y = 0, err = 1 - r;
    const put = (px, py) => { if (px >= 0 && px < 256 && py >= 0 && py < 176) this.plot(px, py); };
    while (x >= y) {
      put(cx + x, cy + y); put(cx + y, cy + x);
      put(cx - y, cy + x); put(cx - x, cy + y);
      put(cx - x, cy - y); put(cx - y, cy - x);
      put(cx + y, cy - x); put(cx + x, cy - y);
      y++;
      if (err < 0) err += 2 * y + 1;
      else { x--; err += 2 * (y - x) + 1; }
    }
    this.plotX = cx; this.plotY = cy;
  }
  /* --- the display file, written to directly ------------------ */
  /* A POKE (or machine code) into the display file shows up. A bitmap
     byte is drawn in its cell's attribute colours; an attribute byte
     recolours its whole cell — the one way left to get a clash here. */
  syncFromMem(addr) {
    const off = addr - this.base;
    if (off < 0 || off >= 6912) return;
    if (off < 6144) { this.paintByte(off >> 5, off & 31); return; }
    const r = (off - 6144) >> 5, c = (off - 6144) & 31;
    for (let i = 0; i < 8; i++) this.paintByte(r * 8 + i, c);
  }
  paintByte(py, col) {
    const m = this.mem, b = this.base;
    const a = m[b + 6144 + (py >> 3) * 32 + col], br = a & 0x40 ? 8 : 0;
    const ink = (a & 7) | br, pap = ((a >> 3) & 7) | br, fl = a & 0x80 ? 1 : 0;
    const bits = m[b + py * 32 + col];
    let p = py * SCR_W + col * 8;
    for (let bit = 0x80; bit; bit >>= 1, p++) {
      const on = bits & bit;
      this.pix[p] = on ? ink : pap;
      this.alt[p] = on ? pap : ink;
      this.fl[p] = fl;
    }
  }
  /* SCREEN$ — which character is sitting in a cell, by matching bitmaps */
  screenAt(row, col) {
    if (row < 0 || row > 23 || col < 0 || col > 31) return '';
    const m = this.mem, b = this.base;
    const cell = [];
    for (let i = 0; i < 8; i++) cell.push(m[b + (row * 8 + i) * 32 + col]);
    const f = this.romFont || this.font;
    const romBased = !!this.romFont;
    for (let code = 32; code < 128; code++) {
      const off = romBased ? (code - 32) * 8 : code * 8;
      let ok = true, inv = true;
      for (let i = 0; i < 8; i++) {
        if (f[off + i] !== cell[i]) ok = false;
        if (((~f[off + i]) & 255) !== cell[i]) inv = false;
        if (!ok && !inv) break;
      }
      if (ok || inv) return String.fromCharCode(code);
    }
    return '';
  }
  attrAt(row, col) {
    if (row < 0 || row > 23 || col < 0 || col > 31) return 0;
    return this.mem[this.base + 6144 + row * 32 + col];
  }
}
