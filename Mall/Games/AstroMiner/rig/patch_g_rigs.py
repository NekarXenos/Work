# patch_g_rigs.py — exec'd by patch_g.py (shares `s`, `sub`, `fn`, VER).
# The species rigs. Every builder pushes its parts in EXACTLY the shipped order
# with the shipped numbers, so the merged rest pose is byte-identical; all that
# is added is a `b` on each part and the bone table beside it.

def edit(text, old, new, label):
    n = text.count(old)
    assert n == 1, 'EDIT %s occurs %d times in its function, expected 1' % (label, n)
    return text.replace(old, new.replace('VTAG', VER), 1)

# ---------------------------------------------------------------- quadruped
q = fn('quadruped')
q2 = edit(q, '''       species' extras hang off the head it actually has. */
    const P=[];
    const lh=o.leg, by=lh+o.bodyH/2, hz=o.bodyL/2, b=(o.bend||0.10)*lh;
    const hoof=o.hoof===undefined?o.limb:o.hoof;
    P.push(''', '''       species' extras hang off the head it actually has.
       VTAG THE GAIT (see CREATURE ANIMATION). Each leg is three bones laid on
       the chain jointLimb already builds, so the modelled joints ARE the
       pivots: UPPER turns at the shoulder / hip and swings the leg fore and
       aft; LOWER (elbow / knee) and FOOT (wrist / hock) only FOLD, and only
       while that foot is in the air — a rectified wave a quarter-cycle ahead
       of the swing — which is what lifts a paw clear instead of dragging it.
       `gait` is the timing: 'trot' moves the diagonal pairs together (wolf,
       sabre), 'walk' is the four-beat lateral sequence of a heavy grazer
       (bison, mammoth). `swing` and `flex` are the upper-leg sweep and the
       fold, in radians at full stride. In water the same bones paddle: fore
       legs alternate in long strokes, hind legs kick, the head comes up
       (`swimHead`). EVERY FOLD SHORTENS THE LEG: the modelled legs zig-zag
       (elbow back, wrist forward; knee forward, hock back), so each joint
       folds the way that deepens its own zig-zag — forearm forward and paw
       back under it, shank back and paw forward — as a real elbow, carpus,
       stifle and hock do. Folding the other way first STRAIGHTENS a joint,
       which lengthens the leg and drives the paw into the ground (measured:
       8 cm on the wolf's late swing before this was put right).
       rig.cyc — ground covered per radian of gait — is the leg's own
       2·L·swing/π, so a mammoth lumbers and a wolf patters at their shipped
       speeds without skating. A trot plants its feet with the measured body
       dip (rig.plant, rigFootLift); a four-beat walk has no single stride
       angle to match, so a grazer's short swing is all it gets. P.hb is the
       head bone: every extra a species hangs on the head names it. */
    const P=[];
    const lh=o.leg, by=lh+o.bodyH/2, hz=o.bodyL/2, b=(o.bend||0.10)*lh;
    const hoof=o.hoof===undefined?o.limb:o.hoof;
    const S=o.swing||0.4, K=o.flex||0.7, trot=o.gait==='trot', PI=Math.PI, Q=PI/2;
    const R=rigNew(2*by*S/PI);R.plant=trot;
    P.push(''', 'quadruped head')
q2 = edit(q2, '''        const heel=(o.heel||0.34)*lh, hf=zh-b*0.2;           // hock height, hind foot z
        jointLimb(P,[V3(x,by-o.bodyH*0.05,zf),V3(x,lh*0.78,zf-b),V3(x,lh*0.18,zf-b*0.3),V3(x,o.legW*0.22,zf+b*0.1)],
                  [r0,r1,r2,r2*0.9],o.limb);
        jointLimb(P,[V3(x,by-o.bodyH*0.05,zh),V3(x,lh*0.85,zh+b*0.9),V3(x,heel,zh-b*1.4),V3(x,o.legW*0.22,hf)],
                  [r0*1.1,r1,r2,r2*0.9],o.limb);
        P.push({geo:_fIco(1),matrix:M(x,o.legW*0.22,zf+b*0.1+o.legW*0.12,0,0,0,o.legW*0.5,o.legW*0.28,o.legW*0.62),color:hoof});
        P.push({geo:_fIco(1),matrix:M(x,o.legW*0.22,hf+o.legW*0.12,0,0,0,o.legW*0.5,o.legW*0.28,o.legW*0.62),color:hoof});
    }''', '''        const heel=(o.heel||0.34)*lh, hf=zh-b*0.2;           // hock height, hind foot z
        const F=[V3(x,by-o.bodyH*0.05,zf),V3(x,lh*0.78,zf-b),V3(x,lh*0.18,zf-b*0.3),V3(x,o.legW*0.22,zf+b*0.1)];
        const H=[V3(x,by-o.bodyH*0.05,zh),V3(x,lh*0.85,zh+b*0.9),V3(x,heel,zh-b*1.4),V3(x,o.legW*0.22,hf)];
        /* VTAG phases: a trot pairs the diagonals (fore-left with hind-right);
           a walk puts each fore foot a quarter-cycle after its own hind foot.
           A leg swings at gait phase = -its offset, so LATER is a SMALLER
           offset (the suite caught the first cut walking the diagonal
           sequence). A negative turn about X swings a hanging leg's foot
           FORWARD. */
        const Lf=sx>0;
        const pf=trot?(Lf?0:PI):(Lf?PI+Q:Q), ph=trot?(Lf?PI:0):(Lf?0:PI);
        const sf=Lf?0:PI, sh=sf+Q;                             // the paddle
        const f1=rigBone(R,F[0],0,_rX,_rw(-S,pf),_rw(-S*1.5,sf));
        const f2=rigBone(R,F[1],f1,_rX,_rr(-K*0.65,pf+Q),_rr(-K*0.8,sf+Q));
        const f3=rigBone(R,F[2],f2,_rX,_rr(K*0.95,pf+Q),_rr(K,sf+Q));
        const h1=rigBone(R,H[0],0,_rX,_rw(-S,ph),_rw(-S*0.8,sh));
        const h2=rigBone(R,H[1],h1,_rX,_rr(K*0.6,ph+Q),_rr(K*0.5,sh+Q));
        const h3=rigBone(R,H[2],h2,_rX,_rr(-K*0.8,ph+Q),_rr(-K*0.6,sh+Q));
        jointLimb(P,F,[r0,r1,r2,r2*0.9],o.limb,undefined,[f1,f2,f3]);
        jointLimb(P,H,[r0*1.1,r1,r2,r2*0.9],o.limb,undefined,[h1,h2,h3]);
        P.push({geo:_fIco(1),matrix:M(x,o.legW*0.22,zf+b*0.1+o.legW*0.12,0,0,0,o.legW*0.5,o.legW*0.28,o.legW*0.62),color:hoof,b:f3});
        P.push({geo:_fIco(1),matrix:M(x,o.legW*0.22,hf+o.legW*0.12,0,0,0,o.legW*0.5,o.legW*0.28,o.legW*0.62),color:hoof,b:h3});
    }''', 'quadruped legs')
