'use strict';

// v18: a side of a shape is straight on the car, not in its panel's layout.
// Each is laid out in the surface unfolded from the face it starts on, so a
// panel flattened with a pocket in it (a vent, say) no longer bends, doubles
// back or strays a line drawn beside, across or into the pocket. The panel's
// own layout still comes first across a projected intake, which takes the
// line from its lid. And where an island's layout folds the outline over, the
// fill is cut face by face, right up to the line.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', 'WrapaCar_v18.html'), 'utf8').replace(/\r\n/g, '\n');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);
const context = vm.createContext({});
vm.runInContext(scripts.find(source => source.includes('/* PanelCore')), context);
vm.runInContext(scripts.find(source => source.includes('/* VectorCore')), context);
const PC = context.PanelCore;
const VC = context.VectorCore;
const appScript = scripts.find(source => source.includes('window.PanelCore;'));

function appFunction(name) {
  const start = appScript.indexOf('  function ' + name + '(');
  assert.ok(start >= 0, 'App function exists: ' + name);
  return appScript.slice(start, appScript.indexOf('\n  }\n', start) + 4);
}

// A 2 × 1.2 plate (z = 0) on a 0.05 grid, one panel. With `depth`, a
// rectangular pocket x ∈ [-0.5, 0], y ∈ [-0.2, 0.2] is sunk into it: straight
// walls down to a floor `under` wider than the opening each way (an undercut).
function plate(opts = {}) {
  const h = 0.05, nx = 40, ny = 24, i0 = 10, i1 = 20, j0 = 8, j1 = 16, depth = opts.depth || 0, under = opts.under || 0;
  const pos = [], tris = [], id = new Map();
  const vertex = (x, y, z) => { pos.push(x, y, z); return pos.length / 3 - 1; };
  const grid = (i, j) => {
    const key = i + ',' + j;
    if (!id.has(key)) id.set(key, vertex(-1 + i * h, -0.6 + j * h, 0));
    return id.get(key);
  };
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    if (depth && i >= i0 && i < i1 && j >= j0 && j < j1) continue;
    tris.push(grid(i, j), grid(i + 1, j), grid(i + 1, j + 1), grid(i, j), grid(i + 1, j + 1), grid(i, j + 1));
  }
  if (depth) {
    const ci = i1 - i0, cj = j1 - j0, loop = [], fid = new Map();
    for (let a = 0; a <= ci; a++) loop.push([a, 0]);
    for (let b = 1; b <= cj; b++) loop.push([ci, b]);
    for (let a = ci - 1; a >= 0; a--) loop.push([a, cj]);
    for (let b = cj - 1; b >= 1; b--) loop.push([0, b]);
    const x0 = -1 + i0 * h - under, y0 = -0.6 + j0 * h - under, fw = ci * h + 2 * under, fh = cj * h + 2 * under;
    const floor = (a, b) => {
      const key = a + ',' + b;
      if (!fid.has(key)) fid.set(key, vertex(x0 + a / ci * fw, y0 + b / cj * fh, -depth));
      return fid.get(key);
    };
    const top = loop.map(([a, b]) => grid(i0 + a, j0 + b)), low = loop.map(([a, b]) => floor(a, b));
    let prev = top;
    for (let r = 1; r <= 3; r++) {
      const cur = r === 3 ? low : loop.map((_, k) => {
        const p = top[k], q = low[k];
        return vertex(...[0, 1, 2].map(x => pos[3 * p + x] + (pos[3 * q + x] - pos[3 * p + x]) * r / 3));
      });
      for (let k = 0; k < loop.length; k++) {
        const k1 = (k + 1) % loop.length;
        tris.push(prev[k], prev[k1], cur[k1], prev[k], cur[k1], cur[k]);
      }
      prev = cur;
    }
    for (let b = 0; b < cj; b++) for (let a = 0; a < ci; a++) {
      tris.push(floor(a, b), floor(a + 1, b), floor(a + 1, b + 1), floor(a, b), floor(a + 1, b + 1), floor(a, b + 1));
    }
  }
  const mesh = PC.makeMesh(pos, tris), edgeMap = PC.buildEdgeMap(mesh);
  mesh.panel = new Array(tris.length / 3).fill(0);
  const unwrap = PC.unwrap(mesh, mesh.panel, { mode: 'arap', iterations: 26, sweeps: 8 });
  return { mesh, edgeMap, unwrap };
}

