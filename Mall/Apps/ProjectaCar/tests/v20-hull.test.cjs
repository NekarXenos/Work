'use strict';

// v20: artwork can be drawn on a hull round the vehicle — the convex hull of
// the wrapped panels, a smooth skin with no vent or seam to bend a line —
// and is cast straight in on to the body: each point of the body takes the
// artwork of the hull's nearest point. The panels are flattened as before
// (under their films, where intakes are accepted); only where the artwork
// falls on them is the hull's doing.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', 'WrapaCar_v20.0.html'), 'utf8').replace(/\r\n/g, '\n');
// Loaded into this context rather than a vm sandbox, where every Math call is slow.
function script(name) {
  const mod = { exports: {} };
  new Function('module', html.match(new RegExp('<script>\\s*(\\/\\* ' + name + '[\\s\\S]*?)<\\/script>'))[1])(mod);
  return mod.exports;
}
const PC = script('PanelCore'), VC = script('VectorCore');

function appFunction(name) {
  const start = html.search(new RegExp('\n  (?:async )?function ' + name + '\\('));
  assert.ok(start >= 0, 'App function exists: ' + name);
  return html.slice(start + 1, html.indexOf('\n  }\n', start + 1) + 4);
}
const bumperBody = new Function('PC', appFunction('bumperBody') + '\nreturn bumperBody;')(PC);

// The page's test bumper (millimetres), one panel, unwrapped under the films
// over its vents and grille, with its hull: the two models the page keeps.
function bumper() {
  const mesh = bumperBody(), edgeMap = PC.buildEdgeMap(mesh), nT = mesh.tris.length / 3;
  mesh.panel = Array.from(PC.computePanels(mesh, edgeMap).label);
  const found = PC.findIntakes(mesh, edgeMap, { diameter: 300, minDepth: 5 });
  const island = PC.flattenFilm(mesh.pos, Int32Array.from(mesh.tris), found.map(it => ({ faces: it.faces, film: it.film })), {});
  const uv = new Float64Array(6 * nT), all = Array.from({ length: nT }, (_, i) => i);
  for (let f = 0; f < nT; f++) for (let c = 0; c < 3; c++) { uv[6 * f + 2 * c] = island.U[2 * island.F[3 * f + c]]; uv[6 * f + 2 * c + 1] = island.U[2 * island.F[3 * f + c] + 1]; }
  const body = { pos: mesh.pos, tris: mesh.tris, edgeMap, uv, panel: mesh.panel, islands: new Map([[0, all]]), index: new Map([[0, 0]]),
    locate: PC.faceLocator(mesh).closest, scale: 1, edge: 12, projected: null, flatten: PC.flattenIsland };
  const h = PC.convexHull(mesh.pos, Array.from(new Set(mesh.tris))), hm = PC.makeMesh(Float64Array.from(h.pos), Int32Array.from(h.tris));
  const onHull = { pos: hm.pos, tris: hm.tris, edgeMap: PC.buildEdgeMap(hm), uv: new Float64Array(2 * hm.tris.length), panel: hm.panel, islands: new Map(), index: new Map(),
    locate: PC.faceLocator(hm).closest, scale: 1, edge: 12, projected: null, flatten: PC.flattenIsland };
  const hull = { pos: hm.pos, tris: hm.tris, nearest: PC.nearestFace(hm.pos, hm.tris) };
  return { mesh, found, body, onHull, hull, hm };
}
// a point of the bumper's skin as bumperBody lays it out, and the hull's node nearest it
const skin = (s, t) => [-350 * Math.pow(Math.abs(s), 2.2) - 70 * t * t - 25 * t, 240 * t, 900 * s];
function hullPoint(hull, tri, bary) {
  const p = [0, 0, 0];
  for (let c = 0; c < 3; c++) for (let j = 0; j < 3; j++) p[j] += bary[c] * hull.pos[3 * hull.tris[3 * tri + c] + j];
  return p;
}
const nodeOn = (b, s, t) => { const h = b.hull.nearest(skin(s, t)); return { p: hullPoint(b.hull, h.tri, h.bary), hin: null, hout: null }; };

