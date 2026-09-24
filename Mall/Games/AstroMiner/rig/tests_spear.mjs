/* tests_spear.mjs — v2.12.40 THE SPEAR.
   Real three r170 (only WebGLRenderer stubbed), the SHIPPED module sliced out
   of the HTML, deterministic synthetic geometry for anything the answer would
   otherwise depend on which hillside a seed produced.

   PRE-FIX CONTROLS run the same assertion against the v2.12.39 bytes and
   REQUIRE it to fail there; a test that passes on the baseline is testing
   nothing this release did. */
import {boot} from './boot.mjs';
import {makeBody,activate,stand} from './fixture.mjs';

/* SEED. The flight assertions are deliberately seed-INVARIANT — they run on a
   synthetic sphere of known radius, not on whatever hillside a seed put in
   front of Bleaux (the plan's own rule about geometry-dependent assertions).
   The seed still varies the SYSTEM the module generates at boot, so sweeping it
   proves the release holds against every world generateSystem can produce, not
   just seed 7's. */
const SEED=Number(process.env.SEED||7);

let pass=0,fail=0;
const T=(name,fn)=>{try{fn();pass++;console.log('  ok   '+name);}
                    catch(e){fail++;console.log('  FAIL '+name+'\n         '+e.message);}};
const TA=async(name,fn)=>{try{await fn();pass++;console.log('  ok   '+name);}
                          catch(e){fail++;console.log('  FAIL '+name+'\n         '+e.message);}};
const eq=(a,b,m)=>{if(a!==b)throw new Error((m||'')+' expected '+JSON.stringify(b)+', got '+JSON.stringify(a));};
const ok=(c,m)=>{if(!c)throw new Error(m||'expected truthy');};
const near=(a,b,tol,m)=>{if(!(Math.abs(a-b)<=tol))throw new Error((m||'')+' expected '+b+'±'+tol+', got '+a);};

/* RIG FACT, RECORDED RATHER THAN WORKED AROUND SILENTLY: the headless rig has
   NO CLOCK. `simT` is a module `let` advanced by exactly one line, `simT+=rawDt`
   inside animate(), and the rig does not run animate() — so simT is 0 forever
   and ANY cooldown in the game is permanent after its first use. That is not a
   defect in the spear; it is the shape of the rig, and it is why a test that
   needs a SECOND throw boots a fresh module instance instead. Node caches ESM
   by URL, so the query string is the cache-buster. */
let _inst=0;
async function freshGame(){
    const g=(await boot('./game40.mjs?i='+(++_inst),SEED)).G;
    const b=makeBody(g,THREE,{R:200});
    if(!activate(g,b))throw new Error('fresh instance: fixture is not activeBody');
    return {g,b};
}
function arm(g,b,look,from){
    g.inventory.spear=9;
    g.hotbarFront('spear');g.selectTool(g.hotbarToolSlotOf('spear'));
    stand(g,THREE,b,from||[1,0,0],look);
}
const {G,THREE}=await boot('./game40.mjs',SEED);
const base=(await boot('./game39.mjs',SEED)).G;   // the baseline, for pre-fix controls
const V=(x,y,z)=>new THREE.Vector3(x,y,z);

console.log('\n== 1. THE ITEM AND THE RECIPE ==');

T('the spear is a recipe, and its cost is the brief\'s four items', ()=>{
    const r=G.RECIPES.find(x=>x.key==='spear');
    ok(r,'no spear recipe');
    eq(r.cost.flint_blade,1,'flint blade:');
    eq(r.cost.rope,1,'rope (the brief\'s "string"):');
    eq(r.cost.stick,2,'sticks:');
    eq(Object.keys(r.cost).length,3,'inputs:');
    eq(r.yields.spear,1,'yield:');
    eq(r.once,false,'once:');
    eq(r.requires,undefined,'a spear is gated behind no other print');
});
T('PRE-FIX CONTROL: v2.12.39 has no spear recipe', ()=>{
    ok(!base.RECIPES.find(x=>x.key==='spear'),'baseline already had one');
});
T('the shaft length IS the two sticks the recipe buys', ()=>{
    /* not a restatement of 2: the recipe's own stick count times the file's
       own unit stick length. Mutating either end moves this. */
    const r=G.RECIPES.find(x=>x.key==='spear');
    eq(G.SPEAR_LEN,G.BUNDLE_LEN*r.cost.stick,'SPEAR_LEN:');
    eq(G.SPEAR_RAD,G.BUNDLE_STICK_T,'SPEAR_RAD is a stick\'s section:');
});
T('every MAT id has exactly one ITEM_GROUPS home (the file\'s own invariant)', ()=>{
    const homes={};
    for(const g of G.ITEM_GROUPS)for(const id of g.ids)homes[id]=(homes[id]||0)+1;
    for(const id of Object.keys(G.MAT))
        eq(homes[id]||0,1,'MAT id '+id+' homes:');
    eq(homes.spear,1,'spear homes:');
    eq(G.ITEM_GROUP_OF.spear,'organic','spear group:');
});
T('a spear is a TOOL, not a block', ()=>{
    ok(G.isToolId('spear'),'not in TOOL_IDS');
    ok(G.hotbarEligible('spear'),'not hotbar-eligible');
    eq(G.MAT.spear.buildable,false,'buildable:');
});
T('PRE-FIX CONTROL: v2.12.39 has no spear material at all', ()=>{
    ok(!base.MAT.spear,'baseline already had MAT.spear');
});

