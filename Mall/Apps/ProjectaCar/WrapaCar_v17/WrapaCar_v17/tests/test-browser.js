'use strict';
// Browser tier (optional): the shipped page in headless Chromium with real
// WebGL (SwiftShader), real mouse clicks and real layout. It runs the bumper
// flow end to end, checks the page raises no error, and saves screenshots to
// tests/shots/ for a look by eye.
const fs = require('fs'), path = require('path');
const { open } = require('./browser.js');
const { ledger, appFunction, PAGE, load } = require('./lib.js');
const PC = load(PAGE, 'panel');
const L = ledger('browser tier');
const { check } = L;
const SHOTS = path.join(__dirname, 'shots');

// a point on the bumper's face at height y and across at z, as adoptMesh
// places the model (centred, 3 units across)
function bumperPoint(y, z) {
  const m = appFunction(PAGE, 'bumperBody', { PC })(), P = m.pos, lo = [1e30, 1e30, 1e30], hi = [-1e30, -1e30, -1e30];
  for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], P[i + k]); hi[k] = Math.max(hi[k], P[i + k]); }
  const c = [0, 1, 2].map(k => (lo[k] + hi[k]) / 2), s = 3 / Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
  let best = null;
  for (let i = 0; i < P.length; i += 3) {
    const q = [(P[i] - c[0]) * s, (P[i + 1] - c[1]) * s, (P[i + 2] - c[2]) * s], d = Math.hypot(q[1] - y, q[2] - z) - 1e-3 * q[0];
    if (!best || d < best.d) best = { d, q };
  }
  return best.q;
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const { browser, page, errors } = await open(PAGE);
  const shot = name => page.screenshot({ path: path.join(SHOTS, name + '.png') });
  const text = id => page.textContent('#' + id);
  try {
    check('title', (await page.title()) === 'WrapaCar v17 — Intakes', await page.title());
    await page.selectOption('#modelSel', 'bumper');
    await page.waitForFunction(() => /Bumper with intakes loaded/.test(document.getElementById('toast').textContent), null, { timeout: 20000 });
    await page.click('#intakeFindBtn');
    await page.waitForFunction(() => !document.getElementById('intakeReview').hidden, null, { timeout: 60000 });
    check('find: three found', (await text('toast')) === '3 intakes found — accept or reject each', await text('toast'));
    await page.waitForTimeout(300);
    await shot('1-intakes-found');
    await page.click('#intakeAcceptAll');
    check('accept all', (await text('statIntakes')) === '3');
    await page.click('#unwrapBtn');
    await page.waitForFunction(() => /^Unwrapped/.test(document.getElementById('toast').textContent), null, { timeout: 120000 });
    check('unwrap: projected', /3 intakes projected from their lids$/.test(await text('toast')), await text('toast'));
    // a line across the near vent, drawn with two clicks and finished
    await page.click('#modeSeg [data-mode="vector"]');
    const ends = [bumperPoint(0.02, 0.97), bumperPoint(-0.38, 1.02)];
    const px = await page.evaluate(pts => {
      const r = document.getElementById('view').getBoundingClientRect();
      const cam = new THREE.PerspectiveCamera(42, r.width / r.height, 0.02, 120);
      cam.position.set(3.2, 2.0, 4.2); cam.lookAt(0, 0, 0); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
      return pts.map(p => { const v = new THREE.Vector3(p[0], p[1], p[2]).project(cam); return [r.left + (v.x + 1) / 2 * r.width, r.top + (1 - v.y) / 2 * r.height]; });
    }, ends);
    for (const p of px) { await page.mouse.click(p[0], p[1]); await page.waitForTimeout(150); }
    await page.click('#vecFinish');
    await page.waitForTimeout(300);
    check('a line drawn across the vent', /^Line finished/.test(await text('toast')), await text('toast'));
    await page.click('#modeSeg [data-mode="orbit"]');
    await page.check('#showAtlas');
    await page.check('#showIntakes');
    await page.waitForTimeout(500);
    await shot('2-projected-atlas-on-model');
    // the atlas card has been painted
    const painted = await page.evaluate(() => { const c = document.getElementById('atlasCanvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n; });
    check('the atlas card is painted', painted > 1000, painted);
    // off, and on again
    await page.uncheck('#intakeProject');
    await page.waitForFunction(() => /^Unwrapped/.test(document.getElementById('toast').textContent) && !/projected/.test(document.getElementById('toast').textContent), null, { timeout: 120000 });
    await page.waitForTimeout(500);
    await shot('3-projection-off');
    check('projection off: kept, not projected', (await text('statIntakes')) === '3, not projected');
    await page.check('#intakeProject');
    await page.waitForFunction(() => /projected from their lids/.test(document.getElementById('toast').textContent), null, { timeout: 120000 });
    check('no errors in the page', errors.length === 0, errors.join(' | '));
  } catch (e) {
    check('browser run finished', false, e.message);
  } finally {
    await browser.close();
  }
  L.done();
})().catch(e => { console.error('browser tier crashed:', e); process.exitCode = 1; });