test('the hull of a model is closed, convex, and passes through its outermost points', () => {
  const mesh = bumperBody(), verts = Array.from(new Set(mesh.tris)), hull = PC.convexHull(mesh.pos, verts);
  const H = hull.pos, T = hull.tris, edges = new Map();
  assert.ok(T.length / 3 > 1000);
  let worst = 0, volume = 0;
  for (let f = 0; f < T.length / 3; f++) {
    const a = [0, 1, 2].map(k => H[3 * T[3 * f] + k]), b = [0, 1, 2].map(k => H[3 * T[3 * f + 1] + k] - a[k]), c = [0, 1, 2].map(k => H[3 * T[3 * f + 2] + k] - a[k]);
    const n = [b[1] * c[2] - b[2] * c[1], b[2] * c[0] - b[0] * c[2], b[0] * c[1] - b[1] * c[0]], l = Math.hypot(...n);
    volume += (a[0] * n[0] + a[1] * n[1] + a[2] * n[2]) / 6;
    for (let k = 0; k < 3; k++) { const key = T[3 * f + k] + '>' + T[3 * f + (k + 1) % 3]; edges.set(key, (edges.get(key) || 0) + 1); }
    if (l > 0) for (const v of verts) worst = Math.max(worst, ((mesh.pos[3 * v] - a[0]) * n[0] + (mesh.pos[3 * v + 1] - a[1]) * n[1] + (mesh.pos[3 * v + 2] - a[2]) * n[2]) / l);
  }
  edges.forEach((n, key) => { const [x, y] = key.split('>'); assert.equal(n, 1); assert.equal(edges.get(y + '>' + x), 1, 'every edge is shared by two faces, wound against each other'); });
  assert.ok(worst < 1e-6, 'no point of the model lies outside a face of it: ' + worst);
  assert.ok(volume > 0, 'and it looks outward');
  hull.ids.forEach((v, i) => { for (let k = 0; k < 3; k++) assert.equal(H[3 * i + k], mesh.pos[3 * v + k], 'its vertices are the model\'s own'); });
  // points all in one plane have none
  assert.equal(PC.convexHull([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0, 0.3, 0.6, 0], [0, 1, 2, 3, 4]), null);
});

test('a line drawn on the hull runs straight over the vent the body has beneath it', () => {
  const b = bumper(), vent = b.found.filter(it => !it.through && it.centre[2] < 0)[0];
  // from the skin left of the vent to the skin right of it, across the vent's opening
  const line = { nodes: [nodeOn(b, -0.9, -0.54), nodeOn(b, -0.45, -0.54)], closed: false };
  const d = VC.derive(b.onHull, line, { live: true });
  assert.ok(d && d.samples.breaks === 0, 'it is traced on the hull');
  // over the opening the hull is flat, so the line there is one straight stretch
  const pts = [];
  for (let k = 0; k < d.samples.faces.length; k++) pts.push([d.samples.pts[3 * k], d.samples.pts[3 * k + 1], d.samples.pts[3 * k + 2]]);
  let over = 0;
  pts.forEach(p => { if (vent.film.locate(p).d < 1 && p[2] > -702 + 20 && p[2] < -468 - 20) over++; });
  assert.ok(over > 3, 'it passes over the vent: ' + over);
  // and a node in the middle of the opening is as good a place to start as any
  const mid = b.hull.nearest(vent.centre), fromVent = { nodes: [{ p: hullPoint(b.hull, mid.tri, mid.bary), hin: null, hout: null }, nodeOn(b, -0.2, 0.6)], closed: false };
  assert.ok(VC.derive(b.onHull, fromVent, { live: true }), 'a line from over the vent to the far skin');
});

