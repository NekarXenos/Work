'use strict';

// v16: after the seams, the wrap panels are checked for polygons that will
// flatten badly — slivers, poles, flipped faces — and the ones that need it
// are rebuilt into even triangles before they are unwrapped.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', 'WrapaCar_v16.html'), 'utf8').replace(/\r\n/g, '\n');
const core = { module: { exports: {} } };
vm.runInNewContext(html.match(/<script>\s*(\/\* PanelCore[\s\S]*?)<\/script>/)[1], core);
const PC = core.module.exports;

function appFunction(name) {
  const start = html.search(new RegExp('\n  (?:async )?function ' + name + '\\('));
  assert.ok(start >= 0, 'App function exists: ' + name);
  return html.slice(start + 1, html.indexOf('\n  }\n', start + 1) + 4);
}

// A sheet over [-1, 1]² with n cells a side, bent round the y axis into
// part of a cylinder when bend is given, wound one way throughout.
function sheet(n, bend) {
  const pos = [], tris = [];
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    const x = -1 + 2 * i / n, y = -1 + 2 * j / n;
    if (bend) pos.push(Math.sin(x * bend) / bend, y, (Math.cos(x * bend) - 1) / bend);
    else pos.push(x, y, 0);
  }
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const a = j * (n + 1) + i;
    tris.push(a, a + 1, a + n + 2, a, a + n + 2, a + n + 1);
  }
  return PC.makeMesh(pos, tris);
}

// a point on the sheet, from its flat coordinates
function onSheet(u, v, bend) {
  return bend ? [Math.sin(u * bend) / bend, v, (Math.cos(u * bend) - 1) / bend] : [u, v, 0];
}
// values built inside the page's context, as plain ones
const plain = x => JSON.parse(JSON.stringify(x));

function label(mesh) {
  const edgeMap = PC.buildEdgeMap(mesh), r = PC.computePanels(mesh, edgeMap);
  mesh.panel = Array.from(r.label);
  return edgeMap;
}

// a seam through points near the surface, as the cutter lays one
function cut(mesh, points, closed) {
  const edgeMap = PC.buildEdgeMap(mesh), loc = PC.faceLocator(mesh);
  const picks = points.map(p => { const h = loc.closest(p); return { tri: h.tri, p: h.p }; });
  const r = PC.traceSeam(mesh, edgeMap, picks, !!closed, null);
  assert.ok(r.complete && r.chords.length, 'The seam traces');
  PC.applyCuts(mesh, r.chords, edgeMap);
  return label(mesh);
}

function areas(mesh) {
  const out = new Map();
  for (let f = 0; f < mesh.tris.length / 3; f++) out.set(mesh.panel[f], (out.get(mesh.panel[f]) || 0) + PC.faceArea(mesh, f));
  return out;
}
function seamLength(mesh) {
  let l = 0;
  mesh.cut.forEach(k => {
    const [a, b] = k.split(':').map(Number);
    l += Math.hypot(mesh.pos[3 * a] - mesh.pos[3 * b], mesh.pos[3 * a + 1] - mesh.pos[3 * b + 1], mesh.pos[3 * a + 2] - mesh.pos[3 * b + 2]);
  });
  return l;
}
function rebuilt(mesh, opts) {
  const out = PC.retopologize(mesh, opts), m = PC.makeMesh(out.pos, out.tris);
  m.panel = out.panel; m.cut = out.cut;
  return { mesh: m, out, edgeMap: PC.buildEdgeMap(m) };
}
function nearest(mesh, q) {
  let best = Infinity;
  for (let f = 0; f < mesh.tris.length / 3; f++) {
    const c = [0, 1, 2].map(k => [0, 1, 2].map(i => mesh.pos[3 * mesh.tris[3 * f + k] + i]));
    const p = PC.closestOnTri(q, c[0], c[1], c[2]).p;
    best = Math.min(best, Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]));
  }
  return best;
}
// every edge of two faces runs opposite ways round them
function consistentWinding(mesh) {
  const seen = new Map();
  for (let f = 0; f < mesh.tris.length / 3; f++) for (let e = 0; e < 3; e++) {
    const a = mesh.tris[3 * f + e], b = mesh.tris[3 * f + (e + 1) % 3], k = a + ':' + b;
    if (seen.has(k)) return false;
    seen.set(k, f);
  }
  return true;
}

