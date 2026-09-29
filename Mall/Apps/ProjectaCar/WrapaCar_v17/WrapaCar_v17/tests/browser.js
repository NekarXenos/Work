'use strict';
// Opens a WrapaCar page in headless Chromium. The page's three.js comes from
// the local copy of the same release, so nothing leaves the machine.
const path = require('path'), fs = require('fs');
const deps = require('./deps.js'), THREE_DIR = deps.three(), PW = deps.playwright();
if (!THREE_DIR || !PW) throw new Error('the browser tier needs three 0.147.0 and playwright-core: npm install in the release folder');
const { chromium } = require(PW);

async function open(file, opts) {
  opts = opts || {};
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: opts.viewport || { width: 1400, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.route('**/*', route => {
    const url = route.request().url();
    const m = /three@0\.147\.0\/(.*)$/.exec(url);
    if (m) return route.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(path.join(THREE_DIR, m[1])) });
    if (/fonts\.(googleapis|gstatic)\.com/.test(url)) return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
    if (url.startsWith('file:')) return route.continue();
    return route.abort();
  });
  await page.goto('file://' + path.resolve(file));
  await page.waitForFunction(() => document.getElementById('statTris').textContent !== '0', null, { timeout: 30000 });
  return { browser, page, errors };
}
module.exports = { open };
