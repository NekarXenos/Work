#!/usr/bin/env bash
# WrapaCar v17 validation. From the release folder:
#
#   npm install            # three 0.147.0 (and playwright-core, optional)
#   bash tests/validate.sh
#
# Steps, in order; any failure stops it:
#   1  the patch script rebuilds v17 from the shipped v16, byte for byte
#   2  node --check on each of the page's three scripts
#   3  one state object (var S = {) in the app
#   4  the version stamps: v17 in title, brand and banner, nothing of v16 left
#   5  function list against the shipped v16: nothing removed, additions listed
#   6  geometry tier     — the cores against surfaces with known answers
#   7  DOM-stub tier     — the page driven through its own listeners
#   8  regression tier   — at rest, every readout and saved byte as v16
#   9  mutation suite    — every fault put in has to be caught
#  10  browser tier      — headless Chromium, if there is one (optional)
set -euo pipefail
cd "$(dirname "$0")/.."
PAGE=${WRAPACAR:-WrapaCar_v17.html}
BASE=${WRAPACAR_BASE:-WrapaCar_v16.html}
export WRAPACAR="$PAGE" WRAPACAR_BASE="$BASE"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
step() { printf '\n== %s\n' "$1"; }
fail() { echo "   FAIL: $1"; exit 1; }

node -e "process.exit(require('./tests/deps.js').three() ? 0 : 1)" ||
  { echo "three.js 0.147.0 not found: run  npm install  in this folder first (or set THREE_DIR)"; exit 1; }

step "1. the patch rebuilds v17 from v16"
python3 patch_v16_to_v17.py "$BASE" "$TMP/rebuilt.html" > "$TMP/patch.log" || { cat "$TMP/patch.log"; fail "patch did not apply"; }
cmp -s "$TMP/rebuilt.html" "$PAGE" || fail "the patched file differs from $PAGE"
echo "   byte for byte ($(sha256sum "$PAGE" | cut -c1-16))"

step "2. node --check"
for i in 0 1 2; do
  node tests/extract-script.js "$PAGE" "$i" "$TMP/script$i.js"
  node --check "$TMP/script$i.js" || fail "script $i"
done
echo "   PanelCore, VectorCore and the app parse"

step "3. one state object"
n=$(grep -c 'var S = {' "$TMP/script2.js" || true)
[ "$n" = 1 ] || fail "var S = { appears $n times"
echo "   var S = { once"

step "4. version stamps"
for stamp in '<title>WrapaCar v17 — Intakes</title>' 'intakes and vector art · v17</span>' '/* WrapaCar v17 — the app:'; do
  n=$(grep -cF "$stamp" "$PAGE" || true)
  [ "$n" = 1 ] || fail "\"$stamp\" found $n times"
done
for old in 'v16' 'Seamwork' 'WrapaCar v14'; do
  n=$(grep -cF "$old" "$PAGE" || true)
  [ "$n" = 0 ] || fail "\"$old\" still in the page ($n lines)"
done
echo "   title, brand and banner say v17; no v16, Seamwork or WrapaCar v14 left"

step "5. functions against the shipped v16"
grep -o 'function [A-Za-z0-9_$]*(' "$BASE" | sort -u > "$TMP/f16"
grep -o 'function [A-Za-z0-9_$]*(' "$PAGE" | sort -u > "$TMP/f17"
gone=$(comm -23 "$TMP/f16" "$TMP/f17")
[ -z "$gone" ] || fail "removed: $gone"
echo "   none removed; $(comm -13 "$TMP/f16" "$TMP/f17" | wc -l) added:"
comm -13 "$TMP/f16" "$TMP/f17" | sed 's/^function //; s/($//' | paste -sd ',' | sed 's/,/, /g' | fold -s -w 90 | sed 's/^/     /'

step "6. geometry tier"
node tests/test-geometry.js

step "7. DOM-stub tier"
node tests/test-dom.js

step "8. regression tier"
node tests/test-rest.js

step "9. mutation suite"
node tests/mutations.js

if [ -x "${CHROMIUM:-/opt/pw-browsers/chromium}" ] && node -e "process.exit(require('./tests/deps.js').playwright() ? 0 : 1)"; then
  step "10. browser tier"
  node tests/test-browser.js
else
  printf '\n== 10. browser tier: skipped (no Chromium or playwright-core)\n'
fi

printf '\nall checks passed\n'