// a cylinder panel cut by a slanted seam and a closed loop: the cutter's
// slivers line both
function slivered() {
  const mesh = sheet(16, 1.1);
  label(mesh);
  cut(mesh, [onSheet(-1, -0.93, 1.1), onSheet(1, 0.71, 1.1)], false);
  cut(mesh, [[-0.43, 0.33], [0.31, 0.29], [0.37, 0.81], [-0.39, 0.77]].map(p => onSheet(p[0], p[1], 1.1)), true);
  return mesh;
}

test('even triangles need no retopology', () => {
  const mesh = sheet(8), edgeMap = label(mesh);
  const report = PC.topologyReport(mesh, edgeMap, {});
  assert.equal(report.panels.length, 1);
  assert.equal(report.needing, 0);
  assert.deepEqual([report.bad.length, report.poles.length, report.flipped.length, report.nonManifold.length, report.doubled.length], [0, 0, 0, 0, 0]);
  assert.equal(Math.round(report.panels[0].sharpest), 45);
  assert.ok(Math.abs(report.edgeLength - Math.sqrt(4 * 4 / (Math.sqrt(3) * 128))) < 1e-9, 'The size keeping today\'s triangle count');
});

test('seams cut across the grain leave slivers the check marks, and a rebuild clears them', () => {
  const mesh = slivered(), edgeMap = PC.buildEdgeMap(mesh);
  const report = PC.topologyReport(mesh, edgeMap, {});
  assert.equal(report.panels.length, 3);
  assert.ok(report.needing >= 2, 'Both sides of a cut seam carry its slivers');
  assert.ok(report.bad.length > 10);
  for (const f of report.bad) assert.ok(Math.min(...PC.cornerAngles(mesh.pos, mesh.tris, f)) < 10 * Math.PI / 180);

  const ids = report.panels.filter(p => p.needs).map(p => p.id), before = areas(mesh), seam = seamLength(mesh);
  const r = rebuilt(mesh, { panels: ids, edgeMap, edgeLength: report.edgeLength });
  const after = PC.topologyReport(r.mesh, r.edgeMap, { edgeLength: report.edgeLength });
  assert.equal(after.needing, 0);
  assert.equal(after.bad.length, 0, 'No sliver is left');
  assert.equal(after.poles.length, 0);
  assert.ok(after.panels.every(p => p.sharpest > 20), 'Every corner opens past 20°');

  // the same panels, by the same ids, with the same outlines and areas
  const regions = PC.computePanels(r.mesh, r.edgeMap);
  assert.equal(regions.comps.length, 3);
  regions.comps.forEach(faces => assert.equal(new Set(faces.map(f => r.mesh.panel[f])).size, 1, 'A panel stays one panel'));
  assert.deepEqual([...areas(r.mesh).keys()].sort(), [...before.keys()].sort());
  before.forEach((a, id) => assert.ok(Math.abs(areas(r.mesh).get(id) - a) / a < 0.01, 'Panel ' + id + ' keeps its area'));
  assert.ok(Math.abs(seamLength(r.mesh) - seam) / seam < 0.005, 'The seams keep their length');
  assert.deepEqual(PC.checkManifold(r.mesh).nonManifold, 0);
  assert.ok(consistentWinding(r.mesh));
  // on the surface it was, to within a thousandth of a triangle
  for (let v = 0; v < r.mesh.pos.length / 3; v += 5) {
    assert.ok(nearest(mesh, [r.mesh.pos[3 * v], r.mesh.pos[3 * v + 1], r.mesh.pos[3 * v + 2]]) < report.edgeLength * 1e-3);
  }
});

