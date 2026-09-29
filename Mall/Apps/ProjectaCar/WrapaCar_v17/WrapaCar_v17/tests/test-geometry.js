'use strict';
// Geometry tier. PanelCore and VectorCore are taken from the shipped page
// and run against synthetic surfaces whose intakes have known sizes, known
// areas and a known right answer for where the artwork lands. v16's cores
// run beside them as the control that shows each test can tell.
const { ledger, appFunction, PAGE, BASE, load } = require('./lib.js');
const { sheet } = require('./synth.js');
const PC = load(PAGE, 'panel'), VC = load(PAGE, 'vector');
const PC16 = load(BASE, 'panel'), VC16 = load(BASE, 'vector');
const L = ledger('geometry tier');
const { check, near } = L;

function mesh(o, core) { const s = sheet(o), w = (core || PC).weld(s.pos, s.tris, 1e-6); return (core || PC).makeMesh(w.pos, w.tris); }
function find(m, o) { return PC.findIntakes(m, PC.buildEdgeMap(m), Object.assign({ diameter: 300, minDepth: 5 }, o || {})); }
function record(m, it) { return { rim: it.rim.map(v => [m.pos[3 * v], m.pos[3 * v + 1], m.pos[3 * v + 2]]), seed: it.seed, tol: it.tol, area: it.area, perimeter: it.perimeter }; }
function allFaces(m) { const n = m.tris.length / 3, f = new Int32Array(3 * n); for (let i = 0; i < 3 * n; i++) f[i] = m.tris[i]; return f; }
function area(m, fl) { return fl.reduce((s, f) => s + PC.faceArea(m, f), 0); }
const pocket = (o) => ({ W: 800, H: 600, holes: [Object.assign({ u0: -100, u1: 100, v0: -50, v1: 50, depth: 40 }, o || {})] });

/* ---- 1. detection: sizes, depths and areas that are known exactly ---- */
{
  const m = mesh(pocket()), f = find(m);
  check('vertical pocket: one found', f.length === 1, f.length);
  const it = f[0];
  near('vertical pocket: width', it.width, 100, 1e-6);
  near('vertical pocket: length', it.length, 200, 1e-6);
  near('vertical pocket: depth', it.depth, 40, 1e-6);
  near('vertical pocket: area, floor and walls', it.area, 200 * 100 + 2 * (200 + 100) * 40, 1e-6);
  near('vertical pocket: lid area is the opening', it.lidArea, 20000, 1e-6);
  near('vertical pocket: stretch', it.stretch, 44000 / 20000, 1e-9);
  check('vertical pocket: has a floor', !it.through);
  check('vertical pocket: lid lies in the plate', Math.abs(it.lid.n[2] - 1) < 1e-12 && it.lid.c.every(c => Math.abs(c) < 1e-9) && it.lid.rms < 1e-9, JSON.stringify(it.lid.c));
  check('vertical pocket: seed on the floor', Math.abs(it.seed[2] + 40) < 1e-9, it.seed);
  // every rim vertex sits on the rectangle's edge
  check('vertical pocket: rim on the opening', it.rim.every(v => { const x = m.pos[3 * v], y = m.pos[3 * v + 1]; return m.pos[3 * v + 2] === 0 && (Math.abs(Math.abs(x) - 100) < 1e-9 || Math.abs(Math.abs(y) - 50) < 1e-9); }));
}
{
  const f = find(mesh(pocket({ draft: 8 })));
  check('drafted pocket: found', f.length === 1);
  near('drafted pocket: width', f[0].width, 100, 1e-6);
  near('drafted pocket: depth', f[0].depth, 40, 1e-6);
}
{
  const f = find(mesh({ W: 900, H: 600, surf: (u, v) => { const R = 1500, a = u / R; return [R * Math.sin(a), v, R * Math.cos(a) - R]; },
    holes: [{ u0: -120, u1: 120, v0: -60, v1: 60, depth: 35, draft: 6 }] }));
  check('curved pocket: found', f.length === 1);
  near('curved pocket: length, as the chord seen square to the lid', f[0].length, 2 * 1500 * Math.sin(120 / 1500), 1e-6);
  near('curved pocket: width', f[0].width, 120, 1e-6);
  check('curved pocket: the lid follows the curve', f[0].lid.rms < 0.05 && Math.abs(f[0].lid.c[3] + 1 / 3000) < 2e-5, 'rms ' + f[0].lid.rms + ' c3 ' + f[0].lid.c[3]);
}

/* ---- 2. what is left as it is ---- */
check('a dish wider than the ball: nothing', find(mesh({ W: 1000, H: 1000, holes: [{ u0: -200, u1: 200, v0: -200, v1: 200, depth: 20, draft: 4 }] })).length === 0);
check('a dent shallower than 5 mm: nothing', find(mesh(pocket({ depth: 3, draft: 2 }))).length === 0);
check('a groove running off the panel: nothing, it is not ringed', find(mesh({ W: 800, H: 600, holes: [{ u0: -400, u1: 400, v0: -30, v1: 30, depth: 25, draft: 5 }] })).length === 0);
{
  const m = mesh(pocket());
  check('a smaller ball fits: nothing', find(m, { diameter: 60 }).length === 0);
}

