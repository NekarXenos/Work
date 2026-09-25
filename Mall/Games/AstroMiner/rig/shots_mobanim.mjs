/* shots_mobanim.mjs — the creature rig in a REAL browser (Demo v2.13.11 /
   game v2.12.44). tests_mobanim.mjs checks the rig through a transcription of
   the vertex shader; this compiles the GLSL itself, draws every rigged species
   through the shipped build, and fails on any shader error.

     node shots_mobanim.mjs <build.html> [outDir]

   NEEDS, beside three r170 in ./node_modules (the rig's usual requirement):
   playwright-core in ./node_modules, and a Chromium it can drive — set
   CHROMIUM to its executable. The page runs on whatever GL the browser has;
   headless that is SwiftShader, which the game's own gate refuses, so the
   page is opened with ?anim=1 (the same override a player has).

   WHAT IT WRITES. gallery.png: every rigged species at four gait phases and a
   swim pose, side on (top down for the fish and shark, head on for the FoxBat
   and the ghost). frames/fNN.png: 24 labelled frames of one full cycle, for
   anyone who wants to stitch a preview. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const SRC=path.resolve(process.argv[2]||path.join(HERE,'..','Bleaux_Demo.html'));
const OUT=path.resolve(process.argv[3]||path.join(os.tmpdir(),'mobanim_shots'));
const THREE_DIR=path.join(HERE,'node_modules','three');
fs.mkdirSync(path.join(OUT,'frames'),{recursive:true});

/* the build, with its CDN imports pointed at the local three and one line at
   the end of the module handing the page the names this script drives */
let html=fs.readFileSync(SRC,'utf8');
html=html.replace('https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js','/three/build/three.module.js')
         .replace('https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/','/three/examples/jsm/');
const end=html.indexOf('</script>',html.indexOf('<script type="module">'));
html=html.slice(0,end)+'\nwindow.__G={THREE,FAUNA,SEA,CAVERN,buildGuardGeometry,mobAnimAttach,MOB_ANIM,renderer};\n'+html.slice(end);

const server=http.createServer((req,res)=>{
    const u=decodeURIComponent(req.url.split('?')[0]);
    if(u==='/'||u==='/build.html'){res.writeHead(200,{'Content-Type':'text/html'});res.end(html);return;}
    const f=u.startsWith('/three/')?path.join(THREE_DIR,u.slice(7)):path.join(path.dirname(SRC),u);
    fs.readFile(f,(e,d)=>{
        if(e){res.writeHead(404);res.end();return;}
        res.writeHead(200,{'Content-Type':f.endsWith('.js')?'text/javascript':'application/octet-stream'});res.end(d);
    });
});
await new Promise(r=>server.listen(0,r));
const port=server.address().port;

const browser=await chromium.launch({executablePath:process.env.CHROMIUM||undefined,
    args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1400,height:1000}});
const shaderErrors=[];
page.on('console',m=>{if(m.type()==='error'&&/shader|WebGLProgram/i.test(m.text()))shaderErrors.push(m.text().slice(0,400));});
page.on('pageerror',e=>shaderErrors.push('pageerror: '+e.message));
await page.goto('http://localhost:'+port+'/build.html?anim=1',{waitUntil:'load'});
await page.waitForFunction(()=>window.__G,{timeout:180000});

