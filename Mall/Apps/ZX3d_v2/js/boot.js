/* ==========================================================================
   boot.js -- fetch three.js (with fallbacks) then load the machine in order.
   Everything is a classic script so the page also works straight off a
   file:// URL by double-clicking index.html.
   ========================================================================== */
(function () {
  'use strict';
  window.ZX = window.ZX || {};

  var THREE_SOURCES = [
    'vendor/three.min.js',
    'https://cdn.jsdelivr.net/npm/three@0.149.0/build/three.min.js',
    'https://unpkg.com/three@0.149.0/build/three.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js'
  ];

  var MODULES = [
    'js/zxconst.js',
    'js/memory.js',
    'js/world.js',
    'js/screen2d.js',
    'js/keyboard.js',
    'js/basic.js',
    'js/tape.js',
    'js/assets.js',
    'js/assetpanel.js',
    'js/z80.js',
    'js/spectrum.js',
    'js/terminal.js',
    'js/player.js',
    'js/main.js'
  ];

  var msg = document.getElementById('loadmsg');
  var bar = document.querySelector('#loadbar span');
  var done = 0, total = MODULES.length + 1;

  function progress(text) {
    if (text) msg.textContent = text;
    bar.style.width = Math.round((done / total) * 100) + '%';
  }

  function loadScript(url, ok, fail) {
    var s = document.createElement('script');
    s.src = url;
    s.async = false;
    s.onload = ok;
    s.onerror = function () { s.parentNode && s.parentNode.removeChild(s); fail(); };
    document.head.appendChild(s);
  }

  function tryThree(i) {
    if (i >= THREE_SOURCES.length) {
      msg.innerHTML = 'Could not reach a three.js build.<br>' +
        '<span class="tiny">Download three.min.js into a <b>vendor/</b> folder next to ' +
        'index.html, or connect to the network and reload.</span>';
      return;
    }
    progress('Loading three.js (' + (i + 1) + '/' + THREE_SOURCES.length + ')…');
    loadScript(THREE_SOURCES[i], function () {
      if (!window.THREE) { tryThree(i + 1); return; }
      done++; progress('three.js r' + (THREE.REVISION || '?') + ' ready');
      loadModules(0);
    }, function () { tryThree(i + 1); });
  }

  function loadModules(i) {
    if (i >= MODULES.length) { start(); return; }
    var name = MODULES[i].split('/').pop();
    progress('Loading ' + name + '…');
    loadScript(MODULES[i], function () {
      done++; progress();
      loadModules(i + 1);
    }, function () {
      msg.innerHTML = 'Failed to load <b>' + MODULES[i] + '</b>.<br>' +
        '<span class="tiny">Check the js/ folder sits next to index.html.</span>';
    });
  }

  function start() {
    progress('Building the world…');
    // One frame of breathing room so the progress bar actually paints.
    setTimeout(function () {
      try {
        ZX.main();
        document.getElementById('loading').classList.add('hidden');
        document.getElementById('start').classList.remove('hidden');
      } catch (e) {
        console.error(e);
        msg.innerHTML = 'Startup error: <b>' + (e && e.message ? e.message : e) + '</b>' +
          '<br><span class="tiny">See the browser console for the stack.</span>';
      }
    }, 60);
  }

  tryThree(0);
})();
