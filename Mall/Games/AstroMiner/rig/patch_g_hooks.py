# patch_g_hooks.py — exec'd by patch_g.py (shares `s`, `sub`, `fn`, VER, TWIN).
# Where the rig meets the game: the four mesh builders, the four per-frame
# creature loops, the main loop, the [H] panel and the changelog.

# ---------------------------------------------------------------- the four mesh builders
sub('''    im=new THREE.InstancedMesh(FAUNA[sp].geo(),mat,MOB_CAP);
    im.frustumCulled=false;im.count=0;''', '''    im=new THREE.InstancedMesh(FAUNA[sp].geo(),mat,MOB_CAP);
    mobAnimAttach(im,MOB_CAP);                   // VTAG: legs, tails, heads
    im.frustumCulled=false;im.count=0;''', 'H1 land mesh')
sub('''    im=new THREE.InstancedMesh(def.geo(),mat,SEA_CAP);
    im.frustumCulled=false;im.count=0;''', '''    im=new THREE.InstancedMesh(def.geo(),mat,SEA_CAP);
    mobAnimAttach(im,SEA_CAP);                   // VTAG: the body wave, the fins
    im.frustumCulled=false;im.count=0;''', 'H2 sea mesh')
sub('''    im=new THREE.InstancedMesh(def.geo(),mat,CAVER_CAP);
    im.frustumCulled=false;im.count=0;''', '''    im=new THREE.InstancedMesh(def.geo(),mat,CAVER_CAP);
    mobAnimAttach(im,CAVER_CAP);                 // VTAG: wings, the ghost's hem
    im.frustumCulled=false;im.count=0;''', 'H3 cave mesh')
sub('''    const mesh=new THREE.InstancedMesh(geo,mat,GUARD_CAP);
    mesh.frustumCulled=false;mesh.count=0;''', '''    const mesh=new THREE.InstancedMesh(geo,mat,GUARD_CAP);
    mobAnimAttach(mesh,GUARD_CAP);               // VTAG: the march
    mesh.frustumCulled=false;mesh.count=0;''', 'H4 guard mesh')

# ---------------------------------------------------------------- land walkers
sub('''        let lift=0,sy=1;
        if(def.hop){
            m.hopT+=dt*4.5;
            const hopS=(m.vr>0.2)?0:Math.max(0,Math.sin(m.hopT));
            lift=hopS*0.35;sy=1+hopS*0.12;
        }else{
            m.walkT+=dt*(mult>0?5.0*Math.min(2,mult):0);
            sy=1+Math.sin(m.walkT)*0.035;
        }''', '''        let lift=0,sy=1,sxz=1,lean=0;
        const own=body.mobSp.get(m.sp);
        const aK=MOB_ANIM.k,rig=aK>0&&own&&own.userData.anim?own.geometry.userData.rig:null;
        if(def.hop){
            m.hopT+=dt*4.5;
            const hopS=(m.vr>0.2)?0:Math.max(0,Math.sin(m.hopT));
            lift=hopS*0.35;sy=1+hopS*0.12;
            if(aK>0){
                /* VTAG SQUASH AND STRETCH. The hopper has no limbs to animate:
                   it IS the limb. It crouches through the half of the cycle it
                   spends on the ground (which the shipped bounce held rigid) —
                   deepest just before take-off and just after landing — then
                   stretches and pitches nose-first into the hop. Volume is
                   kept: what it loses in height it gains across. Its origin is
                   its middle, `foot` above the ground, so the squash is paid
                   back in lift — it crouches ON the ground, not above it. */
                const crouch=(m.vr>0.2)?0:Math.max(0,-Math.sin(m.hopT));
                const sa=1+hopS*0.16-crouch*0.20;
                sy+=(sa-sy)*aK;
                sxz=1+(1/Math.sqrt(sa)-1)*aK;
                lean=aK*0.28*hopS;
                lift+=aK*(sa-1)*def.foot;
            }
        }else{
            m.walkT+=dt*(mult>0?5.0*Math.min(2,mult):0);
            sy=1+Math.sin(m.walkT)*0.035;
            if(rig){
                /* VTAG: the legs do the walking now (CREATURE ANIMATION). The
                   shipped squash fades out as the gait fades in, and the body
                   dips at each end of the stride instead (rig.bob, the swung
                   leg's own lift, which grows as stride squared) so the planted
                   feet stay on the ground — not while it swims. */
                mobAnimGait(m,rig,dt,mult>0?def.speed*mult:0,def.speed,m.wasWet);
                sy=1+(sy-1)*(1-aK);
                lift=-aK*m.aAmp*m.aAmp*rig.bob*(0.5-0.5*Math.cos(2*m.aPh))*(1-m.aSwim);
            }
        }''', 'H5 land pose')