const info=await page.evaluate(()=>{
    const G=window.__G,{THREE}=G;
    G.renderer.setSize(1,1);                                   // the game keeps running; keep it cheap
    for(const el of document.body.children)el.style.visibility='hidden';
    const cells=[['wolf','Wolf — trot'],['sabre','Sabre-tooth — trot'],['bison','Bison — 4-beat walk'],
        ['mammoth','Mammoth — 4-beat walk'],['caveman','Caveman — walk'],['guard1','Reptilian trooper'],
        ['guard2','Mantid trooper'],['fish','Fish (from above)'],['shark','Shark (from above)'],['dolphin','Dolphin'],
        ['whale','Whale'],['foxbat','FoxBat (head on)'],['ghost','Ghost (head on)'],['wolf:swim','Wolf — paddling'],
        ['caveman:swim','Caveman — treading water']];
    const COLS=5,CW=256,CH=216,W=COLS*CW,H=Math.ceil(cells.length/COLS)*CH;
    const gl=document.createElement('canvas');gl.width=W;gl.height=H;
    const out=document.createElement('canvas');out.width=W;out.height=H;
    const r=new THREE.WebGLRenderer({canvas:gl,antialias:true,preserveDrawingBuffer:true});
    r.setPixelRatio(1);r.setSize(W,H,false);r.setScissorTest(true);r.setClearColor(0x1b2433);
    const geoOf=sp=>sp.startsWith('guard')?G.buildGuardGeometry(+sp.slice(5)):(G.FAUNA[sp]||G.SEA[sp]||G.CAVERN[sp]).geo();
    const view={fish:'top',shark:'top',foxbat:'front',ghost:'front'};
    const items=cells.map(([key,label],i)=>{
        const [sp,mode]=key.split(':');
        const scene=new THREE.Scene();
        scene.add(new THREE.AmbientLight(0xffffff,1.0));
        const dl=new THREE.DirectionalLight(0xffffff,2.2);dl.position.set(4,6,3);scene.add(dl);
        const geo=geoOf(sp);
        const mat=new THREE.MeshLambertMaterial({vertexColors:true,flatShading:sp!=='fish',
            emissive:sp==='ghost'?new THREE.Color(0x3a6080):new THREE.Color(0)});
        const im=new THREE.InstancedMesh(geo,mat,1);
        G.mobAnimAttach(im,1);
        im.setMatrixAt(0,new THREE.Matrix4());im.frustumCulled=false;scene.add(im);
        geo.computeBoundingBox();
        const bb=geo.boundingBox,c=bb.getCenter(new THREE.Vector3()),sz=bb.getSize(new THREE.Vector3());
        const v=view[sp]||'side';
        const span=(v==='side'?Math.max(sz.z,sz.y):v==='top'?Math.max(sz.z,sz.x):Math.max(sz.x,sz.y))*1.35;
        const asp=CW/(CH-22);
        const cam=new THREE.OrthographicCamera(-span/2*asp,span/2*asp,span/2,-span/2,0.01,100);
        if(v==='side'){cam.position.set(c.x+14,c.y+5,c.z+(sp.startsWith('guard')?-6:6));cam.up.set(0,1,0);}
        else if(v==='top'){cam.position.set(c.x,c.y+20,c.z);cam.up.set(0,0,-1);}
        else{cam.position.set(c.x,c.y+2,c.z+20);cam.up.set(0,1,0);}
        cam.lookAt(c);
        return {scene,im,cam,label,swim:mode==='swim'?1:0,i,rigged:!!im.userData.anim};
    });
    const g2=out.getContext('2d');
    window.__frame=ph=>{
        for(const it of items){
            const a=it.im.userData.anim;
            if(a){a.array[0]=ph;a.array[1]=1;a.array[2]=it.swim;a.needsUpdate=true;}
            const col=it.i%COLS,row=Math.floor(it.i/COLS),x=col*CW,y=H-(row+1)*CH;
            r.setViewport(x+3,y+3,CW-6,CH-26);r.setScissor(x+3,y+3,CW-6,CH-6);
            r.render(it.scene,it.cam);
        }
        g2.drawImage(gl,0,0);
        g2.font='bold 13px sans-serif';g2.fillStyle='#cfe3ff';
        for(const it of items)g2.fillText(it.label,(it.i%COLS)*CW+10,Math.floor(it.i/COLS)*CH+18);
        return out.toDataURL('image/png');
    };
    return {why:G.MOB_ANIM.why,unrigged:items.filter(it=>!it.rigged).map(it=>it.label),
            programs:r.info.programs?r.info.programs.length:0};
});
const N=24;
for(let f=0;f<N;f++){
    const url=await page.evaluate(ph=>window.__frame(ph),f/N*Math.PI*2);
    const png=Buffer.from(url.split(',')[1],'base64');
    fs.writeFileSync(path.join(OUT,'frames','f'+String(f).padStart(2,'0')+'.png'),png);
    if(f===0)fs.writeFileSync(path.join(OUT,'gallery.png'),png);
}
await browser.close();server.close();

console.log('creature animation:',info.why);
console.log('frames:',N,'written to',OUT);
let fail=0;
if(info.unrigged.length){console.log('  FAIL not rigged:',info.unrigged.join(', '));fail++;}
if(shaderErrors.length){console.log('  FAIL shader errors:\n    '+shaderErrors.join('\n    '));fail++;}
if(!fail)console.log('  ok   every species rigged, the rig shader compiled and drew with no errors');
process.exit(fail?1:0);
