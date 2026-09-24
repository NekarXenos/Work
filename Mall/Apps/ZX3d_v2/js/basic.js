/* ==========================================================================
   basic.js -- ZX Spectrum BASIC, with a third coordinate.

   Everything Sinclair shipped in 1982 still works. PLOT, DRAW and CIRCLE
   take an extra value; SCREEN 4 sends the lot into the solid display.
   The interpreter runs in slices so the world keeps turning while a
   program is running.
   ========================================================================== */
(function (ZX) {
  'use strict';

  /* ---- error reports ----------------------------------------------------- */
  var ERR = {
    OK: ['0', 'OK'],
    NEXT_NO_FOR: ['1', 'NEXT without FOR'],
    NO_VAR: ['2', 'Variable not found'],
    SUBSCRIPT: ['3', 'Subscript wrong'],
    NO_ROOM: ['4', 'Out of memory'],
    TOO_BIG: ['6', 'Number too big'],
    RET_NO_GOSUB: ['7', 'RETURN without GOSUB'],
    STOPPED: ['9', 'STOP statement'],
    RANGE: ['B', 'Integer out of range'],
    NONSENSE: ['C', 'Nonsense in BASIC'],
    NO_LINE: ['N', 'Statement lost'],
    BREAK: ['L', 'BREAK into program'],
    NO_FILE: ['R', 'Tape loading error']
  };
  function err(kind, extra) {
    var e = new Error((extra ? extra + ' -- ' : '') + ERR[kind][1]);
    e.zx = ERR[kind]; e.extra = extra;
    return e;
  }

  /* ---- tokeniser --------------------------------------------------------- */
  var KW = ZX.KEYWORDS.slice().sort(function (a, b) { return b.length - a.length; });
  var KWSET = {};
  KW.forEach(function (k) { KWSET[k] = true; });
  // Keywords long enough to be split off the front of a run-together word.
  var KWPREFIX = KW.filter(function (k) { return k.indexOf(' ') < 0; });

  var OPS2 = ['<=', '>=', '<>'];

  function tokenise(src) {
    var out = [], i = 0, n = src.length;
    while (i < n) {
      var c = src[i];
      if (c === ' ' || c === '\t') { i++; continue; }

      // number
      if ((c >= '0' && c <= '9') || (c === '.' && src[i + 1] >= '0' && src[i + 1] <= '9')) {
        var j = i;
        while (j < n && ((src[j] >= '0' && src[j] <= '9') || src[j] === '.')) j++;
        if (j < n && (src[j] === 'e' || src[j] === 'E')) {
          var k = j + 1;
          if (src[k] === '+' || src[k] === '-') k++;
          if (src[k] >= '0' && src[k] <= '9') {
            while (k < n && src[k] >= '0' && src[k] <= '9') k++;
            j = k;
          }
        }
        out.push({ t: 'n', v: parseFloat(src.slice(i, j)) });
        i = j; continue;
      }

      // string
      if (c === '"') {
        var s = '', p = i + 1;
        while (p < n) {
          if (src[p] === '"') {
            if (src[p + 1] === '"') { s += '"'; p += 2; continue; }
            p++; break;
          }
          s += src[p++];
        }
        out.push({ t: 's', v: s });
        i = p; continue;
      }

      // word
      if (/[A-Za-z_]/.test(c)) {
        var q = i;
        while (q < n && /[A-Za-z0-9_]/.test(src[q])) q++;
        if (q < n && src[q] === '$') q++;
        var word = src.slice(i, q);
        var up = word.toUpperCase();

        // two-word keywords
        if (up === 'GO' || up === 'DEF') {
          var rest = src.slice(q).replace(/^[ \t]+/, '');
          var m = rest.match(/^(TO|SUB|FN)\b/i);
          if (m) {
            var pair = up + ' ' + m[1].toUpperCase();
            if (KWSET[pair]) {
              out.push({ t: 'k', v: pair });
              i = src.indexOf(m[1], q) + m[1].length;
              continue;
            }
          }
        }

        if (KWSET[up]) { out.push({ t: 'k', v: up }); i = q; continue; }

        // Run-together keyword followed by a number, as the real machine
        // allowed: GOTO10, PAUSE50, TO10. Splitting on a following *letter*
        // would eat ordinary names -- LETter, VALue, LENgth, MATrix -- so it
        // is not done; both entry modes put a space after a keyword anyway.
        var split = null;
        for (var pi = 0; pi < KWPREFIX.length; pi++) {
          var p2 = KWPREFIX[pi];
          if (up.length <= p2.length || up.slice(0, p2.length) !== p2) continue;
          var nxt = up[p2.length];
          if (nxt < '0' || nxt > '9') continue;
          split = p2; break;
        }
        if (split) { out.push({ t: 'k', v: split }); i += split.length; continue; }

        out.push({ t: 'v', v: up, str: word.slice(-1) === '$' });
        i = q;
        continue;
      }

      // operators
      var two = src.substr(i, 2);
      if (OPS2.indexOf(two) >= 0) { out.push({ t: 'o', v: two }); i += 2; continue; }
      out.push({ t: 'o', v: c }); i++;
    }
    out.push({ t: 'e', v: '' });

    // collapse REM
    for (var z = 0; z < out.length; z++) {
      if (out[z].t === 'k' && out[z].v === 'REM') {
        out.length = z + 1;
        out.push({ t: 'e', v: '' });
        break;
      }
    }
    return out;
  }
  ZX.tokenise = tokenise;

  /* ======================================================================== */

  function Basic(env) {
    this.env = env;
    this.scr = env.scr;
    this.world = env.world;

    this.lines = [];                 // sorted [{n, src, tok}]
    this.clearVars();

    this.running = false;
    this.waiting = null;             // 'pause' | 'input' | 'key'
    this.waitUntil = 0;
    this.pc = { li: -1, ti: 0 };
    this.direct = null;
    this.stack = [];                 // GOSUB
    this.fors = [];
    this.lastReport = null;
    this.contPc = null;

    // output state
    this.mode3d = false;
    this.ink = 0; this.paper = 7; this.bright = 0; this.flash = 0;
    this.inverse = 0; this.over = 0; this.mat = ZX.MAT_SOLID;
    this.depth = 128; this.textDepth = 1;
    this.pen = { x: 0, y: 0, z: 128 };
    this.tcol = 0; this.trow = 0;

    this.sprites = {};
    this.putSaves = {};
    this.mem = new Uint8Array(65536);
    ZX.Mem.claim('basicmem', 65536);
    this.seed = 1;
  }
  ZX.Basic = Basic;

  Basic.prototype.clearVars = function () {
    this.vars = {}; this.svars = {}; this.arrays = {}; this.fns = {};
    this.dataPtr = { li: 0, ti: 0 };
    this.fors = []; this.stack = [];
  };

  /* ---- program store ------------------------------------------------------ */

  Basic.prototype.findLine = function (n) {
    for (var i = 0; i < this.lines.length; i++) if (this.lines[i].n === n) return i;
    return -1;
  };
  Basic.prototype.lineIndexAtOrAfter = function (n) {
    for (var i = 0; i < this.lines.length; i++) if (this.lines[i].n >= n) return i;
    return this.lines.length;
  };

  Basic.prototype.storeLine = function (n, src) {
    var i = this.findLine(n);
    if (!src.trim()) { if (i >= 0) this.lines.splice(i, 1); this.accountProgram(); return; }
    var rec = { n: n, src: src, tok: tokenise(src) };
    if (i >= 0) this.lines[i] = rec;
    else this.lines.splice(this.lineIndexAtOrAfter(n), 0, rec);
    this.accountProgram();
  };

  Basic.prototype.accountProgram = function () {
    var b = 0;
    for (var i = 0; i < this.lines.length; i++) b += this.lines[i].src.length + 4;
    ZX.Mem.claim('program', b);
  };

  Basic.prototype.listing = function () {
    return this.lines.map(function (l) { return l.n + ' ' + l.src; });
  };

  /* ---- entry point from the editor ---------------------------------------- */

  Basic.prototype.submit = function (text) {
    var m = text.match(/^\s*(\d+)\s?(.*)$/);
    if (m) {
      var n = parseInt(m[1], 10);
      if (n < 1 || n > 9999) { this.report(err('RANGE')); return; }
      this.storeLine(n, m[2]);
      return;
    }
    if (!text.trim()) return;
    this.runDirect(text);
  };

  Basic.prototype.runDirect = function (text) {
    this.direct = { n: 0, src: text, tok: tokenise(text) };
    this.pc = { li: -1, ti: 0 };
    this.running = true;
    this.waiting = null;
    this.lastReport = null;
  };

  Basic.prototype.curTokens = function () {
    return this.pc.li < 0 ? (this.direct ? this.direct.tok : null) : (this.lines[this.pc.li] || {}).tok;
  };
  Basic.prototype.curLineNo = function () {
    return this.pc.li < 0 ? 0 : (this.lines[this.pc.li] || {}).n;
  };

  /* ---- the slice ---------------------------------------------------------- */

  Basic.prototype.step = function (ms) {
    if (!this.running) return;
    var t0 = performance.now();

    if (this.waiting === 'pause') {
      if (performance.now() < this.waitUntil) return;
      this.waiting = null;
    }
    if (this.waiting === 'key') {
      if (!this.env.inkey()) return;
      this.waiting = null;
    }
    if (this.waiting) return;          // input: the editor will release us

    while (this.running && !this.waiting) {
      try {
        this.execOne();
      } catch (e) {
        if (e && e.zx) { this.report(e); this.running = false; return; }
        throw e;
      }
      if (performance.now() - t0 > ms) return;
    }
  };

  Basic.prototype.execOne = function () {
    var tok = this.curTokens();
    if (!tok) { this.finish(); return; }

    // end of line -> next line
    if (this.pc.ti >= tok.length || tok[this.pc.ti].t === 'e') {
      this.nextLine();
      return;
    }
    var t = tok[this.pc.ti];
    if (t.t === 'o' && (t.v === ':' || t.v === ';')) { this.pc.ti++; return; }

    this.statement(tok);
  };

  Basic.prototype.nextLine = function () {
    if (this.pc.li < 0) { this.finish(); return; }
    this.pc.li++;
    this.pc.ti = 0;
    if (this.pc.li >= this.lines.length) this.finish();
  };

  Basic.prototype.finish = function () {
    this.running = false;
    this.contPc = null;
    if (!this.lastReport) this.report(null);
  };

  Basic.prototype.report = function (e) {
    var code, text, ln = this.curLineNo(), st = 1;
    if (e && e.zx) { code = e.zx[0]; text = e.extra ? (e.extra + ' -- ' + e.zx[1]) : e.zx[1]; }
    else { code = '0'; text = 'OK'; ln = 0; }
    this.lastReport = code + ' ' + text + ', ' + ln + ':' + st;
    var s = this.scr, oldInk = s.ink, oldBright = s.bright;
    s.ink = code === '0' ? 4 : 2; s.bright = 1;
    if (s.col > 0) s.newline();
    s.println(this.lastReport);
    s.ink = oldInk; s.bright = oldBright;
  };

  Basic.prototype.stopNow = function (reason) {
    if (!this.running) return false;
    this.contPc = { li: this.pc.li, ti: this.pc.ti };
    this.running = false;
    this.waiting = null;
    this.report(err(reason || 'BREAK'));
    return true;
  };

  /* ---- helpers ------------------------------------------------------------ */

  Basic.prototype.peek = function (tok) { return tok[this.pc.ti] || { t: 'e', v: '' }; };
  Basic.prototype.isKw = function (tok, v) {
    var t = this.peek(tok); return t.t === 'k' && t.v === v;
  };
  Basic.prototype.isOp = function (tok, v) {
    var t = this.peek(tok); return t.t === 'o' && t.v === v;
  };
  Basic.prototype.eat = function (tok, v) {
    if (this.isOp(tok, v) || this.isKw(tok, v)) { this.pc.ti++; return true; }
    return false;
  };
  Basic.prototype.expect = function (tok, v) {
    if (!this.eat(tok, v)) throw err('NONSENSE', 'expected ' + v);
  };
  Basic.prototype.atEnd = function (tok) {
    var t = this.peek(tok);
    return t.t === 'e' || (t.t === 'o' && t.v === ':');
  };

  Basic.prototype.num = function (tok) {
    var v = this.expr(tok, 0);
    if (typeof v === 'string') throw err('NONSENSE', 'number wanted');
    return v;
  };
  Basic.prototype.int = function (tok) { return Math.round(this.num(tok)); };
  Basic.prototype.str = function (tok) {
    var v = this.expr(tok, 0);
    return typeof v === 'string' ? v : fmtNum(v);
  };

  Basic.prototype.inkC = function () {
    return (this.ink & 7) | ((this.bright || this.ink >= 8) ? 8 : 0);
  };
  Basic.prototype.paperC = function () {
    return (this.paper & 7) | ((this.bright || this.paper >= 8) ? 8 : 0);
  };
  Basic.prototype.paintDesc = function () {
    return { colour: this.inkC(), mat: this.mat, over: this.over, erase: false };
  };
  Basic.prototype.syncScreen = function () {
    var s = this.scr;
    s.ink = this.ink & 7; s.paper = this.paper & 7;
    s.bright = (this.bright || this.ink >= 8) ? 1 : 0;
    s.flashOn = this.flash; s.inverse = this.inverse; s.over = this.over;
  };

  /* ======================================================================== */
  /*  Statements                                                               */
  /* ======================================================================== */

  Basic.prototype.statement = function (tok) {
    var t = this.peek(tok);

    if (t.t === 'v') return this.doLet(tok, true);   // LET is optional
    if (t.t !== 'k') throw err('NONSENSE');

    this.pc.ti++;
    var kw = t.v;

    switch (kw) {
      case 'REM': this.pc.ti = tok.length; return;
      case 'LET': return this.doLet(tok, false);
      case 'PRINT': case 'LPRINT': return this.doPrint(tok);
      case 'INPUT': return this.doInput(tok);
      case 'CLS': return this.doCls(tok);
      case 'GO TO': case 'GOTO': return this.doGoto(tok);
      case 'GO SUB': case 'GOSUB': return this.doGosub(tok);
      case 'RETURN': return this.doReturn();
      case 'IF': return this.doIf(tok);
      case 'FOR': return this.doFor(tok);
      case 'NEXT': return this.doNext(tok);
      case 'STOP': throw err('STOPPED');
      case 'PAUSE': return this.doPause(tok);
      case 'RANDOMIZE': return this.doRandomize(tok);
      case 'DIM': return this.doDim(tok);
      case 'DEF FN': return this.doDefFn(tok);
      case 'DATA': this.pc.ti = tok.length; return;
      case 'READ': return this.doRead(tok);
      case 'RESTORE': return this.doRestore(tok);
      case 'RUN': return this.doRun(tok);
      case 'LIST': case 'LLIST': return this.doList(tok);
      case 'NEW': return this.doNew();
      case 'CLEAR': return this.doClear(tok);
      case 'CONTINUE': case 'CONT': return this.doContinue();
      case 'POKE': return this.doPoke(tok);
      case 'OUT': this.num(tok); this.expect(tok, ','); this.num(tok); return;
      case 'BEEP': return this.doBeep(tok);
      case 'BORDER': this.scr.border = ZX.clamp(this.int(tok), 0, 15); this.scr.dirty = true; return;

      case 'INK': this.ink = ZX.clamp(this.int(tok), 0, 15); this.syncScreen(); return;
      case 'PAPER': this.paper = ZX.clamp(this.int(tok), 0, 15); this.syncScreen(); return;
      case 'BRIGHT': this.bright = this.int(tok) ? 1 : 0; this.syncScreen(); return;
      case 'FLASH': this.flash = this.int(tok) ? 1 : 0; this.syncScreen(); return;
      case 'INVERSE': this.inverse = this.int(tok) ? 1 : 0; this.syncScreen(); return;
      case 'OVER': this.over = this.int(tok) ? 1 : 0; this.syncScreen(); return;
      case 'MAT': this.mat = ZX.clamp(this.int(tok), 0, 2); return;
      case 'DEPTH': this.depth = ZX.clamp(this.int(tok), 0, ZX.SCREEN_D - 1); return;

      case 'SCREEN': return this.doScreen(tok);
      case 'PLOT': return this.doPlot(tok);
      case 'DRAW': return this.doDraw(tok);
      case 'CIRCLE': return this.doCircle(tok);
      case 'SPHERE': return this.doSphere(tok);
      case 'CUBE': return this.doBox(tok, true);
      case 'BOX': return this.doBox(tok, false);
      case 'TEXT': return this.doText(tok);
      case 'FILL': return this.doFill(tok);
      case 'SUN': return this.doSun(tok);
      case 'VIEW': return this.doView(tok);

      case 'SPRITE': return this.doSprite(tok);
      case 'SDATA': return this.doSdata(tok);
      case 'PUT': return this.doPut(tok, false);
      case 'MOVE': return this.doPut(tok, true);
      case 'UNPUT': return this.doUnput(tok);

      case 'SAVE': return this.doSave(tok);
      case 'LOAD': case 'MERGE': return this.doLoad(tok, kw === 'MERGE');
      case 'VERIFY': this.str(tok); return;
      case 'CAT': return this.doCat();
      case 'ERASE': return this.doErase(tok);
      case 'COPY': return;
      default:
        throw err('NONSENSE', kw);
    }
  };

  /* ---- LET ---------------------------------------------------------------- */

  Basic.prototype.doLet = function (tok, implicit) {
    var t = this.peek(tok);
    if (t.t !== 'v') throw err('NONSENSE');
    this.pc.ti++;
    var name = t.v, isStr = t.str;

    if (this.isOp(tok, '(')) {
      this.pc.ti++;
      var idx = [];
      do { idx.push(this.int(tok)); } while (this.eat(tok, ','));
      this.expect(tok, ')');
      this.expect(tok, '=');
      var av = isStr ? this.str(tok) : this.num(tok);
      this.setArray(name, idx, av);
      return;
    }
    this.expect(tok, '=');
    if (isStr) this.svars[name] = this.str(tok);
    else this.vars[name] = this.num(tok);
  };

  Basic.prototype.setArray = function (name, idx, val) {
    var a = this.arrays[name];
    if (!a) throw err('NO_VAR', name);
    var off = this.arrayOffset(a, idx);
    a.data[off] = val;
  };
  Basic.prototype.arrayOffset = function (a, idx) {
    if (idx.length !== a.dims.length) throw err('SUBSCRIPT');
    var off = 0;
    for (var i = 0; i < idx.length; i++) {
      var v = idx[i];
      if (v < 1 || v > a.dims[i]) throw err('SUBSCRIPT');
      off = off * a.dims[i] + (v - 1);
    }
    return off;
  };

  Basic.prototype.doDim = function (tok) {
    var t = this.peek(tok);
    if (t.t !== 'v') throw err('NONSENSE');
    this.pc.ti++;
    this.expect(tok, '(');
    var dims = [];
    do { dims.push(Math.max(1, this.int(tok))); } while (this.eat(tok, ','));
    this.expect(tok, ')');
    var total = dims.reduce(function (a, b) { return a * b; }, 1);
    if (total > 4000000) throw err('NO_ROOM');
    if (!ZX.Mem.wouldFit(total * 8)) throw err('NO_ROOM');
    var data = new Array(total);
    for (var i = 0; i < total; i++) data[i] = t.str ? '' : 0;
    this.arrays[t.v] = { dims: dims, data: data, str: t.str };
  };

  /* ---- PRINT -------------------------------------------------------------- */

  function fmtNum(v) {
    if (!isFinite(v)) return v > 0 ? '1E38' : '-1E38';
    if (v === Math.floor(v) && Math.abs(v) < 1e10) return String(v);
    var s = v.toPrecision(9);
    if (s.indexOf('e') < 0) {
      s = s.replace(/0+$/, '').replace(/\.$/, '');
    } else {
      s = String(v).toUpperCase().replace('E+', 'E');
    }
    return s;
  }
  ZX.fmtNum = fmtNum;

  Basic.prototype.emit = function (s) {
    if (this.mode3d) this.text3dPrint(s);
    else this.scr.print(s);
  };
  Basic.prototype.emitNL = function () {
    if (this.mode3d) { this.tcol = 0; this.trow++; if (this.trow >= ZX.TROWS) this.trow = 0; }
    else this.scr.newline();
  };

  Basic.prototype.text3dPrint = function (s) {
    for (var i = 0; i < s.length; i++) {
      if (this.tcol >= ZX.TCOLS) { this.tcol = 0; this.trow++; }
      if (this.trow >= ZX.TROWS) this.trow = 0;
      var px = this.tcol * 8;
      var py = ZX.SCREEN_H - 8 - this.trow * 8;
      this.world.text(px, py, this.depth, s[i], this.paintDesc(), this.textDepth);
      this.tcol++;
    }
  };

  Basic.prototype.doPrint = function (tok) {
    this.syncScreen();
    var trailing = false;
    while (!this.atEnd(tok)) {
      trailing = false;
      if (this.isKw(tok, 'AT')) {
        this.pc.ti++;
        var r = this.int(tok); this.expect(tok, ','); var c = this.int(tok);
        if (this.mode3d) { this.trow = ZX.clamp(r, 0, ZX.TROWS - 1); this.tcol = ZX.clamp(c, 0, ZX.TCOLS - 1); }
        else this.scr.at(r, c);
      } else if (this.isKw(tok, 'TAB')) {
        this.pc.ti++;
        var n = this.int(tok);
        if (this.mode3d) this.tcol = ZX.clamp(n, 0, ZX.TCOLS - 1);
        else this.scr.col = ZX.clamp(n, 0, 31);
      } else if (this.isKw(tok, 'INK') || this.isKw(tok, 'PAPER') || this.isKw(tok, 'BRIGHT') ||
                 this.isKw(tok, 'FLASH') || this.isKw(tok, 'INVERSE') || this.isKw(tok, 'OVER')) {
        var which = this.peek(tok).v; this.pc.ti++;
        var val = this.int(tok);
        if (which === 'INK') this.ink = ZX.clamp(val, 0, 15);
        else if (which === 'PAPER') this.paper = ZX.clamp(val, 0, 15);
        else if (which === 'BRIGHT') this.bright = val ? 1 : 0;
        else if (which === 'FLASH') this.flash = val ? 1 : 0;
        else if (which === 'INVERSE') this.inverse = val ? 1 : 0;
        else this.over = val ? 1 : 0;
        this.syncScreen();
      } else {
        var v = this.expr(tok, 0);
        this.emit(typeof v === 'string' ? v : fmtNum(v));
      }

      if (this.eat(tok, ';')) { trailing = true; continue; }
      if (this.eat(tok, ',')) {
        trailing = true;
        if (this.mode3d) this.tcol = (Math.floor(this.tcol / 16) + 1) * 16;
        else this.scr.col = (Math.floor(this.scr.col / 16) + 1) * 16;
        if (!this.mode3d && this.scr.col > 31) this.scr.newline();
        continue;
      }
      if (this.eat(tok, "'")) { this.emitNL(); trailing = true; continue; }
      break;
    }
    if (!trailing) this.emitNL();
  };

  /* ---- INPUT -------------------------------------------------------------- */

  Basic.prototype.doInput = function (tok) {
    this.syncScreen();
    var prompt = '';
    // leading literal prompts
    while (this.peek(tok).t === 's') {
      prompt += this.peek(tok).v; this.pc.ti++;
      if (!this.eat(tok, ';') && !this.eat(tok, ',')) break;
    }
    var t = this.peek(tok);
    if (t.t !== 'v') throw err('NONSENSE', 'INPUT needs a variable');
    this.pc.ti++;
    this.waiting = 'input';
    this.inputReq = { name: t.v, str: t.str, prompt: prompt };
    if (prompt) this.scr.print(prompt);
    this.env.onInput(this.inputReq);
  };

  Basic.prototype.provideInput = function (text) {
    if (this.waiting !== 'input') return;
    var r = this.inputReq;
    this.scr.println(text);
    if (r.str) this.svars[r.name] = text;
    else {
      var v = parseFloat(text);
      this.vars[r.name] = isNaN(v) ? 0 : v;
    }
    this.waiting = null;
    this.inputReq = null;
  };

  /* ---- flow --------------------------------------------------------------- */

  Basic.prototype.jumpTo = function (lineNo) {
    var i = this.lineIndexAtOrAfter(lineNo);
    if (i >= this.lines.length) { this.finish(); return; }
    this.pc.li = i; this.pc.ti = 0;
  };

  Basic.prototype.doGoto = function (tok) { this.jumpTo(this.int(tok)); };

  Basic.prototype.doGosub = function (tok) {
    var n = this.int(tok);
    this.stack.push({ li: this.pc.li, ti: this.pc.ti });
    if (this.stack.length > 512) throw err('NO_ROOM', 'GOSUB nested too deep');
    this.jumpTo(n);
  };

  Basic.prototype.doReturn = function () {
    if (!this.stack.length) throw err('RET_NO_GOSUB');
    var f = this.stack.pop();
    this.pc.li = f.li; this.pc.ti = f.ti;
  };

  Basic.prototype.doIf = function (tok) {
    var cond = this.num(tok);
    if (!this.eat(tok, 'THEN')) throw err('NONSENSE', 'IF without THEN');
    if (cond) {
      if (this.peek(tok).t === 'n') { this.jumpTo(this.int(tok)); }
      return;                                    // fall through to the rest of the line
    }
    this.pc.ti = tok.length;                     // false: abandon the whole line
  };

  Basic.prototype.doFor = function (tok) {
    var t = this.peek(tok);
    if (t.t !== 'v' || t.str) throw err('NONSENSE', 'FOR needs a numeric variable');
    this.pc.ti++;
    this.expect(tok, '=');
    var from = this.num(tok);
    if (!this.eat(tok, 'TO')) throw err('NONSENSE', 'FOR without TO');
    var to = this.num(tok);
    var st = this.eat(tok, 'STEP') ? this.num(tok) : 1;
    this.vars[t.v] = from;
    // drop any stale frame for the same variable
    for (var i = this.fors.length - 1; i >= 0; i--) if (this.fors[i].name === t.v) this.fors.splice(i, 1);
    this.fors.push({ name: t.v, to: to, step: st, li: this.pc.li, ti: this.pc.ti });
    if (this.fors.length > 64) throw err('NO_ROOM', 'FOR nested too deep');
    if ((st >= 0 && from > to) || (st < 0 && from < to)) this.skipToNext(tok, t.v);
  };

  /** Jump past the matching NEXT when a loop body must not run at all. */
  Basic.prototype.skipToNext = function (tok, name) {
    var depth = 0, li = this.pc.li, ti = this.pc.ti;
    for (;;) {
      var tk = li < 0 ? (this.direct ? this.direct.tok : null) : (this.lines[li] || {}).tok;
      if (!tk) { this.fors.pop(); this.finish(); return; }
      while (ti < tk.length && tk[ti].t !== 'e') {
        var x = tk[ti];
        if (x.t === 'k' && x.v === 'FOR') depth++;
        if (x.t === 'k' && x.v === 'NEXT') {
          if (depth === 0) {
            this.pc.li = li; this.pc.ti = ti + 2;   // past NEXT and its variable
            this.fors.pop();
            return;
          }
          depth--;
        }
        ti++;
      }
      li++; ti = 0;
      if (li < 0 || li >= this.lines.length) { this.fors.pop(); this.finish(); return; }
    }
  };

  Basic.prototype.doNext = function (tok) {
    var t = this.peek(tok);
    var name = null;
    if (t.t === 'v') { name = t.v; this.pc.ti++; }
    var f = null, i;
    for (i = this.fors.length - 1; i >= 0; i--) {
      if (!name || this.fors[i].name === name) { f = this.fors[i]; break; }
    }
    if (!f) throw err('NEXT_NO_FOR');
    var v = this.vars[f.name] + f.step;
    this.vars[f.name] = v;
    if ((f.step >= 0 && v > f.to) || (f.step < 0 && v < f.to)) {
      this.fors.splice(i, 1);
      return;
    }
    this.pc.li = f.li; this.pc.ti = f.ti;
  };

  Basic.prototype.doPause = function (tok) {
    var n = this.int(tok);
    if (n <= 0) { this.waiting = 'key'; return; }
    this.waiting = 'pause';
    this.waitUntil = performance.now() + n * 20;   // 50 Hz frames
  };

  Basic.prototype.doRandomize = function (tok) {
    var n = this.atEnd(tok) ? 0 : this.int(tok);
    this.seed = n || (Date.now() & 0xffff) || 1;
  };
  Basic.prototype.rnd = function () {
    // Sinclair's own generator: s = (s*75) mod 65537 - 1
    this.seed = (this.seed * 75) % 65537;
    return (this.seed - 1) / 65536;
  };

  Basic.prototype.doRun = function (tok) {
    var start = this.atEnd(tok) ? -1 : this.int(tok);
    this.clearVars();
    if (!this.lines.length) { this.finish(); return; }
    if (start >= 0) this.jumpTo(start);
    else { this.pc.li = 0; this.pc.ti = 0; }
    this.direct = null;
    this.running = true;
  };

  Basic.prototype.doNew = function () {
    this.lines.length = 0;
    this.clearVars();
    this.accountProgram();
    this.scr.cls();
    this.finish();
  };

  Basic.prototype.doClear = function (tok) {
    if (!this.atEnd(tok)) ZX.Mem.ramtop = this.int(tok);
    this.clearVars();
  };

  Basic.prototype.doContinue = function () {
    if (!this.contPc) { this.finish(); return; }
    this.pc = { li: this.contPc.li, ti: this.contPc.ti };
    this.contPc = null;
    this.running = true;
  };

  Basic.prototype.doList = function (tok) {
    var from = this.atEnd(tok) ? 0 : this.int(tok);
    this.syncScreen();
    var s = this.scr;
    var old = s.ink; s.ink = 0;
    for (var i = 0; i < this.lines.length; i++) {
      if (this.lines[i].n < from) continue;
      s.println(this.lines[i].n + ' ' + this.lines[i].src);
    }
    s.ink = old;
  };

  Basic.prototype.doPoke = function (tok) {
    var a = this.int(tok); this.expect(tok, ','); var v = this.int(tok);
    if (a < 0 || a > 65535) throw err('RANGE');
    this.mem[a] = v & 255;
    if (this.env.poke) this.env.poke(a, v & 255);
  };

  Basic.prototype.doBeep = function (tok) {
    var d = this.num(tok); this.expect(tok, ','); var p = this.num(tok);
    if (this.env.beep) this.env.beep(d, p);
  };

  Basic.prototype.doDefFn = function (tok) {
    var t = this.peek(tok);
    if (t.t !== 'v') throw err('NONSENSE');
    this.pc.ti++;
    this.expect(tok, '(');
    var params = [];
    if (!this.isOp(tok, ')')) {
      do {
        var p = this.peek(tok);
        if (p.t !== 'v') throw err('NONSENSE');
        params.push({ name: p.v, str: p.str });
        this.pc.ti++;
      } while (this.eat(tok, ','));
    }
    this.expect(tok, ')');
    this.expect(tok, '=');
    this.fns[t.v] = { params: params, tok: tok, ti: this.pc.ti, str: t.str };
    this.pc.ti = tok.length;
  };

  /* ---- DATA / READ -------------------------------------------------------- */

  Basic.prototype.doRestore = function (tok) {
    var n = this.atEnd(tok) ? 0 : this.int(tok);
    this.dataPtr = { li: this.lineIndexAtOrAfter(n), ti: 0 };
  };

  Basic.prototype.nextDataToken = function () {
    for (;;) {
      if (this.dataPtr.li >= this.lines.length) return null;
      var tk = this.lines[this.dataPtr.li].tok;
      if (this.dataPtr.ti === 0) {
        // find a DATA keyword on this line
        var found = -1;
        for (var i = 0; i < tk.length; i++) {
          if (tk[i].t === 'k' && tk[i].v === 'DATA') { found = i + 1; break; }
        }
        if (found < 0) { this.dataPtr.li++; continue; }
        this.dataPtr.ti = found;
      }
      if (this.dataPtr.ti >= tk.length || tk[this.dataPtr.ti].t === 'e') {
        this.dataPtr.li++; this.dataPtr.ti = 0; continue;
      }
      if (tk[this.dataPtr.ti].t === 'o' && tk[this.dataPtr.ti].v === ',') { this.dataPtr.ti++; continue; }
      return tk[this.dataPtr.ti++];
    }
  };

  Basic.prototype.doRead = function (tok) {
    do {
      var t = this.peek(tok);
      if (t.t !== 'v') throw err('NONSENSE');
      this.pc.ti++;
      var d = this.nextDataToken();
      if (!d) throw err('NO_LINE', 'out of DATA');
      if (t.str) this.svars[t.v] = d.t === 's' ? d.v : fmtNum(d.v);
      else this.vars[t.v] = d.t === 'n' ? d.v : parseFloat(d.v) || 0;
    } while (this.eat(tok, ','));
  };

  /* ---- screens and graphics ---------------------------------------------- */

  Basic.prototype.doScreen = function (tok) {
    var n = this.int(tok);
    this.mode3d = (n === 4);
    this.tcol = 0; this.trow = 0;
    if (this.env.onScreenMode) this.env.onScreenMode(n);
  };

  Basic.prototype.doCls = function (tok) {
    var arg = this.atEnd(tok) ? null : this.int(tok);
    if (this.mode3d || arg === 4) {
      if (arg === 1) this.world.clearAll(0);
      else this.world.clearAbove(this.env.floorY);
      this.tcol = 0; this.trow = 0;
      this.pen = { x: 0, y: 0, z: this.depth };
      if (!this.mode3d && arg === 4) return;
    }
    if (!this.mode3d) { this.syncScreen(); this.scr.cls(); }
  };

  /**
   * Read 2 or 3 coordinates. A missing z falls back to the current DEPTH --
   * and naming a z explicitly always means the solid display, whichever
   * SCREEN is currently selected.
   */
  Basic.prototype.coords = function (tok, relative) {
    var a = this.num(tok);
    this.expect(tok, ',');
    var b = this.num(tok);
    var c = null;
    if (this.eat(tok, ',')) c = this.num(tok);
    return {
      x: a, y: b, hasZ: c !== null,
      z: c === null ? (relative ? 0 : this.depth) : c
    };
  };

  Basic.prototype.doPlot = function (tok) {
    var p = this.coords(tok, false);
    this.pen = { x: Math.round(p.x), y: Math.round(p.y), z: Math.round(p.z) };
    if (this.mode3d || p.hasZ) this.world.paint(this.pen.x, this.pen.y, this.pen.z, this.paintDesc());
    else { this.syncScreen(); this.scr.plot(this.pen.x, this.pen.y); }
  };

  Basic.prototype.doDraw = function (tok) {
    var absolute = this.eat(tok, 'TO');
    var p = this.coords(tok, !absolute);
    var nx, ny, nz;
    if (absolute) { nx = Math.round(p.x); ny = Math.round(p.y); nz = Math.round(p.z); }
    else {
      nx = this.pen.x + Math.round(p.x);
      ny = this.pen.y + Math.round(p.y);
      nz = this.pen.z + Math.round(p.z);
    }
    if (this.mode3d || p.hasZ) {
      this.world.line(this.pen.x, this.pen.y, this.pen.z, nx, ny, nz, this.paintDesc());
    } else {
      this.syncScreen(); this.scr.line(this.pen.x, this.pen.y, nx, ny);
    }
    this.pen = { x: nx, y: ny, z: nz };
  };

  Basic.prototype.doCircle = function (tok) {
    var a = this.num(tok); this.expect(tok, ',');
    var b = this.num(tok); this.expect(tok, ',');
    var c = this.num(tok), r, hasZ = false;
    if (this.eat(tok, ',')) { r = this.num(tok); hasZ = true; }
    else { r = c; c = this.depth; }
    if (this.mode3d || hasZ) this.world.circle(a, b, c, r, this.paintDesc());
    else { this.syncScreen(); this.scr.circle(a, b, r); }
    this.pen = { x: Math.round(a), y: Math.round(b), z: Math.round(c) };
  };

  Basic.prototype.doSphere = function (tok) {
    var x = this.int(tok); this.expect(tok, ',');
    var y = this.int(tok); this.expect(tok, ',');
    var z = this.int(tok); this.expect(tok, ',');
    var r = this.int(tok);
    var solid = this.eat(tok, ',') ? this.int(tok) : 0;
    this.world.sphere(x, y, z, r, this.paintDesc(), !!solid);
  };

  Basic.prototype.doBox = function (tok, solid) {
    var x = this.int(tok); this.expect(tok, ',');
    var y = this.int(tok); this.expect(tok, ',');
    var z = this.int(tok); this.expect(tok, ',');
    var w = this.int(tok); this.expect(tok, ',');
    var h = this.int(tok); this.expect(tok, ',');
    var d = this.int(tok);
    this.world.box(x, y, z, w, h, d, this.paintDesc(), solid);
  };

  Basic.prototype.doText = function (tok) {
    var x = this.int(tok); this.expect(tok, ',');
    var y = this.int(tok); this.expect(tok, ',');
    var z = this.int(tok); this.expect(tok, ',');
    var s = this.str(tok);
    var d = this.eat(tok, ',') ? this.int(tok) : this.textDepth;
    this.world.text(x, y, z, s, this.paintDesc(), d);
  };

  Basic.prototype.doFill = function (tok) {
    var x = this.int(tok); this.expect(tok, ',');
    var y = this.int(tok); this.expect(tok, ',');
    var z = this.int(tok);
    this.world.fill(x, y, z, this.paintDesc());
  };

  Basic.prototype.doSun = function (tok) {
    var az = this.num(tok); this.expect(tok, ','); var el = this.num(tok);
    if (this.env.sun) this.env.sun(az, el);
  };

  Basic.prototype.doView = function (tok) {
    var x = this.num(tok); this.expect(tok, ',');
    var y = this.num(tok); this.expect(tok, ',');
    var z = this.num(tok);
    if (this.env.view) this.env.view(x, y, z);
  };

  /* ---- sprites ------------------------------------------------------------ */

  Basic.prototype.doSprite = function (tok) {
    var n = this.int(tok); this.expect(tok, ',');
    var w = ZX.clamp(this.int(tok), 1, 64); this.expect(tok, ',');
    var h = ZX.clamp(this.int(tok), 1, 64); this.expect(tok, ',');
    var d = ZX.clamp(this.int(tok), 1, 64);
    var frames = this.eat(tok, ',') ? ZX.clamp(this.int(tok), 1, 32) : 8;
    var bytes = w * h * d * frames;
    if (!ZX.Mem.wouldFit(bytes)) throw err('NO_ROOM');
    var fr = [];
    for (var i = 0; i < frames; i++) fr.push(new Uint8Array(w * h * d));
    this.sprites[n] = { w: w, h: h, d: d, nf: frames, f: fr };
    ZX.Mem.claim('sprite' + n, bytes);
  };

  Basic.prototype.doSdata = function (tok) {
    var n = this.int(tok); this.expect(tok, ',');
    var f = this.int(tok); this.expect(tok, ',');
    var row = this.int(tok); this.expect(tok, ',');
    var s = this.str(tok);
    var layer = this.eat(tok, ',') ? this.int(tok) : 0;
    var sp = this.sprites[n];
    if (!sp) throw err('NO_VAR', 'SPRITE ' + n);
    if (f < 0 || f >= sp.nf || row < 0 || row >= sp.h || layer < 0 || layer >= sp.d) throw err('SUBSCRIPT');
    var buf = sp.f[f], base = (layer * sp.h + row) * sp.w;
    for (var i = 0; i < sp.w; i++) {
      var ch = i < s.length ? s[i] : '.';
      var v = 0;
      if (ch !== '.' && ch !== ' ') {
        var d = parseInt(ch, 16);
        if (!isNaN(d)) v = sp.materials ? ZX.vox(d, this.mat) : d + 1;
      }
      buf[base + i] = v;
    }
  };

  Basic.prototype.spriteArgs = function (tok) {
    var n = this.int(tok); this.expect(tok, ',');
    var x = this.int(tok); this.expect(tok, ',');
    var y = this.int(tok); this.expect(tok, ',');
    var z = this.int(tok);
    var f = this.eat(tok, ',') ? this.int(tok) : 0;
    return { n: n, x: x, y: y, z: z, f: f };
  };

  Basic.prototype.doPut = function (tok, move) {
    var a = this.spriteArgs(tok);
    if (move) this.unput(a.n);
    this.put(a.n, a.x, a.y, a.z, a.f);
  };

  Basic.prototype.doUnput = function (tok) { this.unput(this.int(tok)); };

  Basic.prototype.put = function (n, x, y, z, f) {
    var sp = this.sprites[n];
    if (!sp) throw err('NO_VAR', 'SPRITE ' + n);
    f = ((f | 0) % sp.nf + sp.nf) % sp.nf;
    var buf = sp.f[f];
    if (!ZX.Mem.wouldFit(sp.w * sp.h * sp.d * 2)) throw err('NO_ROOM');
    var save = new Uint8Array(sp.w * sp.h * sp.d);
    var mask = new Uint8Array(sp.w * sp.h * sp.d);
    var w = this.world, mat = this.mat, over = this.over;
    var i = 0;
    for (var l = 0; l < sp.d; l++) {
      for (var r = 0; r < sp.h; r++) {
        for (var c = 0; c < sp.w; c++, i++) {
          var v = buf[(l * sp.h + r) * sp.w + c];
          if (!v) continue;
          var wx = x + c, wy = y + (sp.h - 1 - r), wz = z + l;
          save[i] = w.get(wx, wy, wz);
          mask[i] = 1;
          w.paint(wx, wy, wz, { colour: (v - 1) & 15,
            mat: sp.materials ? (v - 1) >> 4 : mat, over: over, erase: false });
        }
      }
    }
    this.putSaves[n] = { x: x, y: y, z: z, w: sp.w, h: sp.h, d: sp.d, save: save, mask: mask };
  };

  Basic.prototype.unput = function (n) {
    var s = this.putSaves[n];
    if (!s) return;
    var w = this.world, i = 0;
    for (var l = 0; l < s.d; l++) {
      for (var r = 0; r < s.h; r++) {
        for (var c = 0; c < s.w; c++, i++) {
          if (!s.mask[i]) continue;
          w.set(s.x + c, s.y + (s.h - 1 - r), s.z + l, s.save[i]);
        }
      }
    }
    delete this.putSaves[n];
  };

  /* ---- tape --------------------------------------------------------------- */

  Basic.prototype.doSave = function (tok) {
    var name = this.atEnd(tok) ? '' : this.str(tok);
    var what = 'program';
    if (this.eat(tok, 'SPRITE')) {
      var n = this.int(tok);
      try {
        var bytes = this.env.tape.saveAsset(ZX.Assets.captureExistingSprite(this, n, name));
        this.scr.println('Saved "' + (name || 'untitled') + '" (sprite, ' + ZX.Mem.fmt(bytes.length) + ')');
      } catch (e) { throw err('NO_FILE', e.message); }
      return;
    }
    if (this.eat(tok, 'SCREEN$')) what = 'screen';
    else if (this.eat(tok, 'DATA')) what = 'data';
    var res;
    try { res = this.env.tape.saveFromBasic(this, name, what); }
    catch (e) { throw err('NO_FILE', e.message); }
    this.scr.println('Saved "' + (name || 'untitled') + '" (' + what + ', ' + ZX.Mem.fmt(res) + ')');
  };

  Basic.prototype.doLoad = function (tok, merge) {
    var name = this.atEnd(tok) ? '' : this.str(tok);
    if (this.eat(tok, 'SPRITE')) {
      var n = this.int(tok), loaded;
      try { loaded = this.env.tape.loadSprite(this, name, n); }
      catch (e) { throw err('NO_FILE', e.message); }
      if (!loaded) throw err('NO_FILE', name);
      return;
    }
    if (this.eat(tok, 'SCREEN$')) {
      var restored;
      try { restored = this.env.tape.loadWorld(this, name); }
      catch (e) { throw err('NO_FILE', e.message); }
      if (!restored) throw err('NO_FILE', name);
      return;
    }
    var ok = this.env.tape.loadIntoBasic(this, name, merge);
    if (!ok) throw err('NO_FILE', name || 'first block');
  };

  Basic.prototype.doCat = function () {
    var items = this.env.tape.catalogue();
    this.scr.println('Tape: ' + items.length + ' block(s)');
    for (var i = 0; i < items.length; i++) {
      this.scr.println(' ' + (items[i].name || '<unnamed>') + '  ' + items[i].kind +
        '  ' + ZX.Mem.fmt(items[i].size));
    }
  };

  Basic.prototype.doErase = function (tok) {
    var name = this.str(tok);
    var n = this.env.tape.erase(name);
    this.scr.println(n ? 'Erased "' + name + '"' : 'Not found: "' + name + '"');
  };

  /* ======================================================================== */
  /*  Expressions                                                              */
  /* ======================================================================== */

  var BINPREC = {
    'OR': 2, 'AND': 3,
    '=': 5, '<>': 5, '<': 5, '>': 5, '<=': 5, '>=': 5,
    '+': 6, '-': 6, '*': 8, '/': 8, '^': 10
  };

  Basic.prototype.expr = function (tok, minPrec) {
    var left = this.unary(tok);
    for (;;) {
      var t = this.peek(tok);
      var op = null;
      if (t.t === 'o' && BINPREC[t.v] !== undefined) op = t.v;
      else if (t.t === 'k' && (t.v === 'AND' || t.v === 'OR')) op = t.v;
      if (!op) break;
      var prec = BINPREC[op];
      if (prec < minPrec) break;
      this.pc.ti++;
      var right = this.expr(tok, op === '^' ? prec : prec + 1);
      left = this.binop(op, left, right);
    }
    return left;
  };

  Basic.prototype.binop = function (op, a, b) {
    var sa = typeof a === 'string', sb = typeof b === 'string';
    if (op === 'AND') {
      if (sa) return b ? a : '';
      return b ? a : 0;
    }
    if (op === 'OR') return b ? 1 : a;
    if (sa !== sb && op !== '+') throw err('NONSENSE', 'mixed types');
    if (sa && sb) {
      switch (op) {
        case '+': return a + b;
        case '=': return a === b ? 1 : 0;
        case '<>': return a !== b ? 1 : 0;
        case '<': return a < b ? 1 : 0;
        case '>': return a > b ? 1 : 0;
        case '<=': return a <= b ? 1 : 0;
        case '>=': return a >= b ? 1 : 0;
      }
      throw err('NONSENSE', 'strings');
    }
    if (sa || sb) throw err('NONSENSE', 'mixed types');
    switch (op) {
      case '+': return a + b;
      case '-': return a - b;
      case '*': return a * b;
      case '/': if (b === 0) throw err('TOO_BIG', 'division by zero'); return a / b;
      case '^': return Math.pow(a, b);
      case '=': return a === b ? 1 : 0;
      case '<>': return a !== b ? 1 : 0;
      case '<': return a < b ? 1 : 0;
      case '>': return a > b ? 1 : 0;
      case '<=': return a <= b ? 1 : 0;
      case '>=': return a >= b ? 1 : 0;
    }
    throw err('NONSENSE', op);
  };

  Basic.prototype.unary = function (tok) {
    if (this.eat(tok, '-')) { var v = this.unary(tok); if (typeof v === 'string') throw err('NONSENSE'); return -v; }
    if (this.eat(tok, '+')) return this.unary(tok);
    if (this.isKw(tok, 'NOT')) { this.pc.ti++; return this.expr(tok, 4) ? 0 : 1; }
    return this.power(tok);
  };

  Basic.prototype.power = function (tok) { return this.primary(tok); };

  var FN1 = {
    SIN: Math.sin, COS: Math.cos, TAN: Math.tan,
    ASN: Math.asin, ACS: Math.acos, ATN: Math.atan,
    LN: function (x) { if (x <= 0) throw err('TOO_BIG', 'LN'); return Math.log(x); },
    EXP: Math.exp, SQR: function (x) { if (x < 0) throw err('TOO_BIG', 'SQR'); return Math.sqrt(x); },
    ABS: Math.abs, INT: Math.floor,
    SGN: function (x) { return x > 0 ? 1 : x < 0 ? -1 : 0; }
  };

  Basic.prototype.primary = function (tok) {
    var t = this.peek(tok);

    if (t.t === 'n') { this.pc.ti++; return t.v; }
    if (t.t === 's') { this.pc.ti++; return t.v; }

    if (t.t === 'o' && t.v === '(') {
      this.pc.ti++;
      var v = this.expr(tok, 0);
      this.expect(tok, ')');
      return v;
    }

    if (t.t === 'k') {
      this.pc.ti++;
      var k = t.v;
      if (FN1[k]) return FN1[k](this.argNum(tok));
      switch (k) {
        case 'PI': return Math.PI;
        case 'RND': return this.rnd();
        case 'INKEY$': return this.env.inkey();
        case 'MEM': case 'FREE': return ZX.Mem.free();
        case 'LEN': return this.argStr(tok).length;
        case 'STR$': return fmtNum(this.argNum(tok));
        case 'VAL': { var s = this.argStr(tok); var n = parseFloat(s); return isNaN(n) ? 0 : n; }
        case 'VAL$': return this.argStr(tok);
        case 'CHR$': return String.fromCharCode(ZX.clamp(Math.round(this.argNum(tok)), 0, 255));
        case 'CODE': { var s2 = this.argStr(tok); return s2.length ? s2.charCodeAt(0) : 0; }
        case 'PEEK': { var a = Math.round(this.argNum(tok)); return this.mem[a & 0xffff]; }
        case 'IN': this.argNum(tok); return 255;
        case 'USR': return this.doUsr(Math.round(this.argNum(tok)));
        case 'BIN': return this.readBin(tok);
        case 'NOT': return this.expr(tok, 4) ? 0 : 1;
        case 'POINT': return this.fnPoint(tok);
        case 'ATTR': return this.fnAttr(tok);
        case 'SCREEN$': return this.fnScreenD(tok);
        case 'FN': return this.callFn(tok);
        case 'AT': case 'TAB': throw err('NONSENSE', k);
      }
      throw err('NONSENSE', k);
    }

    if (t.t === 'v') {
      this.pc.ti++;
      var name = t.v;
      if (this.isOp(tok, '(')) {
        this.pc.ti++;
        // string slicing: a$(2 TO 5) or a$(3)
        if (t.str && this.svars[name] !== undefined && !this.arrays[name]) {
          return this.slice(tok, this.svars[name]);
        }
        var idx = [];
        do { idx.push(this.int(tok)); } while (this.eat(tok, ','));
        this.expect(tok, ')');
        var a = this.arrays[name];
        if (!a) throw err('NO_VAR', name);
        return a.data[this.arrayOffset(a, idx)];
      }
      if (t.str) {
        if (this.svars[name] === undefined) throw err('NO_VAR', name + '$');
        return this.svars[name];
      }
      if (this.vars[name] === undefined) throw err('NO_VAR', name);
      return this.vars[name];
    }

    throw err('NONSENSE');
  };

  Basic.prototype.slice = function (tok, s) {
    if (this.isOp(tok, ')')) { this.pc.ti++; return s; }
    var a = null, b = null;
    if (!this.isKw(tok, 'TO')) a = this.int(tok);
    if (this.eat(tok, 'TO')) {
      if (!this.isOp(tok, ')')) b = this.int(tok);
      this.expect(tok, ')');
      var from = a === null ? 1 : a, to = b === null ? s.length : b;
      if (from < 1) from = 1;
      if (to > s.length) to = s.length;
      return from > to ? '' : s.slice(from - 1, to);
    }
    this.expect(tok, ')');
    return (a >= 1 && a <= s.length) ? s[a - 1] : '';
  };

  /** An argument that may or may not be bracketed, as Sinclair allowed. */
  Basic.prototype.argNum = function (tok) {
    var v = this.expr(tok, 9);
    if (typeof v === 'string') throw err('NONSENSE', 'number wanted');
    return v;
  };
  Basic.prototype.argStr = function (tok) {
    var v = this.expr(tok, 9);
    return typeof v === 'string' ? v : fmtNum(v);
  };

  Basic.prototype.readBin = function (tok) {
    var t = this.peek(tok), s = '';
    while (t.t === 'n' && /^[01]+$/.test(String(t.v))) {
      s += String(t.v); this.pc.ti++; t = this.peek(tok);
    }
    return s ? parseInt(s, 2) : 0;
  };

  Basic.prototype.fnPoint = function (tok) {
    this.expect(tok, '(');
    var x = this.int(tok); this.expect(tok, ',');
    var y = this.int(tok);
    var hasZ = this.eat(tok, ',');
    var z = hasZ ? this.int(tok) : this.depth;
    this.expect(tok, ')');
    if (this.mode3d || hasZ) {
      var v = this.world.get(x, y, z);
      return v ? ZX.voxColour(v) : -1;
    }
    return this.scr.getPixel(x, 175 - y) === this.inkC() ? 1 : 0;
  };

  Basic.prototype.fnAttr = function (tok) {
    this.expect(tok, '(');
    var r = this.int(tok); this.expect(tok, ','); var c = this.int(tok);
    this.expect(tok, ')');
    return this.scr.getPixel(c * 8, r * 8);
  };

  Basic.prototype.fnScreenD = function (tok) {
    this.expect(tok, '(');
    var r = this.int(tok); this.expect(tok, ','); var c = this.int(tok);
    this.expect(tok, ')');
    var code = this.scr.charAt(c, r);
    return code >= 32 && code < 127 ? String.fromCharCode(code) : '';
  };

  Basic.prototype.callFn = function (tok) {
    var t = this.peek(tok);
    if (t.t !== 'v') throw err('NONSENSE');
    this.pc.ti++;
    var f = this.fns[t.v];
    if (!f) throw err('NO_VAR', 'FN ' + t.v);
    this.expect(tok, '(');
    var args = [];
    if (!this.isOp(tok, ')')) {
      do { args.push(this.expr(tok, 0)); } while (this.eat(tok, ','));
    }
    this.expect(tok, ')');

    var savedN = {}, savedS = {}, i;
    for (i = 0; i < f.params.length; i++) {
      var p = f.params[i];
      if (p.str) { savedS[p.name] = this.svars[p.name]; this.svars[p.name] = String(args[i]); }
      else { savedN[p.name] = this.vars[p.name]; this.vars[p.name] = Number(args[i]) || 0; }
    }
    var savePc = { li: this.pc.li, ti: this.pc.ti };
    this.pc.ti = f.ti;
    var val = this.expr(f.tok, 0);
    this.pc = savePc;
    for (i = 0; i < f.params.length; i++) {
      var p2 = f.params[i];
      if (p2.str) this.svars[p2.name] = savedS[p2.name];
      else this.vars[p2.name] = savedN[p2.name];
    }
    return val;
  };

  Basic.prototype.doUsr = function (addr) {
    if (this.env.usr) return this.env.usr(addr);
    return addr;
  };

})(window.ZX = window.ZX || {});
