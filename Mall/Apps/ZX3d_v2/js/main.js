/* ==========================================================================
   main.js -- assembles the machine: scene, sun, display volume, four
   terminals, the player, and everything that listens for a key or a click.
   ========================================================================== */
(function (ZX) {
  'use strict';

  var PIX = ZX.PIX;
  var WX = ZX.SCREEN_W * PIX, WY = ZX.SCREEN_H * PIX, WZ = ZX.SCREEN_D * PIX;
  var CX = WX / 2, CZ = WZ / 2;
  var FLOOR_Y = 1;                        // voxel rows used by the floor slab

  var G = {};                             // the whole machine, in one place
  ZX.G = G;

  /* ======================================================================== */
  ZX.main = function () {
    ZX.Mem.detect();

    buildRenderer();
    buildSky();
    buildWorld();
    buildGround();
    buildBezel();
    buildMachine();
    buildTerminals();
    buildPlayer();
    buildHud();
    bindInput();
    bindPanels();

    generateWorld();
    G.world.flush();

    G.clock = { last: performance.now(), fpsT: 0, frames: 0, fps: 0 };
    requestAnimationFrame(loop);
  };

  /* ---- renderer, sun ------------------------------------------------------ */

  function buildRenderer() {
    var canvas = document.getElementById('gl');
    G.renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
    G.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    G.renderer.setSize(window.innerWidth, window.innerHeight);
    G.renderer.shadowMap.enabled = true;
    G.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    G.scene = new THREE.Scene();
    G.scene.fog = new THREE.FogExp2(0x0b0b16, 0.0075);

    G.camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.05, 400);
    G.camera.rotation.order = 'YXZ';

    G.scene.add(new THREE.HemisphereLight(0x6a7a96, 0x1a1a22, 0.55));
    var amb = new THREE.AmbientLight(0xffffff, 0.18);
    G.scene.add(amb);

    G.sun = new THREE.DirectionalLight(0xfff2dd, 1.05);
    G.sun.castShadow = true;
    G.sun.shadow.mapSize.width = 2048;
    G.sun.shadow.mapSize.height = 2048;
    var sc = G.sun.shadow.camera;
    sc.left = -30; sc.right = 30; sc.top = 30; sc.bottom = -30;
    sc.near = 1; sc.far = 160;
    G.sun.shadow.bias = -0.0006;
    G.sun.shadow.normalBias = 0.02;
    G.sunTarget = new THREE.Object3D();
    G.sunTarget.position.set(CX, WY * 0.35, CZ);
    G.scene.add(G.sunTarget);
    G.sun.target = G.sunTarget;
    G.scene.add(G.sun);
    setSun(38, 52);

    window.addEventListener('resize', function () {
      G.camera.aspect = window.innerWidth / window.innerHeight;
      G.camera.updateProjectionMatrix();
      G.renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  function setSun(azDeg, elDeg) {
    var az = azDeg * Math.PI / 180, el = ZX.clamp(elDeg, 3, 89) * Math.PI / 180;
    var d = 70;
    G.sun.position.set(
      CX + Math.cos(el) * Math.sin(az) * d,
      WY * 0.35 + Math.sin(el) * d,
      CZ + Math.cos(el) * Math.cos(az) * d
    );
    G.sunAz = azDeg; G.sunEl = elDeg;
  }

  function buildSky() {
    var c = document.createElement('canvas');
    c.width = 4; c.height = 256;
    var g = c.getContext('2d');
    var grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0.00, '#0a0a1e');
    grad.addColorStop(0.45, '#18203c');
    grad.addColorStop(0.62, '#2b3358');
    grad.addColorStop(0.78, '#4a3a55');
    grad.addColorStop(1.00, '#0c0c14');
    g.fillStyle = grad; g.fillRect(0, 0, 4, 256);
    var tex = new THREE.CanvasTexture(c);
    var sky = new THREE.Mesh(
      new THREE.SphereGeometry(220, 24, 16),
      new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false })
    );
    sky.position.set(CX, 0, CZ);
    G.scene.add(sky);
  }

  /* ---- the display volume ------------------------------------------------- */

  function buildWorld() {
    G.world = new ZX.World(ZX.SCREEN_W, ZX.SCREEN_H, ZX.SCREEN_D);
    G.scene.add(G.world.group);
  }

  function buildGround() {
    var c = document.createElement('canvas');
    c.width = c.height = 64;
    var g = c.getContext('2d');
    g.fillStyle = '#15151c'; g.fillRect(0, 0, 64, 64);
    g.strokeStyle = '#232334'; g.lineWidth = 2;
    g.strokeRect(0, 0, 64, 64);
    var tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(120, 120);
    var mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(240, 240),
      new THREE.MeshLambertMaterial({ map: tex })
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(CX, -0.002, CZ);
    mesh.receiveShadow = true;
    G.scene.add(mesh);
  }

  /** The rim of the screen: a plinth round the base and a glowing outline. */
  function buildBezel() {
    var mat = new THREE.MeshLambertMaterial({ color: 0x16161c });
    var t = 0.55, h = 0.30;
    function rim(w, d, x, z) {
      var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, h / 2, z);
      m.castShadow = true; m.receiveShadow = true;
      G.scene.add(m);
      G.solidBoxes.push(new THREE.Box3().setFromObject(m));
    }
    G.solidBoxes = [];
    rim(WX + t * 2, t, CX, -t / 2);
    rim(WX + t * 2, t, CX, WZ + t / 2);
    rim(t, WZ, -t / 2, CZ);
    rim(t, WZ, WX + t / 2, CZ);

    var edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(WX, WY, WZ)),
      new THREE.LineBasicMaterial({ color: 0x00d7d7, transparent: true, opacity: 0.45, fog: false })
    );
    edges.position.set(CX, WY / 2, CZ);
    G.scene.add(edges);
  }

  /* ---- machine and terminals ---------------------------------------------- */

  function buildMachine() {
    G.machine = new ZX.Machine({
      world: G.world,
      floorY: FLOOR_Y,
      sun: function (az, el) { setSun(az, el); },
      view: function (x, y, z) {
        G.player.teleport(x * PIX, y * PIX, (ZX.SCREEN_D - 1 - z) * PIX);
        leaveTerminal();
      },
      onScreenMode: function (n) {
        toast(n === 4 ? 'SCREEN 4 — output to the solid display'
                      : 'SCREEN ' + n + ' — output to the CRT');
      }
    });
    G.atlas = new ZX.Atlas();
  }

  function buildTerminals() {
    G.terminals = [];
    // The front of the display is the z = 0 plane, which sits at the high end
    // of three.js Z -- see the note in world.js about which way depth runs.
    var defs = [
      { label: 'FRONT', short: 'F', x: CX, z: WZ + 2.7, ry: 0 },
      { label: 'BACK', short: 'B', x: CX, z: -2.7, ry: Math.PI },
      { label: 'LEFT', short: 'L', x: -2.7, z: CZ, ry: -Math.PI / 2 },
      { label: 'RIGHT', short: 'R', x: WX + 2.7, z: CZ, ry: Math.PI / 2 }
    ];
    for (var i = 0; i < defs.length; i++) {
      var d = defs[i];
      var t = new ZX.Terminal(G.machine, G.atlas, d.label);
      t.group.position.set(d.x, 0, d.z);
      t.group.rotation.y = d.ry;
      t.short = d.short;
      G.scene.add(t.group);
      t.group.updateMatrixWorld(true);
      G.terminals.push(t);

      var b = new THREE.Box3().setFromObject(t.group);
      b.max.y = Math.min(b.max.y, 0.9);           // only the desk blocks the way
      G.solidBoxes.push(b);
    }
  }

  function buildPlayer() {
    G.player = new ZX.Player(G.world, G.camera);
    G.player.boxes = G.solidBoxes.map(function (b) { return { min: b.min, max: b.max }; });
    spawn();
  }

  /** In front of the display, facing into it. */
  function spawn() {
    G.player.teleport(CX, 0, WZ + 5.4);
    G.player.yaw = 0;
    G.player.pitch = -0.06;
  }

  /* ---- opening scene ------------------------------------------------------ */

  function generateWorld() {
    var w = G.world, x, z;

    // floor: black with an eight-pixel grid, so the character cells show
    for (z = 0; z < w.D; z++) {
      for (x = 0; x < w.W; x++) {
        var onX = (x % 8) === 0, onZ = (z % 8) === 0;
        var c = (onX && onZ) ? 5 : (onX || onZ) ? 1 : 0;
        w.set(x, 0, z, ZX.vox(c, ZX.MAT_SOLID));
      }
    }

    var P = function (col, mat) { return { colour: col, mat: mat || 0, over: 0, erase: false }; };

    // title, standing a little way into the screen
    var title = 'ZX SPECTRUM 3D';
    var tw = title.length * 8;
    w.text(Math.floor((w.W - tw) / 2), 126, 30, title, P(14), 6);
    var sub = 'SCREEN 4';
    w.text(Math.floor((w.W - sub.length * 8) / 2), 112, 34, sub, P(13), 4);

    // the colour bars, one bright column per colour
    for (var i = 0; i < 8; i++) {
      w.box(24 + i * 26, 16, 20, 18, 56, 8, P(i + 8), true);
      w.box(24 + i * 26, 8, 20, 18, 8, 8, P(i), true);
    }

    // a wireframe cube well back, to show the depth is real
    w.box(96, 40, 150, 64, 64, 64, P(13), false);
    w.sphere(128, 72, 182, 22, P(11), false);

    // a glowing lamp on each side, high up
    w.box(16, 150, 16, 6, 6, 6, P(14, ZX.MAT_GLOW), true);
    w.box(233, 150, 16, 6, 6, 6, P(14, ZX.MAT_GLOW), true);
    w.box(16, 150, 233, 6, 6, 6, P(10, ZX.MAT_GLOW), true);
    w.box(233, 150, 233, 6, 6, 6, P(10, ZX.MAT_GLOW), true);

    // a pane of glass, because we can
    w.box(180, 8, 60, 40, 48, 2, P(13, ZX.MAT_GLASS), true);

    seedTape();
  }

  function seedTape() {
    var tape = G.machine.tape;
    for (var name in ZX.BUILTIN_PROGRAMS) {
      if (!ZX.BUILTIN_PROGRAMS.hasOwnProperty(name)) continue;
      if (tape.find(name, 'program')) continue;     // never clobber a saved one
      var src = ZX.BUILTIN_PROGRAMS[name];
      var u = new Uint8Array(src.length);
      for (var i = 0; i < src.length; i++) u[i] = src.charCodeAt(i) & 255;
      tape.put(name, 'program', u);
    }
  }

  /* ---- HUD ---------------------------------------------------------------- */

  function buildHud() {
    G.hud = {
      mode: document.getElementById('st-mode'),
      fly: document.getElementById('st-fly'),
      pos: document.getElementById('st-pos'),
      fps: document.getElementById('st-fps'),
      chunks: document.getElementById('st-chunks'),
      mem: document.getElementById('st-mem'),
      membar: document.getElementById('st-membar'),
      hint: document.getElementById('hintbar'),
      toast: document.getElementById('toast')
    };
    G.colour = 14; G.mat = 0;

    var sw = document.getElementById('swatches');
    for (var i = 0; i < 16; i++) {
      var d = document.createElement('div');
      d.style.background = '#' + ('000000' + ZX.PALETTE[i].toString(16)).slice(-6);
      d.title = (i >= 8 ? 'BRIGHT ' : '') + ZX.COLOUR_NAMES[i & 7] + '  (' + i + ')';
      d.dataset.c = i;
      if (i === G.colour) d.className = 'sel';
      d.addEventListener('click', function (e) { setColour(+e.currentTarget.dataset.c); });
      sw.appendChild(d);
    }
    var mr = document.querySelectorAll('#matrow button');
    for (var j = 0; j < mr.length; j++) {
      mr[j].addEventListener('click', function (e) { setMat(+e.currentTarget.dataset.mat); });
    }
  }

  function setColour(c) {
    G.colour = ZX.clamp(c, 0, 15);
    var sw = document.querySelectorAll('#swatches div');
    for (var i = 0; i < sw.length; i++) sw[i].className = (i === G.colour) ? 'sel' : '';
  }
  function setMat(m) {
    G.mat = ZX.clamp(m, 0, 2);
    var b = document.querySelectorAll('#matrow button');
    for (var i = 0; i < b.length; i++) b[i].className = (i === G.mat) ? 'on' : '';
  }

  var toastT = 0;
  function toast(msg) {
    G.hud.toast.textContent = msg;
    G.hud.toast.classList.add('on');
    toastT = performance.now() + 2600;
  }
  ZX.toast = toast;

  /* ---- input -------------------------------------------------------------- */

  var raycaster, ndc, tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3();

  function bindInput() {
    raycaster = new THREE.Raycaster();
    ndc = new THREE.Vector2();
    var canvas = document.getElementById('gl');
    var suppressClick = false;

    document.getElementById('startbtn').addEventListener('click', function () {
      document.getElementById('start').classList.add('hidden');
      document.getElementById('hud').classList.remove('hidden');
      G.started = true;
      canvas.requestPointerLock();
    });

    canvas.addEventListener('click', function (e) {
      if (!G.started) return;
      if (G.terminalMode) { clickInTerminal(e); return; }
      if (suppressClick) { suppressClick = false; e.preventDefault(); return; }
      if (document.pointerLockElement !== canvas) { canvas.requestPointerLock(); return; }
      primaryAction(0);
    });
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    canvas.addEventListener('mousedown', function (e) {
      if (!G.started || G.terminalMode) return;
      if (e.button === 0) suppressClick = false;
      if (e.button === 2 && document.pointerLockElement === canvas) {
        suppressClick = true;
        primaryAction(2);
      }
    });

    document.addEventListener('mousemove', function (e) {
      if (G.terminalMode) { hoverInTerminal(e); return; }
      if (document.pointerLockElement === canvas) {
        G.player.look(e.movementX || 0, e.movementY || 0);
      }
    });

    canvas.addEventListener('wheel', function (e) {
      if (G.terminalMode) return;
      setColour((G.colour + (e.deltaY > 0 ? 1 : 15)) % 16);
      e.preventDefault();
    }, { passive: false });

    document.addEventListener('pointerlockchange', function () {
      if (document.pointerLockElement !== canvas && !G.terminalMode && G.started) {
        G.player.keys = {};
      }
    });

    document.addEventListener('keydown', onKeyDown, false);
    document.addEventListener('keyup', onKeyUp, false);
  }

  /** Browsers refuse a pointer-lock request made too soon after an exit. */
  function relock() {
    setTimeout(function () {
      if (!G.started || G.terminalMode || modalOpen()) return;
      try { document.getElementById('gl').requestPointerLock(); } catch (e) { /* click to retry */ }
    }, 180);
  }

  function modalOpen() {
    return !!document.querySelector('.modal:not(.hidden)');
  }

  function onKeyDown(e) {
    if (!G.started) return;

    if (e.code === 'Escape') {
      if (modalOpen()) { closeModals(); e.preventDefault(); return; }
      if (G.terminalMode) { leaveTerminal(); e.preventDefault(); return; }
      return;
    }
    if (modalOpen()) return;

    if (e.code === 'F4' && document.getElementById('assets')) {
      openModal('assets'); e.preventDefault(); return;
    }

    if (G.terminalMode) { terminalKeyDown(e); return; }

    switch (e.code) {
      case 'KeyW': G.player.keys.w = 1; break;
      case 'KeyA': G.player.keys.a = 1; break;
      case 'KeyS': G.player.keys.s = 1; break;
      case 'KeyD': G.player.keys.d = 1; break;
      case 'Space': G.player.keys.space = 1; e.preventDefault(); break;
      case 'ShiftLeft': case 'ShiftRight': G.player.keys.shift = 1; break;
      case 'ControlLeft': case 'ControlRight': G.player.keys.ctrl = 1; break;
      case 'KeyF':
        G.player.flying = !G.player.flying;
        toast(G.player.flying ? 'FLY ON' : 'FLY OFF');
        break;
      case 'KeyB': setColour(G.colour ^ 8); break;
      case 'KeyE': useTerminal(); break;
      case 'KeyH': openModal('help'); break;
      case 'KeyT': openModal('tape'); break;
      case 'KeyG': setMat((G.mat + 1) % 3); break;
      case 'KeyR': spawn(); break;
      default:
        if (e.code.indexOf('Digit') === 0) {
          var n = +e.code.slice(5);
          if (n >= 1 && n <= 8) setColour((G.colour & 8) | (n - 1));
        }
    }
  }

  function onKeyUp(e) {
    if (!G.started) return;
    if (G.terminalMode) { terminalKeyUp(e); return; }
    switch (e.code) {
      case 'KeyW': G.player.keys.w = 0; break;
      case 'KeyA': G.player.keys.a = 0; break;
      case 'KeyS': G.player.keys.s = 0; break;
      case 'KeyD': G.player.keys.d = 0; break;
      case 'Space': G.player.keys.space = 0; break;
      case 'ShiftLeft': case 'ShiftRight': G.player.keys.shift = 0; break;
      case 'ControlLeft': case 'ControlRight': G.player.keys.ctrl = 0; break;
    }
  }

  /* ---- digging and building ----------------------------------------------- */

  function primaryAction(button) {
    // a key cap under the crosshair wins over the voxel behind it
    var k = pickKey(3.6);
    if (k && button === 0) { pressKeyMesh(k); return; }

    G.player.forward(tmpV);
    var o = G.camera.position;
    var hit = G.world.raycast(o.x, o.y, o.z, tmpV.x, tmpV.y, tmpV.z, 9);
    if (!hit) return;
    if (button === 0) {
      if (hit.y <= 0) { toast('The floor of the display stays put'); return; }
      G.world.set(hit.x, hit.y, hit.z, 0);
    } else {
      var nx = hit.x + hit.nx, ny = hit.y + hit.ny, nz = hit.z + hit.nz;
      // never wall yourself in (the player's box, in display coordinates)
      var b = G.player.aabb();
      var px0 = Math.floor(b.x0 / PIX), px1 = Math.floor(b.x1 / PIX);
      var py0 = Math.floor(b.y0 / PIX), py1 = Math.floor(b.y1 / PIX);
      var pz0 = ZX.SCREEN_D - 1 - Math.floor(b.z1 / PIX);
      var pz1 = ZX.SCREEN_D - 1 - Math.floor(b.z0 / PIX);
      if (nx >= px0 && nx <= px1 && ny >= py0 && ny <= py1 && nz >= pz0 && nz <= pz1) return;
      G.world.set(nx, ny, nz, ZX.vox(G.colour, G.mat));
    }
  }

  /* ---- terminals ---------------------------------------------------------- */

  function nearestTerminal() {
    var best = null, bd = 1e9;
    for (var i = 0; i < G.terminals.length; i++) {
      var t = G.terminals[i];
      t.standPoint(tmpV2);
      var d = tmpV2.distanceTo(G.player.pos);
      if (d < bd) { bd = d; best = t; }
    }
    return { t: best, d: bd };
  }

  function useTerminal() {
    var n = nearestTerminal();
    if (!n.t || n.d > 2.4) { toast('Walk up to a terminal first'); return; }
    enterTerminal(n.t);
  }

  function enterTerminal(t) {
    G.terminalMode = true;
    G.activeTerm = t;
    G.player.enabled = false;
    G.player.keys = {};
    document.exitPointerLock();
    document.getElementById('termbar').classList.remove('hidden');
    document.getElementById('hud').classList.add('seated');
    document.getElementById('tb-which').textContent = t.short;
    document.getElementById('gl').style.cursor = 'default';

    t.seatPoint(tmpV);
    t.lookPoint(tmpV2);
    G.camAnim = { from: G.camera.position.clone(), to: tmpV.clone(), look: tmpV2.clone(), t: 0 };
    refreshTermBar();
  }

  function leaveTerminal() {
    if (!G.terminalMode) return;
    G.terminalMode = false;
    G.activeTerm = null;
    G.player.enabled = true;
    G.atlas.state.hover = null;
    G.atlas.redraw();
    document.getElementById('termbar').classList.add('hidden');
    document.getElementById('hud').classList.remove('seated');
    document.getElementById('gl').style.cursor = 'crosshair';
    relock();
  }

  function terminalKeyDown(e) {
    var m = G.machine;

    if (e.code === 'F2') {
      m.typing = m.typing === 'auto' ? 'spectrum' : 'auto';
      toast('TYPING: ' + m.typing.toUpperCase());
      refreshTermBar();
      e.preventDefault(); return;
    }
    if (e.code === 'F1') { openModal('help'); e.preventDefault(); return; }

    // shifts always drive the live key caps, whichever typing mode is on
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') { m.caps = true; syncAtlas(); }
    if (e.code === 'ControlLeft' || e.code === 'ControlRight') { m.sym = true; syncAtlas(); }
    if (e.code === 'Tab') { m.ext = (m.ext + 1) % 3; syncAtlas(); e.preventDefault(); return; }

    // a loaded game owns the keyboard until BREAK stops it
    if (m.spectrum.running) {
      var gid = ZX.PCMAP[e.code];
      if (gid) { e.preventDefault(); m.keyDown(gid); bump(gid); }
      return;
    }

    if (m.typing === 'auto') {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Enter') { m.submit(); e.preventDefault(); }
      else if (e.key === 'Backspace') { m.backspace(); e.preventDefault(); }
      else if (e.key === 'ArrowLeft') m.arrow('LEFT');
      else if (e.key === 'ArrowRight') m.arrow('RIGHT');
      else if (e.key === 'ArrowUp') m.arrow('UP');
      else if (e.key === 'ArrowDown') m.arrow('DOWN');
      else if (e.key && e.key.length === 1) { m.typeChar(e.key); e.preventDefault(); }
      bumpFromCode(e.code);
      refreshTermBar();
      return;
    }

    var id = ZX.PCMAP[e.code];
    if (!id) return;
    e.preventDefault();
    m.keyDown(id);
    bump(id);
    syncAtlas();
    refreshTermBar();
  }

  function terminalKeyUp(e) {
    var m = G.machine;
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') { m.caps = false; syncAtlas(); }
    if (e.code === 'ControlLeft' || e.code === 'ControlRight') { m.sym = false; syncAtlas(); }
    var id = ZX.PCMAP[e.code];
    if (id && (m.typing !== 'auto' || m.spectrum.running)) { m.keyUp(id); syncAtlas(); }
    if (id) G.activeTerm && G.activeTerm.keyboard.hold(id, false);
  }

  function bump(id) {
    if (G.activeTerm) G.activeTerm.keyboard.bump(id);
    else for (var i = 0; i < G.terminals.length; i++) G.terminals[i].keyboard.bump(id);
  }
  function bumpFromCode(code) {
    var id = ZX.PCMAP[code];
    if (id) bump(id);
  }

  function syncAtlas() {
    var m = G.machine, s = G.atlas.state;
    s.caps = m.caps; s.sym = m.sym; s.ext = m.ext; s.mode = m.mode;
    G.atlas.redraw();
  }

  /** Which key cap is under the pointer (terminal mode) or crosshair (walking)? */
  function pickKey(maxDist) {
    var term = G.activeTerm;
    if (!term) {
      var n = nearestTerminal();
      if (!n.t || n.d > 4) return null;
      term = n.t;
    }
    if (G.terminalMode) raycaster.setFromCamera(ndc, G.camera);
    else {
      G.player.forward(tmpV);
      raycaster.set(G.camera.position, tmpV);
    }
    raycaster.far = maxDist || 4;
    var hits = raycaster.intersectObjects(term.keyboard.keyMeshes, false);
    if (!hits.length) return null;
    return { term: term, id: hits[0].object.userData.keyId };
  }

  function hoverInTerminal(e) {
    ndc.x = (e.clientX / window.innerWidth) * 2 - 1;
    ndc.y = -(e.clientY / window.innerHeight) * 2 + 1;
    var k = pickKey(6);
    var id = k ? k.id : null;
    if (G.atlas.state.hover !== id) {
      G.atlas.state.hover = id;
      G.atlas.redraw();
      refreshTermBar();
    }
  }

  function clickInTerminal(e) {
    ndc.x = (e.clientX / window.innerWidth) * 2 - 1;
    ndc.y = -(e.clientY / window.innerHeight) * 2 + 1;
    var k = pickKey(6);
    if (k) pressKeyMesh(k);
  }

  /** A clicked key: shifts latch, everything else fires and clears them. */
  function pressKeyMesh(k) {
    var m = G.machine, key = ZX.KEYBYID[k.id];
    k.term.keyboard.bump(k.id);
    if (!key) return;
    if (key.type === 'capsshift') { m.caps = !m.caps; syncAtlas(); refreshTermBar(); return; }
    if (key.type === 'symshift') { m.sym = !m.sym; syncAtlas(); refreshTermBar(); return; }
    m.keyDown(k.id);
    if (key.type === 'normal') { m.caps = false; m.sym = false; }
    syncAtlas();
    refreshTermBar();
  }

  function refreshTermBar() {
    var m = G.machine;
    document.getElementById('tb-typing').textContent = 'TYPING: ' + m.typing.toUpperCase();
    document.getElementById('tb-cursor').textContent = m.mode;
    document.getElementById('tb-caps').className = 'shifty' + (m.caps ? ' on' : '');
    document.getElementById('tb-sym').className = 'shifty' + (m.sym ? ' on' : '');
    var ext = document.getElementById('tb-ext');
    ext.className = 'shifty' + (m.ext ? ' on' : '');
    ext.textContent = m.ext === 2 ? 'EXT 3D' : 'EXT';
    var h = G.atlas.state.hover;
    document.getElementById('tb-next').textContent = h ? (m.preview(h) || '—') : '—';
  }

  /* ---- panels ------------------------------------------------------------- */

  function openModal(id) {
    document.querySelectorAll('.modal').forEach(function (panel) { panel.classList.add('hidden'); });
    document.getElementById(id).classList.remove('hidden');
    G.player.keys = {};
    document.exitPointerLock();
    if (id === 'tape') renderTape();
    var focus = document.getElementById(id).querySelector('input:not([type="file"]), button');
    if (focus) focus.focus();
  }
  function closeModals() {
    document.querySelectorAll('.modal').forEach(function (panel) { panel.classList.add('hidden'); });
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    relock();
  }

  function bindPanels() {
    var closers = document.querySelectorAll('[data-close]');
    for (var i = 0; i < closers.length; i++) {
      closers[i].addEventListener('click', closeModals);
    }
    document.getElementById('tb-exit').addEventListener('click', leaveTerminal);
    document.getElementById('tb-help').addEventListener('click', function () { openModal('help'); });
    document.getElementById('tb-tape').addEventListener('click', function () { openModal('tape'); });
    document.getElementById('tb-run').addEventListener('click', function () { G.machine.basic.runDirect('RUN'); });
    document.getElementById('tb-list').addEventListener('click', function () { G.machine.basic.runDirect('LIST'); });
    document.getElementById('tb-break').addEventListener('click', function () { G.machine.keyDown('BREAK'); });
    document.getElementById('tb-typing').addEventListener('click', function () {
      G.machine.typing = G.machine.typing === 'auto' ? 'spectrum' : 'auto';
      refreshTermBar();
    });

    var fileIn = document.getElementById('tp-file');
    document.getElementById('tp-import').addEventListener('click', function () { fileIn.click(); });
    fileIn.addEventListener('change', function (e) {
      if (e.target.files[0]) readFile(e.target.files[0]);
      e.target.value = '';
    });
    var romIn = document.getElementById('tp-romfile');
    document.getElementById('tp-rom').addEventListener('click', function () { romIn.click(); });
    romIn.addEventListener('change', function (e) {
      if (e.target.files[0]) readFile(e.target.files[0], true);
      e.target.value = '';
    });

    document.getElementById('tp-export').addEventListener('click', function () {
      try {
        var bytes = G.machine.tape.exportTap();
        if (!bytes.length) { setTapeStatus('No BASIC or ordinary tape blocks to export. Download game assets with their .ZX3D buttons.'); return; }
        G.machine.tape.download('zx3d-tape.tap', bytes);
        setTapeStatus('Exported ' + ZX.Mem.fmt(bytes.length) + ' as zx3d-tape.tap. Save game assets separately with their .ZX3D buttons.');
      } catch (e) { setTapeStatus(e.message); }
    });
    document.getElementById('tp-wipe').addEventListener('click', function () {
      G.machine.tape.wipe();
      renderTape();
      setTapeStatus('Tape blanked.');
    });
    document.getElementById('tp-project').addEventListener('click', function () {
      var m = G.machine;
      m.project3d = !m.project3d;
      this.textContent = 'PROJECT TO 3D: ' + (m.project3d ? 'ON' : 'OFF');
      this.className = m.project3d ? 'on' : '';
      setTapeStatus(m.project3d
        ? 'The emulated display is being rebuilt as voxels at depth ' + m.projectZ + '.'
        : 'Projection off.');
    });
    document.getElementById('tp-stop').addEventListener('click', function () {
      G.machine.stopEmulator();
      setTapeStatus('Emulator stopped.');
    });

    // drag and drop
    var dz = document.getElementById('dropzone');
    window.addEventListener('dragover', function (e) {
      e.preventDefault(); dz.classList.remove('hidden');
    });
    window.addEventListener('dragleave', function (e) {
      if (e.target === dz || e.clientX === 0) dz.classList.add('hidden');
    });
    window.addEventListener('drop', function (e) {
      e.preventDefault(); dz.classList.add('hidden');
      if (e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]);
    });
    if (ZX.AssetPanel) ZX.AssetPanel.bind(G, openModal, renderTape, readFile);
  }

  function setTapeStatus(s) { document.getElementById('tp-status').textContent = s; }

  function renderTape() {
    var list = document.getElementById('tapelist');
    var items = G.machine.tape.catalogue();
    list.innerHTML = '';
    if (!items.length) {
      list.innerHTML = '<div class="empty">Blank tape. SAVE "name" from BASIC, or insert a file.</div>';
      return;
    }
    items.forEach(function (it) {
      var d = document.createElement('div');
      d.className = 'blk';
      var label = document.createElement('b'), info = document.createElement('i');
      label.textContent = it.name || '<unnamed>';
      info.textContent = it.kind + ' · ' + ZX.Mem.fmt(it.size);
      d.appendChild(label); d.appendChild(info);
      if (it.kind === 'scene' || it.kind === 'sprite') {
        var download = document.createElement('button');
        download.textContent = '.ZX3D'; download.className = 'asset-export';
        download.title = 'Download ' + it.name;
        download.addEventListener('click', function (event) {
          event.stopPropagation();
          try { G.machine.tape.download(ZX.AssetPanel.filename(it.name), G.machine.tape.exportAsset(it.name, it.kind)); }
          catch (e) { setTapeStatus(e.message); }
        });
        d.appendChild(download);
      }
      d.addEventListener('click', function () {
       try {
        if (it.kind === 'program') {
          G.machine.tape.loadIntoBasic(G.machine.basic, it.name, false);
          setTapeStatus('Loaded "' + it.name + '" into the editor. LIST to see it.');
        } else if (it.kind === 'world' || it.kind === 'scene') {
          G.machine.tape.loadWorld(G.machine.basic, it.name);
          setTapeStatus('Restored the world from "' + it.name + '".');
        } else if (it.kind === 'sprite') {
          var n = ZX.AssetPanel.spriteNumber();
          G.machine.tape.loadSprite(G.machine.basic, it.name, n);
          setTapeStatus('Loaded "' + it.name + '" as sprite ' + n + '. Use PUT ' + n + ',20,10,20 or MOVE ' + n + ',x,y,z in BASIC.');
        } else {
          startEmu(it.kind, G.machine.tape.file, it.name);
        }
       } catch (e) { setTapeStatus(e.message); }
      });
      list.appendChild(d);
    });
  }

  function readFile(file, asRom) {
    var fr = new FileReader();
    fr.onload = function () {
      var bytes = new Uint8Array(fr.result);
      var ext = (file.name.split('.').pop() || '').toLowerCase();
      if (ext === 'zx3d') {
        try {
          var asset = G.machine.tape.importAsset(bytes);
          renderTape();
          ZX.AssetPanel.imported(asset, G.machine.tape.lastSavePersisted);
          toast('Imported 3D asset: ' + asset.name);
        } catch (e) { ZX.AssetPanel.error(e.message); }
        return;
      }
      if (asRom || ext === 'rom' || (ext === 'bin' && bytes.length === 16384)) {
        if (G.machine.spectrum.loadRomImage(bytes)) {
          setTapeStatus('ROM installed (' + ZX.Mem.fmt(bytes.length) + '). Tapes will now load through it.');
          toast('48K ROM installed');
        } else setTapeStatus('That file is not a 16 KB ROM image.');
        return;
      }
      var res = G.machine.tape.insert(file.name, bytes);
      renderTape();
      if (res.program) {
        var b = G.machine.basic;
        b.lines.length = 0; b.clearVars();
        res.program.src.split('\n').forEach(function (l) {
          var m = l.match(/^\s*(\d+)\s?(.*)$/);
          if (m) b.storeLine(parseInt(m[1], 10), m[2]);
        });
        setTapeStatus('Read the BASIC program "' + res.program.name + '" into the editor. ' +
                      'Click the tape block below to run it on the Z80 instead.');
        toast('Loaded BASIC: ' + res.program.name);
        return;
      }
      startEmu(res.kind, bytes, file.name);
    };
    fr.onerror = function () {
      var message = 'Could not read "' + file.name + '". Try importing it again.';
      if (/\.zx3d$/i.test(file.name)) ZX.AssetPanel.error(message);
      else setTapeStatus(message);
    };
    fr.readAsArrayBuffer(file);
  }

  function startEmu(kind, bytes, name) {
    var e = G.machine.startEmulator(kind, bytes, name);
    if (e) { setTapeStatus(e); toast(e); return; }
    if (!G.machine.spectrum.romLoaded) {
      setTapeStatus('Running "' + name + '" without a ROM image. If it misbehaves, ' +
                    'load your own 48.rom above.');
    } else {
      setTapeStatus('Running "' + name + '" on the Z80.');
    }
    toast('Z80 running: ' + name);
    closeModals();
  }

  /* ---- loop --------------------------------------------------------------- */

  function loop(now) {
    requestAnimationFrame(loop);
    var dt = Math.min(0.1, (now - G.clock.last) / 1000);
    G.clock.last = now;

    if (G.started) {
      if (!G.terminalMode) G.player.update(dt);
      else animateSeat(dt);

      G.machine.update(dt, now);
      G.world.update(6);

      for (var i = 0; i < G.terminals.length; i++) G.terminals[i].update(now);

      updateHud(now);
    }
    G.renderer.render(G.scene, G.camera);
  }

  function animateSeat(dt) {
    var a = G.camAnim;
    if (!a) return;
    a.t = Math.min(1, a.t + dt * 4);
    var k = a.t * a.t * (3 - 2 * a.t);
    G.camera.position.lerpVectors(a.from, a.to, k);
    G.camera.lookAt(a.look);
    if (a.t >= 1) { G.camera.position.copy(a.to); G.camera.lookAt(a.look); }
  }

  function updateHud(now) {
    var c = G.clock;
    c.frames++;
    if (now - c.fpsT > 500) {
      c.fps = Math.round(c.frames * 1000 / (now - c.fpsT));
      c.frames = 0; c.fpsT = now;
    }
    var h = G.hud;
    h.fps.textContent = c.fps;
    h.chunks.textContent = G.world.liveMeshes + (G.world.dirty.length ? ' +' + G.world.dirty.length : '');

    var p = G.player.pos;
    h.pos.textContent = Math.floor(p.x / PIX) + ',' + Math.floor(p.y / PIX) + ',' +
                        (ZX.SCREEN_D - 1 - Math.floor(p.z / PIX));
    h.mode.textContent = G.terminalMode ? 'TERMINAL' : G.player.mode.toUpperCase();
    h.fly.textContent = G.player.flying ? 'FLY' : '';

    var used = ZX.Mem.used(), budget = ZX.Mem.budget;
    h.mem.textContent = ZX.Mem.fmt(used) + ' / ' + ZX.Mem.fmt(budget);
    var pct = Math.min(100, used / budget * 100);
    h.membar.firstElementChild.style.width = pct + '%';
    h.membar.className = pct > 90 ? 'full' : pct > 70 ? 'warn' : '';

    if (!G.terminalMode) {
      var n = nearestTerminal();
      if (n.t && n.d < 2.4) {
        h.hint.innerHTML = 'Press <b>E</b> to use the <b>' + n.t.label + '</b> terminal';
        h.hint.classList.remove('hidden');
      } else h.hint.classList.add('hidden');
    } else h.hint.classList.add('hidden');

    if (toastT && now > toastT) { h.toast.classList.remove('on'); toastT = 0; }
  }

})(window.ZX = window.ZX || {});
