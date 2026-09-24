/* Save the voxel screen as a portable asset without changing the editor. */
(function (ZX) {
  'use strict';
  var P = ZX.AssetPanel = {}, game, open, refresh, read;
  function el(id) { return document.getElementById(id); }
  function quote(s) { return '"' + s.replace(/"/g, '""') + '"'; }
  function status(message, error) {
    el('asset-status').textContent = message;
    el('asset-status').classList.toggle('error', !!error);
  }
  P.filename = function (name) { return (name.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '') || 'asset') + '.zx3d'; };
  P.spriteNumber = function () {
    var field = el('asset-number'), n = field ? Number(field.value) : 1;
    if (!Number.isInteger(n) || n < 0 || n > 255) throw new Error('Choose a sprite number from 0 to 255.');
    return n;
  };
  P.example = function (name, kind, n, origin) {
    var load = 'LOAD ' + quote(name);
    if (kind === 'world' || kind === 'scene') return '10 SCREEN 4\n20 ' + load + ' SCREEN$';
    var pos = origin || [20, 10, 20];
    return '10 SCREEN 4\n20 ' + load + ' SPRITE ' + n + '\n30 PUT ' + n + ',' + pos.join(',') +
      '\n40 PAUSE 10\n50 MOVE ' + n + ',' + [Math.min(254, pos[0] + 1), pos[1], pos[2]].join(',') +
      '\n60 REM USE MOVE IN YOUR GAME LOOP';
  };
  function update() {
    var sprite = el('asset-kind').value === 'sprite';
    var box = sprite && el('asset-region').value === 'box';
    el('asset-sprite-options').classList.toggle('hidden', !sprite);
    el('asset-sprite-options').disabled = !sprite;
    el('asset-scene-note').classList.toggle('hidden', sprite);
    el('asset-bounds').classList.toggle('hidden', !box);
    el('asset-bounds').disabled = !box;
    el('asset-code').textContent = P.example(el('asset-name').value.trim() || 'untitled', sprite ? 'sprite' : 'world', el('asset-number').value || '1');
  }
  P.bind = function (G, openModal, renderTape, readFile) {
    if (!el('asset-form')) return; // the renderer selftest has no asset panel
    game = G; open = openModal; refresh = renderTape; read = readFile;
    ['hud-assets', 'tb-assets'].forEach(function (id) {
      el(id).addEventListener('click', function () { open('assets'); });
    });
    ['asset-name', 'asset-kind', 'asset-number', 'asset-region'].forEach(function (id) {
      el(id).addEventListener('input', update);
    });
    el('asset-form').addEventListener('submit', function (event) {
      event.preventDefault();
      try {
        var name = el('asset-name').value.trim();
        if (!name) throw new Error('Give your asset a name.');
        var sprite = el('asset-kind').value === 'sprite', asset;
        if (sprite) {
          var options = { includeFloor: el('asset-floor').checked };
          if (el('asset-region').value === 'box') {
            options.bounds = {};
            ['x', 'y', 'z', 'w', 'h', 'd'].forEach(function (key) { options.bounds[key] = Number(el('asset-' + key).value); });
          }
          P.spriteNumber();
          asset = ZX.Assets.captureSprite(game.world, name, options);
        } else asset = ZX.Assets.captureScene(game.world, name);
        var bytes = game.machine.tape.saveAsset(asset);
        game.machine.tape.download(P.filename(name), bytes);
        refresh();
        el('asset-code').textContent = P.example(name, asset.kind, sprite ? P.spriteNumber() : 1, asset.origin);
        status('Saved "' + name + '" — ' + asset.w + ' × ' + asset.h + ' × ' + asset.d +
          ' voxels' + (sprite ? ', origin ' + asset.origin.join(',') : '') + '. Download started (' + ZX.Mem.fmt(bytes.length) + '). ' +
          (game.machine.tape.lastSavePersisted ? 'Ready on your tape.' : 'Browser storage is unavailable or full; keep the downloaded file to use it after closing this page.'));
      } catch (e) { status(e.message, true); }
    });
    el('asset-import').addEventListener('click', function () { el('asset-file').click(); });
    el('asset-file').addEventListener('change', function (event) {
      if (event.target.files[0]) read(event.target.files[0]);
      event.target.value = '';
    });
    el('asset-tape').addEventListener('click', function () { open('tape'); });
    update();
  };
  P.imported = function (asset, persisted) {
    if (!el('asset-form')) return;
    el('asset-name').value = asset.name;
    el('asset-kind').value = asset.kind;
    update();
    el('asset-code').textContent = P.example(asset.name, asset.kind, Number(el('asset-number').value) || 1, asset.origin);
    status('Imported "' + asset.name + '" to the tape. Use the commands below in your game.' +
      (persisted ? '' : ' Browser storage is unavailable or full; keep your .zx3d file.'));
    open('assets');
  };
  P.error = function (message) {
    if (el('asset-form')) { status(message, true); open('assets'); }
  };
})(window.ZX = window.ZX || {});
