'use strict';
// DOM-stub tier. The shipped page runs whole — its markup, its three scripts
// verbatim — against a stub DOM, and is driven the way a person drives it:
// clicks on its own buttons, taps on the model through the canvas's own
// pointer listeners, keys through the window's. Taps land where the app's
// camera puts the intakes on screen, found by casting the same ray the app
// casts.
const fs = require('fs');
const { boot } = require('./dom-stub.js');
const { ledger, appFunction, PAGE, load, scripts } = require('./lib.js');
const { sheet } = require('./synth.js');
const PC = load(PAGE, 'panel');
const L = ledger('DOM tier');
const { check } = L;

async function until(app, cond, rounds) {
  for (let r = 0; r < (rounds || 400); r++) { if (cond()) return true; await app.settle(1); }
  return cond();
}
const text = (app, id) => app.$(id).textContent;
const rows = app => app.$('intakeList').children.map(li => li.children[1].textContent);
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

// The atlas as saved: the last fill of an island's own path, as the number
// of triangles in it (its faces, and the lids laid over its openings).
function atlasFill(app) {
  const paths = JSON.parse(app.files[app.files.length - 1].data.toString()).calls.filter(c => c.startsWith('fill(P['))
    .map(c => c.slice(7, -2).split(';'))
    // an island is filled as triangles, the artwork as its own shapes
    .filter(t => t.length % 4 === 0 && t.every((x, i) => x[0] === 'MLLZ'[i % 4]));
  return paths.length ? paths[paths.length - 1].length / 4 : -1;
}
// The artwork's clip in the atlas as saved: the last island region the
// artwork is painted through (set up in UV, flipped), as its triangles.
function artClip(app) {
  const calls = JSON.parse(app.files[app.files.length - 1].data.toString()).calls;
  let last = null;
  for (let i = 1; i < calls.length; i++) if (calls[i].startsWith('clip(P[') && /^setTransform\([\d.]+,0,0,-/.test(calls[i - 1])) last = calls[i];
  if (!last) return { triangles: -1, paths: -1 };
  const t = last.slice(7, -2).split(';');
  let tri = 0, paths = 0, run = 0;
  t.forEach(x => { if (x[0] === 'M') { paths++; run = 1; } else if (x[0] === 'L') run++; else if (x[0] === 'Z') { if (run === 3) tri++; run = 0; } });
  return { triangles: tri, paths };
}
// The PDF's two layers: the artwork, clipped to its island, and the cut line.
function pdfLayers(pdf) {
  const layer = name => { const a = pdf.indexOf('/OC /' + name + ' BDC'); return a < 0 ? '' : pdf.slice(a, pdf.indexOf('EMC', a)); };
  const art = layer('Art'), cut = layer('Cut'), clipEnd = art.indexOf('W n');
  const clip = clipEnd < 0 ? '' : art.slice(art.indexOf('q\n'), clipEnd);
  return { cutPaths: (cut.match(/ m\n/g) || []).length, clipTriangles: (clip.match(/ m\n[^\n]+ l\n[^\n]+ l\nh\n/g) || []).length, clipPaths: (clip.match(/ m\n/g) || []).length };
}

/* ---- where the bumper's intakes are on screen ---- */
// the bumper as adoptMesh takes it (centred, 3 units across), the intakes as
// Find intakes finds them, and the app's opening camera
function bumperScene(THREE) {
  const m = appFunction(PAGE, 'bumperBody', { PC })();
  const P = m.pos, lo = [1e30, 1e30, 1e30], hi = [-1e30, -1e30, -1e30];
  for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], P[i + k]); hi[k] = Math.max(hi[k], P[i + k]); }
  const c = [0, 1, 2].map(k => (lo[k] + hi[k]) / 2), s = 3 / Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
  for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) P[i + k] = (P[i + k] - c[k]) * s;
  const mm = 1800 / 3, plane = PC.detectMirror(m);
  const found = PC.findIntakes(m, PC.buildEdgeMap(m), { diameter: 300 / mm, minDepth: 5 / mm, plane: { axis: plane.axis, offset: plane.offset } });
  const cam = new THREE.PerspectiveCamera(42, 1000 / 700, 0.02, 120);
  cam.position.set(3.2, 2.0, 4.2); cam.lookAt(0, 0, 0); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(Array.from(P), 3));
  g.setIndex(Array.from(m.tris));
  const obj = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  obj.updateMatrixWorld();
  const ray = new THREE.Raycaster();
  function hitAt(x, y) {
    ray.setFromCamera(new THREE.Vector2(x / 1000 * 2 - 1, -(y / 700) * 2 + 1), cam);
    const h = ray.intersectObject(obj, false)[0];
    return h ? h.faceIndex : -1;
  }
  const centroid = f => [0, 1, 2].map(k => (P[3 * m.tris[3 * f] + k] + P[3 * m.tris[3 * f + 1] + k] + P[3 * m.tris[3 * f + 2] + k]) / 3);
  function screen(p) { const v = new THREE.Vector3(p[0], p[1], p[2]).project(cam); return [(v.x + 1) / 2 * 1000, (1 - v.y) / 2 * 700]; }
  // a screen point whose ray first meets one of these faces, nearest their middle
  function aim(faces) {
    const set = new Set(faces), mid = [0, 1, 2].map(k => faces.reduce((a, f) => a + centroid(f)[k], 0) / faces.length);
    const order = faces.slice().sort((a, b) => {
      const p = centroid(a), q = centroid(b);
      return Math.hypot(p[0] - mid[0], p[1] - mid[1], p[2] - mid[2]) - Math.hypot(q[0] - mid[0], q[1] - mid[1], q[2] - mid[2]);
    });
    for (const f of order) { const sp = screen(centroid(f)); if (set.has(hitAt(sp[0], sp[1]))) return sp; }
    return null;
  }
  const vents = found.filter(x => !x.through), grille = found.filter(x => x.through)[0];
  // the vent nearer the camera, and its mirror image
  const near = vents.slice().sort((a, b) => cam.position.distanceTo(new THREE.Vector3(...a.centre)) - cam.position.distanceTo(new THREE.Vector3(...b.centre)));
  // plain bumper, well clear of every opening
  const clear = [];
  for (let f = 0; f < m.tris.length / 3; f++) {
    const p = centroid(f);
    if (found.every(it => Math.hypot(p[0] - it.centre[0], p[1] - it.centre[1], p[2] - it.centre[2]) > 0.45)) clear.push(f);
  }
  // above the near vent (y is 240 mm a unit of t, z 900 mm a unit of s, both over 600)
  const plainFaces = clear.filter(f => { const p = centroid(f); return Math.hypot(p[1] - 0.25, p[2] - 1.0) < 0.06; });
  // a spot on the bumper's face at height y and across at z, clear of the openings
  const inIntake = new Set();
  found.forEach(it => it.faces.forEach(f => inIntake.add(f)));
  const spot = (y, z) => aim(Array.from({ length: m.tris.length / 3 }, (_, f) => f).filter(f => { const p = centroid(f); return !inIntake.has(f) && Math.hypot(p[1] - y, p[2] - z) < 0.02; }));
  return { found, vent: aim(near[0].faces), grille: aim(grille.faces), plain: aim(plainFaces), spot, mesh: m,
    lidTriangles: found.reduce((a, it) => a + it.lm.tris.length / 3, 0) };
}

