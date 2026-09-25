/* tests_mobanim.mjs — creature animation (Demo v2.13.11 / game v2.12.44).
   Real three r170 (only WebGLRenderer stubbed), the SHIPPED module sliced out
   of the HTML by extract.mjs.

     node tests_mobanim.mjs <new.html> <baseline.html>

   The baseline is the build before this release; the REST-POSE assertions
   compare against it byte for byte, which is the promise the whole design
   rests on: the geometry the raycast, the colliders and the facing tests
   read is exactly what shipped.

   THE SHADER IS PORTED, NOT TRUSTED. rigPose() below is the vertex shader's
   rig block transcribed line for line (Rodrigues about each joint, child
   first; the spine shear) so the gait can be measured headless: where the
   feet are, which way they go, whether they skate. The GLSL itself is
   compiled and drawn in a real browser by shots_mobanim.mjs. */
import os from 'node:os';
import path from 'node:path';
import {build} from './extract.mjs';
import {boot} from './boot.mjs';
import {makeBody,activate} from './fixture.mjs';

const NEW=path.resolve(process.argv[2]||'../Bleaux_Demo.html');
const BASE=path.resolve(process.argv[3]||'');
if(!process.argv[3]){console.log('usage: node tests_mobanim.mjs <new.html> <baseline.html>');process.exit(2);}
const tmp=os.tmpdir();
const newMod=path.join(tmp,'mobanim_new.mjs'),baseMod=path.join(tmp,'mobanim_base.mjs');
build(NEW,newMod);build(BASE,baseMod);

let pass=0,fail=0;
const T=(name,fn)=>{try{fn();pass++;console.log('  ok   '+name);}
                    catch(e){fail++;console.log('  FAIL '+name+'\n         '+e.message);}};
const ok=(c,m)=>{if(!c)throw new Error(m||'expected truthy');};
const eq=(a,b,m)=>{if(a!==b)throw new Error((m||'')+' expected '+JSON.stringify(b)+', got '+JSON.stringify(a));};

const {G,THREE}=await boot(newMod,7);
const B=(await boot(baseMod+'?base',7)).G;

const LAND=['wolf','bison','mammoth','caveman','sabre'];
const SEA=['fish','dolphin','shark','whale'];
const CAVE=['ghost','foxbat'];
const QUAD=['wolf','bison','mammoth','sabre'];
const geoOf=(Gm,sp)=>sp.startsWith('guard')?Gm.buildGuardGeometry(+sp.slice(5))
    :(Gm.FAUNA[sp]||Gm.SEA[sp]||Gm.CAVERN[sp]).geo();
const ALL=['hopper',...LAND,...SEA,...CAVE,'guard1','guard2'];

/* ---------------- the vertex shader, transcribed ---------------- */
function wave(m,rect,ph){const s=Math.sin(ph*m[3]+m[1]);return m[0]*(rect?Math.max(s,0):s)+m[2];}
function rot(v,k,a){       // Rodrigues, exactly rigTurn
    const c=Math.cos(a),s=Math.sin(a),d=k.x*v.x+k.y*v.y+k.z*v.z;
    const cx=k.y*v.z-k.z*v.y,cy=k.z*v.x-k.x*v.z,cz=k.x*v.y-k.y*v.x;
    return {x:v.x*c+cx*s+k.x*d*(1-c),y:v.y*c+cy*s+k.y*d*(1-c),z:v.z*c+cz*s+k.z*d*(1-c)};
}
function spine(sp,s,ph){const d=sp.s0-s,e=Math.min(1,Math.max(0,d/sp.len));return sp.amp*e*e*Math.sin(ph*(sp.freq||1)-sp.k*d);}
/* one vertex through the rig */
function rigVertex(rig,x,y,z,bone,ph,amp,swim){
    let p={x,y,z};
    const k=amp;
    if(k>0.0001){
        let rb=Math.round(bone);
        for(let i=0;i<G.RIG_DEPTH;i++){
            if(rb<=0||rb>=G.RIG_MAX)break;
            const b=rig.bones[rb];
            const a=k*((1-swim)*wave(b.w,b.w[4]?1:0,ph)+swim*wave(b.s,b.s[4]?1:0,ph));
            const q=rot({x:p.x-b.p.x,y:p.y-b.p.y,z:p.z-b.p.z},b.axis,a);
            p={x:q.x+b.p.x,y:q.y+b.p.y,z:q.z+b.p.z};
            rb=b.parent;
        }
        if(rig.spine){
            const S=rig.spine,s=p.x*S.along.x+p.y*S.along.y+p.z*S.along.z,d=k*spine(S,s,ph);
            p={x:p.x+S.disp.x*d,y:p.y+S.disp.y*d,z:p.z+S.disp.z*d};
        }
    }
    return p;
}
function rigPose(g,ph,amp,swim){
    const P=g.attributes.position.array,Bn=g.attributes.aBone.array,rig=g.userData.rig,out=new Float32Array(P.length);
    for(let v=0;v<Bn.length;v++){
        const q=rigVertex(rig,P[v*3],P[v*3+1],P[v*3+2],Bn[v],ph,amp,swim||0);
        out[v*3]=q.x;out[v*3+1]=q.y;out[v*3+2]=q.z;
    }
    return out;
}
const vertsOf=(g,bone)=>{const r=[];const Bn=g.attributes.aBone.array;for(let v=0;v<Bn.length;v++)if(Bn[v]===bone)r.push(v);return r;};
const minY=(arr,vs)=>Math.min(...vs.map(v=>arr[v*3+1]));
const meanZ=(arr,vs)=>vs.reduce((a,v)=>a+arr[v*3+2],0)/vs.length;
const meanY=(arr,vs)=>vs.reduce((a,v)=>a+arr[v*3+1],0)/vs.length;
/* the foot bones of a walker: bones no other bone names as parent, whose
   vertices reach the ground at rest */
