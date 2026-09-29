'use strict';
// Where the test tiers find three.js (the release the page loads, 0.147.0)
// and playwright-core (for the optional browser tier): THREE_DIR or
// PLAYWRIGHT_DIR if set, else node_modules beside the release (npm install),
// else the build tree's own copy.
const fs = require('fs'), path = require('path');
function dep(name, env) {
  const tries = [process.env[env], path.join(__dirname, '..', 'node_modules', name), path.join(__dirname, '..', '..', 'deps', 'node_modules', name)];
  for (const t of tries) if (t && fs.existsSync(path.join(t, 'package.json'))) return t;
  return null;
}
module.exports = { three: () => dep('three', 'THREE_DIR'), playwright: () => dep('playwright-core', 'PLAYWRIGHT_DIR') };
