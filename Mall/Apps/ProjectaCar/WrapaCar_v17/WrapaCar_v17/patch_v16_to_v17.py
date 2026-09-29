#!/usr/bin/env python3
"""WrapaCar v16 -> v17: intakes projected from their lids.

Atomic patch. Every edit names an anchor that has to occur exactly the
expected number of times in the file as it stands when that edit comes up;
any mismatch aborts before a byte is written. MUST_VANISH and MUST_REMAIN
then scan the whole assembled file, and the three version stamps have to be
there once each. The source's CRLF line endings are kept.

    python3 patch_v16_to_v17.py [WrapaCar_v16.html] [WrapaCar_v17.html]
"""
import hashlib
import sys

# the shipped v16, byte for byte: the edits are written against exactly it
SRC_SHA256 = 'ffa4851a9b133cbfbc79efd06fec5915ab300f109c45f1ab1487182b4499651f'

EDITS = [
    ("title stamp",
     r'''<title>WrapaCar v16 — Retopology</title>''',
     r'''<title>WrapaCar v17 — Intakes</title>''',
     1),
    ("brand stamp",
     r'''<span class="tag">panels, vinyl seams and vector art · v16</span>''',
     r'''<span class="tag">panels, vinyl seams, intakes and vector art · v17</span>''',
     1),
    ("mode button",
     r'''        <button data-mode="crease">Crease<span class="long"> line</span></button>
''',
     r'''        <button data-mode="crease">Crease<span class="long"> line</span></button>
        <button data-mode="intake">Intake<span class="long">s</span></button>
''',
     1),
    ("bumper model option",
     r'''          <option value="box">Rounded box</option>
''',
     r'''          <option value="box">Rounded box</option>
          <option value="bumper">Bumper with intakes</option>
''',
     1),
    ("intakes section",
     r'''      <section class="sec" id="retopoSec">
''',
     r'''      <section class="sec" id="intakeSec">
        <h2>Intakes</h2>
        <p class="hintline" style="margin-top:0">Vinyl is laid flat over an intake, a vent or a grille, then heated and pressed into it. <b>Find intakes</b> rolls a ball as wide as the widest intake over the wrap panels: wherever it cannot touch is a negative space. Each one accepted gets a lid over its opening, fitted to the surface round it, and the artwork is projected straight down from the lid into it.</p>
        <label class="field"><span>Widest intake, across its narrow side</span>
          <div class="unit"><input type="number" id="intakeWidth" min="10" max="5000" step="10" value="300"><span>mm</span></div></label>
        <div class="row"><button class="btn sm" id="intakeFindBtn">Find intakes</button></div>
        <p class="hintline">Dents shallower than 5 mm, and dips not ringed by the panel, are left as they are. In <b>Intakes</b> mode, tap one the search missed to add it, or tap a projected one to take it away.</p>
        <p class="hintline">An opening that goes right through is covered: the artwork runs across it and the cut line skips it. Trim it and tuck the edge on the car.</p>
        <label class="check"><input type="checkbox" id="intakeProject" checked> Project artwork across intakes</label>
        <p class="hintline">Untick to compare with flattening the panels as they are, walls and all.</p>
        <div class="readout" role="status"><span>Intakes projected</span><b id="statIntakes">0</b></div>
        <p class="hintline" id="intakeNote" role="status"></p>
        <div class="row"><button class="btn sm warn" id="intakeClearBtn" disabled>Clear intakes</button></div>
      </section>

      <section class="sec" id="retopoSec">
''',
     1),
    ("view: intake lids",
     r'''        <label class="check"><input type="checkbox" id="showCreases" checked> Crease lines</label>
''',
     r'''        <label class="check"><input type="checkbox" id="showCreases" checked> Crease lines</label>
        <label class="check"><input type="checkbox" id="showIntakes"> Intake lids</label>
''',
     1),
    ("intake review card",
     r'''      <section class="review" id="retopoReview" role="region" aria-labelledby="retopoTitle" hidden>
''',
     r'''      <section class="review" id="intakeReview" role="region" aria-labelledby="intakeTitle" hidden>
        <h2 id="intakeTitle">Intakes found</h2>
        <p>Accept one to lay a lid over its opening and project the artwork down into it; reject it to flatten it with its panel. Stretch ×1.6 means the vinyl over the opening grows to 1.6 times its area.</p>
        <ul class="slist" id="intakeList"></ul>
        <div class="row">
          <button class="btn primary" id="intakeAcceptAll">Accept all</button>
          <button class="btn" id="intakeRejectAll">Reject all</button>
        </div>
        <p class="hintline">Select one to view it. Undo cut takes an acceptance back.</p>
      </section>

      <section class="review" id="retopoReview" role="region" aria-labelledby="retopoTitle" hidden>
''',
     1),
    ("PanelCore: intakes",
     r'''  /* ---------------------------------------------------------- diagnostics */
  function checkManifold(mesh) {''',
     r'''  /* ------------------------------------------------------------ intakes */
  // An intake, a vent or a grille is a negative space in a panel: the vinyl
  // is laid flat across it, then heated and pressed in. A ball as wide as
  // the widest intake, rolled over the outside of the surface, finds them —
  // wherever it cannot touch, the surface falls away beneath the vinyl.
  // Each gets a lid across its opening, fitted to the surface round it, and
  // its panel is flattened as if the lid filled it flush. The intake's own
  // faces then take their layout from the lid, carried straight along its
  // normal: a planar projection square to the lid, like a slide projector.

  // Vertex normals, each the area-weighted mean of its faces'.
  function areaNormals(P, T) {
    var N = new Float64Array(P.length), f, k;
    for (f = 0; f < T.length / 3; f++) {
      var a = 3 * T[3 * f], b = 3 * T[3 * f + 1], c = 3 * T[3 * f + 2];
      var ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
      var vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      for (k = 0; k < 3; k++) { var v = 3 * T[3 * f + k]; N[v] += nx; N[v + 1] += ny; N[v + 2] += nz; }
    }
    for (var i = 0; i < N.length; i += 3) {
      var l = Math.hypot(N[i], N[i + 1], N[i + 2]);
      if (l > 1e-300) { N[i] /= l; N[i + 1] /= l; N[i + 2] /= l; }
    }
    return N;
  }

  // Squared distance from (x, y, z) to the triangle on vertices a, b, c,
  // with nothing allocated (Ericson's closest point).
  function triDist2(P, a, b, c, x, y, z) {
    var ax = P[3 * a], ay = P[3 * a + 1], az = P[3 * a + 2];
    var bx = P[3 * b], by = P[3 * b + 1], bz = P[3 * b + 2];
    var cx = P[3 * c], cy = P[3 * c + 1], cz = P[3 * c + 2];
    var abx = bx - ax, aby = by - ay, abz = bz - az, acx = cx - ax, acy = cy - ay, acz = cz - az;
    var d1 = abx * (x - ax) + aby * (y - ay) + abz * (z - az), d2 = acx * (x - ax) + acy * (y - ay) + acz * (z - az);
    var qx, qy, qz, t;
    if (d1 <= 0 && d2 <= 0) { qx = ax; qy = ay; qz = az; }
    else {
      var d3 = abx * (x - bx) + aby * (y - by) + abz * (z - bz), d4 = acx * (x - bx) + acy * (y - by) + acz * (z - bz);
      if (d3 >= 0 && d4 <= d3) { qx = bx; qy = by; qz = bz; }
      else {
        var vc = d1 * d4 - d3 * d2;
        if (vc <= 0 && d1 >= 0 && d3 <= 0) { t = d1 / (d1 - d3 || 1e-300); qx = ax + t * abx; qy = ay + t * aby; qz = az + t * abz; }
        else {
          var d5 = abx * (x - cx) + aby * (y - cy) + abz * (z - cz), d6 = acx * (x - cx) + acy * (y - cy) + acz * (z - cz);
          if (d6 >= 0 && d5 <= d6) { qx = cx; qy = cy; qz = cz; }
          else {
            var vb = d5 * d2 - d1 * d6;
            if (vb <= 0 && d2 >= 0 && d6 <= 0) { t = d2 / (d2 - d6 || 1e-300); qx = ax + t * acx; qy = ay + t * acy; qz = az + t * acz; }
            else {
              var va = d3 * d6 - d5 * d4;
              if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
                t = (d4 - d3) / ((d4 - d3) + (d5 - d6) || 1e-300);
                qx = bx + t * (cx - bx); qy = by + t * (cy - by); qz = bz + t * (cz - bz);
              } else {
                var den = 1 / (va + vb + vc || 1e-300), s = vb * den, w = vc * den;
                qx = ax + abx * s + acx * w; qy = ay + aby * s + acy * w; qz = az + abz * s + acz * w;
              }
            }
          }
        }
      }
    }
    return (qx - x) * (qx - x) + (qy - y) * (qy - y) + (qz - z) * (qz - z);
  }

  // A test for "does the surface come within R2 of (x, y, z)?", answered
  // through a tree of boxes round the faces: a ball resting on the surface
  // only ever opens the few boxes under the point it rests on, and a ball
  // biting into it stops at the first face it finds.
  function ballProbe(mesh) {
    var P = mesh.pos, T = mesh.tris, n = T.length / 3, f, k, i;
    var fb = new Float64Array(6 * n), fc = new Float64Array(3 * n), ord = new Int32Array(n);
    for (f = 0; f < n; f++) {
      ord[f] = f;
      for (k = 0; k < 3; k++) {
        var a = P[3 * T[3 * f] + k], b = P[3 * T[3 * f + 1] + k], c = P[3 * T[3 * f + 2] + k];
        fb[6 * f + k] = Math.min(a, b, c); fb[6 * f + 3 + k] = Math.max(a, b, c); fc[3 * f + k] = (a + b + c) / 3;
      }
    }
    var cap = Math.max(1, 2 * n), nb = new Float64Array(6 * cap), left = new Int32Array(cap), right = new Int32Array(cap);
    var first = new Int32Array(cap), count = new Int32Array(cap), nodes = 0;
    function make(s, e) {
      var id = nodes++, lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      var clo = [Infinity, Infinity, Infinity], chi = [-Infinity, -Infinity, -Infinity], g;
      for (i = s; i < e; i++) {
        g = ord[i];
        for (k = 0; k < 3; k++) {
          if (fb[6 * g + k] < lo[k]) lo[k] = fb[6 * g + k];
          if (fb[6 * g + 3 + k] > hi[k]) hi[k] = fb[6 * g + 3 + k];
          if (fc[3 * g + k] < clo[k]) clo[k] = fc[3 * g + k];
          if (fc[3 * g + k] > chi[k]) chi[k] = fc[3 * g + k];
        }
      }
      for (k = 0; k < 3; k++) { nb[6 * id + k] = lo[k]; nb[6 * id + 3 + k] = hi[k]; }
      left[id] = right[id] = -1;
      if (e - s <= 6) { first[id] = s; count[id] = e - s; return id; }
      // split at the middle of the widest spread of face centres
      var ax = 0;
      for (k = 1; k < 3; k++) if (chi[k] - clo[k] > chi[ax] - clo[ax]) ax = k;
      var mid = (clo[ax] + chi[ax]) / 2, m = s;
      for (i = s; i < e; i++) {
        g = ord[i];
        if (fc[3 * g + ax] < mid) { ord[i] = ord[m]; ord[m] = g; m++; }
      }
      if (m === s || m === e) m = (s + e) >> 1;
      count[id] = 0;
      var l = make(s, m), r = make(m, e);
      left[id] = l; right[id] = r;
      return id;
    }
    if (n) make(0, n);
    var stack = [];
    return function (x, y, z, R2) {
      if (!n) return false;
      var rr = R2 * R2, sp = 0;
      stack[sp++] = 0;
      while (sp) {
        var id = stack[--sp], o = 6 * id;
        var dx = Math.max(nb[o] - x, 0, x - nb[o + 3]), dy = Math.max(nb[o + 1] - y, 0, y - nb[o + 4]);
        var dz = Math.max(nb[o + 2] - z, 0, z - nb[o + 5]);
        if (dx * dx + dy * dy + dz * dz >= rr) continue;
        if (left[id] < 0) {
          for (var q = first[id], end = first[id] + count[id]; q < end; q++) {
            var g = ord[q], p = 6 * g;
            var ex = Math.max(fb[p] - x, 0, x - fb[p + 3]), ey = Math.max(fb[p + 1] - y, 0, y - fb[p + 4]);
            var ez = Math.max(fb[p + 2] - z, 0, z - fb[p + 5]);
            if (ex * ex + ey * ey + ez * ez >= rr) continue;
            if (triDist2(P, T[3 * g], T[3 * g + 1], T[3 * g + 2], x, y, z) < rr) return true;
          }
          continue;
        }
        stack[sp++] = left[id]; stack[sp++] = right[id];
      }
      return false;
    };
  }

  // How far each vertex in `verts` lies below the reach of a ball of radius
  // r rolled over the outside of the surface: 0 where the ball touches it,
  // growing as the surface falls away beneath it, Infinity where no ball
  // comes near. Every vertex round them offers the ball resting on it, its
  // centre r out along the vertex normal — or, where that one bites into
  // the surface (on a sharp edge, say), along one of its faces' normals. A
  // ball that bites anywhere — deeper than opts.slack, on a rough surface —
  // is dropped, and a vertex's depth is its gap to the nearest ball kept. Balls are tried at no less than opts.spacing
  // apart, and at no more than opts.budget vertices: past that, one per
  // cell of a grid, and `spacing` says how far apart. Between balls their
  // envelope sags by about spacing² / 4r.
  function touchDepths(mesh, r, verts, opts) {
    opts = opts || {};
    var P = mesh.pos, T = mesh.tris, nV = P.length / 3, nT = T.length / 3, v, i, k;
    var N = opts.normals || areaNormals(P, T), probe = opts.probe || ballProbe(mesh);
    var lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (i = 0; i < verts.length; i++) for (k = 0; k < 3; k++) {
      var x = P[3 * verts[i] + k];
      if (x < lo[k]) lo[k] = x;
      if (x > hi[k]) hi[k] = x;
    }
    var near = [];
    for (v = 0; v < nV; v++) {
      var o = 3 * v;
      if (P[o] < lo[0] - 2 * r || P[o] > hi[0] + 2 * r || P[o + 1] < lo[1] - 2 * r || P[o + 1] > hi[1] + 2 * r ||
        P[o + 2] < lo[2] - 2 * r || P[o + 2] > hi[2] + 2 * r) continue;
      near.push(v);
    }
    var budget = opts.budget || 60000, tried = near, spacing = opts.edge || 0, thinned = false;
    var s = Math.max(opts.spacing || 0, r * 1e-4);
    if (near.length > budget || (opts.spacing || 0) > spacing) {
      var cells;
      for (;;) {
        cells = new Map();
        for (i = 0; i < near.length; i++) {
          v = near[i];
          var key = cellKey(Math.floor(P[3 * v] / s), Math.floor(P[3 * v + 1] / s), Math.floor(P[3 * v + 2] / s));
          if (!cells.has(key)) cells.set(key, v);
        }
        if (cells.size <= budget) break;
        s *= 1.25;
      }
      tried = Array.from(cells.values()); spacing = s; thinned = true;
    }
    // each vertex's faces, for the balls resting on a face
    var start = null, list = null;
    function faceLists() {
      start = new Int32Array(nV + 1); list = new Int32Array(3 * nT);
      var f, fill = new Int32Array(nV);
      for (f = 0; f < 3 * nT; f++) start[T[f] + 1]++;
      for (f = 0; f < nV; f++) start[f + 1] += start[f];
      for (f = 0; f < nT; f++) for (var c = 0; c < 3; c++) { var w = T[3 * f + c]; list[start[w] + fill[w]++] = f; }
    }
    // a ball may press into a rough surface by its roughness (opts.slack)
    var R = r - Math.max(r * 1e-3, opts.slack || 0), centres = [];
    function rest(w, nx, ny, nz) {
      var bx = P[3 * w] + r * nx, by = P[3 * w + 1] + r * ny, bz = P[3 * w + 2] + r * nz;
      if (probe(bx, by, bz, R)) return false;
      centres.push(bx, by, bz);
      return true;
    }
    for (i = 0; i < tried.length; i++) {
      v = tried[i];
      var nx = N[3 * v], ny = N[3 * v + 1], nz = N[3 * v + 2];
      if (nx * nx + ny * ny + nz * nz > 0.25 && rest(v, nx, ny, nz)) continue;
      if (!start) faceLists();
      var seenN = [[nx, ny, nz]];
      for (var q = start[v]; q < start[v + 1]; q++) {
        var fn = faceNormal(mesh, list[q]), dup = false;
        if (!(fn[0] || fn[1] || fn[2])) continue;
        for (var d = 0; d < seenN.length && !dup; d++) if (fn[0] * seenN[d][0] + fn[1] * seenN[d][1] + fn[2] * seenN[d][2] > 0.996) dup = true;
        if (dup) continue;
        seenN.push(fn);
        if (rest(v, fn[0], fn[1], fn[2])) break;
      }
    }
    var inv = 1 / r, grid = new Map();
    for (i = 0; i < centres.length; i += 3) {
      var ck = cellKey(Math.floor(centres[i] * inv), Math.floor(centres[i + 1] * inv), Math.floor(centres[i + 2] * inv));
      var b2 = grid.get(ck);
      if (!b2) grid.set(ck, b2 = []);
      b2.push(i);
    }
    // nearest ball kept, by squared distance; a ball resting right on the
    // vertex ends the search
    var depth = new Float64Array(nV).fill(NaN), touch = r * r * (1 + 1e-9);
    for (i = 0; i < verts.length; i++) {
      v = verts[i];
      var px = P[3 * v], py = P[3 * v + 1], pz = P[3 * v + 2], best = Infinity;
      var gx = Math.floor(px * inv), gy = Math.floor(py * inv), gz = Math.floor(pz * inv);
      search: for (var a = -1; a <= 1; a++) for (var b = -1; b <= 1; b++) for (var c = -1; c <= 1; c++) {
        var cl = grid.get(cellKey(gx + a, gy + b, gz + c));
        if (!cl) continue;
        for (var j = 0; j < cl.length; j++) {
          var g = cl[j], ux = centres[g] - px, uy = centres[g + 1] - py, uz = centres[g + 2] - pz;
          var dd = ux * ux + uy * uy + uz * uz;
          if (dd < best) { best = dd; if (best <= touch) break search; }
        }
      }
      var dist = Math.sqrt(best) - r;
      depth[v] = dist < 0 ? 0 : dist;
    }
    return { depth: depth, spacing: spacing, thinned: thinned, balls: centres.length / 3, tried: tried.length };
  }

  // Edge keys as closed loops of vertex ids, in walking order. Null unless
  // they all make simple loops: every vertex on exactly two of them.
  function edgeLoops(keys) {
    var adj = new Map(), bad = false, loops = [];
    keys.forEach(function (k) {
      var c = k.indexOf(':'), a = +k.slice(0, c), b = +k.slice(c + 1);
      if (!adj.has(a)) adj.set(a, []);
      if (!adj.has(b)) adj.set(b, []);
      adj.get(a).push(b); adj.get(b).push(a);
    });
    adj.forEach(function (ns) { if (ns.length !== 2 || ns[0] === ns[1]) bad = true; });
    if (bad) return null;
    var seen = new Set();
    adj.forEach(function (_, s) {
      if (bad || seen.has(s)) return;
      var loop = [s], prev = -1, cur = s;
      seen.add(s);
      for (;;) {
        var ns = adj.get(cur), nx = ns[0] !== prev ? ns[0] : ns[1];
        if (nx === s) break;
        if (seen.has(nx)) { bad = true; return; }
        loop.push(nx); seen.add(nx); prev = cur; cur = nx;
      }
      if (loop.length < 3) { bad = true; return; }
      loops.push(loop);
    });
    return bad ? null : loops;
  }

  // Distance from a point to a polyline in space (x, y, z runs), Infinity
  // beyond `cap`. Its segments are bucketed in cells `cap` wide.
  function polylineField(line, cap) {
    var inv = 1 / cap, grid = new Map(), n = line.length / 3, i, a;
    for (i = 0; i + 1 < n; i++) {
      var o = 3 * i, lo = [], hi = [];
      for (a = 0; a < 3; a++) {
        lo.push(Math.floor(Math.min(line[o + a], line[o + 3 + a]) * inv));
        hi.push(Math.floor(Math.max(line[o + a], line[o + 3 + a]) * inv));
      }
      if ((hi[0] - lo[0] + 1) * (hi[1] - lo[1] + 1) * (hi[2] - lo[2] + 1) > 4096) continue;
      for (var x = lo[0]; x <= hi[0]; x++) for (var y = lo[1]; y <= hi[1]; y++) for (var z = lo[2]; z <= hi[2]; z++) {
        var key = cellKey(x, y, z), b = grid.get(key);
        if (!b) grid.set(key, b = []);
        b.push(i);
      }
    }
    return function (px, py, pz) {
      var gx = Math.floor(px * inv), gy = Math.floor(py * inv), gz = Math.floor(pz * inv), best = Infinity;
      for (var dx = -1; dx <= 1; dx++) for (var dy = -1; dy <= 1; dy++) for (var dz = -1; dz <= 1; dz++) {
        var b = grid.get(cellKey(gx + dx, gy + dy, gz + dz));
        if (!b) continue;
        for (var j = 0; j < b.length; j++) {
          var s = 3 * b[j], ex = line[s + 3] - line[s], ey = line[s + 4] - line[s + 1], ez = line[s + 5] - line[s + 2];
          var ee = ex * ex + ey * ey + ez * ez;
          var t = ee > 0 ? Math.max(0, Math.min(1, ((px - line[s]) * ex + (py - line[s + 1]) * ey + (pz - line[s + 2]) * ez) / ee)) : 0;
          var d = Math.hypot(line[s] + ex * t - px, line[s + 1] + ey * t - py, line[s + 2] + ez * t - pz);
          if (d < best) best = d;
        }
      }
      return best <= cap ? best : Infinity;
    };
  }

  // A small dense linear system, by elimination with partial pivoting.
  function solveSmall(A, b) {
    var n = b.length, M = A.map(function (row, i) { return row.concat([b[i]]); }), i, j, k;
    for (i = 0; i < n; i++) {
      var p = i;
      for (j = i + 1; j < n; j++) if (Math.abs(M[j][i]) > Math.abs(M[p][i])) p = j;
      var t = M[i]; M[i] = M[p]; M[p] = t;
      if (!(Math.abs(M[i][i]) > 1e-300)) return null;
      for (j = i + 1; j < n; j++) {
        var f = M[j][i] / M[i][i];
        for (k = i; k <= n; k++) M[j][k] -= f * M[i][k];
      }
    }
    var x = new Array(n).fill(0);
    for (i = n - 1; i >= 0; i--) {
      var s = M[i][n];
      for (k = i + 1; k < n; k++) s -= M[i][k] * x[k];
      x[i] = s / M[i][i];
    }
    return x;
  }

  // A lid for an opening: a frame — o the middle of the rim, n the mean
  // normal of the surface round it, ex along the opening's length — and a
  // height field over that plane, z = c0 + c1·x + c2·y + c3·x² + c4·xy + c5·y²,
  // fitted by least squares to the rim and the surface round it (`ring`,
  // vertex ids). In POV-Ray's terms a height_field patch laid over the hole.
  // rms: how far that surface strays from the field.
  function fitLid(P, rim, ring, normal) {
    var n = norm(normal), o = [0, 0, 0], i, k;
    if (len(n) < 0.5) return null;
    rim.forEach(function (v) { o = add(o, getV(P, v)); });
    o = mul(o, 1 / rim.length);
    var t0 = perp(n), t1 = cross(n, t0), sxx = 0, sxy = 0, syy = 0;
    rim.forEach(function (v) {
      var d = sub(getV(P, v), o), x = dot(d, t0), y = dot(d, t1);
      sxx += x * x; sxy += x * y; syy += y * y;
    });
    var th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    var ex = norm(add(mul(t0, Math.cos(th)), mul(t1, Math.sin(th)))), ey = cross(n, ex);
    var L = Math.sqrt((sxx + syy) / rim.length) || 1, A = [], b = [0, 0, 0, 0, 0, 0], pts = rim.concat(ring);
    for (i = 0; i < 6; i++) A.push([0, 0, 0, 0, 0, 0]);
    pts.forEach(function (v) {
      var d = sub(getV(P, v), o), x = dot(d, ex) / L, y = dot(d, ey) / L, z = dot(d, n), phi = [1, x, y, x * x, x * y, y * y];
      for (var r = 0; r < 6; r++) { b[r] += phi[r] * z; for (var c = 0; c < 6; c++) A[r][c] += phi[r] * phi[c]; }
    });
    // a light pull toward flat keeps a thin ring from inventing a bowl
    for (k = 3; k < 6; k++) A[k][k] += 1e-3 * pts.length;
    var c = solveSmall(A, b) || [b[0] / Math.max(1, pts.length), 0, 0, 0, 0, 0];
    var lid = { o: o, n: n, ex: ex, ey: ey, c: [c[0], c[1] / L, c[2] / L, c[3] / (L * L), c[4] / (L * L), c[5] / (L * L)] };
    var ss = 0;
    ring.forEach(function (v) { var q = lidCoords(lid, getV(P, v)), e = q[2] - lidHeight(lid, q[0], q[1]); ss += e * e; });
    lid.rms = ring.length ? Math.sqrt(ss / ring.length) : 0;
    return lid;
  }
  function lidHeight(lid, x, y) {
    var c = lid.c;
    return c[0] + c[1] * x + c[2] * y + c[3] * x * x + c[4] * x * y + c[5] * y * y;
  }
  // a point in the lid's frame: [along ex, along ey, along n]
  function lidCoords(lid, p) {
    var d = sub(p, lid.o);
    return [dot(d, lid.ex), dot(d, lid.ey), dot(d, lid.n)];
  }

  // Does the closed polygon (X, Y) cross itself?
  function selfCrossing(X, Y) {
    var n = X.length;
    function orient(a, b, c) { return (X[b] - X[a]) * (Y[c] - Y[a]) - (Y[b] - Y[a]) * (X[c] - X[a]); }
    for (var i = 0; i < n; i++) {
      var a = i, b = (i + 1) % n;
      for (var j = i + 2; j < n; j++) {
        var c = j, d = (j + 1) % n;
        if (d === a) continue;
        var o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b);
        if (((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0))) return true;
      }
    }
    return false;
  }

  // Ear clipping of a simple counter-clockwise polygon, by index into X, Y.
  // Only corners that turn count; the caller puts back points lying on a
  // straight stretch.
  function earClip2(X, Y, idx) {
    var out = [], L, i, guard = 0, scale = 0;
    idx = idx.slice();
    for (i = 0; i < idx.length; i++) scale = Math.max(scale, Math.abs(X[idx[i]]), Math.abs(Y[idx[i]]));
    var eps = 1e-12 * scale * scale;
    function cr(a, b, c) { return (X[b] - X[a]) * (Y[c] - Y[a]) - (Y[b] - Y[a]) * (X[c] - X[a]); }
    while ((L = idx.length) > 3 && guard++ < 4 * L * L) {
      var ear = -1;
      for (i = 0; i < L && ear < 0; i++) {
        var a = idx[(i + L - 1) % L], b = idx[i], c = idx[(i + 1) % L];
        if (cr(a, b, c) <= eps) continue;
        var clear = true;
        for (var j = 0; j < L && clear; j++) {
          var q = idx[j];
          if (q === a || q === b || q === c) continue;
          if (cr(a, b, q) >= -eps && cr(b, c, q) >= -eps && cr(c, a, q) >= -eps) clear = false;
        }
        if (clear) ear = i;
      }
      if (ear < 0) {
        // nothing clean left: take the widest corner
        var best = -Infinity;
        for (i = 0; i < L; i++) {
          var w = cr(idx[(i + L - 1) % L], idx[i], idx[(i + 1) % L]);
          if (w > best) { best = w; ear = i; }
        }
      }
      out.push(idx[(ear + L - 1) % L], idx[ear], idx[(ear + 1) % L]);
      idx.splice(ear, 1);
    }
    if (idx.length === 3) out.push(idx[0], idx[1], idx[2]);
    return out;
  }

  // The lid as triangles. The rim is seen square to the lid, filled with
  // points about `spacing` apart and triangulated inside it, Delaunay
  // fashion, then lifted on to the height field. The rim keeps its own
  // corners exactly, so the lid meets the surface round it with no gap; the
  // field is eased on to them from inside. Null when the rim, seen square
  // to the lid, crosses itself. The first `rim` vertices are the rim's, with
  // their mesh ids in `ids` (the rest -1).
  function lidMesh(P, rim, lid, spacing) {
    var n = rim.length, X = [], Y = [], Z = [], ids = rim.slice(), i, j, k;
    if (n < 3) return null;
    for (i = 0; i < n; i++) { var q = lidCoords(lid, getV(P, rim[i])); X.push(q[0]); Y.push(q[1]); Z.push(q[2]); }
    var a2 = 0;
    for (i = 0; i < n; i++) a2 += X[i] * Y[(i + 1) % n] - X[(i + 1) % n] * Y[i];
    if (!(Math.abs(a2) > 0)) return null;
    if (a2 < 0) { X.reverse(); Y.reverse(); Z.reverse(); ids.reverse(); }
    if (selfCrossing(X, Y)) return null;
    var x0 = Math.min.apply(null, X), x1 = Math.max.apply(null, X), y0 = Math.min.apply(null, Y), y1 = Math.max.apply(null, Y);
    var span = Math.max(x1 - x0, y1 - y0), eps = 1e-9 * span;
    // corners that turn are ear-clipped; points on a straight stretch go
    // back in afterwards, splitting the edge they lie on
    var turn = [], flat = [];
    for (i = 0; i < n; i++) {
      var p = (i + n - 1) % n, s = (i + 1) % n;
      var c = (X[i] - X[p]) * (Y[s] - Y[p]) - (Y[i] - Y[p]) * (X[s] - X[p]);
      var l2 = Math.hypot(X[s] - X[p], Y[s] - Y[p]);
      if (Math.abs(c) <= 1e-9 * l2 * l2) flat.push(i); else turn.push(i);
    }
    if (turn.length < 3) return null;
    var T2 = earClip2(X, Y, turn);
    // triangles as a list with directed-edge lookup
    var tris = [], alive = [], edge = new Map(), M = 1 << 21;
    function put(a, b, c) {
      var t = tris.length / 3;
      tris.push(a, b, c); alive.push(1);
      edge.set(a * M + b, t); edge.set(b * M + c, t); edge.set(c * M + a, t);
      return t;
    }
    function kill(t) {
      alive[t] = 0;
      for (var e = 0; e < 3; e++) {
        var a = tris[3 * t + e], b = tris[3 * t + (e + 1) % 3];
        if (edge.get(a * M + b) === t) edge.delete(a * M + b);
      }
    }
    function third(t, a, b) {
      for (var e = 0; e < 3; e++) { var v = tris[3 * t + e]; if (v !== a && v !== b) return v; }
      return -1;
    }
    for (i = 0; i < T2.length; i += 3) {
      var ta = T2[i], tb = T2[i + 1], tc = T2[i + 2];
      if ((X[tb] - X[ta]) * (Y[tc] - Y[ta]) - (Y[tb] - Y[ta]) * (X[tc] - X[ta]) < 0) put(ta, tc, tb); else put(ta, tb, tc);
    }
    // each flat rim point splits the rim edge it lies on: walking round
    // from a corner, that edge runs from the point before it to the next
    // corner
    var isTurn = new Uint8Array(n);
    turn.forEach(function (x) { isTurn[x] = 1; });
    for (k = 1; k < n; k++) {
      var fv = (turn[0] + k) % n;
      if (isTurn[fv]) continue;
      var fu = (fv + n - 1) % n, fw = fv;
      do { fw = (fw + 1) % n; } while (!isTurn[fw]);
      var ti = edge.get(fu * M + fw);
      if (ti === undefined) return null;
      var op = third(ti, fu, fw);
      kill(ti); put(fu, fv, op); put(fv, fw, op);
    }
    // points inside, on a staggered grid, kept clear of the rim
    var pts = [];
    function inside(x, y) {
      var c = false;
      for (var a = 0, b = n - 1; a < n; b = a++) {
        if ((Y[a] > y) !== (Y[b] > y) && x < (X[b] - X[a]) * (y - Y[a]) / (Y[b] - Y[a]) + X[a]) c = !c;
      }
      return c;
    }
    function rimGap(x, y) {
      var best = Infinity;
      for (var a = 0; a < n; a++) {
        var b = (a + 1) % n, ex = X[b] - X[a], ey = Y[b] - Y[a], ee = ex * ex + ey * ey;
        var t = ee > 0 ? Math.max(0, Math.min(1, ((x - X[a]) * ex + (y - Y[a]) * ey) / ee)) : 0;
        best = Math.min(best, Math.hypot(X[a] + ex * t - x, Y[a] + ey * t - y));
      }
      return best;
    }
    var h = spacing > 0 ? spacing : span / 8, area = Math.abs(a2) / 2;
    while (area / (h * h * 0.866) > 3000) h *= 1.2;
    var hs = h * Math.sqrt(3) / 2, row = 0;
    for (var y = y0 + hs / 2; y < y1; y += hs, row++) {
      for (var x = x0 + (row & 1 ? h / 2 : h / 4); x < x1; x += h) {
        // a hair off the grid, so no point lands exactly on an edge
        var jx = x + h * 1e-3 * Math.sin(row * 12.9898 + x * 78.233), jy = y + h * 1e-3 * Math.cos(row * 4.1414 + x * 17.17);
        if (inside(jx, jy) && rimGap(jx, jy) >= 0.45 * h) pts.push([jx, jy]);
      }
    }
    function incircle(a, b, c, d) {
      var ax = X[a] - X[d], ay = Y[a] - Y[d], bx = X[b] - X[d], by = Y[b] - Y[d], cx = X[c] - X[d], cy = Y[c] - Y[d];
      return (ax * ax + ay * ay) * (bx * cy - cx * by) - (bx * bx + by * by) * (ax * cy - cx * ay) + (cx * cx + cy * cy) * (ax * by - bx * ay);
    }
    function orient(a, b, c) { return (X[b] - X[a]) * (Y[c] - Y[a]) - (Y[b] - Y[a]) * (X[c] - X[a]); }
    // make the edge a→b of triangle t locally Delaunay, and so on outward
    function legalize(stack) {
      var guard = 0;
      while (stack.length && guard++ < 200000) {
        var e = stack.pop(), a = e[0], b = e[1], t = edge.get(a * M + b), u = edge.get(b * M + a);
        if (t === undefined || u === undefined || !alive[t] || !alive[u]) continue;
        var c = third(t, a, b), d = third(u, b, a);
        if (c < 0 || d < 0 || incircle(a, b, c, d) <= 1e-12 * span * span * span * span) continue;
        // only a convex pair can be flipped
        if (orient(c, a, d) <= 0 || orient(d, b, c) <= 0) continue;
        kill(t); kill(u);
        put(c, a, d); put(d, b, c);
        stack.push([a, d], [d, b], [b, c], [c, a]);
      }
    }
    for (k = 0; k < pts.length; k++) {
      var m = X.length, px = pts[k][0], py = pts[k][1];
      X.push(px); Y.push(py); Z.push(NaN); ids.push(-1);
      var at = -1;
      for (var t = 0; t < alive.length && at < 0; t++) {
        if (!alive[t]) continue;
        var A = tris[3 * t], B = tris[3 * t + 1], C = tris[3 * t + 2];
        if (orient(A, B, m) >= -eps * span && orient(B, C, m) >= -eps * span && orient(C, A, m) >= -eps * span) at = t;
      }
      if (at < 0) { X.pop(); Y.pop(); Z.pop(); ids.pop(); continue; }
      var t0a = tris[3 * at], t0b = tris[3 * at + 1], t0c = tris[3 * at + 2];
      kill(at);
      put(t0a, t0b, m); put(t0b, t0c, m); put(t0c, t0a, m);
      legalize([[t0a, t0b], [t0b, t0c], [t0c, t0a]]);
    }
    // and every edge once more, for the triangles the ear clipping made
    var all = [];
    for (t = 0; t < alive.length; t++) if (alive[t]) for (k = 0; k < 3; k++) all.push([tris[3 * t + k], tris[3 * t + (k + 1) % 3]]);
    legalize(all);
    var out = [];
    for (t = 0; t < alive.length; t++) if (alive[t]) out.push(tris[3 * t], tris[3 * t + 1], tris[3 * t + 2]);
    // heights: the rim's own; inside, the field eased on to the rim's
    var cnt = X.length, off = new Float64Array(cnt), nb = [];
    for (i = 0; i < cnt; i++) nb.push([]);
    for (i = 0; i < out.length; i += 3) for (k = 0; k < 3; k++) { var e0 = out[i + k], e1 = out[i + (k + 1) % 3]; nb[e0].push(e1); nb[e1].push(e0); }
    for (i = 0; i < n; i++) off[i] = Z[i] - lidHeight(lid, X[i], Y[i]);
    for (i = n; i < cnt; i++) {
      var ws = 0, sum = 0;
      for (j = 0; j < n; j++) { var dd = (X[i] - X[j]) * (X[i] - X[j]) + (Y[i] - Y[j]) * (Y[i] - Y[j]) + 1e-30; ws += 1 / dd; sum += off[j] / dd; }
      off[i] = sum / ws;
    }
    for (var it = 0; it < 40; it++) for (i = n; i < cnt; i++) {
      if (!nb[i].length) continue;
      var sm = 0;
      for (j = 0; j < nb[i].length; j++) sm += off[nb[i][j]];
      off[i] = sm / nb[i].length;
    }
    var pos = new Float64Array(3 * cnt);
    for (i = 0; i < cnt; i++) {
      var z = i < n ? Z[i] : lidHeight(lid, X[i], Y[i]) + off[i];
      Z[i] = z;
      for (k = 0; k < 3; k++) pos[3 * i + k] = lid.o[k] + X[i] * lid.ex[k] + Y[i] * lid.ey[k] + z * lid.n[k];
    }
    var area3 = 0;
    for (i = 0; i < out.length; i += 3) {
      var pa = [pos[3 * out[i]], pos[3 * out[i] + 1], pos[3 * out[i] + 2]];
      var pb = [pos[3 * out[i + 1]], pos[3 * out[i + 1] + 1], pos[3 * out[i + 1] + 2]];
      var pc = [pos[3 * out[i + 2]], pos[3 * out[i + 2] + 1], pos[3 * out[i + 2] + 2]];
      area3 += 0.5 * len(cross(sub(pb, pa), sub(pc, pa)));
    }
    return { lid: lid, rim: n, count: cnt, x: Float64Array.from(X), y: Float64Array.from(Y), z: Float64Array.from(Z),
      ids: Int32Array.from(ids), tris: Int32Array.from(out), pos: pos, area: area3, flatArea: area, spacing: h };
  }

  // Where a point in the lid's plane falls on the lid: three of its vertices
  // and their weights. Outside the opening — under an overhang — it is held
  // to the nearest point of the rim, so the print never folds back over the
  // panel.
  function lidLocate(lm, x, y) {
    var X = lm.x, Y = lm.y, T = lm.tris, g = lm._grid, t, i;
    if (!g) {
      var cell = Math.max(lm.spacing, 1e-12), inv = 1 / cell, map = new Map();
      for (t = 0; t < T.length / 3; t++) {
        var xs = [X[T[3 * t]], X[T[3 * t + 1]], X[T[3 * t + 2]]], ys = [Y[T[3 * t]], Y[T[3 * t + 1]], Y[T[3 * t + 2]]];
        var a0 = Math.floor(Math.min.apply(null, xs) * inv), a1 = Math.floor(Math.max.apply(null, xs) * inv);
        var b0 = Math.floor(Math.min.apply(null, ys) * inv), b1 = Math.floor(Math.max.apply(null, ys) * inv);
        for (var ia = a0; ia <= a1; ia++) for (var ib = b0; ib <= b1; ib++) {
          var key = ia + ',' + ib, b = map.get(key);
          if (!b) map.set(key, b = []);
          b.push(t);
        }
      }
      g = lm._grid = { inv: inv, map: map };
    }
    var list = g.map.get(Math.floor(x * g.inv) + ',' + Math.floor(y * g.inv)) || [];
    for (i = 0; i < list.length; i++) {
      t = list[i];
      var A = T[3 * t], B = T[3 * t + 1], C = T[3 * t + 2];
      var den = (Y[B] - Y[C]) * (X[A] - X[C]) + (X[C] - X[B]) * (Y[A] - Y[C]);
      if (!(Math.abs(den) > 1e-300)) continue;
      var wa = ((Y[B] - Y[C]) * (x - X[C]) + (X[C] - X[B]) * (y - Y[C])) / den;
      var wb = ((Y[C] - Y[A]) * (x - X[C]) + (X[A] - X[C]) * (y - Y[C])) / den;
      var wc = 1 - wa - wb, tol = -1e-9;
      if (wa >= tol && wb >= tol && wc >= tol) return { v: [A, B, C], w: [wa, wb, wc], held: false };
    }
    // held to the rim
    var n = lm.rim, best = null, bd = Infinity;
    for (i = 0; i < n; i++) {
      var j = (i + 1) % n, ex = X[j] - X[i], ey = Y[j] - Y[i], ee = ex * ex + ey * ey;
      var s = ee > 0 ? Math.max(0, Math.min(1, ((x - X[i]) * ex + (y - Y[i]) * ey) / ee)) : 0;
      var d = Math.hypot(X[i] + ex * s - x, Y[i] + ey * s - y);
      if (d < bd) { bd = d; best = { v: [i, j, i], w: [1 - s, s, 0], held: true }; }
    }
    return best;
  }

  // The surface round an opening, for fitting its lid: the positive space
  // the vinyl lies on. Faces of `panel` that are not negative space
  // themselves (`skip`: this intake, and any other the ball cannot reach),
  // reached across uncut edges from the rim, lying within `band` of it, and
  // not past a crease or a turn of more than 40° from the surface along the
  // rim — so a vent beside a body line, or near an edge that rolls under,
  // is lidded by the surface it sits in. Their vertices and area-weighted
  // normal.
  function intakeRing(mesh, edgeMap, skip, rim, panel, band) {
    var P = mesh.pos, T = mesh.tris, line = [], i, k, creases = mesh.crease || new Set();
    rim.forEach(function (v) { line.push(P[3 * v], P[3 * v + 1], P[3 * v + 2]); });
    line.push(P[3 * rim[0]], P[3 * rim[0] + 1], P[3 * rim[0] + 2]);
    var near = polylineField(line, band * 1.5), rimSet = new Set(rim), seen = new Set(), stack = [], faces = [], seeds = [];
    for (i = 0; i < rim.length; i++) {
      var fs = edgeMap.get(ekey(rim[i], rim[(i + 1) % rim.length])) || [];
      for (k = 0; k < fs.length; k++) if (!skip.has(fs[k]) && mesh.panel[fs[k]] === panel && !seen.has(fs[k])) { seen.add(fs[k]); seeds.push(fs[k]); }
    }
    var ref = [0, 0, 0];
    seeds.forEach(function (g) { var a = getV(P, T[3 * g]); ref = add(ref, cross(sub(getV(P, T[3 * g + 1]), a), sub(getV(P, T[3 * g + 2]), a))); });
    ref = norm(ref);
    var gentle = function (g) { return !(len(ref) > 0.5) || dot(faceNormal(mesh, g), ref) >= 0.766; };
    seeds.forEach(function (g) { if (gentle(g)) stack.push(g); });
    while (stack.length) {
      var f = stack.pop();
      faces.push(f);
      for (var e = 0; e < 3; e++) {
        var key = ekey(T[3 * f + e], T[3 * f + (e + 1) % 3]);
        if (mesh.cut.has(key) || creases.has(key)) continue;
        var nb = edgeMap.get(key) || [];
        for (var j = 0; j < nb.length; j++) {
          var g = nb[j];
          if (seen.has(g) || skip.has(g) || mesh.panel[g] !== panel) continue;
          var cx = 0, cy = 0, cz = 0;
          for (k = 0; k < 3; k++) { cx += P[3 * T[3 * g + k]]; cy += P[3 * T[3 * g + k] + 1]; cz += P[3 * T[3 * g + k] + 2]; }
          if (!(near(cx / 3, cy / 3, cz / 3) <= band) || !gentle(g)) continue;
          seen.add(g); stack.push(g);
        }
      }
    }
    var verts = [], vs = new Set(), nrm = [0, 0, 0];
    faces.forEach(function (g) {
      var a = getV(P, T[3 * g]), c = cross(sub(getV(P, T[3 * g + 1]), a), sub(getV(P, T[3 * g + 2]), a));
      nrm = add(nrm, c);
      for (k = 0; k < 3; k++) { var v = T[3 * g + k]; if (!vs.has(v) && !rimSet.has(v)) { vs.add(v); verts.push(v); } }
    });
    return { faces: faces, verts: verts, normal: nrm };
  }

  // The negative spaces in a mesh's panels: intakes, vents and grilles, and
  // holes that go right through.
  // opts: diameter — the widest intake, across its narrow side (model
  //   units); minDepth — shallower dents are left be; includePanel(id);
  //   panel — look in that panel only; plane { axis, offset } — pair each
  //   with its mirror image; at { face, p, reach } — only the intake at a
  //   tap, trying a wider ball, up to eight times as wide, where the one
  //   given finds nothing there; budget — most balls to roll.
  // Each found: { panel, faces, rim (vertex ids round the opening), through
  //   (it goes right through), open (edge keys it leaves open), lid, lm (the
  //   lid's triangles), width, length (of the opening), depth, area, lidArea,
  //   stretch (area over lidArea: how far the vinyl over the opening grows),
  //   seed (its deepest point), tol, edge, centre, twin (index or -1), self }.
  function findIntakes(mesh, edgeMap, opts) {
    opts = opts || {};
    edgeMap = edgeMap || buildEdgeMap(mesh);
    var P = mesh.pos, T = mesh.tris, nT = T.length / 3, nV = P.length / 3, panelOf = mesh.panel, f, k, v;
    var include = opts.includePanel || function () { return true; };
    var at = opts.at || null, only = at ? panelOf[at.face] : opts.panel;
    var minDepth = opts.minDepth > 0 ? opts.minDepth : 0;
    var inside = new Uint8Array(nT), verts = [], seen = new Uint8Array(nV), lens = [];
    for (f = 0; f < nT; f++) {
      if (!include(panelOf[f]) || (only != null && panelOf[f] !== only)) continue;
      inside[f] = 1;
      for (k = 0; k < 3; k++) {
        v = T[3 * f + k];
        if (!seen[v]) { seen[v] = 1; verts.push(v); }
        if (f % 7 === 0) lens.push(len(sub(getV(P, v), getV(P, T[3 * f + (k + 1) % 3]))));
      }
    }
    if (!verts.length || !(opts.diameter > 0)) return [];
    lens.sort(function (a, b) { return a - b; });
    var edge = lens[lens.length >> 1] || 1e-3, N = areaNormals(P, T), bounds = meshBounds(P);
    var diag = Math.hypot(bounds.ext[0], bounds.ext[1], bounds.ext[2]) || 1;
    // How rough the surface is: the median gap, along its normal, between a
    // vertex and the middle of its neighbours. On a clean model it is all but
    // nothing; on a scan it is the noise, and a dent no deeper than a few
    // times that is taken for noise.
    var rough = (function () {
      var sum = new Float64Array(3 * nV), cnt = new Uint32Array(nV), gaps = [], i, a, b;
      for (f = 0; f < nT; f++) {
        if (!inside[f]) continue;
        for (k = 0; k < 3; k++) {
          a = T[3 * f + k];
          for (var j = 1; j < 3; j++) { b = T[3 * f + (k + j) % 3]; sum[3 * a] += P[3 * b]; sum[3 * a + 1] += P[3 * b + 1]; sum[3 * a + 2] += P[3 * b + 2]; cnt[a]++; }
        }
      }
      var every = Math.max(1, Math.floor(verts.length / 20000));
      for (i = 0; i < verts.length; i += every) {
        a = verts[i];
        if (!cnt[a]) continue;
        gaps.push(Math.abs((P[3 * a] - sum[3 * a] / cnt[a]) * N[3 * a] + (P[3 * a + 1] - sum[3 * a + 1] / cnt[a]) * N[3 * a + 1] +
          (P[3 * a + 2] - sum[3 * a + 2] / cnt[a]) * N[3 * a + 2]));
      }
      gaps.sort(function (x, y) { return x - y; });
      return gaps.length ? gaps[gaps.length >> 1] : 0;
    })();
    var sizes = [opts.diameter], negative = null;
    if (at) for (k = 0; k < 3; k++) sizes.push(sizes[k] * 2);
    for (var si = 0; si < sizes.length; si++) {
      var found = scan(sizes[si]);
      if (!at) return pair(found);
      var hit = found.filter(function (it) {
        return it.faces.indexOf(at.face) >= 0 || (it.through && !it.faces.length && rimGap(it, at.p) <= (at.reach || 0));
      });
      if (hit.length) return [hit[0]];
    }
    return [];

    function rimGap(it, p) {
      var best = Infinity;
      for (var i = 0; i < it.rim.length; i++) {
        var a = getV(P, it.rim[i]), b = getV(P, it.rim[(i + 1) % it.rim.length]), ab = sub(b, a), dd = dot(ab, ab);
        var t = dd > 0 ? Math.max(0, Math.min(1, dot(sub(p, a), ab) / dd)) : 0;
        best = Math.min(best, len(sub(add(a, mul(ab, t)), p)));
      }
      return best;
    }

    function scan(D) {
      // a wider ball, tried for a tap, needs fewer of them
      var r = D / 2, td = touchDepths(mesh, r, verts, { normals: N, edge: edge, budget: opts.budget,
        spacing: D > opts.diameter ? r / 8 : 0, slack: 3 * rough });
      var sag = td.thinned ? td.spacing * td.spacing / (4 * r) : 0, depth = td.depth;
      var eps = Math.max(0.25 * minDepth, 2 * sag, 4 * rough, 1e-9 * diag);
      var cand = new Uint8Array(nT), comp = new Int32Array(nT).fill(-1), comps = [], out = [], g;
      for (f = 0; f < nT; f++) {
        if (!inside[f]) continue;
        if (depth[T[3 * f]] > eps || depth[T[3 * f + 1]] > eps || depth[T[3 * f + 2]] > eps) cand[f] = 1;
      }
      negative = cand;
      for (f = 0; f < nT; f++) {
        if (!cand[f] || comp[f] >= 0) continue;
        var id = comps.length, list = [f];
        comp[f] = id;
        for (var q = 0; q < list.length; q++) {
          g = list[q];
          for (var e = 0; e < 3; e++) {
            var key = ekey(T[3 * g + e], T[3 * g + (e + 1) % 3]);
            if (mesh.cut.has(key)) continue;
            var fs = edgeMap.get(key) || [];
            for (var j = 0; j < fs.length; j++) {
              var h = fs[j];
              if (cand[h] && comp[h] < 0 && panelOf[h] === panelOf[g]) { comp[h] = id; list.push(h); }
            }
          }
        }
        comps.push(list);
      }
      var claimed = new Set();
      comps.forEach(function (list) {
        var it = describe(list, depth, D);
        if (!it) return;
        out.push(it);
        list.forEach(function (x) { claimed.add(x); });
      });
      holes(D, out, claimed);
      return out;
    }

    // one component of faces the ball cannot reach, as an intake, or null
    function describe(faces, depth, D) {
      var set = new Set(faces), panel = panelOf[faces[0]], rimK = new Set(), openK = new Set(), deepest = -1, i, e;
      for (i = 0; i < faces.length; i++) {
        var g = faces[i];
        for (e = 0; e < 3; e++) {
          var a = T[3 * g + e], b = T[3 * g + (e + 1) % 3], key = ekey(a, b), fs = edgeMap.get(key) || [];
          var others = fs.filter(function (x) { return x !== g; });
          if (fs.length === 2 && set.has(others[0])) continue;
          if (fs.length === 2 && !mesh.cut.has(key) && panelOf[others[0]] === panel) rimK.add(key);
          else openK.add(key);
        }
        for (e = 0; e < 3; e++) { var w = T[3 * g + e]; if (deepest < 0 || depth[w] > depth[deepest]) deepest = w; }
      }
      var rl = edgeLoops(rimK), ol = openK.size ? edgeLoops(openK) : [];
      if (!rl || rl.length !== 1 || !ol) return null;
      var rim = rl[0], rimSet = new Set(rim);
      if (ol.some(function (loop) { return loop.some(function (x) { return rimSet.has(x); }); })) return null;
      return shape(rim, faces, set, panel, Array.from(openK), ol.length > 0, D, deepest);
    }

    // the lid, size and depth of an opening, or null when it cannot take a lid
    function shape(rim, faces, set, panel, open, through, D, deepest) {
      var rl = [], i;
      for (i = 0; i < rim.length; i++) rl.push(len(sub(getV(P, rim[i]), getV(P, rim[(i + 1) % rim.length]))));
      var sorted = rl.slice().sort(function (a, b) { return a - b; }), rimEdge = sorted[sorted.length >> 1] || edge;
      // the opening's width, roughly, for how wide a ring to fit to
      var c0 = [0, 0, 0];
      rim.forEach(function (x) { c0 = add(c0, getV(P, x)); });
      c0 = mul(c0, 1 / rim.length);
      var span = 0;
      rim.forEach(function (x) { span = Math.max(span, len(sub(getV(P, x), c0))); });
      // a first lid from a thin ring gives the width; the lid is then fitted
      // to a ring about as wide as the opening is
      var others = { has: function (g) { return set.has(g) || (negative !== null && negative[g] === 1); } };
      var ring = intakeRing(mesh, edgeMap, others, rim, panel, Math.max(3 * rimEdge, 0.3 * span));
      if (ring.verts.length < 3) return null;
      var lid = fitLid(P, rim, ring.verts, ring.normal);
      if (!lid) return null;
      var X0 = [], Y0 = [];
      rim.forEach(function (x) { var q = lidCoords(lid, getV(P, x)); X0.push(q[0]); Y0.push(q[1]); });
      var w0 = calipers(X0, Y0, hull2(X0, Y0, rim.map(function (_, j) { return j; }))).width;
      ring = intakeRing(mesh, edgeMap, others, rim, panel, Math.max(3 * rimEdge, 0.75 * w0));
      if (ring.verts.length < 3) return null;
      lid = fitLid(P, rim, ring.verts, ring.normal);
      if (!lid) return null;
      var X = [], Y = [];
      rim.forEach(function (x) { var q = lidCoords(lid, getV(P, x)); X.push(q[0]); Y.push(q[1]); });
      var idx = rim.map(function (_, j) { return j; }), cal = calipers(X, Y, hull2(X, Y, idx));
      var width = cal.width, length = cal.length;
      if (!(width > 0)) return null;
      if (!at && width > D * 1.05) return null;
      var lm = lidMesh(P, rim, lid, rimEdge);
      if (!lm) return null;
      var area = 0, depthMax = 0, seed = deepest >= 0 ? getV(P, deepest) : null;
      faces.forEach(function (g) { area += faceArea(mesh, g); });
      var inRim = new Set(rim);
      faces.forEach(function (g) {
        for (var e = 0; e < 3; e++) {
          var x = T[3 * g + e];
          if (inRim.has(x)) continue;
          var q = lidCoords(lid, getV(P, x)), d = lidHeight(lid, q[0], q[1]) - q[2];
          if (d > depthMax) { depthMax = d; seed = getV(P, x); }
        }
      });
      if (!through && depthMax < minDepth) return null;
      return { panel: panel, faces: faces.slice(), rim: rim.slice(), through: through, open: open, lid: lid, lm: lm,
        width: width, length: length, depth: depthMax, area: area, lidArea: lm.area,
        stretch: through ? null : area / lm.area, seed: seed, tol: 0.08 * rimEdge, edge: rimEdge,
        centre: lid.o.slice(), perimeter: rl.reduce(function (s, x) { return s + x; }, 0), twin: -1, self: false };
    }

    // holes: loops of open border inside a panel, other than its outline
    function holes(D, out, claimed) {
      var border = new Map(), cutPanels = new Set();
      mesh.cut.forEach(function (key) { (edgeMap.get(key) || []).forEach(function (x) { cutPanels.add(panelOf[x]); }); });
      edgeMap.forEach(function (fs, key) {
        if (fs.length !== 1 || !inside[fs[0]] || claimed.has(fs[0])) return;
        var p = panelOf[fs[0]];
        if (!border.has(p)) border.set(p, []);
        border.get(p).push(key);
      });
      border.forEach(function (keys, panel) {
        // closed loops among the border's pieces
        var adj = new Map();
        keys.forEach(function (key) {
          var c = key.indexOf(':'), a = +key.slice(0, c), b = +key.slice(c + 1);
          if (!adj.has(a)) adj.set(a, []);
          if (!adj.has(b)) adj.set(b, []);
          adj.get(a).push(key); adj.get(b).push(key);
        });
        var done = new Set(), loops = [];
        keys.forEach(function (key) {
          if (done.has(key)) return;
          var part = [], stack = [key];
          done.add(key);
          while (stack.length) {
            var k2 = stack.pop();
            part.push(k2);
            k2.split(':').forEach(function (x) {
              adj.get(+x).forEach(function (k3) { if (!done.has(k3)) { done.add(k3); stack.push(k3); } });
            });
          }
          var ls = edgeLoops(part);
          if (ls && ls.length === 1) loops.push(ls[0]);
        });
        var cuts = cutPanels.has(panel);
        // without seams, the biggest loop is the panel's own outline
        var outer = -1, most = -1;
        if (!cuts) loops.forEach(function (loop, i) {
          var b = meshBounds(loop.reduce(function (a, x) { a.push(P[3 * x], P[3 * x + 1], P[3 * x + 2]); return a; }, []));
          var dg = Math.hypot(b.ext[0], b.ext[1], b.ext[2]);
          if (dg > most) { most = dg; outer = i; }
        });
        loops.forEach(function (loop, i) {
          if (i === outer) return;
          var open = [];
          for (var j = 0; j < loop.length; j++) open.push(ekey(loop[j], loop[(j + 1) % loop.length]));
          var it = shape(loop, [], new Set(), panel, open, true, D, -1);
          if (it) { it.seed = null; out.push(it); }
        });
      });
    }

    // each with its mirror image, when there is a plane
    function pair(list) {
      var plane = opts.plane;
      if (!plane) return list;
      list.forEach(function (a, i) {
        var m = mirrorPoint(a.centre, plane.axis, plane.offset), tol = Math.max(0.25 * a.width, 2 * a.edge);
        if (len(sub(m, a.centre)) <= tol) { a.self = true; return; }
        if (a.twin >= 0) return;
        var best = -1, bd = tol;
        list.forEach(function (b, j) {
          if (j === i || b.twin >= 0 || b.self || b.through !== a.through) return;
          if (Math.abs(b.lidArea - a.lidArea) > 0.25 * Math.max(a.lidArea, b.lidArea)) return;
          var d = len(sub(b.centre, m));
          if (d <= bd) { bd = d; best = j; }
        });
        if (best >= 0) { a.twin = best; list[best].twin = i; }
      });
      return list;
    }
  }

  // An intake found on an earlier mesh, found again on this one after cuts
  // and rebuilds. rec: { rim (points round the opening), seed (a point on its
  // floor or walls; null for a plain hole), tol, area, perimeter }. Its rim
  // is the loop of edges lying along the rim it had — creases, open border,
  // or edges whose middles lie on it too — and its faces are those reached
  // from the seed without crossing that loop. Null when the rim is broken,
  // the faces leak past it, or they no longer share one panel with the
  // surface round them. Returns { faces, loop, rimKeys, open, panel }.
  function resolveIntake(mesh, edgeMap, rec, locator) {
    var P = mesh.pos, T = mesh.tris, line = [], i, k;
    if (!rec || !rec.rim || rec.rim.length < 3) return null;
    rec.rim.forEach(function (p) { line.push(p[0], p[1], p[2]); });
    line.push(rec.rim[0][0], rec.rim[0][1], rec.rim[0][2]);
    var tolV = 3 * rec.tol, field = polylineField(line, 4 * tolV);
    var onRim = new Map();
    function on(v) {
      var r = onRim.get(v);
      if (r === undefined) onRim.set(v, r = field(P[3 * v], P[3 * v + 1], P[3 * v + 2]) <= tolV);
      return r;
    }
    locator = locator || faceLocator(mesh);
    var start = locator.closest(rec.rim[0]).tri;
    if (start < 0) return null;
    var ring = new Set([start]), stack = [start];
    while (stack.length) {
      var f = stack.pop();
      for (var e = 0; e < 3; e++) {
        var nb = edgeMap.get(ekey(T[3 * f + e], T[3 * f + (e + 1) % 3])) || [];
        for (var j = 0; j < nb.length; j++) {
          var g = nb[j];
          if (ring.has(g) || !(on(T[3 * g]) || on(T[3 * g + 1]) || on(T[3 * g + 2]))) continue;
          ring.add(g); stack.push(g);
        }
      }
    }
    // the rim's edges: those marked (creases, the open border, seams) first,
    // then, if they do not go round, those whose middles lie on it as well
    var strict = new Set(), loose = new Set();
    ring.forEach(function (g) {
      for (var e2 = 0; e2 < 3; e2++) {
        var a = T[3 * g + e2], b = T[3 * g + (e2 + 1) % 3];
        if (!on(a) || !on(b)) continue;
        var key = ekey(a, b), fs = edgeMap.get(key) || [];
        if (fs.length === 1 || mesh.cut.has(key) || (mesh.crease && mesh.crease.has(key))) { strict.add(key); loose.add(key); continue; }
        if (field((P[3 * a] + P[3 * b]) / 2, (P[3 * a + 1] + P[3 * b + 1]) / 2, (P[3 * a + 2] + P[3 * b + 2]) / 2) <= rec.tol) loose.add(key);
      }
    });
    // Walk the rim in order: from each of its vertices, the nearest step on
    // along it. Slivers along the rim leave two ways round a corner; the
    // nearest step takes in every vertex on it.
    var cum = [0], total = 0;
    for (i = 0; i < rec.rim.length; i++) {
      total += len(sub(rec.rim[(i + 1) % rec.rim.length], rec.rim[i]));
      cum.push(total);
    }
    var tOf = new Map();
    function param(v) {
      var t = tOf.get(v);
      if (t !== undefined) return t;
      var p = getV(P, v), bd = Infinity;
      for (var q = 0; q < rec.rim.length; q++) {
        var a = rec.rim[q], ab = sub(rec.rim[(q + 1) % rec.rim.length], a), dd = dot(ab, ab);
        var s = dd > 0 ? Math.max(0, Math.min(1, dot(sub(p, a), ab) / dd)) : 0, d = len(sub(add(a, mul(ab, s)), p));
        if (d < bd) { bd = d; t = cum[q] + s * Math.sqrt(dd); }
      }
      tOf.set(v, t);
      return t;
    }
    function walk(keys) {
      var adj = new Map(), start = -1, st = Infinity;
      keys.forEach(function (key) {
        var c = key.indexOf(':'), a = +key.slice(0, c), b = +key.slice(c + 1);
        if (!adj.has(a)) adj.set(a, []);
        if (!adj.has(b)) adj.set(b, []);
        adj.get(a).push(b); adj.get(b).push(a);
      });
      adj.forEach(function (_, v) { var t = param(v); if (t < st) { st = t; start = v; } });
      if (start < 0 || !(total > 0)) return null;
      var out = [start], seenV = new Set([start]), cur = start, walked = 0;
      for (var guard = 0; guard <= adj.size; guard++) {
        var best = -1, bd = Infinity, tc = param(cur);
        adj.get(cur).forEach(function (w) {
          var dt = ((param(w) - tc) % total + total) % total;
          if (dt > 0 && dt < total / 2 && dt < bd) { bd = dt; best = w; }
        });
        if (best < 0) return null;
        walked += bd;
        if (best === start) return Math.abs(walked - total) <= 0.02 * total && out.length >= 3 ? out : null;
        if (seenV.has(best)) return null;
        seenV.add(best); out.push(best); cur = best;
      }
      return null;
    }
    var loop = walk(strict) || walk(loose);
    if (!loop) return null;
    // every edge along it holds the intake in
    var onLoop = new Set(loop), rimKeys = new Set();
    loose.forEach(function (key) {
      var c = key.indexOf(':');
      if (onLoop.has(+key.slice(0, c)) && onLoop.has(+key.slice(c + 1))) rimKeys.add(key);
    });
    var faces = [];
    if (rec.seed) {
      var s = locator.closest(rec.seed).tri, area = 0, has = new Set([s]);
      if (s < 0) return null;
      stack = [s];
      while (stack.length) {
        var h = stack.pop();
        faces.push(h); area += faceArea(mesh, h);
        if (rec.area > 0 && area > 2 * rec.area + 1e-12) return null;
        for (k = 0; k < 3; k++) {
          var key2 = ekey(T[3 * h + k], T[3 * h + (k + 1) % 3]);
          if (rimKeys.has(key2)) continue;
          (edgeMap.get(key2) || []).forEach(function (x) { if (!has.has(x)) { has.add(x); stack.push(x); } });
        }
      }
      if (rec.area > 0 && area < 0.5 * rec.area) return null;
    }
    var inSet = new Set(faces), panel = -1, ok = true;
    rimKeys.forEach(function (key) {
      (edgeMap.get(key) || []).forEach(function (x) {
        if (inSet.has(x)) return;
        if (panel < 0) panel = mesh.panel[x]; else if (mesh.panel[x] !== panel) ok = false;
      });
    });
    if (!ok || panel < 0 || faces.some(function (x) { return mesh.panel[x] !== panel; })) return null;
    var open = [];
    if (!faces.length) rimKeys.forEach(function (key) { open.push(key); });
    faces.forEach(function (x) {
      for (k = 0; k < 3; k++) {
        var key3 = ekey(T[3 * x + k], T[3 * x + (k + 1) % 3]), fs = edgeMap.get(key3) || [];
        if (rimKeys.has(key3)) continue;
        if (fs.length === 1 || mesh.cut.has(key3) || fs.some(function (y) { return mesh.panel[y] !== panel; })) open.push(key3);
      }
    });
    return { faces: faces, loop: loop, rimKeys: rimKeys, open: open, panel: panel };
  }

  // A panel flattened as if its intakes were filled flush. Every face but
  // the intakes' own, with each intake's lid in its place, goes through
  // flattenIsland; each intake face then takes its layout from its lid,
  // carried straight along the lid's normal. faces: vertex ids, three a
  // face, as for flattenIsland. holes: [{ faces (the intake's faces, as
  // indices into faces / 3), lm (its lidMesh) }]. Returns an island over
  // every face given, like flattenIsland's, whose stretch figures leave the
  // intakes out, with `cover`: the lids' triangles in the same layout.
  function flattenFilled(P, faces, holes, opts) {
    var nf = faces.length / 3, own = new Int32Array(nf).fill(-1), j, c, i;
    holes.forEach(function (h, hi) { h.faces.forEach(function (x) { own[x] = hi; }); });
    var id = new Map(), pos = [], tri = [];
    function vid(g) {
      var k = id.get(g);
      if (k === undefined) { k = pos.length / 3; id.set(g, k); pos.push(P[3 * g], P[3 * g + 1], P[3 * g + 2]); }
      return k;
    }
    for (j = 0; j < nf; j++) if (own[j] < 0) tri.push(vid(faces[3 * j]), vid(faces[3 * j + 1]), vid(faces[3 * j + 2]));
    var lidAt = holes.map(function (h) {
      var lm = h.lm, map = new Int32Array(lm.count);
      for (i = 0; i < lm.count; i++) {
        if (lm.ids[i] >= 0) map[i] = vid(lm.ids[i]);
        else { map[i] = pos.length / 3; pos.push(lm.pos[3 * i], lm.pos[3 * i + 1], lm.pos[3 * i + 2]); }
      }
      for (i = 0; i < lm.tris.length; i += 3) tri.push(map[lm.tris[i]], map[lm.tris[i + 1]], map[lm.tris[i + 2]]);
      return map;
    });
    var flat = flattenIsland(pos, Int32Array.from(tri), opts), local = new Map();
    for (i = 0; i < flat.global.length; i++) local.set(flat.global[i], i);
    function uvOf(k) { var l = local.get(k); return l === undefined ? null : [flat.U[2 * l], flat.U[2 * l + 1]]; }
    var map2 = new Map(), gl = [], F = new Int32Array(faces.length), U = [], projected = 0;
    for (j = 0; j < nf; j++) for (c = 0; c < 3; c++) {
      var g = faces[3 * j + c], l = map2.get(g);
      if (l === undefined) {
        l = gl.length; map2.set(g, l); gl.push(g);
        var uv = id.has(g) ? uvOf(id.get(g)) : null;
        if (!uv && own[j] >= 0) {
          var h = holes[own[j]], q = lidCoords(h.lm.lid, [P[3 * g], P[3 * g + 1], P[3 * g + 2]]);
          var at = lidLocate(h.lm, q[0], q[1]), m = lidAt[own[j]];
          uv = [0, 0];
          for (var s = 0; s < 3; s++) {
            var t = uvOf(m[at.v[s]]);
            uv[0] += at.w[s] * t[0]; uv[1] += at.w[s] * t[1];
          }
          projected++;
        }
        if (!uv) uv = [0, 0];
        U.push(uv[0], uv[1]);
      }
      F[3 * j + c] = l;
    }
    var cu = [], cf = [];
    holes.forEach(function (h, hi) {
      var base = cu.length / 2;
      for (i = 0; i < h.lm.count; i++) { var t2 = uvOf(lidAt[hi][i]); cu.push(t2[0], t2[1]); }
      for (i = 0; i < h.lm.tris.length; i++) cf.push(base + h.lm.tris[i]);
    });
    return {
      U: Float64Array.from(U), F: F, global: gl, nf: nf, nv: gl.length,
      w: flat.w, h: flat.h, area3: flat.area3, distortion: flat.distortion,
      cover: { U: Float64Array.from(cu), F: Int32Array.from(cf) }, projected: projected
    };
  }

  /* ---------------------------------------------------------- diagnostics */
  function checkManifold(mesh) {''',
     1),
    ("PanelCore: exports",
     r'''    polygons: polygons, markCreaseLines: markCreaseLines, slicePlane: slicePlane, sharedEdge: sharedEdge
  };''',
     r'''    polygons: polygons, markCreaseLines: markCreaseLines, slicePlane: slicePlane, sharedEdge: sharedEdge,
    areaNormals: areaNormals, touchDepths: touchDepths, edgeLoops: edgeLoops, fitLid: fitLid, lidHeight: lidHeight,
    lidCoords: lidCoords, lidMesh: lidMesh, lidLocate: lidLocate, findIntakes: findIntakes, resolveIntake: resolveIntake,
    flattenFilled: flattenFilled
  };''',
     1),
    ("PanelCore: 1",
     r'''    return {
      U: U, F: F, global: gl, nf: faceList.length, nv: nv,
      w: rep.w, h: rep.h, area3: rep.area3, distortion: rep.distortion,
      mirrorOf: rep.panel, shared: true, residual: worst
    };
  }''',
     r'''    var out = {
      U: U, F: F, global: gl, nf: faceList.length, nv: nv,
      w: rep.w, h: rep.h, area3: rep.area3, distortion: rep.distortion,
      mirrorOf: rep.panel, shared: true, residual: worst
    };
    // the lids over the partner's intakes, laid out as its are
    if (rep.cover) out.cover = rep.cover;
    return out;
  }''',
     1),
    ("PanelCore: 2",
     r'''      mirrorOf: island.mirrorOf, shared: false, separate: true, flipped: -1, residual: island.residual
    };
    if (signed >= 0 || !weight) return out;''',
     r'''      mirrorOf: island.mirrorOf, shared: false, separate: true, flipped: -1, residual: island.residual
    };
    if (island.cover) out.cover = island.cover;
    if (signed >= 0 || !weight) return out;''',
     1),
    ("PanelCore: 3",
     r'''    for (var i = 0; i < island.nv; i++) U[2 * i + axis] = extent - U[2 * i + axis];
    out.flipped = axis;''',
     r'''    for (var i = 0; i < island.nv; i++) U[2 * i + axis] = extent - U[2 * i + axis];
    // and the lids over its intakes with it
    if (island.cover) {
      var cu = Float64Array.from(island.cover.U);
      for (i = 0; i < cu.length / 2; i++) cu[2 * i + axis] = extent - cu[2 * i + axis];
      out.cover = { U: cu, F: island.cover.F };
    }
    out.flipped = axis;''',
     1),
    ("PanelCore: 4",
     r'''  // opts.includePanel(id) picks the panels to check.
  function topologyReport(mesh, edgeMap, opts) {''',
     r'''  // opts.includePanel(id) picks the panels to check, and opts.skipFace(f)
  // leaves faces out: an intake's, which are projected, not flattened.
  function topologyReport(mesh, edgeMap, opts) {''',
     1),
    ("PanelCore: 5",
     r'''    var total = 0, count = 0, f, i, k;
    for (f = 0; f < nT; f++) {
      if (!include(panelOf[f])) continue;
      inside[f] = 1;''',
     r'''    var total = 0, count = 0, f, i, k, skip = opts.skipFace || null;
    for (f = 0; f < nT; f++) {
      if (!include(panelOf[f]) || (skip && skip(f))) continue;
      inside[f] = 1;''',
     1),
    ("PanelCore: 6",
     r'''  // Each suggestion holds paths (surface polylines); `needs` lists the
  // indices of earlier suggestions whose seams its own ones end on.
  function suggestSplits(mesh, edgeMap, opts) {''',
     r'''  // Each suggestion holds paths (surface polylines); `needs` lists the
  // indices of earlier suggestions whose seams its own ones end on.
  // opts.intakes lists the intakes the vinyl covers ({ faces, lm, open }):
  // a piece is flattened with their lids in, as the unwrap flattens it, so
  // no seam is proposed round an intake's walls or the edge of a hole.
  function suggestSplits(mesh, edgeMap, opts) {''',
     1),
    ("PanelCore: 7",
     r'''    var regions = computePanels(mesh, edgeMap), label = regions.label;''',
     r'''    var regions = computePanels(mesh, edgeMap), label = regions.label;
    var holes = opts.intakes || [], holeOf = null, covered = new Set();
    if (holes.length) {
      holeOf = new Int32Array(nT).fill(-1);
      holes.forEach(function (h, i) {
        h.faces.forEach(function (f2) { holeOf[f2] = i; });
        (h.open || []).forEach(function (k2) { covered.add(k2); });
      });
    }
    // the intakes wholly inside a piece, with their faces by place in it
    function holesIn(faces) {
      var local = new Map(), verts = new Set(), out2 = [];
      faces.forEach(function (f2, j) { local.set(f2, j); for (var c = 0; c < 3; c++) verts.add(T[3 * f2 + c]); });
      holes.forEach(function (h) {
        var mine = [];
        if (!h.faces.every(function (f2) { var j = local.get(f2); if (j === undefined) return false; mine.push(j); return true; })) return;
        for (var r = 0; r < h.lm.rim; r++) if (!verts.has(h.lm.ids[r])) return;
        out2.push({ faces: mine, lm: h.lm });
      });
      return out2;
    }''',
     1),
    ("PanelCore: 8",
     r'''      for (j = 0; j < faces.length; j++) for (c = 0; c < 3; c++) tri[3 * j + c] = T[3 * faces[j] + c];
      var is = flattenIsland(P, tri, flatOpts);
      var n = is.nv, X = new Float64Array(n), Y = new Float64Array(n), at = new Map(), area = 0, neg = 0, all = 0;
      for (var i = 0; i < n; i++) { X[i] = is.U[2 * i] * unit; Y[i] = is.U[2 * i + 1] * unit; }
      for (j = 0; j < faces.length; j++) {
        at.set(faces[j], j); area += faceA[faces[j]];
        var a = is.F[3 * j], b = is.F[3 * j + 1], c2 = is.F[3 * j + 2];
        var s = (X[b] - X[a]) * (Y[c2] - Y[a]) - (Y[b] - Y[a]) * (X[c2] - X[a]);
        all += Math.abs(s); if (s < 0) neg -= s;
      }''',
     r'''      for (j = 0; j < faces.length; j++) for (c = 0; c < 3; c++) tri[3 * j + c] = T[3 * faces[j] + c];
      var hs = holes.length ? holesIn(faces) : [];
      var is = hs.length ? flattenFilled(P, tri, hs, flatOpts) : flattenIsland(P, tri, flatOpts);
      var n = is.nv, X = new Float64Array(n), Y = new Float64Array(n), at = new Map(), area = 0, neg = 0, all = 0;
      for (var i = 0; i < n; i++) { X[i] = is.U[2 * i] * unit; Y[i] = is.U[2 * i + 1] * unit; }
      // Under a lid a face stands for its share of the vinyl over the
      // opening, which it takes up flat; a hole's lid, for the faces round it.
      var A = null, lidded = null;
      if (hs.length) {
        A = new Float64Array(faces.length); lidded = new Uint8Array(faces.length);
        var where = new Map();
        faces.forEach(function (x, j2) { where.set(x, j2); });
        hs.forEach(function (h) {
          h.faces.forEach(function (x) { lidded[x] = 1; });
          if (h.faces.length) return;
          var round = [];
          for (var r = 0; r < h.lm.rim; r++) (edgeMap.get(ekey(h.lm.ids[r], h.lm.ids[(r + 1) % h.lm.rim])) || []).forEach(function (x) {
            if (where.has(x)) round.push(where.get(x));
          });
          round.forEach(function (x) { A[x] += h.lm.area * unit * unit / round.length; });
        });
      }
      for (j = 0; j < faces.length; j++) {
        at.set(faces[j], j);
        var a = is.F[3 * j], b = is.F[3 * j + 1], c2 = is.F[3 * j + 2];
        var s = (X[b] - X[a]) * (Y[c2] - Y[a]) - (Y[b] - Y[a]) * (X[c2] - X[a]);
        if (A) A[j] += lidded[j] ? Math.abs(s) / 2 : faceA[faces[j]];
        area += A ? A[j] : faceA[faces[j]];
        if (lidded && lidded[j]) continue;
        all += Math.abs(s); if (s < 0) neg -= s;
      }''',
     1),
    ("PanelCore: 9",
     r'''      return { faces: faces, at: at, F: is.F, glob: is.global, X: X, Y: Y, nb: nb, area: area,
        flipped: all ? neg / all : 0, stretch: is.distortion.mean };''',
     r'''      return { faces: faces, at: at, F: is.F, glob: is.global, X: X, Y: Y, nb: nb, area: area, A: A,
        flipped: all ? neg / all : 0, stretch: is.distortion.mean };''',
     1),
    ("PanelCore: 10",
     r'''        var j = list[q];
        area += faceA[pc.faces[j]];''',
     r'''        var j = list[q];
        area += pc.A ? pc.A[j] : faceA[pc.faces[j]];''',
     1),
    ("PanelCore: 11",
     r'''          var g = list[q]; area += faceA[pc.faces[g]];''',
     r'''          var g = list[q]; area += pc.A ? pc.A[g] : faceA[pc.faces[g]];''',
     1),
    ("PanelCore: 12",
     r'''      for (j = 0; j < pc.faces.length; j++) for (c = 0; c < 3; c++) {
        if (pc.nb[3 * j + c] >= 0) continue;
        var a = pc.F[3 * j + c], b = pc.F[3 * j + (c + 1) % 3];
        if (!next.has(a)) next.set(a, []);''',
     r'''      for (j = 0; j < pc.faces.length; j++) for (c = 0; c < 3; c++) {
        if (pc.nb[3 * j + c] >= 0) continue;
        var a = pc.F[3 * j + c], b = pc.F[3 * j + (c + 1) % 3];
        // what an intake leaves open is covered by its lid: no notch
        if (covered.size && covered.has(ekey(pc.glob[a], pc.glob[b]))) continue;
        if (!next.has(a)) next.set(a, []);''',
     1),
    ("PanelCore: 13",
     r'''      faces.forEach(function (g) {
        var n = faceNormal(mesh, g), a = faceA[g];
        total += a;''',
     r'''      // an intake faces the way its lid does
      function facing(g) { return holeOf && holeOf[g] >= 0 ? holes[holeOf[g]].lm.lid.n : faceNormal(mesh, g); }
      faces.forEach(function (g) {
        var n = facing(g), a = faceA[g];
        total += a;''',
     1),
    ("PanelCore: 14",
     r'''        if (l < 0) {
          var n = faceNormal(mesh, g), bestD = -Infinity;''',
     r'''        if (l < 0) {
          var n = facing(g), bestD = -Infinity;''',
     1),
    ("VectorCore: track 1",
     r'''  // the nearest face. `start` is the first sample's surface point; a jump of
  // more than `gap` across the surface breaks the track there.
  function track(fr, pos, tris, flat, start, gap) {''',
     r'''  // the nearest face. `start` is the first sample's surface point; a jump of
  // more than `gap` across the surface breaks the track there. A face in
  // `hold` (an intake's, projected from its lid) only takes a sample it
  // holds: its walls are all but edge-on in the layout, and the nearest
  // point of one is not where the line runs.
  function track(fr, pos, tris, flat, start, gap, hold) {''',
     1),
    ("VectorCore: track 2",
     r'''        if (w[0] < -1e-9 || w[1] < -1e-9 || w[2] < -1e-9) {
          var c = closest2(uv, o, x, y);''',
     r'''        if (w[0] < -1e-9 || w[1] < -1e-9 || w[2] < -1e-9) {
          if (hold && hold[fr.faces[s]]) return;
          var c = closest2(uv, o, x, y);''',
     1),
    ("VectorCore: track 3",
     r'''        // a face that holds the sample beats one it only lies beside
        var sc = (prev ? Math.hypot(q[0] - prev[0], q[1] - prev[1], q[2] - prev[2]) : 0) + (off ? gap + off : 0);''',
     r'''        // a face that holds the sample beats one it only lies beside; under a
        // lid, the intake face holding it is where the line runs, however far
        // down it lies
        var sc = (prev ? Math.hypot(q[0] - prev[0], q[1] - prev[1], q[2] - prev[2]) : 0) + (off ? gap + off : 0);
        if (hold && hold[f] && !off) sc = -1;''',
     1),
    ("VectorCore: track 4",
     r'''      var tr = track(fr, pos, tris, flat, a.p, 2 * fr.step / model.scale + edge);''',
     r'''      var tr = track(fr, pos, tris, flat, a.p, 2 * fr.step / model.scale + edge, model.projected);''',
     1),
    ("VectorCore: islandRegion takes the lids",
     r'''  // anticlockwise, so a non-zero fill of the lot is exactly their union.
  function islandRegion(uv, tris, faces, grow) {''',
     r'''  // anticlockwise, so a non-zero fill of the lot is exactly their union.
  // `cover` adds triangles, six numbers each: the lids across its intakes,
  // where the vinyl lies over the opening.
  function islandRegion(uv, tris, faces, grow, cover) {''',
     1),
    ("VectorCore: islandRegion lids in",
     r'''        else edges.set(key, { n: 1, a: a, b: b, ax: uv[o + 2 * k], ay: uv[o + 2 * k + 1], bx: uv[o + 2 * k2], by: uv[o + 2 * k2 + 1] });
      }
    }
    if (!edges) return polys;''',
     r'''        else edges.set(key, { n: 1, a: a, b: b, ax: uv[o + 2 * k], ay: uv[o + 2 * k + 1], bx: uv[o + 2 * k2], by: uv[o + 2 * k2 + 1] });
      }
    }
    if (cover) for (i = 0; i < cover.length; i += 6) {
      var ct = [cover[i], cover[i + 1], cover[i + 2], cover[i + 3], cover[i + 4], cover[i + 5]];
      if (polyArea(ct) < 0) ct = [ct[0], ct[1], ct[4], ct[5], ct[2], ct[3]];
      polys.push(ct);
    }
    if (!edges) return polys;''',
     1),
    ("VectorCore: islandOutline skips what intakes leave open",
     r'''  // An island's rim as polylines, for cut lines: closed loops where the rim
  // chains cleanly, open runs where it pinches.
  function islandOutline(uv, tris, faces) {''',
     r'''  // An island's rim as polylines, for cut lines: closed loops where the rim
  // chains cleanly, open runs where it pinches. Edges in `skip` are no cut:
  // what an intake leaves open, covered by its lid and trimmed on the car.
  function islandOutline(uv, tris, faces, skip) {''',
     1),
    ("VectorCore: islandOutline skip 1",
     r'''    edges.forEach(function (e, key) {
      if (e.n !== 1) return;
      [e.a, e.b].forEach(function (v) { var l = at.get(v); if (!l) at.set(v, l = []); l.push(key); });''',
     r'''    edges.forEach(function (e, key) {
      if (e.n !== 1 || (skip && skip.has(key))) return;
      [e.a, e.b].forEach(function (v) { var l = at.get(v); if (!l) at.set(v, l = []); l.push(key); });''',
     1),
    ("VectorCore: islandOutline skip 2",
     r'''      if (e.n !== 1 || used.has(key)) return;''',
     r'''      if (e.n !== 1 || used.has(key) || (skip && skip.has(key))) return;''',
     1),
    ("app: banner",
     r'''<script>
(function () {
  'use strict';
  var PC = window.PanelCore;''',
     r'''<script>
/* WrapaCar v17 — the app: panels and seams, intakes projected from their
   lids, retopology, the unwrap and atlas, vector artwork and the exports. */
(function () {
  'use strict';
  var PC = window.PanelCore;''',
     1),
    ("app: state",
     r'''    creases: null, floating: null, creaseHover: null
  };''',
     r'''    creases: null, floating: null, creaseHover: null,
    // intakes projected, those found and awaiting review, the one in focus,
    // and where each lies on the mesh as it is now
    intakes: [], intakeFound: [], intakeFocus: -1, intakeCache: null
  };''',
     1),
    ("app: lid overlays",
     r'''  var retopoDots = new THREE.Group(); scene.add(retopoDots);
''',
     r'''  var retopoDots = new THREE.Group(); scene.add(retopoDots);

  // intakes: the lids found (magenta), the one in focus (blue) and those
  // projected (cyan), each see-through with its rim and projection lines
  function lidLayer(hex, opacity) {
    var lid = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: opacity,
      side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    lid.visible = false; lid.renderOrder = 2; scene.add(lid);
    var lines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: hex }));
    lines.visible = false; lines.renderOrder = 3; scene.add(lines);
    return { lid: lid, lines: lines, hex: hex };
  }
  var lidsFound = lidLayer(0xd63cf0, 0.22), lidsFocus = lidLayer(0x2f6df6, 0.3), lidsKept = lidLayer(0x20c5d8, 0.2);
''',
     1),
    ("app: lid colours",
     r'''    vecTwinMat.color.copy(vecHotMat.color); vecTwinDotMat.color.copy(vecHotMat.color);
''',
     r'''    vecTwinMat.color.copy(vecHotMat.color); vecTwinDotMat.color.copy(vecHotMat.color);
    [lidsFound, lidsFocus, lidsKept].forEach(function (l) {
      l.lid.material.color.setHex(l.hex).convertSRGBToLinear(); l.lines.material.color.copy(l.lid.material.color);
    });
''',
     1),
    ("app: x-ray lid lines",
     r'''      closeMat, suggestMat, focusMat, suggestDotMat, focusDotMat, eraseMat, eraseDotMat, retopoLineMat, retopoDotMat, creaseMat, creaseHoverMat].forEach(function (mat) {''',
     r'''      closeMat, suggestMat, focusMat, suggestDotMat, focusDotMat, eraseMat, eraseDotMat, retopoLineMat, retopoDotMat, creaseMat, creaseHoverMat,
      lidsFound.lines.material, lidsFocus.lines.material, lidsKept.lines.material].forEach(function (mat) {''',
     1),
    ("app: bumper model",
     r'''        1.5 * sgnpow(Math.cos(eta), e1) * sgnpow(Math.sin(om), e2)
      ];
    });
  }
''',
     r'''        1.5 * sgnpow(Math.cos(eta), e1) * sgnpow(Math.sin(om), e2)
      ];
    });
  }

  // A front bumper, 1800 mm across: a shell curving back at its ends and
  // rolling under at the bottom, with a grille in the middle that goes
  // right through (its lip turns in 70 mm and stops) and a vent in each
  // lower corner with a floor 50 mm down. The openings' rims and floors lie
  // on grid lines, so their walls are clean rows of faces.
  function bumperBody() {
    var X = function (s, t) { return -350 * Math.pow(Math.abs(s), 2.2) - 70 * t * t - 25 * t; };
    var at = function (s, t) { return [X(s, t), 240 * t, 900 * s]; };
    var normal = function (s, t) {
      var e = 1e-5, ds = [X(s + e, t) - X(s - e, t), 0, 1800 * e], dt = [X(s, t + e) - X(s, t - e), 480 * e, 0];
      var n = [dt[1] * ds[2] - dt[2] * ds[1], dt[2] * ds[0] - dt[0] * ds[2], dt[0] * ds[1] - dt[1] * ds[0]];
      var l = Math.hypot(n[0], n[1], n[2]);
      return [n[0] / l, n[1] / l, n[2] / l];
    };
    // openings in (s, t), with their depth and draft in millimetres
    var holes = [
      { s0: -1 / 3, s1: 1 / 3, t0: -0.2, t1: 0.425, depth: 70, draft: 12, through: true },
      { s0: -0.78, s1: -0.52, t0: -0.75, t1: -1 / 3, depth: 50, draft: 6 },
      { s0: 0.52, s1: 0.78, t0: -0.75, t1: -1 / 3, depth: 50, draft: 6 }
    ];
    function lines(n, which) {
      var L = [], i, step = 2 / n, mm = which === 's' ? 900 : 240;
      for (i = 0; i <= n; i++) L.push({ x: -1 + i * step, kind: 0 });
      var special = [];
      holes.forEach(function (h, k) {
        var a = which === 's' ? h.s0 : h.t0, b = which === 's' ? h.s1 : h.t1, d = h.draft / mm;
        special.push({ x: a, kind: 1, side: 0, hole: k }, { x: b, kind: 1, side: 1, hole: k },
          { x: a + d, kind: 2, side: 0, hole: k }, { x: b - d, kind: 2, side: 1, hole: k });
      });
      var out = [];
      L.forEach(function (l) { if (special.every(function (s) { return Math.abs(s.x - l.x) > 0.3 * step; })) out.push(l); });
      special.forEach(function (s) {
        var same = out.find(function (o) { return o.kind === s.kind && o.side === s.side && Math.abs(o.x - s.x) < 1e-12; });
        if (same) same.holes.push(s.hole); else out.push({ x: s.x, kind: s.kind, side: s.side, holes: [s.hole] });
      });
      return out.sort(function (a, b) { return a.x - b.x; });
    }
    var S = lines(150, 's'), T = lines(40, 't');
    function range(L, k) {
      var a = -1, b = -1;
      L.forEach(function (l, i) { if (l.kind === 2 && l.holes.indexOf(k) >= 0) { if (l.side === 0) a = i; else b = i; } });
      return [a, b];
    }
    var fr = holes.map(function (h, k) { return { s: range(S, k), t: range(T, k) }; });
    function floorOf(i, j) {
      for (var k = 0; k < holes.length; k++) if (i >= fr[k].s[0] && i <= fr[k].s[1] && j >= fr[k].t[0] && j <= fr[k].t[1]) return k;
      return -1;
    }
    var pos = [], tris = [], nt = T.length, i, j;
    for (i = 0; i < S.length; i++) for (j = 0; j < T.length; j++) {
      var p = at(S[i].x, T[j].x), k = floorOf(i, j);
      if (k >= 0) { var n = normal(S[i].x, T[j].x); p = [p[0] - n[0] * holes[k].depth, p[1] - n[1] * holes[k].depth, p[2] - n[2] * holes[k].depth]; }
      pos.push(p[0], p[1], p[2]);
    }
    for (i = 0; i + 1 < S.length; i++) for (j = 0; j + 1 < T.length; j++) {
      var ks = [floorOf(i, j), floorOf(i + 1, j), floorOf(i + 1, j + 1), floorOf(i, j + 1)];
      if (ks[0] >= 0 && ks[0] === ks[1] && ks[1] === ks[2] && ks[2] === ks[3] && holes[ks[0]].through) continue;
      var a = i * nt + j, b = (i + 1) * nt + j, c = (i + 1) * nt + j + 1, d = i * nt + j + 1;
      // Each quad is halved so the two sides mirror each other exactly, and
      // a corner of an opening keeps its corner: there the cut runs to the
      // one sunk vertex. Wound so the faces look out through the front.
      var sunk = ks.map(function (x) { return x >= 0; }), one = sunk.filter(Boolean).length === 1;
      if (one ? sunk[0] || sunk[2] : S[i].x + S[i + 1].x >= 0) tris.push(a, c, b, a, d, c);
      else tris.push(a, d, b, b, d, c);
    }
    var w = PC.weld(pos, tris, 1e-6);
    return PC.makeMesh(w.pos, w.tris);
  }
''',
     1),
    ("app: a new model has no intakes",
     r'''    S.seams = null; S.rim = null; S.graph = null; S.suggestions = [];
    // artwork belongs to the surface it was drawn on''',
     r'''    S.seams = null; S.rim = null; S.graph = null; S.suggestions = [];
    S.intakes = []; S.intakeFound = []; S.intakeFocus = -1; S.intakeCache = null;
    $('intakeNote').textContent = '';
    // artwork belongs to the surface it was drawn on''',
     1),
    ("app: intakes checked when the panels change",
     r'''    dismissRetopo();
    recomputePairs();
    if (S.selected >= 0 && !S.panels.some(function (p) { return p.id === S.selected; })) S.selected = -1;''',
     r'''    dismissRetopo();
    recomputePairs();
    pruneIntakes();
    if (S.selected >= 0 && !S.panels.some(function (p) { return p.id === S.selected; })) S.selected = -1;''',
     1),
    ("app: intakes redrawn with the model",
     r'''    $('statQuads').textContent = m.quad && m.quad.size ? fmt(m.quad.size) : '—';
    updateButtons();
  }''',
     r'''    $('statQuads').textContent = m.quad && m.quad.size ? fmt(m.quad.size) : '—';
    renderIntakes();
    updateButtons();
  }''',
     1),
    ("app: snapshot keeps the intakes",
     r'''      suggestions: S.suggestions.slice(), bottomPanel: S.bottomPanel,
      excludedPanels: new Set(S.excludedPanels)
    });''',
     r'''      suggestions: S.suggestions.slice(), bottomPanel: S.bottomPanel,
      excludedPanels: new Set(S.excludedPanels),
      intakes: S.intakes.slice(), intakeFound: S.intakeFound.slice()
    });''',
     1),
    ("app: undo brings the intakes back",
     r'''    S.excludedPanels = new Set(h.excludedPanels || []);
    S.unwrap = null; setAtlasEmpty();''',
     r'''    S.excludedPanels = new Set(h.excludedPanels || []);
    S.intakes = h.intakes || []; S.intakeFound = h.intakeFound || [];
    $('intakeNote').textContent = '';
    S.unwrap = null; setAtlasEmpty();''',
     1),
    ("app: intakes block",
     r'''  /* ===============================================  retopology  ===== */
''',
     r'''  /* ==================================================  intakes  ===== */
  // An intake, a vent or a grille is a negative space: the vinyl is laid
  // flat across it, then heated and pressed in. Find intakes rolls a ball
  // as wide as the widest intake over the wrap panels; wherever it cannot
  // touch, the surface falls away beneath the vinyl. Each intake accepted
  // gets a lid over its opening, and its panel is flattened as if the lid
  // filled it flush, the intake's own faces projected down from the lid.
  // An intake is kept by where it is — its rim, a point on its floor, its
  // lid — not by its faces, so it lasts through the seams and rebuilds that
  // renumber them.
  var intakeSerial = 0;

  function projecting() { return $('intakeProject').checked; }
  function intakeMM(mm) { return mm / mmPerUnit(); }

  function intakeRecord(it) {
    var P = S.mesh.pos;
    return {
      id: ++intakeSerial, rim: it.rim.map(function (v) { return [P[3 * v], P[3 * v + 1], P[3 * v + 2]]; }),
      seed: it.seed ? it.seed.slice() : null, lid: it.lid, tol: it.tol, area: it.area, perimeter: it.perimeter,
      edge: it.edge, through: it.through, hole: it.through && !it.faces.length, width: it.width, length: it.length,
      depth: it.depth, lidArea: it.lidArea, stretch: it.stretch, twin: -1, self: it.self, panel: it.panel,
      centre: it.centre.slice()
    };
  }
  // Records for a list findIntakes gave, with each twin named by its id.
  function intakeRecords(list) {
    var recs = list.map(intakeRecord);
    list.forEach(function (it, i) { if (it.twin >= 0) recs[i].twin = recs[it.twin].id; });
    return recs;
  }

  // Where an intake is on the mesh as it is now — its faces, rim, lid and
  // the edges it leaves open — or null once it is gone. Kept until the
  // panels next change.
  function intakeOn(rec) {
    var c = S.intakeCache;
    if (!c || c.version !== S.meshVersion || c.mesh !== S.mesh) c = S.intakeCache = { version: S.meshVersion, mesh: S.mesh, map: new Map() };
    if (c.map.has(rec)) return c.map.get(rec);
    var res = null;
    try {
      res = PC.resolveIntake(S.mesh, S.edgeMap, rec, surfaceLocator());
      if (res) res.lm = PC.lidMesh(S.mesh.pos, res.loop, rec.lid, rec.edge);
      if (res && !res.lm) res = null;
    } catch (e) { res = null; }
    c.map.set(rec, res);
    return res;
  }
  function findIntake(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function samePlace(a, b) {
    return Math.hypot(a.centre[0] - b.centre[0], a.centre[1] - b.centre[1], a.centre[2] - b.centre[2]) <= Math.max(0.25 * Math.min(a.width, b.width), 2 * a.edge);
  }

  // After the panels change: an intake a seam now runs through, or whose
  // rim a rebuild did not keep, is no longer projected. Undo cut brings it
  // back. Found ones that are gone just go.
  function pruneIntakes() {
    if (!S.intakes.length && !S.intakeFound.length) return;
    var lost = S.intakes.filter(function (rec) { return !intakeOn(rec); });
    S.intakes = S.intakes.filter(function (rec) { return lost.indexOf(rec) < 0; });
    S.intakeFound = S.intakeFound.filter(function (rec) { return !!intakeOn(rec); });
    if (lost.length) $('intakeNote').textContent = (lost.length === 1 ? 'An intake is' : lost.length + ' intakes are') +
      ' no longer projected: a seam now parts ' + (lost.length === 1 ? 'it' : 'them') + ' from the panel, or a rebuild moved the edge of the opening. Undo cut brings ' + (lost.length === 1 ? 'it' : 'them') + ' back.';
  }

  // The projected intakes of each wrap panel, as the unwrap takes them.
  function intakesByPanel() {
    var by = new Map();
    if (!projecting()) return by;
    S.intakes.forEach(function (rec) {
      var res = intakeOn(rec);
      if (!res || S.excludedPanels.has(res.panel)) return;
      if (!by.has(res.panel)) by.set(res.panel, []);
      by.get(res.panel).push({ rec: rec, res: res });
    });
    return by;
  }
  // A twin borrows its partner's layout only when their intakes mirror each
  // other one for one; otherwise it is flattened on its own.
  function intakesMirror(a, b, by) {
    var la = by.get(a) || [], lb = by.get(b) || [];
    return la.length === lb.length && la.every(function (x) {
      return x.rec.twin >= 0 && lb.some(function (y) { return y.rec.id === x.rec.twin; });
    });
  }
  // the faces projected rather than flattened, or null
  function projectedFaces() {
    var by = intakesByPanel();
    if (!by.size) return null;
    var out = new Uint8Array(S.mesh.tris.length / 3);
    by.forEach(function (list) { list.forEach(function (x) { x.res.faces.forEach(function (f) { out[f] = 1; }); }); });
    return out;
  }
  // the intakes Suggest seams treats as covered
  function coveredIntakes() {
    var out = [];
    intakesByPanel().forEach(function (list) { list.forEach(function (x) { out.push({ faces: x.res.faces, open: x.res.open, lm: x.res.lm }); }); });
    return out.length ? out : undefined;
  }

  function intakeOptions() {
    var plane = artPlane();
    return { diameter: intakeMM(+$('intakeWidth').value || 300), minDepth: intakeMM(5),
      includePanel: function (id) { return !S.excludedPanels.has(id); }, plane: plane };
  }

  async function findIntakes() {
    if (!S.mesh || S.busy) return;
    if (!S.panels.some(function (p) { return !S.excludedPanels.has(p.id); })) {
      toast('Select at least one panel for wrapping first.', true); return;
    }
    S.busy = true;
    updateButtons(); refreshPanelList();
    busy(true, 'Rolling a ' + fmt(+$('intakeWidth').value || 300) + ' mm ball over the wrap panels', 0.3);
    await nextFrame();
    var list = null, failure = null;
    try { list = PC.findIntakes(S.mesh, S.edgeMap, intakeOptions()); } catch (e) { failure = e; }
    busy(false);
    S.busy = false;
    updateButtons(); refreshPanelList();
    if (failure) { toast('Could not look for intakes: ' + failure.message, true); return; }
    // those already projected are not found again
    var recs = intakeRecords(list).filter(function (r) { return !S.intakes.some(function (a) { return samePlace(a, r); }); });
    recs.forEach(function (r) { if (r.twin >= 0 && !findIntake(recs, r.twin)) r.twin = -1; });
    S.intakeFound = recs;
    S.intakeFocus = recs.length ? recs[0].id : -1;
    $('intakeNote').textContent = '';
    renderIntakes();
    var shallow = fmt(5), wide = fmt(+$('intakeWidth').value || 300);
    toast(recs.length ? recs.length + ' intake' + (recs.length === 1 ? '' : 's') + ' found — accept or reject each'
      : list.length ? 'Every intake found is projected already'
      : 'No intakes found — nothing narrower than ' + wide + ' mm and deeper than ' + shallow + ' mm, ringed by the panel', !recs.length && !list.length);
  }

  // What a row says about an intake.
  function intakeName(r) { return r.hole ? 'Hole' : r.through ? 'Opening' : 'Intake'; }
  function intakeSize(r) { var k = mmPerUnit(); return fmt(Math.round(r.length * k)) + ' × ' + fmt(Math.round(r.width * k)) + ' mm'; }
  function intakeDetail(r, both) {
    var k = mmPerUnit(), bits = [];
    var res = intakeOn(r);
    bits.push('Panel ' + (res ? res.panel : r.panel));
    if (r.through) bits.push(r.hole ? 'a hole — covered, trim it on the car' : 'goes right through — covered, trim and tuck on the car');
    else bits.push(fmt(Math.round(r.depth * k)) + ' mm deep', 'stretch ×' + r.stretch.toFixed(1));
    if (both) bits.push('both sides');
    else if (r.self) bits.push('symmetrical');
    return bits.join(' · ');
  }
  // With Mirror seams on, a pair goes together: the row is its first.
  function intakeGroup(list, rec) {
    var twin = activePlane() && rec.twin >= 0 ? findIntake(list, rec.twin) : null;
    return twin ? [rec, twin] : [rec];
  }
  function intakeRows(list) {
    var rows = [];
    list.forEach(function (r) {
      var g = intakeGroup(list, r);
      if (g.length > 1 && g[1].id < r.id) return;
      rows.push(g);
    });
    return rows;
  }

  function renderIntakes() {
    var list = S.intakeFound, ul = $('intakeList');
    if (list.length && !findIntake(list, S.intakeFocus)) S.intakeFocus = list[0].id;
    var focus = findIntake(list, S.intakeFocus), group = focus ? intakeGroup(list, focus) : [];
    var kept = S.mesh && (S.mode === 'intake' || $('showIntakes').checked) ? S.intakes : [];
    intakeOverlay(lidsFound, list.filter(function (r) { return group.indexOf(r) < 0; }));
    intakeOverlay(lidsFocus, group);
    intakeOverlay(lidsKept, kept);
    $('intakeReview').hidden = !list.length;
    var rows = intakeRows(list);
    $('intakeTitle').textContent = 'Intakes found (' + rows.length + ')';
    ul.innerHTML = '';
    rows.forEach(function (g, i) {
      var r = g[0], li = document.createElement('li');
      if (g.indexOf(focus) >= 0) li.className = 'on';
      var sw = document.createElement('span');
      sw.className = 'sw';
      var nm = document.createElement('button');
      nm.type = 'button'; nm.className = 'nm'; nm.title = 'Show this intake on the model';
      nm.textContent = (i + 1) + '. ' + intakeName(r) + ' ' + intakeSize(r);
      var sub = document.createElement('small');
      sub.textContent = intakeDetail(r, g.length > 1);
      nm.appendChild(sub);
      nm.addEventListener('click', function () { focusIntake(r.id, true); });
      var ok = document.createElement('button');
      ok.type = 'button'; ok.className = 'ib ok'; ok.textContent = '✓'; ok.title = 'Accept';
      ok.setAttribute('aria-label', 'Accept intake ' + (i + 1));
      ok.addEventListener('click', function () { acceptIntake(r.id); });
      var no = document.createElement('button');
      no.type = 'button'; no.className = 'ib no'; no.textContent = '✕'; no.title = 'Reject';
      no.setAttribute('aria-label', 'Reject intake ' + (i + 1));
      no.addEventListener('click', function () { rejectIntake(r.id); });
      li.appendChild(sw); li.appendChild(nm); li.appendChild(ok); li.appendChild(no);
      ul.appendChild(li);
    });
    var n = S.intakes.length;
    $('statIntakes').textContent = n ? fmt(n) + (projecting() ? '' : ', not projected') : '0';
    $('intakeClearBtn').disabled = S.busy || !n;
  }

  // One set of intakes drawn on the model: each lid, see-through, lying
  // across its opening, its rim, and a few lines dropped from the lid
  // straight down onto the walls and floor — the way the artwork goes.
  function intakeOverlay(obj, list) {
    var fill = [], lines = [], lift = S.radius * 0.0025, a = [0, 0, 0], b = [0, 0, 0];
    if (vnCache) list.forEach(function (rec) {
      var res = intakeOn(rec);
      if (!res) return;
      var lm = res.lm, n = rec.lid.n, i;
      for (i = 0; i < lm.tris.length; i++) {
        var v = lm.tris[i];
        fill.push(lm.pos[3 * v] + n[0] * lift, lm.pos[3 * v + 1] + n[1] * lift, lm.pos[3 * v + 2] + n[2] * lift);
      }
      for (i = 0; i < res.loop.length; i++) {
        offsetPoint(res.loop[i], a); offsetPoint(res.loop[(i + 1) % res.loop.length], b);
        lines.push(a[0], a[1], a[2], b[0], b[1], b[2]);
      }
      // the projection: from the lid straight down, at a few of its points
      var P = S.mesh.pos, seen = new Set(), picks = [];
      res.faces.forEach(function (f) { for (var k = 0; k < 3; k++) seen.add(S.mesh.tris[3 * f + k]); });
      res.loop.forEach(function (v) { seen.delete(v); });
      var all = Array.from(seen), step = Math.max(1, Math.floor(all.length / 28));
      for (i = 0; i < all.length; i += step) picks.push(all[i]);
      picks.forEach(function (v) {
        var q = PC.lidCoords(rec.lid, [P[3 * v], P[3 * v + 1], P[3 * v + 2]]), at = PC.lidLocate(lm, q[0], q[1]), top = [0, 0, 0];
        for (var s = 0; s < 3; s++) for (var k = 0; k < 3; k++) top[k] += at.w[s] * lm.pos[3 * at.v[s] + k];
        lines.push(top[0] + n[0] * lift, top[1] + n[1] * lift, top[2] + n[2] * lift, P[3 * v], P[3 * v + 1], P[3 * v + 2]);
      });
    });
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(fill, 3));
    obj.lid.geometry.dispose(); obj.lid.geometry = g;
    obj.lid.visible = fill.length > 0;
    setLines(obj.lines, lines);
  }

  function focusIntake(id, frame) {
    S.intakeFocus = id;
    renderIntakes();
    var rec = findIntake(S.intakeFound, id);
    if (!frame || !rec) return;
    // look down on the lid from outside, a little from above
    var n = new THREE.Vector3(rec.lid.n[0], rec.lid.n[1], rec.lid.n[2]).normalize();
    var dir = n.clone().addScaledVector(camera.up, 0.3).normalize();
    if (dir.lengthSq() < 1e-9) dir.copy(n);
    controls.target.set(rec.centre[0], rec.centre[1], rec.centre[2]);
    camera.position.copy(controls.target).addScaledVector(dir, Math.min(Math.max(rec.length * 3.2, 0.5), 4.5));
    controls.update();
  }

  // Accepting projects the intakes: each rim becomes a crease, so a
  // rebuild keeps the edge of the opening where it is, and the panels are
  // unwrapped afresh. Undo cut takes it back.
  function acceptIntakes(recs, how) {
    if (!S.mesh || S.busy || !recs.length) return 0;
    var was = S.meshVersion, added = [];
    snapshot();
    recs.forEach(function (rec) {
      var res = intakeOn(rec);
      if (!res || S.intakes.indexOf(rec) >= 0) return;
      var had = true;
      for (var i = 0; i < res.loop.length; i++) {
        var k = PC.ekey(res.loop[i], res.loop[(i + 1) % res.loop.length]), fs = S.edgeMap.get(k);
        if (!fs || fs.length !== 2 || S.mesh.cut.has(k) || S.mesh.crease.has(k)) continue;
        S.mesh.crease.add(k); had = false;
      }
      rec.hadCrease = had;
      added.push(rec);
    });
    if (!added.length) { S.history.pop(); return 0; }
    S.intakes = S.intakes.concat(added);
    S.intakeFound = S.intakeFound.filter(function (r) { return added.indexOf(r) < 0; });
    $('intakeNote').textContent = '';
    S.unwrap = null; setAtlasEmpty();
    recomputePanels(); syncAll();
    sameTriangles(was);
    updateHud();
    var n = added.length;
    toast((how || (n === 1 ? 'Intake accepted' : n + ' intakes accepted')) + ' — ' + (n === 1 ? 'its lid is laid over the opening' : 'their lids are laid over the openings') +
      '. Unwrap again to project the artwork into ' + (n === 1 ? 'it' : 'them') + '.');
    return n;
  }
  function acceptIntake(id) {
    var rec = findIntake(S.intakeFound, id);
    if (rec) acceptIntakes(intakeGroup(S.intakeFound, rec), intakeGroup(S.intakeFound, rec).length > 1 ? 'Intake and its mirror image accepted' : null);
  }
  function rejectIntake(id) {
    var rec = findIntake(S.intakeFound, id);
    if (!rec) return;
    var g = intakeGroup(S.intakeFound, rec);
    S.intakeFound = S.intakeFound.filter(function (r) { return g.indexOf(r) < 0; });
    renderIntakes();
  }
  function acceptAllIntakes() { acceptIntakes(S.intakeFound.slice()); }
  function rejectAllIntakes() {
    if (!S.intakeFound.length) return;
    S.intakeFound = [];
    renderIntakes();
    toast('Intakes dismissed — the panels are flattened as they are');
  }

  // Takes intakes out of the projection, and the creases their rims were
  // given with them.
  function removeIntakes(recs) {
    if (!recs.length || S.busy) return;
    var was = S.meshVersion;
    snapshot();
    recs.forEach(function (rec) {
      var res = intakeOn(rec);
      if (res && !rec.hadCrease) res.rimKeys.forEach(function (k) { S.mesh.crease.delete(k); });
    });
    S.intakes = S.intakes.filter(function (r) { return recs.indexOf(r) < 0; });
    S.unwrap = null; setAtlasEmpty();
    recomputePanels(); syncAll();
    sameTriangles(was);
    updateHud();
  }
  function clearIntakes() {
    var n = S.intakes.length;
    if (!n) return;
    removeIntakes(S.intakes.slice());
    toast(n === 1 ? 'Intake cleared' : n + ' intakes cleared — the panels are flattened as they are. Undo cut brings them back.');
  }

  // Intake mode. A tap on a projected intake takes it away; on one found,
  // accepts it; anywhere else looks for the intake there, with a wider ball
  // if the search's own one finds none. With Mirror seams on, its mirror
  // image goes the same way.
  function intakeAtTap(list, hit, ev) {
    var reach = pixelReach(hit.p, ev.pointerType && ev.pointerType !== 'mouse' ? 22 : 12);
    for (var i = 0; i < list.length; i++) {
      var res = intakeOn(list[i]);
      if (!res) continue;
      if (res.faces.indexOf(hit.tri) >= 0) return list[i];
      var P = S.mesh.pos, loop = res.loop;
      for (var k = 0; k < loop.length; k++) {
        var a = [P[3 * loop[k]], P[3 * loop[k] + 1], P[3 * loop[k] + 2]], j = loop[(k + 1) % loop.length];
        var b = [P[3 * j], P[3 * j + 1], P[3 * j + 2]], ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        var dd = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
        var t = dd > 0 ? Math.max(0, Math.min(1, ((hit.p[0] - a[0]) * ab[0] + (hit.p[1] - a[1]) * ab[1] + (hit.p[2] - a[2]) * ab[2]) / dd)) : 0;
        if (Math.hypot(a[0] + ab[0] * t - hit.p[0], a[1] + ab[1] * t - hit.p[1], a[2] + ab[2] * t - hit.p[2]) <= reach) return list[i];
      }
    }
    return null;
  }
  async function intakeTap(hit, ev) {
    if (!hit || S.busy || !S.mesh) return;
    if (S.excludedPanels.has(S.mesh.panel[hit.tri])) { toast('That panel is not wrapped — tick it in Panels first.', true); return; }
    var on = intakeAtTap(S.intakes, hit, ev);
    if (on) {
      var g = intakeGroup(S.intakes, on);
      removeIntakes(g);
      toast((g.length > 1 ? 'Intake and its mirror image' : 'Intake') + ' taken away — the panel is flattened as it is there. Undo cut brings it back.');
      return;
    }
    var found = intakeAtTap(S.intakeFound, hit, ev);
    if (found) { acceptIntake(found.id); return; }
    S.busy = true;
    updateButtons();
    busy(true, 'Looking for an intake there', 0.4);
    await nextFrame();
    var o = intakeOptions(), recs = [], failure = null;
    o.minDepth = intakeMM(1);
    try {
      var reach = pixelReach(hit.p, ev.pointerType && ev.pointerType !== 'mouse' ? 26 : 16);
      var here = PC.findIntakes(S.mesh, S.edgeMap, Object.assign({}, o, { at: { face: hit.tri, p: hit.p, reach: reach } }));
      if (here.length) {
        recs.push(intakeRecord(here[0]));
        // and its mirror image
        var plane = activePlane();
        if (plane && !here[0].self) {
          var mp = PC.mirrorPoint(here[0].seed || here[0].centre, plane.axis, plane.offset), h = surfaceLocator().closest(mp);
          if (h.tri >= 0 && !S.excludedPanels.has(S.mesh.panel[h.tri])) {
            var there = PC.findIntakes(S.mesh, S.edgeMap, Object.assign({}, o, { at: { face: h.tri, p: h.p, reach: reach } }));
            if (there.length) {
              var tw = intakeRecord(there[0]);
              if (!samePlace(tw, recs[0])) { recs[0].twin = tw.id; tw.twin = recs[0].id; recs.push(tw); }
            }
          }
        }
      }
    } catch (e) { failure = e; }
    busy(false);
    S.busy = false;
    updateButtons();
    if (failure) { toast('Could not look for an intake there: ' + failure.message, true); return; }
    recs = recs.filter(function (r) { return !S.intakes.some(function (a) { return samePlace(a, r); }); });
    if (!recs.length) {
      toast('No intake there: the vinyl can lie on that spot. Tap inside an opening ringed by the panel, or on the edge of a hole.', true);
      return;
    }
    // one already found and waiting is taken as it was found
    var waiting = S.intakeFound.filter(function (r) { return samePlace(r, recs[0]); })[0];
    if (waiting) { acceptIntake(waiting.id); return; }
    var r0 = recs[0];
    acceptIntakes(recs, (recs.length > 1 ? 'Intake and its mirror image added' : intakeName(r0) + ' added') + ', ' + intakeSize(r0));
  }

  function intakeHud() {
    var n = S.intakes.length;
    return '<b>Tap an intake</b> the search missed to add it — if the ball is too small for it, a wider one is tried — or tap a projected intake to take it away' +
      (activePlane() ? ', its mirror image with it' : '') + '. ' + (n ? n + ' projected, lids in cyan.' : 'None projected yet.') +
      ' <kbd>Ctrl</kbd>+<kbd>Z</kbd> undoes.';
  }

  /* ===============================================  retopology  ===== */
''',
     1),
    ("app: the topology check leaves intakes out",
     r'''  function checkTopology() {
    var report = PC.topologyReport(S.mesh, S.edgeMap, {
      includePanel: function (id) { return !S.excludedPanels.has(id); },
      edgeLength: retopoTarget(), creaseAngle: +$('creaseRange').value
    });''',
     r'''  // An intake's own faces are projected, not flattened: their slivers ask
  // for no rebuild.
  function checkTopology() {
    var lidded = projectedFaces();
    var report = PC.topologyReport(S.mesh, S.edgeMap, {
      includePanel: function (id) { return !S.excludedPanels.has(id); },
      edgeLength: retopoTarget(), creaseAngle: +$('creaseRange').value,
      skipFace: lidded ? function (f) { return lidded[f] === 1; } : undefined
    });''',
     1),
    ("app: seams suggested round intakes as covered",
     r'''      includePanel: function (id) { return !S.excludedPanels.has(id); },
      flatten: { topBias: top, keepOrient: top > 0 } };''',
     r'''      includePanel: function (id) { return !S.excludedPanels.has(id); },
      flatten: { topBias: top, keepOrient: top > 0 }, intakes: coveredIntakes() };''',
     1),
    ("app: unwrap with the lids in",
     r'''      var islands = [], byPanel = new Map(), i, j;
      for (var oi = 0; oi < order.length; oi++) {
        var id = order[oi], fl = groups.get(id), is = null;
        var info = panelById.get(id);
        if (mirror && info && info.twin >= 0 && info.rep !== id) {
          var rep = byPanel.get(info.twin);
          if (rep) is = PC.mirrorIsland(rep, m, fl, mirror.axis, mirror.offset);
          if (is && separate) is = PC.separateTwin(is, m, flatOpts);
        }
        if (!is) {
          var faces = new Int32Array(fl.length * 3);
          for (j = 0; j < fl.length; j++) {
            faces[3 * j] = m.tris[3 * fl[j]];
            faces[3 * j + 1] = m.tris[3 * fl[j] + 1];
            faces[3 * j + 2] = m.tris[3 * fl[j] + 2];
          }
          is = PC.flattenIsland(m.pos, faces, flatOpts);
        }
        is.panel = id; is.faceList = fl;''',
     r'''      // the projected intakes, by panel: their lids are flattened in their
      // place and their own faces projected down from them
      var lidded = intakesByPanel(), projected = lidded.size ? new Uint8Array(nT) : null, lids = 0;
      var islands = [], byPanel = new Map(), i, j;
      for (var oi = 0; oi < order.length; oi++) {
        var id = order[oi], fl = groups.get(id), is = null;
        var info = panelById.get(id), holes = lidded.get(id);
        if (mirror && info && info.twin >= 0 && info.rep !== id) {
          var rep = byPanel.get(info.twin);
          if (rep && intakesMirror(id, info.twin, lidded)) is = PC.mirrorIsland(rep, m, fl, mirror.axis, mirror.offset);
          if (is && separate) is = PC.separateTwin(is, m, flatOpts);
        }
        if (!is) {
          var faces = new Int32Array(fl.length * 3);
          for (j = 0; j < fl.length; j++) {
            faces[3 * j] = m.tris[3 * fl[j]];
            faces[3 * j + 1] = m.tris[3 * fl[j] + 1];
            faces[3 * j + 2] = m.tris[3 * fl[j] + 2];
          }
          if (holes) {
            var local = new Map();
            fl.forEach(function (f2, j2) { local.set(f2, j2); });
            is = PC.flattenFilled(m.pos, faces, holes.map(function (x) {
              return { faces: x.res.faces.map(function (f2) { return local.get(f2); }), lm: x.res.lm };
            }), flatOpts);
          } else is = PC.flattenIsland(m.pos, faces, flatOpts);
        }
        is.panel = id; is.faceList = fl;
        if (holes) {
          // the cut line leaves out what its intakes leave open
          is.skip = new Set();
          holes.forEach(function (x) {
            x.res.open.forEach(function (k) { is.skip.add(k); });
            x.res.faces.forEach(function (f2) { projected[f2] = 1; });
          });
          lids += holes.length;
        }''',
     1),
    ("app: the lids in the atlas",
     r'''            uv[6 * tri + 2 * c] = box.x + isl.U[2 * lv] * sc;
            uv[6 * tri + 2 * c + 1] = box.y + isl.U[2 * lv + 1] * sc;
          }
        }
      }''',
     r'''            uv[6 * tri + 2 * c] = box.x + isl.U[2 * lv] * sc;
            uv[6 * tri + 2 * c + 1] = box.y + isl.U[2 * lv + 1] * sc;
          }
        }
        // its lids, where the vinyl lies across the openings
        if (isl.cover) {
          var cu = isl.cover.U, cf = isl.cover.F, cv = new Float64Array(2 * cf.length);
          for (var q = 0; q < cf.length; q++) { cv[2 * q] = box.x + cu[2 * cf[q]] * sc; cv[2 * q + 1] = box.y + cu[2 * cf[q] + 1] * sc; }
          isl.coverUV = cv;
        }
      }''',
     1),
    ("app: the unwrap knows its intakes",
     r'''      S.unwrap = { uv: uv, islands: islands, scale: packed.scale, mode: mode, mirrored: !!mirror, separate: separate };''',
     r'''      S.unwrap = { uv: uv, islands: islands, scale: packed.scale, mode: mode, mirrored: !!mirror, separate: separate,
        intakes: lids, projected: projected };''',
     1),
    ("app: unwrap toast names the intakes",
     r'''        (apart ? ' — ' + apart + ' mirrored twin' + (apart === 1 ? '' : 's') + ' on ' + (apart === 1 ? 'its' : 'their') + ' own island' : ''));''',
     r'''        (apart ? ' — ' + apart + ' mirrored twin' + (apart === 1 ? '' : 's') + ' on ' + (apart === 1 ? 'its' : 'their') + ' own island' : '') +
        (lids ? ' — ' + lids + ' intake' + (lids === 1 ? '' : 's') + ' projected from ' + (lids === 1 ? 'its lid' : 'their lids') : ''));''',
     1),
    ("app: stretch readouts leave the intakes out",
     r'''    $('unwrapNote').textContent = worst < 1.05
      ? 'Every polygon kept its exact shape and size — nothing is stretched.'
      : 'Panels share one texel density, so a polygon twice the size on the model is twice the size here.';''',
     r'''    $('unwrapNote').textContent = (worst < 1.05
      ? 'Every polygon kept its exact shape and size — nothing is stretched.'
      : 'Panels share one texel density, so a polygon twice the size on the model is twice the size here.') +
      (u.intakes ? ' Stretch leaves out the ' + (u.intakes === 1 ? 'intake' : u.intakes + ' intakes') +
        ': the vinyl over ' + (u.intakes === 1 ? 'it is' : 'them is') + ' heated in on purpose.' : '');''',
     1),
    ("app: the lids painted into the atlas",
     r'''      p.lineTo(u.uv[6 * t + 4] * size, (1 - u.uv[6 * t + 5]) * size);
      p.closePath();
    }
    return p;
  }''',
     r'''      p.lineTo(u.uv[6 * t + 4] * size, (1 - u.uv[6 * t + 5]) * size);
      p.closePath();
    }
    // the vinyl laid across its intakes
    var c = is.coverUV;
    if (c) for (var k = 0; k < c.length; k += 6) {
      p.moveTo(c[k] * size, (1 - c[k + 1]) * size);
      p.lineTo(c[k + 2] * size, (1 - c[k + 3]) * size);
      p.lineTo(c[k + 4] * size, (1 - c[k + 5]) * size);
      p.closePath();
    }
    return p;
  }''',
     1),
    ("app: artwork knows the projected faces",
     r'''      islands: islands, index: index, locate: vecLocator().closest, scale: S.unwrap.scale, edge: typicalEdge() };''',
     r'''      islands: islands, index: index, locate: vecLocator().closest, scale: S.unwrap.scale, edge: typicalEdge(),
      projected: S.unwrap.projected };''',
     1),
    ("app: artwork runs across the lids",
     r'''      VC.islandRegion(S.unwrap.uv, S.mesh.tris, S.unwrap.islands[i].faceList, grow).forEach(function (poly) {''',
     r'''      VC.islandRegion(S.unwrap.uv, S.mesh.tris, S.unwrap.islands[i].faceList, grow, S.unwrap.islands[i].coverUV).forEach(function (poly) {''',
     1),
    ("app: the PDF clip covers the openings",
     r'''          groups.set(i, g = { clip: VC.islandRegion(S.unwrap.uv, S.mesh.tris, S.unwrap.islands[i].faceList, grow)''',
     r'''          groups.set(i, g = { clip: VC.islandRegion(S.unwrap.uv, S.mesh.tris, S.unwrap.islands[i].faceList, grow, S.unwrap.islands[i].coverUV)''',
     1),
    ("app: the cut line skips what intakes leave open",
     r'''        VC.islandOutline(S.unwrap.uv, S.mesh.tris, is.faceList).forEach(function (l) {''',
     r'''        VC.islandOutline(S.unwrap.uv, S.mesh.tris, is.faceList, is.skip).forEach(function (l) {''',
     1),
    ("app: PDF creator from the title stamp",
     r'''      deflated: !!packed, title: 'Wrap artwork', creator: 'WrapaCar v14', date: new Date() });''',
     r'''      deflated: !!packed, title: 'Wrap artwork', creator: document.title.split(' — ')[0], date: new Date() });''',
     1),
    ("app: OBJ header",
     r'''    L.push('# Seamwork — body panels with a packed atlas');''',
     r'''    L.push('# WrapaCar — body panels with a packed atlas');''',
     1),
    ("app: MTL header",
     r'''    var L = ['# Seamwork panel materials'];''',
     r'''    var L = ['# WrapaCar panel materials'];''',
     1),
    ("app: intake buttons",
     r'''    $('retopoSkipBtn').disabled = S.busy;
    buildNodeDots();''',
     r'''    $('retopoSkipBtn').disabled = S.busy;
    $('intakeFindBtn').disabled = S.busy || !wraps;
    $('intakeClearBtn').disabled = S.busy || !S.intakes.length;
    $('intakeAcceptAll').disabled = S.busy;
    buildNodeDots();''',
     1),
    ("app: intake mode HUD",
     r'''    } else if (S.mode === 'vector') {
      h.innerHTML = vecHud();''',
     r'''    } else if (S.mode === 'intake') {
      h.innerHTML = intakeHud();
    } else if (S.mode === 'vector') {
      h.innerHTML = vecHud();''',
     1),
    ("app: intake mode shows the lids",
     r'''    buildVecOverlay();
    buildNodeDots();
    canvas.style.cursor = mode === 'orbit' ? 'grab' : mode === 'vector' ? toolCursor() : 'crosshair';''',
     r'''    buildVecOverlay();
    buildNodeDots();
    if (S.mesh) renderIntakes();
    canvas.style.cursor = mode === 'orbit' ? 'grab' : mode === 'vector' ? toolCursor() : 'crosshair';''',
     1),
    ("app: intake mode taps",
     r'''    else if (S.mode === 'wrap') {
      var id = S.mesh.panel[hit.tri];''',
     r'''    else if (S.mode === 'intake') intakeTap(hit, e);
    else if (S.mode === 'wrap') {
      var id = S.mesh.panel[hit.tri];''',
     1),
    ("app: Esc dismisses the intakes found",
     r'''      else if (!S.points.length && S.suggestions.length) rejectAllSuggestions();''',
     r'''      else if (!S.points.length && S.suggestions.length) rejectAllSuggestions();
      else if (!S.points.length && S.intakeFound.length) rejectAllIntakes();''',
     1),
    ("app: key 8 for Intakes",
     r'''    else if (e.key === '7') setMode('crease');''',
     r'''    else if (e.key === '7') setMode('crease');
    else if (e.key === '8') setMode('intake');''',
     1),
    ("app: the bumper from the model list",
     r'''  $('modelSel').addEventListener('change', function () {
    var v = this.value;
    adoptMesh(v === 'car' ? carBody() : v === 'sphere' ? sphereBody() : roundedBox(),
      this.options[this.selectedIndex].text);
  });''',
     r'''  $('modelSel').addEventListener('change', function () {
    var v = this.value;
    // the bumper is 1800 mm across, the car 4500 mm long
    if (v === 'bumper') $('realLen').value = 1800;
    else if (v === 'car' && +$('realLen').value === 1800) $('realLen').value = 4500;
    adoptMesh(v === 'car' ? carBody() : v === 'sphere' ? sphereBody() : v === 'bumper' ? bumperBody() : roundedBox(),
      this.options[this.selectedIndex].text);
  });''',
     1),
    ("app: intake controls",
     r'''  $('suggestAcceptAll').addEventListener('click', acceptAllSuggestions);
  $('suggestRejectAll').addEventListener('click', rejectAllSuggestions);''',
     r'''  $('suggestAcceptAll').addEventListener('click', acceptAllSuggestions);
  $('suggestRejectAll').addEventListener('click', rejectAllSuggestions);
  $('intakeFindBtn').addEventListener('click', findIntakes);
  $('intakeAcceptAll').addEventListener('click', acceptAllIntakes);
  $('intakeRejectAll').addEventListener('click', rejectAllIntakes);
  $('intakeClearBtn').addEventListener('click', clearIntakes);
  $('showIntakes').addEventListener('change', function () { if (S.mesh) renderIntakes(); });
  // flipping back to flattening walls and all, the atlas follows at once
  $('intakeProject').addEventListener('change', function () {
    if (!S.mesh) return;
    renderIntakes();
    if (S.unwrap && !S.busy) runUnwrap({ skipCheck: true });
    updateHud();
  });''',
     1),
]

