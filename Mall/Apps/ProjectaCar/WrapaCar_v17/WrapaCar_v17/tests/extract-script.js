'use strict';
// Shared helper: pull the inline <script> blocks out of a shipped WrapaCar
// HTML file, verbatim, so every test runs the code exactly as it ships.
const fs = require('fs');

function scripts(file) {
  const html = fs.readFileSync(file, 'utf8');
  const out = [];
  const re = /<script>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) out.push(m[1]);
  return out;
}

// PanelCore and VectorCore are UMD modules: load them as CommonJS.
function load(file, which) {
  const src = scripts(file)[which === 'vector' ? 1 : 0];
  const Module = require('module');
  const mod = new Module(file + '#' + which);
  mod._compile(src, file + '#' + which);
  return mod.exports;
}

module.exports = { scripts, load };

if (require.main === module) {
  const [file, idx, out] = process.argv.slice(2);
  const s = scripts(file)[+idx];
  if (out) fs.writeFileSync(out, s); else process.stdout.write(s);
}