test('a shape on the hull is cast on to the body: each point takes the ink of its nearest hull point', () => {
  const b = bumper(), P = b.mesh.pos, T = b.mesh.tris, vent = new Set(b.found.filter(it => !it.through && it.centre[2] < 0)[0].faces);
  const shape = { nodes: [nodeOn(b, -0.9, -0.8), nodeOn(b, -0.45, -0.7), nodeOn(b, -0.5, -0.1), nodeOn(b, -0.85, -0.25)], closed: true, fill: [0, 100, 0, 0], stroke: [0, 0, 0, 100], width: 6 };
  const d = VC.derive(b.onHull, shape, { reach: 3 });
  assert.ok(d && d.inside.size > 100);
  const pieces = VC.castArt(b.body, b.hull, d, shape, { half: 3, cell: 2.5, tol: 0.05 });
  assert.equal(pieces.length, 1);
  const e = pieces[0], whole = new Set(e.faces), parts = new Map();
  e.edge.forEach(pc => { (parts.get(pc.face) || parts.set(pc.face, []).get(pc.face)).push(pc.poly); assert.ok(VC.polyArea(pc.poly) > 0, 'parts are anticlockwise'); });
  assert.ok(e.faces.length > 300 && e.edge.length > 100 && e.strokePieces.length > 100);
  assert.ok(e.faces.filter(f => vent.has(f)).length > 100, 'the vent\'s floor and walls are inked with the rest');
  const near = VC.lineNear(d.samples.pts, d.samples.faces, f => PC.faceNormal(b.hm, f), 40, true);
  // points all over that part of the body, against the hull
  let seed = 3, tried = 0, wrong = 0, inVent = 0;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let n = 0; n < 120000; n++) {
    const f = Math.floor(rnd() * T.length / 3);
    if (!(P[3 * T[3 * f] + 2] < -350 && P[3 * T[3 * f] + 2] > -850)) continue;
    let u = rnd(), v = rnd();
    if (u + v > 1) { u = 1 - u; v = 1 - v; }
    const w = [1 - u - v, u, v], q = [0, 0, 0];
    for (let c = 0; c < 3; c++) for (let j = 0; j < 3; j++) q[j] += w[c] * P[3 * T[3 * f + c] + j];
    const h = b.hull.nearest(q), hp = hullPoint(b.hull, h.tri, h.bary), ln = near(hp[0], hp[1], hp[2]);
    if (ln && ln.d < 0.15) continue;   // on the line itself, to within the tolerance
    let truth = d.inside.has(h.tri);
    if (!truth && d.fillCuts.cut.has(h.tri)) {
      let wind = 0;
      d.fillCuts.cut.get(h.tri).forEach(poly => { const flat = []; poly.forEach(c => flat.push(c[0], c[1])); if (VC.pointInPoly(flat, h.bary[1], h.bary[2])) wind += poly.hole ? -1 : 1; });
      truth = wind > 0;
    }
    const o = 6 * f, uv = b.body.uv, x = w[0] * uv[o] + w[1] * uv[o + 2] + w[2] * uv[o + 4], y = w[0] * uv[o + 1] + w[1] * uv[o + 3] + w[2] * uv[o + 5];
    const inked = whole.has(f) || (parts.get(f) || []).some(poly => VC.pointInPoly(poly, x, y));
    tried++; if (vent.has(f)) inVent++;
    if (inked !== truth) wrong++;
  }
  assert.ok(tried > 30000 && inVent > 3000);
  assert.equal(wrong, 0, 'of ' + tried + ' points, ' + wrong + ' are inked otherwise than the hull above them');
  // the outline's steps lie along the hull's line
  let worst = 0, off = 0, ends = 0;
  e.strokePieces.forEach(pc => {
    const f = pc.face, o = 6 * f, uv = b.body.uv, det = (uv[o + 2] - uv[o]) * (uv[o + 5] - uv[o + 1]) - (uv[o + 4] - uv[o]) * (uv[o + 3] - uv[o + 1]);
    pc.runs.forEach(run => run.segs.forEach(sg => [[sg.c[0], sg.c[1]], [sg.c[6], sg.c[7]]].forEach(pt => {
      const w1 = ((pt[0] - uv[o]) * (uv[o + 5] - uv[o + 1]) - (uv[o + 4] - uv[o]) * (pt[1] - uv[o + 1])) / det, w2 = ((uv[o + 2] - uv[o]) * (pt[1] - uv[o + 1]) - (pt[0] - uv[o]) * (uv[o + 3] - uv[o + 1])) / det, w = [1 - w1 - w2, w1, w2];
      if (w.some(x => x < -1e-9)) return;   // beyond the face: clipped away when it is painted
      const q = [0, 0, 0];
      for (let c = 0; c < 3; c++) for (let j = 0; j < 3; j++) q[j] += w[c] * P[3 * T[3 * f + c] + j];
      const h = b.hull.nearest(q), hp = hullPoint(b.hull, h.tri, h.bary), ln = near(hp[0], hp[1], hp[2]), dd = ln ? ln.d : 40;
      ends++; worst = Math.max(worst, dd); if (dd > 0.05) off++;
    })));
  });
  assert.ok(ends > 1000);
  assert.ok(off < 0.05 * ends, 'nearly every step of the outline is within the tolerance of the line: ' + off + ' of ' + ends + ' are not');
  // deep under a fold of the hull its nearest point jumps, by the depth times the fold: the vent's walls
  assert.ok(worst < 1, 'and none strays a millimetre: ' + worst);
});