# gone from v17 everywhere: the old stamps and names
MUST_VANISH = ['v16', 'Seamwork', 'WrapaCar v14']

# still in v17, somewhere in the whole file: every function v16 defined
MUST_REMAIN = ['function acceptAllSuggestions(',
               'function acceptSuggestion(',
               'function activeEdges(',
               'function activePlane(',
               'function add(',
               'function add3(',
               'function addDir(',
               'function addDot(',
               'function addDraftNode(',
               'function addPoint(',
               'function adoptMesh(',
               'function afterSuggestedCut(',
               'function allFloatingToCreases(',
               'function allJoined(',
               'function alongOutline(',
               'function anchor(',
               'function angleText(',
               'function append(',
               'function apply(',
               'function applyAtlasToggle(',
               'function applyColour(',
               'function applyCuts(',
               'function applyCutsInPlace(',
               'function applyRetopology(',
               'function applySuggestion(',
               'function applySuggestions(',
               'function applyWidth(',
               'function around(',
               'function artMirrorChanged(',
               'function artMirrorOn(',
               'function artPlane(',
               'function artPlaneChanged(',
               'function asked(',
               'function assemble(',
               'function assignPanelIds(',
               'function at(',
               'function attempt(',
               'function axisOf(',
               'function bary2(',
               'function bboxSpan(',
               'function bendAt(',
               'function between(',
               'function bezierAt(',
               'function borderVertices(',
               'function buildCreaseLines(',
               'function buildEdgeMap(',
               'function buildMTL(',
               'function buildNodeDots(',
               'function buildOBJ(',
               'function buildPDF(',
               'function buildPalette(',
               'function buildSeamLines(',
               'function buildVecOverlay(',
               'function buildWire(',
               'function busy(',
               'function calipers(',
               'function canClose(',
               'function canCloseDraft(',
               'function canCloseSeam(',
               'function cancelDrags(',
               'function cancelPending(',
               'function canvasBytes(',
               'function carBody(',
               'function carry(',
               'function carryNodes(',
               'function cellKey(',
               'function centerPanelStarted(',
               'function centre(',
               'function centroid(',
               'function chains(',
               'function charts(',
               'function checkManifold(',
               'function checkTopology(',
               'function choose(',
               'function chordEndpoint(',
               'function chordError(',
               'function chordsFromCrossings(',
               'function clampCot(',
               'function clearArt(',
               'function clearCreases(',
               'function clearCuts(',
               'function clearPoints(',
               'function cloneMesh(',
               'function closest2(',
               'function closestOnMirrorPlane(',
               'function closestOnSurface(',
               'function closestOnTri(',
               'function closingPreview(',
               'function cmykHex(',
               'function cmykText(',
               'function cmykToRgb(',
               'function collapse(',
               'function collapseShort(',
               'function colourOf(',
               'function commitArt(',
               'function composeAtlas(',
               'function computePanels(',
               'function confirmBottomPanel(',
               'function consider(',
               'function constrain(',
               'function copyNode(',
               'function cornerAngles(',
               'function cost(',
               'function counted(',
               'function coverage(',
               'function crc32(',
               'function creaseAcross(',
               'function creaseEdges(',
               'function creaseNet(',
               'function creasePreview(',
               'function cross(',
               'function cross3(',
               'function crossPoint(',
               'function crossing(',
               'function crumb(',
               'function cubic3(',
               'function cubicError(',
               'function cutBy(',
               'function cutCreases(',
               'function deflate(',
               'function deleteShape(',
               'function derive(',
               'function derived(',
               'function describeSuggestion(',
               'function describeTopo(',
               'function detectBottomPanel(',
               'function detectMirror(',
               'function disagrees(',
               'function dismissBottomPreview(',
               'function dismissRetopo(',
               'function dist(',
               'function dist3(',
               'function doCrease(',
               'function doCut(',
               'function dot3(',
               'function draftChanged(',
               'function draftPath(',
               'function dragTransform(',
               'function drawAtlasUI(',
               'function drawPiece(',
               'function drawingAnchor(',
               'function drawingOutline(',
               'function drop(',
               'function dropNode(',
               'function dropSuggestions(',
               'function earClip(',
               'function ease(',
               'function edgeFaces(',
               'function ekey(',
               'function ekey2(',
               'function emit(',
               'function endDown(',
               'function endMove(',
               'function endTarget(',
               'function endUp(',
               'function endpointVertex(',
               'function enterVector(',
               'function face(',
               'function faceArea(',
               'function faceGrid(',
               'function faceLocator(',
               'function faceMap(',
               'function faceN(',
               'function faceNormal(',
               'function faceSide(',
               'function faceSize(',
               'function facesPath(',
               'function fanCount(',
               'function faultText(',
               'function find(',
               'function findSuggestion(',
               'function findSuggestions(',
               'function finish(',
               'function finishDraft(',
               'function finishLine(',
               'function finishTransform(',
               'function fit(',
               'function fitStretch(',
               'function flat(',
               'function flatMap(',
               'function flatten(',
               'function flattenIsland(',
               'function flip(',
               'function flipAll(',
               'function floatingEdges(',
               'function floatingNear(',
               'function floatingSeams(',
               'function flood(',
               'function fmt(',
               'function fmtLen(',
               'function fmtMM(',
               'function focusPanelInList(',
               'function focusSuggestion(',
               'function forwardVector(',
               'function frameAt(',
               'function frameCamera(',
               'function framePanel(',
               'function fromObject3D(',
               'function gap(',
               'function grabEdit(',
               'function gridMesh(',
               'function gridOf(',
               'function handleAt(',
               'function has(',
               'function hasEdge(',
               'function hasLooseEnds(',
               'function heapIn(',
               'function heapOut(',
               'function heapPop(',
               'function heapPush(',
               'function hexLum(',
               'function hexStr(',
               'function hsl2hex(',
               'function hull2(',
               'function ink(',
               'function innerCorners(',
               'function insideOf(',
               'function insideOutline(',
               'function isCreaseEnd(',
               'function isEnd(',
               'function isMirrorLoop(',
               'function isNode(',
               'function islandOutline(',
               'function islandPath(',
               'function islandRegion(',
               'function jumpiness(',
               'function key(',
               'function leadPoint(',
               'function leaveVector(',
               'function leftAlone(',
               'function levelPaths(',
               'function liftStretch(',
               'function lifted(',
               'function lineAt(',
               'function lineField(',
               'function lineOf(',
               'function linePaths(',
               'function linesNear(',
               'function livePaths(',
               'function loadFile(',
               'function locate(',
               'function loose(',
               'function makeMesh(',
               'function markChain(',
               'function markCreaseLines(',
               'function markCreases(',
               'function markSharpCreases(',
               'function measureDistortion(',
               'function meshBounds(',
               'function midOf(',
               'function minAngle(',
               'function mirrorAll(',
               'function mirrorEnabled(',
               'function mirrorHalf(',
               'function mirrorHint(',
               'function mirrorIsland(',
               'function mirrorNode(',
               'function mirrorOf(',
               'function mirrorPaths(',
               'function mirrorPoint(',
               'function mirrorRun(',
               'function mirrorTolerance(',
               'function mirrorVertexMap(',
               'function mixValue(',
               'function mmPerAtlas(',
               'function mmPerUnit(',
               'function moveNode(',
               'function moveOK(',
               'function moveShape(',
               'function n6(',
               'function nativeSize(',
               'function nearest(',
               'function nearestRim(',
               'function nearestSample(',
               'function nearestSeam(',
               'function neighbours(',
               'function nkey(',
               'function node(',
               'function nodeAt(',
               'function nodeDown(',
               'function nodeHandles(',
               'function nodeMove(',
               'function nodeNear(',
               'function nodeTarget(',
               'function nodeUp(',
               'function obj(',
               'function offsetPoint(',
               'function onArtPlane(',
               'function onBorder(',
               'function onHover(',
               'function onMirrorRangeChange(',
               'function onPath(',
               'function onPlane(',
               'function onRimKey(',
               'function onSegment(',
               'function onSurface(',
               'function orient(',
               'function orientOutward(',
               'function otherFace(',
               'function out(',
               'function p(',
               'function packIslands(',
               'function paintArt(',
               'function paintAtlas(',
               'function paintBase(',
               'function paintPaths(',
               'function pairOn(',
               'function pairQuads(',
               'function pairUp(',
               'function panelOf(',
               'function panelOutline(',
               'function panelPairs(',
               'function panelRim(',
               'function panelWidths(',
               'function param(',
               'function pdfColour(',
               'function pdfContent(',
               'function pdfDate(',
               'function pdfDocument(',
               'function pdfLayout(',
               'function pdfNum(',
               'function pdfPath(',
               'function pdfPoly(',
               'function pdfScaleText(',
               'function pdfString(',
               'function perp(',
               'function pick(',
               'function piecePath(',
               'function pinned(',
               'function pixelReach(',
               'function place(',
               'function placeNodes(',
               'function planEndMove(',
               'function planNodeMove(',
               'function planeHint(',
               'function planeOffset(',
               'function planePaths(',
               'function planeSnapOn(',
               'function planeVisible(',
               'function pointInPoly(',
               'function polyArea(',
               'function polygons(',
               'function pos(',
               'function printBleed(',
               'function projectToMirrorPlane(',
               'function pruneSuggestions(',
               'function put(',
               'function quad(',
               'function quadAngles(',
               'function quadPartners(',
               'function quadRing(',
               'function query(',
               'function queueBottomDetection(',
               'function rangeFromWidth(',
               'function reach(',
               'function rebuildColours(',
               'function rebuildPath(',
               'function recomputePairs(',
               'function recomputePanels(',
               'function refine(',
               'function reflect2(',
               'function reflectHandle(',
               'function reflectNode(',
               'function reflected(',
               'function refreshPanelList(',
               'function refreshPlane(',
               'function refreshVecButtons(',
               'function refreshVecUI(',
               'function refreshVecView(',
               'function regionPath(',
               'function rejectAllSuggestions(',
               'function rejectBottomPanel(',
               'function rejectSuggestion(',
               'function relax(',
               'function relaxQuads(',
               'function remember(',
               'function remeshJob(',
               'function remesher(',
               'function removeFloating(',
               'function removeLines(',
               'function renderRetopo(',
               'function renderShapeList(',
               'function renderSuggestions(',
               'function reportUnwrap(',
               'function reshapePath(',
               'function resize(',
               'function retopoOverlay(',
               'function retopoRows(',
               'function retopoSizeNote(',
               'function retopoStats(',
               'function retopoTarget(',
               'function retopologize(',
               'function retrace(',
               'function rimEdge(',
               'function rimNet(',
               'function ring(',
               'function ringArea(',
               'function roundedBox(',
               'function run(',
               'function runCheck(',
               'function runLength(',
               'function runParams(',
               'function runStretch(',
               'function runUnwrap(',
               'function sameInk(',
               'function samePoint(',
               'function sameTriangles(',
               'function sanitizeQuads(',
               'function saveBytes(',
               'function saveErr(',
               'function savePDF(',
               'function savePNG(',
               'function saveZIP(',
               'function scheduleVec(',
               'function screenGap(',
               'function seamGraph(',
               'function seamGraphNow(',
               'function seamHooks(',
               'function seamLink(',
               'function seamNet(',
               'function seamOnPlane(',
               'function seamPick(',
               'function seamPlaneCrossing(',
               'function seamRunEnd(',
               'function seamRuns(',
               'function seamRunsAt(',
               'function seamStretch(',
               'function seedColour(',
               'function segPoints(',
               'function segments(',
               'function selectPanel(',
               'function selectShape(',
               'function selectedPath(',
               'function selectedWrapTwin(',
               'function separateTwin(',
               'function setAllPanelsWrap(',
               'function setAtlasEmpty(',
               'function setLines(',
               'function setMix(',
               'function setMode(',
               'function setPanelWrap(',
               'function setVecTool(',
               'function shapeAt(',
               'function shapeFrame(',
               'function shapeHit(',
               'function shapeName(',
               'function sharedEdge(',
               'function shelfPack(',
               'function showBottomPreview(',
               'function showCreaseHover(',
               'function showDragCursor(',
               'function showErase(',
               'function showMix(',
               'function showMovePreview(',
               'function showRetopo(',
               'function side(',
               'function sideFrame(',
               'function size2(',
               'function skipRetopo(',
               'function slicePlane(',
               'function slide(',
               'function slot(',
               'function smoothNormal(',
               'function snapEnd(',
               'function snapPick(',
               'function snapshot(',
               'function sphereBody(',
               'function split(',
               'function splitLong(',
               'function splitVertex(',
               'function splitsPanel(',
               'function squareSegs(',
               'function squareToPlane(',
               'function squareness(',
               'function startTransform(',
               'function stats(',
               'function step(',
               'function stretch(',
               'function stretchKey(',
               'function stretchPoints(',
               'function strip(',
               'function subdivide(',
               'function suggestEndAt(',
               'function suggestOptions(',
               'function suggestSplits(',
               'function suggestionEnds(',
               'function suggestionPaths(',
               'function surface(',
               'function surfaceLines(',
               'function surfaceLocator(',
               'function swap(',
               'function symmetric(',
               'function symmetricPanelReady(',
               'function symmetryScore(',
               'function syncAll(',
               'function syncDrawingSegments(',
               'function syncGhostDots(',
               'function take(',
               'function tally(',
               'function tangentAt(',
               'function tangentPart(',
               'function tapShape(',
               'function target(',
               'function test(',
               'function texBleed(',
               'function text(',
               'function themeColours(',
               'function thin(',
               'function third(',
               'function thirdOf(',
               'function tick(',
               'function toCreases(',
               'function toPath(',
               'function toScreen(',
               'function toast(',
               'function toggleArtMirror(',
               'function toolCursor(',
               'function toolDown(',
               'function toolHud(',
               'function topologyReport(',
               'function trace(',
               'function tracePath(',
               'function traceSeam(',
               'function traceSeg(',
               'function track(',
               'function transformSegs(',
               'function triPoint(',
               'function triQuality(',
               'function triangleSegs(',
               'function triangulateConstraints(',
               'function turn(',
               'function turnBetween(',
               'function turnOK(',
               'function twinOf(',
               'function typicalEdge(',
               'function undoCut(',
               'function undoPoint(',
               'function unfoldFace(',
               'function unit(',
               'function unit3(',
               'function unspike(',
               'function unwrap(',
               'function upVector(',
               'function updateButtons(',
               'function updateHud(',
               'function updateMirrorStats(',
               'function updatePanelHighlight(',
               'function updatePlaneVisual(',
               'function updateViewMode(',
               'function val(',
               'function vecDown(',
               'function vecHover(',
               'function vecHud(',
               'function vecKey(',
               'function vecLocator(',
               'function vecModel(',
               'function vecMove(',
               'function vecPick(',
               'function vecReset(',
               'function vecSnapshot(',
               'function vecSync(',
               'function vecUndo(',
               'function vecUp(',
               'function vertSide(',
               'function vertex(',
               'function vertexHash(',
               'function vertexNormals(',
               'function viewBottomPreview(',
               'function vnormal(',
               'function walk(',
               'function walkChains(',
               'function wasteLines(',
               'function wasteful(',
               'function weld(',
               'function widthFromRange(',
               'function widthLines(',
               'function winding(',
               'function withNeeds(',
               'function withSeamTail(',
               'function withTwins(',
               'function work(',
               'function wrapSelectionChanged(',
               'function xy(',
               'function zipStore(']

