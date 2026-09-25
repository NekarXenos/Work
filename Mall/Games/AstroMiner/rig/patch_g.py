#!/usr/bin/env python3
"""Patch G: creature animation — walk, swim, flap — behind a device gate.

Usage:  python3 patch_g.py <src.html> <dst.html> <version> <twin-version>
  Demo line:  patch_g.py Bleaux_Demo.html Bleaux_Demo.html v2.13.11 v2.12.44
  Game line:  patch_g.py Bleaux_v2_12_43.html Bleaux_v2_12_44.html v2.12.44 v2.13.11

The Demo and the v2.12.x game carry byte-identical code apart from version
strings and changelog, so ONE patch applies to both; only the version tag in
the comments, the <title> and the changelog headline differ. Every anchor must
occur exactly once or the patch refuses to write anything.
"""
import io, re, sys

SRC, DST, VER, TWIN = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
s = io.open(SRC, encoding='utf-8').read()

def sub(old, new, label):
    global s
    n = s.count(old)
    assert n == 1, 'ANCHOR %s occurs %d times, expected 1' % (label, n)
    s = s.replace(old, new.replace('VTAG', VER).replace('TWIN', TWIN), 1)
    print('  ok  ' + label)

def fn(name):
    """the exact current text of a top-level function, `function name(` to the
    closing brace at column 0"""
    i = s.index('function ' + name + '(')
    j = s.index('\n}\n', i) + 3
    return s[i:j]

# ---------------------------------------------------------------- title
m = re.search(r'<title>Bleaux AstroMiner — (v[\d.]+)</title>', s)
assert m, 'title not found'
sub(m.group(0), '<title>Bleaux AstroMiner — ' + VER + '</title>', 'G0 title')

# ---------------------------------------------------------------- mergeParts: bake aBone
sub(fn('mergeParts'), r'''function mergeParts(parts){
    let total=0;
    const baked=[];
    let rigged=false;                             // VTAG: does any part name a bone?
    for(const p of parts){
        let g=p.geo.index?p.geo.toNonIndexed():p.geo.clone();
        g.applyMatrix4(p.matrix);
        if(!g.attributes.normal)g.computeVertexNormals();
        total+=g.attributes.position.count;
        baked.push({g,c:new THREE.Color(p.color),bn:p.b||0});
        if(p.b)rigged=true;
    }
    const pos=new Float32Array(total*3),nor=new Float32Array(total*3),col=new Float32Array(total*3);
    const bone=rigged?new Float32Array(total):null;
    let o=0;
    for(const {g,c,bn} of baked){
        const gp=g.attributes.position.array,gn=g.attributes.normal.array;
        pos.set(gp,o*3);nor.set(gn,o*3);
        for(let i=0;i<g.attributes.position.count;i++){
            col[(o+i)*3]=c.r;col[(o+i)*3+1]=c.g;col[(o+i)*3+2]=c.b;
        }
        if(bone)bone.fill(bn,o,o+g.attributes.position.count);
        o+=g.attributes.position.count;
        g.dispose();
    }
    const out=new THREE.BufferGeometry();
    out.setAttribute('position',new THREE.BufferAttribute(pos,3));
    out.setAttribute('normal',new THREE.BufferAttribute(nor,3));
    out.setAttribute('color',new THREE.BufferAttribute(col,3));
    /* VTAG: the bone each vertex rides (see CREATURE ANIMATION). Only a
       part list that names bones gets one — huts, saucers, trees and every
       other merged prop come out exactly as they always did. */
    if(bone)out.setAttribute('aBone',new THREE.BufferAttribute(bone,1));
    return out;
}
''', 'G1 mergeParts')

# ---------------------------------------------------------------- jointLimb: bones per segment
sub(fn('jointLimb'), r'''function jointLimb(P,pts,rads,color,jointColor,bones){
    for(let i=0;i<pts.length-1;i++){
        /* VTAG: `bones[i]` is the bone segment i rides, and so does the
           knuckle at its root. pts[i] IS that bone's pivot, so the knuckle
           turns in place and the joint never opens a gap. */
        const b=bones?bones[i]:0;
        const seg=_fSeg(pts[i],pts[i+1],rads[i],rads[i+1],color);
        seg.b=b;P.push(seg);
        if(i>0)P.push({geo:_fIco(rads[i]*1.15),matrix:M(pts[i].x,pts[i].y,pts[i].z),
                       color:jointColor===undefined?color:jointColor,b});
    }
    return P;
}
''', 'G2 jointLimb')

