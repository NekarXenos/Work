'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', 'WrapaCar_v10.html'), 'utf8');
const source = html.match(/<script>\s*(\/\* PanelCore[\s\S]*?)<\/script>/);
assert.ok(source, 'The dependency-free PanelCore script is available for testing');
const context = { module: { exports: {} } };
vm.runInNewContext(source[1], context, { filename: 'PanelCore.js' });
const PC = context.module.exports;

function near(actual, expected, message, epsilon = 1e-8) {
  assert.ok(Math.abs(actual - expected) <= epsilon,
    `${message}: expected ${expected}, received ${actual}`);
}

function nearPoint(actual, expected, message) {
  for (let axis = 0; axis < 3; axis++) near(actual[axis], expected[axis], `${message}, axis ${axis}`);
}

function grid(xs = [-2, -1, 0, 1, 2], ys = [-2, -1, 0, 1, 2], alternating = false) {
  const pos = [], tris = [];
  for (const y of ys) for (const x of xs) pos.push(x, y, 0);
  for (let y = 0; y < ys.length - 1; y++) {
    for (let x = 0; x < xs.length - 1; x++) {
      const a = y * xs.length + x, b = a + 1, c = a + xs.length, d = c + 1;
      if (alternating && (x + y) % 2) tris.push(a, b, c, b, d, c);
      else tris.push(a, b, d, a, d, c);
    }
  }
  return PC.makeMesh(pos, tris);
}

function point(mesh, p) {
  const hit = PC.closestOnSurface(mesh, p);
  assert.ok(hit.tri >= 0, `Surface hit exists for ${p}`);
  near(hit.d, 0, 'Test point lies on the mesh');
  return { tri: hit.tri, p: Array.from(hit.p) };
}

function area(mesh, faces) {
  return (faces || Array.from({ length: mesh.tris.length / 3 }, (_, f) => f))
    .reduce((sum, f) => sum + PC.faceArea(mesh, f), 0);
}

function polygonArea(points) {
  let twice = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    twice += a[0] * b[1] - a[1] * b[0];
  }
  return Math.abs(twice) / 2;
}

function verifyMesh(mesh, initialArea, initialBoundary, flat = true) {
  const diagnostics = PC.checkManifold(mesh);
  assert.equal(diagnostics.nonManifold, 0, 'Cutting preserves manifold connectivity');
  assert.equal(diagnostics.boundary, initialBoundary, 'Interior cuts introduce no mesh boundary edges');
  near(area(mesh), initialArea, 'Cutting preserves total surface area', 1e-7);
  for (let f = 0; f < mesh.tris.length / 3; f++) {
    assert.ok(PC.faceArea(mesh, f) > 1e-12, `Triangle ${f} has positive area`);
    if (flat) near(PC.faceNormal(mesh, f)[2], 1, `Triangle ${f} preserves winding`);
    else assert.ok(PC.faceNormal(mesh, f)[2] > 0, `Triangle ${f} preserves upward winding`);
  }
  const edges = PC.buildEdgeMap(mesh);
  for (const edge of mesh.cut) assert.ok(edges.has(edge), `Cut ${edge} is an actual mesh edge`);
}

test('mirror snapping finds the surface intersection for every axis and a nonzero offset', () => {
  for (const axis of [0, 1, 2]) {
    const offset = 0.37;
    const transform = p => {
      const out = [0, 0, 0];
      out[axis] = p[0] + offset;
      out[(axis + 1) % 3] = p[1];
      out[(axis + 2) % 3] = p[2];
      return out;
    };
    const mesh = PC.makeMesh([[-2, -2, -2], [2, -2, 2], [0, 2, 0]].flatMap(transform), [0, 1, 2]);
    const query = transform([0.15, 0.2, 0.5]);
    const hit = PC.closestOnMirrorPlane(mesh, query, axis, offset, 1);
    assert.ok(hit, `Axis ${axis} has a nearby surface/plane intersection`);
    nearPoint(hit.p, transform([0, 0.2, 0]), 'Snap stays on both the mesh and the mirror plane');
    near(hit.d, Math.hypot(0.15, 0.5), 'Snap distance measures the complete displacement');
    near(PC.closestOnSurface(mesh, hit.p).d, 0, 'Snapped point lies on the surface');
    assert.equal(PC.closestOnMirrorPlane(mesh, query, axis, offset, 0.5), null,
      'A nearby plane alone does not permit a distant surface snap');
  }
});