function footBones(g){
    const rig=g.userData.rig,P=g.attributes.position.array;
    const parents=new Set(rig.bones.slice(1).map(b=>b.parent));
    const out=[];
    for(let i=1;i<rig.bones.length;i++){
        if(parents.has(i))continue;
        const vs=vertsOf(g,i);
        if(vs.length&&minY(P,vs)<0.06)out.push(i);
    }
    return out;
}
const PH=[...Array(48).keys()].map(i=>i/48*Math.PI*2);
/* the lowest point of a foot IN THE WORLD: the rig's pose, plus the body dip
   the CPU applies through the instance matrix (updateResidents /
   updateGroundGuards) — rig.bob at the ends of the stride, stride squared */
const dipAt=(rig,ph)=>rig.bob*(0.5-0.5*Math.cos(2*ph));
const footY=(g,ph,vs)=>minY(rigPose(g,ph,1,0),vs)-dipAt(g.userData.rig,ph);

console.log('\n== 1. THE REST POSE IS THE SHIPPED GEOMETRY ==');
for(const sp of ALL)T(sp+': position, normal and colour arrays byte-identical to the baseline',()=>{
    const a=geoOf(G,sp),b=geoOf(B,sp);
    for(const k of ['position','normal','color']){
        const x=a.attributes[k].array,y=b.attributes[k].array;
        eq(x.length,y.length,k+' length:');
        for(let i=0;i<x.length;i++)if(x[i]!==y[i])throw new Error(k+'['+i+'] '+x[i]+' vs '+y[i]);
    }
});
T('a merged prop that names no bones gets no aBone (saucer, dart, a hut)',()=>{
    ok(!G.makeSaucerGeo(0x44aa66,0x223344).attributes.aBone,'saucer');
    ok(!G.makeDartGeo(0x44aa66,0x223344).attributes.aBone,'dart');
    ok(!G.makeDomeHutGeo(0x44aa66,0x223344,1).attributes.aBone,'hut');
    ok(!G.FAUNA.hopper.geo().attributes.aBone,'the hopper has no bones — its animation is its instance matrix');
});

console.log('\n== 2. THE RIGS ==');
for(const sp of ALL.filter(s=>s!=='hopper'))T(sp+': bones sane, all used, pivots on their own geometry',()=>{
    const g=geoOf(G,sp),rig=g.userData.rig,P=g.attributes.position.array;
    ok(rig,'no rig');ok(g.attributes.aBone,'no aBone');
    ok(rig.bones.length<=G.RIG_MAX,'too many bones');
    const Bn=g.attributes.aBone.array,used=new Set(Bn);
    for(let i=1;i<rig.bones.length;i++){
        const b=rig.bones[i];
        ok(b.parent<i,'bone '+i+' parent '+b.parent+' is not earlier (the chain walk would still work, but a table out of order is a table nobody checked)');
        ok(Math.abs(b.axis.length()-1)<1e-6,'axis not unit');
        /* every bone moves something: its own vertices, or — a joint with two
           axes at one pivot, like the ankles — the bone that hangs from it */
        ok(used.has(i)||rig.bones.some((c,j)=>j&&c.parent===i&&used.has(j)),'bone '+i+' drives no vertex');
        if(!used.has(i))continue;                 // a pure joint: nothing of its own to sit on
        let d=1;for(let q=b.parent;q;q=rig.bones[q].parent)d++;
        ok(d<=G.RIG_DEPTH,'chain too deep');
        /* the pivot must sit ON the part it turns — inside the box its own
           vertices span, give or take a few cm. A pivot out in empty space
           swings the part through the air instead of about its joint. (Not
           "near a vertex": a fin cone has vertices only at its tip and its
           base, and its root is correctly halfway along.) */
        const lo=[1e9,1e9,1e9],hi=[-1e9,-1e9,-1e9];
        for(const v of vertsOf(g,i))for(let a=0;a<3;a++){lo[a]=Math.min(lo[a],P[v*3+a]);hi[a]=Math.max(hi[a],P[v*3+a]);}
        const pv=[b.p.x,b.p.y,b.p.z];
        for(let a=0;a<3;a++)ok(pv[a]>lo[a]-0.08&&pv[a]<hi[a]+0.08,'bone '+i+' pivot '+'xyz'[a]+'='+pv[a].toFixed(2)+' outside its part ['+lo[a].toFixed(2)+','+hi[a].toFixed(2)+']');
    }
    for(const x of Bn)ok(x>=0&&x<rig.bones.length&&x===Math.round(x),'bad aBone '+x);
});
T('the rig fits the shader: RIG_MAX*4+4 uniform vectors, well inside WebGL2\'s guaranteed 256',()=>{
    ok(G.RIG_MAX*4+4<=128,'rig uniforms '+(G.RIG_MAX*4+4)+' leave three\'s own Lambert uniforms too little room');
});

