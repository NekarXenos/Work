/* Native, portable 3D scenery and sprite assets. All colours and materials
   are kept as voxel bytes; only empty sprite voxels are transparent. */
(function (ZX) {
  'use strict';

  var A = ZX.Assets = {};
  var MAGIC = 'ZX3DAS1\n', HEADER_MAX = 65536;
  var LIMIT = [255, 175, 255];

  function fail(message) { throw new Error(message); }
  function integer(n, low, high) {
    return typeof n === 'number' && isFinite(n) && Math.floor(n) === n && n >= low && n <= high;
  }
  function room(bytes, credit) {
    if (ZX.Mem && !ZX.Mem.wouldFit(Math.max(0, bytes - (credit || 0)))) fail('Not enough memory for this 3D asset');
  }
  function dimensions(a) {
    if (!integer(a.w, 1, LIMIT[0]) || !integer(a.h, 1, LIMIT[1]) || !integer(a.d, 1, LIMIT[2])) {
      fail('Invalid 3D asset dimensions (maximum 255 x 175 x 255)');
    }
    return a.w * a.h * a.d;
  }
  function meta(a) {
    if (!a || (a.kind !== 'world' && a.kind !== 'sprite')) fail('Unknown 3D asset kind');
    var count = dimensions(a);
    if (typeof a.name !== 'string' || !a.name.trim() || a.name.length > 128) fail('Asset name must be 1 to 128 characters');
    if (!Array.isArray(a.origin) || a.origin.length !== 3 || !a.origin.every(function (v, i) {
      return integer(v, 0, LIMIT[i] - 1);
    })) fail('Invalid 3D asset origin');
    if (a.kind === 'world' && a.origin.some(function (v) { return v !== 0; })) fail('Invalid scenery origin');
    if (typeof a.materials !== 'boolean') fail('Invalid material encoding');
    if (a.kind === 'world' && !a.materials) fail('Scenery must preserve voxel materials');
    return count;
  }
  function frameList(a) { return a.kind === 'world' ? [a.data] : a.frames; }
  function check(a) {
    var count = meta(a), frames = frameList(a);
    if (!Array.isArray(frames) || !integer(frames.length, 1, a.kind === 'world' ? 1 : 32)) fail('Invalid sprite frame count');
    var max = a.materials ? 48 : 16;
    frames.forEach(function (frame) {
      if (!(frame instanceof Uint8Array) || frame.length !== count) fail('Invalid 3D asset voxel count');
      for (var i = 0; i < frame.length; i++) if (frame[i] > max) fail('Invalid voxel colour or material');
    });
    return frames;
  }
  function assetName(name) { return String(name || 'untitled').trim() || 'untitled'; }

  A.captureScene = function (world, name) {
    dimensions({ w: world.W, h: world.H, d: world.D });
    room(world.data.length);
    return { name: assetName(name), kind: 'world', w: world.W, h: world.H, d: world.D,
      origin: [0, 0, 0], materials: true, data: world.data.slice() };
  };

  A.captureSprite = function (world, name, options) {
    options = options || {};
    var b = options.bounds || { x: 0, y: 0, z: 0, w: world.W, h: world.H, d: world.D };
    var sizes = [world.W, world.H, world.D], starts = [b.x, b.y, b.z], spans = [b.w, b.h, b.d];
    for (var axis = 0; axis < 3; axis++) {
      if (!integer(starts[axis], 0, sizes[axis] - 1) || !integer(spans[axis], 1, sizes[axis]) ||
          starts[axis] + spans[axis] > sizes[axis]) fail('Sprite capture bounds must be inside the 3D screen');
    }
    var minX = world.W, minY = world.H, minZ = world.D, maxX = -1, maxY = -1, maxZ = -1;
    var x, y, z, y0 = Math.max(b.y, options.includeFloor ? 0 : 1);
    for (y = y0; y < b.y + b.h; y++) for (z = b.z; z < b.z + b.d; z++) {
      var base = world.W * (world.D - 1 - z + world.D * y);
      for (x = b.x; x < b.x + b.w; x++) if (world.data[base + x]) {
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
      }
    }
    if (maxX < 0) fail('No voxels to capture in this region');
    var w = maxX - minX + 1, h = maxY - minY + 1, d = maxZ - minZ + 1;
    room(w * h * d);
    var data = new Uint8Array(w * h * d), i = 0;
    for (z = minZ; z <= maxZ; z++) for (y = maxY; y >= minY; y--) {
      for (x = minX; x <= maxX; x++) data[i++] = world.get(x, y, z);
    }
    return { name: assetName(name), kind: 'sprite', w: w, h: h, d: d,
      origin: [minX, minY, minZ], materials: true, frames: [data] };
  };

  A.captureExistingSprite = function (basic, n, name) {
    var sp = basic.sprites[n];
    if (!sp) fail('Sprite ' + n + ' is not defined');
    var a = { name: assetName(name), kind: 'sprite', w: sp.w, h: sp.h, d: sp.d,
      origin: [0, 0, 0], materials: !!sp.materials, frames: sp.f };
    check(a);
    return a;
  };

  function pack(data) {
    var i = 0, runs = 0;
    while (i < data.length) {
      var j = i + 1;
      while (j < data.length && data[j] === data[i] && j - i < 65535) j++;
      runs++; i = j;
    }
    if (runs * 3 >= data.length) return { encoding: 'raw', data: data };
    var out = new Uint8Array(runs * 3), p = 0;
    i = 0;
    while (i < data.length) {
      j = i + 1;
      while (j < data.length && data[j] === data[i] && j - i < 65535) j++;
      out[p++] = data[i]; out[p++] = (j - i) & 255; out[p++] = (j - i) >> 8; i = j;
    }
    return { encoding: 'rle', data: out };
  }

  A.encode = function (asset) {
    var frames = check(asset), packed = frames.map(pack);
    var header = { format: 'zx3d-asset', version: 1, name: asset.name, kind: asset.kind,
      w: asset.w, h: asset.h, d: asset.d, origin: asset.origin, materials: asset.materials,
      layout: asset.kind === 'world' ? 'world-storage' : 'sprite-top-down',
      frames: packed.map(function (p) { return { encoding: p.encoding, length: p.data.length }; }) };
    var json = new TextEncoder().encode(JSON.stringify(header));
    var total = 12 + json.length;
    packed.forEach(function (p) { total += p.data.length; });
    room(total);
    var bytes = new Uint8Array(total);
    for (var i = 0; i < MAGIC.length; i++) bytes[i] = MAGIC.charCodeAt(i);
    new DataView(bytes.buffer).setUint32(8, json.length, true);
    bytes.set(json, 12);
    var offset = 12 + json.length;
    packed.forEach(function (p) { bytes.set(p.data, offset); offset += p.data.length; });
    return bytes;
  };

  A.decode = function (bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length < 12) fail('Not a ZX3D asset file');
    for (var i = 0; i < MAGIC.length; i++) if (bytes[i] !== MAGIC.charCodeAt(i)) fail('Not a ZX3D asset file');
    var length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(8, true);
    if (!integer(length, 1, HEADER_MAX) || 12 + length > bytes.length) fail('Invalid 3D asset header');
    var h;
    try { h = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(12, 12 + length))); }
    catch (e) { fail('Invalid 3D asset header'); }
    if (!h || h.format !== 'zx3d-asset' || h.version !== 1) fail('Unsupported 3D asset version');
    var count = meta(h);
    if (h.layout !== (h.kind === 'world' ? 'world-storage' : 'sprite-top-down')) fail('Unknown 3D asset layout');
    if (!Array.isArray(h.frames) || !integer(h.frames.length, 1, h.kind === 'world' ? 1 : 32)) fail('Invalid sprite frame count');
    room(count * h.frames.length);
    var offset = 12 + length, frames = [], max = h.materials ? 48 : 16;
    h.frames.forEach(function (f) {
      if (!f || !integer(f.length, 1, count * 3) || offset + f.length > bytes.length ||
          (f.encoding !== 'raw' && f.encoding !== 'rle')) fail('Invalid 3D asset frame');
      var end = offset + f.length, p = offset, total = 0;
      if (f.encoding === 'raw') {
        if (f.length !== count) fail('Wrong 3D asset voxel count');
        for (; p < end; p++) if (bytes[p] > max) fail('Invalid voxel colour or material');
      } else {
        if (f.length % 3) fail('Truncated 3D asset run');
        for (; p < end; p += 3) {
          var run = bytes[p + 1] | (bytes[p + 2] << 8);
          if (!run || bytes[p] > max || total + run > count) fail('Invalid 3D asset run');
          total += run;
        }
        if (total !== count) fail('Wrong 3D asset voxel count');
      }
      var frame = new Uint8Array(count);
      if (f.encoding === 'raw') frame.set(bytes.subarray(offset, end));
      else {
        total = 0;
        for (p = offset; p < end; p += 3) {
          run = bytes[p + 1] | (bytes[p + 2] << 8);
          frame.fill(bytes[p], total, total + run); total += run;
        }
      }
      frames.push(frame); offset = end;
    });
    if (offset !== bytes.length) fail('Unexpected trailing data in 3D asset');
    var a = { name: h.name, kind: h.kind, w: h.w, h: h.h, d: h.d, origin: h.origin, materials: h.materials };
    if (h.kind === 'world') a.data = frames[0];
    else a.frames = frames;
    return a;
  };

  A.applyScene = function (basic, asset) {
    check(asset);
    if (asset.kind !== 'world') fail('This asset is a sprite, not scenery');
    var world = basic.world;
    if (asset.w > world.W || asset.h > world.H || asset.d > world.D) fail('Scenery is larger than the 3D screen');
    if (asset.w === world.W && asset.h === world.H && asset.d === world.D) world.data.set(asset.data);
    else {
      world.data.fill(0);
      for (var y = 0; y < asset.h; y++) for (var z = 0; z < asset.d; z++) {
        var source = asset.w * (asset.d - 1 - z + asset.d * y);
        var target = world.W * (world.D - 1 - z + world.D * y);
        world.data.set(asset.data.subarray(source, source + asset.w), target);
      }
    }
    for (var ci = 0; ci < world.nchunks; ci++) { world.recount(ci); world.markDirty(ci); }
    // An old sprite's saved background belongs to the previous scenery.
    basic.putSaves = {};
  };

  A.installSprite = function (basic, asset, n) {
    var frames = check(asset);
    if (asset.kind !== 'sprite') fail('This asset is scenery, not a sprite');
    if (!integer(n, 0, 65535)) fail('Sprite number must be between 0 and 65535');
    var bytes = asset.w * asset.h * asset.d * frames.length;
    room(bytes, ZX.Mem.pools['sprite' + n] || 0);
    // Clone so SDATA edits cannot alter a captured asset still held by the UI.
    var copies = frames.map(function (f) { return f.slice(); });
    basic.unput(n);
    basic.sprites[n] = { w: asset.w, h: asset.h, d: asset.d, nf: frames.length,
      f: copies, materials: asset.materials };
    ZX.Mem.claim('sprite' + n, bytes);
  };

})(window.ZX = window.ZX || {});
