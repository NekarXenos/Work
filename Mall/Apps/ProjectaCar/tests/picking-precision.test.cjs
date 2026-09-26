'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'WrapaCar_v10.html'), 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1])
  .filter(source => !source.includes('/* VectorCore'));
const core = vm.createContext({});
vm.runInContext(scripts[0], core);
const PC = core.PanelCore;

function appFunction(name) {
  const start = scripts[1].indexOf('  function ' + name + '(');
  assert.ok(start >= 0, name);
  return scripts[1].slice(start, scripts[1].indexOf('\n  }', start) + 4);
}

function builtInCar() {
  const app = vm.createContext({ PC, TAU: Math.PI * 2 });
  for (const name of ['gridMesh', 'orientOutward', 'carBody']) vm.runInContext(appFunction(name), app);
  return app.carBody();
}

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
  assert.ok(json.nodes.every(node => !node.matrix && !node.translation && !node.rotation && !node.scale));
  function accessor(index) {
    const data = json.accessors[index], view = json.bufferViews[data.bufferView];
    assert.ok(!data.sparse && view.buffer === 0);
    const components = data.type === 'VEC3' ? 3 : 1;
    assert.ok(data.componentType === 5126 || data.componentType === 5123);
    const bytes = data.componentType === 5126 ? 4 : 2;
    const result = [], offset = (view.byteOffset || 0) + (data.byteOffset || 0);
    for (let i = 0; i < data.count; i++) for (let component = 0; component < components; component++) {
      const at = offset + i * (view.byteStride || bytes * components) + component * bytes;
      result.push(bytes === 4 ? binary.readFloatLE(at) : binary.readUInt16LE(at));
    }
    return result;
  }
  const primitive = json.meshes[0].primitives[0];
  const positions = accessor(primitive.attributes.POSITION), indices = accessor(primitive.indices);
  const welded = PC.weld(positions, indices, Math.max(...PC.meshBounds(positions).ext) * 1e-5);
  return PC.makeMesh(welded.pos, welded.tris);
}

function normalize(mesh) {
  // Match adoptMesh: the source stays double precision, then rebuildGeometry
  // converts those normalized coordinates to Float32 for rendering/raycasting.
  const bounds = PC.meshBounds(mesh.pos), scale = 3 / Math.max(...bounds.ext);
  for (let i = 0; i < mesh.pos.length; i++)
    mesh.pos[i] = (mesh.pos[i] - (bounds.lo[i % 3] + bounds.hi[i % 3]) / 2) * scale;
  return mesh;
}

function corners(mesh, face) {
  return mesh.tris.slice(3 * face, 3 * face + 3).map(vertex => mesh.pos.slice(3 * vertex, 3 * vertex + 3));
}

function renderHit(mesh, face, weights) {
  const vertices = corners(mesh, face);
  // Every ray intersection is a barycentric point on the rendered Float32
  // triangle; using source-double points would hide the second-click failure.
  const p = [0, 1, 2].map(axis => weights.reduce((sum, weight, i) => sum + weight * Math.fround(vertices[i][axis]), 0));
  return { faceIndex: face, point: { x: p[0], y: p[1], z: p[2] }, distance: 5 };
}

function drawingHarness(mesh) {
  let hit;
  const S = { mesh, edgeMap: PC.buildEdgeMap(mesh), mode: 'draw' };
  const context = vm.createContext({ PC, S,
    canvas: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 1000 }) },
    raycaster: { setFromCamera() {}, intersectObject: () => [hit] }, camera: {}, meshObj: {},
    THREE: { Vector2: class {} },
    activePlane: () => null, $: () => ({ checked: false })
  });
  vm.runInContext(appFunction('pick'), context);
  return { S, pick(next) { hit = next; return context.pick({ clientX: 500, clientY: 500 }); } };
}

for (const [name, factory] of [['built-in car', builtInCar], ['Car.glb', suppliedCar]]) {
  test(`${name}: ordinary picks on Float32 rendered faces trace on the normalized source mesh`, () => {
    const mesh = normalize(factory()), harness = drawingHarness(mesh);
    let tested = 0, differing = 0;
    for (let face = 0; face < mesh.tris.length / 3; face += 17) {
      const rawA = renderHit(mesh, face, [0.2, 0.3, 0.5]), rawB = renderHit(mesh, face, [0.5, 0.2, 0.3]);
      const rawPoint = [rawB.point.x, rawB.point.y, rawB.point.z];
      const error = Math.hypot(...PC.closestOnTri(rawPoint, ...corners(mesh, face)).p.map((value, axis) => value - rawPoint[axis]));
      if (error > 1e-10) differing++;
      const a = harness.pick(rawA), b = harness.pick(rawB);
      assert.equal(a.tri, face, 'Picking keeps the ray-hit source face');
      assert.equal(b.tri, face);
      assert.ok(Math.hypot(...PC.closestOnTri(b.p, ...corners(mesh, face)).p.map((value, axis) => value - b.p[axis])) < 1e-12,
        `Rendered hit on face ${face} is restored to source-triangle precision`);
      assert.equal(PC.tracePath(mesh, harness.S.edgeMap, a.tri, a.p, b.tri, b.p).complete, true,
        `Second pick in face ${face} traces without the ordinary-panel error`);
      tested++;
    }
    assert.ok(tested > 100 && differing > tested * 0.9, 'The fixtures exercise real Float32 rendering error');
  });

  test(`${name}: second and third ordinary picks trace across neighboring rendered faces`, () => {
    const mesh = normalize(factory()), harness = drawingHarness(mesh), edges = harness.S.edgeMap;
    const normals = Array.from({ length: mesh.tris.length / 3 }, (_, face) => PC.faceNormal(mesh, face));
    const neighbors = Array.from({ length: normals.length }, () => []);
    edges.forEach(faces => {
      if (faces.length !== 2) return;
      const [a, b] = faces;
      if (normals[a].reduce((sum, value, axis) => sum + value * normals[b][axis], 0) < 0.98) return;
      neighbors[a].push(b); neighbors[b].push(a);
    });
    let chains = 0;
    for (let a = 0; a < neighbors.length && chains < 40; a += 11) {
      const b = neighbors[a][0], c = b == null ? undefined : neighbors[b].find(face => face !== a);
      if (c == null) continue;
      const picks = [a, b, c].map(face => harness.pick(renderHit(mesh, face, [0.27, 0.31, 0.42])));
      for (let i = 0; i + 1 < picks.length; i++) {
        const start = picks[i], end = picks[i + 1];
        assert.equal(PC.tracePath(mesh, edges, start.tri, start.p, end.tri, end.p).complete, true,
          `Ordinary drawing can proceed through source face chain ${a}/${b}/${c}`);
      }
      chains++;
    }
    assert.equal(chains, 40, 'Both fixtures exercise many adjacent-face drawing chains');
  });
}