// A plain plate whose layout is folded over along x = -0.3: every face left
// of the line is laid out where its mirror image across it lies.
function foldedPlate() {
  const fixture = plate(), P = fixture.mesh.pos, T = fixture.mesh.tris, uv = fixture.unwrap.uv, fold = -0.3;
  // the layout of a flat plate is the plate moved rigidly, found from one face
  const U = Array.from(uv.slice(0, 6)), A = [P[3 * T[0]], P[3 * T[0] + 1]], B = [P[3 * T[1]], P[3 * T[1] + 1]], C = [P[3 * T[2]], P[3 * T[2] + 1]];
  const det = (B[0] - A[0]) * (C[1] - A[1]) - (C[0] - A[0]) * (B[1] - A[1]);
  const layout = (x, y) => {
    const w1 = ((x - A[0]) * (C[1] - A[1]) - (C[0] - A[0]) * (y - A[1])) / det, w2 = ((B[0] - A[0]) * (y - A[1]) - (x - A[0]) * (B[1] - A[1])) / det;
    return [U[0] + w1 * (U[2] - U[0]) + w2 * (U[4] - U[0]), U[1] + w1 * (U[3] - U[1]) + w2 * (U[5] - U[1])];
  };
  for (let f = 0; f < T.length / 3; f++) {
    if ((P[3 * T[3 * f]] + P[3 * T[3 * f + 1]] + P[3 * T[3 * f + 2]]) / 3 >= fold) continue;
    for (let k = 0; k < 3; k++) {
      const v = T[3 * f + k], q = layout(2 * fold - P[3 * v], P[3 * v + 1]);
      uv[6 * f + 2 * k] = q[0]; uv[6 * f + 2 * k + 1] = q[1];
    }
  }
  return fixture;
}

function modelOf(fixture, projected = null) {
  const islands = new Map(), index = new Map();
  fixture.unwrap.islands.forEach((is, i) => { islands.set(is.panel, is.faceList); index.set(is.panel, i); });
  return { pos: fixture.mesh.pos, tris: fixture.mesh.tris, edgeMap: fixture.edgeMap, uv: fixture.unwrap.uv, panel: fixture.mesh.panel,
    islands, index, locate: PC.faceLocator(fixture.mesh).closest, scale: fixture.unwrap.scale, edge: 0.05, projected };
}

const node = (x, y, z = 0, h = null) => ({ p: [x, y, z], hin: h && [-h[0], -h[1], 0], hout: h && [h[0], h[1], 0] });

// a stretch's line on the surface, gaps left out
function traced(stretch) {
  const out = [];
  for (let k = 0; k < stretch.tr.faces.length; k++) {
    if (stretch.tr.faces[k] >= 0) out.push([stretch.tr.pts[3 * k], stretch.tr.pts[3 * k + 1], stretch.tr.pts[3 * k + 2]]);
  }
  return out;
}

test('a side beside a pocket its panel was flattened with runs straight on the car', () => {
  for (const depth of [0.1, 0.2]) {
    const fixture = plate({ depth });
    // the pocket bends the panel's layout: a line straight in it would not be on the car
    assert.ok(fixture.unwrap.islands[0].distortion.worst > 1.3, 'The layout is stretched round the pocket');
    const a = [-0.9, 0.5], b = [0.9, 0.45];
    const d = VC.derive(modelOf(fixture), { nodes: [node(...a), node(...b)], closed: false }, {});
    assert.equal(d.stretches[0].unfolded, true, 'Laid out in the surface unfolded from its first face');
    assert.equal(d.samples.breaks, 0);
    const ux = b[0] - a[0], uy = b[1] - a[1], length = Math.hypot(ux, uy);
    let off = 0;
    for (const p of traced(d.stretches[0])) off = Math.max(off, Math.abs(((p[0] - a[0]) * uy - (p[1] - a[1]) * ux) / length));
    assert.ok(off < 1e-9, `Straight on the plate at depth ${depth}: strays ${off}`);
  }
});

