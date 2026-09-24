'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'WrapaCar_v5.html'), 'utf8');
const coreSource = html.match(/<script>\s*(\/\* PanelCore[\s\S]*?)<\/script>/);
assert.ok(coreSource, 'PanelCore is available');
const coreContext = { module: { exports: {} } };
vm.runInNewContext(coreSource[1], coreContext, { filename: 'PanelCore.js' });
const PC = coreContext.module.exports;
const app = vm.createContext({ PC, TAU: Math.PI * 2 });
for (const name of ['gridMesh', 'orientOutward', 'carBody']) {
  const start = html.indexOf('  function ' + name + '(');
  const end = html.indexOf('\n  function ', start + 1);
  assert.ok(start >= 0 && end > start, 'Generator function exists: ' + name);
  vm.runInContext(html.slice(start, end), app);
}

// The supplied fixture contains one untransformed, indexed mesh. Decode its
// actual positions/indices and weld with the same tolerance as the importer.
function suppliedCar() {
  const file = fs.readFileSync(path.join(root, 'Car.glb'));
  assert.equal(file.readUInt32LE(0), 0x46546c67);
  let json, binary;
  for (let offset = 12; offset < file.length;) {
    const length = file.readUInt32LE(offset), type = file.readUInt32LE(offset + 4);
    const chunk = file.subarray(offset + 8, offset + 8 + length);
    if (type === 0x4e4f534a) json = JSON.parse(chunk.toString('utf8'));
    if (type === 0x004e4942) binary = chunk;
    offset += 8 + length;
  }
  assert.equal(json.meshes.length, 1);
  assert.equal(json.meshes[0].primitives.length, 1);
  assert.ok(json.nodes.every(n => !n.matrix && !n.translation && !n.rotation && !n.scale));
  function accessor(index) {
    const a = json.accessors[index], view = json.bufferViews[a.bufferView];
    assert.ok(!a.sparse && view.buffer === 0);
    const size = a.type === 'VEC3' ? 3 : 1;
    const bytes = a.componentType === 5126 ? 4 : 2;
    assert.ok(a.componentType === 5126 || a.componentType === 5123);
    const values = [], offset = (view.byteOffset || 0) + (a.byteOffset || 0);
    for (let i = 0; i < a.count; i++) for (let k = 0; k < size; k++) {
      const at = offset + i * (view.byteStride || size * bytes) + k * bytes;
      values.push(bytes === 4 ? binary.readFloatLE(at) : binary.readUInt16LE(at));
    }
    return values;
  }
  const primitive = json.meshes[0].primitives[0];
  const positions = accessor(primitive.attributes.POSITION), indices = accessor(primitive.indices);
  const bounds = PC.meshBounds(positions);
  const welded = PC.weld(positions, indices, Math.max(...bounds.ext) * 1e-5);
  return PC.makeMesh(welded.pos, welded.tris);
}

function totalArea(mesh) {
  let total = 0;
  for (let face = 0; face < mesh.tris.length / 3; face++) total += PC.faceArea(mesh, face);
  return total;
}

function surface(mesh, target) {
  const hit = PC.closestOnSurface(mesh, target);
  assert.ok(hit && hit.tri >= 0);
  return { tri: hit.tri, p: Array.from(hit.p) };
}

const fixtures = [
  {
    name: 'built-in curved car', make: () => app.carBody(), plane: { axis: 2, offset: 0 },
    half: [[-0.9, 1.5, 0], [-0.5, 1.5, 0.45], [0.5, 1.5, 0.45], [0.9, 1.5, 0]],
    inside: [[0, 1.5, 0.15], [0, 1.5, -0.15]], outside: [1.7, 1.5, 0],
    closed: [[-0.45, 1.5, 0.3], [0.3, 1.5, 0.5], [0.4, 1.5, 0.25]]
  },
  {
    name: 'supplied Car.glb', make: suppliedCar, plane: { axis: 0, offset: 0 },
    half: [[0, 2, -0.65], [0.42, 2, -0.4], [0.42, 2, 0.4], [0, 2, 0.65]],
    inside: [[0.15, 2, 0], [-0.15, 2, 0]], outside: [0, 2, 1.7],
    closed: [[0.25, 2, -0.35], [0.5, 2, 0.15], [0.25, 2, 0.4]]
  }
];