sub('''        headingPoseQuat(_mUp,m.heading,_mQ,1);
        _mP.copy(m.pos).addScaledVector(_mUp,lift);
        _mS.set(1,sy,1);
        _mM.compose(_mP,_mQ,_mS);
        body._mobSlot[alive]=m;                       // v2.9.13
        /* ONE SLOT, MANY MESHES: the owner draws, every other species
           zero-scales the same index. */
        const own=body.mobSp.get(m.sp);
        for(const im of body.mobParts)im.setMatrixAt(alive,im===own?_mM:TREE_ZERO);''', '''        headingPoseQuat(_mUp,m.heading,_mQ,1);
        if(lean)_mQ.multiply(_mQ2.setFromAxisAngle(_rX,lean));   // VTAG: nose-first into the hop
        _mP.copy(m.pos).addScaledVector(_mUp,lift);
        _mS.set(sxz,sy,sxz);
        _mM.compose(_mP,_mQ,_mS);
        body._mobSlot[alive]=m;                       // v2.9.13
        /* ONE SLOT, MANY MESHES: the owner draws, every other species
           zero-scales the same index. (`own` is looked up above, with the
           pose, since VTAG.) */
        for(const im of body.mobParts)im.setMatrixAt(alive,im===own?_mM:TREE_ZERO);''', 'H6 land compose')
sub('''        if(own)own.setColorAt(alive,mobTint(m,def,_mC));
        alive++;
    }
    if(removed)body._mobsDirty=true;''', '''        if(own)own.setColorAt(alive,mobTint(m,def,_mC));
        if(rig)mobAnimWrite(own,alive,m);             // VTAG: gait phase, stride, swim
        alive++;
    }
    if(removed)body._mobsDirty=true;''', 'H7 land write')

# ---------------------------------------------------------------- swimmers
sub('''const spd=def.speed*(want?want.mult:(f.fleeT>0?def.fleeMult:1));''',
    '''const spd=def.speed*(want?want.mult:(f.fleeT>0?def.fleeMult:1));
            f.aV=spd;                                  // VTAG: the beat follows the speed''', 'H8 sea speed')
sub('''                _mM.compose(f.pos,_mQ,_mS.set(1,1,1));
                alive=writeSeaSlot(body,f,def,alive,_mM);
                continue;''', '''                _mM.compose(f.pos,_mQ,_mS.set(1,1,1));
                if(MOB_ANIM.k>0)seaAnim(body,f,def,dt,true);   // VTAG: it flops
                alive=writeSeaSlot(body,f,def,alive,_mM);
                continue;''', 'H9 sea stranded')
sub('''        headingPoseQuat(_mUp.copy(f.pos).normalize(),f.heading,_mQ,1);
        _mM.compose(f.pos,_mQ,_mS.set(1,1,1));
        alive=writeSeaSlot(body,f,def,alive,_mM);''', '''        headingPoseQuat(_mUp.copy(f.pos).normalize(),f.heading,_mQ,1);
        _mM.compose(f.pos,_mQ,_mS.set(1,1,1));
        if(MOB_ANIM.k>0)seaAnim(body,f,def,dt,false);  // VTAG: it swims
        alive=writeSeaSlot(body,f,def,alive,_mM);''', 'H10 sea pose')
sub(fn('writeSeaSlot'), '''function writeSeaSlot(body,f,def,alive,mat){
    body._fishSlot[alive]=f;
    const own=body.seaSp.get(f.sp||'fish');
    for(const im of body.seaParts)im.setMatrixAt(alive,im===own?mat:TREE_ZERO);
    if(own)own.setColorAt(alive,mobTint(f,def,_mC));
    if(own&&MOB_ANIM.k>0)mobAnimWrite(own,alive,f);   // VTAG
    return alive+1;
}
/* VTAG: one swimmer's beat. The rig is looked up through the mesh so a
   device that failed the gate (no anim attribute) never reaches it. */
function seaAnim(body,f,def,dt,stranded){
    const rig=mobRigOf(body.seaSp,f.sp||'fish');
    if(rig)mobAnimSwim(f,rig,dt,stranded?0:(f.aV||def.speed),def.speed,stranded);
}
''', 'H11 writeSeaSlot')