test('mirror snapping handles an edge, a lone touching vertex, and a coplanar face', () => {
  const edge = PC.makeMesh([0, -1, 0, 0, 1, 0, 1, 0, 1], [0, 1, 2]);
  nearPoint(PC.closestOnMirrorPlane(edge, [0.05, 0.3, 0.02], 0, 0, 1).p, [0, 0.3, 0], 'Edge snap');
  const vertex = PC.makeMesh([0, 0, 0, 1, -1, 0, 1, 1, 0], [0, 1, 2]);
  nearPoint(PC.closestOnMirrorPlane(vertex, [0.05, 0.03, 0], 0, 0, 1).p, [0, 0, 0], 'Vertex snap');
  const coplanar = PC.makeMesh([0, -1, -1, 0, 1, -1, 0, 0, 1], [0, 1, 2]);
  nearPoint(PC.closestOnMirrorPlane(coplanar, [0.05, 0.2, 0], 0, 0, 1).p, [0, 0.2, 0], 'Coplanar face snap');
});

test('mirror snapping returns null when there is no usable intersection within the snap distance', () => {
  const missing = PC.makeMesh([1, -1, 0, 1, 1, 0, 2, 0, 0], [0, 1, 2]);
  assert.equal(PC.closestOnMirrorPlane(missing, [0, 0, 0], 0, 0, 10), null);
  assert.equal(PC.closestOnMirrorPlane(PC.makeMesh([], []), [0, 0, 0], 0, 0, 1), null);
  const mesh = grid();
  assert.equal(PC.closestOnMirrorPlane(mesh, [0.11, 0.25, 0], 0, 0, 0.1), null);
  nearPoint(PC.closestOnMirrorPlane(mesh, [0, 0.25, 0], 0, 0, 0).p, [0, 0.25, 0], 'Exact plane point is retained');
});

test('mirror snapping chooses the closest intersection when the plane crosses multiple surfaces', () => {
  const mesh = PC.makeMesh([-1, -1, 0, 1, -1, 0, 0, 1, 0, -1, -1, 3, 1, -1, 3, 0, 1, 3],
    [0, 1, 2, 3, 4, 5]);
  const hit = PC.closestOnMirrorPlane(mesh, [0.03, 0.1, 2.8], 0, 0, 1);
  assert.equal(hit.tri, 1, 'The nearest connected surface wins over triangle order');
  nearPoint(hit.p, [0, 0.1, 3], 'Nearest surface intersection');
});

test('a mirror loop requires distinct endpoints on the plane and a real excursion from it', () => {
  const plane = { axis: 0, offset: 0 };
  const points = coordinates => coordinates.map(p => ({ tri: 0, p }));
  assert.equal(PC.isMirrorLoop(points([[0, -1, 0], [1, 0, 0], [0, 1, 0]]), plane, 1e-5), true);
  assert.equal(PC.isMirrorLoop(points([[0, -1, 0], [0, 0, 0], [0, 1, 0]]), plane, 1e-5), false);
  assert.equal(PC.isMirrorLoop(points([[0, -1, 0], [1, 0, 0], [0.1, 1, 0]]), plane, 1e-5), false);
  assert.equal(PC.isMirrorLoop(points([[0, -1, 0], [1, 0, 0], [0, -1, 0]]), plane, 1e-5), false);
  assert.equal(PC.isMirrorLoop(points([[0, -1, 0], [0, 1, 0]]), plane, 1e-5), false);
  assert.equal(PC.isMirrorLoop(points([[0, -1, 0], [0.8, -0.5, 0], [0, 0, 0], [0.8, 0.5, 0], [0, 1, 0]]), plane, 1e-5), false,
    'An intermediate plane anchor would pinch the reflected panel into two regions');
  assert.equal(PC.isMirrorLoop(points([[0, -1, 0], [0.8, -0.5, 0], [-0.8, 0.5, 0], [0, 1, 0]]), plane, 1e-5), false,
    'A mirror half-boundary stays on one side of the plane');
});

