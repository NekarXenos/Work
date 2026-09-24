/* boot.mjs — install the browser, stub only WebGLRenderer, seed Math.random
   with mulberry32 so every run is reproducible, THEN import the sliced game. */
import {installEnv} from './headless_env.mjs';
import * as THREE from './three_shim.mjs';

export function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}

export async function boot(modPath,seed=7){
    installEnv();
    /* the shim already owns WebGLRenderer — see three_shim.mjs for why it has
       to happen at resolution rather than here. */
    Math.random=mulberry32(seed);
    const G=await import(modPath);
    return {G,THREE};
}