q2 = edit(q2, '''    const headY=by+o.headUp, headZ=hz+o.headL*0.42;
    P.push(_fSeg(V3(0,by+o.bodyH*0.12,hz-o.bodyL*0.12),V3(0,headY,headZ),
                 Math.min(o.bodyW,o.bodyH)*0.36,Math.min(o.headW,o.headH)*0.40,o.hide,6));   // neck
    P.push({geo:_fIco(1),matrix:M(0,headY,headZ,0,0,0,o.headW*0.62,o.headH*0.62,o.headL*0.62),color:o.hide});''',
'''    const headY=by+o.headUp, headZ=hz+o.headL*0.42;
    /* VTAG: the head turns at the root of the neck — it nods twice a stride,
       once per footfall, and lifts clear of the water to swim */
    const neck0=V3(0,by+o.bodyH*0.12,hz-o.bodyL*0.12);
    const hb=rigBone(R,neck0,0,_rX,_rw(o.nod||0.06,0,2),_rw(0.04,0,2,-(o.swimHead||0.35)));
    const nk=_fSeg(neck0,V3(0,headY,headZ),
                 Math.min(o.bodyW,o.bodyH)*0.36,Math.min(o.headW,o.headH)*0.40,o.hide,6);   // neck
    nk.b=hb;P.push(nk);
    P.push({geo:_fIco(1),matrix:M(0,headY,headZ,0,0,0,o.headW*0.62,o.headH*0.62,o.headL*0.62),color:o.hide,b:hb});''',
    'quadruped neck')
q2 = edit(q2, '''    if(o.longTail){
        const H=o.bodyH,L=o.bodyL,w=o.legW;
        jointLimb(P,[V3(0,by+H*0.22,-hz*0.92),V3(0,by+H*0.06,-hz-L*0.13),V3(0,by-H*0.45,-hz-L*0.22),
                     V3(0,by-H*0.95,-hz-L*0.22),V3(0,by-H*1.20,-hz-L*0.30)],
                  [w*0.32,w*0.36,w*0.34,w*0.28,w*0.14],o.limb);
    }else
        jointLimb(P,[V3(0,by+o.bodyH*0.22,-hz*0.92),V3(0,by+o.bodyH*0.02,-hz-o.bodyL*0.10),V3(0,by-o.bodyH*0.38,-hz-o.bodyL*0.14)],
                  [o.legW*0.30,o.legW*0.24,o.legW*0.12],o.limb);
    P.by=by;P.headY=headY;P.headZ=headZ;
    return P;''', '''    /* VTAG: a tail WAGS from its root (about Y), LIFTS from its second joint
       (about X — straight out behind in the water, where a real one floats)
       and whips down its length with a lag at every joint; the joints that
       HANG swing about the forward axis, because a turn about the vertical
       barely moves a segment that points straight down. */
    if(o.longTail){
        const H=o.bodyH,L=o.bodyL,w=o.legW;
        const T=[V3(0,by+H*0.22,-hz*0.92),V3(0,by+H*0.06,-hz-L*0.13),V3(0,by-H*0.45,-hz-L*0.22),
                 V3(0,by-H*0.95,-hz-L*0.22),V3(0,by-H*1.20,-hz-L*0.30)];
        const t1=rigBone(R,T[0],0,_rY,_rw(0.16,0),_rw(0.10,0));
        const t2=rigBone(R,T[1],t1,_rX,_rw(0.10,-0.6,2,0.15),_rw(0.06,-0.6,1,1.1));
        const t3=rigBone(R,T[2],t2,_rZ,_rw(0.20,-1.2),_rw(0.15,-1.2));
        const t4=rigBone(R,T[3],t3,_rZ,_rw(0.26,-1.9),_rw(0.18,-1.9));
        jointLimb(P,T,[w*0.32,w*0.36,w*0.34,w*0.28,w*0.14],o.limb,undefined,[t1,t2,t3,t4]);
    }else{
        const T=[V3(0,by+o.bodyH*0.22,-hz*0.92),V3(0,by+o.bodyH*0.02,-hz-o.bodyL*0.10),V3(0,by-o.bodyH*0.38,-hz-o.bodyL*0.14)];
        const t1=rigBone(R,T[0],0,_rY,_rw(0.22,0),_rw(0.18,0));
        const t2=rigBone(R,T[1],t1,_rX,_rw(0.14,-0.9),_rw(0.08,-0.9,1,0.7));
        jointLimb(P,T,[o.legW*0.30,o.legW*0.24,o.legW*0.12],o.limb,undefined,[t1,t2]);
    }
    P.by=by;P.headY=headY;P.headZ=headZ;
    P.rig=R;P.hb=hb;
    return P;''', 'quadruped tail')