test('a big shape inks every face beneath it whole, and a small one only the faces it touches', () => {
  const b = bumper(), P = b.mesh.pos, T = b.mesh.tris;
  // the left third of the bumper's skin, short of its edge
  const big = { nodes: [nodeOn(b, -0.95, -0.9), nodeOn(b, -0.4, -0.9), nodeOn(b, -0.4, 0.9), nodeOn(b, -0.95, 0.9)], closed: true, fill: [100, 0, 0, 0], stroke: null };
  const d = VC.derive(b.onHull, big, {});
  assert.ok(d);
  const e = VC.castArt(b.body, b.hull, d, big, { cell: 2.5, tol: 0.05 })[0], whole = new Set(e.faces);
  assert.equal(e.strokePieces.length, 0, 'no outline, no steps of one');
  const made = new Map();
  e.edge.forEach(pc => made.set(pc.face, (made.get(pc.face) || 0) + VC.polyArea(pc.poly)));
  let under = 0, inked = 0, strayed = 0;
  for (let f = 0; f < T.length / 3; f++) {
    const z = (P[3 * T[3 * f] + 2] + P[3 * T[3 * f + 1] + 2] + P[3 * T[3 * f + 2] + 2]) / 3, y = (P[3 * T[3 * f] + 1] + P[3 * T[3 * f + 1] + 1] + P[3 * T[3 * f + 2] + 1]) / 3;
    // whole, or in parts that make it up (a face seen edge on in the layout has nothing to ink)
    const o = 6 * f, uv = b.body.uv, area = Math.abs((uv[o + 2] - uv[o]) * (uv[o + 5] - uv[o + 1]) - (uv[o + 4] - uv[o]) * (uv[o + 3] - uv[o + 1])) / 2;
    // well inside: a side straight on the hull bows a little against the bumper's own lines
    if (z > -0.88 * 900 && z < -0.5 * 900 && Math.abs(y) < 0.8 * 240) {
      under++;
      if (whole.has(f) || !(area > 0) || Math.abs((made.get(f) || 0) - area) < 1e-6 * area) inked++;
    }
    if (z > -0.3 * 900 && whole.has(f)) strayed++;
  }
  assert.ok(under > 1500 && inked === under, 'every face well inside it, those of the vent among them: ' + inked + ' of ' + under);
  assert.equal(strayed, 0, 'and none beyond it');
  const small = { nodes: [nodeOn(b, 0.1, 0.7), nodeOn(b, 0.2, 0.7), nodeOn(b, 0.15, 0.85)], closed: true, fill: [100, 0, 0, 0], stroke: null };
  const few = VC.castArt(b.body, b.hull, VC.derive(b.onHull, small, {}), small, { cell: 2.5, tol: 0.05 })[0];
  assert.ok(few.faces.length + new Set(few.edge.map(x => x.face)).size < 200, 'a small shape touches only the faces under it');
});

test('how a point lies to a line: its distance, its side, and past its ends', () => {
  // a line along x on the plane z = 0, seen from +z
  const pts = [0, 0, 0, 1, 0, 0, 2, 0, 0], near = VC.lineNear(pts, [0, 0, 0], () => [0, 0, 1], 5, false);
  const left = near(0.5, 0.3, 0), right = near(1.5, -0.2, 0);
  assert.ok(Math.abs(left.d - 0.3) < 1e-12 && left.s > 0, 'to its left');
  assert.ok(Math.abs(right.d - 0.2) < 1e-12 && right.s < 0, 'to its right');
  assert.equal(left.end, false);
  assert.equal(near(-0.4, 0.1, 0).end, true, 'past its start');
  assert.equal(near(2.4, 0.1, 0).end, true, 'past its end');
  assert.equal(near(1, 9, 0), null, 'beyond reach');
  assert.deepEqual(left.dir, [1, 0, 0]);
});

test('a relaxed hull settles on to the body but still bridges the vents', () => {
  const b = bumper(), vent = b.found.filter(it => !it.through && it.centre[2] < 0)[0];
  const h = PC.convexHull(b.mesh.pos, Array.from(new Set(b.mesh.tris)));
  const relaxed = PC.relaxHull(h, b.mesh, 750, 125), near = PC.nearestFace(relaxed.pos, relaxed.tris);
  assert.ok(relaxed.pos.length > h.pos.length, 'its long faces are divided');
  // the vent's floor still lies well beneath it
  let least = Infinity;
  vent.film.verts.forEach((v, i) => { if (vent.film.lifted[i] && vent.film.locate([b.mesh.pos[3 * v], b.mesh.pos[3 * v + 1], b.mesh.pos[3 * v + 2]]).d > 45)
    least = Math.min(least, near([b.mesh.pos[3 * v], b.mesh.pos[3 * v + 1], b.mesh.pos[3 * v + 2]]).d); });
  assert.ok(least > 30, 'the vent is bridged: its floor is ' + least + ' mm under the relaxed hull');
  // and the skin is on it, or near
  let far = 0, n = 0;
  for (let v = 0; v < b.mesh.pos.length / 3; v += 7) {
    const p = [b.mesh.pos[3 * v], b.mesh.pos[3 * v + 1], b.mesh.pos[3 * v + 2]];
    if (b.hull.nearest(p).d > 1e-6) continue;   // only the skin the true hull touches
    n++; if (near(p).d > 12) far++;
  }
  assert.ok(n > 300 && far < 0.05 * n, 'the skin the hull lay on is still on it: ' + far + ' of ' + n + ' are not');
});
