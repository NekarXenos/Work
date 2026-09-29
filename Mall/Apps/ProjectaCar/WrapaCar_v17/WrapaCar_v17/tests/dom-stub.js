'use strict';
// The DOM-stub tier's harness. It runs a shipped WrapaCar page — all three of
// its scripts, verbatim — in vm.createContext against a small stub DOM built
// from the page's own markup, with real three.js maths (raycasting, the
// camera) but no WebGL: the renderer is a stub. Pointer events go through
// the app's own listeners on the canvas and its parent. 2D canvases record
// every call, so the atlas painting can be compared call for call; files
// saved go through a stub of the host's download service, byte for byte.
// Timers never fire; animation frames run only when a test flushes them;
// Math.random and Date are fixed, so two runs produce the same bytes.
const fs = require('fs'), path = require('path'), vm = require('vm');
const { scripts } = require('./extract-script.js');

const THREE_DIR = require('./deps.js').three();
if (!THREE_DIR) throw new Error('three.js 0.147.0 not found: run npm install in the release folder, or set THREE_DIR');

/* ---------------------------------------------------------- markup */
const VOID = new Set(['input', 'br', 'img', 'meta', 'link', 'hr', 'source', 'wbr']);
function parse(html) {
  const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script'));
  const root = { tag: 'body', attrs: {}, children: [] }, stack = [root];
  const re = /<!--[\s\S]*?-->|<\/?([a-zA-Z0-9]+)((?:\s+[^\s=>\/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(body))) {
    if (m[0].startsWith('<!--')) continue;
    if (m[4] !== undefined) { const t = decode(m[4]); stack[stack.length - 1].children.push({ text: t }); continue; }
    const tag = m[1].toLowerCase();
    if (m[0].startsWith('</')) {
      for (let i = stack.length - 1; i > 0; i--) if (stack[i].tag === tag) { stack.length = i; break; }
      continue;
    }
    const attrs = {}, ar = /([^\s=>\/]+)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
    let a;
    while ((a = ar.exec(m[2] || ''))) attrs[a[1].toLowerCase()] = a[3] !== undefined ? decode(a[3]) : a[4] !== undefined ? a[4] : a[5] !== undefined ? a[5] : '';
    const node = { tag, attrs, children: [] };
    stack[stack.length - 1].children.push(node);
    if (!VOID.has(tag) && !m[3]) stack.push(node);
  }
  return root;
}
function decode(s) { return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' '); }

/* ------------------------------------------------ recording canvas */
function fmtArg(x) {
  if (typeof x === 'number') return Number.isInteger(x) ? String(x) : x.toPrecision(12);
  if (x && x.__path) return 'P[' + x.__path.join(';') + ']';
  if (x && x.__canvas) return 'C#' + x.__canvas.id;
  if (x && typeof x === 'object') return JSON.stringify(x);
  return String(x);
}
function makeCanvas(doc, log) {
  // numbered per page, so two runs name their canvases alike
  const id = log ? log.length + 1 : 0;
  const calls = [];
  const cv = makeElement(doc, 'canvas', {});
  cv.__canvas = { id, calls };
  cv.width = 300; cv.height = 150;
  const ctx = new Proxy({}, {
    get(t, k) {
      if (k in t) return t[k];
      if (typeof k === 'symbol') return undefined;
      return function () { calls.push(k + '(' + Array.prototype.map.call(arguments, fmtArg).join(',') + ')'); };
    },
    set(t, k, v) { t[k] = v; calls.push(k + '=' + fmtArg(v)); return true; }
  });
  cv.getContext = function () { return ctx; };
  // "encoded" as its drawing, with every canvas drawn into it drawn out in place
  cv.toBlob = function (cb, type) {
    const flat = [];
    (function out(list, depth) {
      list.forEach(c => {
        flat.push(c);
        const m = /^drawImage\(C#(\d+),/.exec(c);
        if (m && depth < 4) { const sub = log && log[+m[1] - 1]; if (sub) out(sub.__canvas.calls, depth + 1); }
      });
    })(calls, 0);
    const bytes = Buffer.from(JSON.stringify({ w: cv.width, h: cv.height, calls: flat }), 'utf8');
    cb({ arrayBuffer: () => Promise.resolve(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length)) });
  };
  if (log) log.push(cv);
  return cv;
}
class Path2DStub {
  constructor() { this.__path = []; }
  moveTo(x, y) { this.__path.push('M' + fmtArg(x) + ',' + fmtArg(y)); }
  lineTo(x, y) { this.__path.push('L' + fmtArg(x) + ',' + fmtArg(y)); }
  bezierCurveTo() { this.__path.push('C' + Array.prototype.map.call(arguments, fmtArg).join(',')); }
  closePath() { this.__path.push('Z'); }
  rect() { this.__path.push('R' + Array.prototype.map.call(arguments, fmtArg).join(',')); }
  arc() { this.__path.push('A' + Array.prototype.map.call(arguments, fmtArg).join(',')); }
}

