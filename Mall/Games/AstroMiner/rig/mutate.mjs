/* mutate.mjs — the sweep.

   THE NULL MUTANT MUST SURVIVE. It is a change that alters no behaviour; if the
   suite kills it, the harness is wired wrong and EVERY kill in that run is void.
   It runs first and the run aborts if it dies.

   A surviving TARGETED mutant is a TEST defect until proven equivalent. */
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {build} from './extract.mjs';

const SRC='/home/claude/work/Bleaux_v2_12_40.html';
const TMP='/home/claude/rig/_mutant.html';
const OUT='/home/claude/rig/game40.mjs';
const original=fs.readFileSync(SRC,'utf8');

const MUTANTS=[
 ['N0  NULL MUTANT (no behaviour change)',
  'const SPEAR_MAX_LIVE=5;             // shafts in flight at once',
  'const SPEAR_MAX_LIVE=5;             // shafts in flight at once (null mutant marker)'],

 ['M1  gravity switched off',        'SPEAR_G*dt)',                    '0*dt)'],
 ['M2  gravity doubled',             'const SPEAR_G=LOG_G;',           'const SPEAR_G=LOG_G*2;'],
 ['M3  the shaft is one stick long', 'const SPEAR_LEN=BUNDLE_LEN*2;',  'const SPEAR_LEN=BUNDLE_LEN*1;'],
 ['M4  the shaft is a log thick',    'const SPEAR_RAD=BUNDLE_STICK_T;','const SPEAR_RAD=BUNDLE_STICK_T*8;'],
 ['M5  recipe wants one stick',      'cost:{flint_blade:1,rope:1,stick:2}','cost:{flint_blade:1,rope:1,stick:1}'],
 ['M6  recipe wants a whole rock',   'cost:{flint_blade:1,rope:1,stick:2}','cost:{flint:1,rope:1,stick:2}'],
 ['M7  recipe yields two',           'yields:{spear:1},once:false},\n\n {key:\'electrolysis\'','yields:{spear:2},once:false},\n\n {key:\'electrolysis\''],
 ['M8  spear no longer pockets',     "geo:spearGeometry,\n            len:SPEAR_LEN, rad:SPEAR_RAD, pocket:true}",
                                     "geo:spearGeometry,\n            len:SPEAR_LEN, rad:SPEAR_RAD, pocket:false}"],
 ['M9  a spear is made of wood',     "spear :{noun:'spear',      mat:'spear'","spear :{noun:'spear',      mat:'wood'"],
 ['M10 tool row back to six',        'const HOTBAR_TOOL_ITEM_SLOTS=7;','const HOTBAR_TOOL_ITEM_SLOTS=6;'],
 ['M11 hotbarToolKey leaks undefined','function hotbarToolKey(slot){return HOTBAR_TOOL_KEYS[slot]||\'\';}',
                                      'function hotbarToolKey(slot){return HOTBAR_TOOL_KEYS[slot];}'],
 ['M12 SHIFT+0 back to "the last slot"','selectTool(hotbarToolSlotForKey(String(n)));',
                                        'selectTool(n===0?HOTBAR_TOOL_SLOTS-1:n-1);'],
 ['M13 spear off the LMB set',       "const LMB_TOOLS=new Set(['rifle','exlance','spear']);",
                                     "const LMB_TOOLS=new Set(['rifle','exlance']);"],
 ['M14 spear off TOOL_IDS',          "'flint','flint_blade','axe','spear']);",
                                     "'flint','flint_blade','axe']);"],
 ['M15 sweep range unbounded',       'raycaster.far=dist;',            'raycaster.far=Infinity;'],
 ['M16 first list wins, not nearest','if(best&&best.distance<=hits[0].distance)return;','if(best)return;'],
 ['M17 ground dropped from the sweep',"take(raycaster.intersectObjects(collidersOf(body),false),'stop');",
                                      "/*mutant*/;"],
 ['M18 terrain hits do not rest',    'landSpear(sp,localHit.addScaledVector(dir,-SPEAR_LEN*SPEAR_BURY),dir,true);',
                                     'landSpear(sp,localHit.addScaledVector(dir,-SPEAR_LEN*SPEAR_BURY),dir,false);'],
 ['M19 cooldown removed',            'return simT-_spearLastThrow>=SPEAR_CD;','return true;'],
 ['M20 in-flight cap removed',       'if(spears.length>=SPEAR_MAX_LIVE)return false;','/*mutant*/;'],
 ['M21 throwing costs nothing',      "if(!spendItem('spear',1))return false;","spendItem;"],
 ['M22 skin sign flipped',           'lp.length()<oc.level-OCEAN_SKIN','lp.length()<oc.level+OCEAN_SKIN'],
 ['M23 submersion stops being strict','oceanAtLocal(body,lp,true,true);   // strict','oceanAtLocal(body,lp,true,false);   // strict'],
 ['M24 skin retuned',                'const OCEAN_SKIN=0.15;',         'const OCEAN_SKIN=0.60;'],
 ['M25 water drag removed',          'const SPEAR_WATER_K=3.5;',       'const SPEAR_WATER_K=0.0001;'],
 ['M26 drag so heavy the spear stops','const SPEAR_WATER_K=3.5;',      'const SPEAR_WATER_K=40;'],
 ['M27 leaving the planet keeps the shaft','if(sp.body!==activeBody){removeSpearMesh(sp);spearStats.lost++;continue;}','/*mutant*/;'],
 ['M28 spear damage down to a rifle bolt','const SPEAR_DMG=6;',        'const SPEAR_DMG=3;'],
 ['M29 pickup pays nothing',         "yieldN:1,sp:null,pos:localPos.clone(),","yieldN:0,sp:null,pos:localPos.clone(),"],
 ['M30 the landed pose is not the flight pose','quat:new THREE.Quaternion().setFromUnitVectors(V3(0,1,0),dir),',
                                               'quat:new THREE.Quaternion(),'],
 ['M31 dead oceans read as water',   'if(!o||o.dead)return null;\n    if(!containerOnly','if(!o)return null;\n    if(!containerOnly'],
];