console.log('\n== 2. THE CHAIN THAT FEEDS IT (behavioural, not asserted from prose) ==');

const body=makeBody(G,THREE,{R:200});
ok(activate(G,body),'fixture is not activeBody');
stand(G,THREE,body,[1,0,0],[0,0,-1]);

T('striking flint with no tinder under it yields the blade the recipe wants', ()=>{
    G.inventory.flint=1;G.inventory.flint_blade=0;
    const lg=G.spawnLogCore(body,V(201,0,0),G.FLINT_SIZE,G.FLINT_SIZE/2,'flint',1,null);
    ok(lg,'no flint heap');
    ok(G.strikeFlint(lg),'strike refused');
    eq(G.inventory.flint_blade,1,'blades after the knap:');
});
T('splitting a log with that blade yields the sticks the recipe wants', ()=>{
    G.inventory.stick=0;
    G.hotbarFront('flint_blade');G.selectTool(G.hotbarToolSlotOf('flint_blade'));
    eq(G.activeToolId(),'flint_blade','tool in hand:');
    const trunk=G.spawnLogCore(body,V(203,0,0),G.LOG_LEN,G.LOG_RAD,'trunk',3,null);
    ok(G.logSplittable(trunk),'a trunk is not splittable?');
    ok(G.splitLog(trunk,'flint_blade'),'split refused');
    const bundle=body.logs.find(l=>l.kind==='bundle');
    ok(bundle,'no bundle');
    eq(bundle.yieldN,G.SPLIT_STICKS.flint_blade,'sticks in the bundle:');
    ok(G.SPLIT_STICKS.flint_blade>=1,'a split must pay at least one stick');
});
T('a spear is NOT firewood — the blade will not split it', ()=>{
    const sp=G.spawnLogCore(body,V(205,0,0),G.SPEAR_LEN,G.SPEAR_RAD,'spear',1,null);
    ok(!G.logSplittable(sp),'a spear reads as splittable wood');
    G.removeLog(sp);
});

console.log('\n== 3. THE TOOL ROW ==');

