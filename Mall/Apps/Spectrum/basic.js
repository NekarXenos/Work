/* ============================================================
   Spectrum · basic.js
   A ZX BASIC interpreter written straight in JavaScript, plus the
   line editor that sits in front of it.

   Programs are held the way the Spectrum holds them: every keyword
   is one byte, 0xA5..0xFF, so LIST, the tokeniser and the keycaps
   all agree. Lines are compiled to a small tree the first time they
   run and the tree is cached until the line is edited, which is
   what makes a wireframe rotator in BASIC watchable.
   ============================================================ */
import { TOKENS, TOKEN_CODE, TOKEN_WORDS, tokenOf, KEYCAPS, CAPS_DIGIT } from './tokens.js';

/* the legend lookup the editor needs, built once from the keycaps */
const CAPS = {};
for (const k of KEYCAPS) if (/^[A-Z0-9]$/.test(k.id)) CAPS[k.id] = k;

/* ------------------------------------------------------------
   Reports, exactly as the ROM words them
   ------------------------------------------------------------ */
export const REPORTS = {
  '0': 'OK', '1': 'NEXT without FOR', '2': 'Variable not found', '3': 'Subscript wrong',
  '4': 'Out of memory', '5': 'Out of screen', '6': 'Number too big', '7': 'RETURN without GOSUB',
  '8': 'End of file', '9': 'STOP statement', 'A': 'Invalid argument', 'B': 'Integer out of range',
  'C': 'Nonsense in BASIC', 'D': 'BREAK - CONT repeats', 'E': 'Out of DATA', 'F': 'Invalid file name',
  'G': 'No room for line', 'H': 'STOP in INPUT', 'I': 'FOR without NEXT', 'J': 'Invalid I/O device',
  'K': 'Invalid colour', 'L': 'BREAK into program', 'M': 'RAMTOP no good', 'N': 'Statement lost',
  'O': 'Invalid stream', 'P': 'FN without DEF', 'Q': 'Parameter error', 'R': 'Tape loading error'
};
export class ZXError extends Error {
  constructor(code) { super(REPORTS[code] || 'Nonsense in BASIC'); this.zxReport = code; }
}
const err = c => { throw new ZXError(c); };

/* ------------------------------------------------------------
   Numbers the way the Spectrum prints them — eight significant
   figures, and an exponent once it runs out of room.
   ------------------------------------------------------------ */
export function zxNum(n) {
  if (!isFinite(n)) err('6');
  if (n === 0) return '0';
  if (Number.isInteger(n) && Math.abs(n) < 1e10) return String(n);
  const a = Math.abs(n);
  if (a >= 1e-5 && a < 1e13) {
    let s = n.toPrecision(9);
    if (s.includes('e')) s = Number(s).toString();
    if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
    /* keep it to eight significant figures like the ROM */
    const digits = s.replace(/[-.]/g, '').replace(/^0+/, '').length;
    if (digits > 8) {
      s = Number(n.toPrecision(8)).toString();
      if (s.includes('e')) return expForm(n);
    }
    return s;
  }
  return expForm(n);
}
function expForm(n) {
  let s = n.toExponential(7);
  let [m, e] = s.split('e');
  if (m.includes('.')) m = m.replace(/0+$/, '').replace(/\.$/, '');
  const ex = +e;
  return m + 'E' + (ex < 0 ? '-' : '+') + Math.abs(ex);
}

/* ------------------------------------------------------------
   Tokenising — the two ways text becomes a program line
   ------------------------------------------------------------ */
/* Natural typing: keywords are spotted in what was typed, but never
   inside a string literal or after REM. */
export function naturalTokenise(text) {
  let out = '', i = 0;
  const up = text.toUpperCase();
  let atStart = true;                     // start of a statement
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {                     // strings pass through untouched
      out += ch; i++;
      while (i < text.length) { out += text[i]; if (text[i] === '"' && text[i + 1] !== '"') { i++; break; } i++; }
      atStart = false; continue;
    }
    if (/[A-Za-z]/.test(ch)) {
      let best = '', code = 0;
      for (const w of TOKEN_WORDS) {
        if (up.startsWith(w, i)) {
          /* a keyword has to end on a non-letter, or it is part of a name */
          const after = up[i + w.length];
          if (after && /[A-Z0-9$]/.test(after) && /[A-Z]$/.test(w)) continue;
          best = w; code = tokenOf(w); break;
        }
      }
      if (best && code) {
        out += String.fromCharCode(code);
        i += best.length;
        if (code === 0xea) {              // REM swallows the rest of the line
          if (text[i] === ' ') i++;
          out += text.slice(i); return out;
        }
        atStart = (code === 0xcb);        // THEN opens a fresh statement
        /* one space after a keyword is swallowed, as on the real thing */
        if (text[i] === ' ') i++;
        continue;
      }
      /* not a keyword: copy the whole identifier over untouched */
      while (i < text.length && /[A-Za-z0-9$]/.test(text[i])) out += text[i++];
      atStart = false; continue;
    }
    if (ch === ':') atStart = true;
    out += ch; i++;
  }
  return out;
}