test('a side from the pocket floor crosses its wall and keeps its heading on the plate', () => {
  const fixture = plate({ depth: 0.1 }), model = modelOf(fixture);
  const d = VC.derive(model, { nodes: [node(-0.35, -0.1, -0.1), node(-0.8, 0.45)], closed: false }, {});
  const s = d.stretches[0], pts = traced(s);
  assert.equal(d.samples.breaks, 0);
  assert.equal(s.stray, false);
  const floor = pts.filter(p => p[2] < -0.1 + 1e-9), top = pts.filter(p => p[2] > -1e-9);
  assert.ok(floor.length > 3 && top.length > 3, 'The line runs over the floor, up the wall and over the plate');
  const heading = run => Math.atan2(run[run.length - 1][1] - run[0][1], run[run.length - 1][0] - run[0][0]);
  assert.ok(Math.abs(heading(floor) - heading(top)) < 1e-6, 'Unfolded, the floor and the plate are one flat sheet, and the line straight across it');
  // as long on the car as in its map: nothing doubled back
  let length = 0, flat = 0;
  for (let i = 1; i < pts.length; i++) length += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]);
  for (let k = 1; k < s.flat.pts.length / 2; k++) flat += Math.hypot(s.flat.pts[2 * k] - s.flat.pts[2 * k - 2], s.flat.pts[2 * k + 1] - s.flat.pts[2 * k - 1]);
  assert.ok(Math.abs(length / (flat / model.scale) - 1) < 0.01);
});

test('an undercut pocket folds its layout over; the fold is found, and every side still runs true', () => {
  const fixture = plate({ depth: 0.08, under: 0.15 }), model = modelOf(fixture);
  const T = fixture.mesh.tris;
  let folded = 0;
  for (let f = 0; f < T.length / 3; f++) if (VC.layoutFit(model, f) === 2) folded++;
  assert.ok(folded > 0, 'Faces the layout folds over or crushes are found');
  // plain plate faces far from the pocket are laid out truly
  const corner = PC.faceLocator(fixture.mesh).closest([0.9, 0.5, 0]).tri;
  assert.equal(VC.layoutFit(model, corner), 1);
  const d = VC.derive(model, { nodes: [node(-0.8, 0.45), node(0.8, 0.2), node(-0.35, -0.1, -0.08)], closed: true, fill: [0, 60, 100, 0] },
    { reach: 0.002, tol: 1e-5 });
  assert.equal(d.samples.breaks, 0);
  for (const s of d.stretches) {
    assert.equal(s.unfolded, true);
    assert.equal(s.stray, false);
  }
  const top = traced(d.stretches[0]);
  let off = 0;
  for (const p of top) off = Math.max(off, Math.abs(((p[0] + 0.8) * -0.25 - (p[1] - 0.45) * 1.6) / Math.hypot(1.6, 0.25)));
  assert.ok(off < 1e-9, 'The side along the plate is straight: ' + off);
});

test('a line across a projected intake still takes the panel layout, projected from the lid', () => {
  const fixture = plate({ depth: 0.1 }), P = fixture.mesh.pos, T = fixture.mesh.tris;
  const held = new Uint8Array(T.length / 3);
  for (let f = 0; f < held.length; f++) if (Math.min(P[3 * T[3 * f] + 2], P[3 * T[3 * f + 1] + 2], P[3 * T[3 * f + 2] + 2]) < -1e-9) held[f] = 1;
  const line = { nodes: [node(-0.8, 0.02), node(0.4, -0.03)], closed: false };
  assert.equal(VC.derive(modelOf(fixture), line, {}).stretches[0].unfolded, true, 'Over an ordinary pocket, unfolded');
  const d = VC.derive(modelOf(fixture, held), line, {});
  assert.equal(d.stretches[0].unfolded, false, 'Across an intake, the layout the lid gives it');
  assert.equal(d.samples.breaks, 0);
});

test('where the layout is true, a filled shape keeps to its outline, a straight side a straight segment', () => {
  const fixture = plate(), model = modelOf(fixture);
  const d = VC.derive(model, { nodes: [node(-0.8, 0.45), node(0.3, -0.2), node(-0.41, -0.33)], closed: true, fill: [0, 100, 0, 0] },
    { reach: 0.002, tol: 1e-5 });
  const it = d.islands[0];
  assert.equal(it.faces, undefined, 'Filled by its outline');
  assert.equal(it.segs.length, 3);
  assert.ok(it.segs.every(s => s.line));
});

