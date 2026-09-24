/* guard_livecode.mjs — the checks that catch a release where the FEATURE is
   only in the prose.

   THE v2.8.2 LESSON: changelog text that contains a literal comment-closer
   sequence ends the block comment early and the rest of the entry becomes
   code. So: opener/closer balance, and every declaration this release claims
   must survive a comment strip as EXECUTABLE code.

   TDZ (order_check): a top-level `const` read by top-level code ABOVE its own
   declaration line throws at module evaluation. Function declarations hoist and
   are exempt; consts are not. Declaration ORDER is therefore a guarded
   invariant, not a style preference. */
import fs from 'node:fs';
import {sliceModule,blankNonCode,blankComments} from './extract.mjs';

const file=process.argv[2];
const src=sliceModule(file);
let fail=0;
const ok =(m)=>console.log('  ok   '+m);
const bad=(m)=>{console.log('  FAIL '+m);fail++;};

/* 1. comment delimiters balance */
{
    let opens=0,closes=0,i=0;
    while((i=src.indexOf('/*',i))>=0){opens++;i+=2;}
    i=0;
    while((i=src.indexOf('*/',i))>=0){closes++;i+=2;}
    if(opens===closes)ok(`comment delimiters balance (${opens} open, ${closes} close)`);
    else bad(`comment delimiters DO NOT balance: ${opens} open, ${closes} close`);
}

/* 2. the release's declarations survive as live code */
const code=blankComments(src);
const LIVE=[
    ["defMat('spear'",             "the spear material row"],
    ["const SPEAR_LEN=",           "SPEAR_LEN"],
    ["const SPEAR_RAD=",           "SPEAR_RAD"],
    ["function spearGeometry",     "spearGeometry"],
    ["spear :{noun:'spear'",       "the LOG_KINDS spear row"],
    ["{key:'spear'",               "the spear RECIPE row"],
    ["function pointSubmerged",    "pointSubmerged"],
    ["const OCEAN_SKIN=",          "OCEAN_SKIN"],
    ["function throwSpear",        "throwSpear"],
    ["function spearScan",         "spearScan"],
    ["function landSpear",         "landSpear"],
    ["function updateSpears",      "updateSpears"],
    ["function spearReady",        "spearReady"],
    ["function removeSpearMesh",   "removeSpearMesh"],
    ["const LMB_TOOLS=",           "LMB_TOOLS"],
    ["function hotbarToolKey",     "hotbarToolKey"],
    ["function hotbarToolSlotForKey","hotbarToolSlotForKey"],
    ["updateSpears(dt);",          "the updateSpears substep call"],
];
for(const [needle,label] of LIVE){
    const n=code.split(needle).length-1;
    if(n>=1)ok(`live code: ${label} (${n})`);
    else bad(`live code MISSING (comment-only?): ${label}`);
}

/* 3. dead arms this release must NOT have left behind */
const GONE=[
    ["const HOTBAR_TOOL_ITEM_SLOTS=6", "the old six-wide tool item window"],
    ["HOTBAR_TOOL_KEYS[i]",            "the toolbar's raw key-table index"],
    ["selectTool(n===0?HOTBAR_TOOL_SLOTS-1:n-1)","the old 'key 0 is the last slot' restatement"],
];
for(const [needle,label] of GONE){
    if(code.includes(needle))bad(`still present, should be gone: ${label}`);
    else ok(`removed: ${label}`);
}

/* 4. the submersion rule is stated ONCE. The literal `-0.15` level test was
      written out twice before this release; both readers now go through
      pointSubmerged, so exactly ONE line may compare against the skin. */
{
    const n=(code.match(/oc\.level-OCEAN_SKIN/g)||[]).length;
    if(n===1)ok('submersion skin compared in exactly one place');
    else bad(`submersion skin compared ${n} times, expected 1`);
    /* EXACTLY ONE `level-0.15` may survive, and it must be the mob ground
       clamp's `hr<` form — a different question with a similar shape (see its
       own note). Any OTHER survivor is a restatement that got past patch B/E. */
    const survivors=(code.match(/[^\n]*level-0\.15[^\n]*/g)||[]).filter(l=>!l.trim().startsWith('*'));
    if(survivors.length===1&&/hr<oc\.level-0\.15/.test(survivors[0]))
        ok('the one surviving `level-0.15` is the mob ground clamp (hr<), as intended');
    else bad(`unexpected \`level-0.15\` survivors: ${survivors.length} -> ${JSON.stringify(survivors)}`);
    /* the inert dead-ocean guard is gone from the player-water path */
    if(!/playerInWater[\s\S]{0,300}?!oc\.dead/.test(code))
        ok('playerInWater no longer carries the inert !oc.dead guard');
    else bad('playerInWater still carries the inert !oc.dead guard');
    if(/function playerInWater\(body\)\{\s*return !!pointSubmerged/.test(code))
        ok('playerInWater reads pointSubmerged');
    else bad('playerInWater does not read pointSubmerged');
}

/* 5. TDZ ORDER. Each pair: the const must be DECLARED before the top-level
      line that reads it. Both are matched on live code at column 0 or inside
      the table literal, so a comment mention cannot satisfy either side. */
const idx=(needle)=>code.indexOf(needle);
const ORDER=[
    ["const BUNDLE_LEN=",   "const SPEAR_LEN=",    "SPEAR_LEN derives from BUNDLE_LEN"],
    ["const BUNDLE_STICK_T=","const SPEAR_RAD=",   "SPEAR_RAD derives from BUNDLE_STICK_T"],
    ["const SPEAR_LEN=",    "spear :{noun:'spear'","LOG_KINDS reads SPEAR_LEN"],
    ["const SPEAR_RAD=",    "spear :{noun:'spear'","LOG_KINDS reads SPEAR_RAD"],
    ["function spearGeometry","spear :{noun:'spear'","LOG_KINDS names spearGeometry"],
    ["const LOG_G ",        "const SPEAR_G=",      "SPEAR_G derives from LOG_G"],
    ["function mergeGeometries","function spearGeometry","spearGeometry calls mergeGeometries"],
];
for(const [a,b,label] of ORDER){
    const ia=idx(a),ib=idx(b);
    if(ia<0){bad(`order: anchor not found: ${a}`);continue;}
    if(ib<0){bad(`order: anchor not found: ${b}`);continue;}
    if(ia<ib)ok(`order: ${label}`);
    else bad(`order VIOLATION (TDZ risk): ${label}`);
}

console.log(fail?`\nGUARD FAILED (${fail})`:'\nGUARD PASSED');
process.exit(fail?1:0);