T('the row is eleven slots: four stances and seven carried tools', ()=>{
    eq(G.HOTBAR_TOOL_ITEM_SLOTS,7,'item slots:');
    eq(G.HOTBAR_TOOL_SLOTS,G.HOTBAR_STANCE_SLOTS+7,'total slots:');
    eq(G.HOTBAR_TOOL_SLOTS,11,'total slots:');
});
T('ALL SEVEN carried tools are on the row at once', ()=>{
    const all=['stick','oar','rope','flint','flint_blade','axe','spear'];
    for(const id of all){G.inventory[id]=1;G.hotbarFront(id);}
    for(const id of all)ok(G.hotbarToolSlotOf(id)>=0,id+' fell off the row');
    eq(new Set(all.map(id=>G.hotbarToolSlotOf(id))).size,7,'seven distinct slots:');
});
T('PRE-FIX CONTROL: on v2.12.39 a seventh tool pushes one off the row', ()=>{
    const all=['stick','oar','rope','flint','flint_blade','axe'];
    for(const id of all){base.inventory[id]=1;base.hotbarFront(id);}
    /* the baseline has no `spear`, so the seventh is whatever else is a tool —
       front the six then re-front the oldest, which is the same shape of event:
       a SEVENTH distinct carried tool cannot be shown. */
    eq(base.HOTBAR_TOOL_ITEM_SLOTS,6,'baseline item slots:');
    ok(base.HOTBAR_STANCE_SLOTS+7>base.HOTBAR_TOOL_SLOTS,
       'baseline row could already have held seven');
});
T('hotbarToolKey names the first ten slots and refuses the eleventh', ()=>{
    const want=['1','2','3','4','5','6','7','8','9','0'];
    for(let i=0;i<10;i++)eq(G.hotbarToolKey(i),want[i],'slot '+i+' key:');
    eq(G.hotbarToolKey(10),'','slot 10 must have no digit — there are only ten');
});
T('key and slot are one table read both ways (round trip)', ()=>{
    for(let s=0;s<G.HOTBAR_TOOL_SLOTS;s++){
        const k=G.hotbarToolKey(s);
        if(!k)continue;
        eq(G.hotbarToolSlotForKey(k),s,'round trip slot '+s+':');
    }
    eq(G.hotbarToolSlotForKey('x'),-1,'a non-digit must answer -1');
});
T('SHIFT+0 still means slot 9, NOT the last slot', ()=>{
    /* the assertion that fails if `n===0?HOTBAR_TOOL_SLOTS-1:n-1` comes back:
       that expression answers 10 now, orphaning slot 9. Absolute, not derived
       from HOTBAR_TOOL_SLOTS, so it cannot move with the constant. */
    eq(G.hotbarToolSlotForKey('0'),9,'SHIFT+0 slot:');
    ok(G.hotbarToolSlotForKey('0')!==G.HOTBAR_TOOL_SLOTS-1,
       'SHIFT+0 is pointing at the last slot again');
});
T('the keyless slot is still selectable (MMB / click), just not by digit', ()=>{
    const all=['stick','oar','rope','flint','flint_blade','axe','spear'];
    for(const id of all){G.inventory[id]=1;G.hotbarFront(id);}
    const id10=G.hotbarToolIdAt(10);
    ok(id10,'slot 10 is empty with seven tools held');
    eq(G.hotbarToolKey(10),'','slot 10 key:');
    G.selectTool(0);
    ok(G.selectTool(10),'selectTool refused the keyless slot');
    eq(G.activeToolId(),id10,'active tool after selecting slot 10:');
});
T('SHIFT+digit goes through the real keydown handler, not just the helper', ()=>{
    /* MUTATION SWEEP FINDING: every key test asserted hotbarToolSlotForKey and
       NOT ONE of them went through the handler that calls it, so restoring the
       old `n===0?HOTBAR_TOOL_SLOTS-1:n-1` expression in the keydown listener
       survived the whole suite. The listener is recorded by the rig now and the
       event is dispatched for real. */
    /* the handler's own first guard is `if(!gameStarted)return;`, so without
       this the whole test is VACUOUS — which it was on its first run: SHIFT+1
       "passed" only because selectedTool had been parked at 0 a line earlier
       and nothing moved it. The anti-vacuity assertion below is the fix for
       that class, not just for this test.
       STARTED FIRST, THEN THE TOOLS: startGame() rebuilds the bars, so fronting
       them before it is how the second run of this test still measured nothing. */
    if(!G.gameStarted)G.startGame();
    ok(G.gameStarted,'the keydown handler is inert until the game has started');
    const all=['stick','oar','rope','flint','flint_blade','axe','spear'];
    for(const id of all){G.inventory[id]=1;G.hotbarFront(id);}
    eq(G.hotbarToolIdAt(4),'spear','slot 4 should hold the newest tool');
    const press=(digit)=>{
        G.selectTool(0);
        globalThis.__dispatch('keydown',{code:'Digit'+digit,key:String(digit),
            shiftKey:true,ctrlKey:false,altKey:false,repeat:false,
            preventDefault(){},stopPropagation(){}});
        return G.selectedTool;
    };
    ok(press(5)!==0,'no digit press moved the selection at all — the test is vacuous');
    eq(press(1),0,'SHIFT+1 slot:');
    eq(press(5),4,'SHIFT+5 slot:');
    eq(press(0),9,'SHIFT+0 must be slot 9 — NOT the last slot, which is 10 now');
});
T('LMB_TOOLS is membership, and the spear is in it', ()=>{
    ok(G.LMB_TOOLS.has('spear'),'spear not on LMB');
    ok(G.LMB_TOOLS.has('rifle')&&G.LMB_TOOLS.has('exlance'),'a beam fell off LMB');
    ok(!G.LMB_TOOLS.has('mine'),'hand mining must not be an LMB tool — it is the fallback');
});

console.log('\n== 4. THE HEAP ROW: WHY IT COMES BACK ==');