/* Turn a stored line back into something readable */
export function listText(txt) {
  let s = '';
  for (let i = 0; i < txt.length; i++) {
    const c = txt.charCodeAt(i);
    const kw = TOKENS[c];
    if (kw) {
      if (s.length && !/[ (]$/.test(s) && /^[A-Z]/.test(kw)) s += ' ';
      s += kw;
      if (/[A-Z$#]$/.test(kw)) s += ' ';
    } else s += txt[i];
  }
  return s.replace(/\s+$/, '');
}

/* ------------------------------------------------------------
   Lexer — a stored line, one symbol at a time
   ------------------------------------------------------------ */
const T_END = 0, T_NUM = 1, T_STR = 2, T_NAME = 3, T_TOKEN = 4, T_PUNCT = 5;

function lex(txt) {
  const out = [];
  let i = 0;
  while (i < txt.length) {
    const ch = txt[i], c = txt.charCodeAt(i);
    if (ch === ' ') { i++; continue; }
    if (c >= 0xa5) { out.push({ t: T_TOKEN, v: c, s: TOKENS[c] }); i++; continue; }
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(txt[i + 1] || ''))) {
      let j = i;
      while (j < txt.length && /[0-9]/.test(txt[j])) j++;
      if (txt[j] === '.') { j++; while (j < txt.length && /[0-9]/.test(txt[j])) j++; }
      if (txt[j] === 'e' || txt[j] === 'E') {
        let k = j + 1;
        if (txt[k] === '+' || txt[k] === '-') k++;
        if (/[0-9]/.test(txt[k] || '')) { k++; while (k < txt.length && /[0-9]/.test(txt[k])) k++; j = k; }
      }
      out.push({ t: T_NUM, v: parseFloat(txt.slice(i, j)) }); i = j; continue;
    }
    if (/[A-Za-z]/.test(ch)) {
      let j = i;
      while (j < txt.length && /[A-Za-z0-9]/.test(txt[j])) j++;
      let name = txt.slice(i, j);
      if (txt[j] === '$') { name += '$'; j++; }
      out.push({ t: T_NAME, v: name.toLowerCase(), str: name.endsWith('$') }); i = j; continue;
    }
    if (ch === '"') {
      let j = i + 1, s = '';
      while (j < txt.length) {
        if (txt[j] === '"') { if (txt[j + 1] === '"') { s += '"'; j += 2; continue; } j++; break; }
        s += txt[j++];
      }
      out.push({ t: T_STR, v: s }); i = j; continue;
    }
    out.push({ t: T_PUNCT, v: ch }); i++;
  }
  out.push({ t: T_END, v: '' });
  return out;
}

/* ------------------------------------------------------------
   Parser
   ------------------------------------------------------------ */
const PRI = {
  0xc5: 2,    // OR
  0xc6: 3,    // AND
  '=': 5, '>': 5, '<': 5, 0xc7: 5, 0xc8: 5, 0xc9: 5,
  '+': 6, '-': 6,
  '*': 8, '/': 8,
  '^': 10
};
/* one-argument keyword functions */
const FN1 = {
  0xb2: 'SIN', 0xb3: 'COS', 0xb4: 'TAN', 0xb5: 'ASN', 0xb6: 'ACS', 0xb7: 'ATN',
  0xb8: 'LN', 0xb9: 'EXP', 0xba: 'INT', 0xbb: 'SQR', 0xbc: 'SGN', 0xbd: 'ABS',
  0xbe: 'PEEK', 0xbf: 'IN', 0xc0: 'USR', 0xc1: 'STR$', 0xc2: 'CHR$', 0xaf: 'CODE',
  0xb0: 'VAL', 0xae: 'VAL$', 0xb1: 'LEN', 0xc4: 'BIN', 0xa5: 'RND1'
};

class Parser {
  constructor(txt) { this.tk = lex(txt); this.p = 0; }
  peek(k = 0) { return this.tk[this.p + k]; }
  next() { return this.tk[this.p++]; }
  at(v) { const t = this.peek(); return (t.t === T_PUNCT && t.v === v) || (t.t === T_TOKEN && t.v === v); }
  eat(v) { if (this.at(v)) { this.p++; return true; } return false; }
  need(v) { if (!this.eat(v)) err('C'); }
  done() { return this.peek().t === T_END; }

  parseLine() {
    const stmts = [];
    for (; ;) {
      while (this.eat(':')) { }
      if (this.done()) break;
      stmts.push(this.statement());
      if (this.done()) break;
      if (!this.eat(':')) {
        /* THEN-carried statements end at the end of the line */
        err('C');
      }
    }
    return stmts;
  }

  statement() {
    const t = this.peek();
    if (t.t === T_TOKEN) {
      this.p++;
      switch (t.v) {
        case 0xf1: return this.stLet();
        case 0xf5: case 0xe0: return { op: 'PRINT', items: this.printItems(), lp: t.v === 0xe0 };
        case 0xee: return this.stInput();
        case 0xfa: return this.stIf();
        case 0xeb: return this.stFor();
        case 0xf3: return { op: 'NEXT', name: this.varName() };
        case 0xec: return { op: 'GOTO', e: this.expr() };
        case 0xed: return { op: 'GOSUB', e: this.expr() };
        case 0xfe: return { op: 'RETURN' };
        case 0xe2: return { op: 'STOP' };
        case 0xe8: return { op: 'CONTINUE' };
        case 0xfb: return { op: 'CLS' };
        case 0xe9: return this.stDim();
        case 0xe3: return { op: 'READ', targets: this.targetList() };
        case 0xe4: return { op: 'DATA', items: this.exprList() };
        case 0xe5: return { op: 'RESTORE', e: this.done() || this.at(':') ? null : this.expr() };
        case 0xce: return this.stDefFn();
        case 0xf9: return { op: 'RANDOMIZE', e: this.endish() ? null : this.expr() };
        /* REM takes the rest of the line with it, colons and all */
        case 0xea: this.p = this.tk.length - 1; return { op: 'REM' };
        case 0xf6: return this.stPlot();
        case 0xfc: return this.stDraw();
        case 0xd8: return this.stCircle();
        case 0xd9: return { op: 'ATTRSET', k: 'ink', e: this.expr() };
        case 0xda: return { op: 'ATTRSET', k: 'paper', e: this.expr() };
        case 0xdb: return { op: 'ATTRSET', k: 'flash', e: this.expr() };
        case 0xdc: return { op: 'ATTRSET', k: 'bright', e: this.expr() };
        case 0xdd: return { op: 'ATTRSET', k: 'inverse', e: this.expr() };
        case 0xde: return { op: 'ATTRSET', k: 'over', e: this.expr() };
        case 0xe7: return { op: 'BORDER', e: this.expr() };
        case 0xd7: return { op: 'BEEP', d: this.expr(), p: (this.need(','), this.expr()) };
        case 0xf2: return { op: 'PAUSE', e: this.expr() };
        case 0xf4: return { op: 'POKE', a: this.expr(), v: (this.need(','), this.expr()) };
        case 0xdf: return { op: 'OUT', a: this.expr(), v: (this.need(','), this.expr()) };
        case 0xe6: return { op: 'NEW' };
        case 0xf7: return { op: 'RUN', e: this.endish() ? null : this.expr() };
        case 0xf0: case 0xe1: return { op: 'LIST', e: this.endish() ? null : this.expr() };
        case 0xfd: return { op: 'CLEAR', e: this.endish() ? null : this.expr() };
        case 0xf8: return { op: 'SAVE', e: this.expr() };
        case 0xef: return { op: 'LOAD', e: this.endish() ? null : this.expr() };
        case 0xd5: return { op: 'MERGE', e: this.expr() };
        case 0xd6: return { op: 'VERIFY', e: this.endish() ? null : this.expr() };
        case 0xff: return { op: 'COPY' };
        case 0xcf: case 0xd0: case 0xd1: case 0xd2: err('J'); break;
        default: err('C');
      }
    }
    /* a bare assignment is allowed, the way LET-less BASICs do it */
    if (t.t === T_NAME) return this.stLet(true);
    err('C');
  }
  endish() { return this.done() || this.at(':'); }

  varName() {
    const t = this.next();
    if (t.t !== T_NAME) err('C');
    return t.v;
  }
  /* something that can be assigned to */
  target() {
    const t = this.next();
    if (t.t !== T_NAME) err('C');
    const name = t.v, isStr = t.str;
    if (!this.at('(')) return { k: isStr ? 'str' : 'num', name };
    this.p++;
    if (isStr) {
      /* a$(2 TO 4) = "xy" overwrites part of a string; a$(2) = "x" is the
         same thing one character wide; a$(2) on a DIMmed array is an element,
         and which of the two it is only shows up at run time */
      const first = this.sliceArgs();
      if (!first.single) { this.need(')'); return { k: 'sslice', name, from: first.from, to: first.to }; }
      const subs = [first.from];
      while (this.eat(',')) subs.push(this.expr());
      this.need(')');
      return { k: 'sarr', name, subs };
    }
    const subs = [this.expr()];
    while (this.eat(',')) subs.push(this.expr());
    this.need(')');
    return { k: 'narr', name, subs };
  }
  targetList() { const a = [this.target()]; while (this.eat(',')) a.push(this.target()); return a; }

  stLet(bare) {
    const tgt = this.target();
    this.need('=');
    return { op: 'LET', target: tgt, e: this.expr(), bare: !!bare };
  }
  stIf() {
    const cond = this.expr();
    if (!this.eat(0xcb)) err('C');
    /* THEN 10 is shorthand for THEN GO TO 10 */
    if (this.peek().t === T_NUM && (this.tk[this.p + 1].t === T_END || (this.tk[this.p + 1].t === T_PUNCT && this.tk[this.p + 1].v === ':'))) {
      const n = this.next().v;
      return { op: 'IF', cond, then: [{ op: 'GOTO', e: { t: 'num', v: n } }] };
    }
    const then = [];
    for (; ;) {
      while (this.eat(':')) { }
      if (this.done()) break;
      then.push(this.statement());
      if (this.done()) break;
      if (!this.eat(':')) break;
    }
    return { op: 'IF', cond, then };
  }
  stFor() {
    const name = this.varName();
    this.need('=');
    const from = this.expr();
    if (!this.eat(0xcc)) err('C');
    const to = this.expr();
    const step = this.eat(0xcd) ? this.expr() : { t: 'num', v: 1 };
    return { op: 'FOR', name, from, to, step };
  }
  stDim() {
    const t = this.next();
    if (t.t !== T_NAME) err('C');
    this.need('(');
    const dims = [this.expr()];
    while (this.eat(',')) dims.push(this.expr());
    this.need(')');
    return { op: 'DIM', name: t.v, str: t.str, dims };
  }
  stDefFn() {
    const t = this.next();
    if (t.t !== T_NAME) err('C');
    this.need('(');
    const args = [];
    if (!this.at(')')) {
      for (; ;) { const a = this.next(); if (a.t !== T_NAME) err('C'); args.push({ name: a.v, str: a.str }); if (!this.eat(',')) break; }
    }
    this.need(')');
    this.need('=');
    return { op: 'DEFFN', name: t.v, str: t.str, args, body: this.expr() };
  }
  stPlot() {
    const c = this.colourItems();
    const x = this.expr(); this.need(','); const y = this.expr();
    return { op: 'PLOT', c, x, y };
  }
  stDraw() {
    const c = this.colourItems();
    const x = this.expr(); this.need(','); const y = this.expr();
    const a = this.eat(',') ? this.expr() : null;
    return { op: 'DRAW', c, x, y, a };
  }
  stCircle() {
    const c = this.colourItems();
    const x = this.expr(); this.need(','); const y = this.expr(); this.need(','); const r = this.expr();
    return { op: 'CIRCLE', c, x, y, r };
  }
  /* INK 2; PAPER 6; in front of a PLOT or a PRINT item */
  colourItems() {
    const out = [];
    for (; ;) {
      const t = this.peek();
      if (t.t !== T_TOKEN) break;
      const k = { 0xd9: 'ink', 0xda: 'paper', 0xdb: 'flash', 0xdc: 'bright', 0xdd: 'inverse', 0xde: 'over' }[t.v];
      if (!k) break;
      this.p++;
      out.push({ k, e: this.expr() });
      if (!this.eat(';') && !this.eat(',')) break;
    }
    return out;
  }
  printItems() {
    const items = [];
    for (; ;) {
      if (this.endish()) break;
      const t = this.peek();
      if (t.t === T_PUNCT && (t.v === ';' || t.v === ',' || t.v === "'")) { this.p++; items.push({ k: 'sep', v: t.v }); continue; }
      if (t.t === T_TOKEN && t.v === 0xac) { this.p++; const a = this.expr(); this.need(','); const b = this.expr(); items.push({ k: 'at', a, b }); continue; }
      if (t.t === T_TOKEN && t.v === 0xad) { this.p++; items.push({ k: 'tab', e: this.expr() }); continue; }
      const col = { 0xd9: 'ink', 0xda: 'paper', 0xdb: 'flash', 0xdc: 'bright', 0xdd: 'inverse', 0xde: 'over' }[t.v];
      if (t.t === T_TOKEN && col) { this.p++; items.push({ k: 'col', c: col, e: this.expr() }); continue; }
      items.push({ k: 'e', e: this.expr() });
    }
    return items;
  }
  stInput() {
    const items = [];
    for (; ;) {
      if (this.endish()) break;
      const t = this.peek();
      if (t.t === T_PUNCT && (t.v === ';' || t.v === ',' || t.v === "'")) { this.p++; items.push({ k: 'sep', v: t.v }); continue; }
      if (t.t === T_STR) { this.p++; items.push({ k: 'prompt', e: { t: 'str', v: t.v } }); continue; }
      if (t.t === T_TOKEN && t.v === 0xac) { this.p++; const a = this.expr(); this.need(','); const b = this.expr(); items.push({ k: 'at', a, b }); continue; }
      if (t.t === T_TOKEN && t.v === 0xca) { this.p++; items.push({ k: 'var', line: true, target: this.target() }); continue; }
      if (t.t === T_PUNCT && t.v === '(') { this.p++; const e = this.expr(); this.need(')'); items.push({ k: 'prompt', e }); continue; }
      if (t.t === T_NAME) { items.push({ k: 'var', target: this.target() }); continue; }
      err('C');
    }
    return { op: 'INPUT', items };
  }
  exprList() { const a = [this.expr()]; while (this.eat(',')) a.push(this.expr()); return a; }

  /* --- expressions --- */
  expr(min = 0) {
    let left = this.unary();
    for (; ;) {
      const t = this.peek();
      let op = null;
      if (t.t === T_PUNCT && PRI[t.v] !== undefined) op = t.v;
      else if (t.t === T_TOKEN && PRI[t.v] !== undefined) op = t.v;
      if (op === null) break;
      const pri = PRI[op];
      if (pri <= min) break;
      this.p++;
      const right = this.expr(pri);
      left = { t: 'bin', op, a: left, b: right };
    }
    return left;
  }
  unary() {
    const t = this.peek();
    if (t.t === T_PUNCT && t.v === '-') { this.p++; return { t: 'neg', a: this.expr(9) }; }
    if (t.t === T_PUNCT && t.v === '+') { this.p++; return this.unary(); }
    if (t.t === T_TOKEN && t.v === 0xc3) { this.p++; return { t: 'not', a: this.expr(4) }; }
    return this.postfix(this.atom());
  }
  /* string slicing sticks to whatever produced a string */
  postfix(node) {
    for (; ;) {
      if (this.at('(') && (node.t === 'str' || node.t === 'svar' || node.t === 'sarr' || node.t === 'slice' || node.t === 'sfn' || node.t === 'group')) {
        this.p++;
        const sl = this.sliceArgs();
        this.need(')');
        node = { t: 'slice', a: node, from: sl.from, to: sl.to };
        continue;
      }
      break;
    }
    return node;
  }
  sliceArgs() {
    let from = null, to = null, isSlice = false;
    if (this.at(0xcc)) { this.p++; isSlice = true; to = this.at(')') ? null : this.expr(); }
    else {
      from = this.expr();
      if (this.eat(0xcc)) { isSlice = true; to = this.at(')') ? null : this.expr(); }
    }
    return { from, to, single: !isSlice };
  }
  atom() {
    const t = this.next();
    if (t.t === T_NUM) return { t: 'num', v: t.v };
    if (t.t === T_STR) return { t: 'str', v: t.v };
    if (t.t === T_PUNCT && t.v === '(') { const e = this.expr(); this.need(')'); return { t: 'group', a: e, str: false }; }
    if (t.t === T_NAME) {
      if (this.at('(')) {
        this.p++;
        const subs = [];
        if (!this.at(')')) {
          /* a$(2 TO 5) on a plain string variable is a slice, not a subscript;
             which it is only becomes clear at run time */
          const first = this.sliceArgs();
          if (!first.single) {
            this.need(')');
            return { t: 'slice', a: { t: t.str ? 'svar' : 'nvar', name: t.v }, from: first.from, to: first.to };
          }
          subs.push(first.from);
          while (this.eat(',')) subs.push(this.expr());
        }
        this.need(')');
        const node = { t: t.str ? 'sarr' : 'narr', name: t.v, subs };
        return node;
      }
      return { t: t.str ? 'svar' : 'nvar', name: t.v };
    }
    if (t.t === T_TOKEN) {
      const v = t.v;
      if (v === 0xa5) return { t: 'rnd' };
      if (v === 0xa7) return { t: 'num', v: Math.PI };
      if (v === 0xa6) return { t: 'inkey' };
      if (v === 0xa8) {            // FN name(args)
        const n = this.next();
        if (n.t !== T_NAME) err('C');
        let args = [];
        if (this.eat('(')) {
          if (!this.at(')')) { args.push(this.expr()); while (this.eat(',')) args.push(this.expr()); }
          this.need(')');
        }
        return { t: 'fn', name: n.v, str: n.str, args };
      }
      if (v === 0xa9) { this.need('('); const a = this.expr(); this.need(','); const b = this.expr(); this.need(')'); return { t: 'point', a, b }; }
      if (v === 0xab) { this.need('('); const a = this.expr(); this.need(','); const b = this.expr(); this.need(')'); return { t: 'attr', a, b }; }
      if (v === 0xaa) { this.need('('); const a = this.expr(); this.need(','); const b = this.expr(); this.need(')'); return { t: 'screen', a, b }; }
      if (FN1[v]) return { t: 'call', f: FN1[v], a: this.unary(), code: v };
      if (v === 0xc3) return { t: 'not', a: this.expr(4) };
    }
    err('C');
  }
}

/* ------------------------------------------------------------
   The interpreter
   ------------------------------------------------------------ */
export class Basic {
  constructor(screen, opts = {}) {
    this.scr = screen;
    this.mem = screen.mem;
    this.sound = opts.sound || null;
    this.ramLimit = opts.ramLimit || 41000;
    this.machineName = opts.machineName || '48K';
    this.stepBudget = opts.stepBudget || 4000;
    this.usrHook = null;               // wired up when a Z80 core shares this memory
    this.onSave = opts.onSave || null;
    this.onLoad = opts.onLoad || null;
    this.storage = opts.storage || null;
    this.prog = [];                    // { n, txt, ast }
    this.reset(true);
    this.editReset();
  }

  /* --- state ------------------------------------------------- */
  reset(hard) {
    this.num = new Map(); this.str = new Map();
    this.narr = new Map(); this.sarr = new Map();
    this.fns = new Map();
    this.forStack = []; this.gosubStack = [];
    this.dataList = null; this.dataPtr = 0;
    this.state = 'idle';
    this.pc = { li: 0, si: 0 };
    this.direct = null;
    this.contLine = 0; this.contStmt = 0;
    this.pendingInput = null;
    this.pauseFrames = 0;
    this.seed = 0;
    this.inkey = '';
    this.lastReport = null;
    this.capsLock = false;
    if (hard) { this.prog = []; this.editCursorLine = 0; }
  }
  clearVars() {
    this.num.clear(); this.str.clear(); this.narr.clear(); this.sarr.clear(); this.fns.clear();
    this.forStack.length = 0; this.gosubStack.length = 0;
    this.dataList = null; this.dataPtr = 0;
  }
  bytesUsed() {
    let b = 0;
    for (const l of this.prog) b += l.txt.length + 5;
    b += this.num.size * 6 + this.sarr.size * 8;
    for (const [, v] of this.str) b += v.length + 3;
    for (const [, a] of this.narr) b += a.data.length * 5 + 6;
    for (const [, a] of this.sarr) b += a.data.length * a.slen + 6;
    return b;
  }
  free() { return Math.max(0, this.ramLimit - this.bytesUsed()); }

  /* --- program store ----------------------------------------- */
  lineIndex(n) {
    let lo = 0, hi = this.prog.length - 1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (this.prog[m].n === n) return m; if (this.prog[m].n < n) lo = m + 1; else hi = m - 1; }
    return -1;
  }
  lineAtOrAfter(n) {
    let lo = 0, hi = this.prog.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (this.prog[m].n < n) lo = m + 1; else hi = m; }
    return lo;
  }
  storeLine(n, txt) {
    const i = this.lineIndex(n);
    if (!txt.length) { if (i >= 0) this.prog.splice(i, 1); return; }
    if (this.bytesUsed() + txt.length + 5 > this.ramLimit && i < 0) err('4');
    const line = { n, txt, ast: null };
    if (i >= 0) this.prog[i] = line;
    else this.prog.splice(this.lineAtOrAfter(n), 0, line);
    this.dataList = null;
  }
  astFor(line) {
    if (!line.ast) {
      const p = new Parser(line.txt);
      line.ast = p.parseLine();
    }
    return line.ast;
  }
  lineObj(li) { return li < 0 ? this.direct : this.prog[li]; }

  /* --- running ----------------------------------------------- */
  runProgram(from) {
    this.clearVars();
    const i = from == null ? 0 : this.lineAtOrAfter(from);
    if (i >= this.prog.length) { this.finish('0'); return; }
    this.pc = { li: i, si: 0 };
    this.state = 'run';
  }
  execDirect(txt) {
    let stmts;
    try { stmts = new Parser(txt).parseLine(); }
    catch (e) { this.report(e.zxReport || 'C', 0, 1); return; }
    this.direct = { n: 0, txt, ast: stmts };
    this.pc = { li: -1, si: 0 };
    this.state = 'run';
  }
  finish(code) {
    const li = this.pc.li, si = this.pc.si;
    this.state = 'idle';
    /* running off the end of a line reports the statement that finished,
       not the one after it, so a direct command reads "0 OK, 0:1" */
    this.report(code, li < 0 || !this.prog[li] ? 0 : this.prog[li].n, Math.max(1, si));
    this.editReset();
  }
  report(code, line, stmt) {
    this.lastReport = code;
    const s = this.scr;
    s.lower = true;
    s.lowerSize = Math.max(2, s.lowerSize);
    s.clearLower();
    const saveInk = s.ink, savePaper = s.paper, saveFlash = s.flash, saveBright = s.bright;
    s.ink = 0; s.paper = 7; s.flash = 0; s.bright = 0;
    s.printString(code + ' ' + (REPORTS[code] || '') + ', ' + (line || 0) + ':' + (stmt || 1));
    s.ink = saveInk; s.paper = savePaper; s.flash = saveFlash; s.bright = saveBright;
    s.lower = false;
    this.needPrompt = true;
  }
  breakIn() {
    if (this.state === 'run' || this.state === 'pause' || this.state === 'input') {
      this.contLine = this.pc.li < 0 ? 0 : (this.prog[this.pc.li] ? this.prog[this.pc.li].n : 0);
      this.contStmt = this.pc.si + 1;
      this.state = 'idle';
      this.report('L', this.contLine, this.contStmt);
      this.editReset();
      return true;
    }
    return false;
  }

  /* one video frame's worth of interpreting */
  frame(budget) {
    if (this.state === 'pause') {
      if (this.pauseFrames > 0) { this.pauseFrames--; if (this.pauseFrames === 0) { this.state = 'run'; this.pc.si++; } }
      else if (this.inkey) { this.state = 'run'; this.pc.si++; }
      return;
    }
    if (this.state !== 'run') return;
    let n = budget || this.stepBudget;
    try {
      while (n-- > 0 && this.state === 'run') {
        const line = this.lineObj(this.pc.li);
        if (!line) { this.finish('0'); return; }
        const ast = line.ast || this.astFor(line);
        if (this.pc.si >= ast.length) {
          if (this.pc.li < 0) { this.finish('0'); return; }
          this.pc.li++; this.pc.si = 0; continue;
        }
        const st = ast[this.pc.si];
        this.jumped = false;
        this.exec(st);
        if (!this.jumped && this.state === 'run') this.pc.si++;
      }
    } catch (e) {
      if (e && e.zxReport) {
        const li = this.pc.li;
        this.state = 'idle';
        this.contLine = li < 0 ? 0 : (this.prog[li] ? this.prog[li].n : 0);
        this.contStmt = this.pc.si + 1;
        this.report(e.zxReport, this.contLine, this.pc.si + 1);
        this.editReset();
      } else throw e;
    }
  }

  jumpTo(n) {
    const i = this.lineAtOrAfter(n);
    if (i >= this.prog.length) { this.state = 'idle'; this.report('0', n, 1); this.editReset(); this.jumped = true; return; }
    this.pc = { li: i, si: 0 };
    this.jumped = true;
  }

  /* --- statement execution ----------------------------------- */
  exec(st) {
    const s = this.scr;
    switch (st.op) {
      case 'REM': case 'DATA': return;
      case 'LET': return this.assign(st.target, st.e);
      case 'PRINT': return this.doPrint(st.items);
      case 'CLS': s.cls(); return;
      case 'GOTO': return this.jumpTo(this.int(this.evalNum(st.e)));
      case 'GOSUB':
        this.gosubStack.push({ li: this.pc.li, si: this.pc.si + 1 });
        if (this.gosubStack.length > 300) err('4');
        return this.jumpTo(this.int(this.evalNum(st.e)));
      case 'RETURN': {
        const f = this.gosubStack.pop();
        if (!f) err('7');
        this.pc = { li: f.li, si: f.si }; this.jumped = true; return;
      }
      case 'STOP': {
        this.contLine = this.pc.li < 0 ? 0 : this.prog[this.pc.li].n;
        this.contStmt = this.pc.si + 1;
        this.state = 'idle'; this.report('9', this.contLine, this.pc.si + 1); this.editReset(); return;
      }
      case 'CONTINUE':
        if (!this.contLine) { this.state = 'idle'; return; }
        return this.jumpTo(this.contLine);
      case 'IF':
        if (this.evalNum(st.cond) !== 0) {
          for (let i = 0; i < st.then.length; i++) {
            this.exec(st.then[i]);
            if (this.jumped || this.state !== 'run') return;
          }
        }
        return;
      case 'FOR': return this.doFor(st);
      case 'NEXT': return this.doNext(st);
      case 'DIM': return this.doDim(st);
      case 'READ': return this.doRead(st);
      case 'RESTORE': {
        this.buildData();
        const n = st.e ? this.int(this.evalNum(st.e)) : 0;
        this.dataPtr = 0;
        while (this.dataPtr < this.dataList.length && this.dataList[this.dataPtr].line < n) this.dataPtr++;
        return;
      }
      case 'DEFFN': this.fns.set(st.name, st); return;
      case 'RANDOMIZE': {
        const v = st.e ? this.int(this.evalNum(st.e)) : 0;
        this.seed = v === 0 ? (Date.now() & 0xffff) : (v & 0xffff);
        return;
      }
      case 'ATTRSET': {
        const v = this.int(this.evalNum(st.e));
        this.setAttr(st.k, v); return;
      }
      case 'BORDER': {
        const v = this.int(this.evalNum(st.e));
        if (v < 0 || v > 15) err('K');
        s.border = v; return;
      }
      case 'PLOT': return this.withColours(st.c, () => { s.plot(this.evalNum(st.x), this.evalNum(st.y)); });
      case 'DRAW': return this.withColours(st.c, () => {
        const x = this.evalNum(st.x), y = this.evalNum(st.y);
        if (st.a) s.drawArc(x, y, this.evalNum(st.a)); else s.drawTo(s.plotX + x, s.plotY + y);
      });
      case 'CIRCLE': return this.withColours(st.c, () => { s.circle(this.evalNum(st.x), this.evalNum(st.y), this.evalNum(st.r)); });
      case 'POKE': {
        const a = this.int(this.evalNum(st.a)) & 0xffff, v = this.int(this.evalNum(st.v));
        if (v < -255 || v > 255) err('B');
        this.mem[a] = v & 255;
        this.scr.syncFromMem(a);
        return;
      }
      case 'OUT': {
        const p = this.int(this.evalNum(st.a)) & 0xffff, v = this.int(this.evalNum(st.v)) & 255;
        if ((p & 1) === 0) s.border = v & 7;
        return;
      }
      case 'PAUSE': {
        const n = this.int(this.evalNum(st.e));
        if (n < 0 || n > 65535) err('B');
        this.pauseFrames = n; this.state = 'pause'; this.inkey = ''; return;
      }
      case 'BEEP': {
        const d = this.evalNum(st.d), p = this.evalNum(st.p);
        if (this.sound) this.sound.beep(d, p);
        this.pauseFrames = Math.max(1, Math.round(d * 50)); this.state = 'pause'; return;
      }
      case 'INPUT': return this.doInput(st);
      case 'NEW': this.reset(true); this.scr.reset(); this.state = 'idle'; this.needPrompt = true; this.editReset(); this.jumped = true; return;
      case 'RUN': {
        const from = st.e ? this.int(this.evalNum(st.e)) : null;
        this.runProgram(from); this.jumped = true; return;
      }
      case 'LIST': return this.doList(st);
      case 'CLEAR': {
        this.clearVars();
        if (st.e) { const v = this.int(this.evalNum(st.e)); if (v && (v < 1024 || v > 65535)) err('M'); }
        return;
      }
      case 'SAVE': return this.doSave(st);
      case 'LOAD': case 'MERGE': return this.doLoad(st);
      case 'VERIFY': return;
      case 'COPY': return;
      default: err('C');
    }
  }
  setAttr(k, v) {
    const s = this.scr;
    /* sixteen colours to a pixel, as on the 3D machine: 8..15 are BRIGHT */
    if (k === 'ink' || k === 'paper') { if (v < 0 || v > 15) err('K'); s[k] = v; return; }
    if (v < 0 || v > 1) err('K');
    s[k] = v;
  }
  withColours(list, fn) {
    if (!list || !list.length) return fn();
    const s = this.scr;
    const save = { ink: s.ink, paper: s.paper, flash: s.flash, bright: s.bright, inverse: s.inverse, over: s.over };
    for (const c of list) this.setAttr(c.k, this.int(this.evalNum(c.e)));
    try { fn(); } finally { Object.assign(s, save); }
  }
  doPrint(items) {
    const s = this.scr;
    let trailing = false;
    for (const it of items) {
      trailing = false;
      if (it.k === 'sep') {
        trailing = true;
        if (it.v === ',') { const c = s.lower ? s.lcol : s.col; s.tab(c < 16 ? 16 : 0); }
        else if (it.v === "'") s.newline();
        continue;
      }
      if (it.k === 'at') {
        const r = this.int(this.evalNum(it.a)), c = this.int(this.evalNum(it.b));
        if (r < 0 || r > 21 || c < 0 || c > 31) err('B');
        s.setCursor(c, r); continue;
      }
      if (it.k === 'tab') { s.tab(this.int(this.evalNum(it.e))); continue; }
      if (it.k === 'col') { this.setAttr(it.c, this.int(this.evalNum(it.e))); continue; }
      const v = this.evalAny(it.e);
      s.printString(typeof v === 'string' ? v : zxNum(v));
    }
    if (!trailing) s.newline();
  }
  doFor(st) {
    const from = this.evalNum(st.from), to = this.evalNum(st.to), step = this.evalNum(st.step);
    this.num.set(st.name, from);
    const here = { li: this.pc.li, si: this.pc.si + 1 };
    const i = this.forStack.findIndex(f => f.name === st.name);
    if (i >= 0) this.forStack.splice(i, 1);
    const loop = { name: st.name, to, step, li: here.li, si: here.si };
    this.forStack.push(loop);
    if ((step >= 0 && from > to) || (step < 0 && from < to)) {
      /* the body never runs: walk on to the matching NEXT */
      this.skipToNext(st.name);
    }
  }
  skipToNext(name) {
    let li = this.pc.li, si = this.pc.si + 1;
    let depth = 0;
    for (; ;) {
      const line = this.lineObj(li);
      if (!line) { err('I'); }
      const ast = line.ast || this.astFor(line);
      while (si < ast.length) {
        const st = ast[si];
        const flat = st.op === 'IF' ? st.then : [st];
        for (const q of flat) {
          if (q.op === 'FOR' && q.name === name) depth++;
          else if (q.op === 'NEXT' && q.name === name) {
            if (depth === 0) {
              this.forStack.pop();
              this.pc = { li, si: si + 1 }; this.jumped = true; return;
            }
            depth--;
          }
        }
        si++;
      }
      if (li < 0) err('I');
      li++; si = 0;
      if (li >= this.prog.length) err('I');
    }
  }
  doNext(st) {
    const f = this.forStack[this.forStack.length - 1];
    let loop = f && f.name === st.name ? f : null;
    if (!loop) {
      const i = this.forStack.map(x => x.name).lastIndexOf(st.name);
      if (i < 0) err('1');
      this.forStack.length = i + 1;
      loop = this.forStack[i];
    }
    const v = (this.num.get(loop.name) || 0) + loop.step;
    this.num.set(loop.name, v);
    if ((loop.step >= 0 && v > loop.to) || (loop.step < 0 && v < loop.to)) {
      this.forStack.pop();
      return;
    }
    this.pc = { li: loop.li, si: loop.si };
    this.jumped = true;
  }
  doDim(st) {
    const dims = st.dims.map(d => this.int(this.evalNum(d)));
    for (const d of dims) if (d < 1 || d > 65535) err('3');
    let count = 1;
    for (const d of dims) count *= d;
    if (st.str) {
      const slen = dims.length > 1 ? dims[dims.length - 1] : dims[0];
      const shape = dims.length > 1 ? dims.slice(0, -1) : [1];
      let n = 1; for (const d of shape) n *= d;
      if (n * slen + 20 > this.free()) err('4');
      this.sarr.set(st.name, { dims: shape, slen, data: new Array(n).fill(' '.repeat(slen)) });
    } else {
      if (count * 5 + 20 > this.free()) err('4');
      this.narr.set(st.name, { dims, data: new Float64Array(count) });
    }
  }
  buildData() {
    if (this.dataList) return;
    this.dataList = [];
    for (const line of this.prog) {
      const ast = line.ast || this.astFor(line);
      for (const st of ast) {
        const flat = st.op === 'IF' ? st.then : [st];
        for (const q of flat) if (q.op === 'DATA') for (const e of q.items) this.dataList.push({ line: line.n, e });
      }
    }
  }
  doRead(st) {
    this.buildData();
    for (const t of st.targets) {
      if (this.dataPtr >= this.dataList.length) err('E');
      const item = this.dataList[this.dataPtr++];
      this.assignValue(t, this.evalAny(item.e));
    }
  }
  doList(st) {
    const s = this.scr;
    const from = st.e ? this.int(this.evalNum(st.e)) : 0;
    let i = this.lineAtOrAfter(from);
    s.lower = false;
    for (; i < this.prog.length; i++) {
      const l = this.prog[i];
      const head = String(l.n).padStart(4, ' ') + ' ';
      s.printString(head + listText(l.txt));
      s.newline();
    }
  }
  doSave(st) {
    const name = String(this.evalAny(st.e)).trim();
    if (!name) err('F');
    const body = this.prog.map(l => l.n + '' + l.txt).join(' ');
    if (this.storage) this.storage.save(name, body);
    if (this.onSave) this.onSave(name, body);
    this.scr.printString('Saved "' + name + '"'); this.scr.newline();
  }
  doLoad(st) {
    const name = st.e ? String(this.evalAny(st.e)).trim() : '';
    if (!name) { const e = new ZXError('R'); e.hint = 'tape'; throw e; }
    const body = this.storage ? this.storage.load(name) : null;
    if (body == null) err('R');
    this.prog = body.split(' ').filter(Boolean).map(chunk => {
      const k = chunk.indexOf('');
      return { n: +chunk.slice(0, k), txt: chunk.slice(k + 1), ast: null };
    });
    this.clearVars();
    this.scr.printString('Loaded "' + name + '"'); this.scr.newline();
  }
  doInput(st) {
    const s = this.scr;
    s.lower = true;
    s.lowerSize = 2;
    s.clearLower();
    const queue = [];
    for (const it of st.items) {
      if (it.k === 'prompt') { s.printString(String(this.evalAny(it.e))); continue; }
      if (it.k === 'sep') { if (it.v === "'") s.newline(); continue; }
      if (it.k === 'at') { s.setCursor(this.int(this.evalNum(it.b)), 24 - s.lowerSize + this.int(this.evalNum(it.a))); continue; }
      if (it.k === 'var') queue.push(it);
    }
    if (!queue.length) { s.lower = false; return; }
    this.pendingInput = { queue, idx: 0 };
    this.state = 'input';
    this.editBuf = [];
    this.editPos = 0;
    this.inputMode = true;
    this.mode = queue[0].target.k === 'str' || queue[0].target.k === 'sarr' || queue[0].target.k === 'strslice' ? 'L' : 'L';
    this.renderInput();
  }
  submitInput(text) {
    const p = this.pendingInput;
    if (!p) return;
    const t = p.queue[p.idx].target;
    const wantStr = t.k === 'str' || t.k === 'sarr' || t.k === 'sslice';
    try {
      if (wantStr) this.assignValue(t, text);
      else {
        const v = this.evalExprText(text);
        this.assignValue(t, typeof v === 'string' ? err('C') : v);
      }
    } catch (e) {
      if (e && e.zxReport) { this.scr.lower = false; this.state = 'idle'; this.pendingInput = null; this.report(e.zxReport, this.contLine, this.pc.si + 1); this.editReset(); return; }
      throw e;
    }
    p.idx++;
    if (p.idx < p.queue.length) { this.editBuf = []; this.editPos = 0; this.renderInput(); return; }
    this.pendingInput = null;
    this.inputMode = false;
    this.scr.lower = false;
    this.scr.clearLower();
    this.state = 'run';
    this.pc.si++;
    this.editReset();
  }
  evalExprText(text) {
    const tok = naturalTokenise(text);
    const p = new Parser(tok);
    const e = p.expr();
    if (!p.done()) err('C');
    return this.evalAny(e);
  }

  /* --- assignment -------------------------------------------- */
  assign(target, expr) { this.assignValue(target, this.evalAny(expr)); }
  assignValue(t, val) {
    switch (t.k) {
      case 'num': {
        if (typeof val === 'string') err('C');
        if (!this.num.has(t.name) && this.bytesUsed() + 8 > this.ramLimit) err('4');
        this.num.set(t.name, val); return;
      }
      case 'str': {
        const v = typeof val === 'string' ? val : zxNum(val);
        if (this.bytesUsed() + v.length + 4 > this.ramLimit) err('4');
        this.str.set(t.name, v); return;
      }
      case 'narr': {
        const a = this.narr.get(t.name); if (!a) err('2');
        a.data[this.arrIndex(a.dims, t.subs)] = typeof val === 'string' ? err('C') : val;
        return;
      }
      case 'sarr': {
        const a = this.sarr.get(t.name);
        if (!a) {
          /* a$(n)="x" on an undimensioned string is a one-character slice */
          const i = this.int(this.evalNum(t.subs[0]));
          return this.assignValue({ k: 'sslice', name: t.name, from: { t: 'num', v: i }, to: { t: 'num', v: i } }, val);
        }
        const i = this.arrIndex(a.dims, t.subs);
        let v = typeof val === 'string' ? val : zxNum(val);
        a.data[i] = (v + ' '.repeat(a.slen)).slice(0, a.slen);
        return;
      }
      case 'sslice': {
        const name = t.name;
        const cur = this.str.get(name);
        if (cur === undefined) err('2');
        const from = t.from ? this.int(this.evalNum(t.from)) : 1;
        const to = t.to ? this.int(this.evalNum(t.to)) : cur.length;
        if (from < 1 || to > cur.length || from > to + 1) err('3');
        const width = to - from + 1;
        let v = typeof val === 'string' ? val : zxNum(val);
        v = (v + ' '.repeat(width)).slice(0, width);
        this.str.set(name, cur.slice(0, from - 1) + v + cur.slice(to));
        return;
      }
      default: err('C');
    }
  }
  arrIndex(dims, subs) {
    if (subs.length !== dims.length) err('3');
    let idx = 0;
    for (let i = 0; i < dims.length; i++) {
      const v = this.int(this.evalNum(subs[i]));
      if (v < 1 || v > dims[i]) err('3');
      idx = idx * dims[i] + (v - 1);
    }
    return idx;
  }

  /* --- expression evaluation --------------------------------- */
  int(v) { const n = Math.trunc(v); if (!isFinite(n)) err('6'); return n; }
  evalNum(e) { const v = this.evalAny(e); if (typeof v === 'string') err('C'); return v; }
  evalStr(e) { const v = this.evalAny(e); return typeof v === 'string' ? v : zxNum(v); }
  evalAny(e) {
    switch (e.t) {
      case 'num': return e.v;
      case 'str': return e.v;
      case 'group': return this.evalAny(e.a);
      case 'nvar': { const v = this.num.get(e.name); if (v === undefined) err('2'); return v; }
      case 'svar': { const v = this.str.get(e.name); if (v === undefined) err('2'); return v; }
      case 'neg': return -this.evalNum(e.a);
      case 'not': return this.evalNum(e.a) === 0 ? 1 : 0;
      case 'rnd': return this.rnd();
      case 'inkey': return this.inkey;
      case 'bin': return this.binop(e);
      case 'narr': {
        const a = this.narr.get(e.name);
        if (!a) {
          /* could be FN-less call of an undimensioned name */
          err('2');
        }
        return a.data[this.arrIndex(a.dims, e.subs)];
      }
      case 'sarr': {
        const a = this.sarr.get(e.name);
        if (!a) {
          const s = this.str.get(e.name);
          if (s === undefined) err('2');
          const i = this.int(this.evalNum(e.subs[0]));
          if (i < 1 || i > s.length) err('3');
          return s[i - 1];
        }
        return a.data[this.arrIndex(a.dims, e.subs)];
      }
      case 'slice': {
        const s = this.evalStr(e.a);
        let from = e.from ? this.int(this.evalNum(e.from)) : 1;
        let to = e.to ? this.int(this.evalNum(e.to)) : s.length;
        if (from < 1) from = 1;
        if (to > s.length) to = s.length;
        if (from > to) return '';
        if (e.from && this.int(this.evalNum(e.from)) > s.length + 1) err('3');
        return s.slice(from - 1, to);
      }
      case 'point': {
        const x = this.int(this.evalNum(e.a)), y = this.int(this.evalNum(e.b));
        return this.scr.point(x, y);
      }
      case 'attr': {
        const r = this.int(this.evalNum(e.a)), c = this.int(this.evalNum(e.b));
        if (r < 0 || r > 23 || c < 0 || c > 31) err('B');
        return this.scr.attrAt(r, c);
      }
      case 'screen': {
        const r = this.int(this.evalNum(e.a)), c = this.int(this.evalNum(e.b));
        if (r < 0 || r > 23 || c < 0 || c > 31) err('B');
        return this.scr.screenAt(r, c);
      }
      case 'fn': return this.callFn(e);
      case 'call': return this.call1(e);
      default: err('C');
    }
  }
  binop(e) {
    const op = e.op;
    /* OR and AND are the Spectrum's, not C's: "x OR y" is 1 when y is true
       and x otherwise, and "x AND y" is x when y is true and 0 (or "") when
       it is not — which is what makes PRINT "no" AND a=0 read as it does. */
    if (op === 0xc5) {
      const b = this.evalNum(e.b);
      if (b !== 0) return 1;
      return this.evalNum(e.a);
    }
    if (op === 0xc6) {
      const a = this.evalAny(e.a);
      const b = this.evalNum(e.b);
      if (b !== 0) return a;
      return typeof a === 'string' ? '' : 0;
    }
    const a = this.evalAny(e.a), b = this.evalAny(e.b);
    const sa = typeof a === 'string', sb = typeof b === 'string';
    switch (op) {
      case '+':
        if (sa !== sb) err('C');
        return a + b;
      case '-': if (sa || sb) err('C'); return a - b;
      case '*': if (sa || sb) err('C'); return a * b;
      case '/': if (sa || sb) err('C'); if (b === 0) err('6'); return a / b;
      case '^': {
        if (sa || sb) err('C');
        const r = Math.pow(a, b);
        if (!isFinite(r)) err('6');
        return r;
      }
      case '=': return (sa !== sb ? err('C') : a === b) ? 1 : 0;
      case 0xc9: return (sa !== sb ? err('C') : a !== b) ? 1 : 0;
      case '<': return (sa !== sb ? err('C') : a < b) ? 1 : 0;
      case '>': return (sa !== sb ? err('C') : a > b) ? 1 : 0;
      case 0xc7: return (sa !== sb ? err('C') : a <= b) ? 1 : 0;
      case 0xc8: return (sa !== sb ? err('C') : a >= b) ? 1 : 0;
      default: err('C');
    }
  }
  rnd() {
    /* the ROM's own generator: seed = (seed + 1) * 75 mod 65537, minus one */
    this.seed = ((this.seed + 1) * 75) % 65537;
    const v = this.seed - 1;
    return v / 65536;
  }
  callFn(e) {
    const d = this.fns.get(e.name);
    if (!d) err('P');
    if (d.args.length !== e.args.length) err('Q');
    const saveN = [], saveS = [];
    for (let i = 0; i < d.args.length; i++) {
      const a = d.args[i], v = this.evalAny(e.args[i]);
      if (a.str) { saveS.push([a.name, this.str.get(a.name)]); this.str.set(a.name, typeof v === 'string' ? v : zxNum(v)); }
      else { saveN.push([a.name, this.num.get(a.name)]); this.num.set(a.name, typeof v === 'string' ? err('C') : v); }
    }
    try { return this.evalAny(d.body); }
    finally {
      for (const [n, v] of saveN) { if (v === undefined) this.num.delete(n); else this.num.set(n, v); }
      for (const [n, v] of saveS) { if (v === undefined) this.str.delete(n); else this.str.set(n, v); }
    }
  }
  call1(e) {
    const f = e.f;
    if (f === 'RND1') return this.rnd();
    if (f === 'STR$') return zxNum(this.evalNum(e.a));
    if (f === 'CHR$') { const n = this.int(this.evalNum(e.a)); if (n < 0 || n > 255) err('B'); return String.fromCharCode(n); }
    if (f === 'CODE') { const s = this.evalStr(e.a); return s.length ? s.charCodeAt(0) : 0; }
    if (f === 'LEN') return this.evalStr(e.a).length;
    if (f === 'VAL') { const s = this.evalStr(e.a); const v = this.evalExprText(s); if (typeof v === 'string') err('C'); return v; }
    if (f === 'VAL$') { const s = this.evalStr(e.a); const v = this.evalExprText(s); if (typeof v !== 'string') err('C'); return v; }
    if (f === 'BIN') { const s = this.rawBin(e.a); return s; }
    if (f === 'PEEK') { const a = this.int(this.evalNum(e.a)); if (a < 0 || a > 65535) err('B'); return this.mem[a]; }
    if (f === 'IN') { const p = this.int(this.evalNum(e.a)) & 0xffff; return this.portIn ? this.portIn(p) : 255; }
    if (f === 'USR') {
      const v = this.evalAny(e.a);
      if (typeof v === 'string') {
        const c = v.toUpperCase().charCodeAt(0);
        if (c < 65 || c > 85) err('A');
        return 65368 + (c - 65) * 8;      // where the UDGs live on a 48K
      }
      const addr = this.int(v) & 0xffff;
      if (this.usrHook) return this.usrHook(addr) & 0xffff;
      err('A');
    }
    const x = this.evalNum(e.a);
    switch (f) {
      case 'SIN': return Math.sin(x);
      case 'COS': return Math.cos(x);
      case 'TAN': return Math.tan(x);
      case 'ASN': if (x < -1 || x > 1) err('A'); return Math.asin(x);
      case 'ACS': if (x < -1 || x > 1) err('A'); return Math.acos(x);
      case 'ATN': return Math.atan(x);
      case 'LN': if (x <= 0) err('A'); return Math.log(x);
      case 'EXP': { const r = Math.exp(x); if (!isFinite(r)) err('6'); return r; }
      case 'INT': return Math.floor(x);
      case 'SQR': if (x < 0) err('A'); return Math.sqrt(x);
      case 'SGN': return Math.sign(x);
      case 'ABS': return Math.abs(x);
      default: err('C');
    }
  }
  /* BIN wants the literal digits that follow it, not their value */
  rawBin(node) {
    if (node.t === 'num') {
      const s = String(node.v);
      if (!/^[01]+$/.test(s)) err('C');
      return parseInt(s, 2);
    }
    err('C');
  }

  /* ============================================================
     The editor
     ============================================================ */
  editReset() {
    this.editBuf = [];
    this.editPos = 0;
    this.mode = 'K';
    this.inputMode = false;
    this.needPrompt = true;
    this.refreshMode();
    if (this.scr) this.scr.lowerSize = 2;
  }
  /* The listing the editor sits in front of, the way the ROM redraws it
     after every stored line, with a marker against the line EDIT will pull
     down. Output from a RUN is left alone — only editing repaints it. */
  renderListing() {
    const s = this.scr;
    const save = { ink: s.ink, paper: s.paper, bright: s.bright, flash: s.flash, inverse: s.inverse, over: s.over, lower: s.lower };
    s.ink = 0; s.paper = 7; s.bright = 0; s.flash = 0; s.inverse = 0; s.over = 0; s.lower = false;
    for (let r = 0; r < 22; r++) s.blankRow(r, 0x38);
    s.row = 0; s.col = 0;
    const cur = Math.max(0, Math.min(this.prog.length - 1, this.editCursorLine || 0));
    let i = Math.max(0, cur - 10);
    while (i < this.prog.length && s.row < 21) {
      const l = this.prog[i];
      s.printString(String(l.n).padStart(4, ' '));
      if (i === cur) { s.inverse = 1; s.printChar(62); s.inverse = 0; } else s.printChar(32);
      s.printString(listText(l.txt));
      if (s.col > 0) s.newline();
      i++;
    }
    Object.assign(s, save);
  }
  /* mode letter shown in the flashing cursor */
  cursorMode() {
    if (this.mode === 'E') return 'E';
    if (this.mode === 'G') return 'G';
    if (this.capsLock) return 'C';
    return this.mode;
  }
  /* is a keyword what this key would produce right now? */
  atStatementStart() {
    let depth = 0;
    for (let i = 0; i < this.editPos; i++) {
      const c = this.editBuf[i];
      if (c === 34) depth ^= 1;
    }
    if (depth) return false;
    /* K mode holds until something has been typed on the statement */
    for (let i = this.editPos - 1; i >= 0; i--) {
      const c = this.editBuf[i];
      if (c === 32) continue;
      if (c === 58) return true;              // :
      if (c === 0xcb) return true;            // THEN
      if (c >= 48 && c <= 57) {
        /* digits only keep K mode while they are the line number */
        let j = i;
        while (j >= 0 && ((this.editBuf[j] >= 48 && this.editBuf[j] <= 57) || this.editBuf[j] === 32)) j--;
        return j < 0;
      }
      return false;
    }
    return true;
  }
  refreshMode() {
    if (this.mode === 'E' || this.mode === 'G') return;
    /* K mode is the Spectrum's one-key-one-keyword trick; natural typing
       and INPUT both want plain letters instead */
    if (this.inputMode || this.naturalMode) { this.mode = this.capsLock ? 'C' : 'L'; return; }
    this.mode = this.atStatementStart() ? 'K' : 'L';
  }
  insertCode(c) {
    if (this.editBuf.length > 250) return;
    this.editBuf.splice(this.editPos, 0, c);
    this.editPos++;
    this.refreshMode();
  }
  insertText(s) { for (let i = 0; i < s.length; i++) this.insertCode(s.charCodeAt(i)); }

  /* A cap has been pressed. `st` carries the shift state the terminal
     is holding: { caps, sym }. Returns true if the screen changed. */
  pressCap(capId, st, natural) {
    const caps = !!st.caps, sym = !!st.sym;
    /* While a program is running the keyboard is not an editor: the only
       thing a key does is turn up in INKEY$, and BREAK stops it. */
    if (this.state === 'run' || this.state === 'pause') {
      if (capId === 'BREAK' || (capId === 'SPACE' && caps)) { this.breakIn(); return true; }
      const ch = this.capChar(capId, caps, sym);
      if (ch) this.inkey = ch;
      return false;
    }
    switch (capId) {
      case 'CAPS': case 'SYM': case 'CAPS2': return false;
      case 'ENTER': this.enter(natural); return true;
      case 'DELETE': this.backspace(); return true;
      case 'LEFT': this.moveCursor(-1); return true;
      case 'RIGHT': this.moveCursor(1); return true;
      case 'UP': this.recallLine(-1); return true;
      case 'DOWN': this.recallLine(1); return true;
      case 'EDIT': this.editLine(); return true;
      case 'CAPSLOCK': this.capsLock = !this.capsLock; this.refreshMode(); return true;
      case 'EXTEND': this.mode = this.mode === 'E' ? (this.atStatementStart() ? 'K' : 'L') : 'E'; return true;
      case 'GRAPH': this.mode = this.mode === 'G' ? (this.atStatementStart() ? 'K' : 'L') : 'G'; return true;
      case 'BREAK': this.breakIn(); return true;
      case 'TRUEVID': this.scr.inverse = 0; return true;
      case 'INVVID': this.scr.inverse = 1; return true;
      case 'SPACE':
        if (caps) { this.breakIn(); return true; }
        this.insertCode(32); return true;
      case 'SEMI': this.insertCode(59); return true;
      case 'QUOTE': this.insertCode(34); return true;
      case 'COMMA': this.insertCode(44); return true;
      case 'STOP': this.insertCode(46); return true;
    }
    const cap = capId.length ? capId : '';
    const isLetter = /^[A-Z]$/.test(cap);
    const isDigit = /^[0-9]$/.test(cap);
    if (isDigit && caps && !sym && this.mode !== 'E') return this.pressCap(CAPS_DIGIT[cap], { caps: false, sym: false }, natural);

    const capData = CAPS[cap];
    if (this.mode === 'E' && capData) {
      /* a key with nothing under SYMBOL SHIFT gives its EXTEND word */
      const word = sym && capData.esym ? capData.esym : capData.ext;
      if (word) this.emitLegend(word);
      this.mode = 'L';
      this.refreshMode();
      return true;
    }
    if (sym && capData && capData.sym) { this.emitLegend(capData.sym); return true; }
    if (this.mode === 'G') {
      if (isLetter) { this.insertCode(144 + (cap.charCodeAt(0) - 65)); return true; }
      if (/^[1-8]$/.test(cap)) { this.insertCode(128 + (+cap - 1)); return true; }
      if (cap === '9') { this.mode = this.atStatementStart() ? 'K' : 'L'; return true; }
      return false;
    }
    if (this.mode === 'K' && isLetter && capData && capData.kw) {
      /* the token carries its own spacing when it is listed, so nothing
         else goes in behind it */
      this.insertCode(TOKEN_CODE[capData.kw]);
      this.mode = 'L';
      return true;
    }
    if (isLetter) {
      const upper = this.capsLock !== caps;
      this.insertCode(cap.charCodeAt(0) + (upper ? 0 : 32));
      return true;
    }
    if (isDigit) { this.insertCode(cap.charCodeAt(0)); return true; }
    return false;
  }
  /* the single character a cap stands for, for INKEY$ */
  capChar(capId, caps, sym) {
    if (capId === 'ENTER') return '\r';
    if (capId === 'SPACE') return ' ';
    if (capId === 'SEMI') return ';';
    if (capId === 'QUOTE') return '"';
    if (capId === 'COMMA') return ',';
    if (capId === 'STOP') return '.';
    if (/^[0-9]$/.test(capId)) return caps ? '' : capId;
    if (/^[A-Z]$/.test(capId)) {
      const c = CAPS[capId];
      if (sym && c && c.sym && c.sym.length === 1) return c.sym;
      return (this.capsLock !== caps) ? capId : capId.toLowerCase();
    }
    return '';
  }
  emitLegend(text) {
    const code = TOKEN_CODE[text];
    if (code) this.insertCode(code);
    else if (text === '−') this.insertCode(45);
    else if (text === '↑') this.insertCode(94);
    else this.insertText(text);
  }
  /* natural typing: one plain character, as it came off the PC keyboard */
  typeChar(ch) {
    const c = ch.charCodeAt(0);
    if (c < 32 || c > 255) return false;
    this.editBuf.splice(this.editPos, 0, c);
    this.editPos++;
    return true;
  }
  moveCursor(d) { this.editPos = Math.max(0, Math.min(this.editBuf.length, this.editPos + d)); this.refreshMode(); }
  backspace() {
    if (this.editPos > 0) { this.editBuf.splice(this.editPos - 1, 1); this.editPos--; }
    this.refreshMode();
  }
  recallLine(d) {
    if (this.inputMode || !this.prog.length) return;
    /* up and down step through the listing, ready for EDIT */
    if (this.editCursorLine === undefined) this.editCursorLine = 0;
    this.editCursorLine = Math.max(0, Math.min(this.prog.length - 1, this.editCursorLine + d));
    this.renderListing();
  }
  editLine() {
    if (this.inputMode || !this.prog.length) return;
    const i = Math.max(0, Math.min(this.prog.length - 1, this.editCursorLine || 0));
    const l = this.prog[i];
    const head = String(l.n);
    this.editBuf = [];
    for (const ch of head) this.editBuf.push(ch.charCodeAt(0));
    this.editBuf.push(32);
    for (let k = 0; k < l.txt.length; k++) this.editBuf.push(l.txt.charCodeAt(k));
    this.editPos = this.editBuf.length;
    this.refreshMode();
  }
  bufText() { return this.editBuf.map(c => String.fromCharCode(c)).join(''); }

  enter(natural) {
    let text = this.bufText();
    if (this.state === 'input') { this.submitInput(text); return; }
    this.editBuf = []; this.editPos = 0;
    if (natural) text = naturalTokenise(text);
    this.mode = 'K'; this.refreshMode(); this.needPrompt = true;
    const m = /^\s*(\d+)\s?/.exec(text);
    try {
      if (m) {
        const n = +m[1];
        if (n < 1 || n > 9999) err('C');
        const body = text.slice(m[0].length);
        if (body.trim().length) new Parser(body).parseLine();   // refuse a line that will not run
        this.storeLine(n, body);
        this.editCursorLine = this.lineIndex(n);
        if (this.editCursorLine < 0) this.editCursorLine = Math.max(0, this.lineAtOrAfter(n) - 1);
        this.lastReport = '0';
        this.scr.clearLower();                                  // a stored line reports nothing
        this.renderListing();
      } else if (text.trim().length) {
        this.execDirect(text);
      } else {
        this.report('0', 0, 1);
      }
    } catch (e) {
      if (e && e.zxReport) this.report(e.zxReport, m ? +m[1] : 0, 1);
      else throw e;
    }
  }

  /* --- drawing the line being typed -------------------------- */
  renderInput(flashOn) {
    const s = this.scr;
    const text = this.editBuf.slice();
    const cursor = this.cursorMode();
    /* work out how many rows the line needs, then hand them to the
       lower screen the way the ROM grows it */
    const shown = [];
    for (let i = 0; i < text.length; i++) {
      if (i === this.editPos) shown.push({ c: cursor.charCodeAt(0), cur: true });
      const c = text[i];
      const kw = TOKENS[c];
      if (kw) {
        if (shown.length && shown[shown.length - 1].c !== 32) shown.push({ c: 32 });
        for (const ch of kw) shown.push({ c: ch.charCodeAt(0) });
        if (/[A-Z$#]$/.test(kw)) shown.push({ c: 32 });
      } else shown.push({ c });
    }
    if (this.editPos >= text.length) shown.push({ c: cursor.charCodeAt(0), cur: true });
    const need = Math.max(2, Math.ceil((shown.length + 1) / 32));
    if (need > s.lowerSize) { for (let i = s.lowerSize; i < need; i++) { s.scroll(); } s.lowerSize = Math.min(need, 20); }
    s.lower = true;
    s.clearLower();
    const saveInk = s.ink, savePaper = s.paper, saveFlash = s.flash, saveInv = s.inverse;
    s.ink = 0; s.paper = 7; s.flash = 0; s.inverse = 0;
    for (const item of shown) {
      if (item.cur) { s.inverse = 1; s.flash = flashOn === undefined ? 1 : (flashOn ? 1 : 0); s.printChar(item.c); s.inverse = 0; s.flash = 0; }
      else s.printChar(item.c);
    }
    s.ink = saveInk; s.paper = savePaper; s.flash = saveFlash; s.inverse = saveInv;
    s.lower = false;
  }
}
