/* ============================================================
   Spectrum · keyboard.js
   The +2 keyboard, built the way ZX Spectrum 3D builds it: every
   key is a box whose top face is a window onto one shared canvas
   atlas, one cell per key. Redraw the atlas and every board in the
   plaza re-letters itself at once — which is exactly what has to
   happen the instant a shift goes down or the pointer crosses a key.

   The 3D machine's keys are an eighth of a metre. A desk board is
   built at `scale` of that, so it keeps the same proportions to the
   monitor it sits in front of.
   ============================================================ */
import * as THREE from 'three';
import { KEYCAPS, KB_UNITS_W, KB_UNITS_H, CAP_BY_ID, capLegend } from './tokens.js';

const UNIT = 128;                    // atlas pixels per key unit
const AW = 1536, AH = 704;           // atlas size; the strip below BLANK_Y is filler
const BLANK_Y = 640;

/* full-size geometry, in metres */
export const KEY_PITCH = 0.147;      // 0.125 m key + 0.022 m gap
const KEY_SIZE = 0.125;
const KEY_HEIGHT = 0.026;
export const KEYBOARD_W = KB_UNITS_W * KEY_PITCH;
export const KEYBOARD_D = KB_UNITS_H * KEY_PITCH;

const FACE = 'Consolas,"DejaVu Sans Mono",monospace';
const KIND_COLOUR = {
  cap: '#ffffff', kw: '#ffffff', sym: '#ff5555', ext: '#55ff55',
  esym: '#ff66ff', caps: '#7fc4ff', graph: '#ffff55', special: '#c8c8d4'
};

const drawn = KEYCAPS.filter(k => !k.hidden);

/* ------------------------------------------------------------
   The atlas
   ------------------------------------------------------------ */
export class KeyboardAtlas {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = AW; this.canvas.height = AH;
    this.ctx = this.canvas.getContext('2d');
    this.cells = {};

    /* shelf-pack one cell per key */
    let x = 0, y = 0;
    for (const k of drawn) {
      const w = Math.round(k.w * UNIT);
      if (x + w > AW) { x = 0; y += UNIT; }
      this.cells[k.id] = { x, y, w, h: UNIT };
      x += w;
    }

    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.minFilter = THREE.LinearFilter;
    this.tex.magFilter = THREE.LinearFilter;
    this.tex.generateMipmaps = false;
    this.tex.anisotropy = 8;

