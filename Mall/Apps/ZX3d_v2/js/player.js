/* ==========================================================================
   player.js -- two ways of moving.

   Inside the screen volume you move like Minecraft: blocky gravity, a short
   auto-step, and voxels you can stand on, dig and build. Step outside the
   display and it becomes ordinary first-person movement -- longer stride,
   faster sprint, nothing in the way but the furniture.
   ========================================================================== */
(function (ZX) {
  'use strict';

  var PIX = ZX.PIX;
  var EPS = 1e-4;

  var PRESETS = {
    minecraft: {
      walk: 4.3, sprint: 5.8, crouch: 1.6, accel: 42, airAccel: 6,
      gravity: 26, jump: 7.2, damping: 12, stepUp: 0.55, bob: 0.0
    },
    fps: {
      walk: 5.4, sprint: 9.0, crouch: 2.2, accel: 60, airAccel: 12,
      gravity: 20, jump: 6.2, damping: 16, stepUp: 0.4, bob: 0.035
    }
  };

  function Player(world, camera) {
    this.world = world;
    this.camera = camera;
    this.pos = new THREE.Vector3(0, 0, 0);
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0;
    this.width = 0.30;                 // half-width
    this.height = 1.80;
    this.eye = 1.64;
    this.onGround = false;
    this.flying = false;
    this.mode = 'fps';
    this.keys = {};
    this.boxes = [];                   // extra AABBs: desks, cases
    this.bobPhase = 0;
    this.enabled = true;
  }
  ZX.Player = Player;

  Player.prototype.params = function () { return PRESETS[this.mode]; };

  Player.prototype.aabb = function (p) {
    p = p || this.pos;
    return {
      x0: p.x - this.width, x1: p.x + this.width,
      y0: p.y, y1: p.y + this.height,
      z0: p.z - this.width, z1: p.z + this.width
    };
  };

  /* ---- collision tests ---------------------------------------------------- */

  Player.prototype.boxBlocked = function (b) {
    for (var i = 0; i < this.boxes.length; i++) {
      var o = this.boxes[i];
      if (b.x1 > o.min.x && b.x0 < o.max.x &&
          b.y1 > o.min.y && b.y0 < o.max.y &&
          b.z1 > o.min.z && b.z0 < o.max.z) return true;
    }
    return false;
  };

  Player.prototype.voxelBlocked = function (b) {
    var w = this.world;
    var x0 = Math.floor((b.x0 + EPS) / PIX), x1 = Math.floor((b.x1 - EPS) / PIX);
    var y0 = Math.floor((b.y0 + EPS) / PIX), y1 = Math.floor((b.y1 - EPS) / PIX);
    var z0 = Math.floor((b.z0 + EPS) / PIX), z1 = Math.floor((b.z1 - EPS) / PIX);
    if (x1 < 0 || y1 < 0 || z1 < 0 || x0 >= w.W || y0 >= w.H || z0 >= w.D) return false;
    x0 = Math.max(0, x0); y0 = Math.max(0, y0); z0 = Math.max(0, z0);
    x1 = Math.min(w.W - 1, x1); y1 = Math.min(w.H - 1, y1); z1 = Math.min(w.D - 1, z1);
    for (var y = y0; y <= y1; y++) {
      for (var z = z0; z <= z1; z++) {
        for (var x = x0; x <= x1; x++) {
          var v = w.raw(x, y, z);          // storage z: these are world units
          if (v && ((v - 1) >> 4) !== ZX.MAT_GLASS) return true;
        }
      }
    }
    return false;
  };

  Player.prototype.blocked = function (p) {
    var b = this.aabb(p);
    if (b.y0 < 0) return true;
    return this.voxelBlocked(b) || this.boxBlocked(b);
  };

  /* ---- movement ----------------------------------------------------------- */

  Player.prototype.moveAxis = function (axis, delta) {
    if (delta === 0) return false;
    var steps = Math.ceil(Math.abs(delta) / (PIX * 0.8));
    var d = delta / steps, hit = false;
    for (var s = 0; s < steps; s++) {
      var before = this.pos[axis];
      this.pos[axis] += d;
      if (this.blocked()) {
        this.pos[axis] = before;
        hit = true;
        break;
      }
    }
    return hit;
  };

  Player.prototype.update = function (dt) {
    if (!this.enabled) return;
    dt = Math.min(dt, 0.05);
    var P = this.params();

    // which side of the glass are we on?
    var w = this.world;
    var inside = this.pos.x > -0.5 && this.pos.x < w.W * PIX + 0.5 &&
                 this.pos.z > -0.5 && this.pos.z < w.D * PIX + 0.5 &&
                 this.pos.y < w.H * PIX + 2;
    this.mode = inside ? 'minecraft' : 'fps';
    P = this.params();

    var k = this.keys;
    var fwd = (k.w ? 1 : 0) - (k.s ? 1 : 0);
    var strafe = (k.d ? 1 : 0) - (k.a ? 1 : 0);
    var sprint = k.shift && !this.flying;
    var crouch = k.ctrl && !this.flying;
    var speed = crouch ? P.crouch : sprint ? P.sprint : P.walk;

    var sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    var wishX = (-sy * fwd + cy * strafe);
    var wishZ = (-cy * fwd - sy * strafe);
    var len = Math.hypot(wishX, wishZ);
    if (len > 0) { wishX /= len; wishZ /= len; }

    if (this.flying) {
      var fs = speed * (sprint ? 2.4 : 1.6);
      this.vel.x = wishX * fs;
      this.vel.z = wishZ * fs;
      this.vel.y = ((k.space ? 1 : 0) - (k.shift ? 1 : 0)) * fs;
    } else {
      var accel = this.onGround ? P.accel : P.airAccel;
      this.vel.x += (wishX * speed - this.vel.x) * Math.min(1, accel * dt);
      this.vel.z += (wishZ * speed - this.vel.z) * Math.min(1, accel * dt);
      if (this.onGround && len === 0) {
        var damp = Math.max(0, 1 - P.damping * dt);
        this.vel.x *= damp; this.vel.z *= damp;
      }
      this.vel.y -= P.gravity * dt;
      if (k.space && this.onGround) { this.vel.y = P.jump; this.onGround = false; }
    }

    // horizontal, with a short step up over low ledges
    var dx = this.vel.x * dt, dz = this.vel.z * dt;
    if (this.moveAxis('x', dx) && !this.flying) this.tryStep('x', dx, P.stepUp);
    if (this.moveAxis('z', dz) && !this.flying) this.tryStep('z', dz, P.stepUp);

    // vertical
    var dy = this.vel.y * dt;
    var wasFalling = dy < 0;
    if (this.moveAxis('y', dy)) {
      if (wasFalling) this.onGround = true;
      this.vel.y = 0;
    } else if (wasFalling) {
      this.onGround = false;
    }
    if (this.flying) this.onGround = false;

    // stay on the right side of the ground
    if (this.pos.y < 0) { this.pos.y = 0; this.vel.y = 0; this.onGround = true; }

    // head bob for the first-person half
    var moving = len > 0 && this.onGround;
    if (P.bob > 0 && moving) this.bobPhase += dt * (sprint ? 14 : 9);
    else this.bobPhase += (0 - (this.bobPhase % (Math.PI * 2))) * 0;
    var bob = (P.bob > 0 && moving) ? Math.sin(this.bobPhase) * P.bob : 0;

    var eye = crouch ? this.eye - 0.45 : this.eye;
    this.camera.position.set(this.pos.x, this.pos.y + eye + bob, this.pos.z);
    this.camera.rotation.set(0, 0, 0);
    this.camera.rotateY(this.yaw);
    this.camera.rotateX(this.pitch);
  };

  /** Blocked while walking? Lift over the obstacle if it is only a lip. */
  Player.prototype.tryStep = function (axis, delta, maxUp) {
    if (!this.onGround) return;
    var save = this.pos.clone();
    var lift = 0, tries = Math.ceil(maxUp / PIX);
    for (var i = 1; i <= tries; i++) {
      lift = i * PIX;
      this.pos.y = save.y + lift;
      if (this.blocked()) continue;
      if (!this.moveAxis(axis, delta)) return;      // cleared it
    }
    this.pos.copy(save);
  };

  Player.prototype.teleport = function (x, y, z) {
    this.pos.set(x, y, z);
    this.vel.set(0, 0, 0);
  };

  Player.prototype.look = function (dx, dy) {
    this.yaw -= dx * 0.0022;
    this.pitch -= dy * 0.0022;
    var lim = Math.PI / 2 - 0.02;
    this.pitch = ZX.clamp(this.pitch, -lim, lim);
  };

  Player.prototype.forward = function (out) {
    out.set(0, 0, -1);
    out.applyAxisAngle(new THREE.Vector3(1, 0, 0), this.pitch);
    out.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
    return out;
  };

})(window.ZX = window.ZX || {});
