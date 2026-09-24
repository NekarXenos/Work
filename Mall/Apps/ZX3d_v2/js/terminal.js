/* ==========================================================================
   terminal.js -- the machine you type on, and the four desks it appears on.

   One Machine: one CRT, one BASIC, one tape, one Z80. Four Terminals, at the
   centre of each edge of the display, are windows onto it -- walk to whichever
   is nearest and carry on where you left off.
   ========================================================================== */
(function (ZX) {
  'use strict';

  /* ======================================================================== */
  /*  Machine                                                                  */
  /* ======================================================================== */

  function Machine(env) {
    var self = this;
    this.env = env;
    this.scr = new ZX.Screen2D();
    this.scr.regionTop = 0;
    this.scr.regionBottom = 21;          // the editor keeps rows 22 and 23

    // One texture for all four terminals: they are windows onto one CRT, so
    // there is no sense uploading the same canvas four times a frame.
    this.screenTex = new THREE.CanvasTexture(this.scr.canvas);
    this.screenTex.minFilter = THREE.LinearFilter;
    this.screenTex.magFilter = THREE.NearestFilter;
    this.screenTex.generateMipmaps = false;

    this.tape = new ZX.Tape(env);
    this.spectrum = new ZX.Spectrum({
      onError: function (e) { self.print('Z80 stopped: ' + e.message); }
    });

    this.basic = new ZX.Basic({
      scr: this.scr,
      world: env.world,
      tape: this.tape,
      floorY: env.floorY,
      inkey: function () { return self.inkeyBuf; },
      onInput: function () { self.editLine = ''; self.cursor = 0; },
      onScreenMode: function (n) { if (env.onScreenMode) env.onScreenMode(n); },
      sun: env.sun,
      view: env.view,
      beep: function (d, p) { self.beep(d, p); },
      usr: function (a) { return self.usr(a); }
    });

    // editor
    this.editLine = '';
    this.cursor = 0;
    this.mode = ZX.MODE_K;
    this.capsLock = false;
    this.caps = false;                    // CAPS SHIFT held
    this.sym = false;                     // SYMBOL SHIFT held
    this.ext = 0;                         // 0 none, 1 EXTEND, 2 EXTEND-EXTEND
    this.typing = 'spectrum';             // or 'auto'
    this.inkeyBuf = '';
    this.history = [];
    this.histIdx = -1;
    this.blink = 0;

    this.emuOn = false;
    this.project3d = false;
    this.projectZ = 200;
    this.projectEvery = 4;
    this.frameCount = 0;

    this.banner();
  }
  ZX.Machine = Machine;

  Machine.prototype.print = function (s) {
    this.scr.println(s);
  };

  Machine.prototype.banner = function () {
    var s = this.scr;
    s.cls();
    s.border = 7;
    s.ink = 0; s.paper = 7; s.bright = 0;
    s.println(' ZX Spectrum 3D   © 2026');
    s.ink = 1;
    s.println(' ' + ZX.Mem.freeLine() + ' in this machine');
    s.println('');
    s.ink = 0;
    s.println(' The solid display is 255x175');
    s.println(' by 255 pixels of 1/8 m each,');
    s.println(' any of 16 colours, no clash.');
    s.println('');
    s.ink = 2;
    s.println(' YOUR FIRST LINE IN 3D:');
    s.ink = 1;
    s.println('  10 SCREEN 4');
    s.println('  20 CLS');
    s.println('  30 INK 6');
    s.println('  40 PLOT 20,20,200');
    s.println('  50 DRAW 200,120,-150');
    s.ink = 2;
    s.println(' then type RUN and walk in.');
    s.ink = 0;
    s.println('');
    s.println(' H manual  T tape  Esc leave');
    s.ink = 0;
  };

  /* ---- the edit line ------------------------------------------------------ */

  Machine.prototype.insert = function (text) {
    if (!text) return;
    this.editLine = this.editLine.slice(0, this.cursor) + text + this.editLine.slice(this.cursor);
    this.cursor += text.length;
    this.refreshMode();
  };

  Machine.prototype.backspace = function () {
    if (this.cursor <= 0) return;
    this.editLine = this.editLine.slice(0, this.cursor - 1) + this.editLine.slice(this.cursor);
    this.cursor--;
    this.refreshMode();
  };

  /** K at the start of a statement, L once a keyword has been given. */
  Machine.prototype.refreshMode = function () {
    if (this.capsLock) { this.mode = ZX.MODE_C; return; }
    var t = this.editLine.replace(/^\s*\d+\s*/, '').replace(/\s+$/, '');
    if (t === '' || /[:]$/.test(t) || /\bTHEN$/i.test(t)) this.mode = ZX.MODE_K;
    else this.mode = ZX.MODE_L;
  };

  /** What a given key would produce right now -- used by the hover preview. */
  Machine.prototype.preview = function (id) {
    var k = ZX.KEYBYID[id];
    if (!k) return '';
    var st = { caps: this.caps, sym: this.sym, ext: this.ext, mode: this.mode };
    if (k.type !== 'normal') return k.cap;
    if (st.ext === 2 && k.x3d) return k.x3d;
    if (st.ext === 1 && st.sym && k.esym) return k.esym;
    if (st.ext === 1 && k.ext) return k.ext;
    if (st.sym && k.sym) return k.sym;
    if (st.mode === ZX.MODE_K && k.kw) return k.kw;
    if (st.caps || st.mode === ZX.MODE_C) return k.cap.toUpperCase();
    return k.cap.toLowerCase();
  };

  /* ---- key handling ------------------------------------------------------- */

  Machine.prototype.keyDown = function (id) {
    var k = ZX.KEYBYID[id];
    if (!k) return;

    // While a real game is running the keys belong to it, not to the editor.
    if (this.spectrum.running) {
      if (k.type === 'break') { this.stopEmulator(); return; }
      this.spectrum.setKey(id, true);
      var sp = this.spectrum, self = this;
      clearTimeout(this.autoRelease && this.autoRelease[id]);
      this.autoRelease = this.autoRelease || {};
      this.autoRelease[id] = setTimeout(function () {
        if (sp.running) sp.setKey(id, false);
        self.autoRelease[id] = 0;
      }, 140);
      return;
    }

    switch (k.type) {
      case 'capsshift': this.caps = true; return;
      case 'symshift': this.sym = true; return;
      case 'extmode': this.ext = (this.ext + 1) % 3; return;
      case 'capslock':
        this.capsLock = !this.capsLock;
        this.refreshMode();
        return;
      case 'break':
        if (this.basic.running) { this.basic.stopNow('BREAK'); return; }
        if (this.spectrum.running) { this.stopEmulator(); return; }
        return;
      case 'delete': this.backspace(); return;
      case 'enter': this.submit(); return;
      case 'space': this.insert(' '); return;
      case 'arrow': return this.arrow(id);
      case 'edit': return this.recall();
      case 'graph': this.mode = this.mode === ZX.MODE_G ? ZX.MODE_L : ZX.MODE_G; return;
      case 'truevid': this.scr.inverse = 0; return;
      case 'invvid': this.scr.inverse = 1; return;
      case 'blank': return;
    }

    // an ordinary key: whichever legend is live is what goes in
    var out = this.preview(id);
    if (this.ext) {
      this.insert(out + ' ');
      this.ext = 0;
      return;
    }
    if (this.sym) { this.insert(out); return; }
    if (this.mode === ZX.MODE_K && k.kw) { this.insert(out + ' '); return; }
    this.insert(out);
  };

  Machine.prototype.keyUp = function (id) {
    var k = ZX.KEYBYID[id];
    if (!k) return;
    if (this.spectrum.running) {
      this.spectrum.setKey(id, false);
      if (this.autoRelease) { clearTimeout(this.autoRelease[id]); this.autoRelease[id] = 0; }
      return;
    }
    if (k.type === 'capsshift') this.caps = false;
    if (k.type === 'symshift') this.sym = false;
  };

  Machine.prototype.arrow = function (id) {
    if (id === 'LEFT') this.cursor = Math.max(0, this.cursor - 1);
    else if (id === 'RIGHT') this.cursor = Math.min(this.editLine.length, this.cursor + 1);
    else if (id === 'UP') this.recall(-1);
    else if (id === 'DOWN') this.recall(1);
  };

  Machine.prototype.recall = function (dir) {
    if (!this.history.length) {
      // EDIT with no history pulls back the highest-numbered program line
      var ls = this.basic.lines;
      if (ls.length) {
        var l = ls[ls.length - 1];
        this.editLine = l.n + ' ' + l.src;
        this.cursor = this.editLine.length;
        this.refreshMode();
      }
      return;
    }
    if (dir === undefined) dir = -1;
    this.histIdx = ZX.clamp(this.histIdx + dir, 0, this.history.length - 1);
    this.editLine = this.history[this.histIdx];
    this.cursor = this.editLine.length;
    this.refreshMode();
  };

  /** Free typing: recognise a keyword the moment it is complete. */
  Machine.prototype.typeChar = function (ch) {
    if (ch === '\n' || ch === '\r') { this.submit(); return; }
    if (ch.length !== 1 || ch < ' ') return;
    this.insert(ch);
    if (this.typing !== 'auto') return;

    var before = this.editLine.slice(0, this.cursor);
    var m = before.match(/([A-Za-z$#]+)$/);
    if (!m) return;
    var word = m[1].toUpperCase();
    if (ZX.KEYWORDS.indexOf(word) >= 0) {
      var at = this.cursor - m[1].length;
      this.editLine = this.editLine.slice(0, at) + word + this.editLine.slice(this.cursor);
      this.lastRecognised = word;
      this.refreshMode();
    }
  };

  /** ENTER with no argument; a caller may also hand in a line directly. */
  Machine.prototype.submit = function (text) {
    var line = text === undefined ? this.editLine : text;
    this.editLine = ''; this.cursor = 0;

    if (this.basic.waiting === 'input') {
      this.basic.provideInput(line);
      this.refreshMode();
      return;
    }
    if (line.trim()) {
      this.history.push(line);
      if (this.history.length > 64) this.history.shift();
      this.histIdx = this.history.length;
    }
    this.scr.ink = 0; this.scr.bright = 0;
    try {
      this.basic.submit(line);
    } catch (e) {
      this.print('? ' + e.message);
    }
    this.refreshMode();
  };

  /* ---- per-frame ---------------------------------------------------------- */

  Machine.prototype.update = function (dt, now) {
    this.frameCount++;

    if (this.spectrum.running) {
      this.spectrum.runFrame();
      this.spectrum.renderPixels();
      this.scr.blitIndexed(this.spectrum.pixels);
      this.scr.border = this.spectrum.border;
      if (this.project3d && (this.frameCount % this.projectEvery) === 0) {
        this.spectrum.projectToWorld(this.env.world, this.projectZ, ZX.MAT_SOLID);
      }
    } else {
      this.basic.step(4);
      this.drawEditLine(now);
    }
    if ((this.frameCount % 16) === 0) this.scr.tickFlash();
    if (this.scr.render()) this.screenTex.needsUpdate = true;
  };

  Machine.prototype.drawEditLine = function (now) {
    // Repainting 64 characters every frame would dirty the whole CRT and
    // force a texture upload sixty times a second for a blinking cursor.
    var blink = ((now / 320) | 0) & 1;
    var sig = this.editLine + ' ' + this.cursor + this.mode + blink +
              (this.basic.running ? 'R' : '') + (this.basic.waiting || '');
    if (sig === this.editSig) return;
    this.editSig = sig;

    var s = this.scr;
    var oldInk = s.ink, oldPaper = s.paper, oldBright = s.bright,
        oldInv = s.inverse, oldFlash = s.flashOn;
    s.ink = 7; s.paper = 1; s.bright = 1; s.inverse = 0; s.flashOn = 0;

    var prompt = this.basic.waiting === 'input' ? '?' :
                 this.basic.running ? '*' : '>';
    var text = prompt + this.editLine;
    var curAt = this.cursor + 1;

    // 62 visible columns across the two reserved rows, scrolled to the cursor
    var offset = Math.max(0, curAt - 61);
    var visible = text.slice(offset, offset + 64);

    for (var i = 0; i < 64; i++) {
      var col = i % 32, row = 22 + ((i / 32) | 0);
      var ch = i < visible.length ? visible.charCodeAt(i) : 32;
      var isCursor = (offset + i) === curAt;
      if (isCursor && !this.basic.running && blink) {
        s.putChar(col, row, this.mode.charCodeAt(0), 7, 2, 0, 0);
        continue;
      }
      s.putChar(col, row, ch, 7, 1, 0, 0);
    }
    s.ink = oldInk; s.paper = oldPaper; s.bright = oldBright;
    s.inverse = oldInv; s.flashOn = oldFlash;
  };

  /* ---- odds and ends ------------------------------------------------------ */

  Machine.prototype.beep = function (dur, pitch) {
    try {
      this.spectrum.enableAudio();
      var a = this.spectrum.audio;
      if (!a) return;
      var o = a.createOscillator(), g = a.createGain();
      o.type = 'square';
      o.frequency.value = 440 * Math.pow(2, pitch / 12);
      g.gain.value = 0.08;
      o.connect(g); g.connect(a.destination);
      o.start();
      o.stop(a.currentTime + Math.min(5, Math.max(0.01, dur)));
    } catch (e) { /* no audio, no beep */ }
  };

  Machine.prototype.usr = function (addr) {
    if (this.spectrum.running) {
      var s = this.spectrum.cpu.getState();
      s.pc = addr & 0xFFFF;
      this.spectrum.cpu.setState(s);
      return addr;
    }
    return addr;
  };

  Machine.prototype.startEmulator = function (kind, bytes, name) {
    var sp = this.spectrum;
    var res;
    if (kind === 'sna') res = sp.loadSna(bytes);
    else if (kind === 'z80') res = sp.loadZ80(bytes);
    else if (kind === 'tap' || kind === 'tzx') {
      if (kind === 'tzx') bytes = tzxToTap(bytes);
      if (!bytes) return 'That .tzx uses turbo blocks this machine cannot read.';
      var r = sp.startTap(bytes);
      res = r.mode !== 'failed';
      if (!res) return 'No entry point found on that tape.';
    } else return 'Unknown file type.';

    if (!res) return 'Could not read ' + name + '.';
    sp.enableAudio();
    this.emuOn = true;
    return null;
  };

  Machine.prototype.stopEmulator = function () {
    this.spectrum.stop();
    this.emuOn = false;
    this.scr.cls();
    this.banner();
  };

  /** Pull the standard-speed blocks out of a .tzx and rebuild them as .tap. */
  function tzxToTap(b) {
    if (String.fromCharCode(b[0], b[1], b[2], b[3], b[4], b[5], b[6]) !== 'ZXTape!') return null;
    var p = 10, out = [];
    while (p < b.length) {
      var id = b[p++];
      var len, i;
      if (id === 0x10) {                       // standard speed data
        p += 2;
        len = b[p] | (b[p + 1] << 8); p += 2;
        out.push(len & 255, (len >> 8) & 255);
        for (i = 0; i < len; i++) out.push(b[p + i]);
        p += len;
      } else if (id === 0x11) {                // turbo speed -- take the data
        p += 0x0F;
        len = b[p] | (b[p + 1] << 8) | (b[p + 2] << 16); p += 3;
        out.push(len & 255, (len >> 8) & 255);
        for (i = 0; i < len; i++) out.push(b[p + i]);
        p += len;
      } else if (id === 0x12) p += 4;
      else if (id === 0x13) { p += 1 + b[p] * 2; }
      else if (id === 0x14) { p += 0x0A; len = b[p - 3] | (b[p - 2] << 8) | (b[p - 1] << 16); p += len; }
      else if (id === 0x20 || id === 0x23 || id === 0x24) p += 2;
      else if (id === 0x21) p += 1 + b[p];
      else if (id === 0x22 || id === 0x25) { /* no body */ }
      else if (id === 0x30) p += 1 + b[p];
      else if (id === 0x31) { p += 1; p += 1 + b[p]; }
      else if (id === 0x32) { len = b[p] | (b[p + 1] << 8); p += 2 + len; }
      else if (id === 0x33) p += 1 + b[p] * 3;
      else if (id === 0x35) { p += 0x10; len = b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24); p += 4 + len; }
      else if (id === 0x5A) p += 9;
      else break;
    }
    return out.length ? new Uint8Array(out) : null;
  }

  /* ======================================================================== */
  /*  A terminal in the world                                                  */
  /* ======================================================================== */

  var DESK_W = 2.30, DESK_D = 1.10, DESK_H = 0.76;

  function Terminal(machine, atlas, label) {
    this.machine = machine;
    this.label = label;
    this.group = new THREE.Group();
    this.group.name = 'terminal-' + label;

    var caseMat = new THREE.MeshLambertMaterial({ color: 0x1c1c22 });
    var trimMat = new THREE.MeshLambertMaterial({ color: 0x2a2a33 });
    var footMat = new THREE.MeshLambertMaterial({ color: 0x121216 });

    function box(w, h, d, mat, x, y, z, rx) {
      var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      if (rx) m.rotation.x = rx;
      m.castShadow = true; m.receiveShadow = true;
      return m;
    }

    // desk
    this.group.add(box(DESK_W, 0.08, DESK_D, trimMat, 0, DESK_H, 0));
    this.group.add(box(DESK_W - 0.2, DESK_H, 0.1, footMat, 0, DESK_H / 2, -DESK_D / 2 + 0.1));
    this.group.add(box(0.12, DESK_H, DESK_D - 0.2, footMat, -DESK_W / 2 + 0.1, DESK_H / 2, 0));
    this.group.add(box(0.12, DESK_H, DESK_D - 0.2, footMat, DESK_W / 2 - 0.1, DESK_H / 2, 0));

    // Keyboard console. These are eighth-metre keys on a desk you stand at,
    // so the case is raked well back -- at a +2's near-flat angle the caps
    // would be edge-on and unreadable from where you are standing.
    this.kbGroup = new THREE.Group();
    this.kbGroup.position.set(0, DESK_H + 0.16, 0.20);
    this.kbGroup.rotation.x = 0.30;
    this.group.add(this.kbGroup);

    var caseW = ZX.KEYBOARD_W + 0.14, caseD = ZX.KEYBOARD_D + 0.16;
    this.kbGroup.add(box(caseW, 0.20, caseD, caseMat, 0, -0.10, 0));

    this.keyboard = new ZX.Keyboard3D(atlas);
    this.kbGroup.add(this.keyboard.group);

    // Monitor, at the far side of the desk and leaning back a little.
    // Its width matches the keyboard exactly, as the manual promises.
    var scrW = ZX.KEYBOARD_W, scrH = scrW * 0.75;
    this.monitor = new THREE.Group();
    this.monitor.position.set(0, DESK_H + 0.10, -DESK_D / 2 + 0.20);
    this.monitor.rotation.x = -0.13;
    this.group.add(this.monitor);

    this.monitor.add(box(scrW + 0.12, scrH + 0.14, 0.14, caseMat, 0, scrH / 2 + 0.12, -0.06));
    this.monitor.add(box(0.34, 0.10, 0.26, caseMat, 0, 0.05, -0.02));

    this.screenTex = machine.screenTex;
    var screenMat = new THREE.MeshBasicMaterial({ map: this.screenTex });
    var plane = new THREE.Mesh(new THREE.PlaneGeometry(scrW, scrH), screenMat);
    plane.position.set(0, scrH / 2 + 0.12, 0.012);
    this.monitor.add(plane);
    this.screenPlane = plane;

    // a faint glow so the CRT reads as lit
    var glow = new THREE.PointLight(0x88bbff, 0.5, 3.4);
    glow.position.set(0, DESK_H + 0.9, -DESK_D / 2 + 0.7);
    this.group.add(glow);

    // nameplate on the near lip of the desk
    var plate = makeLabel(label);
    plate.position.set(0, DESK_H + 0.045, DESK_D / 2 - 0.03);
    plate.rotation.x = -Math.PI / 2 + 0.55;
    this.group.add(plate);

    this.useSpot = new THREE.Vector3();
  }
  ZX.Terminal = Terminal;

  function makeLabel(text) {
    var c = document.createElement('canvas');
    c.width = 256; c.height = 64;
    var g = c.getContext('2d');
    g.fillStyle = '#101014'; g.fillRect(0, 0, 256, 64);
    g.fillStyle = '#d7d7d7';
    g.font = 'bold 26px Consolas,monospace';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, 128, 34);
    g.fillStyle = '#ff0000'; g.fillRect(6, 6, 40, 5);
    g.fillStyle = '#ffff00'; g.fillRect(50, 6, 40, 5);
    g.fillStyle = '#00ff00'; g.fillRect(94, 6, 40, 5);
    g.fillStyle = '#00ffff'; g.fillRect(138, 6, 40, 5);
    var t = new THREE.CanvasTexture(c);
    var m = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.125),
      new THREE.MeshBasicMaterial({ map: t }));
    return m;
  }

  Terminal.prototype.update = function (now) {
    this.keyboard.update(now);
  };

  /** Where a person stands to use this terminal, in world space. */
  Terminal.prototype.standPoint = function (out) {
    out.set(0, 0, DESK_D / 2 + 0.62);
    out.applyMatrix4(this.group.matrixWorld);
    return out;
  };

  /**
   * Where the camera sits when the terminal is in use, and what it looks at.
   * Chosen so the whole CRT sits in the upper half of the view and the whole
   * keyboard in the lower -- both fully on screen, with the key caps large
   * enough to read and click.
   */
  Terminal.prototype.seatPoint = function (out) {
    out.set(0, DESK_H + 0.90, DESK_D / 2 + 0.86);
    out.applyMatrix4(this.group.matrixWorld);
    return out;
  };

  Terminal.prototype.lookPoint = function (out) {
    out.set(0, DESK_H + 0.62, 0.06);
    out.applyMatrix4(this.group.matrixWorld);
    return out;
  };

})(window.ZX = window.ZX || {});