    this.state = { mode: 'K', caps: false, sym: false, capsLock: false, hover: null, pressed: new Set() };
    this.sig = '';
    this.redraw(true);
  }

  set(partial) { Object.assign(this.state, partial); }

  signature() {
    const s = this.state;
    return [s.mode, s.caps, s.sym, s.capsLock, s.natural, s.hover, Array.from(s.pressed).join(',')].join('|');
  }
  /* repaint only when what is showing is not what is wanted */
  redraw(force) {
    const sig = this.signature();
    if (!force && sig === this.sig) return false;
    this.sig = sig;
    const c = this.ctx;
    c.fillStyle = '#0a0a0c'; c.fillRect(0, 0, AW, AH);
    c.fillStyle = '#1b1b20'; c.fillRect(0, BLANK_Y, AW, AH - BLANK_Y);
    for (const k of drawn) this.drawKey(k);
    this.tex.needsUpdate = true;
    return true;
  }

  fit(text, maxW, maxPx) {
    const c = this.ctx;
    let px = maxPx;
    for (; ;) {
      c.font = 'bold ' + px + 'px ' + FACE;
      if (c.measureText(text).width <= maxW || px <= 9) break;
      px -= 2;
    }
    return px;
  }

  drawKey(k) {
    const r = this.cells[k.id], c = this.ctx, s = this.state;
    const hovered = s.hover === k.id;
    const pressed = s.pressed.has(k.id);
    const latched = (k.id === 'CAPS' && s.caps) || (k.id === 'SYM' && s.sym) ||
      (k.id === 'EXTEND' && s.mode === 'E') || (k.id === 'GRAPH' && s.mode === 'G') ||
      (k.id === 'CAPSLOCK' && s.capsLock);

    const pad = 5;
    const x = r.x + pad, y = r.y + pad, w = r.w - pad * 2, h = r.h - pad * 2;

    /* the cap body */
    let top, bot;
    if (pressed) { top = '#ffd24a'; bot = '#c9992a'; }
    else if (hovered) { top = '#3f6f9a'; bot = '#28465f'; }
    else if (latched) { top = '#2f5f4a'; bot = '#1d3b2e'; }
    else if (k.type !== 'normal') { top = '#26262e'; bot = '#17171c'; }
    else { top = '#34343d'; bot = '#212128'; }
    const g = c.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, top); g.addColorStop(1, bot);
    c.fillStyle = g;
    c.fillRect(x, y, w, h);
    c.strokeStyle = hovered ? '#7fd4ff' : (pressed ? '#fff2a0' : '#0b0b0e');
    c.lineWidth = hovered || pressed ? 4 : 2;
    c.strokeRect(x + 1, y + 1, w - 2, h - 2);

    /* ENTER is two keys deep but one cell tall, so its lettering is
       squashed here to come out square on the key */
    const squash = k.h > 1 ? 1 / k.h : 1;
    const text = (t, tx, ty, align, base, maxW) => {
      c.save();
      c.translate(tx, ty); c.scale(1, squash);
      c.textAlign = align; c.textBaseline = base;
      c.fillText(t, 0, 0, maxW);
      c.restore();
    };

    /* corner legends, dimmed — what the other shifts would give */
    const dim = pressed ? 0.55 : 0.85;
    if (k.type === 'normal') {
      c.font = Math.round(UNIT * 0.125) + 'px ' + FACE;
      c.globalAlpha = dim * 0.8;
      const corner = (t, colour, ax, ay, align, base) => { if (t) { c.fillStyle = colour; text(t, ax, ay, align, base, w - 8); } };
      corner(k.kw, '#cfcfe0', x + 6, y + 5, 'left', 'top');
      corner(k.ext, '#3fbf3f', x + w - 6, y + 5, 'right', 'top');
      corner(k.esym || k.col, k.esym ? '#bf3fbf' : '#9aa0aa', x + 6, y + h - 5, 'left', 'bottom');
      corner(k.sym, '#bf3f3f', x + w - 6, y + h - 5, 'right', 'bottom');
      c.globalAlpha = 1;
    }

    /* the live legend: big, centred, coloured by the layer it came from */
    const live = capLegend(k, s);
    const label = live.text || k.main;
    const maxPx = k.type === 'normal' ? Math.round(UNIT * 0.42) : Math.round(UNIT * 0.22);
    const px = this.fit(label, w - 14, maxPx);
    c.font = 'bold ' + px + 'px ' + FACE;
    c.fillStyle = pressed ? '#241a00' : (KIND_COLOUR[live.kind] || '#ffffff');
    c.shadowColor = 'rgba(0,0,0,0.85)'; c.shadowBlur = 4;
    text(label, x + w / 2, y + h / 2 + (k.type === 'normal' ? 2 : 0), 'center', 'middle', w - 10);
    c.shadowBlur = 0;

    if (latched) {
      c.fillStyle = '#55ff55';
      c.fillRect(x + w - 14, y + h - 14, 8, 8);
    }
  }
}

/* ------------------------------------------------------------
   A board on a desk
   ------------------------------------------------------------ */
