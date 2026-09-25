/* tests_wormhole.mjs — DEMO_MODE in the numbered game build.
   Real three r170 (only WebGLRenderer stubbed), the SHIPPED module sliced
   out of the HTML by extract.mjs — same rig discipline as tests_spear.mjs.

     node tests_wormhole.mjs <fixed.html> <buggy-control.html>

   TWO THINGS, ONE ROOT CAUSE. Player report: (1) the Test console
   (Ctrl+Shift+P) does nothing, and setting DEMO_MODE to false by hand
   didn't bring it back either; (2) does blowing up the sun and riding the
   Starship's Starship horizon still reach a NEW star system? Both are the
   same const: v2.12.43 carried Bleaux_Demo.html's DEMO_MODE=true into the
   numbered game build verbatim, and that one flag gates toggleTestMenu()
   AND finishChartWarp().

   THE RIG TRICK THIS FILE NEEDS THAT tests_spear.mjs DID NOT: a real
   generateSystem()+buildSystemScene() boot, not fixture.mjs's synthetic
   sphere — the wormhole path needs a real sun, a real black hole and a
   real second system, not a stand-in. ensureVoxelized()'s init and the
   wormhole's own transition are both behind setTimeout, which
   headless_env.mjs stubs to a no-op (nothing here ever runs animate() on a
   real clock). So THIS file installs its own env with setTimeout made
   SYNCHRONOUS — call the callback immediately, right there — depth-capped
   so a self-rescheduling timer elsewhere in the game can't recurse forever.
   That one substitution is enough to let the entire boot sequence AND the
   entire wormhole sequence run to completion on ordinary function calls,
   with no fake clock and no skipped frames: every step below is the exact
   function a keypress or a mouse click would have run.

   PRE-FIX CONTROL, RUN FIRST, AND REQUIRED TO REPRODUCE THE BUG. The same
   sequence against the currently-shipped v2.12.44 must end the run and
   leave systemNumber unmoved — a control that already passed is a control
   that is not testing what this file claims. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {build} from './extract.mjs';
import {installEnv} from './headless_env.mjs';
import * as THREE from './three_shim.mjs';

const FIXED=path.resolve(process.argv[2]||'../Bleaux_v2_12_45.html');
const BUGGY=path.resolve(process.argv[3]||'../Bleaux_v2_12_44.html');
if(!process.argv[2]||!process.argv[3]){
    console.log('usage: node tests_wormhole.mjs <fixed.html> <buggy-control.html>');process.exit(2);
}
const tmp=os.tmpdir();
const fixedMod=path.join(tmp,'wormhole_fixed.mjs'),buggyMod=path.join(tmp,'wormhole_buggy.mjs');
build(FIXED,fixedMod);build(BUGGY,buggyMod);

let pass=0,fail=0;
const T=(name,fn)=>{try{fn();pass++;console.log('  ok   '+name);}
                    catch(e){fail++;console.log('  FAIL '+name+'\n         '+(e&&e.stack||e));}};
const ok=(c,m)=>{if(!c)throw new Error(m||'expected truthy');};
const eq=(a,b,m)=>{if(a!==b)throw new Error((m||'')+' expected '+JSON.stringify(b)+', got '+JSON.stringify(a));};

function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}

/* the one rig substitution this file needs, installed FRESH for every boot
   so one instance's runaway timer (if any) cannot poison the next. */
function installSyncTimers(){
    let depth=0;
    globalThis.setTimeout=(fn)=>{
        if(typeof fn!=='function')return 0;
        if(depth>80)return 0;           // a self-rescheduling timer elsewhere: stop, don't recurse forever
        depth++;
        try{fn();}finally{depth--;}
        return 0;
    };
    globalThis.clearTimeout=()=>{};
}
async function bootReal(modPath,seed){
    installEnv();
    installSyncTimers();               // AFTER installEnv (which sets the stock no-op) — see header
    Math.random=mulberry32(seed);
    const G=await import(modPath+'?boot');
    return G;
}

/* One end-to-end run: grant the Starship, feed the star a Mini-Sun's worth
   of supernova, ride the collapsed sun's horizon, pick a star at the
   galaxy chart, launch, and report what finishChartWarp() actually did. */