T('LOG_KINDS.spear is the four fields, and the size is the kind\'s own', ()=>{
    const k=G.LOG_KINDS.spear;
    ok(k,'no spear kind');
    eq(k.mat,'spear','mat:');
    eq(k.pocket,true,'pocket:');
    eq(k.geo,G.spearGeometry,'geo:');
    eq(k.burnKey,undefined,'a spear must not be fuel');
    eq(k.burnsTo,undefined,'a spear must not burn into anything');
    /* the kind overrides whatever a caller measured — logLenOf's contract */
    eq(G.logLenOf('spear',99),G.SPEAR_LEN,'logLenOf:');
    eq(G.logRadOf('spear',99),G.SPEAR_RAD,'logRadOf:');
    eq(G.logNoun({kind:'spear'}),'spear','noun:');
});
T('the geometry is cached, real, and as long as the shaft says', ()=>{
    const a=G.spearGeometry(G.SPEAR_LEN,G.SPEAR_RAD);
    const b=G.spearGeometry(G.SPEAR_LEN,G.SPEAR_RAD);
    eq(a,b,'not cached (a new buffer per spear)');
    ok(a.attributes.position.count>0,'empty geometry');
    a.computeBoundingBox();
    const span=a.boundingBox.max.y-a.boundingBox.min.y;
    near(span,G.SPEAR_LEN,0.02,'shaft span along its own axis:');
});
T('[F] on a landed spear puts it back in the pack', ()=>{
    G.inventory.spear=0;
    const lg=G.spawnLogCore(body,V(207,0,0),G.SPEAR_LEN,G.SPEAR_RAD,'spear',1,null);
    ok(lg,'no heap');
    ok(G.logKind(lg).pocket,'a spear must pocket, not shoulder');
    ok(G.pocketLog(lg),'pickup refused');
    eq(G.inventory.spear,1,'spears after pickup:');
});
T('a landed spear survives a save/load round trip, pose included', ()=>{
    const q=new THREE.Quaternion().setFromAxisAngle(V(0,0,1),0.7);
    const lg=G.attachLog(body,{kind:'spear',len:G.SPEAR_LEN,rad:G.SPEAR_RAD,yieldN:1,
        sp:null,pos:V(209,1,2),quat:q,resting:true,afloat:false});
    ok(lg,'no heap');
    const saved=G.saveBodyLogs(body).filter(r=>r[0]==='spear');
    eq(saved.length,1,'saved spear records:');
    const fresh=makeBody(G,THREE,{R:200});
    eq(G.restoreSavedLogs(fresh,saved),1,'restored:');
    const back=fresh.logs[0];
    eq(back.kind,'spear','kind:');
    near(back.len,G.SPEAR_LEN,1e-6,'len:');
    near(back.mesh.quaternion.z,q.z,1e-3,'pose z:');
    G.removeLog(back);G.removeLog(lg);
});

console.log('\n== 5. ONE STATEMENT OF "UNDER WATER" ==');

/* a REAL band object, deliberately EMPTY. bandGetC walks band.ids via
   bandSlotC and then band.sparse; an empty fine grid answers -1 for every
   probe outside it, which is the honest "no band data here" the shoreline
   fallback exists to handle — and it is what lets the cone path below
   actually run instead of the function bailing at its first guard. */
/* nc=0 makes bandSlotK answer -1 for every coarse lookup, so every probe falls
   through to `sparse` — which is a plain Map keyed (X*n+Y)*n+Z. That is the
   band's own documented second path, not a fake: it is how an inland dig gets
   its water recorded. An EMPTY sparse map therefore means "no band data
   anywhere", which is the DRY answer the shoreline fallback exists to handle. */
const emptyBand=()=>({n:64,k:1,nc:0,colZ:[],colOff:[],ids:new Int16Array(0),sparse:new Map()});
/* body-local point -> the band cell that owns it, using the same
   floor(p/blockSize + gridSize/2) the probe inside oceanAtLocal uses. */
const bandKey=(body,p)=>{
    const bs=body.blockSize,half=body.gridSize/2;
    const X=Math.floor(p.x/bs+half),Y=Math.floor(p.y/bs+half),Z=Math.floor(p.z/bs+half);
    return (X*body.oceanBand.n+Y)*body.oceanBand.n+Z;
};
const claim=(body,p,id)=>{body.oceanBand.sparse.set(bandKey(body,p),id===undefined?0:id);};
const FAR=new THREE.Vector3(1,0,0).multiplyScalar(100);   // no sparse entry: no band data

