/* ==========================================================================
   keyboard.js -- the +2 keyboard, in three dimensions.

   Every key is a 1/8 m box whose top face is a window onto one shared canvas
   atlas. Redraw the atlas and all four keyboards in the world re-letter
   themselves at once -- which is exactly what has to happen the instant a
   shift goes down or the pointer crosses a key.
   ========================================================================== */
(function (ZX) {
  'use strict';

  var UNIT = 128;                     // atlas pixels per key unit
  var AW = 1536, AH = 704;            // atlas size (bottom strip is blank filler)
  var BLANK_Y = 640;

  var PITCH = 0.147;                  // 0.125 m key + 0.022 m gap
  var KEYSZ = 0.125;                  // the key itself -- one eighth of a metre
  var KEYH = 0.026;

  ZX.KEY_PITCH = PITCH;
  ZX.KEYBOARD_W = ZX.KEY_UNITS_W * PITCH;
  ZX.KEYBOARD_D = ZX.KEY_UNITS_H * PITCH;

  /* ======================================================================== */
  /*  Atlas                                                                    */
  /* ======================================================================== */

  function Atlas() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = AW; this.canvas.height = AH;
    this.ctx = this.canvas.getContext('2d');
    this.cells = {};
    ZX.Mem.claim('keyatlas', AW * AH * 4);

    // shelf-pack one cell per key, one shelf per keyboard row
    var x = 0, y = 0, i, k;
    for (i = 0; i < ZX.KEYS.length; i++) {
      k = ZX.KEYS[i];
      var w = Math.round(k.uw * UNIT);
      if (x + w > AW) { x = 0; y += UNIT; }
      this.cells[k.id] = { x: x, y: y, w: w, h: UNIT };
      x += w;
    }

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;
    if (THREE.ClampToEdgeWrapping) {
      this.texture.wrapS = this.texture.wrapT = THREE.ClampToEdgeWrapping;
    }

    this.state = { caps: false, sym: false, ext: 0, mode: ZX.MODE_K, hover: null, pressed: {} };
    this.lastSig = '';
    this.redraw(true);
  }
  ZX.Atlas = Atlas;

  /** Which legend a key will actually produce right now. */
  Atlas.prototype.resolve = function (k, s) {
    if (k.type !== 'normal') return { text: k.cap, kind: 'special' };
    if (s.ext === 2 && k.x3d) return { text: k.x3d, kind: 'x3d' };
    if (s.ext === 1 && s.sym && k.esym) return { text: k.esym, kind: 'esym' };
    if (s.ext === 1 && k.ext) return { text: k.ext, kind: 'ext' };
    if (s.sym && k.sym) return { text: k.sym, kind: 'sym' };
    if (s.mode === ZX.MODE_K && k.kw) return { text: k.kw, kind: 'kw' };
    if (s.mode === ZX.MODE_G) return { text: k.cap, kind: 'graph' };
    if (s.caps || s.mode === ZX.MODE_C) return { text: k.cap.toUpperCase(), kind: 'cap' };
    return { text: k.cap.toLowerCase(), kind: 'cap' };
  };

  var KIND_COLOUR = {
    cap: '#ffffff', kw: '#ffffff', sym: '#ff5555', ext: '#55ff55',
    esym: '#ff66ff', x3d: '#55ffff', graph: '#ffff55', special: '#c8c8d4'
  };

  Atlas.prototype.signature = function () {
    var s = this.state, p = Object.keys(s.pressed).join(',');
    return [s.caps, s.sym, s.ext, s.mode, s.hover, p].join('|');
  };

  Atlas.prototype.redraw = function (force) {
    var sig = this.signature();
    if (!force && sig === this.lastSig) return false;
    this.lastSig = sig;

    var c = this.ctx;
    c.fillStyle = '#0a0a0c';
    c.fillRect(0, 0, AW, AH);
    c.fillStyle = '#1b1b20';
    c.fillRect(0, BLANK_Y, AW, AH - BLANK_Y);

    for (var i = 0; i < ZX.KEYS.length; i++) this.drawKey(ZX.KEYS[i]);
    this.texture.needsUpdate = true;
    return true;
  };

  Atlas.prototype.fit = function (text, maxW, maxPx, weight) {
    var c = this.ctx, px = maxPx;
    for (;;) {
      c.font = (weight || 'bold ') + px + 'px Consolas,"DejaVu Sans Mono",monospace';
      if (c.measureText(text).width <= maxW || px <= 9) break;
      px -= 2;
    }
    return px;
  };

  Atlas.prototype.drawKey = function (k) {
    var r = this.cells[k.id], c = this.ctx, s = this.state;
    var hovered = s.hover === k.id;
    var pressed = !!s.pressed[k.id];
    var latched = (k.id === 'CAPSSHIFT' && s.caps) || (k.id === 'SYMSHIFT' && s.sym) ||
                  (k.id === 'EXTMODE' && s.ext) || (k.id === 'CAPSLOCK' && s.mode === ZX.MODE_C);

    var pad = 5;
    var x = r.x + pad, y = r.y + pad, w = r.w - pad * 2, h = r.h - pad * 2;

    // cap body
    var top, bot;
    if (pressed) { top = '#ffd24a'; bot = '#c9992a'; }
    else if (hovered) { top = '#3f6f9a'; bot = '#28465f'; }
    else if (latched) { top = '#2f5f4a'; bot = '#1d3b2e'; }
    else if (k.type !== 'normal') { top = '#26262e'; bot = '#17171c'; }
    else { top = '#34343d'; bot = '#212128'; }

    var g = c.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, top); g.addColorStop(1, bot);
    c.fillStyle = g;
    c.fillRect(x, y, w, h);
    c.strokeStyle = hovered ? '#7fd4ff' : (pressed ? '#fff2a0' : '#0b0b0e');
    c.lineWidth = hovered || pressed ? 4 : 2;
    c.strokeRect(x + 1, y + 1, w - 2, h - 2);

    // corner legends, dimmed -- they say what the other shifts would give
    c.textBaseline = 'top';
    var small = Math.round(UNIT * 0.125);
    c.font = small + 'px Consolas,"DejaVu Sans Mono",monospace';

    function corner(text, colour, ax, ay, align, baseline) {
      if (!text) return;
      c.fillStyle = colour;
      c.textAlign = align; c.textBaseline = baseline;
      c.fillText(text, ax, ay, w - 8);
    }
    var dim = pressed ? 0.55 : 0.85;
    c.globalAlpha = dim * 0.8;
    if (k.type === 'normal') {
      corner(k.kw, '#cfcfe0', x + 6, y + 5, 'left', 'top');
      corner(k.ext, '#3fbf3f', x + w - 6, y + 5, 'right', 'top');
      corner(k.esym, '#bf3fbf', x + 6, y + h - 5, 'left', 'bottom');
      corner(k.sym, '#bf3f3f', x + w - 6, y + h - 5, 'right', 'bottom');
      if (k.x3d) {
        c.globalAlpha = dim * 0.55;
        corner(k.x3d, '#2f9fbf', x + w / 2, y + h - 5, 'center', 'bottom');
      }
    }
    c.globalAlpha = 1;

    // the live legend -- big, centred, and coloured by which layer it came from
    var a = this.resolve(k, s);
    var text = a.text || k.cap;
    var maxPx = k.type === 'normal' ? Math.round(UNIT * 0.42) : Math.round(UNIT * 0.22);
    var px = this.fit(text, w - 14, maxPx);
    c.font = 'bold ' + px + 'px Consolas,"DejaVu Sans Mono",monospace';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillStyle = pressed ? '#241a00' : (KIND_COLOUR[a.kind] || '#ffffff');
    c.shadowColor = 'rgba(0,0,0,0.85)'; c.shadowBlur = 4;
    c.fillText(text, x + w / 2, y + h / 2 + (k.type === 'normal' ? 2 : 0), w - 10);
    c.shadowBlur = 0;

    if (latched) {
      c.fillStyle = '#55ff55';
      c.fillRect(x + w - 14, y + h - 14, 8, 8);
    }
  };

  /* ======================================================================== */
  /*  A physical keyboard in the world                                         */
  /* ======================================================================== */

  function Keyboard3D(atlas) {
    this.atlas = atlas;
    this.group = new THREE.Group();
    this.keyMeshes = [];
    this.byId = {};

    var mat = new THREE.MeshLambertMaterial({ map: atlas.texture });
    this.material = mat;

    var ox = -ZX.KEYBOARD_W / 2, oz = -ZX.KEYBOARD_D / 2;

    for (var i = 0; i < ZX.KEYS.length; i++) {
      var k = ZX.KEYS[i];
      var w = k.uw * PITCH - (PITCH - KEYSZ);
      var d = k.uh * PITCH - (PITCH - KEYSZ);
      var geo = new THREE.BoxGeometry(w, KEYH, d);
      this.setTopUVs(geo, atlas.cells[k.id]);

      // Local space has the user standing at +Z looking towards -Z, so the
      // function row lands at the back of the case and SPACE nearest the hands.
      var mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(
        ox + (k.ux + k.uw / 2) * PITCH,
        KEYH / 2,
        oz + (k.uy + k.uh / 2) * PITCH
      );
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.keyId = k.id;
      mesh.userData.restY = mesh.position.y;
      this.group.add(mesh);
      this.keyMeshes.push(mesh);
      this.byId[k.id] = mesh;
    }
  }
  ZX.Keyboard3D = Keyboard3D;

  /** Point the +Y face of a box at one atlas cell; hide the rest in the blank strip. */
  Keyboard3D.prototype.setTopUVs = function (geo, cell) {
    var uv = geo.attributes.uv;
    var u0 = cell.x / AW, u1 = (cell.x + cell.w) / AW;
    var vTop = 1 - cell.y / AH, vBot = 1 - (cell.y + cell.h) / AH;

    // +Y face is vertices 8..11, in the order (0,1) (1,1) (0,0) (1,0).
    // On a box's top face U already runs along +X and V towards -Z, which is
    // exactly "right" and "away" for someone standing in front of the desk.
    uv.setXY(8, u0, vTop); uv.setXY(9, u1, vTop);
    uv.setXY(10, u0, vBot); uv.setXY(11, u1, vBot);

    var bu = 0.5, bv = 1 - (BLANK_Y + 32) / AH;
    for (var i = 0; i < uv.count; i++) {
      if (i >= 8 && i <= 11) continue;
      uv.setXY(i, bu, bv);
    }
    uv.needsUpdate = true;
  };

  /** Animate a key going down and springing back. */
  Keyboard3D.prototype.bump = function (id) {
    var m = this.byId[id];
    if (!m) return;
    m.position.y = m.userData.restY - 0.014;
    m.userData.until = performance.now() + 110;
  };

  Keyboard3D.prototype.update = function (now) {
    for (var i = 0; i < this.keyMeshes.length; i++) {
      var m = this.keyMeshes[i];
      if (m.userData.until && now > m.userData.until) {
        m.position.y = m.userData.restY;
        m.userData.until = 0;
      }
    }
  };

  Keyboard3D.prototype.hold = function (id, down) {
    var m = this.byId[id];
    if (!m) return;
    m.position.y = down ? m.userData.restY - 0.012 : m.userData.restY;
    m.userData.until = 0;
  };

})(window.ZX = window.ZX || {});
