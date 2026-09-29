'use strict';
// Mutation suite. Each fault below is put, on its own, into a copy of the
// shipped page, and the tier named with it has to fail on that copy — so
// every behaviour v17 adds is shown to be one a test would notice losing.
// A fault whose anchor is not in the page exactly as often as it says stops
// the suite before anything runs: it would test nothing.
//
//   node tests/mutations.js            all of them
//   node tests/mutations.js lid twin   those whose names hold "lid" or "twin"
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const { PAGE } = require('./lib.js');

const TIERS = { geometry: 'test-geometry.js', dom: 'test-dom.js', rest: 'test-rest.js' };
const M = (tier, name, find, replace, count) => ({ tier, name, find, replace, count: count || 1 });
const MUTANTS = [
  // finding intakes
  M('geometry', 'dents shallower than 5 mm taken for intakes', 'if (!through && depthMax < minDepth) return null;', ''),
  M('geometry', 'openings wider than the ball kept', 'if (!at && width > D * 1.05) return null;', ''),
  M('geometry', 'a tap does not try a wider ball', 'if (at) for (k = 0; k < 3; k++) sizes.push(sizes[k] * 2);', ''),
  M('geometry', 'a rough surface: balls may not press into it', 'spacing: D > opts.diameter ? r / 8 : 0, slack: 3 * rough });', 'spacing: D > opts.diameter ? r / 8 : 0 });'),
  M('geometry', 'a rough surface: its noise taken for dents', 'var eps = Math.max(0.25 * minDepth, 2 * sag, 4 * rough, 1e-9 * diag);', 'var eps = Math.max(0.25 * minDepth, 2 * sag, 1e-9 * diag);'),
  // the surface a lid is fitted to
  M('geometry', 'the lid fitted over the next intake', 'return set.has(g) || (negative !== null && negative[g] === 1);', 'return set.has(g);'),
  M('geometry', 'the lid fitted round a fold', 'return !(len(ref) > 0.5) || dot(faceNormal(mesh, g), ref) >= 0.766;', 'return true;'),
  M('geometry', 'the lid fitted across a crease', 'if (mesh.cut.has(key) || creases.has(key)) continue;', 'if (mesh.cut.has(key)) continue;'),
  M('geometry', 'mirror images not paired', 'if (best >= 0) { a.twin = best; list[best].twin = i; }', ''),
  M('geometry', 'an intake a seam parts from its panel still found', 'if (!ok || panel < 0 || faces.some(function (x) { return mesh.panel[x] !== panel; })) return null;', 'if (panel < 0) return null;'),
  // the lid and the projection
  M('geometry', 'lid triangles left as clipped, slivers and all', 'if (c < 0 || d < 0 || incircle(a, b, c, d) <= 1e-12 * span * span * span * span) continue;', 'continue;'),
  M('geometry', 'a point beside the lid not held to its rim', 'var wc = 1 - wa - wb, tol = -1e-9;', 'var wc = 1 - wa - wb, tol = -1e9;'),
  M('geometry', 'intake faces not projected from the lid', 'if (!uv && own[j] >= 0) {', 'if (false) {'),
  M('geometry', 'a separate twin leaves its lids unflipped', 'for (i = 0; i < cu.length / 2; i++) cu[2 * i + axis] = extent - cu[2 * i + axis];', ''),
  M('geometry', 'a mirrored twin drops its lids', 'if (rep.cover) out.cover = rep.cover;', ''),
  // retopology and suggested seams
  M('geometry', 'the topology check counts projected faces', 'if (!include(panelOf[f]) || (skip && skip(f))) continue;', 'if (!include(panelOf[f])) continue;'),
  M('geometry', 'suggested seams ignore the intakes', 'var holes = opts.intakes || [], holeOf = null, covered = new Set();', 'var holes = [], holeOf = null, covered = new Set();'),
  M('geometry', 'suggested seams notch what an intake leaves open', 'if (covered.size && covered.has(ekey(pc.glob[a], pc.glob[b]))) continue;', ''),
  // vector artwork
  M('geometry', 'the line snaps on to the walls beside it', 'if (hold && hold[fr.faces[s]]) return;', ''),
  M('geometry', 'the line does not drop to the face under the lid', 'if (hold && hold[f] && !off) sc = -1;', ''),
  M('geometry', 'an island region without its lids', 'if (cover) for (i = 0; i < cover.length; i += 6) {', 'if (false) for (i = 0; i < cover.length; i += 6) {'),
  M('geometry', 'the cut line runs round what an intake leaves open', '(skip && skip.has(key))', 'false', 2),
  // at rest, v17 is v16
  M('rest', 'the PDF names no version', "creator: document.title.split(' — ')[0]", "creator: 'WrapaCar'"),
  M('rest', 'a separate twin flipped the other way', 'var axis = Math.abs(keep[0]) >= Math.abs(keep[1]) ? 1 : 0, extent = axis ? island.h : island.w;', 'var axis = Math.abs(keep[0]) >= Math.abs(keep[1]) ? 0 : 1, extent = axis ? island.h : island.w;'),
  M('rest', 'a mirrored twin no longer shares its partner\'s island', 'mirrorOf: rep.panel, shared: true, residual: worst', 'mirrorOf: rep.panel, shared: false, residual: worst'),
  M('rest', 'twins with no intakes not mirrored', 'return la.length === lb.length && la.every(', 'return la.length > 0 && la.length === lb.length && la.every('),
  // the app
  M('dom', 'stale version in the title', '<title>WrapaCar v17 — Intakes</title>', '<title>WrapaCar v16 — Intakes</title>'),
  M('dom', 'the .obj still says Seamwork', "L.push('# WrapaCar — body panels with a packed atlas');", "L.push('# Seamwork — body panels with a packed atlas');"),
  M('dom', 'intake sizes taken in model units, not mm', 'minDepth: intakeMM(5)', 'minDepth: 5'),
  M('dom', 'accepting leaves the rim uncreased', 'S.mesh.crease.add(k); had = false;', 'had = false;'),
  M('dom', 'clearing leaves the rim creases', 'if (res && !rec.hadCrease) res.rimKeys.forEach(function (k) { S.mesh.crease.delete(k); });', ''),
  M('dom', 'a seam through an intake leaves it projected', 'pruneIntakes();', ''),
  M('dom', 'undo forgets the intakes', 'S.intakes = h.intakes || []; S.intakeFound = h.intakeFound || [];', ''),
  M('dom', 'undo leaves the lost-intake note up', "S.intakeFound = h.intakeFound || [];\n    $('intakeNote').textContent = '';", 'S.intakeFound = h.intakeFound || [];'),
  M('dom', 'Esc leaves the intakes found', 'else if (!S.points.length && S.intakeFound.length) rejectAllIntakes();', ''),
  M('dom', 'a tap in Intake mode does nothing', "else if (S.mode === 'intake') intakeTap(hit, e);", ''),
  M('dom', 'a tap leaves the mirror image out', 'if (plane && !here[0].self) {', 'if (false) {'),
  M('dom', 'Project artwork across intakes ignored', 'if (!projecting()) return by;', ''),
  M('dom', 'the unwrap leaves the intakes out', 'var lidded = intakesByPanel(), projected = lidded.size ? new Uint8Array(nT) : null, lids = 0;', 'var lidded = new Map(), projected = null, lids = 0;'),
  M('dom', 'the atlas leaves the lids out', 'isl.coverUV = cv;', ''),
  M('dom', 'the atlas clips the artwork off the lids', 'VC.islandRegion(S.unwrap.uv, S.mesh.tris, S.unwrap.islands[i].faceList, grow, S.unwrap.islands[i].coverUV).forEach(', 'VC.islandRegion(S.unwrap.uv, S.mesh.tris, S.unwrap.islands[i].faceList, grow).forEach('),
  M('dom', 'the PDF clips the artwork off the lids', 'groups.set(i, g = { clip: VC.islandRegion(S.unwrap.uv, S.mesh.tris, S.unwrap.islands[i].faceList, grow, S.unwrap.islands[i].coverUV)', 'groups.set(i, g = { clip: VC.islandRegion(S.unwrap.uv, S.mesh.tris, S.unwrap.islands[i].faceList, grow)'),
  M('dom', 'the line on the model not told what is projected', 'projected: S.unwrap.projected };', ' };')
];

