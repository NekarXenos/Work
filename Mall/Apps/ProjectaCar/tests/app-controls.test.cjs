const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'WrapaCar_v9.html'), 'utf8');

// Run the real controls and geometry code without requiring a browser/WebGL.
function appFunction(name) {
  const start = html.indexOf('  function ' + name + '(');
  assert.ok(start >= 0, 'Missing app function: ' + name);
  const end = html.indexOf('\n  function ', start + 1);
  assert.ok(end > start, 'Missing following function after ' + name);
  return html.slice(start, end);
}

function makeHarness() {
  class Material {
    constructor(options) {
      Object.assign(this, { depthTest: true, depthWrite: true, colorWrite: true }, options);
    }
  }
  class Geometry {
    constructor() { this.attributes = {}; this.disposed = false; }
    setAttribute(name, attribute) { this.attributes[name] = attribute; }
    dispose() { this.disposed = true; }
  }
  class Object3D {
    constructor(geometry, material) {
      Object.assign(this, { geometry, material, visible: true, renderOrder: 0 });
    }
  }
  class Attribute {
    constructor(array, itemSize) { this.array = Float32Array.from(array); this.itemSize = itemSize; }
  }
  const inputs = {};
  for (const id of ['showWire', 'wireXray', 'showAtlas']) {
    const tag = html.match(new RegExp('<input\\b[^>]*\\bid="' + id + '"[^>]*>'));
    assert.ok(tag, 'Missing control: ' + id);
    inputs[id] = { checked: /\bchecked\b/.test(tag[0]), disabled: /\bdisabled\b/.test(tag[0]) };
  }
  const context = vm.createContext({
    THREE: {
      MeshStandardMaterial: Material, MeshBasicMaterial: Material, LineBasicMaterial: Material,
      Mesh: Object3D, Line: Object3D, LineSegments: Object3D, Group: Object3D,
      BufferGeometry: Geometry, PlaneGeometry: Geometry, SphereGeometry: Geometry,
      Float32BufferAttribute: Attribute, DoubleSide: 2
    },
    scene: { add() {} },
    $: id => inputs[id],
    S: { radius: 1, mesh: { pos: [0, 0, 0, 1, 0, 0, 0, 1, 0], tris: [0, 1, 2] } },
    vnCache: [0, 0, 1, 0, 0, 1, 0, 0, 1],
    PC: { ekey: (a, b) => a < b ? a + ':' + b : b + ':' + a }
  });
  const setupStart = html.indexOf('  var surfMat = ');
  const setupEnd = html.indexOf('  var raycaster = ', setupStart);
  assert.ok(setupStart >= 0 && setupEnd > setupStart, 'Missing view initialization');
  vm.runInContext(html.slice(setupStart, setupEnd), context);
  for (const name of ['updateViewMode', 'offsetPoint', 'buildWire']) {
    vm.runInContext(appFunction(name), context);
  }
  return { context, inputs };
}

function drawingMaterials(context) {
  return ['wireMat', 'seamMat', 'pathMat', 'ghostMat', 'dotMat', 'snapDotMat', 'ghostDotMat']
    .map(name => {
      assert.ok(context[name], 'Missing drawing material: ' + name);
      return context[name];
    }).concat(context.cursor.material);
}

test('wireframe defaults to occluded edges and preserves the atlas when returning to solid', () => {
  const { context: app, inputs } = makeHarness();
  assert.equal(inputs.showWire.checked, false);
  assert.equal(inputs.wireXray.checked, false);
  assert.equal(inputs.wireXray.disabled, true);
  const atlasTexture = { name: 'existing atlas' };
  app.surfMat.map = atlasTexture;
  inputs.showAtlas.checked = true;
  app.updateViewMode();
  assert.equal(app.surfMat.colorWrite, true);
  assert.equal(app.wireObj.visible, false);

  inputs.showWire.checked = true;
  app.updateViewMode();
  assert.equal(app.wireObj.visible, true);
  assert.equal(app.meshObj.visible, true, 'Depth-only model must stay available for picking');
  assert.equal(app.surfMat.colorWrite, false);
  assert.equal(app.surfMat.depthWrite, true, 'Front faces must occlude rear edges');
  assert.equal(app.surfMat.depthTest, true);
  assert.ok(app.meshObj.renderOrder < app.seamObj.renderOrder, 'Faces must render before opaque seam lines');
  assert.equal(app.surfMat.polygonOffset, true, 'Surface depth bias keeps front edges visible');
  assert.equal(app.wireMat.depthWrite, false, 'Transparent wires must not occlude each other');
  for (const material of drawingMaterials(app)) assert.equal(material.depthTest, true);
  assert.equal(inputs.wireXray.disabled, false);
  assert.equal(inputs.showAtlas.disabled, true);

  inputs.wireXray.checked = true;
  app.updateViewMode();
  for (const material of drawingMaterials(app)) assert.equal(material.depthTest, false);

  inputs.wireXray.checked = false;
  app.updateViewMode();
  for (const material of drawingMaterials(app)) assert.equal(material.depthTest, true);

  inputs.wireXray.checked = true;
  app.updateViewMode();
  inputs.showWire.checked = false;
  app.updateViewMode();
  assert.equal(app.wireObj.visible, false);
  assert.equal(app.surfMat.colorWrite, true);
  for (const material of drawingMaterials(app)) assert.equal(material.depthTest, true);
  assert.equal(inputs.wireXray.disabled, true);
  assert.equal(inputs.showAtlas.disabled, false);
  assert.equal(inputs.showAtlas.checked, true);
  assert.equal(app.surfMat.map, atlasTexture);
});

test('enabling wireframe builds current topology and disposes stale edge buffers', () => {
  const { context: app, inputs } = makeHarness();
  const emptyGeometry = app.wireObj.geometry;
  inputs.showWire.checked = true;
  app.updateViewMode();
  assert.equal(emptyGeometry.disposed, true);
  const firstGeometry = app.wireObj.geometry;
  assert.equal(firstGeometry.attributes.position.array.length, 18, 'Three edges, each with two 3D endpoints');

  inputs.showWire.checked = false;
  app.updateViewMode();
  app.S.mesh = { pos: [0, 0, 0, 2, 0, 0, 0, 2, 0, 2, 2, 0], tris: [0, 1, 2, 1, 3, 2] };
  app.vnCache = [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1];
  inputs.showWire.checked = true;
  app.updateViewMode();
  assert.equal(firstGeometry.disposed, true);
  const positions = app.wireObj.geometry.attributes.position.array;
  assert.equal(positions.length, 30, 'Shared diagonal appears only once across both triangles');
  assert.ok(positions.includes(2), 'Edges reflect the replaced mesh');
});

test('restored wireframe preference can initialize before a mesh is loaded', () => {
  const { context: app, inputs } = makeHarness();
  app.S.mesh = null;
  inputs.showWire.checked = true;
  assert.doesNotThrow(() => app.updateViewMode());
  assert.equal(app.wireObj.visible, true);
  assert.equal(app.surfMat.colorWrite, false);
  assert.equal(app.surfMat.depthWrite, true);
});
