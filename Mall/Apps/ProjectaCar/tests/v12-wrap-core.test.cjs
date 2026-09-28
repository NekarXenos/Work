'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', 'WrapaCar_v12.html'), 'utf8');
const core = vm.createContext({});
for (const name of ['PanelCore', 'VectorCore']) {
  vm.runInContext(html.match(new RegExp('<script>\\s*(/\\* ' + name + '[\\s\\S]*?)</script>'))[1], core);
}
const { PanelCore: PC, VectorCore: VC } = core;

function mirroredPanels() {
  const pos = [], tris = [], panel = [], n = 8;
  for (const [start, id] of [[-3, 17], [1, 42]]) {
    const base = pos.length / 3;
    for (let y = 0; y <= n; y++) for (let x = 0; x <= n; x++) pos.push(start + 2 * x / n, -1 + 2 * y / n, 0);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const a = base + y * (n + 1) + x;
      tris.push(a, a + 1, a + n + 2, a, a + n + 2, a + n + 1);
      panel.push(id, id);
    }
  }
  const mesh = PC.makeMesh(pos, tris);
  mesh.panel = panel;
  return mesh;
}

for (const selected of [17, 42]) {
  test(`suggestions use stable panel ID ${selected} and leave its excluded mirror untouched`, () => {
    const mesh = mirroredPanels(), seen = new Set();
    const list = PC.suggestSplits(mesh, PC.buildEdgeMap(mesh), {
      unit: 1000, width: 1200, plane: { axis: 0, offset: 0 }, up: [0, 0, 1], forward: [0, 1, 0],
      includePanel: id => { seen.add(id); return id === selected; }
    });
    assert.deepEqual([...seen].sort((a, b) => a - b), [17, 42]);
    assert.ok(list.length > 0, 'An oversized selected panel still gets a seam');
    for (const suggestion of list) {
      assert.equal(suggestion.panel, selected);
      assert.equal(suggestion.twin, undefined);
      for (const seam of suggestion.paths) for (const point of seam.points) {
        assert.ok(selected === 17 ? point[0] < 0 : point[0] > 0, 'No seam reaches the excluded side');
      }
    }
  });
}

test('selected mirrored panels still share paired suggestions', () => {
  const mesh = mirroredPanels();
  const list = PC.suggestSplits(mesh, PC.buildEdgeMap(mesh), {
    unit: 1000, width: 1200, plane: { axis: 0, offset: 0 }, up: [0, 0, 1], forward: [0, 1, 0],
    includePanel: () => true
  });
  assert.ok(list.length > 0);
  assert.ok(list.every(suggestion => suggestion.twin && suggestion.twin.paths.length));
});

function partialAtlas(count) {
  const n = 8, width = count * n, pos = [], tris = [], panel = [];
  for (let y = 0; y <= n; y++) for (let x = 0; x <= width; x++) pos.push(x / n, y / n, 0);
  for (let y = 0; y < n; y++) for (let x = 0; x < width; x++) {
    const a = y * (width + 1) + x;
    tris.push(a, a + 1, a + width + 2, a, a + width + 2, a + width + 1);
    panel.push(Math.floor(x / n), Math.floor(x / n));
  }
  const mesh = PC.makeMesh(pos, tris), edgeMap = PC.buildEdgeMap(mesh);
  mesh.panel = panel;
  const uv = new Float64Array(tris.length * 2), faces = [], scale = 0.3;
  for (let f = 0; f < panel.length; f++) {
    if (panel[f] !== 1) continue;
    faces.push(f);
    for (let k = 0; k < 3; k++) {
      const v = tris[3 * f + k];
      uv[6 * f + 2 * k] = 0.1 + pos[3 * v] * scale;
      uv[6 * f + 2 * k + 1] = 0.2 + pos[3 * v + 1] * scale;
    }
  }
  return { pos, tris, edgeMap, uv, panel, islands: new Map([[1, faces]]),
    locate: PC.faceLocator(mesh).closest, scale, edge: 1 / n };
}

for (const count of [2, 3]) {
  test(`existing artwork starts outside the atlas and reaches a selected panel (${count} surfaces)`, () => {
    const model = partialAtlas(count), originalUV = Array.from(model.uv);
    const path = { closed: false, nodes: [{ p: [0.25, 0.47, 0] }, { p: [count - 0.25, 0.47, 0] }] };
    const result = VC.derive(model, path, { tol: 1e-7 });
    assert.ok(result, 'A missing atlas island does not discard the whole artwork');
    assert.equal(result.samples.breaks, 0);
    assert.deepEqual(Array.from(result.islands, island => island.panel), [1]);
    assert.ok(result.islands[0].segs.length > 0);
    for (const segment of result.islands[0].segs) {
      assert.ok(segment.c.every(Number.isFinite));
      for (let i = 1; i < segment.c.length; i += 2) {
        assert.ok(Math.abs(segment.c[i] - (0.2 + 0.47 * model.scale)) < 1e-7, 'The selected artwork stays on its original surface line');
      }
    }
    assert.deepEqual(Array.from(model.uv), originalUV, 'Excluded faces receive no atlas UVs');
  });
}

test('a closed shape with all nodes on excluded panels still prints its selected portion', () => {
  const model = partialAtlas(3);
  const result = VC.derive(model, {
    closed: true, fill: [0, 100, 100, 0], nodes: [[0.25, 0.25, 0], [2.75, 0.25, 0], [2.75, 0.75, 0], [0.25, 0.75, 0]]
      .map(p => ({ p }))
  }, { tol: 1e-7 });
  assert.ok(result);
  assert.equal(result.samples.breaks, 0);
  assert.deepEqual(Array.from(result.islands, island => island.panel), [1]);
  assert.ok(result.inside.size > 0);
  assert.ok(result.islands[0].segs.length > 0);
});