{
  // a dimple the ball cannot reach the floor of, but only 3 mm deep
  const m = mesh({ W: 400, H: 400, step: 5, holes: [{ u0: -20, u1: 20, v0: -20, v1: 20, depth: 3, draft: 1 }] });
  check('a dimple the ball bridges, shallower than 5 mm: nothing', find(m).length === 0);
}
{
  // a hole wider than the ball is left for a tap to cover
  const m = mesh({ W: 1000, H: 1000, step: 20, holes: [{ u0: -200, u1: 200, v0: -200, v1: 200, depth: 0, through: true }] }), e = PC.buildEdgeMap(m);
  check('a hole wider than the ball: not found', find(m).length === 0);
  const h = PC.faceLocator(m).closest([205, 0, 0]), t = PC.findIntakes(m, e, { diameter: 300, minDepth: 1, at: { face: h.tri, p: h.p, reach: 10 } });
  check('a hole wider than the ball: a tap at its edge covers it', t.length === 1 && t[0].through && Math.abs(t[0].width - 400) < 1e-6, t.length);
}

/* ---- 2b. the surface a lid is fitted to ---- */
// the plate folds away past u = E: round a radius R to 90°, or turning `turn` degrees at once
function fold(E, R, turn) {
  return (u, v) => {
    if (u <= E) return [u, v, 0];
    const s = u - E;
    if (turn) { const a = turn * Math.PI / 180; return [E + s * Math.cos(a), v, -s * Math.sin(a)]; }
    const arc = Math.PI / 2 * R;
    if (s <= arc) { const a = s / R; return [E + R * Math.sin(a), v, -R * (1 - Math.cos(a))]; }
    return [E + R, v, -R - (s - arc)];
  };
}
const beside = o => ({ W: 800, H: 600, step: 10, surf: o, holes: [{ u0: -100, u1: 100, v0: -60, v1: 60, depth: 30, draft: 4 }] });
{
  const f = find(mesh(beside(fold(120, 5))));
  check('a vent 20 mm from a sharp fold: found', f.length === 1 && Math.abs(f[0].width - 120) < 1e-6 && Math.abs(f[0].length - 200) < 1e-6, f.length);
  check('a vent 20 mm from a sharp fold: its lid lies in the plate', f.length === 1 && f[0].lid.rms < 1e-9 && Math.abs(f[0].lid.n[2] - 1) < 1e-12, f[0] && f[0].lid.rms);
  const g = find(mesh(beside(fold(120, 30))));
  check('a vent 20 mm from a rounded fold: found, its lid within 2°', g.length === 1 && g[0].lid.n[2] > Math.cos(2 * Math.PI / 180), g[0] && g[0].lid.n);
}
{
  // a 25° bend 20 mm from the vent: gentle enough to lie on, unless it is a crease
  const m = mesh(beside(fold(120, 0, 25)));
  const loose = find(m);
  for (let f = 0; f < m.tris.length / 3; f++) for (let k = 0; k < 3; k++) {
    const a = m.tris[3 * f + k], b = m.tris[3 * f + (k + 1) % 3];
    if (Math.abs(m.pos[3 * a] - 120) < 1e-9 && Math.abs(m.pos[3 * b] - 120) < 1e-9 && m.pos[3 * a + 2] === 0 && m.pos[3 * b + 2] === 0) m.crease.add(PC.ekey(a, b));
  }
  const creased = find(m);
  check('a bend beside a vent, not creased: the lid leans into it (control)', loose.length === 1 && loose[0].lid.rms > 0.1, loose[0] && loose[0].lid.rms);
  check('the bend creased: the lid stops at the crease, true to the plate', creased.length === 1 && creased[0].lid.rms < 1e-9 && Math.abs(creased[0].lid.n[2] - 1) < 1e-12, creased[0] && creased[0].lid.rms);
}
{
  // a grille of slots with 15 mm bars between: each lid fitted to the bars, not the next slot
  const holes = [-1, 0, 1].map(k => ({ u0: -100, u1: 100, v0: k * 55 - 20, v1: k * 55 + 20, depth: 25, draft: 3 }));
  const f = find(mesh({ W: 600, H: 500, step: 5, holes }));
  check('three slots, 15 mm apart: three found', f.length === 3, f.length);
  check('three slots: each true to size, its lid in the plate', f.length === 3 && f.every(it => Math.abs(it.width - 40) < 1e-6 && Math.abs(it.length - 200) < 1e-6 && Math.abs(it.depth - 25) < 1e-6 && it.lid.rms < 1e-9));
}
{
  // a dimple too shallow to count, 20 mm beside a vent: the vent's lid is
  // fitted to the plate round both, not down into the dimple
  const f = find(mesh({ W: 800, H: 600, step: 5, holes: [{ u0: -100, u1: 100, v0: -50, v1: 50, depth: 30, draft: 4 }, { u0: -15, u1: 15, v0: 70, v1: 100, depth: 4, draft: 11 }] }));
  check('a dimple beside a vent: only the vent, its lid true to the plate', f.length === 1 && Math.abs(f[0].depth - 30) < 1e-6 && f[0].lid.rms < 1e-9, f.length + ' ' + (f[0] && f[0].lid.rms));
}
// a scanned surface: every vertex off by up to 1 or 1.5 mm either way
[1, 1.5].forEach(amp => {
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const s = sheet({ W: 800, H: 600, step: 10, holes: [{ u0: -100, u1: 100, v0: -60, v1: 60, depth: 30, draft: 4 }] }), w = PC.weld(s.pos, s.tris, 1e-6);
  for (let i = 2; i < w.pos.length; i += 3) w.pos[i] += (rnd() - 0.5) * 2 * amp;
  const f = find(PC.makeMesh(w.pos, w.tris));
  check('a scan noisy by ±' + amp + ' mm: the vent found, and only the vent, true to size', f.length === 1 && Math.abs(f[0].width - 120) < 1 && Math.abs(f[0].length - 200) < 1 && Math.abs(f[0].depth - 30) < 2 * amp,
    f.length + ' ' + f.map(x => x.width.toFixed(1) + '×' + x.length.toFixed(1) + '/' + x.depth.toFixed(1)).join(' '));
});