test('a rebuild keeps corners where seams meet or turn, and never moves the open border', () => {
  const mesh = slivered(), edgeMap = PC.buildEdgeMap(mesh);
  const report = PC.topologyReport(mesh, edgeMap, {});
  const r = rebuilt(mesh, { panels: report.panels.map(p => p.id), edgeMap, edgeLength: report.edgeLength });
  const has = (m, p) => { for (let v = 0; v < m.pos.length / 3; v++) if (Math.hypot(m.pos[3 * v] - p[0], m.pos[3 * v + 1] - p[1], m.pos[3 * v + 2] - p[2]) < 1e-9) return true; return false; };
  // the sheet's four corners, and the loop's corners, are all still vertices
  const P = mesh.pos, corners = [0, 16, 16 * 17, 17 * 17 - 1].map(v => [P[3 * v], P[3 * v + 1], P[3 * v + 2]]);
  corners.forEach(c => assert.ok(has(r.mesh, c), 'Sheet corner kept'));
  const rim = PC.rimNet(mesh, edgeMap);
  let turns = 0;
  rim.nodes.forEach((nd, v) => { if (nd.kind === 'corner') { turns++; assert.ok(has(r.mesh, [P[3 * v], P[3 * v + 1], P[3 * v + 2]]), 'Outline corner kept'); } });
  assert.ok(turns >= 4, 'The loop turns at its corners');
  // border vertices stay on the border lines of the sheet
  PC.buildEdgeMap(r.mesh).forEach((fs, k) => {
    if (fs.length !== 1) return;
    for (const v of k.split(':').map(Number)) {
      const x = r.mesh.pos[3 * v], y = r.mesh.pos[3 * v + 1];
      assert.ok(Math.abs(Math.abs(y) - 1) < 1e-9 || Math.abs(Math.abs(Math.asin(x * 1.1) / 1.1) - 1) < 1e-6, 'On the open border');
    }
  });
});

test('a pole is found, and rebuilt away', () => {
  // a disc fanned from its centre: 20 slim triangles round one vertex
  const pos = [0, 0, 0], tris = [], n = 20;
  for (let i = 0; i < n; i++) pos.push(Math.cos(2 * Math.PI * i / n), Math.sin(2 * Math.PI * i / n), 0);
  for (let i = 0; i < n; i++) tris.push(0, 1 + i, 1 + (i + 1) % n);
  const mesh = PC.makeMesh(pos, tris), edgeMap = label(mesh);
  const report = PC.topologyReport(mesh, edgeMap, {});
  assert.deepEqual(plain(report.poles), [{ v: 0, panel: 0 }]);
  assert.equal(report.panels[0].poles, 1);
  assert.ok(report.panels[0].needs);
  const r = rebuilt(mesh, { panels: [0], edgeMap, edgeLength: 0.3 });
  const after = PC.topologyReport(r.mesh, r.edgeMap, { edgeLength: 0.3 });
  assert.equal(after.poles.length, 0);
  assert.equal(after.needing, 0);
});

test('faces wound against their panel are found, and turned back the way most of it faces', () => {
  const mesh = sheet(6), edgeMap = label(mesh);
  for (const f of [7, 20]) { const t = mesh.tris[3 * f + 1]; mesh.tris[3 * f + 1] = mesh.tris[3 * f + 2]; mesh.tris[3 * f + 2] = t; }
  const report = PC.topologyReport(mesh, edgeMap, {});
  assert.deepEqual(plain(report.flipped).sort((a, b) => a - b), [7, 20]);
  assert.ok(report.panels[0].needs);
  const r = rebuilt(mesh, { panels: [0], edgeMap });
  assert.equal(r.out.reoriented, 2);
  assert.ok(consistentWinding(r.mesh));
  // still facing +z, as most of it did
  for (let f = 0; f < r.mesh.tris.length / 3; f++) assert.ok(PC.faceNormal(r.mesh, f)[2] > 0.99);
});