function runSuite(){
    try{
        execFileSync('node',['tests_spear.mjs'],{cwd:'/home/claude/rig',stdio:'pipe'});
        return {killed:false,note:''};
    }catch(e){
        const out=(e.stdout?e.stdout.toString():'')+(e.stderr?e.stderr.toString():'');
        const m=/(\d+) pass, (\d+) fail/.exec(out);
        const first=(out.match(/  FAIL [^\n]*/)||[''])[0].trim();
        return {killed:true,note:(m?m[0]+' | ':'')+first.slice(0,90)};
    }
}

let voided=false,killed=0,survived=[];
for(const [name,from,to] of MUTANTS){
    const n=original.split(from).length-1;
    if(n!==1){console.log(`  ??   ${name} — ANCHOR occurs ${n} times, expected 1 (mutant not applied)`);survived.push(name+' [anchor]');continue;}
    fs.writeFileSync(TMP,original.replace(from,to));
    let r;
    try{build(TMP,OUT);r=runSuite();}
    catch(err){r={killed:true,note:'extract/syntax: '+String(err.message).slice(0,60)};}
    const isNull=name.startsWith('N0');
    if(isNull){
        if(r.killed){console.log(`  VOID ${name} — the null mutant DIED. The harness is broken; every kill in this run is void.\n       ${r.note}`);voided=true;break;}
        console.log(`  ok   ${name} — survives, as it must`);
        continue;
    }
    if(r.killed){killed++;console.log(`  kill ${name}\n       ${r.note}`);}
    else{survived.push(name);console.log(`  SURVIVED ${name}`);}
}

/* always restore the real bytes */
build(SRC,OUT);
if(voided)process.exit(2);
console.log(`\n${killed}/${MUTANTS.length-1} targeted mutants killed`);
if(survived.length){console.log('SURVIVORS (test defects until proven equivalent):');for(const s of survived)console.log('  - '+s);}
process.exit(survived.length?1:0);