console.log('\n== 3. THE SHADER PORT: STANDING STILL IS THE MODEL ==');
for(const sp of ALL.filter(s=>s!=='hopper'))T(sp+': stride 0 leaves every vertex exactly where it was',()=>{
    const g=geoOf(G,sp),P=g.attributes.position.array,Q=rigPose(g,1.234,0,0);
    for(let i=0;i<P.length;i++)if(P[i]!==Q[i])throw new Error('vertex moved at stride 0');
});

console.log('\n== 4. THE GAIT: FEET ==');
for(const sp of [...QUAD,'caveman','guard1','guard2'])T(sp+': every foot stays near the ground on stance, lifts on the swing, never digs in',()=>{
    const g=geoOf(G,sp),feet=footBones(g);
    ok(feet.length===(QUAD.includes(sp)?4:2),'expected '+(QUAD.includes(sp)?4:2)+' feet, found '+feet.length);
    for(const f of feet){
        const vs=vertsOf(g,f);
        let lo=1e9,hi=-1e9;
        for(const ph of PH){const y=footY(g,ph,vs);lo=Math.min(lo,y);hi=Math.max(hi,y);}
        const rest=minY(g.attributes.position.array,vs);
        ok(lo>rest-0.06,'bone '+f+' digs in to '+(lo-rest).toFixed(3));
        ok(hi-rest>0.03,'bone '+f+' never lifts ('+(hi-rest).toFixed(3)+')');
    }
});
/* NO-SKATE, AND THE RIGHT HALF OF THE CYCLE ON THE GROUND. The stance is
   the half of the cycle in which the foot sweeps BACKWARD relative to the
   body; over it the foot must travel back at about the rate the body goes
   forward (rig.cyc is ground per radian of gait, so the ratio of the two is
   1 for a planted foot — a sine is not a real stance, so the band is wide,
   but a factor of two either way is a visibly moonwalking or scrabbling
   animal), and it must be the LOW half: a foot that folds up while it pushes
   back and plants itself while it reaches forward has the gait inside out. */
for(const sp of [...QUAD,'caveman','guard1','guard2'])T(sp+': the foot is down while it sweeps back, at the body\'s own speed (no skating)',()=>{
    const g=geoOf(G,sp),rig=g.userData.rig,feet=footBones(g),fwd=sp.startsWith('guard')?-1:1;
    for(const f of feet){
        const vs=vertsOf(g,f);
        const zs=[],ys=[];
        for(const ph of PH){const a=rigPose(g,ph,1,0);zs.push(meanZ(a,vs)*fwd);ys.push(minY(a,vs)-dipAt(rig,ph));}
        let back=0,nb=0,yb=0,nf=0,yf=0;
        for(let i=0;i<PH.length;i++){
            const j=(i+1)%PH.length,dz=zs[j]-zs[i],y=(ys[i]+ys[j])/2;
            if(dz<0){back-=dz;nb++;yb+=y;}else{nf++;yf+=y;}
        }
        const ratio=(back/(nb*(PH[1]-PH[0])))/rig.cyc;
        ok(ratio>0.5&&ratio<2,'bone '+f+' skates: foot sweep / body travel = '+ratio.toFixed(2));
        ok(yb/nb<yf/nf-0.02,'bone '+f+': the foot is not lower while it pushes back ('+(yb/nb).toFixed(3)+' vs '+(yf/nf).toFixed(3)+')');
    }
});
/* PLANTED. In a trot and on two legs the body dip is what keeps the stance
   foot down while the leg sweeps through its arc: over the whole stance (the
   half of the cycle the foot is not folded up) it must stay within a few cm
   of the ground. */
