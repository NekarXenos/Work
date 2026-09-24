/* headless_env.mjs — the browser the shipped module thinks it is in.
   Only WebGLRenderer is faked; three's math, geometry and raycaster are REAL.

   RIG NON-OBVIOUS REQUIREMENTS (each one cost a session once):
   - `navigator` and `performance` are getter-only natives in Node and must be
     installed with Object.defineProperty, UNCONDITIONALLY — Node ships a real
     `performance` and it will otherwise shadow the fake deterministic clock;
   - scene.updateMatrixWorld(true) must run in the fake render(), or every
     terrain/mob raycast silently misses because matrixWorld is identity;
   - THREE.Clock.getElapsedTime() internally calls getDelta(), so nothing here
     may touch the clock (the v2.9.0 lesson). */

let _now=0;
export function tick(ms){_now+=ms;}
export function nowMs(){return _now;}

function el(tag='div'){
    const e={
        tagName:tag,dataset:{},className:'',id:'',
        style:{setProperty(k,v){this[k]=v;},getPropertyValue(k){return this[k]||'';},removeProperty(k){delete this[k];}},
        children:[],textContent:'',innerHTML:'',value:'',checked:false,
        width:800,height:600,
        appendChild(c){this.children.push(c);return c;},
        removeChild(c){const i=this.children.indexOf(c);if(i>=0)this.children.splice(i,1);return c;},
        remove(){},
        setAttribute(){},getAttribute(){return null;},
        addEventListener(){},removeEventListener(){},
        querySelector(){return el();},querySelectorAll(){return [];},
        /* a 2D context that records nothing and refuses nothing. Several
           textures (glow sprites, the v2.12.17 straw canvas) are painted at
           module scope, so `null` here is a boot failure rather than a missing
           feature. getImageData returns a real typed array because at least one
           caller reads .data.length. */
        getContext(kind){
            if(kind&&kind!=='2d')return null;
            const noop=()=>{};
            return {canvas:this,
                fillStyle:'',strokeStyle:'',lineWidth:1,globalAlpha:1,font:'',
                lineCap:'',lineJoin:'',globalCompositeOperation:'',
                textAlign:'',textBaseline:'',shadowBlur:0,shadowColor:'',
                fillRect:noop,clearRect:noop,strokeRect:noop,beginPath:noop,
                closePath:noop,moveTo:noop,lineTo:noop,arc:noop,ellipse:noop,
                bezierCurveTo:noop,quadraticCurveTo:noop,rect:noop,
                fill:noop,stroke:noop,save:noop,restore:noop,translate:noop,
                rotate:noop,scale:noop,setTransform:noop,transform:noop,
                clip:noop,drawImage:noop,putImageData:noop,
                measureText:()=>({width:10}),fillText:noop,strokeText:noop,
                createRadialGradient:()=>({addColorStop:noop}),
                createLinearGradient:()=>({addColorStop:noop}),
                createPattern:()=>null,
                getImageData:(x,y,w,h)=>({data:new Uint8ClampedArray(Math.max(1,(w|0)*(h|0)*4)),width:w|0,height:h|0}),
                createImageData:(w,h)=>({data:new Uint8ClampedArray(Math.max(1,(w|0)*(h|0)*4)),width:w|0,height:h|0}),
            };
        },
        requestPointerLock(){},
        getBoundingClientRect(){return {left:0,top:0,width:800,height:600,right:800,bottom:600};},
        focus(){},click(){},
        classList:{add(){},remove(){},toggle(){},contains(){return false;}},
        insertAdjacentHTML(){},
    };
    return e;
}

const byId=new Map();
const documentShim={
    title:'Bleaux AstroMiner — headless',
    body:el('body'),documentElement:el('html'),
    createElement:(t)=>el(t),
    createElementNS:(_ns,t)=>el(t),
    getElementById:(id)=>{if(!byId.has(id))byId.set(id,el());const e=byId.get(id);e.id=id;return e;},
    querySelector:()=>el(),querySelectorAll:()=>[],
    addEventListener(){},removeEventListener(){},
    exitPointerLock(){},
    pointerLockElement:null,
    hidden:false,
};