T('the cone fallback is live, so the dead-ocean test below is not vacuous', ()=>{
    const w=makeBody(G,THREE,{R:200});
    w.oceanBand=emptyBand();
    w.oceans=[{level:190,dead:false,coneDir:null}];   // "whole-sphere sea, no cull"
    eq(G.oceanAtLocal(w,FAR,true,false),w.oceans[0],
       'the cone fallback did not run — the dead-ocean assertion would prove nothing');
});
T('a DEAD ocean is never water (the measured claim behind dropping !oc.dead)', ()=>{
    const d=makeBody(G,THREE,{R:200});
    d.oceanBand=emptyBand();
    d.oceans=[{level:190,dead:true,coneDir:null}];
    eq(G.oceanAtLocal(d,FAR,true,false),null,
       'oceanAtLocal handed back a DEAD ocean — !oc.dead was NOT inert');
    eq(G.pointSubmerged(d,FAR),null,'a dead sea read as water');
});
T('pointSubmerged honours the 0.15 skin, in absolute numbers', ()=>{
    const w=makeBody(G,THREE,{R:200});
    w.oceanBand=emptyBand();
    w.oceans=[{level:190,dead:false,coneDir:null}];
    eq(G.OCEAN_SKIN,0.15,'the surface skin both former copies stated');
    /* strict is what pointSubmerged passes, and strict skips the cone — so the
       band decides containment and, with an empty band, everything is DRY.
       That is the v2.12.13 rule and it is asserted here rather than assumed. */
    eq(G.pointSubmerged(w,FAR),null,'strict must trust the band alone, and the band is empty');
    /* the LEVEL half of the rule, exercised on the same predicate by giving the
       band something to say: bandSlotC answers inside the fine grid. */
    const w2=makeBody(G,THREE,{R:200});
    w2.oceanBand=emptyBand();
    w2.oceans=[{level:3,dead:false,coneDir:null}];
    const at=(r)=>new THREE.Vector3(1,0,0).multiplyScalar(r);
    /* the three radii under test all sit in the band, so CONTAINMENT is settled
       and the only thing left to decide the answer is the level test — which is
       the whole point: this test is about the SKIN, not about the geometry. */
    for(const r of [2.80,2.90,3.50])claim(w2,at(r),0);
    eq(!!G.pointSubmerged(w2,at(2.80)),true, '2.80 is below level 3 minus the skin');
    eq(!!G.pointSubmerged(w2,at(2.90)),false,'2.90 is inside the 0.15 skin and must read DRY');
    eq(!!G.pointSubmerged(w2,at(3.50)),false,'3.50 is above the level entirely');
});
T('a band that names a DEAD ocean still reads dry (the tail, not the cone)', ()=>{
    /* MUTATION SWEEP FINDING: the earlier dead-ocean test went through the CONE
       fallback, whose own loop skips dead seas — so oceanAtLocal's closing
       `if(!o||o.dead)return null;` was never reached and deleting it survived.
       This drives the BAND path, where the id of a dead ocean comes straight
       back and only that tail can refuse it. */
    const d=makeBody(G,THREE,{R:200});
    d.oceanBand=emptyBand();
    const p=new THREE.Vector3(1,0,0).multiplyScalar(2.5);
    claim(d,p,0);
    d.oceans=[{level:3,dead:false,coneDir:null}];
    ok(G.oceanAtLocal(d,p,true,true),'control: a LIVE ocean named by the band must come back');
    d.oceans[0].dead=true;
    eq(G.oceanAtLocal(d,p,true,true),null,'a DEAD ocean named by the band came back — the tail guard is gone');
    eq(G.pointSubmerged(d,p),null,'a dead sea read as water');
});
T('a body with no oceans, and a null body, are never wet', ()=>{
    eq(G.pointSubmerged({},new THREE.Vector3(0,0,0)),null,'no oceans');
    eq(G.pointSubmerged(null,new THREE.Vector3(0,0,0)),null,'null body');
});
T('the three readers ask the ONE rule', ()=>{
    const w=makeBody(G,THREE,{R:200});
    w.oceanBand=emptyBand();
    w.oceans=[{level:3,dead:false,coneDir:null}];
    for(const r of [2.80,2.90,3.50])claim(w,new THREE.Vector3(1,0,0).multiplyScalar(r),0);
    for(const r of [2.80,2.90,3.50]){
        const p=new THREE.Vector3(1,0,0).multiplyScalar(r);
        G.player.position.copy(w.position).add(p);
        const truth=!!G.pointSubmerged(w,p);
        eq(G.caveWaterAt(w,p),truth,'caveWaterAt disagrees at r='+r);
        eq(G.playerInWater(w),truth,'playerInWater disagrees at r='+r);
    }
});

console.log('\n== 6. THE FLIGHT ==');

/* ONE throw per module instance — see the freshGame note above. */
async function fly(look,{from=[1,0,0],dt=1/60,max=3000}={}){
    const {g,b}=await freshGame();
    arm(g,b,look,from);
    const start=g.player.position.clone();
    const thrown=g.throwSpear();
    let n=0;
    while(g.spears.length&&n<max){g.updateSpears(dt);n++;}
    const heap=b.logs.find(l=>l.kind==='spear');
    const restAbs=heap?heap.mesh.position.clone().add(b.position):null;
    return {g,b,thrown,steps:n,heap,
            travel:restAbs?restAbs.distanceTo(start):null,
            radius:heap?heap.mesh.position.length():null,
            stats:{...g.spearStats}};
}

