#!/usr/bin/env python3
"""v2.12.40 patch B: the shape a spear is, the heap row it becomes, and the
ONE statement of 'is this point under water'."""
import io

P='/home/claude/work/Bleaux_v2_12_40.html'
s=io.open(P,encoding='utf-8').read()

def sub(old,new,label):
    global s
    n=s.count(old)
    assert n==1, 'ANCHOR %s occurs %d times, expected 1'%(label,n)
    s=s.replace(old,new,1)
    print('  ok  '+label)

# ---- B1  the geometry, declared before the table that names it -------------
sub("""/* v2.11.44: A LOG AND A STICK BUNDLE ARE THE SAME OBJECT WITH DIFFERENT
   GEOMETRY.""",
"""/* ---- v2.12.40 THE SPEAR'S OWN SHAPE ----------------------------------
   SIZED BY THE RECIPE, NOT PICKED. The brief buys the shaft with TWO sticks,
   and BUNDLE_LEN is this file's statement of what one stick-length unit is
   (v2.11.44), so a two-stick shaft is 2*BUNDLE_LEN and the number moves if
   that unit ever does. The section is BUNDLE_STICK_T's — a shaft is a stick's
   thickness, which is the same reason LOG_RAD is BUNDLE_RAD further down.
   Neither figure is a free choice and neither is restated anywhere else.
   ONE MESH, ONE MATERIAL, because attachLog builds every heap as
   `new Mesh(kind.geo(len,rad), builtMatFor(kind.mat))` and a second material
   would have meant a second spawner. The head reads as a head by SHAPE — a
   four-sided pyramid, which is what a knapped flake bound to a stick looks
   like — rather than by colour, and MAT.spear's own hue already splits haft
   and flint (see defMat). Merged and CACHED by the same key/Map idiom
   logGeometry and bundleGeometry use, so every spear in the world shares one
   buffer. */
const SPEAR_LEN=BUNDLE_LEN*2;                    // the recipe's two sticks, end to end
const SPEAR_RAD=BUNDLE_STICK_T;                  // a shaft is a stick's section
const SPEAR_GEO_CACHE=new Map();
function spearGeometry(len,rad){
    const key=len.toFixed(2)+':'+rad.toFixed(2);
    let g=SPEAR_GEO_CACHE.get(key);
    if(g)return g;
    /* +Y is the point. The heap system's own axis convention (logGeometry is a
       CylinderGeometry, whose axis is Y), so a spear born with a quaternion
       taking +Y onto its flight direction is nose-first with no second rule. */
    const headL=len*0.18, shaftL=len-headL;
    const shaft=new THREE.CylinderGeometry(rad,rad,shaftL,8,1);
    shaft.translate(0,shaftL*0.5-len*0.5,0);
    const head=new THREE.ConeGeometry(rad*2.6,headL,4,1);
    head.translate(0,len*0.5-headL*0.5,0);
    /* the binding: a short collar of larger section where the two meet, which
       is the rope the recipe spends and the only part of the object that is
       neither stick nor stone. */
    const lash=new THREE.CylinderGeometry(rad*1.7,rad*1.7,len*0.06,8,1);
    lash.translate(0,len*0.5-headL-len*0.02,0);
    g=mergeGeometries([shaft,head,lash]);
    shaft.dispose();head.dispose();lash.dispose();
    SPEAR_GEO_CACHE.set(key,g);
    return g;
}
/* v2.11.44: A LOG AND A STICK BUNDLE ARE THE SAME OBJECT WITH DIFFERENT
   GEOMETRY.""",'B1 spearGeometry')