/* ---- 3. through, holes and mirror images ---- */
{
  const m = mesh(pocket({ depth: 30, draft: 6, through: true })), f = find(m);
  check('lip: found, and goes right through', f.length === 1 && f[0].through && f[0].faces.length > 0 && f[0].stretch === null);
  near('lip: depth of the lip', f[0].depth, 30, 1e-6);
  const e = PC.buildEdgeMap(m), borders = f[0].open.filter(k => e.get(k).length === 1).length;
  check('lip: what it leaves open is the lip\'s own edge', borders === f[0].open.length && borders > 0, borders + ' of ' + f[0].open.length);
}
{
  const m = mesh(pocket({ depth: 0, through: true })), f = find(m);
  check('plain hole: found, with no faces of its own', f.length === 1 && f[0].through && f[0].faces.length === 0, f.length && f[0].faces.length);
  near('plain hole: lid spans it', f[0].lidArea, 20000, 1e-6);
  check('plain hole: the panel\'s own outline is not taken for one', f.length === 1);
}
{
  const m = mesh({ W: 1200, H: 600, holes: [{ u0: -400, u1: -200, v0: -50, v1: 50, depth: 30, draft: 5 }, { u0: 200, u1: 400, v0: -50, v1: 50, depth: 30, draft: 5 }, { u0: -60, u1: 60, v0: -40, v1: 40, depth: 20, draft: 4 }] });
  const f = find(m, { plane: { axis: 0, offset: 0 } });
  const pair = f.filter(x => x.twin >= 0), mid = f.filter(x => x.self);
  check('mirror: the two side pockets pair up', pair.length === 2 && f[pair[0].twin] === pair[1] && f[pair[1].twin] === pair[0]);
  check('mirror: the centre pocket is its own mirror image', mid.length === 1 && mid[0].twin < 0);
}

/* ---- 4. a tap on an intake wider than the ball tries a wider one ---- */
{
  const m = mesh({ W: 1400, H: 1400, step: 14, holes: [{ u0: -210, u1: 210, v0: -210, v1: 210, depth: 60, draft: 4 }] });
  const e = PC.buildEdgeMap(m), loc = PC.faceLocator(m), hit = loc.closest([0, 0, -60]);
  check('wide pocket: not found with the ball as set', PC.findIntakes(m, e, { diameter: 300, minDepth: 5 }).length === 0);
  const t = PC.findIntakes(m, e, { diameter: 300, minDepth: 1, at: { face: hit.tri, p: hit.p, reach: 5 } });
  check('wide pocket: a tap in it finds it with a wider ball', t.length === 1 && Math.abs(t[0].width - 420) < 1e-6, t.length && t[0].width);
  const flat = loc.closest([500, 500, 0]);
  check('a tap on flat plate finds nothing', PC.findIntakes(m, e, { diameter: 300, minDepth: 1, at: { face: flat.tri, p: flat.p, reach: 5 } }).length === 0);
}

