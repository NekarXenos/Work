'use strict';
// Synthetic surfaces with intakes of known size, for the geometry tier.
// A sheet over (u, v) in millimetres, lifted by surf(u, v) = [x, y, z].
// Each opening has rim grid lines on the surface and floor grid lines
// inset from them by its draft (0 gives vertical walls: the two lines lie
// together and the wall stands between them). The floor is sunk `depth`
// along the surface normal; `through` leaves the floor out; `under` pushes
// the floor out beneath the rim by that much at each end.
function sheet(o) {
  const W = o.W, H = o.H, step = o.step || 10, holes = o.holes || [];
  const surf = o.surf || ((u, v) => [u, v, 0]);
  function axis(lo, hi, which) {
    const L = [];
    for (let x = lo; x <= hi + 1e-9; x += step) L.push({ x: +x.toFixed(9), kind: 'grid' });
    // openings that share an edge share its lines
    const add = (x, kind, side, hole) => {
      const same = L.find(l => l.kind === kind && l.side === side && Math.abs(l.x - x) < 1e-9);
      if (same) same.holes.push(hole); else L.push({ x, kind, side, holes: [hole] });
    };
    holes.forEach((h, hi2) => {
      const a = which === 'u' ? h.u0 : h.v0, b = which === 'u' ? h.u1 : h.v1;
      const d = which === 'u' ? (h.draftU != null ? h.draftU : h.draft || 0) : (h.draftV != null ? h.draftV : h.draft || 0);
      add(a, 'rim', 0, hi2); add(b, 'rim', 1, hi2); add(a + d, 'floor', 0, hi2); add(b - d, 'floor', 1, hi2);
    });
    const special = L.filter(l => l.kind !== 'grid');
    const keep = L.filter(l => l.kind !== 'grid' || special.every(s => Math.abs(s.x - l.x) > 0.3 * step));
    // at one place: a left rim before its floor, a right floor before its rim
    const rank = l => l.kind === 'grid' ? 1 : l.side === 0 ? (l.kind === 'rim' ? 0 : 2) : (l.kind === 'floor' ? 0 : 2);
    keep.sort((p, q) => p.x - q.x || rank(p) - rank(q));
    return keep;
  }
  const U = axis(-W / 2, W / 2, 'u'), V = axis(-H / 2, H / 2, 'v');
  function range(L, h) {
    let a = -1, b = -1;
    L.forEach((l, i) => { if (l.kind === 'floor' && l.holes.indexOf(h) >= 0) { if (l.side === 0) a = i; else b = i; } });
    return [a, b];
  }
  const fr = holes.map((h, i) => ({ u: range(U, i), v: range(V, i) }));
  function normal(u, v) {
    const e = 1e-3, a = surf(u + e, v), b = surf(u - e, v), c = surf(u, v + e), d = surf(u, v - e);
    const du = [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dv = [c[0] - d[0], c[1] - d[1], c[2] - d[2]];
    const n = [du[1] * dv[2] - du[2] * dv[1], du[2] * dv[0] - du[0] * dv[2], du[0] * dv[1] - du[1] * dv[0]];
    const l = Math.hypot(n[0], n[1], n[2]);
    return [n[0] / l, n[1] / l, n[2] / l];
  }
  const floorOf = (i, j) => { for (let k = 0; k < holes.length; k++) if (i >= fr[k].u[0] && i <= fr[k].u[1] && j >= fr[k].v[0] && j <= fr[k].v[1]) return k; return -1; };
  const pos = [], nv = V.length, id = (i, j) => i * nv + j;
  for (let i = 0; i < U.length; i++) for (let j = 0; j < V.length; j++) {
    const u = U[i].x, v = V[j].x, k = floorOf(i, j);
    let p = surf(u, v);
    if (k >= 0) {
      const h = holes[k], n = normal(u, v);
      p = [p[0] - n[0] * h.depth, p[1] - n[1] * h.depth, p[2] - n[2] * h.depth];
      if (h.under) {
        const t = surf(u + 1, v), s = surf(u, v), eu = [t[0] - s[0], t[1] - s[1], t[2] - s[2]], l = Math.hypot(eu[0], eu[1], eu[2]);
        const kk = (u - (h.u0 + h.u1) / 2) / ((h.u1 - h.u0) / 2) * h.under;
        p = [p[0] + eu[0] / l * kk, p[1] + eu[1] / l * kk, p[2] + eu[2] / l * kk];
      }
    }
    pos.push(p[0], p[1], p[2]);
  }
  const tris = [];
  for (let i = 0; i + 1 < U.length; i++) for (let j = 0; j + 1 < V.length; j++) {
    const ks = [floorOf(i, j), floorOf(i + 1, j), floorOf(i + 1, j + 1), floorOf(i, j + 1)];
    if (ks[0] >= 0 && ks.every(k => k === ks[0]) && holes[ks[0]].through) continue;
    const a = id(i, j), b = id(i + 1, j), c = id(i + 1, j + 1), d = id(i, j + 1);
    tris.push(a, b, c, a, c, d);
  }
  return { pos, tris };
}
module.exports = { sheet };
