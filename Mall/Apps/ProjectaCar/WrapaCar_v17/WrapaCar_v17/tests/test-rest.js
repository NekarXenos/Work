'use strict';
// Regression tier: with no intake accepted, v17 does exactly what v16 does.
// The same session runs on both pages — seams, suggested seams, the
// topology check and a rebuild, the unwrap in both flattening modes, mirrored
// panels kept and split, vector artwork, every export — and every readout,
// every message and every byte saved has to match. The only differences
// allowed are the names: the PDF says who made it (v16's said "WrapaCar v14",
// v17's "WrapaCar v17"), and the .obj/.mtl headers say WrapaCar, not
// Seamwork. A PDF's /ID is a random stamp and is left out.
const { boot } = require('./dom-stub.js');
const { ledger, PAGE, BASE } = require('./lib.js');
const L = ledger('regression tier');
const { check } = L;

async function until(app, cond, rounds) {
  for (let r = 0; r < (rounds || 400); r++) { if (cond()) return true; await app.settle(1); }
  return cond();
}
function unzip(buf) {
  const out = {};
  let o = 0;
  while (buf.readUInt32LE(o) === 0x04034b50) {
    const n = buf.readUInt16LE(o + 26), x = buf.readUInt16LE(o + 28), size = buf.readUInt32LE(o + 18);
    const name = buf.slice(o + 30, o + 30 + n).toString(); o += 30 + n + x;
    out[name] = buf.slice(o, o + size); o += size;
  }
  return out;
}
const READOUTS = ['statTris', 'wrapCount', 'statIslands', 'statShared', 'statFill', 'statStretch', 'statWorst', 'statRetopo', 'statSlivers', 'statSharpest', 'statCreases', 'unwrapNote'];

async function session(file) {
  const app = boot(file), log = [];
  const note = (k, v) => { log.push(k + ': ' + v); if (process.env.TRACE) console.log('  ' + (k + ': ' + v).slice(0, 200)); };
  const readouts = k => note(k, READOUTS.map(id => app.$(id) ? app.$(id).textContent : '').join(' | '));
  async function unwrap(k) {
    app.click('unwrapBtn');
    await until(app, () => !app.$('retopoReview').hidden || /^Unwrapped/.test(app.toast()), 800);
    if (!app.$('retopoReview').hidden) {
      note(k + ' asks first', app.$('retopoSummary').textContent);
      app.click('retopoSkipBtn');
      await until(app, () => /^Unwrapped/.test(app.toast()), 800);
    }
    note(k, app.toast()); readouts(k);
  }
  async function save(id) { const n = app.files.length; app.click(id); await until(app, () => app.files.length > n, 50); }
  await app.settle(5);
  note('load', app.toast()); readouts('load');

  // a seam drawn by hand, and a suggestion taken
  app.click(app.modeButton('draw'));
  [[370, 352], [500, 392], [498, 418], [368, 378]].forEach(p => app.tap(p[0], p[1]));
  await app.settle(2);
  note('points', app.$('hud').textContent);
  app.key('Enter');
  await app.settle(2);
  note('cut', app.toast()); readouts('cut');
  const before = app.toast();
  app.click('suggestBtn');
  await until(app, () => app.toast() !== before && !app.$('busy').classList.contains('on'), 800);
  note('suggest', app.toast() + ' | ' + app.$('suggestList').textContent);
  if (app.$('suggestList').children.length) {
    app.click(app.$('suggestList').children[0].children[2]);
    await app.settle(3);
    note('accept one', app.toast()); readouts('accept one');
  }
  if (!app.$('suggestReview').hidden) app.click('suggestRejectAll');

  // the topology check, and a rebuild if it asks for one
  app.click('retopoCheckBtn');
  await app.settle(3);
  note('topology', app.toast()); readouts('topology');
  if (!app.$('retopoReview').hidden) app.click('retopoSkipBtn');
  await unwrap('unwrap');

  // artwork, and every export
  app.click(app.modeButton('vector'));
  [[470, 330], [540, 325], [510, 380], [470, 330]].forEach(p => app.tap(p[0], p[1]));
  await app.settle(5);
  note('art', app.toast());
  await save('pdfBtn'); await save('pngBtn'); await save('zipBtn');
  app.click(app.modeButton('orbit'));

  // flat projection, then mirrored panels flattened on their own
  app.change('modeSel', 'planar');
  await unwrap('planar');
  await save('pngBtn');
  app.change('modeSel', 'arap');
  app.change('splitMirror', false);
  await unwrap('shared twins');
  await save('pngBtn'); await save('pdfBtn');
  app.change('splitMirror', true);

  // a rebuild, then the unwrap again
  app.$('retopoLen').value = '60';
  if (!app.$('selectAllPanelsBtn').disabled) app.click('selectAllPanelsBtn');
  app.click('retopoCheckBtn');
  await app.settle(3);
  note('check again', app.toast()); readouts('check again');
  if (!app.$('retopoBtn').disabled) {
    const was = app.toast();
    app.click('retopoBtn');
    await until(app, () => app.toast() !== was && !app.$('busy').classList.contains('on') && !app.$('unwrapBtn').disabled, 3000);
    note('rebuild', app.toast()); readouts('rebuild');
  } else note('rebuild', 'not needed');
  await unwrap('after rebuild');
  await save('pngBtn');

  // undo back to the start, and the other built-in shapes
  app.key('z', { ctrlKey: true }); await app.settle(2);
  note('undo', app.toast()); readouts('undo');
  for (const shape of ['sphere', 'box']) {
    app.change('modelSel', shape);
    await app.settle(3);
    note(shape, app.toast()); readouts(shape);
    await unwrap(shape + ' unwrap');
    await save('pngBtn'); await save('pdfBtn');
  }
  note('errors', app.errors.length);
  return { log, files: app.files };
}