/* ---- 5. the lid's own triangles ---- */
{
  const m = mesh({ W: 800, H: 600, holes: [{ u0: -130, u1: 70, v0: -45, v1: 55, depth: 25, draft: 3 }] }), it = find(m)[0], lm = it.lm;
  let ccw = true, sum = 0, minAng = 180;
  for (let i = 0; i < lm.tris.length; i += 3) {
    const a = lm.tris[i], b = lm.tris[i + 1], c = lm.tris[i + 2];
    const cr = (lm.x[b] - lm.x[a]) * (lm.y[c] - lm.y[a]) - (lm.y[b] - lm.y[a]) * (lm.x[c] - lm.x[a]);
    if (!(cr > 0)) ccw = false;
    sum += cr / 2;
    [[a, b, c], [b, c, a], [c, a, b]].forEach(([o, p, q]) => {
      const ux = lm.x[p] - lm.x[o], uy = lm.y[p] - lm.y[o], wx = lm.x[q] - lm.x[o], wy = lm.y[q] - lm.y[o];
      minAng = Math.min(minAng, Math.acos((ux * wx + uy * wy) / Math.hypot(ux, uy) / Math.hypot(wx, wy)) * 180 / Math.PI);
    });
  }
  check('lid: every triangle turns the same way', ccw);
  near('lid: triangles fill the opening exactly', sum, lm.flatArea, 1e-6 * lm.flatArea);
  check('lid: the rim keeps its corners exactly', Array.from({ length: lm.rim }, (_, i) => i).every(i => lm.ids[i] >= 0 &&
    Math.abs(lm.pos[3 * i] - m.pos[3 * lm.ids[i]]) < 1e-9 && Math.abs(lm.pos[3 * i + 2] - m.pos[3 * lm.ids[i] + 2]) < 1e-9));
  check('lid: no sliver inside it', minAng > 14, minAng.toFixed(2) + '°');
  check('lid: points inside it', lm.count > lm.rim);
  // outside the opening a point is held to the rim
  const at = PC.lidLocate(lm, 1000, 0);
  check('lid: a point outside is held to the rim', at.held && at.w[2] === 0 && at.v[0] < lm.rim && at.v[1] < lm.rim);
}

/* ---- 6. the unwrap with the lid filled in ---- */
function fitError(m, is, verts, only) {
  // best rigid map from the plate's (x, y) onto the layout, over the vertices
  // given, and the worst miss anywhere (or, with `only`, over those vertices)
  const src = [], dst = [];
  is.global.forEach((g, l) => { if (verts.has(g)) { src.push([m.pos[3 * g], m.pos[3 * g + 1]]); dst.push([is.U[2 * l], is.U[2 * l + 1]]); } });
  const ms = [0, 1].map(k => src.reduce((s, p) => s + p[k], 0) / src.length), md = [0, 1].map(k => dst.reduce((s, p) => s + p[k], 0) / dst.length);
  let best = Infinity;
  [1, -1].forEach(flip => {
    let sc = 0, cr = 0;
    src.forEach((p, i) => { const a = [p[0] - ms[0], flip * (p[1] - ms[1])], b = [dst[i][0] - md[0], dst[i][1] - md[1]]; sc += a[0] * b[0] + a[1] * b[1]; cr += a[0] * b[1] - a[1] * b[0]; });
    const th = Math.atan2(cr, sc), c = Math.cos(th), s = Math.sin(th);
    const miss = (x, y) => [c * (x - ms[0]) - s * flip * (y - ms[1]) + md[0], s * (x - ms[0]) + c * flip * (y - ms[1]) + md[1]];
    let worst = 0;
    is.global.forEach((g, l) => { if (only && !verts.has(g)) return; const q = miss(m.pos[3 * g], m.pos[3 * g + 1]); worst = Math.max(worst, Math.hypot(q[0] - is.U[2 * l], q[1] - is.U[2 * l + 1])); });
    best = Math.min(best, worst);
  });
  return best;
}
[['vertical walls', {}], ['drafted walls', { draft: 8 }], ['a lip', { depth: 30, draft: 6, through: true }]].forEach(([name, h]) => {
  const m = mesh(pocket(h)), f = find(m), faces = allFaces(m), opts = { mode: 'arap', iterations: 26, sweeps: 8 };
  const filled = PC.flattenFilled(m.pos, faces, f.map(it => ({ faces: it.faces, lm: it.lm })), opts);
  const plain = PC16.flattenIsland(m.pos, faces, opts);
  const surface = new Set(); for (let v = 0; v < m.pos.length / 3; v++) if (m.pos[3 * v + 2] === 0) surface.add(v);
  near('filled, ' + name + ': the plate lies flat, true to size', fitError(m, filled, surface), 0, 1e-8);
  near('filled, ' + name + ': stretch leaves the walls out', filled.distortion.mean, 1, 1e-9);
  check('filled, ' + name + ': the intake is projected', filled.projected > 0 && filled.cover.F.length > 0);
  check('v16, ' + name + ': flattening the walls moves the plate (control)', fitError(m, plain, surface) > 5, fitError(m, plain, surface));
});
{
  // planar mode, and an undercut held to the edge of the opening
  const m = mesh(pocket({ under: 20 })), f = find(m), it = f[0];
  const filled = PC.flattenFilled(m.pos, allFaces(m), [{ faces: it.faces, lm: it.lm }], { mode: 'planar' });
  const rimSet = new Set(it.rim), floor = [];
  filled.global.forEach((g, l) => { if (m.pos[3 * g + 2] < -39) floor.push([m.pos[3 * g], m.pos[3 * g + 1], filled.U[2 * l], filled.U[2 * l + 1]]); });
  // with the plate's layout known, every floor point must print inside the opening
  const surf = new Set(); for (let v = 0; v < m.pos.length / 3; v++) if (m.pos[3 * v + 2] === 0) surf.add(v);
  near('undercut, planar: the plate still lies true', fitError(m, filled, surf, true), 0, 1e-8);
  // the floor pushed out under the rim cannot print where it lies: it is held to the rim, 20 mm in
  near('undercut, planar: the furthest floor point is held back by the undercut', fitError(m, filled, surf), 20, 1e-8);
  const xs = [], ys = [];
  filled.global.forEach((g, l) => { if (rimSet.has(g)) { xs.push(filled.U[2 * l]); ys.push(filled.U[2 * l + 1]); } });
  const bx = [Math.min(...xs), Math.max(...xs)], by = [Math.min(...ys), Math.max(...ys)];
  check('undercut: the floor under the rim is held inside the opening', floor.every(p => p[2] >= bx[0] - 1e-9 && p[2] <= bx[1] + 1e-9 && p[3] >= by[0] - 1e-9 && p[3] <= by[1] + 1e-9));
  check('undercut: some of it is held to the edge', floor.filter(p => Math.abs(p[2] - bx[0]) < 1e-9 || Math.abs(p[2] - bx[1]) < 1e-9).length > 0);
}