for(const sp of ['wolf','sabre','caveman','guard1','guard2'])T(sp+': the stance foot stays planted through the whole stance',()=>{
    const g=geoOf(G,sp),feet=footBones(g),rest=g.attributes.position.array;
    for(const f of feet){
        const vs=vertsOf(g,f),y0=minY(rest,vs);
        const ys=PH.map(ph=>footY(g,ph,vs)-y0).sort((a,b)=>a-b);
        const stance=ys.slice(0,PH.length/2);                  // the lower half of the cycle
        ok(stance[stance.length-1]-stance[0]<0.05,'bone '+f+' bobs '+(stance[stance.length-1]-stance[0]).toFixed(3)+' through its stance');
    }
});
T('wolf and sabre TROT: diagonal feet move together, lateral pairs opposite',()=>{
    for(const sp of ['wolf','sabre']){
        const g=geoOf(G,sp),P=g.attributes.position.array,feet=footBones(g);
        const z=(ph,f)=>meanZ(rigPose(g,ph,1,0),vertsOf(g,f));
        const side=f=>Math.sign(meanZ(P,vertsOf(g,f)))*10+Math.sign(g.userData.rig.bones[f].p.x);   // fore/hind, left/right
        const byKey={};for(const f of feet)byKey[side(f)]=f;
        const LF=byKey[11],RF=byKey[9],LH=byKey[-9],RH=byKey[-11];
        ok(LF&&RF&&LH&&RH,'could not identify the four feet');
        const ph=Math.PI/2;
        ok(Math.sign(z(ph,LF)-meanZ(P,vertsOf(g,LF)))===Math.sign(z(ph,RH)-meanZ(P,vertsOf(g,RH))),sp+': LF and RH not together');
        ok(Math.sign(z(ph,LF)-meanZ(P,vertsOf(g,LF)))!==Math.sign(z(ph,RF)-meanZ(P,vertsOf(g,RF))),sp+': LF and RF not opposite');
    }
});
T('bison and mammoth WALK: the four-beat lateral sequence, hind then fore on each side',()=>{
    for(const sp of ['bison','mammoth']){
        const g=geoOf(G,sp),feet=footBones(g),P=g.attributes.position.array,rig=g.userData.rig;
        /* each foot's swing, by the phase it is lifted highest */
        const peak=f=>{let best=-1e9,at=0;for(const ph of PH){const y=minY(rigPose(g,ph,1,0),vertsOf(g,f));if(y>best){best=y;at=ph;}}return at;};
        const name=f=>(rig.bones[f].p.x>0?'L':'R')+(meanZ(P,vertsOf(g,f))>0?'F':'H');
        const order=feet.map(f=>[peak(f),name(f)]).sort((a,b)=>a[0]-b[0]).map(x=>x[1]);
        /* cyclic: LH, LF, RH, RF from wherever the cycle starts */
        const want=['LH','LF','RH','RF'],k=order.indexOf('LH');
        const got=order.slice(k).concat(order.slice(0,k)).join(' ');
        eq(got,want.join(' '),sp+' footfall order:');
    }
});
T('troopers walk FORWARD along -Z, and a negative speed runs the cycle backwards',()=>{
    const g=geoOf(G,'guard1'),rig=g.userData.rig,f=footBones(g)[0],vs=vertsOf(g,f);
    /* forward walking: over the swing (foot lifted) the foot must move toward -Z */
    let fwd=0;
    for(let i=0;i<PH.length;i++){
        const a=rigPose(g,PH[i],1,0),b=rigPose(g,PH[(i+1)%PH.length],1,0);
        if(minY(a,vs)>minY(g.attributes.position.array,vs)+0.03)fwd+=meanZ(a,vs)-meanZ(b,vs);
    }
    ok(fwd>0,'the swing carries the foot backwards');
    const rec={};
    G.mobAnimGait(rec,rig,0.1,-2.4,1.08,false);
    ok(rec.aPh>Math.PI,'backing off did not run the phase backwards ('+rec.aPh+')');
});

console.log('\n== 5. THE GAIT: HEADS, TAILS, TRUNKS, WATER ==');
T('a swimming quadruped holds its head up; a walking one only nods',()=>{
    for(const sp of QUAD){
        const g=geoOf(G,sp),rig=g.userData.rig,P=g.attributes.position.array;
        const hb=rig.bones.findIndex((b,i)=>i&&b.w[3]===2&&b.axis.x===1);   // the nodding bone
        const vs=vertsOf(g,hb);
        const rest=meanY(P,vs);
        let swimLo=1e9,walkHi=-1e9;
        for(const ph of PH){swimLo=Math.min(swimLo,meanY(rigPose(g,ph,1,1),vs));
                            walkHi=Math.max(walkHi,Math.abs(meanY(rigPose(g,ph,1,0),vs)-rest));}
        ok(swimLo>rest+0.02,sp+': head not raised to swim ('+(swimLo-rest).toFixed(3)+')');
        ok(walkHi<0.12,sp+': walking head bobs '+walkHi.toFixed(3));
    }
});
T('in water the long tails stream out BEHIND (tip further back than at rest)',()=>{
    for(const sp of ['wolf','sabre']){
        const g=geoOf(G,sp),P=g.attributes.position.array,rig=g.userData.rig;
        const tipBone=rig.bones.length-1;         // the last tail bone quadruped() adds
        const vs=vertsOf(g,tipBone);
        let z=0;for(const ph of PH)z+=meanZ(rigPose(g,ph,1,1),vs);
        ok(z/PH.length<meanZ(P,vs)-0.1,sp+': tail tip not streaming back');
    }
});
T('the mammoth lifts its trunk in water (tip rises), and sways it walking',()=>{
    const g=geoOf(G,'mammoth'),rig=g.userData.rig,P=g.attributes.position.array;
    const trunkTip=rig.bones.findIndex((b,i)=>i&&b.axis.z===1&&b.w[1]<-2.5);   // k4: sways about Z, most lag
    ok(trunkTip>0,'no trunk tip bone');
    const vs=vertsOf(g,trunkTip);
    let y=0;for(const ph of PH)y+=meanY(rigPose(g,ph,1,1),vs);
    ok(y/PH.length>meanY(P,vs)+0.25,'trunk does not rise to snorkel');
    let sway=0;for(const ph of PH){const a=rigPose(g,ph,1,0);sway=Math.max(sway,Math.abs(vs.reduce((s,v)=>s+a[v*3],0)/vs.length));}
    ok(sway>0.05,'trunk does not sway');
});