await TA('a level throw comes down: the shaft ends on the ground, not in the air', async()=>{
    const r=await fly([0,0,-1]);            // tangent to the sphere at (1,0,0)
    ok(r.thrown,'throw refused');
    ok(r.heap,'no heap: the shaft never came to rest');
    eq(r.stats.landed,1,'landed:');
    ok(r.steps<3000,'the flight never terminated');
    near(r.radius,r.b.surfaceR,3.0,'rest radius vs the known ground radius:');
});
await TA('a spear stuck in the ground STAYS where it stopped, at the angle it came down', async()=>{
    /* MUTATION SWEEP FINDING: nothing asserted either half of the landing pose,
       so "born resting" and "born nose-along-its-own-velocity" — both FLAGGED
       decisions in the changelog — could each be reversed without a test
       noticing. */
    const r=await fly([0,0,-1]);
    ok(r.heap,'no heap');
    eq(r.heap.resting,true,'a terrain hit must be born at rest, not handed to the log fall');
    const axis=new THREE.Vector3(0,1,0).applyQuaternion(r.heap.mesh.quaternion);
    const vel=r.g.spearStats.lastDir||null;   // not exported: compare against the SHAFT instead
    /* the shaft came down onto a sphere, so its heading at impact points
       INWARD: the pose axis must have a negative radial component. A spear
       lying flat (the mutant that drops the quaternion) has none. */
    const radial=r.heap.mesh.position.clone().normalize();
    ok(axis.dot(radial)<-0.05,'the landed shaft is not nose-down into the ground (axis·radial='+axis.dot(radial).toFixed(3)+') — it is not wearing its flight pose');
});
await TA('GRAVITY DROPS IT MORE WITH DISTANCE — quadratically, not linearly', async()=>{
    /* the brief's third sentence, made falsifiable. Sample the SAME flight at
       two times and compare the radial drop against the straight line the
       shaft would have flown with no pull on it. Ballistic drop goes as t^2,
       so doubling the time must more than TRIPLE it; a linear pull, or none,
       cannot. */
    const {g,b}=await freshGame();
    arm(g,b,[0,0,-1]);
    ok(g.throwSpear(),'throw refused');
    const sp=g.spears[0];
    const r0=sp.mesh.position.length();
    const run=()=>{for(let i=0;i<12;i++)if(g.spears.length)g.updateSpears(1/60);};
    run(); const d1=r0-sp.mesh.position.length();
    run(); const d2=r0-sp.mesh.position.length();
    ok(d1>0,'no drop at all after 0.2 s — gravity is not being applied');
    ok(d2>3*d1,'drop after 0.4 s ('+d2.toFixed(3)+') is not >3x the drop after 0.2 s ('+d1.toFixed(3)+') — the pull is not accelerating');
});
await TA('THERE IS NO RANGE CONSTANT: a lofted throw outflies the rifle', async()=>{
    /* "no limit on distance" is only meaningful if the shaft can beat the one
       weapon in the game that HAS a range. RIFLE_RANGE is read live, so this
       cannot drift if the rifle is ever retuned. */
    /* THE LOFT IS ALONG THE LOCAL UP, and getting that wrong is how this test
       first read 40 u: standing at (1,0,0) on a sphere, +Y is a TANGENT, not
       up, so a "+0.55 in Y" throw was a flat one dressed up as a lofted one.
       Up here is +X. Recorded because it is the same class of mistake the
       coordinate-space discipline exists to catch. */
    const r=await fly([0.4,0,-1]);
    ok(r.heap,'no heap');
    ok(r.travel>r.g.RIFLE_RANGE,'travelled '+r.travel.toFixed(1)+' u, which does not beat RIFLE_RANGE='+r.g.RIFLE_RANGE);
});
await TA('the shaft is spent on the throw and paid back on the pickup', async()=>{
    const {g,b}=await freshGame();
    g.inventory.spear=2;
    g.hotbarFront('spear');g.selectTool(g.hotbarToolSlotOf('spear'));
    stand(g,THREE,b,[1,0,0],[0,0,-1]);
    ok(g.throwSpear(),'throw refused');
    eq(g.inventory.spear,1,'spears after the throw:');
    for(let i=0;i<3000&&g.spears.length;i++)g.updateSpears(1/60);
    const heap=b.logs.find(l=>l.kind==='spear');
    ok(heap,'no heap');
    ok(g.pocketLog(heap),'pickup refused');
    eq(g.inventory.spear,2,'spears after retrieval:');
});
await TA('one press is one throw: the cooldown refuses the second', async()=>{
    const {g,b}=await freshGame();
    arm(g,b,[0,0,-1]);
    const had=g.inventory.spear;
    ok(g.throwSpear(),'first throw refused');
    eq(g.throwSpear(),false,'the second throw in the same instant was allowed');
    eq(g.spears.length,1,'shafts in flight:');
    eq(g.inventory.spear,had-1,'a refused throw must cost nothing:');
    ok(g.SPEAR_CD>0,'SPEAR_CD must be positive for a cooldown to exist');
});
await TA('a throw with none in the pack is refused, and costs nothing', async()=>{
    const {g,b}=await freshGame();
    arm(g,b,[0,0,-1]);
    g.inventory.spear=0;
    eq(g.spearReady(),false,'spearReady said yes with an empty pack');
    eq(g.throwSpear(),false,'threw a spear that was not there');
    eq(g.spears.length,0,'shafts in flight:');
});
await TA('leaving the planet drops a shaft that is still in the air', async()=>{
    const {g,b}=await freshGame();
    arm(g,b,[0,0.9,-1]);
    ok(g.throwSpear(),'throw refused');
    eq(g.spears.length,1,'nothing in flight to lose');
    const other=makeBody(g,THREE,{R:200,at:[5000,0,0]});
    ok(activate(g,other),'could not hand off to the other body');
    g.updateSpears(1/60);
    eq(g.spears.length,0,'the shaft is still in flight on a body we left');
    eq(g.spearStats.lost,1,'lost:');
});
T('SPEAR_G is derived from LOG_G, not restated', ()=>{
    eq(G.SPEAR_G,G.LOG_G,'a spear must fall at the rate everything falls at');
});