sub(q, q2, 'G4 quadruped rig')

# ---------------------------------------------------------------- the four quadrupeds
sub(fn('wolfGeo'), r'''function wolfGeo(){
    const o={leg:0.52,bodyW:0.42,bodyH:0.40,bodyL:0.95,legW:0.13,bend:0.13,heel:0.50,longTail:true,
             headW:0.30,headH:0.30,headL:0.34,headUp:0.14,hide:0x6e6e78,limb:0x4a4a54,
             gait:'trot',swing:0.45,flex:0.95,swimHead:0.45};                 // VTAG: a springy trot
    const P=quadruped(o);
    const hy=P.headY,hz=P.headZ,hb=P.hb;
    P.push({geo:_fIco(1),matrix:M(0,hy-0.05,hz+0.22,0,0,0,0.09,0.08,0.16),color:0x3a3a42,b:hb});   // muzzle
    P.push({geo:_fIco(0.035),matrix:M(0,hy-0.01,hz+0.37),color:0x1c1c20,b:hb});                    // nose
    for(const sx of [-1,1])
        P.push({geo:new THREE.ConeGeometry(0.07,0.18,4),
                matrix:M(sx*0.09,hy+0.20,hz-0.04,-0.15,0,-sx*0.2),color:0x4a4a54,b:hb});          // ears
    return rigged(P);
}
''', 'G5 wolf')

sub(fn('bisonGeo'), r'''function bisonGeo(){
    const o={leg:0.80,bodyW:0.86,bodyH:0.82,bodyL:1.70,legW:0.23,bend:0.08,hoof:0x241810,
             headW:0.54,headH:0.50,headL:0.50,headUp:-0.16,hide:0x5a3a26,limb:0x3b271a,
             gait:'walk',swing:0.26,flex:1.0,nod:0.05};                      // VTAG: a grazer's four-beat walk
    const P=quadruped(o);
    const by=P.by,hy=P.headY,hz=P.headZ,hb=P.hb;
    P.push({geo:_fIco(1,1),matrix:M(0,by+0.26,0.36,0,0,0,0.46,0.40,0.62),color:0x4a2f1e});   // shoulder hump
    P.push({geo:_fIco(1),matrix:M(0,hy+0.12,hz-0.06,0,0,0,0.30,0.20,0.26),color:0x4a2f1e,b:hb});  // shaggy poll
    P.push({geo:_fIco(1),matrix:M(0,hy-0.26,hz+0.02,0,0,0,0.13,0.14,0.12),color:0x3b271a,b:hb});  // beard
    /* HORNS: rooted on the top sides of the skull, out SIDEWAYS first, then
       curving UP and FORWARD — tips finish in front of the root and a little
       inboard, the way a bison's hook does. */
    for(const sx of [-1,1]){
        const x0=sx*0.20,y0=hy+0.16,z0=hz-0.02;
        P.push({geo:curvedHorn([V3(x0,y0,z0),V3(x0+sx*0.16,y0+0.01,z0),V3(x0+sx*0.29,y0+0.08,z0+0.03),
                                V3(x0+sx*0.33,y0+0.22,z0+0.11),V3(x0+sx*0.28,y0+0.32,z0+0.21)],0.075),
                matrix:_I4,color:0xd9cdb0,b:hb});
    }
    return rigged(P);
}
''', 'G6 bison')

