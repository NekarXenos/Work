'use strict';
// Shared by the tiers: a little assertion ledger, the page under test, and
// functions pulled verbatim out of the shipped app script by name.
const path = require('path');
const { scripts, load } = require('./extract-script.js');

const HERE = __dirname;
const PAGE = process.env.WRAPACAR || path.join(HERE, '..', 'WrapaCar_v17.html');
const BASE = process.env.WRAPACAR_BASE || path.join(HERE, '..', 'WrapaCar_v16.html');

function ledger(title) {
  let pass = 0, fail = 0;
  const failures = [];
  function check(name, ok, detail) {
    if (ok) { pass++; return true; }
    fail++; failures.push(name + (detail !== undefined ? ' — ' + detail : ''));
    console.log('  FAIL ' + name + (detail !== undefined ? ' — ' + detail : ''));
    return false;
  }
  function near(name, got, want, tol) { return check(name, Math.abs(got - want) <= tol, 'got ' + got + ', want ' + want + ' ± ' + tol); }
  function done() {
    console.log(title + ': ' + pass + ' passed, ' + fail + ' failed');
    if (fail) process.exitCode = 1;
    return fail === 0;
  }
  return { check, near, done, get pass() { return pass; } };
}

// A top-level function of a script, by brace matching from its declaration.
// The functions asked for this way hold no braces in strings or comments.
function fnSource(src, name) {
  const at = src.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('no function ' + name);
  let i = src.indexOf('{', at), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(at, i + 1);
  }
  throw new Error('unbalanced ' + name);
}
function appFunction(file, name, deps) {
  const src = scripts(file)[2].replace(/\r\n/g, '\n');
  const names = Object.keys(deps || {});
  return new Function(...names, fnSource(src, name) + '\nreturn ' + name + ';')(...names.map(k => deps[k]));
}

module.exports = { ledger, fnSource, appFunction, PAGE, BASE, load, scripts };