/* --------------------------------------------------------- elements */
function makeElement(doc, tag, attrs) {
  const el = {
    tagName: tag.toUpperCase(), nodeType: 1, attrs: Object.assign({}, attrs), children: [], parentElement: null,
    style: {}, dataset: {}, listeners: {}, _text: '', _html: '',
    ownerDocument: doc, scrollTop: 0, offsetTop: 0, offsetHeight: 20, clientHeight: 200, clientWidth: 300,
    get id() { return this.attrs.id || ''; }, set id(v) { this.attrs.id = v; if (doc) doc.__ids.set(v, this); },
    get className() { return this.attrs.class || ''; }, set className(v) { this.attrs.class = v; },
    get classList() {
      const self = this;
      const list = () => (self.attrs.class || '').split(/\s+/).filter(Boolean);
      return {
        add() { const l = list(); Array.from(arguments).forEach(c => { if (l.indexOf(c) < 0) l.push(c); }); self.attrs.class = l.join(' '); },
        remove() { self.attrs.class = list().filter(c => Array.from(arguments).indexOf(c) < 0).join(' '); },
        toggle(c, on) { const l = list(), has = l.indexOf(c) >= 0, want = on === undefined ? !has : !!on; if (want && !has) l.push(c); if (!want && has) l.splice(l.indexOf(c), 1); self.attrs.class = l.join(' '); return want; },
        contains(c) { return list().indexOf(c) >= 0; }
      };
    },
    nodes: null,
    get textContent() { return this.nodes ? this.nodes.map(c => typeof c === 'string' ? c : c.textContent).join('') : this._text + this.children.map(c => c.textContent).join(''); },
    set textContent(v) { this.children.forEach(c => { c.parentElement = null; }); this.children = []; this.nodes = null; this._text = String(v); },
    get innerHTML() { return this._html || this.textContent; },
    set innerHTML(v) { this.children.forEach(c => { c.parentElement = null; }); this.children = []; this.nodes = null; this._html = String(v); this._text = String(v).replace(/<[^>]*>/g, ''); },
    get firstChild() { return this.children[0] || null; },
    setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'id' && doc) doc.__ids.set(String(v), this); },
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    hasAttribute(k) { return k in this.attrs; },
    removeAttribute(k) { delete this.attrs[k]; },
    appendChild(c) { if (c.parentElement) c.parentElement.removeChild(c); c.parentElement = this; this.children.push(c); if (this.nodes) this.nodes.push(c); if (c.attrs && c.attrs.id && doc) doc.__ids.set(c.attrs.id, c); return c; },
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); if (this.nodes && this.nodes.indexOf(c) >= 0) this.nodes.splice(this.nodes.indexOf(c), 1); c.parentElement = null; return c; },
    remove() { if (this.parentElement) this.parentElement.removeChild(this); },
    addEventListener(type, fn, opt) { const cap = opt === true || !!(opt && opt.capture); (this.listeners[type] = this.listeners[type] || []).push({ fn, cap }); },
    removeEventListener(type, fn) { const l = this.listeners[type]; if (l) this.listeners[type] = l.filter(x => x.fn !== fn); },
    dispatchEvent(ev) { return dispatch(this, ev); },
    click() { dispatch(this, makeEvent('click', {})); },
    focus() { if (doc) doc.activeElement = this; },
    blur() {},
    scrollIntoView() {},
    setPointerCapture() {}, releasePointerCapture() {}, hasPointerCapture() { return false; },
    getBoundingClientRect() { return { left: 0, top: 0, right: this.clientWidth, bottom: this.clientHeight, width: this.clientWidth, height: this.clientHeight, x: 0, y: 0 }; },
    querySelector(sel) {
      const m = /^\[data-([a-z-]+)="([^"]*)"\]$/.exec(sel);
      if (!m) return null;
      const key = m[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      let found = null;
      (function walk(e) { if (found) return; if (e.dataset && String(e.dataset[key]) === m[2]) { found = e; return; } (e.children || []).forEach(walk); })(this);
      return found;
    },
    get options() { return this.children.filter(c => c.tagName === 'OPTION'); },
    get selectedIndex() { const o = this.options; for (let i = 0; i < o.length; i++) if (o[i].value === this.value) return i; return 0; }
  };
  if (tag === 'option') { Object.defineProperty(el, 'text', { get() { return this.textContent; } }); el.value = attrs.value != null ? attrs.value : ''; }
  if (tag === 'input') {
    el.type = attrs.type || 'text';
    el.value = attrs.value != null ? attrs.value : '';
    el.checked = 'checked' in attrs;
    el.min = attrs.min; el.max = attrs.max; el.step = attrs.step;
    el.files = null;
  }
  el.disabled = 'disabled' in attrs;
  el.hidden = 'hidden' in attrs;
  Object.keys(attrs).forEach(k => { if (k.startsWith('data-')) el.dataset[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = attrs[k]; });
  return el;
}
function makeEvent(type, o) {
  const ev = Object.assign({ type, bubbles: true, defaultPrevented: false, _stop: false, button: 0, buttons: 0, pointerId: 1, pointerType: 'mouse',
    clientX: 0, clientY: 0, altKey: false, shiftKey: false, ctrlKey: false, metaKey: false, deltaY: 0 }, o);
  ev.preventDefault = function () { ev.defaultPrevented = true; };
  ev.stopPropagation = function () { ev._stop = true; };
  ev.stopImmediatePropagation = function () { ev._stop = true; ev._stopNow = true; };
  return ev;
}
function dispatch(target, ev) {
  ev.target = target;
  const chain = [];
  for (let e = target.parentElement; e; e = e.parentElement) chain.unshift(e);
  const run = (el, capture) => {
    const l = (el.listeners[ev.type] || []).slice();
    for (const x of l) {
      if (!!x.cap !== capture && el !== target) continue;
      ev.currentTarget = el;
      x.fn.call(el, ev);
      if (ev._stopNow) return false;
    }
    return !ev._stop;
  };
  for (const el of chain) if (!run(el, true)) return !ev.defaultPrevented;
  if (!run(target, true)) return !ev.defaultPrevented;
  if (ev.bubbles) for (let i = chain.length - 1; i >= 0; i--) if (!run(chain[i], false)) break;
  if (ev.type === 'change' || ev.type === 'input' || ev.type === 'click') {
    const w = target.ownerDocument && target.ownerDocument.__window;
    if (w && ev.bubbles && !ev._stop) (w.__listeners[ev.type] || []).forEach(fn => fn(ev));
  }
  return !ev.defaultPrevented;
}

