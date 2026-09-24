/* ==========================================================================
   memory.js -- the machine has no fixed RAM. It measures the host and takes
   a share of it, then holds everything else to that budget.
   ========================================================================== */
(function (ZX) {
  'use strict';

  var Mem = ZX.Mem = {
    budget: 0,          // bytes this machine is allowed
    pools: {},          // name -> bytes currently held
    ramtop: 0,          // BASIC's own ceiling, as set by CLEAR
    host: {}
  };

  /** Probe the host and decide how large this Spectrum is today. */
  Mem.detect = function () {
    var gb = navigator.deviceMemory || 0;           // Chromium only, rounded
    var cores = navigator.hardwareConcurrency || 4;
    var heap = (performance.memory && performance.memory.jsHeapSizeLimit) || 0;

    var bytes;
    if (heap) {
      // Stay well inside the JS heap ceiling; the voxel store is the bulk of it.
      bytes = Math.floor(heap * 0.45);
    } else if (gb) {
      bytes = Math.floor(gb * 1024 * 1024 * 1024 * 0.12);
    } else {
      bytes = 256 * 1024 * 1024;
    }
    // Never smaller than a machine that can hold the display, never silly-large.
    var floorBytes = ZX.SCREEN_W * ZX.SCREEN_H * ZX.SCREEN_D + 32 * 1024 * 1024;
    Mem.budget = Math.max(floorBytes, Math.min(bytes, 3 * 1024 * 1024 * 1024));

    Mem.host = {
      deviceMemoryGB: gb || null,
      cores: cores,
      heapLimit: heap || null,
      budget: Mem.budget
    };
    Mem.ramtop = 65368;   // the traditional figure, for CLEAR's benefit
    return Mem.host;
  };

  Mem.claim = function (name, bytes) {
    Mem.pools[name] = bytes;
    return bytes;
  };
  Mem.release = function (name) { delete Mem.pools[name]; };

  Mem.used = function () {
    var t = 0;
    for (var k in Mem.pools) if (Mem.pools.hasOwnProperty(k)) t += Mem.pools[k];
    return t;
  };
  Mem.free = function () { return Math.max(0, Mem.budget - Mem.used()); };

  /** Would adding `bytes` overflow the machine? */
  Mem.wouldFit = function (bytes) { return Mem.free() >= bytes; };

  Mem.fmt = function (b) {
    if (b >= 1073741824) return (b / 1073741824).toFixed(2) + ' GB';
    if (b >= 1048576) return (b / 1048576).toFixed(1) + ' MB';
    if (b >= 1024) return (b / 1024).toFixed(0) + ' KB';
    return b + ' B';
  };

  /** The line a Spectrum prints when it wakes up. */
  Mem.freeLine = function () {
    return Mem.fmt(Mem.free()) + ' FREE';
  };

})(window.ZX = window.ZX || {});