console.log('\n== 6. SWIMMERS AND FLIERS ==');
for(const sp of SEA)T(sp+': the head holds, the tail sweeps (the wave runs nose to tail)',()=>{
    const g=geoOf(G,sp),rig=g.userData.rig,P=g.attributes.position.array,S=rig.spine;
    let zMax=-1e9,zMin=1e9;for(let v=0;v<P.length/3;v++){zMax=Math.max(zMax,P[v*3+2]);zMin=Math.min(zMin,P[v*3+2]);}
    const head=[],tail=[];
    for(let v=0;v<P.length/3;v++){if(P[v*3+2]>zMax-0.1)head.push(v);if(P[v*3+2]<zMin+0.1)tail.push(v);}
    const ax=S.disp.x?0:1;
    let hMove=0,tMove=0;
    for(const ph of PH){
        const a=rigPose(g,ph,1,0);
        for(const v of head)hMove=Math.max(hMove,Math.abs(a[v*3+ax]-P[v*3+ax]));
        for(const v of tail)tMove=Math.max(tMove,Math.abs(a[v*3+ax]-P[v*3+ax]));
    }
    ok(hMove<0.02,'head moves '+hMove.toFixed(3));
    ok(tMove>S.amp*0.6,'tail sweeps only '+tMove.toFixed(3));
    /* cetaceans beat VERTICALLY, fish and sharks side to side — the
       v2.11.11 fluke/caudal assertions, now for the motion as well */
    eq(ax,sp==='dolphin'||sp==='whale'?1:0,'wave axis:');
});
T('FoxBat: both wings rise together and fall together, tips lagging',()=>{
    const g=geoOf(G,'foxbat'),rig=g.userData.rig,P=g.attributes.position.array;
    const wings=rig.bones.map((b,i)=>i&&b.parent===0?i:0).filter(Boolean);
    eq(wings.length,2,'wing bones:');
    const up=rigPose(g,Math.PI/2,1,0),dn=rigPose(g,Math.PI*1.5,1,0);
    for(const w of wings){
        const vs=vertsOf(g,w);
        ok(meanY(up,vs)>meanY(P,vs)+0.05,'wing '+w+' not up at the top of the stroke');
        ok(meanY(dn,vs)<meanY(P,vs)-0.05,'wing '+w+' not down at the bottom');
    }
});
T('ghost: the face holds, the hem ripples, the tatters trail behind',()=>{
    const g=geoOf(G,'ghost'),P=g.attributes.position.array;
    let face=0,hem=0,trail=0;
    const tat=vertsOf(g,1).concat(vertsOf(g,2));
    for(const ph of PH){
        const a=rigPose(g,ph,1,0);
        for(let v=0;v<P.length/3;v++){
            const d=Math.abs(a[v*3]-P[v*3]);
            if(P[v*3+1]>0.45)face=Math.max(face,d);
            if(P[v*3+1]<-0.3)hem=Math.max(hem,d);
        }
        trail+=meanZ(a,tat)-meanZ(P,tat);
    }
    ok(face<0.01,'face moves '+face.toFixed(3));
    ok(hem>0.05,'hem still');
    ok(trail/PH.length<-0.02,'tatters do not trail');
});

console.log('\n== 7. THE MATERIAL ==');
T('rigCompile finds all three anchors in three r170\'s Lambert shader and threads rigPos through',()=>{
    const mat=new THREE.MeshLambertMaterial({vertexColors:true,flatShading:true});
    G.rigMaterial(mat,G.FAUNA.wolf.geo().userData.rig);
    const sh={uniforms:{},vertexShader:THREE.ShaderLib.lambert.vertexShader,fragmentShader:''};
    mat.onBeforeCompile(sh);
    for(const k of ['uRigP','uRigX','uRigW','uRigS','uSpA','uSpL','uSpD','uAnimOn'])ok(sh.uniforms[k],'uniform '+k);
    eq(sh.uniforms.uAnimOn,G.MOB_ANIM.U,'uAnimOn is the ONE shared fade uniform:');
    eq(sh.uniforms.uRigP.value.length,G.RIG_MAX,'uRigP length:');
    const vs=sh.vertexShader;
    ok(vs.indexOf('uniform vec4 uRigP[RIG_MAX]')>vs.indexOf('#include <common>'),'declarations not after <common>');
    const bn=vs.indexOf('#include <beginnormal_vertex>'),rp=vs.indexOf('vec3 rigPos'),bv=vs.indexOf('#include <begin_vertex>'),tr=vs.indexOf('transformed=rigPos');
    ok(bn>=0&&rp>bn&&bv>rp&&tr>bv,'rig block order wrong');
    ok(vs.indexOf('#include <defaultnormal_vertex>')>rp,'the normal is transformed before the rig bends it');
});
T('every rigged material shares ONE onBeforeCompile (one program per shading variant)',()=>{
    const a=new THREE.MeshLambertMaterial(),b=new THREE.MeshLambertMaterial();
    G.rigMaterial(a,G.FAUNA.wolf.geo().userData.rig);G.rigMaterial(b,G.SEA.whale.geo().userData.rig);
    eq(a.onBeforeCompile,b.onBeforeCompile,'');
    eq(a.customProgramCacheKey(),b.customProgramCacheKey(),'cache key:');
});
T('a shader the rig was not written against is left stock (no half-patched program)',()=>{
    const mat=new THREE.MeshLambertMaterial();
    G.rigMaterial(mat,G.FAUNA.wolf.geo().userData.rig);
    const sh={uniforms:{},vertexShader:'void main(){\n#include <begin_vertex>\n}',fragmentShader:''};
    mat.onBeforeCompile(sh);
    eq(sh.vertexShader,'void main(){\n#include <begin_vertex>\n}','');
    ok(!sh.uniforms.uRigP,'uniforms added anyway');
});
T('mobAnimAttach: per-instance aAnim, rigged material; FISH_GEO cloned, never shared',()=>{
    const im=new THREE.InstancedMesh(G.FISH_GEO,new THREE.MeshLambertMaterial(),20);
    G.mobAnimAttach(im,20);
    ok(im.geometry!==G.FISH_GEO,'fish mesh still on the shared FISH_GEO');
    ok(!G.FISH_GEO.attributes.aAnim,'the shared FISH_GEO grew an instance attribute');
    ok(im.geometry.attributes.aAnim&&im.geometry.attributes.aAnim.isInstancedBufferAttribute,'no aAnim');
    eq(im.geometry.attributes.aAnim.count,20,'aAnim count:');
    ok(im.material.onBeforeCompile===G.rigCompile,'material not rigged');
    const hop=new THREE.InstancedMesh(G.FAUNA.hopper.geo(),new THREE.MeshLambertMaterial(),4);
    G.mobAnimAttach(hop,4);
    ok(!hop.userData.anim&&hop.material.onBeforeCompile!==G.rigCompile,'the boneless hopper was rigged');
});

