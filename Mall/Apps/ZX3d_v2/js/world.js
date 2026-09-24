/* ==========================================================================
   world.js -- the solid display.

   A 255 x 175 x 255 grid of eighth-metre voxels. Voxel (x,y,z) sits at
   three.js (x*PIX, y*PIX, z*PIX): x rightwards, y up, z into the screen,
   origin at the bottom-front-left corner, exactly where PLOT 0,0,0 belongs.

   Chunks of 32 are meshed with a greedy rectangle merge so a flood-filled
   background costs a handful of quads instead of forty thousand.
   ========================================================================== */
(function (ZX) {
  'use strict';

  var CH = ZX.CHUNK, PIX = ZX.PIX;

  /* ---- scratch buffers reused by every chunk rebuild --------------------- */
  var maskBuf = new Int32Array(CH * CH);

  function Bucket() { this.pos = []; this.nor = []; this.col = []; }
  Bucket.prototype.empty = function () { return this.pos.length === 0; };

  /** Is the face of `a` looking at `b` worth drawing? */
  function faceVis(a, b) {
    if (a === 0) return false;
    if (b === 0) return true;
    var ma = (a - 1) >> 4, mb = (b - 1) >> 4;
    if (ma === ZX.MAT_GLASS) return false;    // glass hides behind anything solid
    return mb === ZX.MAT_GLASS;               // solid shows through glass
  }

  /* ======================================================================== */

  function World(W, H, D) {
    this.W = W; this.H = H; this.D = D;
    this.WD = W * D;

    var bytes = W * H * D;
    ZX.Mem.claim('display', bytes);
    this.data = new Uint8Array(bytes);

    this.cx = Math.ceil(W / CH);
    this.cy = Math.ceil(H / CH);
    this.cz = Math.ceil(D / CH);
    this.nchunks = this.cx * this.cy * this.cz;
    this.chunks = new Array(this.nchunks);
    this.solidCount = new Int32Array(this.nchunks);
    ZX.Mem.claim('chunkindex', this.nchunks * 8);

    this.dirty = [];
    this.dirtySet = new Uint8Array(this.nchunks);
    this.liveMeshes = 0;
    this.quads = 0;

    this.group = new THREE.Group();
    this.group.name = 'voxels';

    this.matSolid = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.matGlass = new THREE.MeshLambertMaterial({
      vertexColors: true, transparent: true, opacity: 0.42, depthWrite: false
    });
    this.matGlow = new THREE.MeshBasicMaterial({ vertexColors: true });
    this.mats = [this.matSolid, this.matGlass, this.matGlow];
  }
  ZX.World = World;

  /* ---- access ----------------------------------------------------------- */

  World.prototype.inside = function (x, y, z) {
    return x >= 0 && y >= 0 && z >= 0 && x < this.W && y < this.H && z < this.D;
  };

  /* ---- display z versus storage z ----------------------------------------
     A viewer stands in front of the screen and looks along three.js -Z, so
     that x runs to their right and y upwards, as any screen does. Depth runs
     away from them -- which makes the display left-handed while three.js is
     right-handed, so one flip has to happen somewhere.

     It happens here, and nowhere else. The public get/set/draw calls take
     PLOT's z: 0 at the front glass, growing into the screen. Storage, the
     mesher and the player's physics all work in storage z, which runs the
     other way, so the geometry stays right-handed and nothing is mirrored. */
  World.prototype.storeZ = function (z) { return this.D - 1 - z; };

  /** Storage-space read: no flip. For the mesher and collision only. */
  World.prototype.raw = function (x, y, z) {
    if (x < 0 || y < 0 || z < 0 || x >= this.W || y >= this.H || z >= this.D) return 0;
    return this.data[x + this.W * (z + this.D * y)];
  };

  World.prototype.get = function (x, y, z) {
    return this.raw(x, y, this.D - 1 - z);
  };

  World.prototype.chunkIndexOf = function (x, y, z) {
    return (((y / CH) | 0) * this.cz + ((z / CH) | 0)) * this.cx + ((x / CH) | 0);
  };

  World.prototype.markDirty = function (ci) {
    if (ci < 0 || ci >= this.nchunks || this.dirtySet[ci]) return;
    this.dirtySet[ci] = 1;
    this.dirty.push(ci);
  };

  World.prototype.set = function (x, y, z, v) {
    return this.setRaw(x, y, this.D - 1 - z, v);
  };

  /** Storage-space write: no flip. */
  World.prototype.setRaw = function (x, y, z, v) {
    if (x < 0 || y < 0 || z < 0 || x >= this.W || y >= this.H || z >= this.D) return false;
    var i = x + this.W * (z + this.D * y);
    var old = this.data[i];
    if (old === v) return false;
    this.data[i] = v;

    var ci = this.chunkIndexOf(x, y, z);
    if (old === 0 && v !== 0) this.solidCount[ci]++;
    else if (old !== 0 && v === 0) this.solidCount[ci]--;
    this.markDirty(ci);

    // A voxel on a chunk seam changes its neighbour's hidden faces too.
    var lx = x % CH, ly = y % CH, lz = z % CH;
    if (lx === 0 && x > 0) this.markDirty(ci - 1);
    if (lx === CH - 1 && x < this.W - 1) this.markDirty(ci + 1);
    if (lz === 0 && z > 0) this.markDirty(ci - this.cx);
    if (lz === CH - 1 && z < this.D - 1) this.markDirty(ci + this.cx);
    if (ly === 0 && y > 0) this.markDirty(ci - this.cx * this.cz);
    if (ly === CH - 1 && y < this.H - 1) this.markDirty(ci + this.cx * this.cz);
    return true;
  };

  /** Convenience: place colour/material, or clear when colour is null. */
  World.prototype.plot = function (x, y, z, colour, mat) {
    return this.set(x, y, z, colour === null ? 0 : ZX.vox(colour, mat));
  };

  World.prototype.clearAll = function (v) {
    v = v || 0;
    this.data.fill(v);
    var full = v ? CH * CH * CH : 0;
    for (var i = 0; i < this.nchunks; i++) {
      this.solidCount[i] = full;
      this.markDirty(i);
    }
  };

  /** Wipe everything above the floor slab, leaving the floor to stand on. */
  World.prototype.clearAbove = function (floorY) {
    this.data.fill(0, this.W * this.D * floorY);
    var layer = this.cx * this.cz;
    for (var i = 0; i < this.nchunks; i++) {
      var y0 = ((i / layer) | 0) * CH, y1 = y0 + CH;
      if (y1 <= floorY) continue;                    // wholly below: untouched
      if (y0 >= floorY) {                            // wholly above: now empty
        if (this.solidCount[i] !== 0) { this.solidCount[i] = 0; this.markDirty(i); }
      } else {                                       // straddles the cut
        this.recount(i);
        this.markDirty(i);
      }
    }
  };

  World.prototype.recount = function (ci) {
    var cxi = ci % this.cx;
    var czi = ((ci / this.cx) | 0) % this.cz;
    var cyi = (ci / (this.cx * this.cz)) | 0;
    var ox = cxi * CH, oy = cyi * CH, oz = czi * CH;
    var ex = Math.min(ox + CH, this.W), ey = Math.min(oy + CH, this.H), ez = Math.min(oz + CH, this.D);
    var n = 0, x, y, z, base;
    for (y = oy; y < ey; y++) {
      for (z = oz; z < ez; z++) {
        base = this.W * (z + this.D * y);
        for (x = ox; x < ex; x++) if (this.data[base + x]) n++;
      }
    }
    this.solidCount[ci] = n;
  };

  /* ---- meshing ----------------------------------------------------------- */

  World.prototype.buildChunk = function (ci) {
    var cxi = ci % this.cx;
    var czi = ((ci / this.cx) | 0) % this.cz;
    var cyi = (ci / (this.cx * this.cz)) | 0;
    var ox = cxi * CH, oy = cyi * CH, oz = czi * CH;

    var slot = this.chunks[ci];
    if (this.solidCount[ci] <= 0) { this.disposeChunk(ci); return; }

    var dims = [
      Math.min(CH, this.W - ox),
      Math.min(CH, this.H - oy),
      Math.min(CH, this.D - oz)
    ];
    var origin = [ox, oy, oz];
    var buckets = [new Bucket(), new Bucket(), new Bucket()];

    var x = [0, 0, 0], q = [0, 0, 0], du = [0, 0, 0], dv = [0, 0, 0];
    var d, u, v, i, j, k, n, w, h, c, a, b, m, done;

    for (d = 0; d < 3; d++) {
      u = (d + 1) % 3; v = (d + 2) % 3;
      q[0] = q[1] = q[2] = 0; q[d] = 1;
      var du_n = dims[u], dv_n = dims[v];
      var mask = maskBuf;

      for (x[d] = -1; x[d] < dims[d];) {
        n = 0;
        for (x[v] = 0; x[v] < dv_n; x[v]++) {
          for (x[u] = 0; x[u] < du_n; x[u]++, n++) {
            a = this.raw(origin[0] + x[0], origin[1] + x[1], origin[2] + x[2]);
            b = this.raw(origin[0] + x[0] + q[0], origin[1] + x[1] + q[1], origin[2] + x[2] + q[2]);
            m = 0;
            if (x[d] >= 0 && faceVis(a, b)) m = a;
            else if (x[d] < dims[d] - 1 && faceVis(b, a)) m = -b;
            mask[n] = m;
          }
        }
        x[d]++;

        n = 0;
        for (j = 0; j < dv_n; j++) {
          for (i = 0; i < du_n;) {
            c = mask[n];
            if (c === 0) { i++; n++; continue; }

            w = 1;
            while (i + w < du_n && mask[n + w] === c) w++;

            h = 1; done = false;
            while (j + h < dv_n) {
              for (k = 0; k < w; k++) {
                if (mask[n + k + h * du_n] !== c) { done = true; break; }
              }
              if (done) break;
              h++;
            }

            x[u] = i; x[v] = j;
            du[0] = du[1] = du[2] = 0; du[u] = w;
            dv[0] = dv[1] = dv[2] = 0; dv[v] = h;

            this.emitQuad(buckets, c,
              origin[0] + x[0], origin[1] + x[1], origin[2] + x[2],
              du, dv, q);

            for (var l = 0; l < h; l++) {
              for (k = 0; k < w; k++) mask[n + k + l * du_n] = 0;
            }
            i += w; n += w;
          }
        }
      }
    }

    if (!slot) slot = this.chunks[ci] = { meshes: [null, null, null] };
    for (i = 0; i < 3; i++) this.applyBucket(slot, i, buckets[i]);
  };

  World.prototype.emitQuad = function (buckets, c, bx, by, bz, du, dv, q) {
    var val = c > 0 ? c : -c;
    var sign = c > 0 ? 1 : -1;
    var mat = (val - 1) >> 4;
    var col = ZX.PAL_F[(val - 1) & 15];
    var bk = buckets[mat];

    var x0 = bx * PIX, y0 = by * PIX, z0 = bz * PIX;
    var ux = du[0] * PIX, uy = du[1] * PIX, uz = du[2] * PIX;
    var vx = dv[0] * PIX, vy = dv[1] * PIX, vz = dv[2] * PIX;

    var p = bk.pos, nn = bk.nor, cc = bk.col;
    var ax = x0, ay = y0, az = z0;
    var bx2 = x0 + ux, by2 = y0 + uy, bz2 = z0 + uz;
    var cx2 = x0 + ux + vx, cy2 = y0 + uy + vy, cz2 = z0 + uz + vz;
    var dx2 = x0 + vx, dy2 = y0 + vy, dz2 = z0 + vz;

    if (sign > 0) {
      p.push(ax, ay, az, bx2, by2, bz2, cx2, cy2, cz2,
             ax, ay, az, cx2, cy2, cz2, dx2, dy2, dz2);
    } else {
      p.push(ax, ay, az, dx2, dy2, dz2, cx2, cy2, cz2,
             ax, ay, az, cx2, cy2, cz2, bx2, by2, bz2);
    }
    var nx = q[0] * sign, ny = q[1] * sign, nz = q[2] * sign;
    for (var t = 0; t < 6; t++) {
      nn.push(nx, ny, nz);
      cc.push(col[0], col[1], col[2]);
    }
  };

  World.prototype.applyBucket = function (slot, mi, bk) {
    var mesh = slot.meshes[mi];
    if (bk.empty()) {
      if (mesh) {
        this.group.remove(mesh);
        mesh.geometry.dispose();
        slot.meshes[mi] = null;
        this.liveMeshes--;
      }
      return;
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(bk.pos), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(bk.nor), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(bk.col), 3));
    g.computeBoundingSphere();

    if (mesh) {
      mesh.geometry.dispose();
      mesh.geometry = g;
    } else {
      mesh = new THREE.Mesh(g, this.mats[mi]);
      mesh.matrixAutoUpdate = false;
      if (mi === ZX.MAT_SOLID) { mesh.castShadow = true; mesh.receiveShadow = true; }
      else if (mi === ZX.MAT_GLASS) { mesh.receiveShadow = true; mesh.renderOrder = 2; }
      slot.meshes[mi] = mesh;
      this.group.add(mesh);
      this.liveMeshes++;
    }
  };

  World.prototype.disposeChunk = function (ci) {
    var slot = this.chunks[ci];
    if (!slot) return;
    for (var i = 0; i < 3; i++) {
      var m = slot.meshes[i];
      if (m) { this.group.remove(m); m.geometry.dispose(); this.liveMeshes--; }
    }
    this.chunks[ci] = null;
  };

  /** Rebuild queued chunks, spending at most `ms` on it. */
  World.prototype.update = function (ms) {
    if (!this.dirty.length) return 0;
    var t0 = performance.now(), n = 0;
    while (this.dirty.length) {
      var ci = this.dirty.pop();
      this.dirtySet[ci] = 0;
      this.buildChunk(ci);
      n++;
      if (performance.now() - t0 > ms) break;
    }
    return n;
  };

  World.prototype.flush = function () {
    while (this.dirty.length) {
      var ci = this.dirty.pop();
      this.dirtySet[ci] = 0;
      this.buildChunk(ci);
    }
  };

  /* ---- drawing primitives ------------------------------------------------
     All of these take voxel coordinates and a paint descriptor
     p = {colour:0..15, mat:0..2, over:0|1, erase:bool}                      */

  World.prototype.paint = function (x, y, z, p) {
    if (!this.inside(x, y, z)) return;
    if (p.erase) { this.set(x, y, z, 0); return; }
    var v = ZX.vox(p.colour, p.mat);
    if (p.over) {                               // OVER 1 -- XOR the colour
      var cur = this.get(x, y, z);
      if (cur) {
        var nc = ZX.voxColour(cur) ^ p.colour;
        this.set(x, y, z, nc === 0 ? 0 : ZX.vox(nc, p.mat));
        return;
      }
    }
    this.set(x, y, z, v);
  };

  World.prototype.line = function (x0, y0, z0, x1, y1, z1, p) {
    x0 |= 0; y0 |= 0; z0 |= 0; x1 |= 0; y1 |= 0; z1 |= 0;
    var dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0), dz = Math.abs(z1 - z0);
    var sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1, sz = z0 < z1 ? 1 : -1;
    var i, e1, e2;
    if (dx >= dy && dx >= dz) {
      e1 = 2 * dy - dx; e2 = 2 * dz - dx;
      for (i = 0; i <= dx; i++) {
        this.paint(x0, y0, z0, p);
        if (e1 > 0) { y0 += sy; e1 -= 2 * dx; }
        if (e2 > 0) { z0 += sz; e2 -= 2 * dx; }
        e1 += 2 * dy; e2 += 2 * dz; x0 += sx;
      }
    } else if (dy >= dx && dy >= dz) {
      e1 = 2 * dx - dy; e2 = 2 * dz - dy;
      for (i = 0; i <= dy; i++) {
        this.paint(x0, y0, z0, p);
        if (e1 > 0) { x0 += sx; e1 -= 2 * dy; }
        if (e2 > 0) { z0 += sz; e2 -= 2 * dy; }
        e1 += 2 * dx; e2 += 2 * dz; y0 += sy;
      }
    } else {
      e1 = 2 * dy - dz; e2 = 2 * dx - dz;
      for (i = 0; i <= dz; i++) {
        this.paint(x0, y0, z0, p);
        if (e1 > 0) { y0 += sy; e1 -= 2 * dz; }
        if (e2 > 0) { x0 += sx; e2 -= 2 * dz; }
        e1 += 2 * dy; e2 += 2 * dx; z0 += sz;
      }
    }
  };

  World.prototype.circle = function (cx, cy, cz, r, p) {
    cx |= 0; cy |= 0; cz |= 0; r = Math.abs(Math.round(r));
    if (r === 0) { this.paint(cx, cy, cz, p); return; }
    var x = r, y = 0, err = 1 - r;
    while (x >= y) {
      this.paint(cx + x, cy + y, cz, p); this.paint(cx + y, cy + x, cz, p);
      this.paint(cx - y, cy + x, cz, p); this.paint(cx - x, cy + y, cz, p);
      this.paint(cx - x, cy - y, cz, p); this.paint(cx - y, cy - x, cz, p);
      this.paint(cx + y, cy - x, cz, p); this.paint(cx + x, cy - y, cz, p);
      y++;
      if (err < 0) err += 2 * y + 1;
      else { x--; err += 2 * (y - x) + 1; }
    }
  };

  World.prototype.sphere = function (cx, cy, cz, r, p, solid) {
    cx |= 0; cy |= 0; cz |= 0; r = Math.abs(Math.round(r));
    if (r > 127) r = 127;
    var r2 = r * r, ri2 = (r - 1) * (r - 1);
    for (var z = -r; z <= r; z++) {
      for (var y = -r; y <= r; y++) {
        var yz = y * y + z * z;
        if (yz > r2) continue;
        for (var x = -r; x <= r; x++) {
          var dd = x * x + yz;
          if (dd > r2) continue;
          if (!solid && dd < ri2) continue;
          this.paint(cx + x, cy + y, cz + z, p);
        }
      }
    }
  };

  World.prototype.box = function (x, y, z, w, h, d, p, solid) {
    x |= 0; y |= 0; z |= 0;
    w = Math.max(1, w | 0); h = Math.max(1, h | 0); d = Math.max(1, d | 0);
    var i, j, k;
    if (solid) {
      for (k = 0; k < d; k++) for (j = 0; j < h; j++) for (i = 0; i < w; i++) {
        this.paint(x + i, y + j, z + k, p);
      }
      return;
    }
    for (k = 0; k < d; k++) for (j = 0; j < h; j++) for (i = 0; i < w; i++) {
      var edges = (i === 0 || i === w - 1) + (j === 0 || j === h - 1) + (k === 0 || k === d - 1);
      if (edges >= 2) this.paint(x + i, y + j, z + k, p);
    }
  };

  /** Text as pixel blocks, extruded `depth` blocks into the screen. */
  World.prototype.text = function (x, y, z, str, p, depth) {
    depth = Math.max(1, depth || 1);
    var cxp = x | 0;
    for (var c = 0; c < str.length; c++) {
      var g = ZX.glyph(str.charCodeAt(c));
      for (var row = 0; row < 8; row++) {
        var bits = g[row];
        for (var bit = 0; bit < 8; bit++) {
          if (!(bits & (0x80 >> bit))) continue;
          for (var dz = 0; dz < depth; dz++) {
            this.paint(cxp + bit, (y | 0) + (7 - row), (z | 0) + dz, p);
          }
        }
      }
      cxp += 8;
    }
    return cxp - (x | 0);
  };

  /** Bounded 3D flood fill from a seed, replacing whatever is there. */
  World.prototype.fill = function (x, y, z, p, limit) {
    limit = limit || 400000;
    if (!this.inside(x, y, z)) return 0;
    var target = this.get(x, y, z);
    var repl = p.erase ? 0 : ZX.vox(p.colour, p.mat);
    if (target === repl) return 0;
    var stack = [x, y, z], n = 0;
    while (stack.length && n < limit) {
      var cz = stack.pop(), cy = stack.pop(), cx = stack.pop();
      if (!this.inside(cx, cy, cz) || this.get(cx, cy, cz) !== target) continue;
      this.set(cx, cy, cz, repl); n++;
      stack.push(cx + 1, cy, cz, cx - 1, cy, cz,
                 cx, cy + 1, cz, cx, cy - 1, cz,
                 cx, cy, cz + 1, cx, cy, cz - 1);
    }
    return n;
  };

  /* ---- picking ----------------------------------------------------------
     Amanatides & Woo voxel traversal in world units.                        */
  World.prototype.raycast = function (ox, oy, oz, dx, dy, dz, maxDist) {
    var t = 0;
    var x = Math.floor(ox / PIX), y = Math.floor(oy / PIX), z = Math.floor(oz / PIX);
    var stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
    var stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
    var stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;

    var tDeltaX = stepX ? Math.abs(PIX / dx) : Infinity;
    var tDeltaY = stepY ? Math.abs(PIX / dy) : Infinity;
    var tDeltaZ = stepZ ? Math.abs(PIX / dz) : Infinity;

    var tMaxX = stepX ? ((stepX > 0 ? (x + 1) * PIX - ox : ox - x * PIX) / Math.abs(dx)) : Infinity;
    var tMaxY = stepY ? ((stepY > 0 ? (y + 1) * PIX - oy : oy - y * PIX) / Math.abs(dy)) : Infinity;
    var tMaxZ = stepZ ? ((stepZ > 0 ? (z + 1) * PIX - oz : oz - z * PIX) / Math.abs(dz)) : Infinity;

    var nx = 0, ny = 0, nz = 0, guard = 0;
    while (t <= maxDist && guard++ < 4096) {
      var v = this.raw(x, y, z);
      // handed back in display z, so the caller can feed it straight to set()
      if (v) {
        return {
          x: x, y: y, z: this.D - 1 - z, v: v,
          nx: nx, ny: ny, nz: -nz, t: t
        };
      }
      if (tMaxX < tMaxY && tMaxX < tMaxZ) {
        x += stepX; t = tMaxX; tMaxX += tDeltaX; nx = -stepX; ny = 0; nz = 0;
      } else if (tMaxY < tMaxZ) {
        y += stepY; t = tMaxY; tMaxY += tDeltaY; nx = 0; ny = -stepY; nz = 0;
      } else {
        z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; nx = 0; ny = 0; nz = -stepZ;
      }
      // Leaving the box entirely means nothing further can be hit.
      if ((x < 0 && stepX <= 0) || (x >= this.W && stepX >= 0) ||
          (y < 0 && stepY <= 0) || (y >= this.H && stepY >= 0) ||
          (z < 0 && stepZ <= 0) || (z >= this.D && stepZ >= 0)) break;
    }
    return null;
  };

  /** True if the world-unit point sits inside a solid (non-glass) voxel. */
  World.prototype.solidAtUnits = function (wx, wy, wz) {
    var v = this.raw(Math.floor(wx / PIX), Math.floor(wy / PIX), Math.floor(wz / PIX));
    return v !== 0 && ((v - 1) >> 4) !== ZX.MAT_GLASS;
  };

  /* ---- persistence ------------------------------------------------------- */

  /** Run-length encode the grid; empty worlds pack down to nothing. */
  World.prototype.serialise = function () {
    var out = [], d = this.data, n = d.length, i = 0;
    while (i < n) {
      var v = d[i], j = i + 1;
      while (j < n && d[j] === v && j - i < 65535) j++;
      out.push(v, (j - i) & 255, (j - i) >> 8);
      i = j;
    }
    return new Uint8Array(out);
  };

  World.prototype.deserialise = function (buf) {
    var d = this.data, i = 0, p = 0;
    while (p + 2 < buf.length && i < d.length) {
      var v = buf[p], run = buf[p + 1] | (buf[p + 2] << 8);
      p += 3;
      if (i + run > d.length) run = d.length - i;
      d.fill(v, i, i + run);
      i += run;
    }
    for (var ci = 0; ci < this.nchunks; ci++) { this.recount(ci); this.markDirty(ci); }
  };

})(window.ZX = window.ZX || {});