/* ---- 7. a straight line across an intake ---- */
{
  const m = mesh(pocket()), f = find(m), faces = allFaces(m), nT = m.tris.length / 3, opts = { mode: 'arap', iterations: 26, sweeps: 8 };
  const filled = PC.flattenFilled(m.pos, faces, f.map(it => ({ faces: it.faces, lm: it.lm })), opts), plain = PC16.flattenIsland(m.pos, faces, opts);
  const scale = 0.9 / Math.max(filled.w, filled.h), projected = new Uint8Array(nT);
  f.forEach(it => it.faces.forEach(x => { projected[x] = 1; }));
  function model(core, is, proj) {
    const uv = new Float64Array(6 * nT), list = [];
    for (let j = 0; j < nT; j++) { list.push(j); for (let c = 0; c < 3; c++) { const l = is.F[3 * j + c]; uv[6 * j + 2 * c] = 0.05 + is.U[2 * l] * scale; uv[6 * j + 2 * c + 1] = 0.05 + is.U[2 * l + 1] * scale; } }
    const loc = core.faceLocator(m);
    return { pos: m.pos, tris: m.tris, edgeMap: core.buildEdgeMap(m), uv, panel: m.panel, islands: new Map([[0, list]]), index: new Map([[0, 0]]),
      locate: q => loc.closest(q), scale, edge: 10, projected: proj };
  }
  const m17 = model(PC, filled, projected), m16 = model(PC16, plain);
  [[[-230, -20, 0], [230, 35, 0]], [[-120, -80, 0], [150, 90, 0]]].forEach((ln, i) => {
    const path = { nodes: ln.map(p => ({ p, hin: null, hout: null })), closed: false }, o = { reach: 0.002, tol: 0.05 * scale };
    function measure(d) {
      let stray = 0, floor = 0;
      for (let k = 0; k < d.samples.faces.length; k++) {
        if (d.samples.faces[k] < 0) continue;
        const x = d.samples.pts[3 * k], y = d.samples.pts[3 * k + 1], z = d.samples.pts[3 * k + 2];
        if (z < -39.9) floor++;
        else stray = Math.max(stray, Math.abs((x - ln[0][0]) * (ln[1][1] - ln[0][1]) - (y - ln[0][1]) * (ln[1][0] - ln[0][0])) / Math.hypot(ln[1][0] - ln[0][0], ln[1][1] - ln[0][1]));
      }
      return { stray, floor, segs: d.islands[0].segs };
    }
    const a = measure(VC.derive(m17, path, o)), b = measure(VC16.derive(m16, path, o));
    check('line ' + (i + 1) + ': prints as one straight line', a.segs.length === 1 && a.segs[0].line, a.segs.length);
    near('line ' + (i + 1) + ': runs straight on the plate', a.stray, 0, 1e-6);
    check('line ' + (i + 1) + ': drops onto the floor of the intake', a.floor >= 10, a.floor);
    check('line ' + (i + 1) + ', v16: bends round the intake on the plate (control)', b.stray > 3, b.stray);
  });
}