test('mirror-loop recognition respects the selected axis, offset, and endpoint tolerance', () => {
  for (const axis of [0, 1, 2]) {
    const plane = { axis, offset: 1.4 };
    const points = [[1.4 + 1e-7, -1], [2.3, 0], [1.4 - 1e-7, 1]].map(([normal, along]) => {
      const p = [0, 0, 0];
      p[axis] = normal;
      p[(axis + 1) % 3] = along;
      return { tri: 0, p };
    });
    assert.equal(PC.isMirrorLoop(points, plane, 1e-5), true);
    assert.equal(PC.isMirrorLoop(points, plane, 1e-9), false);
  }
});

const halfLoop = [[0, -0.83, 0], [0.91, -0.31, 0], [0.87, 0.56, 0], [0, 0.93, 0]];
const fullLoop = halfLoop.concat(halfLoop.slice(1, -1).reverse().map(p => [-p[0], p[1], p[2]]));

function faceOwners(mesh, p) {
  const owners = [];
  for (let f = 0; f < mesh.tris.length / 3; f++) {
    const corners = mesh.tris.slice(3 * f, 3 * f + 3).map(v => mesh.pos.slice(3 * v, 3 * v + 3));
    const nearest = PC.closestOnTri(p, ...corners).p;
    if (Math.hypot(...nearest.map((value, axis) => value - p[axis])) < 1e-9) owners.push(f);
  }
  assert.ok(owners.length, 'Test path endpoint belongs to the mesh');
  return owners;
}

for (const [name, start, end] of [
  ['an edge start picked from either side', [0, 0.23, 0], [0.73, 0.36, 0]],
  ['an edge end picked from either side', [-0.83, -0.72, 0], [0, 0.71, 0]],
  ['a vertex start picked from any incident face', [0, 0, 0], [1.63, 0.72, 0]],
  ['a vertex end picked from any incident face', [-1.63, -0.72, 0], [0, 0, 0]],
  ['a path along mesh edges', [0, -1.4, 0], [0, 1.3, 0]],
  ['a path passing exactly through a grid vertex', [-1.3, -0.65, 0], [1.1, 0.55, 0]],
  ['coincident picks owned by adjacent triangles', [0, 0.23, 0], [0, 0.23, 0]],
]) {
  test(`surface path tracing handles ${name}`, () => {
    const mesh = grid(), edges = PC.buildEdgeMap(mesh);
    const displacement = end.map((value, axis) => value - start[axis]);
    const distance = Math.hypot(...displacement);
    const endOwners = faceOwners(mesh, end);
    for (const startTri of faceOwners(mesh, start)) for (const endTri of endOwners) {
      const trace = PC.tracePath(mesh, edges, startTri, start, endTri, end);
      assert.equal(trace.complete, true, `Trace succeeds with picked triangle ownership ${startTri} -> ${endTri}`);
      assert.ok(endOwners.includes(trace.endTri), 'The final face contains the endpoint');
      let previousTri = startTri, previousDistance = 0;
      for (const crossing of trace.crossings) {
        assert.equal(crossing.triA, previousTri, 'Crossings form a continuous face walk');
        assert.ok(edges.get(crossing.k).includes(crossing.triA));
        assert.ok(edges.get(crossing.k).includes(crossing.triB));
        const a = mesh.pos.slice(3 * crossing.a, 3 * crossing.a + 3);
        const b = mesh.pos.slice(3 * crossing.b, 3 * crossing.b + 3);
        const p = a.map((value, axis) => value + (b[axis] - value) * crossing.t);
        const along = distance ? p.reduce((sum, value, axis) => sum + (value - start[axis]) * displacement[axis], 0) / distance : 0;
        assert.ok(along >= previousDistance - 1e-9 && along <= distance + 1e-9,
          'Crossings progress monotonically along the finite stroke');
        const expected = start.map((value, axis) => value + (distance ? displacement[axis] * along / distance : 0));
        nearPoint(p, expected, 'Crossing remains on the drawn path');
        previousDistance = along;
        previousTri = crossing.triB;
      }
      assert.equal(previousTri, trace.endTri, 'The face walk reaches its reported end face');
    }
  });
}

