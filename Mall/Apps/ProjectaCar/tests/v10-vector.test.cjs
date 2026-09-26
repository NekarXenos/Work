'use strict';

// v10: vector art drawn on the model — paths laid into every island they
// reach, CMYK colour, and the vector PDF of the atlas.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const zlib = require('node:zlib');
const { test } = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', 'WrapaCar_v10.html'), 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);
const coreScript = scripts.find(source => source.includes('/* PanelCore'));
const vectorScript = scripts.find(source => source.includes('/* VectorCore'));
const appScript = scripts.find(source => source.includes('window.PanelCore;'));
const context = vm.createContext({});
vm.runInContext(coreScript, context);
vm.runInContext(vectorScript, context);
const PC = context.PanelCore;
const VC = context.VectorCore;

function appFunction(name) {
  const start = appScript.indexOf('  function ' + name + '(');
  assert.ok(start >= 0, 'App function exists: ' + name);
  const end = appScript.indexOf('\n  }\n', start) + 4;
  return appScript.slice(start, end);
}

function near(actual, expected, message, epsilon = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${message}: expected ${expected}, received ${actual}`);
}

// A box, each side an n×n grid wound outward, welded into one surface.
function box(n = 8, size = [2, 1, 1]) {
  const pos = [], tris = [];
  const sides = [[[-1, -1, 1], [2, 0, 0], [0, 2, 0]], [[1, -1, -1], [-2, 0, 0], [0, 2, 0]], [[1, -1, 1], [0, 0, -2], [0, 2, 0]],
    [[-1, -1, -1], [0, 0, 2], [0, 2, 0]], [[-1, 1, 1], [2, 0, 0], [0, 0, -2]], [[-1, -1, -1], [2, 0, 0], [0, 0, 2]]];
  for (const [o, u, v] of sides) {
    const base = pos.length / 3;
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
      for (let k = 0; k < 3; k++) pos.push((o[k] + u[k] * i / n + v[k] * j / n) * size[k] / 2);
    }
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const a = base + j * (n + 1) + i;
      tris.push(a, a + 1, a + n + 2, a, a + n + 2, a + n + 1);
    }
  }
  const welded = PC.weld(pos, tris, 1e-6);
  return PC.makeMesh(welded.pos, welded.tris);
}

// The box cut along its creases and unwrapped: what the app hands VectorCore.
function unwrappedBox() {
  const mesh = box();
  const edgeMap = PC.buildEdgeMap(mesh);
  PC.markCreases(mesh, edgeMap, 35);
  mesh.panel = Array.from(PC.computePanels(mesh, edgeMap).label);
  const unwrap = PC.unwrap(mesh, mesh.panel, { mode: 'arap', iterations: 20 });
  const islands = new Map(), index = new Map();
  unwrap.islands.forEach((island, i) => { islands.set(island.panel, island.faceList); index.set(island.panel, i); });
  const locator = PC.faceLocator(mesh);
  const model = { pos: mesh.pos, tris: mesh.tris, edgeMap, uv: unwrap.uv, panel: mesh.panel, islands, index,
    locate: locator.closest, scale: unwrap.scale, edge: 0.125 };
  return { mesh, edgeMap, unwrap, model };
}
const panelFacing = (fixture, normal) => fixture.unwrap.islands.find(island => {
  const n = PC.faceNormal(fixture.mesh, island.faceList[0]);
  return n[0] * normal[0] + n[1] * normal[1] + n[2] * normal[2] > 0.99;
}).panel;

// Nearest point to (x, y) on a run of cubics.
function distanceToCurves(segs, x, y) {
  let best = Infinity;
  for (const seg of segs) {
    let t0 = 0, bestD = Infinity;
    for (let i = 0; i <= 64; i++) {
      const p = VC.bezierAt(seg.c, i / 64), d = Math.hypot(p[0] - x, p[1] - y);
      if (d < bestD) { bestD = d; t0 = i / 64; }
    }
    let lo = Math.max(0, t0 - 1 / 64), hi = Math.min(1, t0 + 1 / 64);
    for (let k = 0; k < 60; k++) {
      const a = lo + (hi - lo) / 3, b = hi - (hi - lo) / 3;
      const pa = VC.bezierAt(seg.c, a), pb = VC.bezierAt(seg.c, b);
      if (Math.hypot(pa[0] - x, pa[1] - y) < Math.hypot(pb[0] - x, pb[1] - y)) hi = b; else lo = a;
    }
    const p = VC.bezierAt(seg.c, (lo + hi) / 2);
    best = Math.min(best, Math.hypot(p[0] - x, p[1] - y));
  }
  return best;
}

// Every sample of the surface line, where it truly lies in its own island,
// must lie on that island's refitted curves.
function worstGap(fixture, result) {
  const { model } = fixture, gaps = new Map();
  for (const island of result.islands) {
    if (island.full) continue;
    let worst = 0;
    for (let k = 0; k < result.samples.faces.length; k++) {
      const f = result.samples.faces[k];
      if (f < 0 || model.panel[f] !== island.panel) continue;
      const o = 6 * f, w = result.samples.bary.slice(3 * k, 3 * k + 3), uv = model.uv;
      const x = w[0] * uv[o] + w[1] * uv[o + 2] + w[2] * uv[o + 4], y = w[0] * uv[o + 1] + w[1] * uv[o + 3] + w[2] * uv[o + 5];
      worst = Math.max(worst, distanceToCurves(island.segs, x, y));
    }
    gaps.set(island.panel, worst);
  }
  return gaps;
}

/* -------------------------------------------------------------- colour */

test('CMYK previews: paper white, each process ink as printed, and black darkest', () => {
  assert.deepEqual(Array.from(VC.cmykToRgb([0, 0, 0, 0])), [255, 255, 255]);
  VC.INKS.forEach((ink, i) => {
    const c = [0, 0, 0, 0]; c[i] = 100;
    assert.deepEqual(Array.from(VC.cmykToRgb(c)), Array.from(ink), 'Solid ink ' + i);
  });
  const lum = c => { const [r, g, b] = VC.cmykToRgb(c); return 0.299 * r + 0.587 * g + 0.114 * b; };
  assert.ok(lum([0, 0, 0, 100]) < lum([0, 0, 0, 50]) && lum([0, 0, 0, 50]) < lum([0, 0, 0, 10]), 'More black is darker');
  assert.ok(lum([60, 40, 40, 100]) < lum([0, 0, 0, 100]), 'Rich black is darker than plain black');
  assert.deepEqual(Array.from(VC.cmykToRgb([-20, 0, 150, 0])), Array.from(VC.cmykToRgb([0, 0, 100, 0])), 'Coverage is clamped');
  assert.equal(VC.cmykHex([0, 0, 0, 0]), '#ffffff');
  assert.match(VC.cmykHex([0, 100, 100, 0]), /^#[0-9a-f]{6}$/);
  assert.equal(VC.cmykText([0, 100, 100, 0]), 'C0 M100 Y100 K0');
});

test('the palette is CMYK throughout and fills even rows once "no colour" leads it', () => {
  assert.equal((VC.PALETTE.length + 1) % 12, 0);
  assert.equal(new Set(VC.PALETTE.map(swatch => swatch.name)).size, VC.PALETTE.length, 'Names are unique');
  for (const swatch of VC.PALETTE) {
    assert.equal(swatch.cmyk.length, 4, swatch.name);
    for (const v of swatch.cmyk) assert.ok(Number.isInteger(v) && v >= 0 && v <= 100, swatch.name);
  }
  assert.deepEqual(Array.from(VC.PALETTE[0].cmyk), [0, 0, 0, 0], 'White first');
  for (const name of ['Cyan', 'Magenta', 'Yellow', 'Black', 'Rich black']) assert.ok(VC.PALETTE.some(s => s.name === name), name);
});

/* ----------------------------------------------------------- flat maps */

test('a flat map continues an island exactly across a flat sheet', () => {
  // a sheet on z = 0; the left half is the island, laid out rotated, scaled and moved
  const n = 6, pos = [], tris = [];
  for (let y = 0; y <= n; y++) for (let x = 0; x <= n; x++) pos.push(x / n, y / n, 0);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const a = y * (n + 1) + x;
    tris.push(a, a + 1, a + n + 2, a, a + n + 2, a + n + 1);
  }
  const mesh = PC.makeMesh(pos, tris), edgeMap = PC.buildEdgeMap(mesh), nT = tris.length / 3;
  const angle = 0.7, scale = 0.3, place = (x, y) => [0.2 + scale * (x * Math.cos(angle) - y * Math.sin(angle)),
    0.1 + scale * (x * Math.sin(angle) + y * Math.cos(angle))];
  const uv = new Float64Array(6 * nT), seeds = [];
  for (let f = 0; f < nT; f++) {
    for (let k = 0; k < 3; k++) {
      const v = tris[3 * f + k], p = place(pos[3 * v], pos[3 * v + 1]);
      uv[6 * f + 2 * k] = p[0]; uv[6 * f + 2 * k + 1] = p[1];
    }
    if (pos[3 * tris[3 * f]] + pos[3 * tris[3 * f + 1]] + pos[3 * tris[3 * f + 2]] < 1.5) seeds.push(f);
  }
  const surf = VC.surface(mesh.pos, mesh.tris, edgeMap);
  const frame = VC.flatMap(surf, uv, seeds, null);
  assert.equal(frame.faces.length, nT, 'Every face is reached');
  for (let f = 0; f < nT; f++) {
    const w = [0.2, 0.3, 0.5], expect = [0, 1].map(axis => w[0] * uv[6 * f + axis] + w[1] * uv[6 * f + 2 + axis] + w[2] * uv[6 * f + 4 + axis]);
    const got = VC.frameAt(frame, f, w);
    near(got[0], expect[0], 'u of face ' + f, 1e-12);
    near(got[1], expect[1], 'v of face ' + f, 1e-12);
  }
});

test('a flat map unfolds a crease: the far side lies flat beyond the shared edge', () => {
  // an L: a floor in z = 0 and a wall rising from its edge at x = 1
  const pos = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 0, 1, 1, 1, 1];
  const tris = [0, 1, 2, 0, 2, 3, 1, 4, 5, 1, 5, 2];
  const mesh = PC.makeMesh(pos, tris), edgeMap = PC.buildEdgeMap(mesh);
  const uv = new Float64Array(24);
  [0, 1].forEach(f => { for (let k = 0; k < 3; k++) { const v = tris[3 * f + k]; uv[6 * f + 2 * k] = pos[3 * v]; uv[6 * f + 2 * k + 1] = pos[3 * v + 1]; } });
  const frame = VC.flatMap(VC.surface(pos, tris, edgeMap), uv, [0, 1], null);
  // the wall's top corners land a unit beyond the crease, as if folded down flat
  near(VC.frameAt(frame, 2, [0, 1, 0])[0], 2, 'Wall corner x');
  near(VC.frameAt(frame, 2, [0, 1, 0])[1], 0, 'Wall corner y');
  near(VC.frameAt(frame, 3, [0, 0, 1])[0], 1, 'Shared corner stays on the crease');
  near(VC.frameAt(frame, 3, [0, 0, 1])[1], 1, 'Shared corner y');
  // a tangent on the wall, pointing up it, maps to +x in the map
  const dir = VC.faceMap(pos, tris, frame, 2)([0, 0, 0.5]);
  near(dir[0], 0.5, 'Handle along the unfolded wall');
  near(dir[1], 0, 'Handle stays off the crease line');
});

/* --------------------------------------------------------------- paths */

test('a shape across a seam lands in both islands, on the surface line to within a micron', () => {
  const fixture = unwrappedBox();
  const shape = { closed: true, fill: [0, 100, 100, 0], nodes: [
    { p: [-0.5, 0.5, 0.2], hin: [0, 0, -0.15], hout: [0, 0, 0.15] }, { p: [0.2, 0.5, 0.2] },
    { p: [0.2, 0.1, 0.5] }, { p: [-0.5, 0.1, 0.5], hin: [0.1, -0.1, 0], hout: [-0.1, 0.1, 0] }] };
  const result = VC.derive(fixture.model, shape, { reach: 0.003, tol: 1e-6, cache: new Map() });
  assert.ok(result, 'The shape is laid out');
  assert.equal(result.samples.breaks, 0, 'The line on the surface is unbroken');
  const top = panelFacing(fixture, [0, 1, 0]), front = panelFacing(fixture, [0, 0, 1]);
  assert.deepEqual(Array.from(result.islands, island => island.panel).sort(), [top, front].sort());
  for (const [panel, gap] of worstGap(fixture, result)) {
    // an atlas unit is about 4 m of box here, so 2.5e-7 is a micron
    assert.ok(gap < 2.5e-7, `Island ${panel} follows the surface line: gap ${gap}`);
  }
  assert.ok(result.inside.size > 0, 'The fill covers faces inside the outline');
});

test('filling a refitted outline in each island covers exactly the faces the surface says are inside', () => {
  const fixture = unwrappedBox(), { model } = fixture;
  const shape = { closed: true, fill: [0, 0, 100, 0], nodes: [
    { p: [-0.8, 0.5, 0.0] }, { p: [0.5, 0.5, 0.0] }, { p: [0.5, -0.1, 0.5] }, { p: [-0.8, -0.1, 0.5] }] };
  const result = VC.derive(model, shape, { reach: 0.003, tol: 1e-6, cache: new Map() });
  assert.ok(result.inside.size > 0, 'Faces lie inside, clear of the outline');
  for (const island of result.islands) {
    if (island.full) continue;
    assert.equal(island.faces, undefined, 'No fallback was needed');
    const poly = [];
    island.segs.forEach((seg, i) => { for (let k = i ? 1 : 0; k <= 16; k++) poly.push(...VC.bezierAt(seg.c, k / 16)); });
    for (const f of model.islands.get(island.panel)) {
      if (result.band.has(f)) continue;
      const o = 6 * f, cx = (model.uv[o] + model.uv[o + 2] + model.uv[o + 4]) / 3, cy = (model.uv[o + 1] + model.uv[o + 3] + model.uv[o + 5]) / 3;
      assert.equal(VC.pointInPoly(poly, cx, cy), result.inside.has(f), `Face ${f} of island ${island.panel}`);
    }
  }
});

test('a shape so thin its outline covers all of it has nothing inside, and no leak', () => {
  const fixture = unwrappedBox();
  const thin = { closed: true, fill: [0, 0, 100, 0], nodes: [
    { p: [-0.6, 0.5, 0.3] }, { p: [0.3, 0.5, 0.3] }, { p: [0.3, 0.5, 0.34] }, { p: [-0.6, 0.5, 0.34] }] };
  const result = VC.derive(fixture.model, thin, { reach: 0.003, tol: 1e-6, cache: new Map() });
  assert.ok(result.inside, 'Not a leak');
  assert.equal(result.inside.size, 0);
  assert.equal(result.islands.filter(island => island.full).length, 0);
});

test('a loop right round one end of the box fills that end panel whole', () => {
  const fixture = unwrappedBox();
  const loop = { closed: true, fill: [100, 0, 0, 0], nodes: [
    { p: [0.6, 0.5, 0.3] }, { p: [0.6, 0.5, -0.3] }, { p: [0.6, -0.5, -0.3] }, { p: [0.6, -0.5, 0.3] }] };
  const result = VC.derive(fixture.model, loop, { reach: 0.003, tol: 1e-6, cache: new Map() });
  const end = panelFacing(fixture, [1, 0, 0]);
  const whole = result.islands.filter(island => island.full);
  assert.deepEqual(Array.from(whole, island => island.panel), [end], 'Only the end panel lies wholly inside');
  assert.equal(result.islands.length, 5, 'The loop itself crosses the four sides round that end');
});

test('a line over two seams meets itself at each seam, and keeps its handles', () => {
  const fixture = unwrappedBox(), { model } = fixture;
  const line = { closed: false, nodes: [
    { p: [-0.4, 0.5, -0.1], hin: null, hout: [0.3, 0, 0.1] },
    { p: [0.3, 0.2, 0.5], hin: [-0.2, 0.1, 0], hout: [0.2, -0.1, 0] },
    { p: [1.0, 0.0, 0.1], hin: [0, 0, 0.15], hout: null }] };
  const cache = new Map(), result = VC.derive(model, line, { reach: 0.003, tol: 1e-6, cache });
  assert.equal(result.islands.length, 3);
  for (const gap of worstGap(fixture, result).values()) assert.ok(gap < 2.5e-7, 'On the surface line: ' + gap);
  // where the line changes island, both islands draw it through that very point
  const s = result.samples;
  for (let k = 1; k < s.faces.length; k++) {
    const a = model.panel[s.faces[k - 1]], b = model.panel[s.faces[k]];
    if (a === b) continue;
    const o = 6 * s.faces[k], w = s.bary.slice(3 * k, 3 * k + 3);
    const x = w[0] * model.uv[o] + w[1] * model.uv[o + 2] + w[2] * model.uv[o + 4], y = w[0] * model.uv[o + 1] + w[1] * model.uv[o + 3] + w[2] * model.uv[o + 5];
    const island = result.islands.find(entry => entry.panel === b);
    assert.ok(distanceToCurves(island.segs, x, y) < 2.5e-7, 'Seam crossing drawn in the island it enters');
  }
  // the smooth node keeps one tangent through it in the island it sits in
  const middle = result.islands.find(entry => entry.panel === panelFacing(fixture, [0, 0, 1]));
  const joins = middle.segs.filter((seg, i) => i && Math.hypot(seg.c[0] - middle.segs[i - 1].c[6], seg.c[1] - middle.segs[i - 1].c[7]) < 1e-12);
  assert.ok(joins.length >= 1, 'Pieces join end to end');
  for (let i = 1; i < middle.segs.length; i++) {
    const a = middle.segs[i - 1].c, b = middle.segs[i].c;
    const t1 = [a[6] - a[4], a[7] - a[5]], t2 = [b[2] - b[0], b[3] - b[1]];
    const cross = (t1[0] * t2[1] - t1[1] * t2[0]) / (Math.hypot(...t1) * Math.hypot(...t2) || 1);
    assert.ok(Math.abs(cross) < 1e-6, 'No kink where pieces meet');
  }
  // a second pass reuses every stretch
  const size = cache.size;
  VC.derive(model, line, { reach: 0.003, tol: 1e-6, cache });
  assert.equal(cache.size, size, 'Stretches come from the cache');
  const live = VC.derive(model, line, { live: true, cache });
  assert.deepEqual(Array.from(live.samples.faces), Array.from(result.samples.faces), 'Live mode follows the same line');
  assert.equal(live.islands.length, 0, 'Live mode stops at the line');
});

test('fitStretch keeps an exact cubic and splits only where one cubic cannot follow', () => {
  const cubic = [0, 0, 1, 2, 3, 2, 4, 0], t = [], q = [], exact = [];
  for (let i = 0; i <= 40; i++) { t.push(i / 40); q.push(...VC.bezierAt(cubic, i / 40)); exact.push(1); }
  const one = VC.fitStretch(t, q, exact, [1, 2], [-1, 2], 1e-9, false);
  assert.equal(one.length, 1);
  one[0].c.forEach((v, i) => near(v, cubic[i], 'Control value ' + i, 1e-9));

  // a wave: several pieces, each within tolerance, joined smoothly
  const tw = [], qw = [], ew = [];
  for (let i = 0; i <= 200; i++) { tw.push(i / 200); qw.push(i / 200 * 6, Math.sin(i / 200 * 3 * Math.PI)); ew.push(1); }
  const wave = VC.fitStretch(tw, qw, ew, null, null, 1e-3, false);
  assert.ok(wave.length > 1, 'The wave is split');
  for (let i = 1; i < wave.length; i++) {
    const a = wave[i - 1].c, b = wave[i].c;
    near(a[6], b[0], 'Pieces join (x)', 1e-12); near(a[7], b[1], 'Pieces join (y)', 1e-12);
    const cross = (a[6] - a[4]) * (b[3] - b[1]) - (a[7] - a[5]) * (b[2] - b[0]);
    assert.ok(Math.abs(cross) < 1e-9, 'One tangent either side of a split');
  }
  for (let i = 0; i <= 200; i++) assert.ok(distanceToCurves(wave, qw[2 * i], qw[2 * i + 1]) < 1.2e-3, 'Within tolerance at sample ' + i);

  // points on a straight line stay a straight line
  const straight = VC.fitStretch([0, 0.5, 1], [0, 0, 1, 1, 2, 2], [1, 1, 1], null, null, 1e-9, true);
  assert.equal(straight.length, 1);
  assert.equal(straight[0].line, true);
});

/* ------------------------------------------------------ island shapes */

test('an island region is its faces, grown past the rim by bands and discs', () => {
  const fixture = unwrappedBox(), island = fixture.unwrap.islands[0];
  const faces = VC.islandRegion(fixture.unwrap.uv, fixture.mesh.tris, island.faceList, 0);
  assert.equal(faces.length, island.faceList.length);
  for (const poly of faces) assert.ok(VC.polyArea(poly) > 0, 'Anticlockwise');
  const area = faces.reduce((sum, poly) => sum + VC.polyArea(poly), 0);
  const grow = 0.01, grown = VC.islandRegion(fixture.unwrap.uv, fixture.mesh.tris, island.faceList, grow);
  for (const poly of grown) assert.ok(VC.polyArea(poly) > 0, 'Anticlockwise');
  // sample the union on a grid: the island grown by `grow` is its area plus rim times grow plus a disc
  const outline = VC.islandOutline(fixture.unwrap.uv, fixture.mesh.tris, island.faceList);
  assert.equal(outline.length, 1, 'One closed rim');
  assert.equal(outline[0].closed, true);
  let rim = 0;
  const p = outline[0].pts;
  for (let i = 0; i < p.length / 2; i++) { const j = (i + 1) % (p.length / 2); rim += Math.hypot(p[2 * j] - p[2 * i], p[2 * j + 1] - p[2 * i + 1]); }
  const box2 = [Infinity, Infinity, -Infinity, -Infinity];
  for (const poly of grown) for (let i = 0; i < poly.length; i += 2) {
    box2[0] = Math.min(box2[0], poly[i]); box2[1] = Math.min(box2[1], poly[i + 1]);
    box2[2] = Math.max(box2[2], poly[i]); box2[3] = Math.max(box2[3], poly[i + 1]);
  }
  let hits = 0, total = 0;
  const steps = 240;
  for (let a = 0; a < steps; a++) for (let b = 0; b < steps; b++) {
    const x = box2[0] + (a + 0.5) / steps * (box2[2] - box2[0]), y = box2[1] + (b + 0.5) / steps * (box2[3] - box2[1]);
    total++;
    if (grown.some(poly => VC.pointInPoly(poly, x, y))) hits++;
  }
  const measured = hits / total * (box2[2] - box2[0]) * (box2[3] - box2[1]);
  const expected = area + rim * grow + Math.PI * grow * grow;
  assert.ok(Math.abs(measured - expected) / expected < 0.03, `Grown area ${measured} vs ${expected}`);
});

/* ----------------------------------------------------------------- PDF */

test('PDF numbers are plain decimals', () => {
  assert.equal(VC.pdfNum(1e-7), '0');
  assert.equal(VC.pdfNum(-0.0001), '0');
  assert.equal(VC.pdfNum(12.3456789), '12.346');
  assert.equal(VC.pdfNum(0.000125, 6), '0.000125');
  assert.equal(VC.pdfNum(1e21 / 1e21 * 2500), '2500');
  assert.equal(VC.pdfNum(NaN), '0');
});

test('the PDF is a well-formed CMYK document with clipped artwork and CutContour lines', () => {
  const tri = { c: [10, 10, 10, 10, 90, 10, 90, 10], line: true };
  const doc = {
    groups: [{ clip: [[0, 0, 100, 0, 100, 100, 0, 100]], shapes: [
      { segs: [tri, { c: [90, 10, 90, 10, 50, 80, 50, 80], line: true }, { c: [50, 80, 30, 70, 20, 40, 10, 10], line: false }],
        closed: true, fill: [0, 100, 100, 0], stroke: [100, 80, 0, 40], width: 2.5 },
      { segs: [tri], closed: false, fill: [0, 0, 100, 0], stroke: null, width: 0 }] }],
    cut: { lines: [{ pts: [0, 0, 100, 0, 100, 100, 0, 100], closed: true }], width: 0.25 }
  };
  const content = VC.pdfContent(doc);
  assert.doesNotMatch(content, /\de[-+]?\d/, 'No exponents');
  assert.match(content, /^0 1 1 0 k$/m, 'CMYK fill');
  assert.match(content, /^1 0\.8 0 0\.4 K$/m, 'CMYK outline');
  assert.match(content, /^B\*$/m, 'Filled and outlined, even-odd');
  assert.match(content, /^W n$/m, 'Clipped to the island');
  assert.match(content, / c$/m, 'Curves stay curves');
  assert.equal((content.match(/^0 0 1 0 k$/gm) || []).length, 0, 'An open path is never filled');
  assert.match(content, /\/CutContour CS 1 SCN/, 'Cut lines in the spot colour');
  assert.match(content, /\/Overprint gs/, 'Cut lines overprint');

  for (const deflated of [false, true]) {
    const body = deflated ? new Uint8Array(zlib.deflateSync(Buffer.from(content, 'latin1'))) : new Uint8Array(Buffer.from(content, 'latin1'));
    const bytes = VC.pdfDocument({ width: 283.465, height: 283.465, userUnit: deflated ? 2 : 1, content: body, deflated,
      title: 'Test (wrap)', creator: 'WrapaCar v10', date: new Date(Date.UTC(2026, 8, 26, 12, 0, 0)) });
    const text = Buffer.from(bytes).toString('latin1');
    assert.ok(text.startsWith('%PDF-1.6\n'), 'Header');
    assert.ok(text.endsWith('%%EOF\n'), 'Trailer');
    const startxref = +text.match(/startxref\n(\d+)\n%%EOF\n$/)[1];
    assert.ok(text.startsWith('xref\n', startxref), 'startxref points at the table');
    const rows = text.slice(startxref).split('\n').slice(3, 12);
    rows.forEach((row, i) => {
      assert.equal(row.length, 19, 'Each xref row is 20 bytes with its newline');
      assert.ok(text.startsWith((i + 1) + ' 0 obj\n', +row.slice(0, 10)), 'Object ' + (i + 1) + ' is where the table says');
    });
    const length = +text.match(/\/Length (\d+)/)[1];
    assert.equal(length, body.length, 'Stream length');
    const stream = bytes.slice(text.indexOf('stream\n') + 7, text.indexOf('stream\n') + 7 + length);
    const decoded = deflated ? zlib.inflateSync(Buffer.from(stream)).toString('latin1') : Buffer.from(stream).toString('latin1');
    assert.equal(decoded, content, 'Content survives the round trip');
    assert.equal(text.includes('/Filter /FlateDecode'), deflated);
    assert.equal(text.includes('/UserUnit 2'), deflated, 'UserUnit only when the page needs it');
    assert.match(text, /\/Separation \/CutContour \/DeviceCMYK/);
    assert.match(text, /\/Name \(Artwork\)/);
    assert.match(text, /\/Title \(Test \\\(wrap\\\)\)/, 'Title escaped');
    assert.match(text, /\/CreationDate \(D:20260926120000Z\)/);
  }
});

/* ----------------------------------------------------------- the app */

test('v10 adds the Vector mode, its palette and outline tools, and PDF export', () => {
  for (const script of scripts) new vm.Script(script);
  assert.match(html, /<title>WrapaCar v10 /);
  assert.match(html, /<button data-mode="vector">Vector/);
  for (const id of ['swatches', 'fillWell', 'strokeWell', 'mixC', 'mixM', 'mixY', 'mixK', 'widthRange', 'widthNum',
    'shapeList', 'vecClose', 'vecFinish', 'realLen', 'pdfScale', 'bleedRange', 'pdfCut', 'pdfBtn']) {
    assert.match(html, new RegExp('id="' + id + '"'), id);
  }
  assert.match(appScript, /else if \(e\.key === '5'\) setMode\('vector'\);/);
  // saving works in a plain browser too, not only inside Claude
  assert.doesNotMatch(appScript, /\$\('pngBtn'\)\.disabled = !S\.unwrap \|\| !DL/);
  assert.match(appFunction('saveBytes'), /a\.download = filename/);
});

test('the app lays the PDF out at scale, clipped per island, with a UserUnit past 200 inches', () => {
  const fixture = unwrappedBox();
  const controls = { realLen: '4500', pdfScale: '10', bleedRange: '0', sizeSel: '1024', pdfCut: true };
  const $ = id => ({ get value() { return controls[id]; }, get checked() { return controls[id]; } });
  const S = { mesh: fixture.mesh, edgeMap: fixture.edgeMap, unwrap: fixture.unwrap, vec: {
    paths: [], derived: new Map(), cache: new Map(), regions: new Map(), model: null } };
  const app = vm.createContext({ $, S, PC, VC, Map, Math, Array, JSON });
  for (const name of ['vecSync', 'vecModel', 'typicalEdge', 'mmPerUnit', 'mmPerAtlas', 'texBleed', 'printBleed',
    'derived', 'pdfLayout', 'squareSegs', 'triangleSegs']) vm.runInContext(appFunction(name), app);
  S.vec.paths.push({ id: 1, closed: true, fill: [0, 100, 100, 0], stroke: [0, 0, 0, 100], width: 5, nodes: [
    { p: [-0.5, 0.5, 0.2] }, { p: [0.2, 0.5, 0.2] }, { p: [0.2, 0.1, 0.5] }, { p: [-0.5, 0.1, 0.5] }] });
  // the loaded model's longest side is 3 units, so 1.5 mm per unit here; the box above is 2 units long
  const mmAtlas = 4500 / 3 / fixture.unwrap.scale;
  let layout = app.pdfLayout();
  near(layout.size, mmAtlas / 10 * 72 / 25.4, 'Page side at 1:10, in points', 1e-9);
  assert.equal(layout.unit, 1);
  assert.equal(layout.groups.length, 2, 'One clipped group per island the shape reaches');
  for (const group of layout.groups) {
    assert.ok(group.clip.length > 0);
    const shape = group.shapes[0];
    near(shape.width, 5 / mmAtlas * layout.size, 'Outline width scales with the page', 1e-9);
    assert.deepEqual(Array.from(shape.fill), [0, 100, 100, 0]);
  }
  assert.equal(layout.cut.lines.length, fixture.unwrap.islands.length, 'A cut line round every panel');
  near(layout.cut.width, 0.25, 'Hairline cut');

  controls.pdfScale = '1';
  S.vec.derived.clear();
  layout = app.pdfLayout();
  const points = mmAtlas * 72 / 25.4;
  assert.ok(points > 14400, 'Full size is past the 200 inch limit');
  assert.ok(layout.unit > 1 && layout.size <= 14400, 'UserUnit keeps the page within limits');
  near(layout.size * layout.unit, points, 'Same real size', 1e-6);
  near(layout.cut.width * layout.unit, 0.25, 'The cut line stays a hairline', 1e-9);
});