test('edges of more than two faces and faces lying on others are reported, never rebuilt', () => {
  const mesh = sheet(4);
  mesh.tris.push(mesh.tris[0], mesh.tris[2], mesh.tris[1]);   // face 0 again, wound the other way
  const edgeMap = label(mesh);
  const report = PC.topologyReport(mesh, edgeMap, {});
  assert.deepEqual(plain(report.doubled), [32]);
  assert.equal(report.panels[0].doubled, 1);
  assert.equal(report.nonManifold.length, 2, 'Its two inner edges now join three faces');
  assert.equal(report.needing, 0, 'No rebuild mends it, so none is asked for');
  const r = rebuilt(mesh, { panels: [0], edgeMap, edgeLength: 0.2 });
  const again = PC.topologyReport(r.mesh, r.edgeMap, {});
  assert.equal(again.doubled.length, 1, 'The doubled face is left as it was');
  assert.equal(again.nonManifold.length, 2);
});

test('a corner held between two seams is as sharp as they make it, and is not a sliver', () => {
  // a 5° wedge between two seams from one tip, with a panel either side
  const w = 5 * Math.PI / 180;
  const mesh = PC.makeMesh([0, 0, 0, 1, 0, 0, Math.cos(w), Math.sin(w), 0, 0.5, -0.8, 0, 0.3, 0.9, 0],
    [0, 1, 2, 0, 3, 1, 0, 2, 4]);
  mesh.cut.add('0:1'); mesh.cut.add('0:2');
  const report = PC.topologyReport(mesh, label(mesh), {});
  assert.equal(report.panels.length, 3);
  assert.equal(report.bad.includes(0), false, 'The wedge is as thin as its seams make it');
  assert.equal(report.needing, 0);
  // without the seams, the same corner is a sliver a rebuild could open up
  mesh.cut.clear();
  const whole = PC.topologyReport(mesh, label(mesh), {});
  assert.deepEqual(plain(whole.bad), [0]);
});

test('a panel too thin for a triangle is marked thin, and a rebuild leaves it as it is', () => {
  // a strip a hundredth wide across the sheet
  const mesh = sheet(12);
  label(mesh);
  cut(mesh, [[-1, 0.1, 0], [1, 0.13, 0]], false);
  const em = cut(mesh, [[-1, 0.11, 0], [1, 0.14, 0]], false);
  const report = PC.topologyReport(mesh, em, { edgeLength: 0.25 });
  const thin = report.panels.filter(p => p.thin);
  assert.equal(thin.length, 1);
  assert.ok(thin[0].width < 0.25 / 8);
  assert.equal(thin[0].needs, false);
  const stripFaces = f => mesh.panel[f] === thin[0].id;
  const keep = [];
  for (let f = 0; f < mesh.tris.length / 3; f++) if (stripFaces(f)) keep.push([0, 1, 2].map(k => mesh.tris[3 * f + k]).map(v => [0, 1, 2].map(i => mesh.pos[3 * v + i]).join(',')).sort().join('|'));
  const out = rebuilt(mesh, { panels: report.panels.map(p => p.id), edgeMap: em, edgeLength: 0.25 });
  const now = [];
  for (let f = 0; f < out.mesh.tris.length / 3; f++) if (out.mesh.panel[f] === thin[0].id) now.push([0, 1, 2].map(k => out.mesh.tris[3 * f + k]).map(v => [0, 1, 2].map(i => out.mesh.pos[3 * v + i]).join(',')).sort().join('|'));
  assert.deepEqual(now.sort(), keep.sort(), 'Not one of its faces changed');
});

test('a panel that is not rebuilt keeps every face away from the seam it shares with one that is', () => {
  const mesh = slivered(), edgeMap = PC.buildEdgeMap(mesh);
  const report = PC.topologyReport(mesh, edgeMap, {});
  // rebuild only the loop's panel
  const loop = report.panels.reduce((a, b) => (a.faces < b.faces ? a : b));
  const touching = new Set();
  for (let f = 0; f < mesh.tris.length / 3; f++) if (mesh.panel[f] === loop.id) for (let k = 0; k < 3; k++) touching.add(mesh.tris[3 * f + k]);
  const key = (m, f) => [0, 1, 2].map(k => m.tris[3 * f + k]).map(v => [0, 1, 2].map(i => m.pos[3 * v + i].toFixed(12)).join(',')).sort().join('|');
  const away = new Set();
  for (let f = 0; f < mesh.tris.length / 3; f++) {
    if (mesh.panel[f] === loop.id || [0, 1, 2].some(k => touching.has(mesh.tris[3 * f + k]))) continue;
    away.add(key(mesh, f));
  }
  const r = rebuilt(mesh, { panels: [loop.id], edgeMap, edgeLength: report.edgeLength });
  const kept = new Set();
  for (let f = 0; f < r.mesh.tris.length / 3; f++) if (r.mesh.panel[f] !== loop.id) kept.add(key(r.mesh, f));
  away.forEach(k => assert.ok(kept.has(k), 'A face away from the seam is untouched'));
  const after = PC.topologyReport(r.mesh, r.edgeMap, { edgeLength: report.edgeLength });
  assert.equal(after.panels.find(p => p.id === loop.id).slivers, 0);
});