# ---------------------------------------------------------------- fliers
sub('''        c.bob+=dt*4.2;
        _mM.compose(_mP.copy(c.pos).addScaledVector(_mT1,Math.sin(c.bob)*0.08),_mQ,_mS.set(1,1,1));
        alive=writeCaverSlot(body,c,alive,_mM);''', '''        c.bob+=dt*4.2;
        let bob=Math.sin(c.bob)*0.08;
        const rig=MOB_ANIM.k>0?mobRigOf(body.caverSp,c.sp):null;
        if(rig){
            mobAnimSwim(c,rig,dt,spd,def.speed,false);
            /* VTAG: a flier rises on each downstroke, not on a clock of its own */
            if(rig.flapBob)bob+=(-rig.flapBob*Math.sin(c.aPh)-bob)*MOB_ANIM.k;
        }
        _mM.compose(_mP.copy(c.pos).addScaledVector(_mT1,bob),_mQ,_mS.set(1,1,1));
        alive=writeCaverSlot(body,c,alive,_mM);''', 'H12 cave pose')
sub(fn('writeCaverSlot'), '''function writeCaverSlot(body,c,alive,mat){
    body._caverSlot[alive]=c;
    const own=body.caverSp.get(c.sp);
    for(const im of body.caverParts)im.setMatrixAt(alive,im===own?mat:TREE_ZERO);
    if(own)own.setColorAt(alive,mobTint(c,CAVERN[c.sp],_mC));
    if(own&&MOB_ANIM.k>0)mobAnimWrite(own,alive,c);   // VTAG
    return alive+1;
}
''', 'H13 writeCaverSlot')

# ---------------------------------------------------------------- the garrison
sub('''        g.walkT+=dt*(advance!==0?5.5*Math.abs(advance):0);
        headingPoseQuat(_gUp,g.heading,_gQ,-1);
        _gP.copy(g.pos);
        _gM.compose(_gP,_gQ,V3(1,1+Math.sin(g.walkT)*0.03,1));
        body._guardSlot[alive]=g;
        mesh.setMatrixAt(alive,_gM);
        alive++;''', '''        g.walkT+=dt*(advance!==0?5.5*Math.abs(advance):0);
        headingPoseQuat(_gUp,g.heading,_gQ,-1);
        _gP.copy(g.pos);
        let gsy=1+Math.sin(g.walkT)*0.03;
        const aK=MOB_ANIM.k;
        if(aK>0&&mesh.userData.anim){
            /* VTAG: the march (buildGuardGeometry). A SIGNED speed, so the
               cycle runs backwards while a trooper backs off to its standoff;
               the patrol amble is its walking pace. */
            const rig=mesh.geometry.userData.rig;
            mobAnimGait(g,rig,dt,GUARD_SPEED*advance,GUARD_SPEED*0.45,false);
            gsy=1+(gsy-1)*(1-aK);
            _gP.addScaledVector(_gUp,-aK*g.aAmp*g.aAmp*rig.bob*(0.5-0.5*Math.cos(2*g.aPh)));
        }
        _gM.compose(_gP,_gQ,V3(1,gsy,1));
        body._guardSlot[alive]=g;
        mesh.setMatrixAt(alive,_gM);
        if(aK>0)mobAnimWrite(mesh,alive,g);          // VTAG
        alive++;''', 'H14 guard pose')

# ---------------------------------------------------------------- the main loop
sub("        $('v-fpshud').textContent=Math.round(1000/ms)+' fps';  // perpetual HUD readout — always live, panel or no panel",
    "        $('v-fpshud').textContent=Math.round(1000/ms)+' fps';  // perpetual HUD readout — always live, panel or no panel\n"
    "        mobAnimGovern(1000/ms,fpsNow-fpsWindowStart);   // VTAG: is this device still keeping up?",
    'H15 governor')
sub("    introCineStep(rawDt);",
    "    introCineStep(rawDt);\n"
    "    mobAnimTick(rawDt);        // VTAG: the creature-animation fade, once per frame",
    'H16 fade')