console.log('\n== 8. THE GATE ==');
const A=G.MOB_ANIM;
const snap=()=>({...A});
const restore=s=>{Object.assign(A,s);};
function probeWith({search='',ua='node-headless',cores,mem,gpu,platform='linux',touch=0}={}){
    const oldLoc=globalThis.location,oldNav=globalThis.navigator,oldCtx=G.renderer.getContext;
    globalThis.location={href:'file:///x.html',search};
    Object.defineProperty(globalThis,'navigator',{configurable:true,writable:true,
        value:{userAgent:ua,hardwareConcurrency:cores,deviceMemory:mem,platform,maxTouchPoints:touch}});
    if(gpu)G.renderer.getContext=()=>({getExtension:()=>({UNMASKED_RENDERER_WEBGL:1}),getParameter:()=>gpu});
    try{return [G.mobAnimProbe(),A.why];}
    finally{
        globalThis.location=oldLoc;
        Object.defineProperty(globalThis,'navigator',{configurable:true,writable:true,value:oldNav});
        G.renderer.getContext=oldCtx;
    }
}
T('a desktop with a real GPU, 8 cores and 8 GB is capable',()=>{
    const s=snap();try{eq(probeWith({cores:8,mem:8,gpu:'ANGLE (NVIDIA GeForce RTX 3060)'})[0],true,'');}finally{restore(s);}
});
T('software rasterisers are refused (SwiftShader, llvmpipe, Microsoft Basic Render)',()=>{
    const s=snap();
    try{for(const gpu of ['ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)',
                         'llvmpipe (LLVM 15.0.7, 256 bits)','Microsoft Basic Render Driver'])
        eq(probeWith({cores:8,mem:8,gpu})[0],false,gpu+':');}
    finally{restore(s);}
});
T('too few cores or too little memory is refused; a phone needs 6 cores',()=>{
    const s=snap();
    try{
        eq(probeWith({cores:2,mem:8})[0],false,'2 cores:');
        eq(probeWith({cores:8,mem:2})[0],false,'2 GB:');
        eq(probeWith({cores:4,mem:8})[0],!G.IS_MOBILE,'4 cores:');
    }finally{restore(s);}
});
T('what a browser will not say is not held against it (iOS reports 2 cores)',()=>{
    const s=snap();
    try{
        eq(probeWith({ua:'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',cores:2})[0],true,'iPhone:');
        eq(probeWith({})[0],true,'nothing reported:');
    }finally{restore(s);}
});
T('?anim=0 and ?anim=1 force the answer — even against a software rasteriser',()=>{
    const s=snap();
    try{
        const off=probeWith({search:'?anim=0',cores:16,mem:8});eq(off[0],false,'?anim=0:');eq(A.forced,false,'forced:');
        const on=probeWith({search:'?anim=1',gpu:'SwiftShader'});eq(on[0],true,'?anim=1:');eq(A.forced,true,'forced:');
    }finally{restore(s);}
});
T('governor: 3 s under the floor stands it down; one good window resets the count',()=>{
    const s=snap();
    try{
        Object.assign(A,{capable:true,forced:null,on:true,slow:0,fast:0,trips:0});
        for(let i=0;i<G.MOB_ANIM_SLOW_N-1;i++)G.mobAnimGovern(30,500,true);
        eq(A.on,true,'stood down early:');
        G.mobAnimGovern(60,500,true);                                  // a good window
        for(let i=0;i<G.MOB_ANIM_SLOW_N-1;i++)G.mobAnimGovern(30,500,true);
        eq(A.on,true,'the good window did not reset the count:');
        G.mobAnimGovern(30,500,true);
        eq(A.on,false,'did not stand down:');eq(A.trips,1,'trips:');
        ok(/paused/.test(A.why),'status: '+A.why);
    }finally{restore(s);}
});
T('governor: 20 s over RESUME brings it back; after 3 trips it stays down',()=>{
    const s=snap();
    try{
        Object.assign(A,{capable:true,forced:null,on:false,slow:0,fast:0,trips:1});
        for(let i=0;i<G.MOB_ANIM_FAST_N-1;i++)G.mobAnimGovern(60,500,true);
        eq(A.on,false,'came back early:');
        G.mobAnimGovern(60,500,true);
        eq(A.on,true,'did not come back:');
        Object.assign(A,{on:true,trips:G.MOB_ANIM_TRIPS-1,slow:0});
        for(let i=0;i<G.MOB_ANIM_SLOW_N;i++)G.mobAnimGovern(20,500,true);
        eq(A.on,false,'');ok(/^off/.test(A.why),'status: '+A.why);
        for(let i=0;i<G.MOB_ANIM_FAST_N*3;i++)G.mobAnimGovern(120,500,true);
        eq(A.on,false,'came back after the last trip:');
    }finally{restore(s);}
});
T('governor: a stall window, a forced answer, or not-ready judges nothing',()=>{
    const s=snap();
    try{
        Object.assign(A,{capable:true,forced:null,on:true,slow:0,fast:0,trips:0});
        for(let i=0;i<20;i++)G.mobAnimGovern(2,1600,true);            // a window spanning a stall
        eq(A.on,true,'a stall stood it down:');
        for(let i=0;i<20;i++)G.mobAnimGovern(20,500,false);           // not a fair moment
        eq(A.on,true,'judged while not ready:');
        A.forced=true;
        for(let i=0;i<20;i++)G.mobAnimGovern(5,500,true);
        eq(A.on,true,'overrode ?anim=1:');
        ok(G.mobAnimJudging()===false,'judging before the game has started');
    }finally{restore(s);}
});
T('the fade: half a second each way, one shared uniform',()=>{
    const s=snap();
    try{
        Object.assign(A,{capable:true,on:false,k:1});
        G.mobAnimTick(0.1);ok(Math.abs(A.k-0.8)<1e-9,'k '+A.k);eq(A.U.value,A.k,'uniform:');
        for(let i=0;i<10;i++)G.mobAnimTick(0.1);eq(A.k,0,'');
        A.on=true;for(let i=0;i<5;i++)G.mobAnimTick(0.1);ok(Math.abs(A.k-1)<1e-9,'k '+A.k);
    }finally{restore(s);}
});