/* ------------------------------------------------------------ boot */
function boot(file, opts) {
  opts = opts || {};
  const html = fs.readFileSync(file, 'utf8');
  const doc = { __ids: new Map(), activeElement: null, title: (/<title>([^<]*)<\/title>/.exec(html) || [])[1] || '' };
  const canvases = [];
  function build(node, parent) {
    if (node.text !== undefined) { if (parent) { if (!parent.nodes) parent.nodes = parent.children.slice(); parent.nodes.push(node.text); } return; }
    const el = node.tag === 'canvas' ? makeCanvas(doc, canvases) : makeElement(doc, node.tag, node.attrs);
    if (node.tag === 'canvas') { Object.assign(el.attrs, node.attrs); if (node.attrs.width) el.width = +node.attrs.width; if (node.attrs.height) el.height = +node.attrs.height; }
    if (el.attrs.id) doc.__ids.set(el.attrs.id, el);
    if (parent) { el.parentElement = parent; parent.children.push(el); if (parent.nodes) parent.nodes.push(el); }
    node.children.forEach(c => build(c, el));
    // text of simple elements
    if (node.tag === 'select') {
      const sel = el.options.find(o => 'selected' in o.attrs) || el.options[0];
      el.value = sel ? sel.value : '';
    }
    return el;
  }
  const body = build(parse(html), null);
  doc.body = body;
  doc.documentElement = makeElement(doc, 'html', {});
  doc.documentElement.appendChild(body);
  doc.getElementById = id => doc.__ids.get(id) || null;
  doc.createElement = tag => tag === 'canvas' ? makeCanvas(doc, canvases) : makeElement(doc, tag, {});
  doc.addEventListener = function () {};
  doc.removeEventListener = function () {};
  doc.querySelector = () => null;

  const view = doc.getElementById('view');
  view.clientWidth = 1000; view.clientHeight = 700;
  const sheet = doc.getElementById('atlasCanvas').parentElement;
  sheet.clientWidth = 300; sheet.clientHeight = 300;

  // animation frames and timers under the test's control
  let raf = [], rafId = 0, now = 1000;
  const files = [];
  const win = {
    __listeners: {},
    addEventListener(type, fn) { (this.__listeners[type] = this.__listeners[type] || []).push(fn); },
    removeEventListener() {},
    devicePixelRatio: 1,
    matchMedia() { return { matches: false, addEventListener() {}, addListener() {} }; },
    getComputedStyle() { return { getPropertyValue: k => (k === '--stage' ? '#dde3e9' : '') }; },
    requestAnimationFrame(fn) { raf.push(fn); return ++rafId; },
    cancelAnimationFrame() {},
    setTimeout() { return 0; }, clearTimeout() {}, setInterval() { return 0; }, clearInterval() {},
    performance: { now: () => now },
    claude: opts.noDownloads ? undefined : {
      use: () => Promise.resolve({ save: o => { files.push({ name: o.filename, data: Buffer.from(o.data) }); return Promise.resolve(); } })
    },
    document: doc, navigator: { userAgent: 'node' }, Path2D: Path2DStub, TextEncoder, TextDecoder, console,
    // a file a test hands the page: { name, text } or { name, bytes }, read at once
    FileReader: function () {
      const r = this;
      r.readAsText = f => { r.result = f.text; if (r.onload) r.onload(); };
      r.readAsArrayBuffer = f => { const b = Buffer.from(f.bytes); r.result = b.buffer.slice(b.byteOffset, b.byteOffset + b.length); if (r.onload) r.onload(); };
    }
  };
  doc.__window = win;
  const ctx = vm.createContext(win);
  win.window = win; win.self = win;
  // fixed randomness and clock, inside the context only
  vm.runInContext(`(function () {
    var seed = 12345;
    Math.random = function () { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    var RealDate = Date, fixed = new RealDate(Date.UTC(2026, 8, 28, 8, 0, 0)).getTime();
    Date = function () { return arguments.length ? new (Function.prototype.bind.apply(RealDate, [null].concat(Array.prototype.slice.call(arguments))))() : new RealDate(fixed); };
    Date.now = function () { return fixed; }; Date.UTC = RealDate.UTC; Date.prototype = RealDate.prototype;
  })();`, ctx);
  // three.js as the page loads it, then no WebGL
  ['build/three.min.js', 'examples/js/controls/OrbitControls.js', 'examples/js/utils/BufferGeometryUtils.js',
    'examples/js/loaders/GLTFLoader.js', 'examples/js/loaders/OBJLoader.js', 'examples/js/loaders/STLLoader.js'].forEach(f => {
    vm.runInContext(fs.readFileSync(path.join(THREE_DIR, f), 'utf8'), ctx, { filename: f });
  });
  // the scene and camera last drawn are kept, so a test can see what is on screen
  vm.runInContext(`THREE.WebGLRenderer = function (o) {
    this.domElement = o.canvas; this.renders = 0; window.__renderer = this;
    this.setPixelRatio = function () {}; this.setSize = function () {};
    this.render = function (scene, camera) { this.renders++; this.scene = scene; this.camera = camera; };
  };`, ctx);
  const errors = [];
  scripts(file).forEach((src, i) => {
    try { vm.runInContext(src, ctx, { filename: path.basename(file) + '#script' + i }); }
    catch (e) { errors.push(e); throw e; }
  });

  function flush(rounds) {
    for (let r = 0; r < (rounds || 1); r++) {
      const q = raf; raf = [];
      now += 16;
      q.forEach(fn => fn(now));
    }
  }
  async function settle(rounds) {
    for (let r = 0; r < (rounds || 40); r++) { flush(1); await new Promise(res => setImmediate(res)); }
  }
  const $ = id => doc.getElementById(id);
  function click(id) { const el = typeof id === 'string' ? $(id) : id; if (!el) throw new Error('no element ' + id); if (el.disabled) throw new Error(id + ' is disabled'); dispatch(el, makeEvent('click', {})); }
  function change(id, value) { const el = $(id); if (typeof value === 'boolean') el.checked = value; else if (value !== undefined) el.value = String(value); dispatch(el, makeEvent('change', {})); }
  function input(id, value) { const el = $(id); el.value = String(value); dispatch(el, makeEvent('input', {})); }
  function key(k, o) { const ev = makeEvent('keydown', Object.assign({ key: k, target: doc.body }, o || {})); (win.__listeners.keydown || []).forEach(fn => fn(ev)); }
  // a tap on the model: down and up at one spot, through the app's listeners
  function tap(x, y, o) {
    const d = makeEvent('pointerdown', Object.assign({ clientX: x, clientY: y, buttons: 1 }, o || {}));
    dispatch(view, d);
    const u = makeEvent('pointerup', Object.assign({ clientX: x, clientY: y, buttons: 0 }, o || {}));
    dispatch(view, u);
  }
  // a model opened with Open a file
  function open(name, text) { const el = $('fileIn'); el.files = [{ name, text }]; dispatch(el, makeEvent('change', {})); }
  function move(x, y, o) { dispatch(view, makeEvent('pointermove', Object.assign({ clientX: x, clientY: y }, o || {}))); }
  function modeButton(mode) { return $('modeSeg').children.find(b => b.dataset && b.dataset.mode === mode); }
  const toast = () => $('toast').textContent;
  // what the app's camera shows: its scene and camera as last rendered
  const shown = () => win.__renderer ? { scene: win.__renderer.scene, camera: win.__renderer.camera } : {};
  return { ctx, doc, win, $, click, change, input, key, tap, move, flush, settle, files, canvases, toast, modeButton, view, THREE: ctx.THREE, errors, shown, open };
}

module.exports = { boot, parse };
