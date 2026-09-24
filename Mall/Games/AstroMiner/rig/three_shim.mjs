/* three_shim.mjs — the REAL three r170 with exactly one class replaced.
   An ESM namespace object is frozen, so the renderer cannot be monkey-patched
   after import; it has to be swapped at RESOLUTION. `export *` skips any name
   the module also exports itself, so WebGLRenderer below wins and every other
   export is the genuine article. */
export * from './node_modules/three/build/three.module.js';
import {installEnv} from './headless_env.mjs';
const {document}=installEnv();
export class WebGLRenderer{
    constructor(){
        this.domElement=document.createElement('canvas');
        this.shadowMap={enabled:false,type:0};
        this.info={render:{calls:0,triangles:0},memory:{geometries:0,textures:0}};
        this.capabilities={isWebGL2:true,getMaxAnisotropy:()=>1};
        this.outputColorSpace='';this.toneMapping=0;this.toneMappingExposure=1;
    }
    setSize(){}setPixelRatio(){}setClearColor(){}setAnimationLoop(){}
    setRenderTarget(){}clear(){}dispose(){}compile(){}
    getContext(){return {getParameter:()=>0};}
    /* WITHOUT THIS EVERY RAYCAST SILENTLY MISSES (matrixWorld stays identity). */
    render(scene){if(scene&&scene.updateMatrixWorld)scene.updateMatrixWorld(true);}
}