test('a symmetric panel with all anchors on mesh vertices uses edge-only cuts without a center seam', () => {
  const mesh = grid();
  const initialArea = area(mesh), initialBoundary = PC.checkManifold(mesh).boundary;
  const picks = [[0, -1, 0], [1, 0, 0], [0, 1, 0]].map(p => point(mesh, p));
  const trace = PC.traceSeam(mesh, PC.buildEdgeMap(mesh), picks, true, { axis: 0, offset: 0 });
  assert.equal(trace.complete, true);
  assert.equal(trace.symmetric, true);
  assert.ok(trace.chords.every(chord => !chord.A.p && !chord.B.p), 'The original edge-crossing cut path is exercised');
  PC.applyCuts(mesh, trace.chords, PC.buildEdgeMap(mesh));
  verifyMesh(mesh, initialArea, initialBoundary);
  const panels = PC.computePanels(mesh, PC.buildEdgeMap(mesh));
  assert.equal(panels.comps.length, 2);
  const center = panels.label[point(mesh, [0.23, 0.11, 0]).tri];
  assert.equal(panels.label[point(mesh, [-0.23, 0.11, 0]).tri], center);
  near(area(mesh, panels.comps[center]), 2, 'The complete symmetric diamond is one panel');
  for (const edge of mesh.cut) {
    const [a, b] = edge.split(':').map(Number);
    assert.ok(Math.abs(mesh.pos[3 * a]) > 1e-9 || Math.abs(mesh.pos[3 * b]) > 1e-9,
      'The edge-only mirror loop has no centerline cut');
  }
});

for (const [name, makeMesh] of [
  ['centerline edges', () => grid()],
  ['triangles crossing the mirror plane', () => grid([-2, -1.2, -0.4, 0.4, 1.2, 2])],
  ['asymmetric face topology', () => grid([-2, -1.3, -0.45, 0, 0.6, 1.2, 2], [-2, -1.1, -0.15, 0.65, 2], true)],
  ['interior joins within coarse triangles', () => grid([-2, 2], [-2, 2])],
  ['a boundary contained wholly within one triangle', () => PC.makeMesh([-3, -2, 0, 3, -2, 0, 0, 3, 0], [0, 1, 2])],
]) {
  for (const closed of [false, true]) {
    test(`plane-to-plane ${closed ? 'closed' : 'open'} stroke creates one symmetric panel with ${name}`, () => {
      const mesh = makeMesh();
      const initialArea = area(mesh), initialBoundary = PC.checkManifold(mesh).boundary;
      const trace = PC.traceSeam(mesh, PC.buildEdgeMap(mesh), halfLoop.map(p => point(mesh, p)), closed,
        { axis: 0, offset: 0 });
      assert.equal(trace.complete, true, 'The original and reflected boundaries are completely traced');
      assert.equal(trace.symmetric, true, 'Plane-to-plane strokes are recognized as symmetric panels');
      assert.ok(trace.chords.length > 0, 'The complete panel boundary contains cuts');
      PC.applyCuts(mesh, trace.chords, PC.buildEdgeMap(mesh));
      verifyMesh(mesh, initialArea, initialBoundary);
      const panels = PC.computePanels(mesh, PC.buildEdgeMap(mesh));
      assert.equal(panels.comps.length, 2, 'The single center panel separates from the surrounding surface');
      const center = panels.label[point(mesh, [0.23, 0.11, 0]).tri];
      assert.equal(panels.label[point(mesh, [-0.23, 0.11, 0]).tri], center, 'Both halves share one panel');
      assert.notEqual(panels.label[point(mesh, [1.4, -1.5, 0]).tri], center, 'The surrounding mesh remains a separate panel');
      near(area(mesh, panels.comps[center]), polygonArea(fullLoop), 'The symmetric panel retains the drawn boundary', 1e-7);
      for (const edge of mesh.cut) {
        const [a, b] = edge.split(':').map(Number);
        assert.ok(Math.abs(mesh.pos[3 * a]) > 1e-9 || Math.abs(mesh.pos[3 * b]) > 1e-9,
          `Cut ${edge} does not divide the panel along the mirror plane`);
      }
    });
  }
}

