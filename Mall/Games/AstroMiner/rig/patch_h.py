#!/usr/bin/env python3
"""Patch H: the normal (non-Demo) build shipped Demo-only gates switched on.

Usage:  python3 patch_h.py <src.html> <dst.html> <version>
  python3 patch_h.py Bleaux_v2_12_44.html Bleaux_v2_12_45.html v2.12.45

BUG, FOUND BY THE PLAYER. v2.12.43 was built by carrying the Demo line's code
over verbatim ("this build IS that line, carried over verbatim" — its own
changelog entry says so) and never flipped the two things that are supposed
to differ between the two lines:
  - the JS const DEMO_MODE=true. It gates toggleTestMenu() (Ctrl+Shift+P did
    nothing) and finishChartWarp() (blowing up the sun, building a Starship
    and riding the collapsed star's horizon into the galaxy chart, picking a
    star and launching ended the run instead of reaching
    rebuildWorldForNextSystem() — correct for a short arcade demo, wrong for
    the numbered game).
  - the CSS `#testmenu{...display:none!important;...}`. Belt-and-braces in
    the Demo, where DEMO_MODE already makes the toggle a no-op — but in the
    numbered build it beats the fixed toggleTestMenu()'s own inline
    style.display, so DEMO_MODE=false alone flips the STATE (testMenuOpen,
    the inline style) without ever making the panel visible. Found only by
    actually rendering the "fixed" build in a browser and screenshotting it;
    a JS-state check alone reads success.
Only the Demo / index.html line should carry either. Every numbered game
build should carry neither, same as v2.12.41/42 before the Demo-line merge
(both predate DEMO_MODE and had no !important on this rule).
"""
import io, re, sys

SRC, DST, VER = sys.argv[1], sys.argv[2], sys.argv[3]
s = io.open(SRC, encoding='utf-8').read()

def sub(old, new, label):
    global s
    n = s.count(old)
    assert n == 1, 'ANCHOR %s occurs %d times, expected 1' % (label, n)
    s = s.replace(old, new.replace('VTAG', VER), 1)
    print('  ok  ' + label)

m = re.search(r'<title>Bleaux AstroMiner — (v[\d.]+)</title>', s)
assert m, 'title not found'
OLDVER = m.group(1)
sub(m.group(0), '<title>Bleaux AstroMiner — VTAG</title>', 'H0 title')

sub('const DEMO_MODE=true;',
    "const DEMO_MODE=false;   // VTAG: was true — see the changelog entry below",
    'H1 DEMO_MODE')

# SECOND regression, found only by actually rendering the fix in a browser:
# the same "carried over verbatim from the Demo line" copy also brought the
# Demo's #testmenu{display:none!important} — belt-and-braces THERE because
# DEMO_MODE already makes toggleTestMenu() a no-op, so the !important never
# has to do real work in the Demo. Carried into the numbered build, it beats
# the panel's OWN inline style.display the fixed toggleTestMenu() now sets,
# so DEMO_MODE=false alone opens the state (testMenuOpen flips, the inline
# style is written) without ever making the panel visible. v2.12.41/42, the
# last normal builds before the Demo-line merge, have NO !important here.
sub('#testmenu{position:fixed;top:0;right:0;bottom:0;display:none!important;align-items:center;',
    '#testmenu{position:fixed;top:0;right:0;bottom:0;display:none;align-items:center;   /* VTAG: was !important — see the changelog entry below */',
    'H1b testmenu !important')

ENTRY = '''   VTAG: DEMO_MODE WAS STILL TRUE IN THE GAME YOU KEEP PLAYING.
            PLAYER REPORT, VERBATIM: the Test menu (Ctrl+Shift+P) was
            disabled; setting Demo Mode to false by hand did not bring it
            back either. They also needed to know whether blowing up the sun
            with the Starship still reaches a new star system.

            ROOT CAUSE. OLDVER's own changelog entry says it plainly: "this
            build IS that [Demo] line, carried over verbatim." It was — DOWN
            TO DEMO_MODE=true, the one const the two lines are supposed to
            disagree on. That single flag gates three things:
              - toggleTestMenu() returns immediately while DEMO_MODE is true,
                so Ctrl+Shift+P opened nothing.
              - finishChartWarp() — reached by building a Starship, feeding a
                Lab-Grown Mini-Sun to the star, riding the collapsed sun's
                horizon (starshipReady() gates entry), picking a star at the
                galaxy chart and hitting LAUNCH — branches on DEMO_MODE: true
                calls triggerGameOver() instead of rebuildWorldForNextSystem().
                MEASURED (rig/tests_wormhole.mjs) against OLDVER: that exact
                sequence ends the run and systemNumber never moves. It is the
                correct ending for the short arcade Demo, which is why
                Bleaux_Demo.html and index.html both keep DEMO_MODE=true —
                but it silently turned the numbered game's climax into a
                dead end.
              - the keydown handler's own DEMO_MODE guard on Ctrl+Shift+P,
                consistent with toggleTestMenu — confirms the const was read
                the same way twice, nothing separate to fix there.

            THE PLAYER'S OWN FIX WAS RIGHT AND STILL WOULD NOT HAVE SHOWN
            ANYTHING. Editing DEMO_MODE to false is correct — it is exactly
            this patch's H1 — but it is not the whole bug. #testmenu came
            along for the same "carried over verbatim" ride, and its CSS
            gained a SECOND, independent gate the Demo needs and the numbered
            game does not: `display:none!important`. toggleTestMenu() only
            ever set the panel's INLINE style.display; !important in the
            stylesheet beats that regardless of what DEMO_MODE is doing, so
            with only DEMO_MODE flipped the open STATE is real (testMenuOpen
            flips, ui.test.style.display does become 'flex') while the panel
            stays invisible — SCREENSHOTTED, not inferred: a headless check
            of the JS state alone reads success. v2.12.41/42, the last
            normal builds before the Demo-line merge, carry no !important on
            this rule at all; the Demo needs it belt-and-braces only because
            DEMO_MODE already makes the toggle a no-op there.

            TWO EDITS, BOTH REVERSIONS TO THE PRE-MERGE NUMBERED BUILD.
            DEMO_MODE=false. #testmenu drops !important. Nothing else
            changed, in either the JS or the CSS.

            VERIFIED, NOT ASSUMED — including the part a JS-only check would
            have missed. rig/tests_wormhole.mjs drives the wormhole end to
            end in the headless rig (grantStarship, enterRocket,
            beginCollapse, stepping updateCollapse() through the supernova to
            the black hole, stepping updateRocket() to cross the horizon and
            fire enterWormhole(), picking a chart star, launchChartWarp(),
            stepping updateGalaxyChart() through the warp) and asserts the
            PRE-FIX control reproduces the bug on OLDVER (game over,
            systemNumber unchanged) while this build reaches systemNumber 2
            on a freshly generated earthBody with gameIsOver false. The
            Ctrl+Shift+P half was ALSO run in a real Chromium, not just the
            headless rig — a real keypress, a real click on the real Grant
            Starship / Trigger Sun Collapse test buttons, a real screenshot
            of the panel actually on screen, which is what caught the
            !important a JS-state check could not have.

'''
sub("           should now read ~100%% at every scale — if it dips, that\n           is a REAL stall and worth reporting.\n\n",
    "           should now read ~100%% at every scale — if it dips, that\n           is a REAL stall and worth reporting.\n\n"
    + ENTRY.replace('OLDVER', OLDVER),
    'H2 changelog')

io.open(DST, 'w', encoding='utf-8').write(s)
print('wrote', DST)