// Filled or not, as the atlas has it, at points spread over every face, set
// against the line on the surface — away from the line itself.
function wrongly(fixture, d) {
  const P = fixture.mesh.pos, T = fixture.mesh.tris, uv = fixture.unwrap.uv, it = d.islands[0], loop = [];
  for (let k = 0; k < d.samples.faces.length; k++) if (d.samples.faces[k] >= 0) loop.push(d.samples.pts[3 * k], d.samples.pts[3 * k + 1]);
  const nearLine = (x, y) => {
    for (let i = 0; i + 3 < loop.length; i += 2) {
      const ax = loop[i], ay = loop[i + 1], ex = loop[i + 2] - ax, ey = loop[i + 3] - ay;
      const t = Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / (ex * ex + ey * ey || 1)));
      if (Math.hypot(ax + t * ex - x, ay + t * ey - y) < 0.004) return true;
    }
    return false;
  };
  const whole = new Set(it.faces || []), outline = it.faces ? null : VC.flatten(it.segs, 0.0005).pts;
  let wrong = 0, seen = 0;
  for (let f = 0; f < T.length / 3; f++) for (let a = 1; a < 6; a++) for (let b = 1; a + b < 6; b++) {
    const w = [a / 6, b / 6, 1 - (a + b) / 6];
    const x = w[0] * P[3 * T[3 * f]] + w[1] * P[3 * T[3 * f + 1]] + w[2] * P[3 * T[3 * f + 2]];
    const y = w[0] * P[3 * T[3 * f] + 1] + w[1] * P[3 * T[3 * f + 1] + 1] + w[2] * P[3 * T[3 * f + 2] + 1];
    if (nearLine(x, y)) continue;
    const u = w[0] * uv[6 * f] + w[1] * uv[6 * f + 2] + w[2] * uv[6 * f + 4], v = w[0] * uv[6 * f + 1] + w[1] * uv[6 * f + 3] + w[2] * uv[6 * f + 5];
    const filled = outline ? VC.pointInPoly(outline, u, v)
      : whole.has(f) || it.edge.some(pc => pc.face === f && VC.pointInPoly(pc.poly, u, v));
    seen++;
    if (filled !== VC.pointInPoly(loop, x, y)) wrong++;
  }
  return { wrong, seen };
}

const shapes = {
  square: [node(-0.62, -0.26), node(0.12, -0.26), node(0.12, 0.24), node(-0.62, 0.24)],
  triangle: [node(-0.8, 0.45), node(0.3, -0.2), node(-0.41, -0.33)],
  sliver: [node(-0.7, 0.1), node(0.4, 0.13), node(-0.7, 0.125)],
  curve: [node(-0.6, 0, 0, [0, -0.2]), node(0, -0.3, 0, [0.25, 0]), node(0.2, 0.1, 0, [0, 0.2]), node(-0.3, 0.35, 0, [-0.25, 0])]
};

test('where the layout folds the outline over, the fill is cut face by face right up to the line', () => {
  const fixture = foldedPlate(), model = modelOf(fixture);
  for (const [name, nodes] of Object.entries(shapes)) {
    const d = VC.derive(model, { nodes, closed: true, fill: [0, 100, 0, 0] }, { reach: 0.002, tol: 1e-5 });
    const it = d.islands[0];
    assert.ok(it.faces && it.edge && it.edge.length, name + ': filled face by face');
    assert.ok(it.edge.every(pc => VC.polyArea(pc.poly) > 0), name + ': every piece anticlockwise');
    const { wrong, seen } = wrongly(fixture, d);
    assert.ok(seen > 10000);
    assert.equal(wrong, 0, name + ': filled exactly where the shape is on the surface');
  }
});

test('a true layout is never taken for a folded one', () => {
  const fixture = plate(), model = modelOf(fixture);
  for (const [name, nodes] of Object.entries(shapes)) {
    const d = VC.derive(model, { nodes, closed: true, fill: [0, 100, 0, 0] }, { reach: 0.002, tol: 1e-5 });
    assert.equal(d.islands[0].faces, undefined, name + ': filled by its outline');
    assert.equal(wrongly(fixture, d).wrong, 0, name);
  }
});

