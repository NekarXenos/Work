#!/usr/bin/env python3
"""v2.12.40 patch C: the throw, the flight, the sweep and the landing."""
import io

P='/home/claude/work/Bleaux_v2_12_40.html'
s=io.open(P,encoding='utf-8').read()

def sub(old,new,label):
    global s
    n=s.count(old)
    assert n==1, 'ANCHOR %s occurs %d times, expected 1'%(label,n)
    s=s.replace(old,new,1)
    print('  ok  '+label)

BLOCK=r"""
/* ================= v2.12.40 THE SPEAR: THROW, DROP, RETRIEVE ==============
   BGAM_SPEAR_BEGIN

   PLAYER BRIEF, VERBATIM: "Add a Spear as a craftable item. It needs flint
   blade, string, and 2 sticks. Since its a tiny planet, theres no limit on
   distance. You can also spear under water. Gravity affects the spear so it
   drops more with distance."

   THE FIRST WEAPON IN THIS GAME THAT IS NOT A BEAM, AND THAT IS THE WHOLE
   FEATURE. The rifle, the mining laser and the radiation lance are all ONE
   raycast at the instant of the click: they arrive where the crosshair was,
   immediately, out to a range constant. Every line below exists because a
   spear is none of those things — it is an OBJECT that leaves your hand, is
   pulled on the way, arrives somewhere the crosshair was not, and is still
   lying there afterwards.

   "NO LIMIT ON DISTANCE" IS IMPLEMENTED AS THE ABSENCE OF A CONSTANT, NOT AS
   A LARGE ONE. There is no SPEAR_RANGE anywhere here. The rifle has
   RIFLE_RANGE=60 and the beam has playerStats.mineRange precisely because a
   beam that reached forever would be a sniper rifle with no counterplay; a
   spear needs no such number because GRAVITY IS THE RANGE. Thrown level from
   a standing throw the shaft is on the ground in well under a second, and
   thrown up it comes back down — the brief's third sentence is the reason its
   second one costs nothing. SPEAR_LIFE below is a backstop against a shaft
   that has somehow found nothing at all to hit (down a bored shaft, out over
   a chunk the streamer has not loaded), not a range in disguise: it is long
   enough that no ordinary throw ever reaches it.

   GRAVITY IS 14, AND IT IS NOT A NEW 14. Every loose object in this game
   already falls at that rate — mobs (updateResidents), placed granular cubes
   (updateFallingCubes), boulders and logs (BOULDER_G, and LOG_G which is
   DERIVED from it rather than restated). SPEAR_G is derived from LOG_G for
   exactly that reason: a spear that fell at a different rate from the log it
   lands next to would be a second answer to a question this file has already
   answered once.

   THE SWEEP IS A SEGMENT, NOT A POINT, so nothing can be tunnelled through.
   Each substep the shaft asks "what is the FIRST thing between where I was
   and where I am about to be", which is the same question the rifle asks of
   its crosshair and is answered with the same raycaster and the same lists.
   It runs INSIDE the substep loop, beside updateLogs, for the reason
   v2.11.53 states at that exact spot: a per-frame pass sweeps a segment as
   many times too long as there are substeps.

   WHAT IT HITS IS DELIBERATELY NARROWER THAN WHAT THE BEAM HITS, and that is
   why this is its own function rather than a call into the mining beam's
   ten-way arbitration. A flint spear damages things that BLEED — the three
   creature substrates and a ground guard — and merely STOPS on everything
   else. It does not chop a tree, crack a crystal, wreck a hut, scorch terrain
   or dig. Sharing the beam's arbitration would have meant either giving a
   thrown stick the mining laser's powers or bolting a "but not if it is a
   spear" flag onto ten branches; a different question honestly gets a
   different function, which is not the same thing as a duplicated rule.

   UNDER WATER IT IS THE SAME THROW WITH DRAG ON IT. The brief says a spear
   works under water and this is the smallest true way to say so: nothing
   about the verb, the aim or the targets changes (fish were already in the
   sweep — they are one of the three substrates), and what water adds is the
   one thing water actually does, which is take the speed out. SPEAR_WATER_K
   is an exponential per-second decay applied to the WHOLE velocity, gravity's
   accumulation included, so the shaft also stops plummeting and settles to a
   slow sink at SPEAR_G/SPEAR_WATER_K — a spear that dropped through water at
   its air rate would look like a stone. The reach that buys is
   SPEAR_SPEED/SPEAR_WATER_K, about a dozen units, which is a whole lake's
   width of fish and nothing like the open-air throw. Asked ONCE per substep,
   at the shaft's own position, through pointSubmerged — the same predicate
   Bleaux's own swim check and the cave flood read (v2.12.40).

   [DECISION — FLAGGED] IT LANDS AS A HEAP, WHICH IS WHY IT IS RETRIEVABLE AT
   ALL. A spear that vanished on impact would be a consumable, and the brief
   does not describe a consumable — it describes a spear. LOG_KINDS gets a row
   (see it) and that row is the entire retrieval feature: [F] picks it up
   through carryVerb's existing `pocket` branch, mining it works, the tractor
   beam grabs it, and saveBodyLogs/restoreSavedLogs persist it, none of which
   is code written here. This is v2.11.44's promise collected for the third
   time (v2.12.35's coal, v2.12.39's flint rock, now this).

   [DECISION — FLAGGED] IT KEEPS THE POSE IT ARRIVED AT. attachLog takes an
   explicit quaternion (v2.12.23 gave it one for the raft and the save loader,
   both of which are born at a pose rather than computing one) and updateLogs
   has NO rotation term, so a shaft born nose-along-its-own-velocity stays
   that way: it stands in the ground at the angle it came down at. A terrain
   hit is born `resting`, because it is already exactly where it stopped; a
   creature hit is NOT, because the animal may have been swimming or six units
   up a hillside, and the honest thing is to let the shipped log fall carry it
   down to whatever is underneath.

   [DECISION — FLAGGED] A SPEAR IN THE AIR IS NOT SAVE STATE. The save is
   PROGRESS, not a frame-perfect snapshot (see its own header), and it already
   declines to capture wildlife or anything mid-flight. A shaft still airborne
   when the game is saved is gone on reload; one that has LANDED is a log and
   is saved like every other log. Leaving the planet drops it for the same
   reason.                                                                  */
const SPEAR_SPEED=42;               // u/s at release
const SPEAR_G=LOG_G;                // DERIVED: a spear falls at the rate everything falls at
const SPEAR_DMG=6;                  /* twice a rifle bolt, because it is ONE throw and you
                                       then have to walk to it; the rifle spends nothing and
                                       fires again in 0.22 s. */
const SPEAR_LIFE=10;                // s — the backstop, NOT a range (see the header)
const SPEAR_CD=0.45;                // s between throws: an arm, not a trigger
const SPEAR_MAX_LIVE=5;             // shafts in flight at once
const SPEAR_WATER_K=3.5;            // per-second exponential drag once submerged
const SPEAR_RELEASE=1.2;            // u ahead of the aim origin — clear of Bleaux's own hull
const SPEAR_BURY=0.42;              /* fraction of the shaft that goes IN on a terrain hit,
                                       so the head is buried and the butt stands proud */
const spears=[];
const spearStats={thrown:0,landed:0,struck:0,lost:0};   // headless-visible, like logStats

/* CAN HE THROW ONE RIGHT NOW? Stated once so the verb and any future prompt
   ask the identical question — carryVerb's own rule since v2.12.0, applied to
   a key that is not [F]. */
let _spearLastThrow=-1e9;
function spearReady(){
    if(mode!=='foot'||!activeBody)return false;
    if((inventory.spear||0)<1)return false;
    if(spears.length>=SPEAR_MAX_LIVE)return false;
    return simT-_spearLastThrow>=SPEAR_CD;
}
/* THE THROW. The release point and the heading are the aim ray's, through
   beamHoldPoint — the same function the tractor beam and the log placement
   use, and the one place in this file the ORIGIN bookkeeping is written down
   (see its header). aimRay() also advances the origin to Bleaux's own
   projection in third person, so a spear thrown over his shoulder starts at
   HIM and not at the camera, which is the same correction the mining beam
   needed. */
function throwSpear(){
    if(!spearReady())return false;
    if(!spendItem('spear',1))return false;
    const body=activeBody;
    _spearLastThrow=simT;
    const dir=aimRay().ray.direction.clone().normalize();
    const local=beamHoldPoint(SPEAR_RELEASE).sub(body.position);
    const mesh=new THREE.Mesh(spearGeometry(SPEAR_LEN,SPEAR_RAD),builtMatFor('spear'));
    mesh.position.copy(local);
    mesh.quaternion.setFromUnitVectors(V3(0,1,0),dir);
    mesh.updateMatrix();
    body.group.add(mesh);
    spears.push({body,mesh,vel:dir.clone().multiplyScalar(SPEAR_SPEED),age:0});
    spearStats.thrown++;
    return true;
}
/* WHAT IS BETWEEN HERE AND THERE? The lists are the ones every other raycast
   on this body already reads; what differs from the beam is the VERDICT each
   one carries, which is the whole reason this function exists (see header).
   `kind` is 'creature' (route to hitCreature, which dispatches by substrate on
   the record itself — v2.11.11), 'guard', or 'stop'.
   Nearest wins across ALL candidates rather than an ordered cascade, for the
   reason v2.11.15 gave when it added the beam's sixth: a chain only out-ranks
   what comes after it, so appending is how a fish behind a hut takes the hit. */
function spearScan(body,fromLocal,dir,dist){
    if(!body||!(body.mesh||body.streamed))return null;
    raycaster.set(fromLocal.clone().add(body.position).sub(ORIGIN),dir);   // rebased: see ORIGIN's contract
    raycaster.far=dist;
    let best=null;
    const take=(hits,kind,pick)=>{
        if(!hits.length)return;
        if(best&&best.distance<=hits[0].distance)return;
        best={kind,distance:hits[0].distance,point:hits[0].point.clone(),
              rec:pick?pick(hits[0]):null};
    };
    if(body.mobParts&&body.mobParts.length&&body.mobs&&body.mobs.length)
        take(raycaster.intersectObjects(body.mobParts,false),'creature',
             h=>body._mobSlot?body._mobSlot[h.instanceId]:null);
    if(body.seaParts&&body.seaParts.length&&body.fish&&body.fish.length)
        take(raycaster.intersectObjects(body.seaParts,false),'creature',
             h=>body._fishSlot?body._fishSlot[h.instanceId]:null);
    if(body.caverHitParts&&body.caverHitParts.length&&body.cavers&&body.cavers.length)
        take(raycaster.intersectObjects(body.caverHitParts,false),'creature',
             h=>body._caverSlot?body._caverSlot[h.instanceId]:null);
    if(body.guardMesh&&body.guards&&body.guards.length)
        take(raycaster.intersectObject(body.guardMesh,false),'guard',
             h=>body._guardSlot?body._guardSlot[h.instanceId]:null);
    /* the STOP list: solid things a flint point does not go through and does
       not damage. collidersOf is the ground Bleaux's own feet trust, so a
       spear stops on exactly what he can stand on; trees, crystals and huts
       are added for the same reason the beam gives them their own casts —
       they are not in collidersOf and a shaft sailing through a hut wall
       reads as broken. */
    if(body.trees&&body.trees.hitParts.length)
        take(raycaster.intersectObjects(body.trees.hitParts,false),'stop');
    if(body.crystals&&body.crystals.hitParts.length&&body.crystals.high)
        take(raycaster.intersectObjects(body.crystals.hitParts,false),'stop');
    if(body.villageMesh&&body.village&&!body.village.razed)
        take(raycaster.intersectObject(body.villageMesh,false),'stop');
    take(raycaster.intersectObjects(collidersOf(body),false),'stop');
    raycaster.far=Infinity;
    return best;
}
/* THE SHAFT COMES TO REST. One exit for all three ways a flight ends — it hit
   something, it hit somebody, or it ran out of clock — so the row that makes
   it retrievable can never be attached by two of them and forgotten by the
   third. `resting` is the caller's, and it is the only thing the three ways
   disagree about (see the pose decision in the header). */
function landSpear(sp,localPos,dir,resting){
    removeSpearMesh(sp);
    const lg=attachLog(sp.body,{kind:'spear',len:SPEAR_LEN,rad:SPEAR_RAD,
        yieldN:1,sp:null,pos:localPos.clone(),
        quat:new THREE.Quaternion().setFromUnitVectors(V3(0,1,0),dir),
        resting:!!resting,afloat:false});
    if(lg)spearStats.landed++;
    else spearStats.lost++;    /* the live-heap cap refused and said why; the shaft is
                                  spent rather than silently duplicated back into the pack */
    return lg;
}
function removeSpearMesh(sp){
    if(sp.mesh){if(sp.mesh.parent)sp.mesh.parent.remove(sp.mesh);sp.mesh=null;}
    const i=spears.indexOf(sp);
    if(i>=0)spears.splice(i,1);
}
function updateSpears(dt){
    for(let i=spears.length-1;i>=0;i--){
        const sp=spears[i];
        if(!sp.mesh){spears.splice(i,1);continue;}
        /* left the planet with one in the air: it is not save state and it is
           not this body's business either — see the header. */
        if(sp.body!==activeBody){removeSpearMesh(sp);spearStats.lost++;continue;}
        const from=sp.mesh.position.clone();
        /* RADIAL gravity, toward this body's centre — the direction is the
           shaft's own position normalised, exactly as updateFallingCubes and
           updateLogs derive theirs. */
        const r=from.length();
        if(r>1e-5)sp.vel.addScaledVector(from.clone().multiplyScalar(-1/r),SPEAR_G*dt);
        /* WATER TAKES THE SPEED OUT, and takes it out of the gravity term too
           — see the header for why that is the point rather than a side
           effect. Asked at the shaft's position, not the player's. */
        if(pointSubmerged(sp.body,from))sp.vel.multiplyScalar(Math.exp(-SPEAR_WATER_K*dt));
        const step=sp.vel.clone().multiplyScalar(dt);
        const dist=step.length();
        const dir=dist>1e-6?step.clone().multiplyScalar(1/dist):sp.vel.clone().normalize();
        const hit=dist>1e-6?spearScan(sp.body,from,dir,dist):null;
        if(hit){
            /* hit points come back REBASED; hitCreature/hitGuard take exactly
               that (they call fxAbs at their own FX sites — the v2.10.15
               contract), while attachLog wants BODY-LOCAL. Both conversions
               are written here and nowhere else. */
            const localHit=hit.point.clone().add(ORIGIN).sub(sp.body.position);
            if(hit.kind==='creature'&&hit.rec){
                hitCreature(sp.body,hit.rec,hit.point,weaponDmg(SPEAR_DMG));
                spearStats.struck++;
                landSpear(sp,localHit,dir,false);   // it may have been swimming or up a slope
            }else if(hit.kind==='guard'&&hit.rec){
                hitGuard(sp.body,hit.rec,hit.point,weaponDmg(SPEAR_DMG));
                spearStats.struck++;
                landSpear(sp,localHit,dir,false);
            }else{
                /* the head goes IN and the butt stands proud: back the CENTRE
                   off along the flight direction so the point sits where the
                   surface was. */
                landSpear(sp,localHit.addScaledVector(dir,-SPEAR_LEN*SPEAR_BURY),dir,true);
            }
            continue;
        }
        sp.mesh.position.add(step);
        if(dist>1e-6)sp.mesh.quaternion.setFromUnitVectors(V3(0,1,0),dir);
        sp.mesh.updateMatrix();
        sp.age+=dt;
        if(sp.age>=SPEAR_LIFE)
            /* NOT resting: it has hit nothing, so hand it to updateLogs and
               let the shipped fall put it on the ground. */
            landSpear(sp,sp.mesh.position.clone(),dir,false);
    }
}
/* BGAM_SPEAR_END */
"""

sub("""    lg.resting=true;lg.vr=0;lg.afloat=false;   // v2.11.39: aground, not afloat
    logStats.landed++;
}
""",
"""    lg.resting=true;lg.vr=0;lg.afloat=false;   // v2.11.39: aground, not afloat
    logStats.landed++;
}
"""+BLOCK,'C1 spear system block')

io.open(P,'w',encoding='utf-8').write(s)
print('patch C written')
