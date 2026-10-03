'use strict';

// v20: an intake's lid is a taut film — held along the intake's edge and
// along any seam it runs to, pulled tight between — in place of a surface
// fitted round one closed rim. So an intake no longer has to be ringed by
// its panel: one a seam runs along, or through, is bridged all the same.
// The ball still says what an intake is: a hollow it can roll into is left
// to the vinyl.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', 'WrapaCar_v20.0.html'), 'utf8').replace(/\r\n/g, '\n');
function script(name) {
  const box = { module: { exports: {} } };
  vm.runInNewContext(html.match(new RegExp('<script>\\s*(\\/\\* ' + name + '[\\s\\S]*?)<\\/script>'))[1], box);
  return box.module.exports;
}
const PC = script('PanelCore'), VC = script('VectorCore');

function appFunction(name) {
  const start = html.search(new RegExp('\n  (?:async )?function ' + name + '\\('));
  assert.ok(start >= 0, 'App function exists: ' + name);
  return html.slice(start + 1, html.indexOf('\n  }\n', start + 1) + 4);
}

// the page's own test bumper, 1800 mm across: a vent in each lower corner
// with a floor 50 mm down, and a grille in the middle that goes right through
const bumperBody = new Function('PC', appFunction('bumperBody') + '\nreturn bumperBody;')(PC);
const BALL = { diameter: 300, minDepth: 5 };

function label(mesh) {
  const edgeMap = PC.buildEdgeMap(mesh);
  mesh.panel = Array.from(PC.computePanels(mesh, edgeMap).label);
  return edgeMap;
}

// A sheet in millimetres over [-half, half]², n cells a side, lying at
// height(x, y) and looking up; skip(x, y) leaves out the cell whose middle
// is there.
function sheet(half, n, height, skip) {
  const pos = [], tris = [], at = i => -half + 2 * half * i / n;
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) pos.push(at(i), at(j), height(at(i), at(j)));
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    if (skip && skip(at(i + 0.5), at(j + 0.5))) continue;
    const a = j * (n + 1) + i;
    tris.push(a, a + 1, a + n + 2, a, a + n + 2, a + n + 1);
  }
  const mesh = PC.makeMesh(pos, tris);
  return { mesh, edgeMap: label(mesh) };
}
// a pocket 120 mm square at its rim and 50 mm deep, its walls drawn in 10 mm
const pocket = (x, y) => Math.abs(x) <= 50 && Math.abs(y) <= 50 ? -50 : 0;

// the bumper with a seam down it where z = `z`
function bumperWithSeam(z) {
  const cut = PC.slicePlane(bumperBody(), 2, z, 1e-6), mesh = PC.makeMesh(cut.pos, cut.tris);
  PC.buildEdgeMap(mesh).forEach((faces, key) => {
    const [a, b] = key.split(':').map(Number);
    if (mesh.pos[3 * a + 2] === z && mesh.pos[3 * b + 2] === z) mesh.cut.add(key);
  });
  return { mesh, edgeMap: label(mesh) };
}

// a panel's faces as flattenIsland takes them, and where each face sits in them
function panelFaces(mesh, id) {
  const list = [];
  mesh.panel.forEach((p, f) => { if (p === id) list.push(f); });
  const tri = new Int32Array(3 * list.length), local = new Map(list.map((f, i) => [f, i]));
  list.forEach((f, i) => { for (let k = 0; k < 3; k++) tri[3 * i + k] = mesh.tris[3 * f + k]; });
  return { list, tri, local };
}
function underFilms(mesh, id, intakes) {
  const p = panelFaces(mesh, id);
  return PC.flattenFilm(mesh.pos, p.tri, intakes.filter(it => it.panel === id).map(it => (
    { faces: it.faces.map(f => p.local.get(f)), film: it.film })), {});
}

