/* Keep the downloadable BASIC source and the offline bundled copy identical. */
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'games', 'DOOM.bas'), 'utf8').replace(/\r\n/g, '\n');
const output = '/* Generated from games/DOOM.bas by tools/bundle-doom.js. */\n' +
  '(function (ZX) {\n  ZX.DOOM_SOURCE = ' + JSON.stringify(source) + ';\n' +
  '  ZX.BUILTIN_PROGRAMS.DOOM = ZX.DOOM_SOURCE;\n})(window.ZX = window.ZX || {});\n';
fs.writeFileSync(path.join(root, 'js', 'doom-program.js'), output);
console.log('Bundled DOOM: ' + source.split('\n').filter(Boolean).length + ' BASIC lines');