# ---------------------------------------------------------------- [H] panel status line
sub("        Green line = predicted trajectory\n    </div>",
    "        Green line = predicted trajectory<br><br>\n"
    "        <span id=\"animstat\" style=\"color:var(--dim)\"></span>\n    </div>",
    'H17 help status (desktop)')
sub("+'and the tractor beam&rsquo;s roll are keyboard-only.</span>';\n}\nfillTouchHelp();",
    "+'and the tractor beam&rsquo;s roll are keyboard-only.</span>'\n"
    "        +'<br><br><span id=\"animstat\" style=\"color:var(--dim)\"></span>';   // VTAG\n"
    "}\nfillTouchHelp();\nmobAnimShowStatus();   // VTAG: the touch card replaced the span the desktop panel carried",
    'H18 help status (touch)')

# ---------------------------------------------------------------- changelog
ENTRY = '''   VTAG: THEY WALK, SWIM AND FLAP — WHERE THE DEVICE CAN AFFORD IT.
            PLAYER BRIEF, VERBATIM: "add proper walking/swimming animations
            for all mobs, that only activate if the device is powerful
            enough". Same code as TWIN on the other line.

            BEFORE: every creature was one rigid merged mesh and a "walk" was
            the whole animal squashing 3.5% on a clock. The v2.13.8 knees and
            elbows were modelled and never bent.

            THE RIG IS IN THE GEOMETRY AND THE VERTEX SHADER (CREATURE
            ANIMATION, above the cavemen). Each part a builder pushes names
            the BONE it rides; mergeParts bakes that into an aBone attribute;
            the builder records each bone's pivot — the joint it already
            models — with an axis and a walk and a swim motion; the material's
            vertex shader turns each vertex about its chain of joints, child
            first, and swimmers add a travelling body wave. Per animal per
            frame the CPU writes three numbers (gait phase, stride, swim
            blend). Still ONE draw call per species, still instanced, and the
            REST POSE IS THE SHIPPED GEOMETRY BYTE FOR BYTE, so the raycast,
            the colliders, the facing and every AI number are untouched.

            WHO DOES WHAT.
              wolf, sabre    trot on the diagonals; paws fold on the forward
                             stroke; the long tail wags and whips. In water
                             they paddle, head up, tail streaming behind.
              bison, mammoth the four-beat walk of a heavy grazer; the
                             mammoth's trunk sways in a travelling wave, its
                             ears fan, and a drowning one lifts its trunk.
              caveman        hips, knees and arms in opposition, chest
                             counter-twist, the club swinging with his arm;
                             he treads water with big strokes and a kick.
              hopper         squash and stretch: crouches before each hop and
                             on landing, stretches and leans into the hop.
              fish, shark    a side-to-side wave nose to tail, faster and
                             wider when bolting; a stranded fish flops.
              dolphin, whale the same wave VERTICAL — cetaceans swim with
                             their flukes — and the flippers row.
              FoxBat         wings flap, tips a beat behind, body rising on
                             each downstroke.
              ghost          the hem ripples; the tatters trail and sway.
              troopers       they march — Reptilian knees forward, Mantid
                             insect legs — and walk BACKWARDS when they back
                             off to their standoff.
            Strides advance with DISTANCE covered, so feet do not skate; a
            bolting animal takes faster, longer strides; one that stops eases
            back to exactly its modelled pose.

            "POWERFUL ENOUGH" IS TWO GATES (MOB_ANIM). At boot: no software
            rasteriser, and at least 4 cores (6 on a phone) and 4 GB where the
            browser says — a device that fails never gets the rigged shader
            and draws its creatures exactly as before, at no cost. In play:
            the 500 ms fps window the HUD already reads; under 45 fps for 3 s
            stands the animation down with a half-second fade, 20 s over 55
            brings it back, three stand-downs and it stays off for the session.
            Not judged while the world streams in (8 s after starting, a warp
            or a landing), in the cockpit, the star chart or asleep. A driver
            that refuses the shader turns the animation off, never the
            animals. ?anim=1 / ?anim=0 force it either way; the state is at
            the foot of the [H] help panel.

'''
sub("           is a REAL stall and worth reporting.\n\n",
    "           is a REAL stall and worth reporting.\n\n" + ENTRY, 'H19 changelog')