test('a plane-to-plane stroke stays connected across a curved symmetric surface', () => {
  const mesh = grid();
  for (let i = 0; i < mesh.pos.length; i += 3) mesh.pos[i + 2] = 0.2 * mesh.pos[i] ** 2 + 0.12 * mesh.pos[i + 1] ** 2;
  const initialArea = area(mesh), initialBoundary = PC.checkManifold(mesh).boundary;
  const squareLinear = value => Math.abs(value) <= 1 ? Math.abs(value) : 1 + (Math.abs(value) - 1) * 3;
  const lift = p => [p[0], p[1], 0.2 * squareLinear(p[0]) + 0.12 * squareLinear(p[1])];
  const trace = PC.traceSeam(mesh, PC.buildEdgeMap(mesh), halfLoop.map(p => point(mesh, lift(p))), false,
    { axis: 0, offset: 0 });
  assert.equal(trace.complete, true, 'Both strokes trace across the curved model');
  assert.equal(trace.symmetric, true);
  PC.applyCuts(mesh, trace.chords, PC.buildEdgeMap(mesh));
  verifyMesh(mesh, initialArea, initialBoundary, false);
  const panels = PC.computePanels(mesh, PC.buildEdgeMap(mesh));
  assert.equal(panels.comps.length, 2, 'One curved center panel separates from its surroundings');
  const center = panels.label[point(mesh, lift([0.23, 0.11])).tri];
  assert.equal(panels.label[point(mesh, lift([-0.23, 0.11])).tri], center, 'Curved halves remain one panel');
  assert.notEqual(panels.label[point(mesh, lift([1.4, -1.5])).tri], center);
  let leftArea = 0, rightArea = 0;
  for (const f of panels.comps[center]) {
    const xs = mesh.tris.slice(3 * f, 3 * f + 3).map(v => mesh.pos[3 * v]);
    const averageX = xs.reduce((sum, x) => sum + x, 0) / 3;
    if (averageX < 0) leftArea += PC.faceArea(mesh, f);
    else rightArea += PC.faceArea(mesh, f);
  }
  near(leftArea, rightArea, 'Curved panel halves have equal surface areas', 1e-7);
  for (const edge of mesh.cut) {
    const [a, b] = edge.split(':').map(Number);
    assert.ok(Math.abs(mesh.pos[3 * a]) > 1e-9 || Math.abs(mesh.pos[3 * b]) > 1e-9,
      'Curved panel contains no seam along its center');
  }
});

test('an ordinary closed seam still produces two independent mirrored panels', () => {
  const mesh = grid();
  const initialArea = area(mesh), initialBoundary = PC.checkManifold(mesh).boundary;
  const coordinates = [[0.39, -0.71, 0], [1.23, -0.22, 0], [0.49, 0.71, 0]];
  const trace = PC.traceSeam(mesh, PC.buildEdgeMap(mesh), coordinates.map(p => point(mesh, p)), true,
    { axis: 0, offset: 0 });
  assert.equal(trace.complete, true);
  assert.equal(trace.symmetric, false);
  PC.applyCuts(mesh, trace.chords, PC.buildEdgeMap(mesh));
  verifyMesh(mesh, initialArea, initialBoundary);
  const panels = PC.computePanels(mesh, PC.buildEdgeMap(mesh));
  assert.equal(panels.comps.length, 3);
  const right = panels.label[point(mesh, [0.7, 0, 0]).tri];
  const left = panels.label[point(mesh, [-0.7, 0, 0]).tri];
  assert.notEqual(right, left, 'The two off-plane panels remain separate');
  near(area(mesh, panels.comps[right]), polygonArea(coordinates), 'Original panel area');
  near(area(mesh, panels.comps[left]), polygonArea(coordinates), 'Reflected panel area');
});