// The app's painting, hit test and PDF, on the folded plate.
function harness() {
  const fixture = foldedPlate();
  const elements = new Map();
  const $ = id => {
    if (!elements.has(id)) elements.set(id, { id, value: '0', checked: false });
    return elements.get(id);
  };
  $('realLen').value = '4500'; $('pdfScale').value = '10'; $('sizeSel').value = '1024'; $('bleedRange').value = '0';
  const S = { mesh: fixture.mesh, edgeMap: fixture.edgeMap, unwrap: fixture.unwrap, radius: 1.2, plane: null,
    vec: { paths: [], derived: new Map(), cache: new Map(), regions: new Map(), model: null, twins: new WeakMap() } };
  class Path2D {
    constructor(p) { this.ops = p ? p.ops.slice() : []; }
    moveTo(x, y) { this.ops.push(['M', x, y]); }
    lineTo(x, y) { this.ops.push(['L', x, y]); }
    bezierCurveTo(...a) { this.ops.push(['C', ...a]); }
    closePath() { this.ops.push(['Z']); }
  }
  const app = vm.createContext({ $, S, PC, VC, Map, Set, WeakMap, Math, Array, JSON, Path2D });
  for (const name of ['vecSync', 'vecModel', 'vecLocator', 'typicalEdge', 'mmPerUnit', 'mmPerAtlas', 'texBleed', 'printBleed',
    'derived', 'pdfLayout', 'squareSegs', 'triangleSegs', 'polySegs', 'withTwins', 'twinOf', 'artPlane', 'insideOutline',
    'piecePath', 'facesPath', 'drawPiece']) vm.runInContext(appFunction(name), app);
  return { app, S, fixture };
}

test('the app paints, hits and prints a shape filled face by face up to its line', () => {
  const { app, S } = harness();
  const square = { id: 1, closed: true, fill: [0, 100, 0, 0], stroke: [0, 0, 0, 100], width: 5, nodes: shapes.square };
  S.vec.paths.push(square);
  const d = app.derived(square), it = d.islands[0];
  assert.ok(it.faces && it.edge.length, 'Filled face by face');

  // painted as one path of whole faces and pieces, all one way round
  const calls = [];
  const ctx = { fill: (p, rule) => calls.push(['fill', p, rule]), stroke: p => calls.push(['stroke', p]) };
  app.drawPiece(ctx, square, it, d.width);
  const fill = calls.find(c => c[0] === 'fill');
  assert.equal(fill[2], undefined, 'Filled non-zero, so faces a fold lays over each other add up');
  assert.equal(fill[1].ops.filter(op => op[0] === 'M').length, it.faces.length + it.edge.length);
  assert.ok(calls.some(c => c[0] === 'stroke'), 'The outline is stroked over it');

  // a tap just inside the line, and just outside, in the folded half and not
  // (clear of the grid's lines, where a tap is on two faces at once)
  const locate = PC.faceLocator(S.mesh).closest;
  for (const [x, y, inside] of [[-0.61, 0.03, true], [-0.63, 0.03, false], [0.11, -0.12, true], [0.13, -0.12, false], [-0.42, -0.255, true], [-0.42, -0.265, false]]) {
    const hit = locate([x, y, 0]);
    assert.ok(d.band.has(hit.tri), 'A face the line crosses');
    assert.equal(app.insideOutline(d, { tri: hit.tri, p: hit.p }), inside, `Tap at ${x}, ${y}`);
  }

  // printed as the same whole faces and pieces, then the outline
  const layout = app.pdfLayout(), group = layout.groups[0];
  const filled = group.shapes.filter(s => s.fill);
  assert.equal(filled.length, it.faces.length + it.edge.length);
  assert.ok(filled.every(s => s.closed && s.segs.every(sg => sg.line)));
  assert.equal(group.shapes.filter(s => s.stroke).length, 1, 'One stroked outline');
  const content = VC.pdfContent(layout);
  assert.equal((content.match(/\nf\*\n/g) || []).length, filled.length);
});

test('the page is v18', () => {
  assert.match(html, /<title>WrapaCar v18 — Intakes<\/title>/);
  assert.match(html, /vector art · v18/);
});