/* ---- 8. found again after seams and rebuilds ---- */
function cut(m, pts) {
  const e = PC.buildEdgeMap(m), loc = PC.faceLocator(m);
  const r = PC.traceSeam(m, e, pts.map(p => { const h = loc.closest(p); return { tri: h.tri, p: h.p }; }), false, null);
  PC.applyCuts(m, r.chords, e);
  const e2 = PC.buildEdgeMap(m), cp = PC.computePanels(m, e2), ids = PC.assignPanelIds(cp.comps, m.panel);
  m.panel = Array.from(cp.label, l => ids[l]);
}
{
  const m = mesh(pocket({ draft: 6 })), it = find(m)[0], r = record(m, it);
  cut(m, [[-400, 200, 0], [400, 170, 0]]);
  const res = PC.resolveIntake(m, PC.buildEdgeMap(m), r, PC.faceLocator(m));
  check('a seam elsewhere: found again, all of it', !!res && Math.abs(area(m, res.faces) - it.area) < 1e-6);
}
{
  const m = mesh(pocket({ draft: 6 })), r = record(m, find(m)[0]);
  cut(m, [[-400, 0, 0], [-100, 0, 0], [-90, 0, -40], [90, 0, -40], [100, 0, 0], [400, 0, 0]]);
  check('a seam through it: no longer an intake', PC.resolveIntake(m, PC.buildEdgeMap(m), r, PC.faceLocator(m)) === null);
}
{
  const m = mesh(pocket({ draft: 6 })), it = find(m)[0], r = record(m, it);
  for (let i = 0; i < it.rim.length; i++) m.crease.add(PC.ekey(it.rim[i], it.rim[(i + 1) % it.rim.length]));
  [7, 14, 22].forEach(size => {
    const job = PC.remesher(PC.cloneMesh(m), { panels: [0], edgeMap: PC.buildEdgeMap(m), edgeLength: size });
    while (job.step() < 1);
    const out = job.finish(), m2 = { pos: out.pos, tris: out.tris, panel: out.panel, cut: out.cut, crease: out.crease, quad: out.quad };
    const res = PC.resolveIntake(m2, PC.buildEdgeMap(m2), r, PC.faceLocator(m2));
    check('rebuilt at ' + size + ' mm with its rim creased: found again', !!res && Math.abs(area(m2, res.faces) - it.area) < 1e-6 * it.area, res && area(m2, res.faces));
  });
}
[['plain hole', { depth: 0, through: true }], ['lip', { depth: 25, draft: 4, through: true }]].forEach(([name, h]) => {
  const m = mesh(pocket(h)), it = find(m)[0], r = record(m, it);
  cut(m, [[-400, 200, 0], [400, 170, 0]]);
  const res = PC.resolveIntake(m, PC.buildEdgeMap(m), r, PC.faceLocator(m));
  check(name + ' after a seam: found again, open edges and all', !!res && res.faces.length === it.faces.length && res.open.length === it.open.length);
});

/* ---- 9. suggested seams treat intakes as covered ---- */
function covered(m, f) {
  const e = PC.buildEdgeMap(m), loc = PC.faceLocator(m);
  return f.map(it => { const res = PC.resolveIntake(m, e, record(m, it), loc); return { faces: res.faces, open: res.open, lm: PC.lidMesh(m.pos, res.loop, it.lid, it.edge) }; });
}
{
  const m = mesh({ W: 1200, H: 600, holes: [{ u0: -500, u1: 500, v0: -125, v1: 125, depth: 20, draft: 0.001, through: true }] }), e = PC.buildEdgeMap(m);
  const base = { unit: 1, width: 1340, space: 0.4, up: [0, 0, 1], forward: [1, 0, 0] };
  const a = PC16.suggestSplits(m, e, base), b = PC.suggestSplits(m, e, Object.assign({}, base, { intakes: covered(m, find(m)) })), c = PC.suggestSplits(m, e, base);
  check('long lip: v16 splits round its walls (control)', a.length > 0 && a[0].kind === 'turn');
  check('long lip, covered: no seam round it', b.length === 0, b.map(s => s.kind).join());
  check('suggestions with no intakes: exactly as v16', JSON.stringify(a) === JSON.stringify(c));
}
{
  const m = mesh({ W: 1500, H: 1500, step: 15, holes: [{ u0: -200, u1: 200, v0: -60, v1: 60, depth: 60, draft: 3 }] }), e = PC.buildEdgeMap(m);
  const base = { unit: 1, width: 1340, space: 0.4, up: [0, 0, 1], forward: [1, 0, 0] };
  const a = PC16.suggestSplits(m, e, base), b = PC.suggestSplits(m, e, Object.assign({}, base, { intakes: covered(m, find(m)) }));
  check('over the roll, v16: the walls add to its width (control)', a.length === 1 && a[0].width > 1510, a[0] && a[0].width);
  check('over the roll, covered: split at its true width', b.length === 1 && Math.abs(b[0].width - 1500) < 1, b[0] && b[0].width);
}