(async () => {
  const html = fs.readFileSync(PAGE, 'utf8');

  /* ---- 1. the version, and nothing of v16 left ---- */
  {
    const app = boot(PAGE);
    await app.settle(5);
    check('title says v17', app.doc.title === 'WrapaCar v17 — Intakes', app.doc.title);
    const brand = app.doc.body.children.length && (function find(e) { if (e.attrs && e.attrs.class === 'tag') return e; for (const c of e.children || []) { const r = find(c); if (r) return r; } return null; })(app.doc.body);
    check('brand says v17', !!brand && / · v17$/.test(brand.textContent), brand && brand.textContent);
    check('app banner says v17', /^\s*\/\* WrapaCar v17 — /.test(scripts(PAGE)[2].replace(/^\s*'use strict';?/, '')) || /\/\* WrapaCar v17 — the app/.test(scripts(PAGE)[2]));
    check('no v16 left in the page', html.indexOf('v16') < 0 && html.indexOf('Seamwork') < 0 && html.indexOf('WrapaCar v14') < 0);
    check('boots with no errors', app.errors.length === 0);
    check('Intake mode button', !!app.modeButton('intake') && app.modeButton('intake').textContent === 'Intakes');
    app.key('8');
    check('key 8 picks Intake mode', app.modeButton('intake').classList.contains('on') && /Tap an intake/.test(app.$('hud').innerHTML) && /None projected yet/.test(app.$('hud').innerHTML));
    app.key('1');
    check('bumper in the model list', app.$('modelSel').options.some(o => o.value === 'bumper' && o.textContent === 'Bumper with intakes'));
    check('intakes projected by default, lids not shown', app.$('intakeProject').checked && !app.$('showIntakes').checked && app.$('intakeWidth').value === '300');
    check('nothing to review at the start', app.$('intakeReview').hidden && text(app, 'statIntakes') === '0' && app.$('intakeClearBtn').disabled);
  }

  /* ---- 2. find, review, accept, unwrap: the bumper ---- */
  let sc;
  {
    const app = boot(PAGE);
    await app.settle(5);
    app.change('modelSel', 'bumper');
    await app.settle(3);
    sc = bumperScene(app.THREE);
    const tris = +text(app, 'statTris').replace(/,/g, '');
    check('bumper loads, mirror plane found', /^Bumper with intakes loaded — [\d,]+ triangles, mirror plane found/.test(app.toast()), app.toast());
    check('bumper: the real size is its width', String(app.$('realLen').value) === '1800', app.$('realLen').value);
    let was = app.toast();
    app.click('suggestBtn');
    await until(app, () => app.toast() !== was && !app.$('busy').classList.contains('on'), 400);
    check('suggest seams, no intakes: splits where the grille\'s lip turns (control)', app.toast() === '1 seam suggested — accept or reject each' && /^1\. Split where the body turns/.test(app.$('suggestList').textContent), app.toast() + ' | ' + app.$('suggestList').textContent);
    app.click('suggestRejectAll');
    app.click('intakeFindBtn');
    await until(app, () => !app.$('intakeReview').hidden, 200);
    check('find: three found', app.toast() === '3 intakes found — accept or reject each', app.toast());
    const r = rows(app);
    check('find: a row for the vents together, one for the grille', text(app, 'intakeTitle') === 'Intakes found (2)' && r.length === 2, r.join(' / '));
    check('find: the vents row', /^1\. Intake 272 × 103 mm/.test(r[0]) && /51 mm deep · stretch ×2\.0 · both sides$/.test(r[0]), r[0]);
    check('find: the grille row', /^2\. Opening 600 × 150 mm/.test(r[1]) && /goes right through — covered, trim and tuck on the car · symmetrical$/.test(r[1]), r[1]);
    check('find: the first row is shown', app.$('intakeList').children[0].className === 'on' && app.$('intakeList').children[1].className === '');
    app.click(app.$('intakeList').children[1].children[3]);
    check('reject a row: the grille goes, the vents stay', text(app, 'intakeTitle') === 'Intakes found (1)' && rows(app)[0].indexOf('1. Intake') === 0);
    app.key('Escape');
    check('Esc: all dismissed', app.$('intakeReview').hidden && app.toast() === 'Intakes dismissed — the panels are flattened as they are', app.toast());
    app.click('intakeFindBtn');
    await until(app, () => !app.$('intakeReview').hidden, 200);
    const creasesBefore = text(app, 'statCreases');
    app.click('intakeAcceptAll');
    await app.settle(2);
    check('accept all: three projected', text(app, 'statIntakes') === '3' && app.$('intakeReview').hidden, text(app, 'statIntakes'));
    check('accept all: says what happens next', app.toast() === '3 intakes accepted — their lids are laid over the openings. Unwrap again to project the artwork into them.', app.toast());
    check('accept all: each rim a crease', creasesBefore === '0' && text(app, 'statCreases') === '3 lines', text(app, 'statCreases'));
    check('accept all: Clear can take them away', !app.$('intakeClearBtn').disabled);
    app.click('intakeFindBtn');
    await app.settle(4);
    check('find again: those projected are not found again', app.toast() === 'Every intake found is projected already' && app.$('intakeReview').hidden, app.toast());

    app.click('unwrapBtn');
    await until(app, () => text(app, 'statIslands') !== '—' || !app.$('retopoReview').hidden, 600);
    check('unwrap: no rebuild asked for', app.$('retopoReview').hidden);
    check('unwrap: projected', /^Unwrapped 1 panel.* — 3 intakes projected from their lids$/.test(app.toast()), app.toast());
    const on = { stretch: text(app, 'statStretch'), worst: text(app, 'statWorst'), note: text(app, 'unwrapNote') };
    // a little artwork on the bumper, so the PDF clips it to the island
    app.click(app.modeButton('vector'));
    const shape = [sc.spot(0.3, 0.95), sc.spot(0.3, 1.1), sc.spot(0.2, 1.02)];
    shape.concat([shape[0]]).forEach(p => app.tap(p[0], p[1]));
    await app.settle(5);
    check('artwork drawn on the bumper', /^Shape closed and mirrored/.test(app.toast()), app.toast());
    app.click(app.modeButton('orbit'));
    app.click('pngBtn');
    await until(app, () => app.files.length === 1, 50);
    check('atlas: the lids painted across the openings', atlasFill(app) === tris + sc.lidTriangles, atlasFill(app) + ' = ' + tris + ' faces + ' + sc.lidTriangles + ' lid triangles?');
    const clipOn = artClip(app);
    check('atlas: the artwork painted through the lids too', clipOn.triangles === tris + sc.lidTriangles, JSON.stringify(clipOn));
    app.click('pdfBtn');
    await until(app, () => app.files.length === 2, 50);
    const pdfOn = app.files[1].data.toString('latin1'), layOn = pdfLayers(pdfOn);
    check('pdf: made by v17', /\/Creator \(WrapaCar v17\)/.test(pdfOn));
    check('pdf: one cut line — the grille is covered', layOn.cutPaths === 1, layOn.cutPaths);
    check('pdf: the artwork runs across the lids', layOn.clipTriangles === tris + sc.lidTriangles && layOn.clipPaths === layOn.clipTriangles, JSON.stringify(layOn));

    // Project artwork across intakes, off: the panel flattened as v16 does
    app.change('intakeProject', false);
    await until(app, () => text(app, 'statStretch') !== on.stretch && text(app, 'statIslands') !== '—', 600);
    check('projection off: unwrapped again at once', /^Unwrapped 1 panel/.test(app.toast()) && !/projected from their lids/.test(app.toast()), app.toast());
    check('projection off: kept, not projected', text(app, 'statIntakes') === '3, not projected');
    const off = { stretch: text(app, 'statStretch'), worst: text(app, 'statWorst') };
    check('projection off: the walls stretch the print', parseFloat(off.worst) > parseFloat(on.worst) + 0.5 && parseFloat(off.stretch) > parseFloat(on.stretch), 'on ' + on.stretch + '/' + on.worst + ', off ' + off.stretch + '/' + off.worst);
    app.click('pngBtn');
    await until(app, () => app.files.length === 3, 50);
    check('projection off: no lids in the atlas', atlasFill(app) === tris && artClip(app).triangles === tris, atlasFill(app) + ' ' + JSON.stringify(artClip(app)));
    app.click('pdfBtn');
    await until(app, () => app.files.length === 4, 50);
    const layOff = pdfLayers(app.files[3].data.toString('latin1'));
    check('projection off: the grille is cut out again', layOff.cutPaths === 2, layOff.cutPaths);
    check('projection off: the artwork clipped to the faces alone', layOff.clipTriangles === tris, JSON.stringify(layOff));
    app.change('intakeProject', true);
    await until(app, () => /projected from their lids/.test(app.toast()), 600);
    check('projection on again: as before', text(app, 'statStretch') === on.stretch && text(app, 'statWorst') === on.worst && text(app, 'statIntakes') === '3');

    was = app.toast();
    app.click('suggestBtn');
    await until(app, () => app.toast() !== was && !app.$('busy').classList.contains('on'), 400);
    check('suggest seams, intakes covered: nothing to split', /^Nothing to suggest/.test(app.toast()) && app.$('suggestReview').hidden, app.toast());

    app.click('intakeClearBtn');
    await app.settle(2);
    check('clear: none projected, rim creases gone', text(app, 'statIntakes') === '0' && text(app, 'statCreases') === '0' &&
      app.toast() === '3 intakes cleared — the panels are flattened as they are. Undo cut brings them back.', text(app, 'statCreases') + ' | ' + app.toast());
    app.key('z', { ctrlKey: true });
    await app.settle(2);
    check('undo: back again, creases and all', text(app, 'statIntakes') === '3' && text(app, 'statCreases') === '3 lines');
    app.key('z', { ctrlKey: true });
    await app.settle(2);
    check('undo the accept: back to review', text(app, 'statIntakes') === '0' && !app.$('intakeReview').hidden && text(app, 'intakeTitle') === 'Intakes found (2)' && text(app, 'statCreases') === '0');
    app.click(app.$('intakeList').children[1].children[1]);
    check('tap a row: it is shown instead', app.$('intakeList').children[1].className === 'on' && app.$('intakeList').children[0].className === '');
    app.click(app.$('intakeList').children[0].children[2]);
    await app.settle(2);
    check('accept a row: the vents, both', text(app, 'statIntakes') === '2' && app.toast().indexOf('Intake and its mirror image accepted — their lids') === 0 && text(app, 'intakeTitle') === 'Intakes found (1)', app.toast());

    app.change('modelSel', 'car');
    await app.settle(3);
    check('car again: its own length back, intakes gone', String(app.$('realLen').value) === '4500' && text(app, 'statIntakes') === '0' && app.$('intakeReview').hidden, app.$('realLen').value);
    check('no errors in the session', app.errors.length === 0);
  }

  /* ---- 3. Intake mode: taps ---- */
  {
    const app = boot(PAGE);
    await app.settle(5);
    app.change('modelSel', 'bumper');
    await app.settle(3);
    const sc = bumperScene(app.THREE);
    check('screen: every target in view', [sc.vent, sc.grille, sc.plain].every(p => p && p[0] > 0 && p[0] < 1000 && p[1] > 0 && p[1] < 700), JSON.stringify([sc.vent, sc.grille, sc.plain]));

    // wrong mode: a tap on a vent in Draw mode is a seam point, not an intake
    app.click(app.modeButton('draw'));
    app.tap(sc.vent[0], sc.vent[1]);
    await app.settle(2);
    check('draw mode: a tap on a vent is a seam point', text(app, 'statIntakes') === '0' && /^Point <b>1<\/b> placed/.test(app.$('hud').innerHTML), app.$('hud').innerHTML.slice(0, 80));
    app.key('Escape');

    app.click(app.modeButton('intake'));
    check('intake mode: says what a tap does', /Tap an intake/.test(app.$('hud').innerHTML) && /its mirror image with it/.test(app.$('hud').innerHTML));
    app.tap(sc.plain[0], sc.plain[1]);
    await until(app, () => /No intake there/.test(app.toast()), 100);
    check('tap on plain bumper: no intake there', /^No intake there: the vinyl can lie on that spot/.test(app.toast()) && text(app, 'statIntakes') === '0', app.toast());
    app.tap(sc.vent[0], sc.vent[1]);
    await until(app, () => text(app, 'statIntakes') !== '0', 200);
    check('tap on a vent: it and its mirror image added', app.toast().indexOf('Intake and its mirror image added, 272 × 103 mm') === 0 && text(app, 'statIntakes') === '2', app.toast());
    app.tap(sc.grille[0], sc.grille[1]);
    await until(app, () => text(app, 'statIntakes') === '3', 200);
    check('tap on the grille\'s lip: it is added, on its own', app.toast().indexOf('Opening added, 600 × 150 mm') === 0 && text(app, 'statIntakes') === '3', app.toast());
    check('intake mode: lids counted in the hud', /3 projected, lids in cyan/.test(app.$('hud').innerHTML));
    app.tap(sc.vent[0], sc.vent[1]);
    await app.settle(2);
    check('tap on a projected vent: it and its mirror image taken away', /^Intake and its mirror image taken away/.test(app.toast()) && text(app, 'statIntakes') === '1', app.toast());
    app.key('z', { ctrlKey: true });
    await app.settle(2);
    check('undo: both back', text(app, 'statIntakes') === '3');
    // Mirror seams off: a tap takes one vent only
    app.change('mirrorOn', false);
    await app.settle(2);
    app.tap(sc.vent[0], sc.vent[1]);
    await app.settle(2);
    check('mirror off: one vent taken away', /^Intake taken away/.test(app.toast()) && text(app, 'statIntakes') === '2', app.toast());
    app.tap(sc.vent[0], sc.vent[1]);
    await until(app, () => text(app, 'statIntakes') === '3', 200);
    check('mirror off: one vent added back', app.toast().indexOf('Intake added, 272 × 103 mm') === 0, app.toast());
    app.change('mirrorOn', true);
    await app.settle(2);

    // a seam through the vents parts them from the panel: they are no longer
    // projected, and Undo cut brings them back
    app.click(app.modeButton('draw'));
    [sc.spot(0.395, 0.97), sc.spot(0.15, 0.97), sc.spot(-0.1, 0.97), sc.vent, sc.spot(-0.34, 0.97), sc.spot(-0.395, 0.97)].forEach(p => app.tap(p[0], p[1]));
    await app.settle(2);
    app.key('Enter');
    await app.settle(3);
    check('seam through the vents: cut, on both sides', /^Panel split, mirrored to both flanks/.test(app.toast()), app.toast() + ' | ' + app.$('hud').textContent);
    check('seam through the vents: no longer projected, and says so', text(app, 'statIntakes') === '1' &&
      /^2 intakes are no longer projected: a seam now parts them from the panel/.test(text(app, 'intakeNote')), text(app, 'statIntakes') + ' | ' + text(app, 'intakeNote'));
    app.key('z', { ctrlKey: true });
    await app.settle(2);
    check('undo cut: the vents projected again, the note gone', text(app, 'statIntakes') === '3' && text(app, 'intakeNote') === '', text(app, 'statIntakes') + ' | ' + text(app, 'intakeNote'));
    app.click(app.modeButton('intake'));

    // a panel not wrapped cannot be tapped
    app.click(app.modeButton('wrap'));
    app.tap(sc.plain[0], sc.plain[1]);
    await app.settle(2);
    app.click(app.modeButton('intake'));
    app.tap(sc.plain[0], sc.plain[1]);
    await app.settle(2);
    check('unwrapped panel: a tap says so', app.toast() === 'That panel is not wrapped — tick it in Panels first.', app.toast());
    check('no panel wrapped: Find intakes is off', app.$('intakeFindBtn').disabled);
    check('no errors in the session', app.errors.length === 0);
  }

  /* ---- 4. a model of your own: a plate with a pocket, opened as an .obj ---- */
  // Vertical walls, 40 mm deep: the case where the line on the model has to
  // be told which faces are projected, or it catches on the top of a wall.
  {
    const s = sheet({ W: 800, H: 600, holes: [{ u0: -100, u1: 100, v0: -50, v1: 50, depth: 40 }] });
    let obj = '# a plate with a pocket\n';
    for (let i = 0; i < s.pos.length; i += 3) obj += 'v ' + s.pos[i] + ' ' + s.pos[i + 1] + ' ' + s.pos[i + 2] + '\n';
    for (let i = 0; i < s.tris.length; i += 3) obj += 'f ' + (s.tris[i] + 1) + ' ' + (s.tris[i + 1] + 1) + ' ' + (s.tris[i + 2] + 1) + '\n';
    const w = PC.weld(s.pos, s.tris, 1e-6), m = PC.makeMesh(w.pos, w.tris);
    // as adoptMesh takes it: centred, the 800 mm side 3 units long
    const k = 3 / 800, P = m.pos;
    for (let i = 0; i < P.length; i += 3) P[i + 2] += 20;
    for (let i = 0; i < P.length; i++) P[i] *= k;
    const toMM = q => [q[0] / k, q[1] / k, q[2] / k - 20];

    const app = boot(PAGE);
    await app.settle(5);
    app.change('realLen', 800);
    app.open('pocket.obj', obj);
    await app.settle(3);
    check('pocket plate: opened', /^pocket\.obj loaded — [\d,]+ triangles, mirror plane found/.test(app.toast()), app.toast());
    app.click('intakeFindBtn');
    await until(app, () => !app.$('intakeReview').hidden, 200);
    check('pocket plate: found, true to size', /^1\. Intake 200 × 100 mm/.test(rows(app)[0] || '') && /40 mm deep · stretch ×2\.2 · symmetrical$/.test(rows(app)[0] || ''), rows(app).join(' / '));
    app.click('intakeAcceptAll');
    await app.settle(2);
    check('pocket plate: accepted', app.toast() === 'Intake accepted — its lid is laid over the opening. Unwrap again to project the artwork into it.', app.toast());
    async function unwrap() {
      const was = app.toast();
      app.click('unwrapBtn');
      await until(app, () => !app.$('retopoReview').hidden || (app.toast() !== was && /^Unwrapped/.test(app.toast())), 800);
      if (!app.$('retopoReview').hidden) { app.click('retopoSkipBtn'); await until(app, () => /^Unwrapped/.test(app.toast()), 800); }
    }
    await unwrap();
    check('pocket plate: unwrapped with its lid', app.toast() === 'Unwrapped 1 panel — 1 intake projected from its lid', app.toast());

    // a straight line across it, as in the geometry tier, drawn with two taps
    const { camera, scene } = app.shown(), THREE = app.THREE;
    const scr = q => { const v = new THREE.Vector3(q[0] * k, q[1] * k, (q[2] + 20) * k).project(camera); return [(v.x + 1) / 2 * 1000, (1 - v.y) / 2 * 700]; };
    const ends = [[-230, -20, 0], [230, 35, 0]];
    app.click(app.modeButton('vector'));
    ends.forEach(q => { const p = scr(q); app.tap(p[0], p[1]); });
    await app.settle(2);
    app.click('vecFinish');
    await app.settle(3);
    check('pocket plate: line drawn', /^Line finished/.test(app.toast()), app.toast());
    // the line as shown: each point lifted off its face along the face's
    // normal, so it is put back on the face whose lifted plane holds it
    const blue = new THREE.Color(0x2f6df6).convertSRGBToLinear();
    function shownLine() {
      const obj3 = scene.children.find(o => o.isLineSegments && o.renderOrder === 5 && o.material.color.equals(blue) && !o.material.transparent);
      const a = obj3.geometry.getAttribute('position').array, lift = 1.5 * Math.sqrt(3) * 0.0035, out = [];
      for (let i = 0; i < a.length; i += 3) {
        const q = [a[i], a[i + 1], a[i + 2]];
        let best = null;
        for (let f = 0; f < m.tris.length / 3; f++) {
          const A = 3 * m.tris[3 * f];
          if (Math.abs(P[A] - q[0]) > 0.06 || Math.abs(P[A + 1] - q[1]) > 0.06) continue;
          const n = PC.faceNormal(m, f);
          if (!(n[0] === n[0])) continue;
          const p = [q[0] - n[0] * lift, q[1] - n[1] * lift, q[2] - n[2] * lift];
          const off = Math.abs((p[0] - P[A]) * n[0] + (p[1] - P[A + 1]) * n[1] + (p[2] - P[A + 2]) * n[2]);
          if (!best || off < best.off) best = { off, p };
        }
        out.push(toMM(best.p));
      }
      return out;
    }
    function measure(pts) {
      // straight between the line's own ends (a node near the mirror plane snaps on to it)
      const a = pts[0], b = pts[pts.length - 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      let stray = 0, floor = 0;
      pts.forEach(q => {
        if (q[2] < -39.9) floor++;
        else stray = Math.max(stray, Math.abs((q[0] - a[0]) * (b[1] - a[1]) - (q[1] - a[1]) * (b[0] - a[0])) / L);
      });
      return { stray, floor, n: pts.length };
    }
    const lineOn = measure(shownLine()); if (process.env.TRACE) console.log('lineOn', JSON.stringify(lineOn));
    check('pocket plate: the line runs straight on the plate', lineOn.stray < 0.01 && lineOn.n > 20, JSON.stringify(lineOn));
    check('pocket plate: and drops onto the floor of the pocket', lineOn.floor >= 10, JSON.stringify(lineOn));
    app.click(app.modeButton('orbit'));
    app.change('intakeProject', false);
    await until(app, () => /^Unwrapped/.test(app.toast()) && !/projected/.test(app.toast()), 800);
    app.click(app.modeButton('pick'));
    app.click(app.modeButton('vector'));
    await app.settle(2);
    const lineOff = measure(shownLine()); if (process.env.TRACE) console.log('lineOff', JSON.stringify(lineOff));
    check('pocket plate, projection off: the line bends round the pocket (control)', lineOff.stray > 1, JSON.stringify(lineOff));
    check('no errors in the session', app.errors.length === 0);
  }

  L.done();
})().catch(e => { console.error('DOM tier crashed:', e); process.exitCode = 1; });