console.log('\n== 9. IN THE LOOP ==');
T('a herd of wolves walks through updateResidents: phase advances, stride rises, the slot carries both',()=>{
    const b=makeBody(G,THREE,{R:200});
    b.chunks={get:()=>({mesh:b.mesh}),values:()=>[][Symbol.iterator]()};   // every chunk "loaded", floor = the fixture sphere
    b.simplex={noise3D:()=>0};b.noiseScale=0.01;                             // the lava probe reads the terrain noise
    ok(activate(G,b),'fixture is not activeBody');
    const dir=new THREE.Vector3(0.3,1,0.2).normalize();
    for(let k=0;k<3;k++){
        const d=dir.clone().add(new THREE.Vector3(k*0.01,0,-k*0.01)).normalize();
        G.spawnMobAt(b,d,{pos:d.clone().multiplyScalar(200),r:200},'wolf',1);
    }
    for(let i=0;i<60;i++)G.updateResidents(1/60);
    const im=b.mobSp.get('wolf');
    ok(im.userData.anim,'wolf mesh has no aAnim');
    eq(im.material.onBeforeCompile,G.rigCompile,'wolf material not rigged:');
    const arr=im.userData.anim.array;
    ok(b.mobs.length===3,'wolves lost: '+b.mobs.length);
    for(let s=0;s<3;s++){
        const m=b._mobSlot[s];
        ok(m.aAmp>0.5,'stride '+m.aAmp);
        ok(m.aPh>0.5,'phase '+m.aPh);
        ok(Math.abs(arr[s*3]-m.aPh)<1e-5&&Math.abs(arr[s*3+1]-m.aAmp)<1e-5,'slot '+s+' does not carry its own wolf');
    }
});
T('standing down restores the shipped squash and stops writing the slot',()=>{
    const s=snap();
    try{
        const b=G.activeBody,im=b.mobSp.get('wolf'),arr=im.userData.anim.array;
        A.k=0;A.U.value=0;
        const before=Array.from(arr);
        for(let i=0;i<30;i++)G.updateResidents(1/60);
        eq(JSON.stringify(Array.from(arr)),JSON.stringify(before),'slot written at k=0:');
        /* the shipped pose: unit x/z scale, the walkT squash in y */
        const m4=new THREE.Matrix4(),p=new THREE.Vector3(),q=new THREE.Quaternion(),sc=new THREE.Vector3();
        im.getMatrixAt(0,m4);m4.decompose(p,q,sc);
        ok(Math.abs(sc.x-1)<1e-6&&Math.abs(sc.z-1)<1e-6,'x/z scale '+sc.x+','+sc.z);
        const m=b._mobSlot[0];
        ok(Math.abs(sc.y-(1+Math.sin(m.walkT)*0.035))<1e-5,'not the shipped squash: '+sc.y);
    }finally{restore(s);}
});
T('the hopper squashes and stretches (volume kept) and leans into the hop',()=>{
    const b=G.activeBody;
    const d=new THREE.Vector3(-0.2,1,0.5).normalize();
    G.spawnMobAt(b,d,{pos:d.clone().multiplyScalar(200),r:200},'hopper',2);
    const im=b.mobSp.get('hopper');
    let minY=9,maxY=0,volErr=0,maxLean=0,maxBottomGap=0;
    const m4=new THREE.Matrix4(),p=new THREE.Vector3(),q=new THREE.Quaternion(),sc=new THREE.Vector3();
    for(let i=0;i<240;i++){
        G.updateResidents(1/60);
        const slot=b._mobSlot.findIndex(r=>r&&r.sp==='hopper');
        im.getMatrixAt(slot,m4);m4.decompose(p,q,sc);
        minY=Math.min(minY,sc.y);maxY=Math.max(maxY,sc.y);
        /* grounded (not mid-hop), the bottom of the blob must stay where the
           shipped unsquashed hopper's bottom was: centre lift + (sy-1)*foot */
        const hop=b._mobSlot[slot],hopS=Math.max(0,Math.sin(hop.hopT));
        if(hopS===0&&hop.vr<=0.2){
            const lift=p.clone().sub(b.position).length()-hop.r;
            maxBottomGap=Math.max(maxBottomGap,Math.abs(lift-(sc.y-1)*G.FAUNA.hopper.foot));
        }
        volErr=Math.max(volErr,Math.abs(sc.x*sc.y*sc.z-1));
        const up=p.clone().sub(b.position).normalize();
        const bodyUp=new THREE.Vector3(0,1,0).applyQuaternion(q);
        maxLean=Math.max(maxLean,bodyUp.angleTo(up));
    }
    ok(minY<0.9,'never crouches ('+minY.toFixed(3)+')');
    ok(maxBottomGap<0.02,'the crouch lifts it off the ground by '+maxBottomGap.toFixed(3));
    ok(maxY>1.1,'never stretches ('+maxY.toFixed(3)+')');
    ok(volErr<0.02,'volume drifts by '+volErr.toFixed(3));
    ok(maxLean>0.15,'never leans ('+maxLean.toFixed(3)+')');
});