export class Keyboard3D {
  constructor(opts = {}) {
    this.atlas = opts.atlas || new KeyboardAtlas();
    this.ownsAtlas = !opts.atlas;
    const s = this.scale = opts.scale || 1;
    const pitch = KEY_PITCH * s, size = KEY_SIZE * s, keyH = KEY_HEIGHT * s;
    this.width = KEYBOARD_W * s;
    this.depth = KEYBOARD_D * s;

    this.group = new THREE.Group();
    this.material = new THREE.MeshStandardMaterial({
      map: this.atlas.tex, roughness: .6, metalness: .04,
      /* a little of the atlas glows, so the legends read under any light */
      emissive: 0xffffff, emissiveMap: this.atlas.tex, emissiveIntensity: .3
    });
    this.keyMeshes = [];
    this.byId = {};
    this.travel = keyH * 0.5;

    const ox = -this.width / 2, oz = -this.depth / 2;
    for (const k of drawn) {
      const w = k.w * pitch - (pitch - size);
      const d = k.h * pitch - (pitch - size);
      const geo = new THREE.BoxGeometry(w, keyH, d);
      this.mapUV(geo, this.atlas.cells[k.id]);
      /* the user is at +Z looking towards -Z, so the function row is at
         the back of the case and SPACE nearest the hands */
      const m = new THREE.Mesh(geo, this.material);
      m.position.set(ox + (k.x + k.w / 2) * pitch, keyH / 2, oz + (k.y + k.h / 2) * pitch);
      m.userData.capId = k.id;
      m.userData.restY = m.position.y;
      this.group.add(m);
      this.keyMeshes.push(m);
      this.byId[k.id] = m;
    }
    this.held = new Set();
    this.bumps = new Map();          // capId -> time the bump ends
  }

  /* point the +Y face of a box at one atlas cell, the rest at the filler */
  mapUV(geo, cell) {
    const uv = geo.attributes.uv;
    const u0 = cell.x / AW, u1 = (cell.x + cell.w) / AW;
    const vTop = 1 - cell.y / AH, vBot = 1 - (cell.y + cell.h) / AH;
    /* +Y is vertices 8..11, in the order (0,1) (1,1) (0,0) (1,0); U runs
       along +X and V towards -Z, which is right and away for the typist */
    uv.setXY(8, u0, vTop); uv.setXY(9, u1, vTop);
    uv.setXY(10, u0, vBot); uv.setXY(11, u1, vBot);
    const bu = 0.5, bv = 1 - (BLANK_Y + 32) / AH;
    for (let i = 0; i < uv.count; i++) if (i < 8 || i > 11) uv.setXY(i, bu, bv);
    uv.needsUpdate = true;
  }

  /* --- live state -------------------------------------------- */
  static idFor(capId) {
    const cap = CAP_BY_ID[capId];
    return cap && cap.alias ? cap.alias : capId;
  }
  setState(st) { this.atlas.set(st); }
  setHover(capId) { this.atlas.set({ hover: capId }); }
  press(capId) {
    const id = Keyboard3D.idFor(capId);
    if (!this.byId[id]) return;
    this.held.add(id);
    this.atlas.state.pressed.add(id);
    this.place(id);
  }
  release(capId) {
    const id = Keyboard3D.idFor(capId);
    if (!this.byId[id]) return;
    this.held.delete(id);
    if (!this.bumps.has(id)) this.atlas.state.pressed.delete(id);
    this.place(id);
  }
  releaseAll() { for (const id of Array.from(this.held)) this.release(id); }
  /* a key going down and springing back */
  bump(capId, ms = 110) {
    const id = Keyboard3D.idFor(capId);
    if (!this.byId[id]) return;
    this.bumps.set(id, performance.now() + ms);
    this.atlas.state.pressed.add(id);
    this.place(id);
  }
  place(id) {
    const m = this.byId[id];
    const down = this.held.has(id) || this.bumps.has(id);
    m.position.y = m.userData.restY - (down ? this.travel : 0);
  }
  /* once a frame: let bumps spring back, and repaint the atlas if the
     state it should show has changed */
  update(now) {
    for (const [id, until] of this.bumps) {
      if (now < until) continue;
      this.bumps.delete(id);
      if (!this.held.has(id)) this.atlas.state.pressed.delete(id);
      this.place(id);
    }
    this.atlas.redraw();
  }

  /* --- picking ------------------------------------------------ */
  hit(raycaster) {
    const h = raycaster.intersectObjects(this.keyMeshes, false);
    return h.length ? h[0].object.userData.capId : null;
  }

  dispose() {
    for (const m of this.keyMeshes) m.geometry.dispose();
    this.material.dispose();
    if (this.ownsAtlas) this.atlas.tex.dispose();
  }
}