# the version stamps, each exactly once
STAMPS = ['<title>WrapaCar v17 — Intakes</title>',
          'intakes and vector art · v17</span>',
          '/* WrapaCar v17 — the app:']


def fail(msg):
    sys.stderr.write('patch aborted, nothing written: ' + msg + '\n')
    sys.exit(1)


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else 'WrapaCar_v16.html'
    dst = sys.argv[2] if len(sys.argv) > 2 else 'WrapaCar_v17.html'
    raw = open(src, 'rb').read()
    if hashlib.sha256(raw).hexdigest() != SRC_SHA256:
        fail(src + ' is not the shipped v16')
    text = raw.decode('utf-8')
    if text.count('\r\n') != text.count('\n'):
        fail('mixed line endings in ' + src)
    text = text.replace('\r\n', '\n')
    for name, old, new, count in EDITS:
        found = text.count(old)
        if found != count:
            fail('%s: anchor found %d times, expected %d' % (name, found, count))
        text = text.replace(old, new)
    for s in MUST_VANISH:
        if s in text:
            fail('still in the file: ' + s)
    for s in MUST_REMAIN:
        if s not in text:
            fail('lost from the file: ' + s)
    for s in STAMPS:
        if text.count(s) != 1:
            fail('version stamp %r found %d times' % (s, text.count(s)))
    out = text.replace('\n', '\r\n').encode('utf-8')
    with open(dst, 'wb') as f:
        f.write(out)
    print('%s -> %s: %d edits, %d bytes, sha256 %s' % (src, dst, len(EDITS), len(out), hashlib.sha256(out).hexdigest()[:16]))


if __name__ == '__main__':
    main()