{
  // an L with a lipped opening near its inner corner: covered, the opening
  // offers no corners of its own, and the L is split at its own corner
  const m = mesh({ W: 1500, H: 1500, step: 25, holes: [{ u0: 100, u1: 800, v0: 100, v1: 800, depth: 0, through: true }, { u0: -150, u1: 50, v0: -150, v1: 50, depth: 30, draft: 5, through: true }] }), e = PC.buildEdgeMap(m);
  const base = { unit: 1, width: 1340, space: 0.4, up: [0, 0, 1], forward: [1, 0, 0] };
  const f = PC.findIntakes(m, e, { diameter: 500, minDepth: 5 });
  // the lids as Find gives them, and as found again on the mesh
  [['as found', f.map(it => ({ faces: it.faces, open: it.open, lm: it.lm }))], ['found again', covered(m, f)]].forEach(([how, lids]) => {
    const b = PC.suggestSplits(m, e, Object.assign({}, base, { intakes: lids }));
    check('an L, a lip by its corner, covered (' + how + '): split along the L\'s own corner', b.length === 1 && b[0].paths.length > 0 && b[0].paths.every(p => p.points.every(q => Math.abs(q[1] - 100) < 1e-6)),
      b.map(x => x.kind + ' ' + x.paths.map(p => p.points[0].map(v => v.toFixed(1)).join(',')).join(';')).join(' | '));
  });
}

/* ---- 10. the topology check leaves projected faces out ---- */
{
  // 2 mm of draft over 40 mm of depth: the corners of the walls are slivers, the plate has none
  const m = mesh(pocket({ draft: 2 })), f = find(m), e = PC.buildEdgeMap(m), skip = new Set(f[0].faces);
  const a = PC.topologyReport(m, e, {}), b = PC.topologyReport(m, e, { skipFace: x => skip.has(x) }), c = PC16.topologyReport(m, e, {});
  check('topology: the intake\'s slivers counted when flattened', a.panels[0].slivers > 0 && a.bad.every(x => skip.has(x)), a.panels[0].slivers);
  check('topology: not counted when projected', b.panels[0].slivers === 0 && b.panels[0].faces === a.panels[0].faces - skip.size, b.panels[0].slivers);
  check('topology with nothing left out: exactly as v16', JSON.stringify(a) === JSON.stringify(c));
}

/* ---- 11. mirrored twins carry the lids; islands and outlines ---- */
{
  // laid out clockwise, the mirror image of the part: separateTwin turns it back over
  const island = { U: Float64Array.from([0, 1, 2, 1, 0, 0]), F: Int32Array.from([0, 1, 2]), global: [0, 1, 2], nf: 1, nv: 3, w: 2, h: 1, area3: 1, distortion: { mean: 1, worst: 1 },
    cover: { U: Float64Array.from([0.5, 0.25, 1.5, 0.25, 1, 0.75]), F: Int32Array.from([0, 1, 2]) } };
  const m = { pos: [0, 0, 0, 2, 0, 0, 0, -1, 0], tris: [0, 1, 2] };
  const t = PC.separateTwin(island, m, { up: [0, 1, 0], forward: [1, 0, 0] });
  check('separate twin: the lids are flipped with it', t.flipped >= 0 && t.cover && t.cover.U.length === 6 &&
    Array.from(t.cover.U).every((v, i) => Math.abs(v - (i % 2 === t.flipped ? (t.flipped ? 1 : 2) - island.cover.U[i] : island.cover.U[i])) < 1e-12), JSON.stringify(t.cover && Array.from(t.cover.U)));
  const plainT = PC.separateTwin(Object.assign({}, island, { cover: undefined }), m, { up: [0, 1, 0], forward: [1, 0, 0] });
  check('separate twin with no lids: none made up', plainT.cover === undefined && plainT.flipped === t.flipped);
  const t16 = PC16.separateTwin(Object.assign({}, island, { cover: undefined }), m, { up: [0, 1, 0], forward: [1, 0, 0] });
  check('separate twin with no lids: exactly as v16', JSON.stringify(plainT) === JSON.stringify(t16));
  check('separate twin: the part itself flipped as v16 flips it', JSON.stringify(Array.from(t.U)) === JSON.stringify(Array.from(t16.U)) && t.flipped === 0);
}
{
  const uv = [0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1], tris = [0, 1, 2, 1, 3, 2];
  const base = VC.islandRegion(uv, tris, [0, 1], 0), withLid = VC.islandRegion(uv, tris, [0, 1], 0, [2, 2, 3, 2, 2, 3]);
  check('island region: lids added as triangles, anticlockwise', withLid.length === base.length + 1 && VC.polyArea(withLid[withLid.length - 1]) > 0);
  check('island region with no lids: as v16', JSON.stringify(base) === JSON.stringify(VC16.islandRegion(uv, tris, [0, 1], 0)) &&
    JSON.stringify(VC.islandRegion(uv, tris, [0, 1], 0.01)) === JSON.stringify(VC16.islandRegion(uv, tris, [0, 1], 0.01)));
}
{
  const m = mesh(pocket({ depth: 0, through: true })), it = find(m)[0], nT = m.tris.length / 3, uv = new Float64Array(6 * nT), faces = [];
  for (let f = 0; f < nT; f++) { faces.push(f); for (let c = 0; c < 3; c++) { uv[6 * f + 2 * c] = m.pos[3 * m.tris[3 * f + c]]; uv[6 * f + 2 * c + 1] = m.pos[3 * m.tris[3 * f + c] + 1]; } }
  const a = VC.islandOutline(uv, m.tris, faces), b = VC.islandOutline(uv, m.tris, faces, new Set(it.open));
  check('cut line: a hole makes a loop of its own', a.length === 2 && a.every(l => l.closed));
  check('cut line: covered, the hole is skipped', b.length === 1 && b[0].closed && b[0].pts.length === a.reduce((s, l) => Math.max(s, l.pts.length), 0));
}