const want = process.argv.slice(2).map(s => s.toLowerCase());
const list = MUTANTS.filter(m => !want.length || want.some(w => m.name.toLowerCase().indexOf(w) >= 0));
const src = fs.readFileSync(PAGE, 'utf8');
// the page keeps v16's CRLF line endings; an anchor over lines is written with \n
const eol = src.indexOf('\r\n') >= 0 ? '\r\n' : '\n';
list.forEach(m => { m.find = m.find.split('\n').join(eol); m.replace = m.replace.split('\n').join(eol); });
const bad = list.filter(m => src.split(m.find).length - 1 !== m.count);
if (bad.length) {
  bad.forEach(m => console.log('  ANCHOR ' + m.name + ' — found ' + (src.split(m.find).length - 1) + ' times, not ' + m.count));
  console.log('mutation suite: stopped, ' + bad.length + ' anchor(s) wrong');
  process.exit(1);
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wrapacar-mutants-'));
const jobs = Math.max(1, Math.min(4, +(process.env.JOBS || os.cpus().length)));

function run(m, i) {
  return new Promise(done => {
    const file = path.join(dir, 'mutant-' + String(i + 1).padStart(2, '0') + '.html');
    fs.writeFileSync(file, src.split(m.find).join(m.replace));
    const t = Date.now();
    const child = cp.spawn(process.execPath, [path.join(__dirname, TIERS[m.tier])], { env: Object.assign({}, process.env, { WRAPACAR: file }), stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { out += d; });
    child.on('close', code => {
      const first = (out.match(/^\s*FAIL .*$/m) || out.match(/crashed:.*$/m) || [''])[0].trim();
      done({ m, caught: code !== 0, secs: (Date.now() - t) / 1000, first });
      fs.unlinkSync(file);
    });
  });
}

(async () => {
  const results = new Array(list.length);
  let next = 0;
  async function worker() {
    while (next < list.length) {
      const i = next++;
      const r = await run(list[i], i);
      results[i] = r;
      console.log((r.caught ? '  caught ' : '  MISSED ') + r.m.name + '  (' + r.m.tier + ', ' + r.secs.toFixed(0) + ' s)' + (r.caught && r.first ? '\n           ' + r.first.slice(0, 150) : ''));
    }
  }
  await Promise.all(Array.from({ length: jobs }, worker));
  fs.rmdirSync(dir);
  const missed = results.filter(r => !r.caught);
  console.log('mutation suite: ' + (results.length - missed.length) + ' of ' + results.length + ' caught' + (missed.length ? ', missed: ' + missed.map(r => r.m.name).join('; ') : ''));
  if (missed.length) process.exitCode = 1;
})();