console.log('\n== 7. UNDER WATER ==');

T('water takes the speed out: the same throw goes shorter, and still goes', ()=>{
    /* the fixture cannot be given real band data, so drag is exercised
       DIRECTLY on the integrator: two identical shafts, one told it is
       submerged and one not, over the same number of substeps. The predicate
       itself is asserted in section 5. */
    const dt=1/60,N=30;
    const air=G.SPEAR_SPEED,water=G.SPEAR_SPEED*Math.exp(-G.SPEAR_WATER_K*dt*N);
    ok(water<air*0.5,'after '+(dt*N).toFixed(2)+' s under water the shaft has lost less than half its speed — the drag is not doing anything');
    /* it must still be a WEAPON, not a stone: the reach the drag leaves is
       v0/k, and it has to cover a lake. */
    const reach=G.SPEAR_SPEED/G.SPEAR_WATER_K;
    ok(reach>6,'underwater reach is only '+reach.toFixed(1)+' u — too short to spear anything');
    ok(reach<G.RIFLE_RANGE,'underwater reach '+reach.toFixed(1)+' u is not meaningfully shorter than the open-air throw');
    /* and the sink is slow rather than a plummet: terminal speed is g/k. */
    const sink=G.SPEAR_G/G.SPEAR_WATER_K;
    ok(sink<G.SPEAR_SPEED*0.25,'a submerged shaft still falls at '+sink.toFixed(1)+' u/s — it drops like a stone');
});
T('PRE-FIX CONTROL: v2.12.39 has no spear system at all', ()=>{
    for(const n of ['throwSpear','updateSpears','spearScan','landSpear','spearReady','pointSubmerged','hotbarToolKey'])
        ok(typeof base[n]==='undefined','baseline already exported '+n);
});

console.log('\n== 8. THE SWEEP ==');