export function installEnv(){
    const g=globalThis;
    g.window=g;
    g.document=documentShim;
    g.innerWidth=800;g.innerHeight=600;
    g.devicePixelRatio=1;
    /* RECORD window listeners. The game binds keydown/mousedown at module top
       level; a no-op here means the INPUT WIRING is untestable and a mutant in
       the handler survives while the helper it calls is fully covered — which
       is exactly the "fixture bypasses the system under test" defect this
       project keeps a list of. */
    /* IDEMPOTENT. installEnv runs once per module instance (three_shim calls
       it), and a fresh Map each time silently DISCARDED the listeners the
       previously booted instance had registered — so __dispatch delivered
       events to whichever module booted last. That is what made the keydown
       test read "vacuous" three runs running: the event was real, it was just
       being handed to the wrong game. */
    const _lis=g.__listeners||new Map();
    g.__listeners=_lis;
    g.addEventListener=(t,fn)=>{if(!_lis.has(t))_lis.set(t,[]);_lis.get(t).push(fn);};
    g.removeEventListener=(t,fn)=>{const a=_lis.get(t);if(a){const i=a.indexOf(fn);if(i>=0)a.splice(i,1);}};
    g.__dispatch=(t,ev)=>{for(const fn of (_lis.get(t)||[]))fn(ev);};
    g.requestAnimationFrame=()=>0;
    g.cancelAnimationFrame=()=>{};
    g.setTimeout=(fn)=>0;          // messages fade on a timer we never run
    g.clearTimeout=()=>{};
    g.setInterval=()=>0;g.clearInterval=()=>{};
    g.alert=()=>{};g.confirm=()=>true;g.prompt=()=>null;
    g.localStorage={_m:new Map(),
        getItem(k){return this._m.has(k)?this._m.get(k):null;},
        setItem(k,v){this._m.set(k,String(v));},
        removeItem(k){this._m.delete(k);},clear(){this._m.clear();}};
    g.location={href:'file:///bleaux.html',search:''};
    /* getter-only natives: defineProperty, unconditionally */
    Object.defineProperty(g,'navigator',{configurable:true,writable:true,
        value:{userAgent:'node-headless',maxTouchPoints:0,platform:'linux',
               clipboard:{writeText:async()=>{}}}});
    Object.defineProperty(g,'performance',{configurable:true,writable:true,
        value:{now:()=>_now}});
    g.URL=g.URL||{createObjectURL:()=>'blob:none',revokeObjectURL:()=>{}};
    g.Blob=g.Blob||class{constructor(){}};
    g.Image=class{constructor(){this.width=1;this.height=1;}};
    g.OffscreenCanvas=class{constructor(){}getContext(){return null;}};
    g.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};
    g.matchMedia=()=>({matches:false,addListener(){},removeListener(){},
                       addEventListener(){},removeEventListener(){}});
    return {document:documentShim,byId};
}

/* WebGLRenderer is the ONLY three class stubbed. Patched onto the real module
   namespace before the game imports it. */
export function stubRenderer(THREE){
    THREE.WebGLRenderer=class{
        constructor(){
            this.domElement=el('canvas');
            this.shadowMap={enabled:false,type:0};
            this.info={render:{calls:0,triangles:0},memory:{geometries:0,textures:0}};
            this.capabilities={isWebGL2:true,getMaxAnisotropy:()=>1};
            this.outputColorSpace='';this.toneMapping=0;this.toneMappingExposure=1;
        }
        setSize(){}setPixelRatio(){}setClearColor(){}setAnimationLoop(){}
        setRenderTarget(){}clear(){}dispose(){}compile(){}
        getContext(){return {getParameter:()=>0};}
        /* WITHOUT THIS EVERY RAYCAST SILENTLY MISSES. */
        render(scene){if(scene&&scene.updateMatrixWorld)scene.updateMatrixWorld(true);}
    };
    return THREE;
}