function norm(name, b) {
  let s = b.toString('latin1');
  if (/\.(obj|mtl)$/.test(name)) s = s.replace(/^# Seamwork/, '# WrapaCar');
  if (/\.pdf$/.test(name)) s = s.replace(/WrapaCar v14/g, 'WrapaCar v17').replace(/\/ID \[<[0-9a-f]+> <[0-9a-f]+>\]/, '/ID []');
  return s;
}

(async () => {
  const a = await session(BASE), b = await session(PAGE);
  check('same number of steps', a.log.length === b.log.length, a.log.length + ' vs ' + b.log.length);
  a.log.forEach((line, i) => check('same: ' + line.slice(0, 140), line === b.log[i], '\n      v17: ' + (b.log[i] || '').slice(0, 300)));
  check('the session did something', a.log.some(l => /^unwrap: Unwrapped/.test(l)) && a.log.some(l => /^cut: /.test(l)) && a.files.length >= 10, a.files.length + ' files');
  check('same files saved', a.files.map(f => f.name).join() === b.files.map(f => f.name).join(), a.files.map(f => f.name).join());
  let names = 0;
  a.files.forEach((f, i) => {
    const g = b.files[i];
    if (!g) return;
    if (/\.zip$/.test(f.name)) {
      const x = unzip(f.data), y = unzip(g.data);
      check('zip holds the same files: ' + f.name, Object.keys(x).join() === Object.keys(y).join());
      Object.keys(x).forEach(k => { check('same bytes: ' + f.name + '/' + k, y[k] && norm(k, x[k]) === norm(k, y[k])); if (/\.(obj|mtl)$/.test(k)) names++; });
    } else check('same bytes: #' + i + ' ' + f.name, norm(f.name, f.data) === norm(g.name, g.data));
    if (/\.pdf$/.test(f.name)) { names++; check('pdf made by v17: #' + i, /\/Creator \(WrapaCar v17\)/.test(g.data.toString('latin1')) && /WrapaCar v14/.test(f.data.toString('latin1'))); }
  });
  check('the renamed headers were there to compare', names >= 3, names);
  // the check can tell: an edit to the atlas or the pdf is seen
  check('the comparison can tell (control)', norm('x.pdf', Buffer.from(a.files[0].data.toString('latin1').replace(/ m\n/, ' m \n'), 'latin1')) !== norm('x.pdf', a.files[0].data));
  L.done();
})().catch(e => { console.error('regression tier crashed:', e); process.exitCode = 1; });