sub(fn('mammothGeo'), r'''function mammothGeo(){
    const o={leg:1.10,bodyW:1.24,bodyH:1.22,bodyL:2.10,legW:0.34,bend:0.05,hoof:0x3e2414,
             headW:0.86,headH:0.84,headL:0.78,headUp:0.10,hide:0x7a4a2a,limb:0x5e3820,
             gait:'walk',swing:0.20,flex:0.85,nod:0.04};                       // VTAG: columns, not springs
    const P=quadruped(o),R=P.rig;
    const by=P.by,hy=P.headY,hz=P.headZ,hb=P.hb;
    P.push({geo:_fIco(1,1),matrix:M(0,by+0.38,0.25,0,0,0,0.62,0.44,0.70),color:0x8a5730});   // shoulder mass
    P.push({geo:_fIco(1),matrix:M(0,hy+0.34,hz-0.08,0,0,0,0.36,0.30,0.34),color:0x8a5730,b:hb});  // domed skull
    // trunk: a jointed chain hanging down and curling forward at the tip
    /* VTAG: four bones down the trunk, alternately lifting (about X) and
       swaying (about Z — it hangs, so a turn about the vertical would not move
       it), each a little behind the one above: a wave runs down it as he
       walks. In water the lifting joints curl it up and forward — a drowning
       mammoth raises its trunk to breathe. */
    const K=[V3(0,hy-0.02,hz+0.36),V3(0,hy-0.46,hz+0.52),V3(0,hy-0.90,hz+0.50),
             V3(0,hy-1.16,hz+0.40),V3(0,hy-1.28,hz+0.52)];
    const k1=rigBone(R,K[0],hb,_rX,_rw(0.06,0),_rw(0.05,0,1,-0.55));
    const k2=rigBone(R,K[1],k1,_rZ,_rw(0.14,-0.9),_rw(0.10,-0.9));
    const k3=rigBone(R,K[2],k2,_rX,_rw(0.12,-1.8),_rw(0.10,-1.8,1,-0.85));
    const k4=rigBone(R,K[3],k3,_rZ,_rw(0.22,-2.7),_rw(0.20,-2.7));
    jointLimb(P,K,[0.19,0.15,0.12,0.09,0.07],0x6b4024,undefined,[k1,k2,k3,k4]);
    /* TUSKS: rooted either side of the mouth, run DOWN and OUTWARD, curve
       FORWARD, then sweep UP and back INWARD so the tips close toward each
       other in front of the trunk. */
    for(const sx of [-1,1]){
        const x0=sx*0.22,y0=hy-0.30,z0=hz+0.26;
        P.push({geo:curvedHorn([V3(x0,y0,z0),V3(x0+sx*0.13,y0-0.34,z0+0.12),V3(x0+sx*0.28,y0-0.66,z0+0.44),
                                V3(x0+sx*0.28,y0-0.70,z0+0.86),V3(x0+sx*0.17,y0-0.44,z0+1.18),
                                V3(x0+sx*0.03,y0-0.12,z0+1.26)],0.10,10,6),
                matrix:_I4,color:0xefe6cf,b:hb});
    }
    /* VTAG: the ears hinge at their front edge and fan out and back */
    for(const sx of [-1,1])                                                          // ears
        P.push({geo:_fIco(1),matrix:M(sx*0.44,hy+0.06,hz-0.22,0,sx*0.3,0,0.06,0.28,0.22),color:0x6b4024,
                b:rigBone(R,V3(sx*0.50,hy+0.06,hz-0.02),hb,_rY,_rw(-sx*0.14,0),_rw(-sx*0.22,0,2))});
    return rigged(P);
}
''', 'G7 mammoth')

sub(fn('sabreGeo'), r'''function sabreGeo(){
    const o={leg:0.62,bodyW:0.56,bodyH:0.52,bodyL:1.26,legW:0.17,bend:0.12,heel:0.50,longTail:true,
             headW:0.42,headH:0.40,headL:0.42,headUp:0.16,hide:0xf0f0f2,limb:0xdcdce6,
             gait:'trot',swing:0.42,flex:0.9,swimHead:0.40};                 // VTAG: a cat's trot
    const P=quadruped(o);
    const hy=P.headY,hz=P.headZ,hb=P.hb;
    P.push({geo:new THREE.IcosahedronGeometry(0.40,0),
            matrix:M(0,hy-0.02,hz-0.26,0,0,0,0.85,0.85,0.75),color:0xe2e2ee,b:hb});       // mane
    P.push({geo:_fIco(1),matrix:M(0,hy-0.06,hz+0.18,0,0,0,0.14,0.11,0.12),color:0xf0f0f2,b:hb}); // muzzle
    P.push({geo:_fIco(0.04),matrix:M(0,hy,hz+0.30),color:0x5a4a4a,b:hb});                      // nose
    for(const sx of [-1,1])
        P.push({geo:new THREE.ConeGeometry(0.07,0.14,4),
                matrix:M(sx*0.13,hy+0.24,hz-0.02),color:0xdcdce6,b:hb});                     // ears
    /* SABRES: rooted at the front corners of the mouth, straight DOWN first,
       then curving DOWN and BACK — the tips finish behind the root. */
    for(const sx of [-1,1]){
        const x0=sx*0.075,y0=hy-0.12,z0=hz+0.24;
        P.push({geo:curvedHorn([V3(x0,y0,z0),V3(x0+sx*0.005,y0-0.10,z0+0.015),V3(x0+sx*0.01,y0-0.20,z0),
                                V3(x0+sx*0.012,y0-0.28,z0-0.05),V3(x0+sx*0.012,y0-0.33,z0-0.12)],0.036,8,5),
                matrix:_I4,color:0xfffdf0,b:hb});
    }
    return rigged(P);
}
''', 'G8 sabre')