async function runWormhole(modPath,seed){
    const G=await bootReal(modPath,seed);
    const r={G};
    r.earthlikeBefore=G.earthBody;
    r.systemBefore=G.systemNumber;
    ok(G.earthBody,'no earthBody after boot — the real-generate-system rig trick did not take');
    eq(G.activeBody,G.earthBody,'activeBody after boot:');
    eq(G.mode,'foot','mode after boot:');
    eq(G.systemNumber,1,'systemNumber after boot:');
    /* RIG GOTCHA, RECORDED RATHER THAN WORKED AROUND SILENTLY: headless_env.mjs's
       `byId` Map (and the `document` it backs) is declared once at THAT
       file's module scope, so it is a process-wide singleton — every boot in
       this run, buggy or fixed, resolves $('gameover') / $('testmenu') to
       the SAME stub element. A style this run's own code never touches can
       therefore already carry whatever the PREVIOUS boot's code left on it.
       game state (gameIsOver, systemNumber, earthBody — real per-module
       `let` bindings, one per dynamic import) is never shared and is the
       primary signal below; every DOM-style assertion is BEFORE-vs-AFTER
       within this one run, never an absolute literal, so cross-boot
       leftovers can never read as this run's own result. */
    r.testMenuDisplayBefore=G.ui.test.style.display;
    r.gameoverDisplayBefore=G.ui.gameover.style.display;

    // ---- the Test console, the player's other complaint ----
    r.testMenuBefore=G.testMenuOpen;
    G.toggleTestMenu();
    r.testMenuAfterToggle=G.testMenuOpen;
    r.testMenuDisplay=G.ui.test.style.display;
    if(G.testMenuOpen)G.toggleTestMenu(false);   // leave it as we found it

    // ---- build and board the Starship (t-starship's own call) ----
    G.grantStarship();
    ok(G.crafted.starship,'grantStarship() did not set crafted.starship');
    ok(G.rocket,'grantStarship() did not print a craft');
    G.enterRocket();
    eq(G.mode,'rocket','mode after enterRocket:');
    G.rocketState.flying=true;
    G.rocketState.landedBody=null;
    G.rocketState.vel.set(0,0,0);
    G.rocket.position.set(0,0,G.SUN_RADIUS*0.5);   // well inside the SUN_RADIUS*0.8 horizon check
    for(const k of ['w','s','q','e','shift'])G.keys[k]=false;   // no stray thrust/roll while we step physics

    // ---- feed the star a Mini-Sun: the real supernova timeline ----
    G.beginCollapse();
    ok(G.collapsing,'beginCollapse() did not arm the collapse');
    for(let i=0;i<80&&!G.bigBlackHole;i++)G.updateCollapse(0.1);   // CP_FLASH+CP_EXPAND+CP_SHRINK = 4.2s
    ok(G.bigBlackHole,'the supernova never formed a black hole after 8s of sim');

    // ---- cross the horizon: the ACTUAL in-flight trigger, not a direct call ----
    eq(G.warping,false,'warping before crossing the horizon:');
    G.updateRocket(0.1);
    eq(G.warping,true,'updateRocket did not fire enterWormhole() this close to the horizon with a Starship aboard');
    ok(G.galaxyView,'enterWormhole() did not reach enterGalaxyChart()');
    eq(G.galaxyView.phase,'select','galaxy chart phase on arrival:');

    // ---- pick a star (skip the raycast — same end state pickChartStar leaves on a hit) and launch ----
    const gv=G.galaxyView;
    const sp=gv.stars.geometry.attributes.position.array;
    gv.selIdx=0;gv.ret.position.set(sp[0],sp[1],sp[2]);gv.ret.visible=true;
    G.launchChartWarp();
    eq(gv.phase,'warp','chart phase after launchChartWarp():');

    // ---- ride it out: updateGalaxyChart drives its own setTimeout(finishChartWarp,450) ----
    for(let i=0;i<120&&G.galaxyView;i++)G.updateGalaxyChart(0.1);
    r.galaxyViewAfter=G.galaxyView;   // finishChartWarp() nulls this — null is the "it ran" signal
    r.gameIsOver=G.gameIsOver;
    r.gameoverDisplay=G.ui.gameover.style.display;
    r.systemAfter=G.systemNumber;
    r.earthlikeAfter=G.earthBody;
    return r;
}

const SEED=Number(process.env.SEED||11);

console.log('\n== 1. PRE-FIX CONTROL — v2.12.44 must still show the bug ==');
const bug=await runWormhole(buggyMod,SEED);