T('a swimmer and a flier write their beat into their OWN species\' slot',()=>{
    const s=snap();
    try{
        A.k=1;
        const mk=(geo,cap)=>{const im=new THREE.InstancedMesh(geo,new THREE.MeshLambertMaterial(),cap);G.mobAnimAttach(im,cap);return im;};
        const fishIm=mk(G.FISH_GEO,G.SEA_CAP),shark=mk(G.SEA.shark.geo(),G.SEA_CAP);
        const body={seaSp:new Map([['fish',fishIm],['shark',shark]]),seaParts:[fishIm,shark],_fishSlot:[]};
        const f={sp:'shark',aV:G.SEA.shark.speed*2,hue:0.3};
        for(let i=0;i<30;i++)G.seaAnim(body,f,G.SEA.shark,1/30,false);
        ok(f.aAmp>1,'a bolting shark beats harder: '+f.aAmp);
        G.writeSeaSlot(body,f,G.SEA.shark,3,new THREE.Matrix4());
        ok(Math.abs(shark.userData.anim.array[9]-f.aPh)<1e-6,'shark slot 3 not written');
        eq(fishIm.userData.anim.array[9],0,'the fish mesh got the shark\'s beat:');
        const st={sp:'fish',hue:0.1};
        let flopped=0;for(let i=0;i<300;i++){G.seaAnim(body,st,G.SEA.fish,1/30,true);flopped=Math.max(flopped,st.aAmp);}
        ok(flopped>0.5,'a stranded fish never flops');
        const bat=mk(G.CAVERN.foxbat.geo(),G.CAVER_CAP);
        const cb={caverSp:new Map([['foxbat',bat]]),caverParts:[bat],_caverSlot:[]};
        const c={sp:'foxbat',hue:0.5};
        G.mobAnimSwim(c,bat.geometry.userData.rig,0.1,G.CAVERN.foxbat.speed,G.CAVERN.foxbat.speed,false);
        G.writeCaverSlot(cb,c,1,new THREE.Matrix4());
        ok(Math.abs(bat.userData.anim.array[3]-c.aPh)<1e-6&&c.aPh>1,'foxbat slot not written');
    }finally{restore(s);}
});
T('a driver that refuses the rig shader costs the animation, never the animals',()=>{
    const s=snap(),mats=A.mats.slice();
    try{
        ok(mats.length>0,'no rigged materials to retreat from');
        const v=mats.map(m=>m.version);
        G.mobAnimRetreat('off — test');
        eq(A.capable,false,'capable:');eq(A.k,0,'k:');eq(A.U.value,0,'uniform:');
        for(let i=0;i<mats.length;i++){
            ok(mats[i].onBeforeCompile!==G.rigCompile,'material '+i+' still rigged');
            ok(mats[i].version>v[i],'material '+i+' not flagged for a recompile');
        }
        eq(A.mats.length,0,'mats:');
        const im=new THREE.InstancedMesh(G.FAUNA.wolf.geo(),new THREE.MeshLambertMaterial(),4);
        G.mobAnimAttach(im,4);
        ok(!im.userData.anim,'a mesh built after the retreat was rigged');
    }finally{restore(s);A.mats=mats;for(const m of mats)m.onBeforeCompile=G.rigCompile;}
});

console.log('\n'+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