function verifyPreserved(mesh, areaBefore, topologyBefore) {
  const after = PC.checkManifold(mesh);
  assert.equal(after.boundary, topologyBefore.boundary, 'No new mesh boundary is introduced');
  assert.equal(after.nonManifold, topologyBefore.nonManifold, 'Non-manifold edge count is unchanged');
  assert.ok(Math.abs(totalArea(mesh) - areaBefore) < areaBefore * 1e-8, 'Surface area is preserved');
  const edges = PC.buildEdgeMap(mesh);
  for (const edge of mesh.cut) assert.ok(edges.has(edge), 'Seams follow real mesh edges');
  for (let face = 0; face < mesh.tris.length / 3; face++) {
    assert.ok(PC.faceArea(mesh, face) > 1e-12,
      `Cut triangle ${face} has positive area (received ${PC.faceArea(mesh, face)})`);
  }
}

for (const fixture of fixtures) {
  for (const finish of ['open', 'closed', 'projected']) test(`${fixture.name}: ${finish} stroke makes one connected center panel`, () => {
    const mesh = fixture.make(), plane = fixture.plane;
    const initialPanels = PC.computePanels(mesh, PC.buildEdgeMap(mesh)).comps.length;
    const areaBefore = totalArea(mesh), topologyBefore = PC.checkManifold(mesh);
    const targets = finish === 'projected' ? fixture.half.slice(0, -1) : fixture.half;
    const picks = targets.map((target, index) => {
      if (index > 0 && index < fixture.half.length - 1) return surface(mesh, target);
      const hit = PC.closestOnMirrorPlane(mesh, target, plane.axis, plane.offset, 3);
      assert.ok(hit, 'Endpoint snaps to the roof/mirror intersection');
      return { tri: hit.tri, p: Array.from(hit.p) };
    });
    if (finish === 'projected') {
      const endpoint = PC.projectToMirrorPlane(mesh, PC.buildEdgeMap(mesh), picks[picks.length - 1], plane);
      assert.ok(endpoint, 'The last off-plane click projects to the connected roof/mirror intersection');
      assert.equal(endpoint.p[plane.axis], plane.offset, 'Auto-close ends exactly on the mirror plane');
      assert.ok(PC.closestOnSurface(mesh, endpoint.p).d < 1e-9, 'Auto-close stays on the curved surface');
      picks.push(endpoint);
    }
    const trace = PC.traceSeam(mesh, PC.buildEdgeMap(mesh), picks, finish !== 'open', plane);
    assert.equal(trace.complete, true, 'Boundary is fully traced across curved triangles');
    assert.equal(trace.symmetric, true);
    PC.applyCuts(mesh, trace.chords, PC.buildEdgeMap(mesh));
    verifyPreserved(mesh, areaBefore, topologyBefore);
    const panels = PC.computePanels(mesh, PC.buildEdgeMap(mesh));
    assert.equal(panels.comps.length, initialPanels + 1, 'Exactly one panel is added');
    if (fixture.name === 'built-in curved car') assert.equal(panels.comps.length, 2);
    const left = panels.label[surface(mesh, fixture.inside[0]).tri];
    const right = panels.label[surface(mesh, fixture.inside[1]).tri];
    assert.equal(left, right, 'Both sides of the mirror plane share the same panel');
    assert.notEqual(left, panels.label[surface(mesh, fixture.outside).tri], 'Surrounding body stays outside the panel');
    for (const edge of mesh.cut) {
      const [a, b] = edge.split(':').map(Number);
      assert.ok(Math.abs(mesh.pos[3 * a + plane.axis] - plane.offset) > 1e-8 ||
        Math.abs(mesh.pos[3 * b + plane.axis] - plane.offset) > 1e-8,
      'No seam splits the new panel along its mirror plane');
    }
  });

  test(`${fixture.name}: ordinary off-plane closed stroke still makes separate reflected panels`, () => {
    const mesh = fixture.make();
    const initialPanels = PC.computePanels(mesh, PC.buildEdgeMap(mesh)).comps.length;
    const areaBefore = totalArea(mesh), topologyBefore = PC.checkManifold(mesh);
    const picks = fixture.closed.map(target => surface(mesh, target));
    const trace = PC.traceSeam(mesh, PC.buildEdgeMap(mesh), picks, true, fixture.plane);
    assert.equal(trace.complete, true);
    assert.equal(trace.symmetric, false);
    PC.applyCuts(mesh, trace.chords, PC.buildEdgeMap(mesh));
    verifyPreserved(mesh, areaBefore, topologyBefore);
    assert.equal(PC.computePanels(mesh, PC.buildEdgeMap(mesh)).comps.length, initialPanels + 2);
  });
}