# ---------------------------------------------------------------- caveman
c = fn('cavemanGeo')
c2 = edit(c, '''    const skin=0x8a6242,fur=0x6b5236,hair=0x2b2119,wood=0x6b4426,stone=0x8d8d95;
    const P=[''', '''    const skin=0x8a6242,fur=0x6b5236,hair=0x2b2119,wood=0x6b4426,stone=0x8d8d95;
    /* VTAG THE WALK. Hips swing the legs and each knee folds on its forward
       stroke; each arm swings against its own leg — in step with the other
       one — elbow bending as it comes forward, the club riding the right
       forearm; the chest counter-twists over the kilt and the head nods
       twice a stride. In water he treads it: long alternating arm strokes,
       a quick flutter kick, chin up. The ankle is two joints at one pivot:
       the first turns against the hip, so the foot stays FLAT through the
       stance instead of rocking onto its toe (which is also what lets the
       measured body dip plant it, rig.plant); the second turns against the
       knee, so the toe CLEARS the ground on the swing instead of being tipped
       into it — measured 4 cm deep before it was there. */
    const R=rigNew(2*0.74*0.45/Math.PI),PI=Math.PI,Q=PI/2;
    R.plant=true;
    const chest=rigBone(R,V3(0,0.86,0),0,_rY,_rw(0.07,0),_rw(0.06,0));
    const head=rigBone(R,V3(0,1.40,0),chest,_rX,_rw(0.05,0,2),_rw(0.04,0,2,-0.15));
    const leg={},arm={};
    for(const sx of [-1,1]){
        const ph=sx>0?0:PI;
        const thigh=rigBone(R,V3(sx*0.12,0.74,0),0,_rX,_rw(-0.45,ph),_rw(-0.35,ph,2));
        const shin=rigBone(R,V3(sx*0.13,0.40,0.06),thigh,_rX,_rr(0.8,ph+Q),_rr(0.5,ph+Q,2));
        const ankle=rigBone(R,V3(sx*0.13,0.08,0),shin,_rX,_rw(0.45,ph),_rw(0.35,ph,2));
        leg[sx]=[thigh,shin,rigBone(R,V3(sx*0.13,0.08,0),ankle,_rX,_rr(-0.8,ph+Q),_rr(-0.5,ph+Q,2))];
    }
    for(const [sx,sh,el,sw] of [[1,V3(0.27,1.32,0),V3(0.36,1.06,-0.08),0.22],     // club arm: a shorter swing
                                [-1,V3(-0.27,1.32,0),V3(-0.34,1.06,-0.05),0.32]]){
        const ph=(sx>0?0:PI)+PI;
        const up=rigBone(R,sh,chest,_rX,_rw(-sw,ph),_rw(-1.1,ph));
        arm[sx]=[up,rigBone(R,el,up,_rX,_rr(-0.25,ph+Q),_rr(-0.6,ph+Q))];
    }
    const P=[''', 'caveman rig')
for old, new, label in [
    ("{geo:_fIco(1),matrix:M(0,0.98,0,0,0,0,0.21,0.22,0.16),color:skin},",
     "{geo:_fIco(1),matrix:M(0,0.98,0,0,0,0,0.21,0.22,0.16),color:skin,b:chest},", 'belly'),
    ("{geo:_fIco(1),matrix:M(0,1.22,0,0,0,0,0.29,0.22,0.19),color:skin},",
     "{geo:_fIco(1),matrix:M(0,1.22,0,0,0,0,0.29,0.22,0.19),color:skin,b:chest},", 'ribcage'),
    ("{geo:_fBox(0.52,0.10,0.32),matrix:M(0,1.20,0,0,0,0.35),color:fur},",
     "{geo:_fBox(0.52,0.10,0.32),matrix:M(0,1.20,0,0,0,0.35),color:fur,b:chest},", 'strap'),
    ("{geo:new THREE.CylinderGeometry(0.07,0.08,0.14,5),matrix:M(0,1.43,0),color:skin},",
     "{geo:new THREE.CylinderGeometry(0.07,0.08,0.14,5),matrix:M(0,1.43,0),color:skin,b:head},", 'neck'),
    ("{geo:_fIco(1),matrix:M(0,1.60,0.01,0,0,0,0.17,0.19,0.18),color:skin},",
     "{geo:_fIco(1),matrix:M(0,1.60,0.01,0,0,0,0.17,0.19,0.18),color:skin,b:head},", 'head'),
    ("{geo:_fBox(0.30,0.07,0.10),matrix:M(0,1.66,0.15),color:hair},",
     "{geo:_fBox(0.30,0.07,0.10),matrix:M(0,1.66,0.15),color:hair,b:head},", 'brow'),
    ("{geo:_fBox(0.10,0.11,0.13),matrix:M(0,1.57,0.20),color:skin},",
     "{geo:_fBox(0.10,0.11,0.13),matrix:M(0,1.57,0.20),color:skin,b:head},", 'nose'),
    ("{geo:_fIco(1),matrix:M(0,1.72,-0.04,0,0,0,0.19,0.13,0.17),color:hair},",
     "{geo:_fIco(1),matrix:M(0,1.72,-0.04,0,0,0,0.19,0.13,0.17),color:hair,b:head},", 'hair'),
    ("{geo:_fIco(1),matrix:M(0,1.48,0.13,0,0,0,0.12,0.09,0.07),color:hair},",
     "{geo:_fIco(1),matrix:M(0,1.48,0.13,0,0,0,0.12,0.09,0.07),color:hair,b:head},", 'beard'),
    ("{geo:_fBox(0.09,0.46,0.09),matrix:M(0.40,1.00,0.20,0.55,0,0.12),color:wood},",
     "{geo:_fBox(0.09,0.46,0.09),matrix:M(0.40,1.00,0.20,0.55,0,0.12),color:wood,b:arm[1][1]},", 'haft'),
    ("{geo:_fIco(0.13),matrix:M(0.46,1.20,0.40,0.55,0,0.12,1,1.1,1),color:stone},",
     "{geo:_fIco(0.13),matrix:M(0.46,1.20,0.40,0.55,0,0.12,1,1.1,1),color:stone,b:arm[1][1]},", 'club head'),
    ('''        jointLimb(P,[V3(sx*0.12,0.74,0),V3(sx*0.13,0.40,0.06),V3(sx*0.13,0.08,0)],
                  [0.095,0.075,0.06],skin);
        P.push({geo:_fIco(1),matrix:M(sx*0.13,0.05,0.05,0,0,0,0.08,0.05,0.13),color:skin});   // foot''',
     '''        jointLimb(P,[V3(sx*0.12,0.74,0),V3(sx*0.13,0.40,0.06),V3(sx*0.13,0.08,0)],
                  [0.095,0.075,0.06],skin,undefined,leg[sx]);
        P.push({geo:_fIco(1),matrix:M(sx*0.13,0.05,0.05,0,0,0,0.08,0.05,0.13),color:skin,b:leg[sx][2]});   // foot, level from heel-strike to toe-off''', 'legs'),
    ('''    jointLimb(P,[V3(0.27,1.32,0),V3(0.36,1.06,-0.08),V3(0.41,0.90,0.14)],[0.075,0.06,0.05],skin);
    jointLimb(P,[V3(-0.27,1.32,0),V3(-0.34,1.06,-0.05),V3(-0.34,0.84,0.08)],[0.075,0.06,0.05],skin);
    for(const h of [V3(0.41,0.90,0.14),V3(-0.34,0.84,0.08)])
        P.push({geo:_fIco(0.065),matrix:M(h.x,h.y,h.z),color:skin});                        // fists
    return mergeParts(P);''',
     '''    jointLimb(P,[V3(0.27,1.32,0),V3(0.36,1.06,-0.08),V3(0.41,0.90,0.14)],[0.075,0.06,0.05],skin,undefined,arm[1]);
    jointLimb(P,[V3(-0.27,1.32,0),V3(-0.34,1.06,-0.05),V3(-0.34,0.84,0.08)],[0.075,0.06,0.05],skin,undefined,arm[-1]);
    for(const [h,sx] of [[V3(0.41,0.90,0.14),1],[V3(-0.34,0.84,0.08),-1]])
        P.push({geo:_fIco(0.065),matrix:M(h.x,h.y,h.z),color:skin,b:arm[sx][1]});           // fists
    P.rig=R;
    return rigged(P);''', 'arms'),
]:
    c2 = edit(c2, old, new, 'caveman ' + label)