test('a crease inside a panel stays sharp through a rebuild', () => {
  // a sheet folded to a right angle along x = 0, all one panel
  const mesh = sheet(10);
  for (let v = 0; v < mesh.pos.length / 3; v++) if (mesh.pos[3 * v] > 0) { mesh.pos[3 * v + 2] = -mesh.pos[3 * v]; mesh.pos[3 * v] = 0; }
  const edgeMap = label(mesh);
  const r = rebuilt(mesh, { panels: [0], edgeMap, edgeLength: 0.2 });
  // every vertex still lies on one of the two flat halves, and the fold is an edge line
  for (let v = 0; v < r.mesh.pos.length / 3; v++) {
    const x = r.mesh.pos[3 * v], z = r.mesh.pos[3 * v + 2];
    assert.ok(Math.abs(z) < 1e-9 || Math.abs(x) < 1e-9, 'On a flat half');
  }
  let fold = 0;
  r.edgeMap.forEach((fs, k) => {
    if (fs.length !== 2) return;
    const n0 = PC.faceNormal(r.mesh, fs[0]), n1 = PC.faceNormal(r.mesh, fs[1]);
    if (Math.abs(n0[0] * n1[0] + n0[1] * n1[1] + n0[2] * n1[2]) < 0.01) {
      const [a, b] = k.split(':').map(Number);
      fold += Math.hypot(r.mesh.pos[3 * a + 1] - r.mesh.pos[3 * b + 1], r.mesh.pos[3 * a] - r.mesh.pos[3 * b], r.mesh.pos[3 * a + 2] - r.mesh.pos[3 * b + 2]);
    }
  });
  assert.ok(Math.abs(fold - 2) < 1e-9, 'The fold runs its whole length');
});

test('the rebuild runs a stage at a time, to the same result as all at once', () => {
  const mesh = slivered(), edgeMap = PC.buildEdgeMap(mesh);
  const opts = { panels: [0, 1, 2], edgeMap, edgeLength: 0.2 };
  const was = plain({ pos: mesh.pos, tris: mesh.tris, panel: mesh.panel, cut: [...mesh.cut].sort() });
  const job = PC.remesher(mesh, opts), shares = [];
  for (let done = 0; done < 1;) { done = job.step(); shares.push(done); }
  assert.equal(shares.length, 24, 'Six rounds of four stages');
  assert.ok(shares.every((s, i) => i === 0 || s > shares[i - 1]));
  assert.equal(job.step(), 1, 'Nothing is left to do');
  const a = job.finish(), b = PC.retopologize(mesh, opts);
  assert.deepEqual(a.tris, b.tris);
  assert.deepEqual(a.pos, b.pos);
  assert.deepEqual([...a.cut].sort(), [...b.cut].sort());
  assert.deepEqual(plain({ pos: mesh.pos, tris: mesh.tris, panel: mesh.panel, cut: [...mesh.cut].sort() }), was, 'The mesh it was given is left alone');
});

test('the face locator finds the true nearest face, however large the faces', () => {
  // one huge triangle over a field of small ones
  const mesh = sheet(20);
  const n = mesh.pos.length / 3;
  mesh.pos.push(-3, -3, 0.05, 3, -3, 0.05, 0, 3, 0.05);
  mesh.tris.push(n, n + 1, n + 2);
  const loc = PC.faceLocator(mesh);
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 300; i++) {
    const q = [rnd() * 4 - 2, rnd() * 4 - 2, rnd() * 0.3 - 0.1];
    assert.ok(Math.abs(loc.closest(q).d - nearest(mesh, q)) < 1e-12);
  }
});