# ---- B2  the LOG_KINDS row -------------------------------------------------
sub("""    flint :{noun:'flint rock', mat:'flint', geo:flintRockGeometry,
            len:FLINT_SIZE, rad:FLINT_SIZE/2, pocket:true},""",
"""    flint :{noun:'flint rock', mat:'flint', geo:flintRockGeometry,
            len:FLINT_SIZE, rad:FLINT_SIZE/2, pocket:true},
    /* v2.12.40: A SPEAR THAT HAS COME DOWN. The whole of \"you can go and get
       it back\" is these four fields, and not one line of the heap system is
       edited to make them true — the fall, the settle, the flotation, the
       tractor beam, mining it, saving it and the [F] prompt all arrive with the
       row, exactly as v2.11.44 promised the next carryable heap would and as
       v2.12.35 and v2.12.39 have each since collected. `pocket` for the reason
       the coal lump and the flint rock carry it: a 2 u shaft is a thing you
       pick UP, not a three-metre trunk you shoulder.
       NO burnKey and no burnsTo, and that is a real decision rather than an
       omission: a spear left lying in the fire it was thrown past does not
       become a lump of coal, because losing a tool to a grass fire you lit is
       a punishment nothing in the brief asks for. Flint's row makes the same
       call for the same shape of reason. */
    spear :{noun:'spear',      mat:'spear', geo:spearGeometry,
            len:SPEAR_LEN, rad:SPEAR_RAD, pocket:true},""",'B2 LOG_KINDS spear row')

# ---- B3  ONE statement of "is this body-local point under water" -----------
sub("""/* which water body owns the column at this body-local point?""",
"""/* v2.12.40: IS THIS POINT UNDER WATER? ONE STATEMENT, AND IT ALREADY HAD
   THREE READERS BEFORE THE SPEAR NEEDED A FOURTH.
   The pair \"strict local-ocean read, then below its level by the 0.15 skin\"
   was written out twice — once inline in updatePlayerOnFoot (\"is Bleaux
   swimming\") and once as caveWaterAt (\"has the flood reached here\") — and both
   copies carried their own note explaining the strict flag. A THIRD copy for a
   spear in flight is the point at which two copies stop being a coincidence, so
   the rule moves here and the two existing sites read it. It returns the OCEAN
   rather than a boolean because the swim check needs the object (level, FX) and
   a caller that only wants the question answered can coerce it — a predicate
   that threw the answer away would have forced the swim check to keep its own
   copy, which is the whole thing this consolidation exists to stop.
   NOT a behaviour change: both readers asked exactly this, and the suite
   asserts all three agree on the same point. */
const OCEAN_SKIN=0.15;    // the surface tolerance both former copies stated
function pointSubmerged(body,lp){
    if(!body||!body.oceans)return null;
    const oc=oceanAtLocal(body,lp,true,true);   // strict: see oceanAtLocal's header
    return (oc&&lp.length()<oc.level-OCEAN_SKIN)?oc:null;
}
/* which water body owns the column at this body-local point?""",'B3 pointSubmerged')

sub("""function caveWaterAt(body,lp){
    if(!body.oceans)return false;
    const oc=oceanAtLocal(body,lp,true,true);
    return !!(oc&&lp.length()<oc.level-0.15);
}""",
"""function caveWaterAt(body,lp){
    return !!pointSubmerged(body,lp);   // v2.12.40: the rule moved, the question did not
}""",'B4 caveWaterAt delegates')

sub("""    let localOcean=null;
    if(activeBody.type==='earthlike'&&activeBody.oceans){
        const plp=player.position.clone().sub(activeBody.position);   // v2.9.2 absolute->body-local
        const oc=oceanAtLocal(activeBody,plp,true,true);   // v2.12.13: strict — a dry, unconnected
        // mineshaft must never read as \"swimming\" just because it's deep; see oceanAtLocal's header
        if(oc&&plp.length()<oc.level-0.15)localOcean=oc;
    }""",
"""    let localOcean=null;
    if(activeBody.type==='earthlike'){
        /* v2.12.40: through pointSubmerged, which IS the v2.12.13 strict read
           plus the 0.15 skin this site used to spell out — see its header for
           why a dry, unconnected mineshaft must never read as \"swimming\". */
        localOcean=pointSubmerged(activeBody,
            player.position.clone().sub(activeBody.position));   // v2.9.2 absolute->body-local
    }""",'B5 player swim check reads pointSubmerged')

io.open(P,'w',encoding='utf-8').write(s)
print('patch B written')
