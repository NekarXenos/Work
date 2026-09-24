/* ==========================================================================
   tape.js -- the virtual cassette.

   Native blocks hold BASIC source, the voxel world, or raw bytes. Export
   writes a genuine .tap with properly tokenised BASIC, so a program written
   here will load on a real Spectrum emulator; import accepts .tap, .tzx,
   .sna and .z80 and hands the interesting ones to the Z80.
   ========================================================================== */
(function (ZX) {
  'use strict';

  /* ---- the Sinclair token table, codes 165..255 -------------------------- */
  var TOKENS = [
    'RND', 'INKEY$', 'PI', 'FN ', 'POINT ', 'SCREEN$ ', 'ATTR ', 'AT ', 'TAB ',
    'VAL$ ', 'CODE ', 'VAL ', 'LEN ', 'SIN ', 'COS ', 'TAN ', 'ASN ', 'ACS ',
    'ATN ', 'LN ', 'EXP ', 'INT ', 'SQR ', 'SGN ', 'ABS ', 'PEEK ', 'IN ',
    'USR ', 'STR$ ', 'CHR$ ', 'NOT ', 'BIN ', 'OR ', 'AND ', '<=', '>=', '<>',
    'LINE ', 'THEN ', 'TO ', 'STEP ', 'DEF FN ', 'CAT ', 'FORMAT ', 'MOVE ',
    'ERASE ', 'OPEN #', 'CLOSE #', 'MERGE ', 'VERIFY ', 'BEEP ', 'CIRCLE ',
    'INK ', 'PAPER ', 'FLASH ', 'BRIGHT ', 'INVERSE ', 'OVER ', 'OUT ',
    'LPRINT ', 'LLIST ', 'STOP ', 'READ ', 'DATA ', 'RESTORE ', 'NEW ',
    'BORDER ', 'CONTINUE ', 'DIM ', 'REM ', 'FOR ', 'GO TO ', 'GO SUB ',
    'INPUT ', 'LOAD ', 'LIST ', 'LET ', 'PAUSE ', 'NEXT ', 'POKE ', 'PRINT ',
    'PLOT ', 'RUN ', 'SAVE ', 'RANDOMIZE ', 'IF ', 'CLS ', 'DRAW ', 'CLEAR ',
    'RETURN ', 'COPY '
  ];
  var TOKEN_CODE = {};
  TOKENS.forEach(function (t, i) { TOKEN_CODE[t.trim()] = 165 + i; });

  /* ---- the five-byte Sinclair number ------------------------------------- */
  function numberBytes(v) {
    var b = new Uint8Array(5);
    if (v === Math.floor(v) && v >= -65535 && v <= 65535) {
      var n = v < 0 ? 65536 + v : v;
      b[0] = 0; b[1] = v < 0 ? 0xFF : 0x00;
      b[2] = n & 255; b[3] = (n >> 8) & 255; b[4] = 0;
      return b;
    }
    var neg = v < 0; v = Math.abs(v);
    var e = Math.ceil(Math.log(v) / Math.LN2);
    var m = v / Math.pow(2, e);
    while (m >= 1) { m /= 2; e++; }
    while (m < 0.5) { m *= 2; e--; }
    var man = Math.round(m * 4294967296);
    if (man > 0xFFFFFFFF) { man >>>= 1; e++; }
    b[0] = (e + 128) & 255;
    b[1] = ((man >>> 24) & 0x7F) | (neg ? 0x80 : 0);
    b[2] = (man >>> 16) & 255;
    b[3] = (man >>> 8) & 255;
    b[4] = man & 255;
    return b;
  }

  /* ---- source line -> Spectrum bytes ------------------------------------- */
  var SORTED_TOKENS = Object.keys(TOKEN_CODE).sort(function (a, b) { return b.length - a.length; });

  function tokeniseLine(src) {
    var out = [], i = 0, n = src.length;
    while (i < n) {
      var c = src[i];

      if (c === '"') {                        // strings pass through untouched
        out.push(34); i++;
        while (i < n) {
          out.push(src.charCodeAt(i));
          if (src[i] === '"') { i++; break; }
          i++;
        }
        continue;
      }

      if (c >= '0' && c <= '9') {             // literal + hidden binary value
        var j = i;
        while (j < n && /[0-9.]/.test(src[j])) j++;
        if (src[j] === 'e' || src[j] === 'E') {
          var k = j + 1;
          if (src[k] === '+' || src[k] === '-') k++;
          while (k < n && src[k] >= '0' && src[k] <= '9') k++;
          if (k > j + 1) j = k;
        }
        var text = src.slice(i, j);
        for (var q = 0; q < text.length; q++) out.push(text.charCodeAt(q));
        out.push(0x0E);
        var nb = numberBytes(parseFloat(text));
        for (q = 0; q < 5; q++) out.push(nb[q]);
        i = j;
        continue;
      }

      if (/[A-Za-z]/.test(c)) {               // keyword?
        var up = src.slice(i).toUpperCase(), hit = null;
        for (var t = 0; t < SORTED_TOKENS.length; t++) {
          var kw = SORTED_TOKENS[t];
          if (up.slice(0, kw.length) === kw) {
            var after = up[kw.length];
            if (after === undefined || !/[A-Z0-9$]/.test(after) || kw === 'GO TO' || kw === 'GO SUB') {
              hit = kw; break;
            }
          }
        }
        if (hit) {
          out.push(TOKEN_CODE[hit]);
          i += hit.length;
          if (src[i] === ' ') i++;
          continue;
        }
        out.push(src.charCodeAt(i)); i++;
        continue;
      }

      out.push(src.charCodeAt(i) & 255); i++;
    }
    return out;
  }

  function detokenise(bytes, start, end) {
    var s = '', i = start;
    while (i < end) {
      var b = bytes[i];
      if (b === 0x0E) { i += 6; continue; }          // hidden number: keep the text
      if (b >= 165) s += TOKENS[b - 165];
      else if (b === 13) s += '\n';
      else if (b >= 32 && b < 127) s += String.fromCharCode(b);
      else if (b === 0x60) s += '£';
      i++;
    }
    return s;
  }
  ZX.detokenise = detokenise;

  /* ---- TAP block plumbing ------------------------------------------------ */
  function tapBlock(flag, data) {
    var out = new Uint8Array(data.length + 4);
    var len = data.length + 2;
    out[0] = len & 255; out[1] = len >> 8;
    out[2] = flag;
    out.set(data, 3);
    var chk = flag;
    for (var i = 0; i < data.length; i++) chk ^= data[i];
    out[out.length - 1] = chk;
    return out;
  }

  function tapHeader(type, name, length, p1, p2) {
    var d = new Uint8Array(17);
    d[0] = type;
    name = (name || '').toUpperCase().slice(0, 10);
    for (var i = 0; i < 10; i++) d[1 + i] = i < name.length ? name.charCodeAt(i) : 32;
    d[11] = length & 255; d[12] = length >> 8;
    d[13] = p1 & 255; d[14] = (p1 >> 8) & 255;
    d[15] = p2 & 255; d[16] = (p2 >> 8) & 255;
    return tapBlock(0x00, d);
  }

  function concat(list) {
    var n = 0, i;
    for (i = 0; i < list.length; i++) n += list[i].length;
    var out = new Uint8Array(n), o = 0;
    for (i = 0; i < list.length; i++) { out.set(list[i], o); o += list[i].length; }
    return out;
  }

  /* ======================================================================== */

  function Tape(env) {
    this.env = env;
    this.blocks = [];
    this.file = null;            // the raw .tap/.tzx/.sna/.z80 last inserted
    this.fileName = '';
    this.fileKind = '';
    this.load();
  }
  ZX.Tape = Tape;

  Tape.prototype.accounting = function () {
    var b = 0;
    for (var i = 0; i < this.blocks.length; i++) b += this.blocks[i].data.length + 32;
    if (this.file) b += this.file.length;
    ZX.Mem.claim('tape', b);
  };

  /* ---- persistence ------------------------------------------------------- */
  Tape.prototype.save = function () {
    this.accounting();
    try {
      var packed = this.blocks.map(function (b) {
        return { n: b.name, k: b.kind, d: b64(b.data) };
      });
      localStorage.setItem('zx3d.tape', JSON.stringify(packed));
      this.lastSavePersisted = true;
    } catch (e) { this.lastSavePersisted = false; }
    return this.lastSavePersisted;
  };

  Tape.prototype.load = function () {
    try {
      var raw = localStorage.getItem('zx3d.tape');
      if (!raw) return;
      var packed = JSON.parse(raw);
      this.blocks = packed.map(function (b) {
        return { name: b.n, kind: b.k, data: unb64(b.d) };
      });
    } catch (e) { this.blocks = []; }
    this.accounting();
  };

  function b64(u8) {
    var s = '', CH = 0x8000;
    for (var i = 0; i < u8.length; i += CH) {
      s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
    }
    return btoa(s);
  }
  function unb64(s) {
    var bin = atob(s), u8 = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  }
  ZX.b64 = b64; ZX.unb64 = unb64;

  /* ---- catalogue --------------------------------------------------------- */
  Tape.prototype.catalogue = function () {
    var out = this.blocks.map(function (b) {
      return { name: b.name, kind: b.kind, size: b.data.length };
    });
    if (this.file) out.push({ name: this.fileName, kind: this.fileKind, size: this.file.length });
    return out;
  };

  Tape.prototype.find = function (name, kind) {
    if (!name) {
      for (var i = 0; i < this.blocks.length; i++) {
        if (!kind || this.blocks[i].kind === kind) return this.blocks[i];
      }
      return null;
    }
    var up = name.toUpperCase();
    for (var j = 0; j < this.blocks.length; j++) {
      if (this.blocks[j].name.toUpperCase() === up && (!kind || this.blocks[j].kind === kind)) {
        return this.blocks[j];
      }
    }
    return null;
  };

  Tape.prototype.put = function (name, kind, data) {
    var ex = this.find(name, kind);
    if (ex) { ex.data = data; }
    else this.blocks.push({ name: name, kind: kind, data: data });
    this.save();
    return data.length;
  };

  Tape.prototype.erase = function (name) {
    var before = this.blocks.length, up = (name || '').toUpperCase();
    this.blocks = this.blocks.filter(function (b) { return b.name.toUpperCase() !== up; });
    this.save();
    return before - this.blocks.length;
  };

  Tape.prototype.wipe = function () {
    this.blocks = []; this.file = null; this.fileName = ''; this.fileKind = '';
    this.save();
  };

  /* ---- BASIC <-> tape ---------------------------------------------------- */
  Tape.prototype.saveFromBasic = function (basic, name, what) {
    name = name || 'untitled';
    if (what === 'screen') {
      return this.saveAsset(ZX.Assets.captureScene(basic.world, name)).length;
    }
    if (what === 'data') {
      var json = JSON.stringify({ v: basic.vars, s: basic.svars });
      return this.put(name, 'data', strToU8(json));
    }
    var src = basic.listing().join('\n');
    return this.put(name, 'program', strToU8(src));
  };

  Tape.prototype.loadIntoBasic = function (basic, name, merge) {
    var b = this.find(name, 'program');
    if (!b) return false;
    var src = u8ToStr(b.data).split('\n');
    if (!merge) { basic.lines.length = 0; basic.clearVars(); }
    for (var i = 0; i < src.length; i++) {
      var m = src[i].match(/^\s*(\d+)\s?(.*)$/);
      if (m) basic.storeLine(parseInt(m[1], 10), m[2]);
    }
    return true;
  };

  Tape.prototype.loadWorld = function (basic, name) {
    var asset = this.find(name, 'scene');
    if (asset) {
      ZX.Assets.applyScene(basic, ZX.Assets.decode(asset.data));
      return true;
    }
    var b = this.find(name, 'world');
    if (!b) return false;
    basic.world.deserialise(b.data);
    basic.putSaves = {};
    return true;
  };

  Tape.prototype.saveAsset = function (asset) {
    var bytes = ZX.Assets.encode(asset);
    var kind = asset.kind === 'world' ? 'scene' : 'sprite';
    var previous = this.find(asset.name, kind);
    if (!ZX.Mem.wouldFit(Math.max(0, bytes.length - (previous ? previous.data.length : 0)))) {
      throw new Error('Not enough memory to save this 3D asset on tape');
    }
    this.put(asset.name, kind, bytes);
    return bytes;
  };

  Tape.prototype.importAsset = function (bytes) {
    var asset = ZX.Assets.decode(bytes); // validate fully before changing tape
    this.saveAsset(asset);
    return asset;
  };

  Tape.prototype.exportAsset = function (name, kind) {
    var b = this.find(name, kind);
    if (!b || (b.kind !== 'scene' && b.kind !== 'sprite')) throw new Error('3D asset not found: ' + name);
    return b.data;
  };

  Tape.prototype.loadSprite = function (basic, name, n) {
    var b = this.find(name, 'sprite');
    if (!b) return false;
    ZX.Assets.installSprite(basic, ZX.Assets.decode(b.data), n);
    return true;
  };

  function strToU8(s) {
    var u = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 255;
    return u;
  }
  function u8ToStr(u) {
    var s = '';
    for (var i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
    return s;
  }

  /* ---- export ------------------------------------------------------------ */
  Tape.prototype.exportTap = function () {
    var parts = [];
    for (var i = 0; i < this.blocks.length; i++) {
      var b = this.blocks[i];
      // Native 3D assets have their own portable format and exceed TAP limits.
      if (b.kind === 'scene' || b.kind === 'sprite') continue;
      if (b.kind === 'program') {
        var prog = this.encodeProgram(u8ToStr(b.data));
        if (prog.length > 65533) throw new Error('Program "' + b.name + '" is too large for a .tap block');
        parts.push(tapHeader(0, b.name, prog.length, 32768, prog.length));
        parts.push(tapBlock(0xFF, prog));
      } else {
        if (b.data.length > 65533) throw new Error('Block "' + b.name + '" is too large for .tap. Save the 3D screen as .zx3d instead.');
        // anything else rides along as a CODE block
        parts.push(tapHeader(3, b.name, b.data.length, 32768, 32768));
        parts.push(tapBlock(0xFF, b.data));
      }
    }
    if (this.file && this.fileKind === 'tap') parts.push(this.file);
    return concat(parts);
  };

  /** Whole listing -> the byte image the Spectrum keeps at PROG. */
  Tape.prototype.encodeProgram = function (src) {
    var out = [], lines = src.split('\n');
    for (var i = 0; i < lines.length; i++) {
      var m = lines[i].match(/^\s*(\d+)\s?(.*)$/);
      if (!m) continue;
      var n = parseInt(m[1], 10);
      var body = tokeniseLine(m[2]);
      body.push(13);
      out.push((n >> 8) & 255, n & 255);          // line number is big-endian
      out.push(body.length & 255, (body.length >> 8) & 255);
      for (var j = 0; j < body.length; j++) out.push(body[j]);
    }
    return new Uint8Array(out);
  };

  Tape.prototype.download = function (filename, bytes) {
    var blob = new Blob([bytes], { type: 'application/octet-stream' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 500);
  };

  /* ---- import ------------------------------------------------------------ */
  Tape.prototype.insert = function (filename, bytes) {
    var ext = (filename.split('.').pop() || '').toLowerCase();
    this.file = bytes;
    this.fileName = filename;
    this.fileKind = ext === 'tzx' ? 'tzx' : ext === 'sna' ? 'sna' :
                    ext === 'z80' ? 'z80' : ext === 'rom' || ext === 'bin' ? 'rom' : 'tap';
    this.accounting();

    // A tape whose first block is a BASIC program can come straight into the
    // editor, which is friendlier than booting the Z80 for a ten-line listing.
    var extracted = null;
    if (this.fileKind === 'tap') extracted = this.extractProgramFromTap(bytes);
    return { kind: this.fileKind, program: extracted };
  };

  Tape.prototype.parseTapBlocks = function (bytes) {
    var out = [], p = 0;
    while (p + 2 <= bytes.length) {
      var len = bytes[p] | (bytes[p + 1] << 8);
      p += 2;
      if (len < 2 || p + len > bytes.length) break;
      out.push({ flag: bytes[p], data: bytes.subarray(p + 1, p + len - 1), at: p });
      p += len;
    }
    return out;
  };

  Tape.prototype.extractProgramFromTap = function (bytes) {
    var blocks = this.parseTapBlocks(bytes);
    for (var i = 0; i < blocks.length - 1; i++) {
      var b = blocks[i];
      if (b.flag !== 0x00 || b.data.length < 17 || b.data[0] !== 0) continue;
      var name = '';
      for (var j = 1; j <= 10; j++) name += String.fromCharCode(b.data[j]);
      var varStart = b.data[15] | (b.data[16] << 8);
      var body = blocks[i + 1];
      if (!body || body.flag !== 0xFF) continue;
      var end = Math.min(varStart || body.data.length, body.data.length);
      return { name: name.trim(), src: this.decodeProgram(body.data, end) };
    }
    return null;
  };

  Tape.prototype.decodeProgram = function (data, end) {
    var out = [], p = 0;
    while (p + 4 <= end) {
      var lineNo = (data[p] << 8) | data[p + 1];
      var len = data[p + 2] | (data[p + 3] << 8);
      p += 4;
      if (lineNo > 9999 || len <= 0 || p + len > data.length) break;
      var text = detokenise(data, p, p + len).replace(/\n$/, '');
      out.push(lineNo + ' ' + text);
      p += len;
    }
    return out.join('\n');
  };

})(window.ZX = window.ZX || {});