// ---------------------------------------------------------------- the page
function app(mesh) {
  const nodes = new Map();
  const $ = id => {
    if (!nodes.has(id)) nodes.set(id, { value: '', checked: false, textContent: '', hidden: true, style: {} });
    return nodes.get(id);
  };
  $('retopoAuto').checked = true;
  $('creaseRange').value = '35';
  $('realLen').value = '4500';
  $('floatAuto').checked = true;
  const edgeMap = label(mesh);
  const regions = PC.computePanels(mesh, edgeMap);
  const S = { mesh, edgeMap, panels: regions.comps.map((faces, id) => ({ id, faces })), excludedPanels: new Set(),
    busy: false, retopo: null, retopoSize: 0, rebuilt: null, retopoSkip: -1, meshVersion: 1 };
  const ctx = vm.createContext({ PC, S, $, Set, Map, Math, fmt: String, RETOPO_FACES: 150000, toast: () => {} });
  for (const name of ['nativeSize', 'retopoTarget', 'mmPerUnit', 'checkTopology', 'counted', 'angleText', 'describeTopo', 'faultText',
    'retopoRows', 'runUnwrap']) vm.runInContext(appFunction(name), ctx);
  S.retopoSize = ctx.nativeSize(mesh);
  ctx.showRetopo = (report, mode) => { ctx.shown = { report, mode }; };
  ctx.dismissRetopo = () => { ctx.dismissed = (ctx.dismissed || 0) + 1; };
  // the unwrap proper begins by taking out floating seams
  ctx.removeFloating = () => { throw new Error('unwrapping'); };
  const unwrap = async opts => {
    ctx.shown = null;
    try { await ctx.runUnwrap(opts); return 'stopped'; } catch (e) { assert.equal(e.message, 'unwrapping'); return 'unwrapped'; }
  };
  return { ctx, S, $, unwrap };
}

test('Unwrap panels checks the topology first, and stops to show what needs a rebuild', async () => {
  const { ctx, S, $, unwrap } = app(slivered());
  assert.equal(await unwrap(), 'stopped');
  assert.equal(ctx.shown.mode, 'unwrap');
  assert.ok(ctx.shown.report.needing >= 2);
  // unwrapped as it is: not asked again until the panels change
  S.retopoSkip = S.meshVersion;
  assert.equal(await unwrap(), 'unwrapped');
  S.meshVersion++;
  assert.equal(await unwrap(), 'stopped');
  // the check can be turned off, or skipped by the review itself
  $('retopoAuto').checked = false;
  assert.equal(await unwrap(), 'unwrapped');
  $('retopoAuto').checked = true;
  assert.equal(await unwrap({ skipCheck: true }), 'unwrapped');
  // excluded panels are not checked
  S.excludedPanels = new Set(S.panels.map(p => p.id));
  S.excludedPanels.delete(S.panels[0].id);
  const only = ctx.checkTopology();
  assert.deepEqual(plain(only.panels.map(p => p.id)), [S.panels[0].id]);
});

test('panels rebuilt since the panels last changed no longer ask for a rebuild', async () => {
  const { ctx, S, unwrap } = app(slivered());
  const report = ctx.checkTopology(), ids = report.panels.filter(p => p.needs).map(p => p.id);
  S.rebuilt = { version: S.meshVersion, panels: new Set(ids) };
  const again = ctx.checkTopology();
  assert.equal(again.needing, 0);
  assert.ok(again.panels.filter(p => ids.includes(p.id)).every(p => p.rebuilt && !p.needs));
  assert.equal(await unwrap(), 'unwrapped');
  // once the panels change, they are checked afresh
  S.meshVersion++;
  assert.equal(ctx.checkTopology().needing, report.needing);
});

