'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', 'WrapaCar_v10.html'), 'utf8');
const source = html.match(/<script>\s*(\/\* PanelCore[\s\S]*?)<\/script>/);
assert.ok(source, 'PanelCore is available');
const context = { module: { exports: {} } };
vm.runInNewContext(source[1], context, { filename: 'PanelCore.js' });
const PC = context.module.exports;

function nearPoint(actual, expected, message) {
  assert.ok(Math.hypot(...actual.map((v, axis) => v - expected[axis])) < 1e-9,
    `${message}: expected ${expected}, received ${actual}`);
}

function grid(xs, ys, transform = p => p) {
  const pos = [], tris = [];
  for (const y of ys) for (const x of xs) pos.push(...transform([x, y, 0]));
  for (let y = 0; y + 1 < ys.length; y++) for (let x = 0; x + 1 < xs.length; x++) {
    const a = y * xs.length + x, b = a + 1, c = a + xs.length, d = c + 1;
    tris.push(a, b, d, a, d, c);
  }
  return PC.makeMesh(pos, tris);
}

function surface(mesh, p) {
  const hit = PC.closestOnSurface(mesh, p);
  nearPoint(hit.p, p, 'Fixture point lies on the surface');
  return hit;
}

for (const axis of [0, 1, 2]) for (const side of [-1, 1]) {
  test(`center projection joins toward the reflection for axis ${axis}, side ${side}, and an offset`, () => {
    const offset = 0.37;
    const transform = p => {
      const q = [0, 0, 0];
      q[axis] = p[0] + offset;
      q[(axis + 1) % 3] = p[1];
      q[(axis + 2) % 3] = p[2];
      return q;
    };
    // Neither the mirror plane nor the projected point follows a grid edge.
    const mesh = grid([-2, -0.45, 0.31, 2], [-2, -0.6, 0.4, 2], transform);
    const point = surface(mesh, transform([side * 0.81, 0.63, 0]));
    const original = Array.from(point.p);
    const hit = PC.projectToMirrorPlane(mesh, PC.buildEdgeMap(mesh), point, { axis, offset });
    assert.ok(hit, 'An endpoint is found on the surface');
    nearPoint(hit.p, transform([0, 0.63, 0]), 'The endpoint is halfway toward the reflection');
    const corners = mesh.tris.slice(3 * hit.tri, 3 * hit.tri + 3)
      .map(v => mesh.pos.slice(3 * v, 3 * v + 3));
    nearPoint(PC.closestOnTri(hit.p, ...corners).p, hit.p, 'The reported face contains the endpoint');
    assert.deepEqual(Array.from(point.p), original, 'Projection does not move the confirmed click');
  });
}

test('center projection follows a curved profile and stays on the surface', () => {
  const mesh = grid([-2, -1, 0, 1, 2], [-2, -1, 0, 1, 2],
    ([x, y]) => [x, y, 0.2 * x * x + 0.12 * y * y]);
  const point = surface(mesh, [0.8, 0.42, 0.2 * 0.8 + 0.12 * 0.42]);
  const hit = PC.projectToMirrorPlane(mesh, PC.buildEdgeMap(mesh), point, { axis: 0, offset: 0 });
  assert.ok(hit);
  // The surface stroke to the reflected endpoint follows the cutting plane
  // perpendicular to the averaged endpoint normals, through this roof profile.
  const y = (point.p[1] + 0.12 * point.p[2]) / (1 + 0.12 * 0.12);
  nearPoint(hit.p, [0, y, 0.12 * y], 'Projection intersects the traced curved profile');
  nearPoint(PC.closestOnSurface(mesh, hit.p).p, hit.p, 'Projected endpoint stays on the roof');
  assert.ok(Math.abs(hit.p[2] - point.p[2]) > 0.1,
    'Projection adjusts height instead of placing a midpoint inside or above the mesh');
  assert.equal(PC.tracePath(mesh, PC.buildEdgeMap(mesh), point.tri, point.p, hit.tri, hit.p).complete,
    true, 'The auto-completion endpoint can be traced from the final click');
});

test('center projection cannot jump to a disconnected mirror-plane surface', () => {
  const sheets = [grid([-2, -1], [-1, 1]), grid([1, 2], [-1, 1]),
    grid([-0.5, 0.5], [-1, 1], ([x, y]) => [x, y, 2])];
  const pos = [], tris = [];
  for (const sheet of sheets) {
    const offset = pos.length / 3;
    pos.push(...sheet.pos);
    tris.push(...sheet.tris.map(v => v + offset));
  }
  const mesh = PC.makeMesh(pos, tris), point = surface(mesh, [1.5, 0.25, 0]);
  assert.ok(PC.closestOnMirrorPlane(mesh, point.p, 0, 0),
    'An unrelated sheet has a plane intersection, so nearest-plane snapping would be misleading');
  assert.equal(PC.projectToMirrorPlane(mesh, PC.buildEdgeMap(mesh), point, { axis: 0, offset: 0 }), null);
});

test('an auto-completed outline cuts one center panel without a seam across its center', () => {
  const mesh = grid([-2, -1, 0, 1, 2], [-2, -1, 0, 1, 2]);
  const plane = { axis: 0, offset: 0 }, edges = PC.buildEdgeMap(mesh);
  const points = [[0, -0.8, 0], [0.9, -0.3, 0], [0.8, 0.7, 0]].map(p => surface(mesh, p));
  const end = PC.projectToMirrorPlane(mesh, edges, points[points.length - 1], plane);
  assert.ok(end);
  points.push(end);
  const trace = PC.traceSeam(mesh, edges, points, true, plane);
  assert.equal(trace.complete, true);
  assert.equal(trace.symmetric, true);
  PC.applyCuts(mesh, trace.chords, edges);
  const panels = PC.computePanels(mesh, PC.buildEdgeMap(mesh));
  assert.equal(panels.comps.length, 2, 'One center panel separates from the surrounding surface');
  const left = surface(mesh, [-0.2, 0, 0]), right = surface(mesh, [0.2, 0, 0]);
  assert.equal(panels.label[left.tri], panels.label[right.tri], 'Both halves belong to the same panel');
  for (const edge of mesh.cut) {
    const [a, b] = edge.split(':').map(Number);
    assert.ok(Math.abs(mesh.pos[3 * a]) > 1e-9 || Math.abs(mesh.pos[3 * b]) > 1e-9,
      'The plane joins are not connected by a center seam');
  }
  assert.equal(PC.checkManifold(mesh).nonManifold, 0, 'Cutting preserves valid connectivity');
});

test('an existing mirror-plane endpoint is retained without changing the original pick', () => {
  const mesh = grid([-1, 0, 1], [-1, 0, 1]);
  const point = surface(mesh, [0, 0.3, 0]);
  const hit = PC.projectToMirrorPlane(mesh, PC.buildEdgeMap(mesh), point, { axis: 0, offset: 0 });
  nearPoint(hit.p, point.p, 'Existing plane endpoint stays in place');
  assert.notEqual(hit.p, point.p, 'The returned coordinates do not alias the existing pick');
});