// what the page keeps of an intake, by its own intakeRecord
function record(mesh, it) {
  return new Function('S', 'var intakeSerial = 0;\n' + appFunction('intakeRecord') + '\nreturn intakeRecord;')({ mesh })(it);
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;

test('a film over a pocket is held at its rim and pulled flat across it', () => {
  const { mesh, edgeMap } = sheet(200, 40, pocket), found = PC.findIntakes(mesh, edgeMap, BALL);
  assert.equal(found.length, 1);
  const it = found[0], film = it.film, P = mesh.pos;
  assert.equal(it.through, false);
  assert.ok(near(it.depth, 50, 1e-3), 'the floor lies 50 mm under the film: ' + it.depth);
  assert.ok(near(it.width, 120, 1e-6) && near(it.length, 120, 1e-6), 'the opening is 120 mm square');
  assert.ok(film.normal[2] > 0.999, 'the film faces the way the sheet does');
  // the opening less two corners: there the grid's diagonal leaves half a cell on the sheet
  assert.ok(near(film.area, 120 * 120 - 100, 1e-3), 'the film is as big as the opening: ' + film.area);
  let own = 0;
  it.faces.forEach(f => { own += PC.faceArea(mesh, f); });
  assert.ok(near(it.stretch, own / film.area, 1e-9) && it.stretch > 2.2 && it.stretch < 2.3, 'stretch: floor and walls over the film: ' + it.stretch);
  let lifted = 0;
  film.verts.forEach((v, i) => {
    const moved = Math.hypot(film.pos[3 * i] - P[3 * v], film.pos[3 * i + 1] - P[3 * v + 1], film.pos[3 * i + 2] - P[3 * v + 2]);
    assert.equal(film.lifted[i] === 1, moved > 0, 'a vertex is lifted exactly when it has moved');
    // within the opening, on the plane of the rim
    assert.ok(Math.abs(film.pos[3 * i]) <= 60 + 1e-6 && Math.abs(film.pos[3 * i + 1]) <= 60 + 1e-6, 'the film stays within its rim');
    if (film.lifted[i]) { lifted++; assert.ok(Math.abs(film.pos[3 * i + 2]) < 1e-3, 'lifted to the rim\'s plane: ' + film.pos[3 * i + 2]); }
    else assert.ok(P[3 * v + 2] === 0, 'only the sheet round the pocket stays where it is');
  });
  assert.equal(lifted, 11 * 11, 'every vertex of the floor is lifted');
  it.rim.forEach(key => key.split(':').forEach(v => assert.equal(film.lifted[film.verts.indexOf(+v)], 0, 'the rim is held')));
  assert.equal(it.seam.length + it.open.length, 0);
});

test('a slit that parts no panel is no edge of a film', () => {
  // a floating seam across the pocket's floor, and one across its rim on to the sheet
  const { mesh, edgeMap } = sheet(200, 40, pocket), P = mesh.pos;
  edgeMap.forEach((faces, key) => {
    const [a, b] = key.split(':').map(Number), onLine = v => P[3 * v + 1] === 0 && P[3 * v] >= -30 && P[3 * v] <= 90;
    if (onLine(a) && onLine(b)) mesh.cut.add(key);
  });
  assert.ok(mesh.cut.size >= 12);
  assert.equal(new Set(PC.computePanels(mesh, edgeMap).label).size, 1, 'it splits nothing');
  const found = PC.findIntakes(mesh, edgeMap, BALL);
  assert.equal(found.length, 1, 'the pocket is one intake still, not a piece each side of the slit');
  assert.equal(found[0].seam.length, 0);
  assert.ok(near(found[0].depth, 50, 1e-3));
  assert.equal(found[0].film.lifted.reduce((n, x) => n + x, 0), 11 * 11, 'and its film is the one it would have without the slit');
});

test('a pocket round a boss has two rims and one film', () => {
  // the same pocket with a boss in its middle, standing 20 mm proud of the sheet
  const { mesh, edgeMap } = sheet(200, 40, (x, y) => Math.abs(x) <= 10 && Math.abs(y) <= 10 ? 20 : pocket(x, y));
  const found = PC.findIntakes(mesh, edgeMap, BALL);
  assert.equal(found.length, 1, 'the ring of floor round the boss is one intake');
  const film = found[0].film, P = mesh.pos;
  let top = -Infinity;
  film.verts.forEach((v, i) => {
    top = Math.max(top, film.pos[3 * i + 2]);
    assert.ok(film.pos[3 * i + 2] >= P[3 * v + 2] - 1e-9, 'the film never goes beneath the hollow');
    assert.ok(film.pos[3 * i + 2] >= -1e-3 && film.pos[3 * i + 2] <= 20 + 1e-9, 'it runs from the rim up to the boss');
  });
  assert.ok(near(top, 20, 1e-9), 'the film is held on the boss');
  assert.ok(found[0].depth > 50, 'and tents over the floor: ' + found[0].depth);
});

test('the bumper: both vents and the grille are found', () => {
  const mesh = bumperBody(), edgeMap = label(mesh), found = PC.findIntakes(mesh, edgeMap, BALL);
  assert.equal(found.length, 3);
  const vents = found.filter(it => !it.through), grille = found.filter(it => it.through);
  assert.equal(vents.length, 2);
  vents.forEach(it => {
    assert.ok(near(it.depth, 50, 1), 'a vent is 50 mm deep: ' + it.depth);
    assert.ok(near(it.stretch, 2, 0.1), 'and doubles the vinyl over it: ' + it.stretch);
    assert.equal(it.film.pos.length / 3, it.film.verts.length, 'a vent has a floor: no patch');
  });
  assert.ok(near(vents[0].centre[2], -vents[1].centre[2], 1e-6), 'one each side');
  assert.equal(grille.length, 1);
  assert.ok(grille[0].faces.length > 0 && grille[0].open.length > 0, 'the grille has a lip and an open far end');
  assert.ok(grille[0].film.pos.length / 3 > grille[0].film.verts.length, 'patched over');
  assert.ok(near(grille[0].depth, 70, 2), 'the lip turns in 70 mm: ' + grille[0].depth);
  // the patch is pulled up to the opening: none of it is left down at the lip's far end
  const film = grille[0].film, P = mesh.pos, end = new Set();
  grille[0].open.forEach(key => key.split(':').forEach(v => end.add(+v)));
  let gap = Infinity;
  for (let i = film.verts.length; i < film.pos.length / 3; i++) end.forEach(v => {
    gap = Math.min(gap, Math.hypot(film.pos[3 * i] - P[3 * v], film.pos[3 * i + 1] - P[3 * v + 1], film.pos[3 * i + 2] - P[3 * v + 2]));
  });
  assert.ok(gap > 50, 'the patch lies across the opening, not 70 mm down it: ' + gap);
  film.verts.forEach((v, i) => { if (end.has(v)) assert.equal(film.lifted[i], 1, 'and the far end of the lip comes up with it'); });
});

test('a vent a seam runs along is still an intake, its film held along the seam', () => {
  // the left vent spans z = -702 .. -468: the seam lies on its outer rim
  const { mesh, edgeMap } = bumperWithSeam(-702), found = PC.findIntakes(mesh, edgeMap, BALL);
  assert.equal(found.length, 3);
  const vent = found.filter(it => !it.through && it.centre[2] < 0)[0];
  assert.ok(vent.seam.length > 0 && vent.rim.length > 0, 'its edge is part rim, part seam');
  vent.seam.forEach(key => assert.ok(mesh.cut.has(key)));
  assert.ok(near(vent.depth, 50, 1), 'as deep as ever: ' + vent.depth);
  const island = underFilms(mesh, vent.panel, found), asIs = PC.flattenIsland(mesh.pos, panelFaces(mesh, vent.panel).tri, {});
  assert.ok(island.distortion.worst < asIs.distortion.worst - 0.2, 'and its panel flattens far better under the films');
});

test('a vent a seam runs through is an intake on each side of it', () => {
  const { mesh, edgeMap } = bumperWithSeam(-585), found = PC.findIntakes(mesh, edgeMap, BALL);
  const halves = found.filter(it => !it.through && it.centre[2] < 0);
  assert.equal(found.length, 4);
  assert.equal(halves.length, 2);
  assert.notEqual(halves[0].panel, halves[1].panel);
  halves.forEach(it => {
    assert.ok(it.seam.length > 0, 'held along the seam');
    assert.ok(it.depth > 45, 'bridged nearly as deep as the whole vent: ' + it.depth);
    const film = it.film, held = new Set();
    it.seam.concat(it.rim).forEach(key => key.split(':').forEach(v => held.add(+v)));
    film.verts.forEach((v, i) => { if (held.has(v)) assert.equal(film.lifted[i], 0, 'the seam and the rim stay exactly where they are'); });
  });
});

test('a gentle hollow the ball can roll into is left to the vinyl', () => {
  // a cove 100 mm wide and 8 mm deep, and beside it a slot 30 mm wide and 40 mm deep
  const cove = x => Math.abs(x) < 50 ? -8 * Math.pow(Math.cos(Math.PI * x / 100), 2) : 0;
  const gentle = sheet(300, 120, x => cove(x));
  assert.equal(PC.findIntakes(gentle.mesh, gentle.edgeMap, BALL).length, 0, 'the cove alone is no intake');
  const both = sheet(300, 120, (x, y) => x >= 150 && x <= 180 && Math.abs(y) <= 100 ? -40 : cove(x));
  const found = PC.findIntakes(both.mesh, both.edgeMap, BALL);
  assert.equal(found.length, 1, 'the slot is');
  assert.ok(found[0].centre[0] > 140 && found[0].centre[0] < 190);
  // flattened under its film the sheet keeps the cove's true length: only the slot is bridged
  const island = underFilms(both.mesh, 0, found), wide = Math.max(island.w, island.h);
  assert.ok(wide > 600.5, 'the cove is followed, not bridged: ' + wide);
});

test('a panel flattened under its film keeps its shape, and the vent lands inside its own rim', () => {
  const { mesh, edgeMap } = bumperWithSeam(-300.5), found = PC.findIntakes(mesh, edgeMap, BALL);
  const vent = found.filter(it => !it.through && it.centre[2] < 0)[0], p = panelFaces(mesh, vent.panel);
  const island = underFilms(mesh, vent.panel, found), asIs = PC.flattenIsland(mesh.pos, p.tri, {});
  ['U', 'F', 'global', 'nf', 'nv', 'w', 'h', 'area3', 'distortion', 'cover', 'projected'].forEach(k => assert.ok(k in island, 'an island has ' + k));
  assert.equal(island.nf, p.list.length);
  assert.ok(island.distortion.worst < 1.06, 'nearly true to shape: ' + island.distortion.worst);
  assert.ok(asIs.distortion.worst > 1.3, 'where the panel as it is crushes the vent: ' + asIs.distortion.worst);
  assert.ok(island.projected > 100, 'the vent takes its place from the film');
  assert.ok(island.cover.F.length >= 3 * vent.faces.length * 0.9, 'and the film covers it in the layout');
  // every vertex of the vent lies within its rim in the layout
  const where = new Map(island.global.map((g, i) => [g, i])), box = [Infinity, Infinity, -Infinity, -Infinity];
  vent.rim.forEach(key => key.split(':').forEach(v => {
    const i = where.get(+v);
    box[0] = Math.min(box[0], island.U[2 * i]); box[1] = Math.min(box[1], island.U[2 * i + 1]);
    box[2] = Math.max(box[2], island.U[2 * i]); box[3] = Math.max(box[3], island.U[2 * i + 1]);
  }));
  vent.faces.forEach(f => {
    for (let k = 0; k < 3; k++) {
      const i = where.get(mesh.tris[3 * f + k]), u = island.U[2 * i], v = island.U[2 * i + 1];
      assert.ok(u >= box[0] - 1e-6 && u <= box[2] + 1e-6 && v >= box[1] - 1e-6 && v <= box[3] + 1e-6, 'inside the rim');
    }
  });
  // with no films it is flattenIsland's layout
  const plain = PC.flattenFilm(mesh.pos, p.tri, [], {});
  assert.deepEqual(Array.from(plain.U), Array.from(asIs.U));
  assert.equal(plain.cover.F.length, 0);
});

test('an intake is found again after a seam is cut through it, a part in each panel', () => {
  const mesh = bumperBody(), edgeMap = label(mesh), found = PC.findIntakes(mesh, edgeMap, BALL);
  const vent = found.filter(it => !it.through && it.centre[2] < 0)[0], rec = record(mesh, vent);
  assert.equal(rec.bounds.length, 6 * (vent.rim.length + vent.seam.length + vent.open.length), 'the record keeps its edge as segments');
  const same = PC.resolveIntake(mesh, edgeMap, rec);
  assert.equal(same.parts.length, 1);
  assert.deepEqual(same.faces.slice().sort((a, b) => a - b), vent.faces.slice().sort((a, b) => a - b), 'on the same mesh, the same faces');
  assert.equal(same.rimKeys.size, vent.rim.length);
  // now a seam straight through it
  const cut = bumperWithSeam(-585), after = PC.resolveIntake(cut.mesh, cut.edgeMap, rec);
  assert.ok(after, 'it is not lost');
  assert.equal(after.parts.length, 2);
  assert.notEqual(after.parts[0].panel, after.parts[1].panel);
  let area = 0;
  after.faces.forEach(f => { area += PC.faceArea(cut.mesh, f); });
  assert.ok(near(area, rec.area, 1e-6 * rec.area), 'all of it, and no more');
  after.parts.forEach(part => {
    assert.ok(part.film.seam.length > 0 && part.film.depth > 45, 'each part bridged, held along the seam');
    part.faces.forEach(f => assert.equal(cut.mesh.panel[f], part.panel));
  });
  // an intake that is no longer there is lost
  const flat = sheet(1000, 20, () => 0);
  assert.equal(PC.resolveIntake(flat.mesh, flat.edgeMap, rec), null);
});

test('a plain hole is patched over, and found again', () => {
  const { mesh, edgeMap } = sheet(200, 40, () => 0, (x, y) => Math.abs(x) < 40 && Math.abs(y) < 30);
  const found = PC.findIntakes(mesh, edgeMap, BALL);
  assert.equal(found.length, 1);
  const hole = found[0];
  assert.ok(hole.through && !hole.faces.length, 'a hole: no faces of its own');
  assert.equal(hole.open.length, 2 * (8 + 6), 'its border is what it leaves open');
  assert.ok(near(hole.width, 60, 1e-6) && near(hole.length, 80, 1e-6));
  assert.ok(near(hole.lidArea, 80 * 60, 1e-6), 'the patch fills it: ' + hole.lidArea);
  assert.ok(hole.film.normal[2] > 0.999, 'and faces the way the sheet does');
  const rec = record(mesh, hole), again = PC.resolveIntake(mesh, edgeMap, rec);
  assert.equal(rec.seed, null);
  assert.equal(again.parts.length, 1);
  assert.equal(again.parts[0].faces.length, 0);
  assert.equal(again.open.length, hole.open.length);
  // the sheet flattened under it has the patch for cover, and its own layout untouched
  const p = panelFaces(mesh, 0), island = PC.flattenFilm(mesh.pos, p.tri, [{ faces: [], film: again.parts[0].film }], {});
  assert.ok(island.cover.F.length > 0);
  assert.equal(island.projected, 0);
  assert.ok(island.distortion.worst < 1.001);
});

// The bumper's panels unwrapped under their films, islands side by side, as
// the vector code takes a model.
function artModel(mesh, edgeMap, intakes) {
  const nT = mesh.tris.length / 3, uv = new Float64Array(6 * nT), projected = new Uint8Array(nT), islands = new Map(), index = new Map();
  let shift = 0;
  Array.from(new Set(mesh.panel)).forEach((id, n) => {
    const p = panelFaces(mesh, id), island = underFilms(mesh, id, intakes);
    p.list.forEach((f, j) => {
      for (let c = 0; c < 3; c++) {
        uv[6 * f + 2 * c] = shift + island.U[2 * island.F[3 * j + c]];
        uv[6 * f + 2 * c + 1] = island.U[2 * island.F[3 * j + c] + 1];
      }
    });
    islands.set(id, p.list); index.set(id, n); shift += island.w + 100;
  });
  intakes.forEach(it => it.faces.forEach(f => { projected[f] = 1; }));
  return { pos: mesh.pos, tris: mesh.tris, edgeMap, uv, panel: mesh.panel, islands, index, locate: PC.faceLocator(mesh).closest,
    scale: 1, edge: 12, projected, flatten: PC.flattenIsland };
}
// a point on the bumper's skin, as the page's bumperBody lays it out
const onBumper = (s, t) => [-350 * Math.pow(Math.abs(s), 2.2) - 70 * t * t - 25 * t, 240 * t, 900 * s];

test('a line drawn across a vent runs down into it unbroken, and no less straight for the vent', () => {
  // with nothing near the vent, with a seam along its rim, and with one through it
  for (const [z, from, to] of [[null, -0.9, -0.45], [-702, -0.76, -0.45], [-585, -0.9, -0.66]]) {
    let mesh, edgeMap;
    if (z === null) { mesh = bumperBody(); edgeMap = label(mesh); } else ({ mesh, edgeMap } = bumperWithSeam(z));
    const found = PC.findIntakes(mesh, edgeMap, BALL), model = artModel(mesh, edgeMap, found);
    const vents = found.filter(it => !it.through && it.centre[2] < 0), n = vents[0].film.normal;
    // how far a line strays from straight, seen square to the vent's film
    const strays = t => {
      const d = VC.derive(model, { nodes: [{ p: onBumper(from, t), hin: null, hout: null }, { p: onBumper(to, t), hin: null, hout: null }], closed: false }, {});
      const s = d.stretches[0], pts = [];
      assert.equal(d.samples.breaks, 0, 'no break in it');
      assert.ok(s.tr.complete && !s.stray, 'it reaches its end, the way it was drawn');
      for (let k = 0; k < s.tr.faces.length; k++) if (s.tr.faces[k] >= 0) pts.push([s.tr.pts[3 * k], s.tr.pts[3 * k + 1], s.tr.pts[3 * k + 2], s.tr.faces[k]]);
      const flat = p => { const h = p[0] * n[0] + p[1] * n[1] + p[2] * n[2]; return [p[0] - h * n[0], p[1] - h * n[1], p[2] - h * n[2]]; };
      const a = flat(pts[0]), b = flat(pts[pts.length - 1]), ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ll = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
      let off = 0, deep = 0;
      pts.forEach(p => {
        const q = flat(p), w = [q[0] - a[0], q[1] - a[1], q[2] - a[2]], u = (w[0] * ab[0] + w[1] * ab[1] + w[2] * ab[2]) / ll;
        off = Math.max(off, Math.hypot(w[0] - u * ab[0], w[1] - u * ab[1], w[2] - u * ab[2]));
        if (model.projected[p[3]]) deep = Math.max(deep, Math.min(...vents.map(v => v.film.locate([p[0], p[1], p[2]]).d)));
      });
      return { off, deep, unfolded: s.unfolded };
    };
    const across = strays(-0.54), beside = strays(-0.2);
    assert.equal(across.unfolded, false, 'across the vent, the line comes from the panel\'s layout under the film');
    assert.ok(across.deep > 45, 'and runs over the vent\'s floor: ' + across.deep);
    assert.equal(beside.deep, 0);
    // The bumper's own curve bows any line a little; the vent adds next to
    // nothing. (A seam through the vent holds the film down on the floor
    // there, so the film is a ramp and has no one way to be seen square.)
    if (z !== -585) assert.ok(across.off < beside.off + 2.5, 'as straight as a line beside the vent: ' + across.off + ' against ' + beside.off);
  }
});

// one stretch, from a to b
const drawn = (model, a, b) => VC.derive(model, { nodes: [{ p: a, hin: null, hout: null }, { p: b, hin: null, hout: null }], closed: false }, {});
// how far the samples of one line lie from another line, at most
function apart(P, Q) {
  let worst = 0;
  for (let i = 0; i < P.length; i += 3) {
    let best = Infinity;
    for (let j = 0; j + 3 < Q.length; j += 3) {
      const e = [Q[j + 3] - Q[j], Q[j + 4] - Q[j + 1], Q[j + 5] - Q[j + 2]], w = [P[i] - Q[j], P[i + 1] - Q[j + 1], P[i + 2] - Q[j + 2]];
      const ee = e[0] * e[0] + e[1] * e[1] + e[2] * e[2], t = ee > 0 ? Math.max(0, Math.min(1, (w[0] * e[0] + w[1] * e[1] + w[2] * e[2]) / ee)) : 0;
      best = Math.min(best, Math.hypot(w[0] - t * e[0], w[1] - t * e[1], w[2] - t * e[2]));
    }
    worst = Math.max(worst, best);
  }
  return worst;
}

test('a line between a vent and the next panel runs straight, drawn from either node', () => {
  // A flat sheet, so that seen from above the line wanted is the straight one
  // between its nodes; the seam beside the vent, then along its rim.
  for (const x of [100, 60]) {
    const { mesh } = sheet(180, 36, pocket);
    PC.buildEdgeMap(mesh).forEach((faces, key) => {
      const [a, b] = key.split(':').map(Number);
      if (mesh.pos[3 * a] === x && mesh.pos[3 * b] === x) mesh.cut.add(key);
    });
    const edgeMap = label(mesh), found = PC.findIntakes(mesh, edgeMap, BALL), model = artModel(mesh, edgeMap, found);
    assert.equal(new Set(mesh.panel).size, 2);
    assert.equal(found.length, 1, 'the vent, whole, in one panel');
    const inVent = [-12.3, -8.7, -50];
    // straight across the vent's wall, and aslant: through its side wall and through its top one
    for (const to of [[133.7, 4.1, 0], [141.9, 96.4, 0], [118.2, 151.3, 0]]) {
      assert.notEqual(mesh.panel[model.locate(to).tri], mesh.panel[model.locate(inVent).tri], 'the far node is on the next panel');
      const lines = [drawn(model, inVent, to), drawn(model, to, inVent)];
      lines.forEach((d, back) => {
        const from = back ? 'from the next panel' : 'from the vent';
        assert.ok(d && d.samples.breaks === 0 && d.stretches[0].tr.complete, from + ', the line is whole');
        assert.equal(d.stretches[0].unfolded, false, from + ', it is drawn in the panels\' layouts, under the film');
        const P = d.samples.pts, ab = [to[0] - inVent[0], to[1] - inVent[1]], L = Math.hypot(ab[0], ab[1]);
        let off = 0, deep = 0;
        for (let i = 0; i < P.length; i += 3) {
          off = Math.max(off, Math.abs((P[i] - inVent[0]) * ab[1] - (P[i + 1] - inVent[1]) * ab[0]) / L);
          deep = Math.min(deep, P[i + 2]);
        }
        assert.ok(off < 0.5, from + ', it is straight seen from above: ' + off + ' mm off, to ' + to);
        assert.ok(deep < -49, 'and runs down on to the vent\'s floor');
      });
      assert.ok(apart(lines[0].samples.pts, lines[1].samples.pts) < 0.5 && apart(lines[1].samples.pts, lines[0].samples.pts) < 0.5, 'the same line either way');
    }
  }
});

// a point 50 mm in from the bumper's skin: on the floor of a vent there
function underBumper(s, t) {
  const e = 1e-5, X = (u, v) => onBumper(u, v)[0], ds = [X(s + e, t) - X(s - e, t), 0, 1800 * e], dt = [X(s, t + e) - X(s, t - e), 480 * e, 0];
  const n = [dt[1] * ds[2] - dt[2] * ds[1], dt[2] * ds[0] - dt[0] * ds[2], dt[0] * ds[1] - dt[1] * ds[0]], l = Math.hypot(n[0], n[1], n[2]), p = onBumper(s, t);
  return [p[0] - 50 * n[0] / l, p[1] - 50 * n[1] / l, p[2] - 50 * n[2] / l];
}

test('on the bumper, a line from a vent\'s floor to the next panel takes the panels\' layouts, joined at the seam', () => {
  const { mesh, edgeMap } = bumperWithSeam(-420), found = PC.findIntakes(mesh, edgeMap, BALL), model = artModel(mesh, edgeMap, found);
  // straight across, and aslant both ways: each drawn from the vent and from the next panel
  for (const [from, to] of [[[-0.65, -0.54], [-0.3, -0.54]], [[-0.6, -0.6], [-0.38, 0.35]], [[-0.7, -0.45], [-0.2, -0.9]]]) {
    const a = underBumper(from[0], from[1]), b = onBumper(to[0], to[1]);
    assert.ok(model.projected[model.locate(a).tri], 'the first node is in the vent');
    assert.notEqual(mesh.panel[model.locate(a).tri], mesh.panel[model.locate(b).tri], 'the other on the next panel');
    const lines = [drawn(model, a, b), drawn(model, b, a)];
    lines.forEach((d, back) => {
      assert.ok(d && d.samples.breaks === 0 && d.stretches[0].tr.complete && !d.stretches[0].stray, 'the line is whole' + (back ? ', drawn back' : ''));
      assert.equal(d.stretches[0].unfolded, false, 'and comes from the layouts' + (back ? ', drawn back' : '') + ': to ' + to);
      assert.deepEqual(Array.from(new Set(Array.from(d.samples.faces).map(f => mesh.panel[f]))).sort(), [0, 1], 'over both panels');
    });
    // either node's panel may lead: the layouts are joined the same
    const gap = Math.max(apart(lines[0].samples.pts, lines[1].samples.pts), apart(lines[1].samples.pts, lines[0].samples.pts));
    assert.ok(gap < 1.5, 'the same line either way, near enough: ' + gap + ' mm');
  }
});

test('across a seam through a vent, where the two films do not agree, a line is left to the surface unfolded', () => {
  const { mesh, edgeMap } = bumperWithSeam(-585), found = PC.findIntakes(mesh, edgeMap, BALL), model = artModel(mesh, edgeMap, found);
  const a = underBumper(-0.7, -0.54), b = underBumper(-0.58, -0.45), out = onBumper(-0.3, -0.54);
  assert.ok(model.projected[model.locate(a).tri] && model.projected[model.locate(b).tri], 'two nodes on the vent\'s floor');
  assert.notEqual(mesh.panel[model.locate(a).tri], mesh.panel[model.locate(b).tri], 'either side of the seam');
  for (const [p, q] of [[a, b], [b, a], [a, out], [out, a]]) {
    const d = drawn(model, p, q);
    assert.ok(d && d.samples.breaks === 0 && d.stretches[0].tr.complete, 'the line is whole');
    assert.equal(d.stretches[0].unfolded, true, 'unfolded from its first face');
  }
});

test('suggested seams take a panel as it lies under its films', () => {
  const mesh = bumperBody(), edgeMap = label(mesh), found = PC.findIntakes(mesh, edgeMap, BALL);
  const covered = found.map(it => ({ faces: it.faces, open: it.film.open, film: it.film }));
  const opts = { unit: 1, width: 1340, bleed: 10 };
  const bare = PC.suggestSplits(mesh, edgeMap, opts), under = PC.suggestSplits(mesh, edgeMap, Object.assign({ intakes: covered }, opts));
  assert.ok(Array.isArray(bare) && Array.isArray(under));
  // no seam is proposed through a covered opening
  const inside = new Set();
  found.forEach(it => it.faces.forEach(f => inside.add(f)));
  const loc = PC.faceLocator(mesh);
  under.forEach(sg => sg.paths.forEach(path => path.points.forEach(p => assert.ok(!inside.has(loc.closest(p).tri), 'a seam keeps clear of the intakes'))));
});

test('an intake across the mirror plane, parted by a seam along it, mirrors itself', () => {
  const intakesMirror = new Function(appFunction('intakesMirror') + '\nreturn intakesMirror;')();
  const grille = { id: 1, self: true, twin: -1 }, left = { id: 2, self: false, twin: 3 }, right = { id: 3, self: false, twin: 2 };
  const by = new Map([[10, [{ rec: grille }, { rec: left }]], [11, [{ rec: right }, { rec: grille }]], [12, [{ rec: left }]]]);
  assert.equal(intakesMirror(10, 11, by), true, 'the grille\'s two parts and the paired vents');
  assert.equal(intakesMirror(12, 11, by), false, 'a panel with fewer intakes than its twin');
  assert.equal(intakesMirror(12, 13, by), false);
  assert.equal(intakesMirror(13, 14, by), true, 'two panels with none');
});

test('the projected intakes are taken panel by panel, a part at a time', () => {
  const parts = [{ panel: 4, faces: [1, 2], film: { open: ['7:8'] } }, { panel: 5, faces: [3], film: { open: [] } }];
  const rec = { id: 1 }, S = { intakes: [rec], excludedPanels: new Set(), mesh: { tris: new Array(12) } };
  const make = new Function('S', 'projecting', 'intakeOn', appFunction('intakesByPanel') + '\n' + appFunction('projectedFaces') + '\n' +
    appFunction('coveredIntakes') + '\nreturn { intakesByPanel: intakesByPanel, projectedFaces: projectedFaces, coveredIntakes: coveredIntakes };');
  let on = true;
  const app = make(S, () => on, r => (r === rec ? { parts } : null));
  assert.deepEqual(Array.from(app.intakesByPanel().keys()), [4, 5]);
  assert.deepEqual(Array.from(app.projectedFaces()), [0, 1, 1, 1]);
  assert.deepEqual(app.coveredIntakes().map(c => c.faces), [[1, 2], [3]]);
  // a part in a panel that is not wrapped is left out
  S.excludedPanels.add(5);
  assert.deepEqual(Array.from(app.intakesByPanel().keys()), [4]);
  assert.deepEqual(Array.from(app.projectedFaces()), [0, 1, 1, 0]);
  // and with projection off there are none
  on = false;
  assert.equal(app.intakesByPanel().size, 0);
  assert.equal(app.projectedFaces(), null);
  assert.equal(app.coveredIntakes(), undefined);
});