test('the review lists what needs a rebuild first, then what no rebuild mends', () => {
  const { ctx } = app(slivered());
  const rows = ctx.retopoRows({ panels: [
    { id: 4, needs: false, rebuilt: true, slivers: 2, poles: 0, flipped: 0, sharpest: 6.5, nonManifold: 0, doubled: 0 },
    { id: 9, needs: false, thin: true, slivers: 3, poles: 0, flipped: 0, sharpest: 2, nonManifold: 0, doubled: 0 },
    { id: 2, needs: false, slivers: 0, poles: 0, flipped: 0, sharpest: 30, nonManifold: 3, doubled: 1 },
    { id: 7, needs: true, slivers: 41, poles: 1, flipped: 0, sharpest: 0.4, nonManifold: 0, doubled: 0 },
    { id: 5, needs: false, slivers: 0, poles: 0, flipped: 0, sharpest: 40, nonManifold: 0, doubled: 0 }
  ] });
  assert.deepEqual(plain(rows.map(r => r.p.id)), [7, 2, 9, 4]);
  assert.equal(rows[0].text, '41 slivers · 1 pole · sharpest 0.40°');
  assert.equal(rows[1].text, '3 edges on more than two faces · 1 face lies on another — fix it in your modelling app');
  assert.match(rows[2].text, /too thin to rebuild/);
  assert.equal(rows[3].text, 'rebuilt — 2 slivers · sharpest 6.5° left where it narrows');
  assert.deepEqual(plain(rows.map(r => !!r.warn)), [false, true, true, false]);
});

test('the triangle size is the model\'s own unless one is typed, within what the page holds', () => {
  const { ctx, S, $ } = app(sheet(8));
  assert.ok(Math.abs(ctx.retopoTarget() - S.retopoSize) < 1e-12);
  $('retopoLen').value = '150';
  assert.ok(Math.abs(ctx.retopoTarget() - 150 / 1500) < 1e-12, 'Millimetres over the model\'s scale');
  $('retopoLen').value = '0.001';
  assert.ok(Math.abs(ctx.retopoTarget() - Math.sqrt(4 / (0.4330127 * 150000))) < 1e-6, 'No finer than the page can hold');
  $('retopoLen').value = '100000';
  assert.equal(ctx.retopoTarget(), 0.3, 'No coarser than a tenth of the model');
});

test('the page has the Retopology section between Panels and Atlas, and the review beside the others', () => {
  const panels = html.indexOf('<h2>Panels</h2>'), retopo = html.indexOf('<h2>Retopology</h2>'), atlas = html.indexOf('<h2>Atlas</h2>');
  assert.ok(panels > 0 && panels < retopo && retopo < atlas);
  for (const id of ['retopoCheckBtn', 'retopoBtn', 'statRetopo', 'statSlivers', 'statSharpest', 'retopoLen', 'retopoAuto',
    'retopoReview', 'retopoTitle', 'retopoSummary', 'retopoList', 'retopoApplyBtn', 'retopoSkipBtn']) {
    assert.match(html, new RegExp('id="' + id + '"'));
  }
  assert.match(html, /<input type="checkbox" id="retopoAuto" checked>/);
  assert.ok(html.indexOf('id="retopoReview"') > html.indexOf('<div class="reviews">'));
  assert.match(appFunction('recomputePanels'), /S\.meshVersion\+\+;\n    \/\/ a check belongs to the polygons it looked at\n    dismissRetopo\(\);/);
  assert.match(appFunction('wrapSelectionChanged'), /dismissRetopo\(\); S\.retopoSkip = -1;/);
  // Esc only closes the review: it neither rebuilds nor unwraps
  assert.match(html, /else if \(S\.retopo\) \{ dismissRetopo\(true\); updateButtons\(\); \}/);
  // taking out floating seams changes no triangle, so a check still stands
  assert.match(appFunction('removeFloating'), /var was = S\.meshVersion;\n    recomputePanels\(\); syncAll\(\);\n    sameTriangles\(was\);/);
  assert.match(appFunction('sameTriangles'), /if \(S\.retopoSkip === was\) S\.retopoSkip = S\.meshVersion;\n    if \(S\.rebuilt && S\.rebuilt\.version === was\) S\.rebuilt\.version = S\.meshVersion;/);
});