test('an ordinary open seam remains open with mirroring enabled or disabled', () => {
  for (const plane of [null, { axis: 0, offset: 0 }]) {
    const mesh = grid();
    const initialArea = area(mesh), initialBoundary = PC.checkManifold(mesh).boundary;
    const coordinates = [[0.39, -0.71, 0], [1.23, -0.22, 0], [0.49, 0.71, 0]];
    const trace = PC.traceSeam(mesh, PC.buildEdgeMap(mesh), coordinates.map(p => point(mesh, p)), false, plane);
    assert.equal(trace.complete, true);
    assert.equal(trace.symmetric, false);
    assert.ok(trace.chords.length > 0);
    PC.applyCuts(mesh, trace.chords, PC.buildEdgeMap(mesh));
    verifyMesh(mesh, initialArea, initialBoundary);
    assert.equal(PC.computePanels(mesh, PC.buildEdgeMap(mesh)).comps.length, 1,
      'Interior open strokes do not introduce a closed panel');
  }
});

test('traced mirror joins near an existing vertex retain their exact plane coordinates', () => {
  const mesh = grid(), plane = { axis: 0, offset: 2e-7 };
  const targets = [[plane.offset, -1, 0], [0.8, 0.15, 0], [plane.offset, 1, 0]];
  const picks = targets.map((p, i) => i === 1 ? point(mesh, p)
    : PC.closestOnMirrorPlane(mesh, p, plane.axis, plane.offset, 0.01));
  const trace = PC.traceSeam(mesh, PC.buildEdgeMap(mesh), picks, false, plane);
  assert.equal(trace.complete, true);
  assert.equal(trace.symmetric, true);
  const endpoints = trace.chords.flatMap(chord => [chord.A, chord.B]).map(hit => hit.p ||
    [0, 1, 2].map(axis => mesh.pos[3 * hit.a + axis] +
      (mesh.pos[3 * hit.b + axis] - mesh.pos[3 * hit.a + axis]) * hit.t));
  for (const endpoint of [targets[0], targets[2]]) {
    assert.ok(endpoints.some(p => Math.hypot(...endpoint.map((value, axis) => value - p[axis])) < 1e-12),
      'A near-corner plane join is preserved instead of snapping off the plane');
  }
});

test('an open seam entirely on the mirror plane is applied once and stays open', () => {
  const mesh = grid(), plane = { axis: 0, offset: 0 };
  const initialArea = area(mesh), initialBoundary = PC.checkManifold(mesh).boundary;
  const picks = [[0, -1.4, 0], [0, 0.2, 0], [0, 1.3, 0]].map(p => point(mesh, p));
  const trace = PC.traceSeam(mesh, PC.buildEdgeMap(mesh), picks, false, plane);
  assert.equal(trace.complete, true);
  assert.equal(trace.symmetric, false);
  assert.equal(trace.mirrored, false);
  assert.ok(trace.chords.length > 0);
  PC.applyCuts(mesh, trace.chords, PC.buildEdgeMap(mesh));
  assert.equal(PC.computePanels(mesh, PC.buildEdgeMap(mesh)).comps.length, 1);
  verifyMesh(mesh, initialArea, initialBoundary);
  for (const edge of mesh.cut) for (const vertex of edge.split(':').map(Number))
    near(mesh.pos[3 * vertex], 0, 'The intentional center seam remains on the plane');
});

test('a failed interior seam triangulation leaves the mesh unchanged', () => {
  const mesh = PC.makeMesh([0, 0, 0, 2, 0, 0, 0, 2, 0], [0, 1, 2]);
  mesh.cut.add('0:1');
  const before = { pos: mesh.pos.slice(), tris: mesh.tris.slice(), panel: mesh.panel.slice(), cut: Array.from(mesh.cut) };
  const invalid = [{ tri: 0, A: { a: 0, b: 1, t: 0.3 }, B: { tri: 0, p: [3, 3, 0] } }];
  assert.throws(() => PC.applyCuts(mesh, invalid, PC.buildEdgeMap(mesh)), /inside its face/);
  assert.deepEqual({ pos: mesh.pos, tris: mesh.tris, panel: mesh.panel, cut: Array.from(mesh.cut) }, before,
    'No split vertices, faces, panel labels, or cut edges are committed after a failed triangulation');
});