sub(c, c2, 'G9 caveman rig')

# ---------------------------------------------------------------- sea
sub('''const FISH_GEO=(()=>{'''+' '+'''
    const body=new THREE.SphereGeometry(0.28,7,5);   // v2.13.8: was 8x6
    const tail=new THREE.ConeGeometry(0.16,0.3,6);
    const g=mergeParts([
        {geo:body,matrix:new THREE.Matrix4().makeScale(0.55,0.8,1.45),color:0xffffff},
        {geo:tail,matrix:new THREE.Matrix4().compose(
            V3(0,0,-0.46),
            new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI/2,0,0)),
            V3(0.55,-1,1.4)),color:0xffffff}, // V2.10.22: Y=-1 fixes the tail - from Kimi AI
    ]);
    return g;
})();''', '''const FISH_GEO=(()=>{'''+' '+'''
    const body=new THREE.SphereGeometry(0.28,7,5);   // v2.13.8: was 8x6
    const tail=new THREE.ConeGeometry(0.16,0.3,6);
    const P=[
        {geo:body,matrix:new THREE.Matrix4().makeScale(0.55,0.8,1.45),color:0xffffff},
        {geo:tail,matrix:new THREE.Matrix4().compose(
            V3(0,0,-0.46),
            new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI/2,0,0)),
            V3(0.55,-1,1.4)),color:0xffffff}, // V2.10.22: Y=-1 fixes the tail - from Kimi AI
    ];
    /* VTAG: no bones — a fish IS its spine. A side-to-side wave runs from
       just behind the gills to the tip of the tail, about three beats a
       second at cruise and twice that bolting. */
    P.rig=rigNew();P.rig.rate=16;
    P.rig.spine={amp:0.10,k:5.0,s0:0.12,len:0.8,along:_rZ,disp:_rX,freq:1};
    return rigged(P);
})();''', 'G10 fish')

d = fn('dolphinGeo')
d2 = edit(d, '''    for(const sx of [-1,1])
        P.push({geo:new THREE.ConeGeometry(0.09,0.40,4),
                matrix:M(sx*0.24,-0.10,0.30,0,0,sx*1.30),color:fin});        // pectorals
    return mergeParts(P);''', '''    /* VTAG: a cetacean swims with its flukes, so the body wave is VERTICAL —
       the mirror of the fish and shark — and the pectorals trim as it goes. */
    const R=rigNew();R.rate=7;
    R.spine={amp:0.16,k:2.4,s0:0.35,len:1.6,along:_rZ,disp:_rY,freq:1};
    for(const sx of [-1,1])
        P.push({geo:new THREE.ConeGeometry(0.09,0.40,4),
                matrix:M(sx*0.24,-0.10,0.30,0,0,sx*1.30),color:fin,                 // pectorals
                b:rigBone(R,V3(sx*0.26,-0.11,0.30),0,_rZ,_rw(sx*0.16,0.4))});
    P.rig=R;
    return rigged(P);''', 'dolphin')
sub(d, d2, 'G11 dolphin')

d = fn('sharkGeo')
d2 = edit(d, '''    for(const sx of [-1,1])
        P.push({geo:new THREE.ConeGeometry(0.13,0.72,4),
                matrix:M(sx*0.34,-0.16,0.42,0,0,sx*1.35),color:fin});
    return mergeParts(P);''', '''    /* VTAG: a shark swims side to side — the wave starts behind the gills
       and is widest at the vertical caudal fin; the stiff pectorals barely
       trim. */
    const R=rigNew();R.rate=6;
    R.spine={amp:0.20,k:2.2,s0:0.45,len:2.1,along:_rZ,disp:_rX,freq:1};
    for(const sx of [-1,1])
        P.push({geo:new THREE.ConeGeometry(0.13,0.72,4),
                matrix:M(sx*0.34,-0.16,0.42,0,0,sx*1.35),color:fin,
                b:rigBone(R,V3(sx*0.36,-0.16,0.42),0,_rZ,_rw(sx*0.07,0.5))});
    P.rig=R;
    return rigged(P);''', 'shark')
