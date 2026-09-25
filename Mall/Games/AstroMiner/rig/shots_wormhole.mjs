/* shots_wormhole.mjs — the wormhole, in a REAL browser (v2.12.45+).
   tests_wormhole.mjs proves the LOGIC headlessly (a synchronous setTimeout
   shim, a raycast bypassed by setting selIdx directly). This proves the
   PAGE: a real keypress, real clicks on the real Test-console buttons, and
   a real screenshot — which is what it takes to catch a CSS `!important`
   beating a JS state change. That exact bug shipped past the headless suite
   once already: toggleTestMenu() genuinely flipped testMenuOpen and wrote
   ui.test.style.display='flex', and a JS-only check read that as success,
   while #testmenu{display:none!important} kept the panel off screen. Only
   a rendered screenshot caught it.

     node shots_wormhole.mjs <build.html> [outDir]

   NEEDS, beside three r170 in ./node_modules: playwright-core in
   ./node_modules and a Chromium it can drive — set CHROMIUM to its
   executable. Runs on whatever GL the browser has; headless is usually
   SwiftShader, so the supernova and the warp render at a handful of fps —
   this drives the timeline by POLLING REAL GAME STATE (bigBlackHole,
   warping, galaxyView), never a fixed sleep, so it takes as long as the
   page actually needs and no longer.

   WHAT IT PROVES, IN ORDER, ALL THROUGH REAL DOM EVENTS OR THE EXACT
   FUNCTION A CLICK WOULD HAVE RUN:
     1. Ctrl+Shift+P opens the Test console — both the JS flag AND the
        on-screen render (computed style, not just inline).
     2. a real click on "Grant Starship" and "Trigger Sun Collapse".
     3. the REAL in-flight trigger: the Starship is positioned near the
        collapsed sun and the game's own physics tick finds it, not a
        direct call to enterWormhole().
     4. the galaxy chart opens, a star is picked (selIdx set directly —
        raycasting a real screen point is what shots_mobanim.mjs's gallery
        avoids too; nothing under test lives in the raycast) and launched
        via the real launchChartWarp() function.
     5. the run lands on a NEW system with the game still playable, not the
        Game Over screen. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const SRC=path.resolve(process.argv[2]||path.join(HERE,'..','Bleaux_v2_12_45.html'));
const OUT=path.resolve(process.argv[3]||path.join(os.tmpdir(),'wormhole_shots'));
const THREE_DIR=path.join(HERE,'node_modules','three');
fs.mkdirSync(OUT,{recursive:true});

let html=fs.readFileSync(SRC,'utf8');
html=html.replace('https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js','/three/build/three.module.js')
         .replace('https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/','/three/examples/jsm/');
const end=html.indexOf('</script>',html.indexOf('<script type="module">'));
/* the narrowest hook that lets the test DRIVE the flow (position the craft,
   pick a star) and READ the result — every step still runs the page's own
   real functions, on the page's own real render loop. */
html=html.slice(0,end)+`
window.__G={SUN_RADIUS,DEMO_MODE,
  get galaxyView(){return galaxyView;},get warping(){return warping;},
  get bigBlackHole(){return bigBlackHole;},get systemNumber(){return systemNumber;},
  get gameIsOver(){return gameIsOver;},get crafted(){return crafted;},
  get rocket(){return rocket;},get rocketState(){return rocketState;},
  get gameStarted(){return gameStarted;},get testMenuOpen(){return testMenuOpen;},
  enterRocket,launchChartWarp};
`+html.slice(end);

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
const page=await browser.newPage({viewport:{width:1280,height:800}});
page.setDefaultTimeout(150000);   // the supernova + warp render at real, slow, software-rasteriser fps
const errs=[];
page.on('console',m=>{if(m.type()==='error'&&!/404/.test(m.text()))errs.push(m.text().slice(0,300));});
page.on('pageerror',e=>errs.push('pageerror: '+e.message));

let fail=0;
const check=(name,cond,detail)=>{
    if(cond){console.log('  ok   '+name);}
    else{fail++;console.log('  FAIL '+name+(detail?'\n         '+detail:''));}
};