T('control: Test console was inert (DEMO_MODE gated toggleTestMenu)',()=>{
    eq(bug.testMenuBefore,false,'');
    eq(bug.testMenuAfterToggle,false,'toggleTestMenu() opened it — the buggy build is not actually buggy?');
    eq(bug.testMenuDisplay,bug.testMenuDisplayBefore,'ui.test.style.display changed even though toggleTestMenu() returned early:');
});
T('control: riding the collapsed sun into the chart and launching ENDED THE RUN',()=>{
    eq(bug.galaxyViewAfter,null,'galaxyView never cleared — finishChartWarp() never ran');
    eq(bug.gameIsOver,true,'gameIsOver:');
    eq(bug.gameoverDisplay,'flex','ui.gameover.style.display:');
    ok(bug.gameoverDisplay!==bug.gameoverDisplayBefore,'ui.gameover.style.display did not change THIS run — not actually testing triggerGameOver()');
});
T('control: systemNumber never moved and the world was never rebuilt',()=>{
    eq(bug.systemAfter,bug.systemBefore,'systemNumber:');
    eq(bug.earthlikeAfter,bug.earthlikeBefore,'earthBody — rebuildWorldForNextSystem() must not have run');
});

console.log('\n== 2. THE FIX — same sequence against the patched build ==');
const fix=await runWormhole(fixedMod,SEED);

T('fixed: Ctrl+Shift+P opens the Test console',()=>{
    eq(fix.testMenuBefore,false,'');
    eq(fix.testMenuAfterToggle,true,'toggleTestMenu() still a no-op');
    eq(fix.testMenuDisplay,'flex','ui.test.style.display:');
});
T('fixed: blowing up the sun and riding the Starship\'s horizon reaches a NEW system',()=>{
    eq(fix.galaxyViewAfter,null,'galaxyView never cleared — finishChartWarp() never ran');
    eq(fix.gameIsOver,false,'gameIsOver:');
    eq(fix.gameoverDisplay,fix.gameoverDisplayBefore,
       'ui.gameover.style.display changed THIS run (now '+fix.gameoverDisplay+') — triggerGameOver() ran anyway');
});
T('fixed: systemNumber advanced and the world was rebuilt around a fresh earthBody',()=>{
    eq(fix.systemAfter,fix.systemBefore+1,'systemNumber:');
    ok(fix.earthlikeAfter&&fix.earthlikeAfter!==fix.earthlikeBefore,
       'earthBody is the SAME object — rebuildWorldForNextSystem() did not really run');
    eq(fix.G.mode,'foot','mode after arrival (exitRocket() should have landed Bleaux):');
    ok(fix.G.activeBody===fix.earthlikeAfter,'activeBody is not the new earthBody after arrival');
});
console.log('\n== 3. THE CSS: A HEADLESS TEST CANNOT SEE display:none!important, BUT THE SOURCE CAN BE READ ==');
/* the FUNCTIONAL check, not a word search: does the actual `display`
   DECLARATION (not a trailing explanatory comment that is free to say
   "!important" in English) carry the CSS keyword. */
const testmenuDisplayImportant=src=>{
    const m=/#testmenu\{[^}]*\}/.exec(src);
    if(!m)throw new Error('#testmenu rule not found');
    const decl=/display\s*:\s*none\s*(!\s*important)?\s*;/.exec(m[0]);
    if(!decl)throw new Error('#testmenu has no display:none declaration: '+m[0]);
    return !!decl[1];
};
T('#testmenu carries no !important in the fixed build (a real browser proved this the hard way — see rig/wormhole_browser.mjs)',()=>{
    ok(!testmenuDisplayImportant(fs.readFileSync(FIXED,'utf8')),'#testmenu\'s display:none is still !important');
});
T('the buggy control DOES still carry !important — the control reproduces both halves of the bug',()=>{
    ok(testmenuDisplayImportant(fs.readFileSync(BUGGY,'utf8')),'the control build lost its !important — it no longer reproduces the CSS half of the bug');
});

console.log('\n== 4. THE DEMO LINE IS UNTOUCHED — DEMO_MODE=true STAYS INTENTIONAL THERE ==');
T('Bleaux_Demo.html and index.html still ship DEMO_MODE=true and #testmenu\'s !important (only the numbered build changed)',()=>{
    const dir=path.dirname(FIXED);
    for(const name of ['Bleaux_Demo.html','index.html']){
        const p=path.join(dir,name);
        if(!fs.existsSync(p)){console.log('         ('+name+' not found beside the build under test — skipped)');continue;}
        const src=fs.readFileSync(p,'utf8');
        ok(/const DEMO_MODE=true;/.test(src),name+' no longer sets DEMO_MODE=true — the Demo cabinet would stop ending after one system');
        ok(testmenuDisplayImportant(src),name+' lost #testmenu\'s !important — belt-and-braces for DEMO_MODE, deliberate there');
    }
});

console.log('\n'+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