{
  // two mirrored panels with a pocket each: the twin borrows its partner's
  // layout, and the lids over its intakes with it
  const m = mesh({ W: 1200, H: 600, holes: [{ u0: -400, u1: -200, v0: -50, v1: 50, depth: 30, draft: 5 }, { u0: 200, u1: 400, v0: -50, v1: 50, depth: 30, draft: 5 }] });
  cut(m, [[0, 300, 0], [0, -300, 0]]);
  const f = find(m, { plane: { axis: 0, offset: 0 } }), L = f.find(it => it.centre[0] < 0), R = f.find(it => it.centre[0] > 0);
  const of = id => { const fl = []; for (let x = 0; x < m.tris.length / 3; x++) if (m.panel[x] === id) fl.push(x); return fl; };
  const fl = of(L.panel), fr = of(R.panel), local = new Map(fl.map((x, i) => [x, i]));
  const faces = new Int32Array(3 * fl.length);
  fl.forEach((x, i) => { for (let c = 0; c < 3; c++) faces[3 * i + c] = m.tris[3 * x + c]; });
  const rep = PC.flattenFilled(m.pos, faces, [{ faces: L.faces.map(x => local.get(x)), lm: L.lm }], { mode: 'arap', iterations: 26, sweeps: 8 });
  rep.faceList = fl; rep.panel = L.panel;
  const tw = PC.mirrorIsland(rep, m, fr, 0, 0);
  check('mirror twin: two panels, a pocket in each', f.length === 2 && L.panel !== R.panel && L.twin >= 0, f.length);
  check('mirror twin: laid out as its partner, lids and all', !!tw && tw.shared && tw.cover === rep.cover && tw.residual < 1e-9, tw && tw.residual);
  const plain = PC.mirrorIsland(Object.assign({}, rep, { cover: undefined }), m, fr, 0, 0);
  check('mirror twin with no lids: none made up', !!plain && plain.cover === undefined && JSON.stringify(Array.from(plain.U)) === JSON.stringify(Array.from(tw.U)));
}

/* ---- 12. the built-in bumper, its generator taken from the page ---- */
{
  const bumperBody = appFunction(PAGE, 'bumperBody', { PC });
  const m = bumperBody(), e = PC.buildEdgeMap(m), plane = PC.detectMirror(m);
  check('bumper: symmetric across its width', plane.axis === 2 && plane.score > 0.99);
  check('bumper: faces look out the front', (() => { let a = 0, s = 0; for (let f = 0; f < m.tris.length / 3; f++) { const n = PC.faceNormal(m, f), w = PC.faceArea(m, f); a += w; s += w * n[0]; } return s / a > 0.5; })());
  const f = PC.findIntakes(m, e, { diameter: 300, minDepth: 5, plane: { axis: plane.axis, offset: plane.offset } });
  const vents = f.filter(x => !x.through), grille = f.filter(x => x.through);
  check('bumper: two vents and a grille', f.length === 3 && vents.length === 2 && grille.length === 1, f.length);
  check('bumper: the vents are each other\'s mirror image', vents.length === 2 && f[vents[0].twin] === vents[1]);
  check('bumper: the grille goes right through, on the centre line', grille.length === 1 && grille[0].self && grille[0].faces.length > 0);
  check('bumper: the vents measure the same, their rims mirror images', vents.length === 2 && Math.abs(vents[0].width - vents[1].width) < 1e-9 && Math.abs(vents[0].length - vents[1].length) < 1e-9 &&
    vents[0].rim.length === vents[1].rim.length && (() => {
      const key = (v, mir) => { const p = [m.pos[3 * v], m.pos[3 * v + 1], m.pos[3 * v + 2]]; if (mir) p[plane.axis] = 2 * plane.offset - p[plane.axis]; return p.map(x => x.toFixed(6)).join(); };
      const a = new Set(vents[0].rim.map(v => key(v))); return vents[1].rim.every(v => a.has(key(v, true)));
    })(), vents.map(v => v.length + ' × ' + v.width).join(' / '));
  check('bumper: vent 100 mm tall and 50 mm deep', vents.every(v => Math.abs(v.width - 100) < 5 && Math.abs(v.depth - 50) < 2), vents.map(v => v.width.toFixed(1) + '/' + v.depth.toFixed(1)).join(' '));
  check('bumper: grille 600 × 150 mm', grille.length === 1 && Math.abs(grille[0].length - 600) < 2 && Math.abs(grille[0].width - 150) < 2);
}

L.done();