await page.goto('http://localhost:'+port+'/build.html',{waitUntil:'load'});
await page.waitForFunction(()=>window.__G&&window.__G.SUN_RADIUS>0);
await page.click('#intro');
await page.waitForFunction(()=>window.__G.gameStarted===true);
await page.screenshot({path:path.join(OUT,'01_before.png')});

// ---- 1) Ctrl+Shift+P — the panel's own render, not just the JS flag ----
await page.keyboard.down('Control');await page.keyboard.down('Shift');
await page.keyboard.press('KeyP');
await page.keyboard.up('Shift');await page.keyboard.up('Control');
await page.waitForFunction(()=>window.__G.testMenuOpen===true);
const menu=await page.evaluate(()=>{
    const el=document.getElementById('testmenu');
    return {open:window.__G.testMenuOpen,inline:el.style.display,computed:getComputedStyle(el).display};
});
check('Ctrl+Shift+P opens the Test console (state AND the rendered, computed style)',
    menu.open&&menu.inline==='flex'&&menu.computed==='flex',
    'testMenuOpen='+menu.open+' inline='+menu.inline+' computed='+menu.computed);
await page.screenshot({path:path.join(OUT,'02_testmenu.png')});

// ---- 2) real clicks on the real test buttons ----
await page.click('#t-starship');
const starship=await page.evaluate(()=>window.__G.crafted.starship);
check('a real click on "Grant Starship" sets crafted.starship',starship===true);

await page.keyboard.down('Control');await page.keyboard.down('Shift');
await page.keyboard.press('KeyP');
await page.keyboard.up('Shift');await page.keyboard.up('Control');
await page.click('#t-collapse');
await page.screenshot({path:path.join(OUT,'03_collapse.png')});
await page.waitForFunction(()=>!!window.__G.bigBlackHole);
check('a real click on "Trigger Sun Collapse" forms a black hole',true);
await page.screenshot({path:path.join(OUT,'04_blackhole.png')});

// ---- 3) cross the horizon FOR REAL: the game's own physics tick finds the craft ----
await page.evaluate(()=>{
    const G=window.__G;
    G.enterRocket();
    G.rocketState.flying=true;G.rocketState.landedBody=null;G.rocketState.vel.set(0,0,0);
    G.rocket.position.set(0,0,G.SUN_RADIUS*0.5);   // inside the 0.8*SUN_RADIUS horizon check
});
await page.waitForFunction(()=>window.__G.warping===true);
await page.waitForFunction(()=>!!window.__G.galaxyView);
check('flying the Starship near the collapsed sun fires the real in-flight enterWormhole() trigger',true);
await page.screenshot({path:path.join(OUT,'05_chart.png')});

// pick a star (skip the raycast — same end state pickChartStar leaves on a
// hit; the raycast itself is not what this file is testing) and launch via
// the SAME function the real LAUNCH button's onclick runs.
await page.evaluate(()=>{
    const gv=window.__G.galaxyView;
    const sp=gv.stars.geometry.attributes.position.array;
    gv.selIdx=0;gv.ret.position.set(sp[0],sp[1],sp[2]);gv.ret.visible=true;
});
await page.evaluate(()=>window.__G.launchChartWarp());
await page.screenshot({path:path.join(OUT,'06_warping.png')});

// ---- 4) ride the real warp out; assert the landing ----
await page.waitForFunction(()=>window.__G.galaxyView===null);
const result=await page.evaluate(()=>({systemNumber:window.__G.systemNumber,gameIsOver:window.__G.gameIsOver,
    gameoverDisplay:document.getElementById('gameover').style.display}));
check('blowing up the sun and riding the Starship\'s horizon reaches a NEW system',
    result.systemNumber===2&&result.gameIsOver===false&&result.gameoverDisplay!=='flex',
    JSON.stringify(result));
await page.screenshot({path:path.join(OUT,'07_newsystem.png')});

check('no console or page errors the whole run',errs.length===0,errs.join('\n         '));

await browser.close();server.close();
console.log('\nscreenshots:',OUT);
process.exit(fail?1:0);