sub(d, d2, 'G12 shark')

d = fn('whaleGeo')
d2 = edit(d, '''    for(const sx of [-1,1])
        P.push({geo:new THREE.ConeGeometry(0.22,1.15,4),
                matrix:M(sx*0.72,-0.32,0.75,0,0,sx*1.25),color:fin});        // long flippers
    return mergeParts(P);''', '''    /* VTAG: the slow vertical beat of the biggest animal in the game — a
       long wave from the head boss back, the flukes rising and falling most
       — while the long flippers row. */
    const R=rigNew();R.rate=2.6;
    R.spine={amp:0.38,k:1.25,s0:0.9,len:4.1,along:_rZ,disp:_rY,freq:1};
    for(const sx of [-1,1])
        P.push({geo:new THREE.ConeGeometry(0.22,1.15,4),
                matrix:M(sx*0.72,-0.32,0.75,0,0,sx*1.25),color:fin,                // long flippers
                b:rigBone(R,V3(sx*0.74,-0.32,0.75),0,_rZ,_rw(sx*0.22,0.6))});
    P.rig=R;
    return rigged(P);''', 'whale')
sub(d, d2, 'G13 whale')

# ---------------------------------------------------------------- cave
d = fn('ghostGeo')
d2 = edit(d, '''    for(const sx of [-1,1])
        P.push({geo:new THREE.ConeGeometry(0.13,0.62,5),
                matrix:M(sx*0.30,-0.34,0,Math.PI,0,sx*0.30),color:0xbcd8f5});   // tatters
    return mergeParts(P);''', '''    /* VTAG: the hem ripples — a slow wave down the shroud below the face —
       and the tatters, hung from their broad tops, trail behind and sway out
       of step with each other. */
    const R=rigNew();R.rate=4;
    R.spine={amp:0.10,k:4.0,s0:0.30,len:0.75,along:_rY,disp:_rX,freq:1};
    for(const sx of [-1,1])
        P.push({geo:new THREE.ConeGeometry(0.13,0.62,5),
                matrix:M(sx*0.30,-0.34,0,Math.PI,0,sx*0.30),color:0xbcd8f5,      // tatters
                b:rigBone(R,V3(sx*0.39,-0.04,0),0,_rX,_rw(0.35,sx>0?0:1.4,1,0.25))});
    P.rig=R;
    return rigged(P);''', 'ghost')
sub(d, d2, 'G14 ghost')

d = fn('foxbatGeo')
d2 = edit(d, '''    for(const sx of [-1,1]){
        P.push({geo:new THREE.ConeGeometry(0.09,0.26,4),matrix:M(sx*0.13,0.30,0.30),color:0x74432e}); // ears
        P.push({geo:_fBox(0.86,0.035,0.52),matrix:M(sx*0.56,0.06,-0.06,0,0,sx*0.22),color:0x3a2018}); // wing
        P.push({geo:_fBox(0.40,0.030,0.30),matrix:M(sx*1.02,0.02,-0.20,0,0,sx*0.30),color:0x2e1912}); // wingtip
        P.push({geo:new THREE.ConeGeometry(0.035,0.14,4),matrix:M(sx*0.07,-0.10,0.52,Math.PI,0,0),color:0xfff4e0}); // fangs
    }
    return mergeParts(P);''', '''    /* VTAG: the wings flap from the shoulder, about the body's long axis,
       and the tips follow a beat behind — the whip that makes a flap read as
       a membrane and not a plank. The body rises on each downstroke
       (rig.flapBob, in updateCavers). */
    const R=rigNew();R.rate=15;R.flapBob=0.06;
    for(const sx of [-1,1]){
        const wing=rigBone(R,V3(sx*0.14,-0.03,-0.06),0,_rZ,_rw(sx*0.70,0));
        const tip=rigBone(R,V3(sx*0.86,0.02,-0.14),wing,_rZ,_rw(sx*0.45,-0.9));
        P.push({geo:new THREE.ConeGeometry(0.09,0.26,4),matrix:M(sx*0.13,0.30,0.30),color:0x74432e}); // ears
        P.push({geo:_fBox(0.86,0.035,0.52),matrix:M(sx*0.56,0.06,-0.06,0,0,sx*0.22),color:0x3a2018,b:wing}); // wing
        P.push({geo:_fBox(0.40,0.030,0.30),matrix:M(sx*1.02,0.02,-0.20,0,0,sx*0.30),color:0x2e1912,b:tip}); // wingtip
        P.push({geo:new THREE.ConeGeometry(0.035,0.14,4),matrix:M(sx*0.07,-0.10,0.52,Math.PI,0,0),color:0xfff4e0}); // fangs
    }
    P.rig=R;
    return rigged(P);''', 'foxbat')
sub(d, d2, 'G15 foxbat')