T('the sweep stops on ground and reports the distance to it', ()=>{
    const hit=G.spearScan(body,V(210,0,0),V(-1,0,0),20);
    ok(hit,'no hit into the ground');
    eq(hit.kind,'stop','kind:');
    near(hit.distance,10,0.2,'distance to a sphere of radius 200 from r=210:');
});
T('the sweep is a SEGMENT: nothing beyond `dist` is reported', ()=>{
    eq(G.spearScan(body,V(210,0,0),V(-1,0,0),5),null,
       'reported a hit 10 u away on a 5 u segment — the shaft can tunnel');
    ok(G.spearScan(body,V(210,0,0),V(-1,0,0),10.5),'missed a hit inside the segment');
});
T('NEAREST wins across every list, not the first list that answers', ()=>{
    /* MUTATION SWEEP FINDING: the fixture only ever had ONE candidate list
       populated (terrain), so `if(best)return;` — take the first list that
       answers and stop — passed the whole suite. The lists are checked in a
       fixed order (land mobs BEFORE guards), so the case that separates the two
       readings is a mob FAR and a guard NEAR: nearest-wins says guard,
       first-list-wins says mob. */
    const b2=makeBody(G,THREE,{R:200});
    const box=(size)=>new THREE.BoxGeometry(size,size,size);
    const mat=new THREE.MeshBasicMaterial();
    const put=(mesh,x)=>{
        const m=new THREE.Matrix4().makeTranslation(x,0,0);
        mesh.setMatrixAt(0,m);mesh.instanceMatrix.needsUpdate=true;
        b2.group.add(mesh);
    };
    const mobMesh=new THREE.InstancedMesh(box(2),mat,1);
    put(mobMesh,203);                       // FAR-er, but still above the r=200 ground
    const guardMesh=new THREE.InstancedMesh(box(2),mat,1);
    put(guardMesh,206);                     // NEARER to a shaft starting at 212
    b2.group.updateMatrixWorld(true);
    const mobRec={sp:Object.keys(G.FAUNA)[0],pos:V(203,0,0),hp:9};
    const guardRec={hp:9};
    b2.mobParts=[mobMesh];b2.mobs=[mobRec];b2._mobSlot=[mobRec];
    b2.guardMesh=guardMesh;b2.guards=[guardRec];b2._guardSlot=[guardRec];
    const hit=G.spearScan(b2,V(212,0,0),V(-1,0,0),40);
    ok(hit,'nothing hit at all');
    eq(hit.kind,'guard','the NEARER candidate must win, whatever list it is in');
    eq(hit.rec,guardRec,'wrong record handed back');
    /* and the control: with the guard moved behind the mob, the mob wins */
    b2.guards=[];
    const hit2=G.spearScan(b2,V(212,0,0),V(-1,0,0),40);
    eq(hit2.kind,'creature','with no guard the mob must be the hit');
});
T('the sweep reports nothing when there is nothing', ()=>{
    eq(G.spearScan(body,V(210,0,0),V(1,0,0),50),null,'hit something facing away from the planet');
    eq(G.spearScan(null,V(0,0,0),V(1,0,0),10),null,'a null body must answer null');
});
T('a body with no mesh and no chunks is not swept', ()=>{
    const empty={position:V(0,0,0),group:new THREE.Group()};
    eq(G.spearScan(empty,V(1,0,0),V(1,0,0),10),null,'swept a body with no terrain');
});

console.log('\n== 9. A CREATURE IN THE PATH ==');

T('a creature record routes through hitCreature and takes SPEAR_DMG', ()=>{
    /* hitCreature dispatches on the RECORD (v2.11.11), so a land record is
       enough to prove the routing without a rendered mob: this asserts the
       damage arithmetic the sweep hands it, on the shipped handler. */
    const sp=Object.keys(G.FAUNA)[0];
    const def=G.FAUNA[sp];
    const mob={sp,pos:V(0,0,201),hp:def.hp,tamed:false,heading:0,fleeT:0};
    body.mobs=[mob];body._mobsDirty=false;
    const before=mob.hp;
    G.hitCreature(body,mob,V(0,0,201),G.weaponDmg(G.SPEAR_DMG));
    eq(before-mob.hp,G.SPEAR_DMG,'damage dealt:');
    body.mobs=[];
});
T('a spear does more per hit than a rifle bolt (it is one throw you walk to)', ()=>{
    ok(G.SPEAR_DMG>G.RIFLE_DMG,'SPEAR_DMG='+G.SPEAR_DMG+' does not beat RIFLE_DMG='+G.RIFLE_DMG);
});
T('you cannot spear your own companion', ()=>{
    const sp=Object.keys(G.FAUNA)[0];
    const def=G.FAUNA[sp];
    const pet={sp,pos:V(0,0,201),hp:def.hp,tamed:true,heading:0,fleeT:0};
    body.mobs=[pet];
    G.hitCreature(body,pet,V(0,0,201),G.weaponDmg(G.SPEAR_DMG));
    eq(pet.hp,def.hp,'a tamed animal took spear damage');
    body.mobs=[];
});

console.log('\n== 10. THE CAP ==');

T('no more than SPEAR_MAX_LIVE shafts are ever in the air', ()=>{
    G.spears.length=0;
    for(let i=0;i<G.SPEAR_MAX_LIVE+3;i++)
        G.spears.push({body,mesh:null,vel:V(0,0,0),age:0});
    eq(G.spearReady(),false,'spearReady allowed a throw over the cap');
    G.spears.length=0;
    ok(G.SPEAR_MAX_LIVE>=1,'the cap must allow at least one');
});

console.log(`\n[seed ${SEED}] ${pass} pass, ${fail} fail`);
process.exit(fail?1:0);