# ---------------------------------------------------------------- the kit + the gate
KIT = r'''/* ============ VTAG CREATURE ANIMATION — WALK, SWIM, FLAP ============
   PLAYER BRIEF, VERBATIM: "add proper walking/swimming animations for all
   mobs, that only activate if the device is powerful enough".

   WHAT MOVED BEFORE THIS: nothing but a whole-body squash. Every creature is
   ONE merged, vertex-coloured geometry drawn by ONE InstancedMesh per species
   (the v2.11.10 draw-call rule), so no leg could move without the whole
   animal moving; the "walk" was `sy=1+sin(walkT)*0.035`, and the v2.13.8
   knees and elbows were modelled and never bent.

   THE RIG LIVES IN THE GEOMETRY AND THE VERTEX SHADER, NOT IN THE SCENE.
   Splitting an animal into per-limb meshes multiplies draw calls by the bone
   count, and a SkinnedMesh per animal ends instancing outright. Instead:
     - every part a builder pushes may carry `b`, a BONE index; mergeParts
       bakes it into an `aBone` vertex attribute (0 is the body, which never
       bends). jointLimb takes a bone per segment, so a knee is exactly where
       one bone ends and the next begins;
     - the builder records each bone's PIVOT (the joint it turns about, in the
       rest pose it already models), PARENT, AXIS and two MOTIONS — walk and
       swim — on geometry.userData.rig;
     - the material's vertex shader walks each vertex up its chain of joints
       to the body, turning it about each in turn, child first, so a paw rides
       its wrist, its elbow and its shoulder; swimmers add a travelling body
       WAVE along the spine instead of (or as well as) bones;
     - per animal per frame the CPU writes three numbers into one per-INSTANCE
       attribute, aAnim = (gait phase, stride, swim blend).
   Still one draw call per species. The raycast, the colliders, the facing and
   every number the AI reads are untouched, because the REST pose is the
   shipped geometry byte for byte — asserted by the suite, not assumed.

   A MOTION is [amp, phase, bias, freq, rect]:
       angle = stride * ( amp * wave(freq*gaitPhase + phase) + bias )
   `rect` rectifies the wave (max(0,sin)): a knee folds one way, and it folds
   while its foot is in the air — a quarter-cycle ahead of the swing. Stride
   is 0 standing, 1 at the animal's own walking pace and up to 1.3 when it
   bolts, so a standing animal is EXACTLY its modelled pose. Gait phase is
   advanced by DISTANCE covered (rig.cyc metres per radian at full stride), so
   feet do not skate at any speed. Every freq is 1, 2 or 3, so phases wrap at
   RIG_WRAP without a seam.

   ONLY ON A DEVICE THAT CAN AFFORD IT — two gates, see MOB_ANIM below. */
const RIG_MAX=24;          // bones per species, the body (bone 0) included — the uniform arrays' length
const RIG_DEPTH=6;         // longest joint chain a vertex walks (mammoth trunk tip: 5)
const RIG_WRAP=Math.PI*12; // gait phases wrap here — a multiple of every motion's cycle
const RIG_STILL=[0,0,0,1,0];
const _rX=V3(1,0,0),_rY=V3(0,1,0),_rZ=V3(0,0,1);
/* motion shorthands: _rw a plain wave, _rr a rectified one (a joint that folds one way) */
const _rw=(a,ph,f,bias)=>[a,ph||0,bias||0,f||1,0];
const _rr=(a,ph,f,bias)=>[a,ph||0,bias||0,f||1,1];
/* cyc: ground covered per radian of gait at full stride; plant: dip the body
   at the ends of the stride so the stance feet stay down (bob, measured —
   see rigFootLift); rate: a swimmer's or flier's beat, rad/s at cruise;
   spine: the body wave, {amp,k,s0,len,along,disp,freq} */
function rigNew(cyc){return {bones:[null],spine:null,cyc:cyc||0.25,plant:false,bob:0,rate:0,flapBob:0};}
function rigBone(R,pivot,parent,axis,walk,swim){
    let d=1;
    for(let q=parent||0;q;q=R.bones[q].parent)d++;
    if(d>RIG_DEPTH)throw new Error('rig: joint chain deeper than '+RIG_DEPTH);
    R.bones.push({p:pivot.clone(),parent:parent||0,axis:axis.clone().normalize(),
                  w:walk||RIG_STILL,s:swim||walk||RIG_STILL});
    if(R.bones.length>RIG_MAX)throw new Error('rig: more than '+(RIG_MAX-1)+' bones');
    return R.bones.length-1;
}
/* mergeParts, plus the rig riding on geometry.userData where every
   InstancedMesh built from this geometry can find it. A rig with no bones
   (a fish is all spine) still gets an all-zero aBone, so the shader never
   reads an attribute the geometry does not have. */
function rigged(P){
    const g=mergeParts(P);
    if(P.rig){
        g.userData.rig=P.rig;
        if(!g.attributes.aBone)
            g.setAttribute('aBone',new THREE.BufferAttribute(new Float32Array(g.attributes.position.count),1));
        if(P.rig.plant)P.rig.bob=rigFootLift(g);
    }
    return g;
}
/* THE FEET, MEASURED, NOT ESTIMATED. A rigid leg swung through an arc lifts
   its foot at both ends of the stride — the inverted pendulum every walker
   rides — and by how much depends on the leg's own zig-zag and on how its
   pad tilts as it turns, which no one formula gets right for a wolf, a
   caveman and a Mantid alike. So it is measured, once per species when the
   geometry is built: every FOOT (a bone no other bone hangs from, whose
   vertices touch the ground at rest) is walked through the same joint chain
   the vertex shader walks, at the two ends of the stride, and the smallest
   lift is the body's dip there (rig.bob). Only for gaits where the stance
   feet share a stride angle — a trot, two legs — since a four-beat walk has
   no one angle to match. Never per frame. */
const _rigV=V3();
function rigPointY(rig,x,y,z,bone,ph){
    for(let rb=bone,i=0;rb>0&&i<RIG_DEPTH;i++){
        const b=rig.bones[rb],w=b.w,s=Math.sin(ph*w[3]+w[1]);
        _rigV.set(x-b.p.x,y-b.p.y,z-b.p.z).applyAxisAngle(b.axis,w[0]*(w[4]?Math.max(s,0):s)+w[2]);
        x=_rigV.x+b.p.x;y=_rigV.y+b.p.y;z=_rigV.z+b.p.z;
        rb=b.parent;
    }
    return y;
}
function rigFootLift(g){
    const rig=g.userData.rig,P=g.attributes.position.array,B=g.attributes.aBone.array;
    const parents=new Set(rig.bones.slice(1).map(b=>b.parent));
    let lift=Infinity;
    for(let f=1;f<rig.bones.length;f++){
        if(parents.has(f))continue;
        let rest=Infinity;
        for(let v=0;v<B.length;v++)if(B[v]===f)rest=Math.min(rest,P[v*3+1]);
        if(rest>0.06)continue;                         // a tail tip, an ear: not a foot
        for(const ph of [Math.PI/2,Math.PI*1.5]){
            let lo=Infinity;
            for(let v=0;v<B.length;v++)if(B[v]===f)lo=Math.min(lo,rigPointY(rig,P[v*3],P[v*3+1],P[v*3+2],f,ph));
            lift=Math.min(lift,lo-rest);
        }
    }
    return lift===Infinity?0:Math.max(0,lift);
}

/* ---- THE GATE: "only activate if the device is powerful enough" ----
   Two questions, asked at two different times.
   1. CAN IT AT ALL — once, at boot. Not on a software rasteriser
      (SwiftShader, llvmpipe: the "GPU" is the CPU), and not on a device that
      reports under 4 cores (6 on a phone) or under 4 GB. What a browser will
      not say is not held against it — iOS reports neither honestly — so an
      iPhone goes on to question 2. A device that fails here never gets the
      rigged shader at all: its creatures render through the stock material,
      exactly the shipped path, and pay nothing.
   2. CAN IT RIGHT NOW — every 500 ms fps window, the one the HUD already
      reads. Under MOB_ANIM_FLOOR fps for MOB_ANIM_SLOW_N windows in a row
      and the animation stands down; MOB_ANIM_FAST_N windows over
      MOB_ANIM_RESUME and it comes back; after MOB_ANIM_TRIPS stand-downs it
      stays down for the session. MEASURED, NOT GUESSED: a list of GPU names
      ages badly, a frame rate does not. Nothing is judged for
      MOB_ANIM_WARMUP s after the game starts, after a warp or a landing —
      chunk streaming is the heaviest thing this game does, and a verdict
      taken during it would be about the terrain, not the device — nor in the
      opening scene, the star chart, the cockpit, asleep, in a hidden tab or
      over a window that spans a stall.
   Standing down is a 0.5 s fade of ONE shared uniform: no recompile, no
   material swap, no hitch, and every animal eases back to its modelled pose.
   The rig costs RIG_MAX x 4 + 4 uniform vectors, inside the 256 every WebGL2
   device must offer; a driver that refuses the shader anyway costs the
   animation, never the animals (the shader-error hook below).
   ?anim=1 / ?anim=0 force either answer, the way ?touch= forces the control
   scheme; the state is shown at the foot of the [H] help panel. */
const MOB_ANIM_FLOOR=45;     // fps: under this, sustained, the animation stands down
const MOB_ANIM_RESUME=55;    // fps: over this, sustained, it comes back
const MOB_ANIM_SLOW_N=6;     // 500 ms windows under the floor before standing down (3 s)
const MOB_ANIM_FAST_N=40;    // windows over RESUME before the next try (20 s)
const MOB_ANIM_TRIPS=3;      // stand-downs before it stays down for the session
const MOB_ANIM_WARMUP=8;     // s of play before anything is judged
const MOB_ANIM={capable:false,forced:null,on:false,k:0,why:'',
                slow:0,fast:0,trips:0,warm:-1,U:{value:0},mats:[]};
function mobAnimProbe(){
    const A=MOB_ANIM;
    let q=null;
    try{q=new URLSearchParams(location.search).get('anim');}catch(e){}
    if(q==='0'||q==='false'){A.forced=false;A.why='off (?anim=0)';return false;}
    if(q==='1'||q==='true'){A.forced=true;A.why='on (?anim=1)';return true;}
    A.forced=null;
    let gpu='';
    try{
        const gl=renderer.getContext();
        const ext=gl&&gl.getExtension&&gl.getExtension('WEBGL_debug_renderer_info');
        if(ext)gpu=String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)||'');
    }catch(e){}
    if(/swiftshader|llvmpipe|softpipe|software|basic render/i.test(gpu)){
        A.why='off — software rendering';return false;}
    const nav=(typeof navigator!=='undefined'&&navigator)||{};
    const iOS=/iPhone|iPad|iPod/i.test(nav.userAgent||'')||(nav.platform==='MacIntel'&&nav.maxTouchPoints>1);
    const cores=nav.hardwareConcurrency,mem=nav.deviceMemory;
    if(!iOS&&cores>0&&cores<(IS_MOBILE?6:4)){A.why='off — '+cores+' CPU cores';return false;}
    if(mem>0&&mem<4){A.why='off — '+mem+' GB of memory';return false;}
    A.why='on (auto)';
    return true;
}
function mobAnimStatus(){return 'Creature animation: '+MOB_ANIM.why;}
function mobAnimShowStatus(){const e=$('animstat');if(e)e.textContent=mobAnimStatus();}
/* Is this a fair moment to judge the device? The live conditions, with a
   fresh warm-up every time one of them lapses. */
function mobAnimJudging(){
    const A=MOB_ANIM;
    if(!gameStarted||warping||galaxyView||mode!=='foot'||introCineActive()||sleepActive()
       ||(typeof document!=='undefined'&&document.hidden)){A.warm=-1;return false;}
    if(A.warm<0)A.warm=simT+MOB_ANIM_WARMUP;
    return simT>=A.warm;
}
/* Once per 500 ms fps window. `ready` is the suite's handle on the live
   conditions above, the way faunaSpeciesAt takes sysN. */
function mobAnimGovern(fps,winMs,ready){
    const A=MOB_ANIM;
    if(!A.capable||A.forced!==null)return;
    if(ready===undefined)ready=mobAnimJudging();
    if(!ready||winMs>1000)return;
    if(A.on){
        if(fps<MOB_ANIM_FLOOR){
            if(++A.slow>=MOB_ANIM_SLOW_N){
                A.on=false;A.slow=A.fast=0;A.trips++;
                A.why=(A.trips>=MOB_ANIM_TRIPS?'off':'paused')+' — this device is running under '
                     +MOB_ANIM_FLOOR+' fps';
                mobAnimShowStatus();
            }
        }else A.slow=0;
    }else if(A.trips<MOB_ANIM_TRIPS){
        if(fps>=MOB_ANIM_RESUME){
            if(++A.fast>=MOB_ANIM_FAST_N){A.on=true;A.fast=A.slow=0;A.why='on (auto)';mobAnimShowStatus();}
        }else A.fast=0;
    }
}
/* once per FRAME, beside the ambient animation: the half-second fade */
function mobAnimTick(rawDt){
    const A=MOB_ANIM,t=A.on?1:0;
    if(A.k!==t)A.k=t>A.k?Math.min(t,A.k+rawDt*2):Math.max(t,A.k-rawDt*2);
    A.U.value=A.k;
}
MOB_ANIM.capable=mobAnimProbe();
MOB_ANIM.on=MOB_ANIM.capable;
MOB_ANIM.k=MOB_ANIM.U.value=MOB_ANIM.on?1:0;
mobAnimShowStatus();
/* a driver that will not build the rig shader turns the animation off —
   every rigged material goes back to the stock program — and never takes the
   animals with it. Chains to whatever handler was there, else logs as three
   would have. */
function mobAnimRetreat(why){
    const A=MOB_ANIM;
    A.capable=false;A.on=false;A.k=0;A.U.value=0;A.why=why;
    for(const m of A.mats){delete m.onBeforeCompile;m.needsUpdate=true;}
    A.mats.length=0;
    mobAnimShowStatus();
}
if(renderer.debug){
    const prevShaderError=renderer.debug.onShaderError;
    renderer.debug.onShaderError=function(gl,program,vs,fs){
        let rig=false;
        try{rig=/uRigP/.test(gl.getShaderSource(vs)||'');}catch(e){}
        if(rig)mobAnimRetreat('off — this GPU would not build the animation shader');
        if(typeof prevShaderError==='function')return prevShaderError.apply(this,arguments);
        console.error('THREE.WebGLProgram: Shader Error '+gl.getError()+' - VALIDATE_STATUS '
            +gl.getProgramParameter(program,gl.VALIDATE_STATUS)+'\n\nProgram Info Log: '
            +gl.getProgramInfoLog(program)+'\n'+gl.getShaderInfoLog(vs)+'\n'+gl.getShaderInfoLog(fs));
    };
}

/* ---- THE SHADER. Three insertions into three's own MeshLambertMaterial
   vertex shader, so lighting, fog, flat shading, vertex colours and instance
   colours are all still three's: declarations after <common>; the rig after
   <beginnormal_vertex> (it bends objectNormal too, for the smooth-shaded fish);
   and `transformed=rigPos` after <begin_vertex>. Rodrigues' rotation about
   each joint; the body wave is a shear along the spine, whose normal is
   corrected by the shear's inverse transpose (n -= along * slope * n.disp). */
const RIG_VERT_HEAD=`
#define RIG_MAX ${RIG_MAX}
attribute float aBone;
attribute vec3 aAnim;
uniform vec4 uRigP[RIG_MAX];
uniform vec4 uRigX[RIG_MAX];
uniform vec4 uRigW[RIG_MAX];
uniform vec4 uRigS[RIG_MAX];
uniform vec4 uSpA;
uniform vec4 uSpL;
uniform vec4 uSpD;
uniform float uAnimOn;
vec3 rigTurn(vec3 v,vec3 k,float a){
    float c=cos(a),s=sin(a);
    return v*c+cross(k,v)*s+k*dot(k,v)*(1.0-c);
}
float rigWave(vec4 m,float rect,float ph){
    float s=sin(ph*m.w+m.y);
    return m.x*mix(s,max(s,0.0),rect)+m.z;
}
float rigSpine(float s,float ph){
    float d=uSpA.z-s,e=clamp(d/uSpA.w,0.0,1.0);
    return uSpA.x*e*e*sin(ph*uSpL.w-uSpA.y*d);
}
`;
const RIG_VERT_BODY=`
vec3 rigPos=vec3(position);
float rigK=uAnimOn*aAnim.y;
if(rigK>0.0001){
    int rb=int(aBone+0.5);
    for(int i=0;i<${RIG_DEPTH};i++){
        if(rb<=0||rb>=RIG_MAX)break;
        vec4 P=uRigP[rb];vec4 X=uRigX[rb];
        float a=rigK*mix(rigWave(uRigW[rb],mod(X.w,2.0),aAnim.x),
                         rigWave(uRigS[rb],step(1.5,X.w),aAnim.x),aAnim.z);
        rigPos=rigTurn(rigPos-P.xyz,X.xyz,a)+P.xyz;
        objectNormal=rigTurn(objectNormal,X.xyz,a);
        rb=int(P.w+0.5);
    }
    if(uSpD.w>0.5){
        float s=dot(rigPos,uSpL.xyz);
        float d=rigK*rigSpine(s,aAnim.x);
        float sl=(rigK*rigSpine(s+0.02,aAnim.x)-d)*50.0;
        rigPos+=uSpD.xyz*d;
        objectNormal-=uSpL.xyz*(sl*dot(objectNormal,uSpD.xyz));
    }
}
`;
const RIG_ANCHORS=['#include <common>','#include <beginnormal_vertex>','#include <begin_vertex>'];
/* ONE function object for every rigged material, so three's program cache
   (keyed on onBeforeCompile's source) builds each shading variant ONCE and
   every species shares it; the bone tables are per-material uniforms. */
function rigCompile(shader){
    const vs=shader.vertexShader;
    if(!RIG_ANCHORS.every(a=>vs.includes(a)))return;   // not the shader this was written against: stay stock
    const U=this.userData.rigU;
    for(const k in U)shader.uniforms[k]=U[k];
    shader.uniforms.uAnimOn=MOB_ANIM.U;
    shader.vertexShader=vs
        .replace(RIG_ANCHORS[0],RIG_ANCHORS[0]+'\n'+RIG_VERT_HEAD)
        .replace(RIG_ANCHORS[1],RIG_ANCHORS[1]+'\n'+RIG_VERT_BODY)
        .replace(RIG_ANCHORS[2],RIG_ANCHORS[2]+'\n\ttransformed=rigPos;');
}
function rigMaterial(mat,rig){
    const V4=(x,y,z,w)=>new THREE.Vector4(x,y,z,w);
    const P=[],X=[],W=[],S=[];
    for(let i=0;i<RIG_MAX;i++){
        const b=rig.bones[i];
        if(!b){P.push(V4(0,0,0,0));X.push(V4(1,0,0,0));W.push(V4(0,0,0,1));S.push(V4(0,0,0,1));continue;}
        P.push(V4(b.p.x,b.p.y,b.p.z,b.parent));
        X.push(V4(b.axis.x,b.axis.y,b.axis.z,(b.w[4]?1:0)+(b.s[4]?2:0)));
        W.push(V4(b.w[0],b.w[1],b.w[2],b.w[3]));
        S.push(V4(b.s[0],b.s[1],b.s[2],b.s[3]));
    }
    const sp=rig.spine;
    mat.userData.rigU={uRigP:{value:P},uRigX:{value:X},uRigW:{value:W},uRigS:{value:S},
        uSpA:{value:sp?V4(sp.amp,sp.k,sp.s0,sp.len):V4(0,0,0,1)},
        uSpL:{value:sp?V4(sp.along.x,sp.along.y,sp.along.z,sp.freq||1):V4(0,0,1,1)},
        uSpD:{value:sp?V4(sp.disp.x,sp.disp.y,sp.disp.z,1):V4(0,0,0,0)}};
    mat.onBeforeCompile=rigCompile;
    MOB_ANIM.mats.push(mat);
    return mat;
}
/* Called right after each creature InstancedMesh is built (land, sea, cave,
   garrison). A no-op for a geometry with no rig (the hopper) and on a device
   that failed the gate. FISH_GEO is shared by every body's fish mesh, so it is
   cloned first — the per-instance attribute must belong to one mesh. */
function mobAnimAttach(im,cap){
    const rig=im.geometry.userData.rig;
    if(!rig||!MOB_ANIM.capable)return im;
    if(im.geometry===FISH_GEO)im.geometry=FISH_GEO.clone();
    const a=new THREE.InstancedBufferAttribute(new Float32Array(cap*3),3);
    a.setUsage(THREE.DynamicDrawUsage);
    im.geometry.setAttribute('aAnim',a);
    im.userData.anim=a;
    rigMaterial(im.material,rig);
    return im;
}
function mobRigOf(map,sp){
    const im=map&&map.get(sp);
    return im&&im.userData.anim?im.geometry.userData.rig:null;
}
/* THE CPU SIDE: per animal per frame, three numbers.
   A walker's phase advances by distance covered — a signed speed runs the
   cycle backwards for a trooper backing off — and its stride and swim blend
   ease, so nothing snaps when it stops, bolts or wades in. */
function mobAnimGait(rec,rig,dt,v,vWalk,swim){
    const av=Math.abs(v);
    const want=av>0.02?Math.min(1.3,0.3+0.7*av/Math.max(0.05,vWalk)):0;
    const a=rec.aAmp||0,s=rec.aSwim||0;
    rec.aAmp=a+clamp(want-a,-3*dt,3*dt);
    rec.aSwim=s+clamp((swim?1:0)-s,-2*dt,2*dt);
    let p=rec.aPh||0;
    if(av>0.02)p+=dt*v/(rig.cyc*Math.max(0.6,rec.aAmp));
    rec.aPh=((p%RIG_WRAP)+RIG_WRAP)%RIG_WRAP;
}
/* A swimmer or flier never stops beating: stride and beat rate rise with its
   speed over cruise. A stranded swimmer flops, in fits. */
function mobAnimSwim(rec,rig,dt,v,vCruise,stranded){
    let want,rate;
    if(stranded){
        want=0.9*Math.max(0,Math.sin(simT*1.7+(rec.hue||0)*9));
        rate=rig.rate*0.6;
    }else{
        const r=v/Math.max(0.05,vCruise);
        want=Math.min(1.4,0.55+0.45*r);
        rate=rig.rate*(0.55+0.45*r);
    }
    const a=rec.aAmp||0;
    rec.aAmp=a+clamp(want-a,-2.5*dt,2.5*dt);
    rec.aPh=((rec.aPh||0)+dt*rate)%RIG_WRAP;
}
function mobAnimWrite(im,i,rec){
    const a=im&&im.userData.anim;
    if(!a)return;
    const o=i*3,arr=a.array;
    arr[o]=rec.aPh||0;arr[o+1]=rec.aAmp||0;arr[o+2]=rec.aSwim||0;
    a.needsUpdate=true;
}
'''
sub('/* ============ v2.11.12 CAVEMEN (plan 4.5) ============',
    KIT + '/* ============ v2.11.12 CAVEMEN (plan 4.5) ============', 'G3 kit + gate')

exec(open(__file__.replace('patch_g.py', 'patch_g_rigs.py'), encoding='utf-8').read())
exec(open(__file__.replace('patch_g.py', 'patch_g_hooks.py'), encoding='utf-8').read())

io.open(DST, 'w', encoding='utf-8').write(s)
print('wrote', DST)