# ---------------------------------------------------------------- the garrison
g = fn('buildGuardGeometry')
g2 = edit(g, '''    const mantid=D.key==='mantid';
    for(const sx of [-1,1]){
        const x=sx*0.17;
        if(mantid)
            jointLimb(parts,[V3(x,0.80,0),V3(sx*0.22,0.52,0.16),V3(x,0.10,-0.04)],[0.10,0.075,0.055],trim,hull);
        else
            jointLimb(parts,[V3(x,0.80,0.03),V3(x,0.44,-0.13),V3(x,0.09,0.02)],[0.11,0.085,0.07],trim,hull);
        parts.push({geo:_fIco(1),matrix:M(x,0.05,-0.07,0,0,0,0.09,0.06,0.15),color:trim});   // foot
    }''', '''    const mantid=D.key==='mantid';
    /* VTAG THE MARCH. Hips swing the legs — FORWARD IS -Z here, so a positive
       turn about X is the forward stroke — and the shin folds on it: back
       and up for a Reptilian knee, forward and up for a Mantid's insect leg.
       Everything above the pelvis — torso, yoke, head, both arms, the rifle —
       is ONE bone that sways a little, so both hands stay on the gun. A
       trooper backing off to its standoff walks backwards: updateGroundGuards
       feeds a signed speed and the cycle runs in reverse. The ankle is the
       caveman's pair of joints: one against the hip (the boot flat on the
       stance, rig.plant), one against the knee (the toe clear on the swing). */
    const R=rigNew(2*0.80*0.42/Math.PI),PI=Math.PI,Q=PI/2;
    R.plant=true;
    const upper=rigBone(R,V3(0,0.80,0),0,_rY,_rw(0.06,0));
    for(const sx of [-1,1]){
        const x=sx*0.17,ph=sx>0?0:PI;
        const thigh=rigBone(R,mantid?V3(x,0.80,0):V3(x,0.80,0.03),0,_rX,_rw(0.42,ph));
        const shin=mantid?rigBone(R,V3(sx*0.22,0.52,0.16),thigh,_rX,_rr(0.55,ph+Q))
                         :rigBone(R,V3(x,0.44,-0.13),thigh,_rX,_rr(-0.8,ph+Q));
        if(mantid)
            jointLimb(parts,[V3(x,0.80,0),V3(sx*0.22,0.52,0.16),V3(x,0.10,-0.04)],[0.10,0.075,0.055],trim,hull,[thigh,shin]);
        else
            jointLimb(parts,[V3(x,0.80,0.03),V3(x,0.44,-0.13),V3(x,0.09,0.02)],[0.11,0.085,0.07],trim,hull,[thigh,shin]);
        const ank=mantid?V3(x,0.10,-0.04):V3(x,0.09,0.02);
        const foot=rigBone(R,ank,rigBone(R,ank,shin,_rX,_rw(-0.42,ph)),_rX,mantid?_rr(-0.55,ph+Q):_rr(0.8,ph+Q));
        parts.push({geo:_fIco(1),matrix:M(x,0.05,-0.07,0,0,0,0.09,0.06,0.15),color:trim,b:foot});   // foot
    }''', 'guard legs')
for old, new, label in [
    ("parts.push({geo:_fIco(1,1),matrix:M(0,1.06,0,-0.10,0,0,0.33,0.36,0.21),color:hull});",
     "parts.push({geo:_fIco(1,1),matrix:M(0,1.06,0,-0.10,0,0,0.33,0.36,0.21),color:hull,b:upper});", 'torso'),
    ("parts.push({geo:box(0.92,0.18,0.30),matrix:M(0,1.32,0),color:trim});",
     "parts.push({geo:box(0.92,0.18,0.30),matrix:M(0,1.32,0),color:trim,b:upper});", 'yoke'),
    ("parts.push({geo:new THREE.ConeGeometry(0.24,0.42,4),matrix:M(0,1.62,0,0,Math.PI/4,0),color:hull});",
     "parts.push({geo:new THREE.ConeGeometry(0.24,0.42,4),matrix:M(0,1.62,0,0,Math.PI/4,0),color:hull,b:upper});", 'head'),
    ("jointLimb(parts,[V3(0.40,1.30,0),V3(0.42,1.02,0.10),V3(0.30,1.08,-0.14)],[0.085,0.07,0.06],trim,hull);",
     "jointLimb(parts,[V3(0.40,1.30,0),V3(0.42,1.02,0.10),V3(0.30,1.08,-0.14)],[0.085,0.07,0.06],trim,hull,[upper,upper]);", 'right arm'),
    ("jointLimb(parts,[V3(-0.40,1.30,0),V3(-0.28,1.02,-0.14),V3(0.18,1.09,-0.42)],[0.085,0.07,0.06],trim,hull);",
     "jointLimb(parts,[V3(-0.40,1.30,0),V3(-0.28,1.02,-0.14),V3(0.18,1.09,-0.42)],[0.085,0.07,0.06],trim,hull,[upper,upper]);", 'left arm'),
    ("parts.push({geo:_fIco(0.07),matrix:M(0.30,1.08,-0.14),color:hull});",
     "parts.push({geo:_fIco(0.07),matrix:M(0.30,1.08,-0.14),color:hull,b:upper});", 'grip hand'),
    ("parts.push({geo:_fIco(0.07),matrix:M(0.18,1.09,-0.42),color:hull});",
     "parts.push({geo:_fIco(0.07),matrix:M(0.18,1.09,-0.42),color:hull,b:upper});", 'support hand'),
    ("parts.push({geo:box(0.13,0.15,0.74),matrix:M(0.30,1.14,-0.36),color:trim});",
     "parts.push({geo:box(0.13,0.15,0.74),matrix:M(0.30,1.14,-0.36),color:trim,b:upper});", 'rifle'),
    ('''    parts.push({geo:box(0.10,0.10,0.26),matrix:M(0.30,1.14,-0.82),color:0x222222});
    return mergeParts(parts);''', '''    parts.push({geo:box(0.10,0.10,0.26),matrix:M(0.30,1.14,-0.82),color:0x222222,b:upper});
    parts.rig=R;
    return rigged(parts);''', 'muzzle'),
]:
    g2 = edit(g2, old, new, 'guard ' + label)
sub(g, g2, 'G16 guard rig')
