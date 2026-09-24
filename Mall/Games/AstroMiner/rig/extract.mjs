/* extract.mjs — slice the inline <script type="module"> out of a shipped
   Bleaux HTML file, repoint its imports at the local three r170, and append a
   generated export tail naming every TOP-LEVEL declaration.

   RIG NOTES THIS FILE EXISTS TO HOLD ON TO (each one cost a session once):
   - the top-level scanner must run on a COMMENT/STRING-BLANKED copy and match
     at COLUMN 0 ONLY, or it picks declarations out of prose and out of nested
     blocks;
   - a multi-declarator `let a=1, b=2;` must yield BOTH names (the v2.12.27 rig
     defect: the head-only scanner silently dropped `activeBody`, and every test
     that needed it merely looked "not applicable" rather than failing);
   - module paths are resolved relative to THIS file, not to the output dir.  */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const HERE=path.dirname(fileURLToPath(import.meta.url));

export function sliceModule(htmlPath){
    const html=fs.readFileSync(htmlPath,'utf8');
    const open=html.indexOf('<script type="module">');
    if(open<0)throw new Error('no module script');
    const start=html.indexOf('>',open)+1;
    const end=html.indexOf('</script>',start);
    return html.slice(start,end);
}

/* blank out comments and string/template literals so the scanner reads only
   live code. Replaces with spaces so every offset and line number survives. */
export function blankNonCode(src){
    const out=src.split('');
    let i=0;const n=src.length;
    const blank=(a,b)=>{for(let k=a;k<b;k++)if(out[k]!=='\n')out[k]=' ';};
    while(i<n){
        const c=src[i],d=src[i+1];
        if(c==='/'&&d==='*'){let j=src.indexOf('*/',i+2);if(j<0)j=n;blank(i,Math.min(j+2,n));i=j+2;continue;}
        if(c==='/'&&d==='/'){let j=src.indexOf('\n',i);if(j<0)j=n;blank(i,j);i=j;continue;}
        if(c==='"'||c==="'"||c==='`'){
            const q=c;let j=i+1;
            while(j<n){if(src[j]==='\\'){j+=2;continue;}if(src[j]===q)break;j++;}
            blank(i,Math.min(j+1,n));i=j+1;continue;
        }
        i++;
    }
    return out.join('');
}

/* comments ONLY. `blankNonCode` also blanks string literals, which is right
   for the top-level scanner and WRONG for "is this line code or prose" — a
   needle like defMat('spear' would never match. Two questions, two functions.
   (Found by the guard failing on its own first run.) */
export function blankComments(src){
    const out=src.split('');
    let i=0;const n=src.length;
    const blank=(a,b)=>{for(let k=a;k<b;k++)if(out[k]!=='\n')out[k]=' ';};
    while(i<n){
        const c=src[i],d=src[i+1];
        if(c==='/'&&d==='*'){let j=src.indexOf('*/',i+2);if(j<0)j=n;blank(i,Math.min(j+2,n));i=j+2;continue;}
        if(c==='/'&&d==='/'){let j=src.indexOf('\n',i);if(j<0)j=n;blank(i,j);i=j;continue;}
        if(c==='"'||c==="'"||c==='`'){
            const q=c;let j=i+1;
            while(j<n){if(src[j]==='\\'){j+=2;continue;}if(src[j]===q)break;j++;}
            i=j+1;continue;
        }
        i++;
    }
    return out.join('');
}
const RESERVED=new Set(['if','for','while','return','function','const','let','var','class','new','typeof']);

/* every TOP-LEVEL (column 0) function/const/let/class name.

   RIG DEFECT, FOUND AND FIXED IN v2.12.40: this scanner was LINE-BASED, so a
   declaration list that WRAPS —

       let chrispi=null, chrispiBody=null, rocket=null,
           rocketState=newRocketState(null);

   — yielded only the names on the first line and silently dropped
   `rocketState`. Exactly the failure mode the v2.12.27 rig defect had (a
   head-only scanner dropping `activeBody`) and exactly as bad, for the same
   reason: a scanner that quietly under-reports makes every test that needed
   the missing binding look "not applicable" rather than failing. A declaration
   is now read as a STATEMENT — from its column-0 keyword to the `;` that
   closes it at bracket depth 0 — not as a line. */
export function topLevelNames(src){
    const code=blankNonCode(src);
    const names=new Set();
    const declHead=/(^|\n)(function|class|const|let|var)[ \t]/g;
    let m;
    while((m=declHead.exec(code))){
        const kw=m[2];
        let i=m.index+m[1].length+kw.length;
        if(kw==='function'||kw==='class'){
            const nm=/^[ \t]*\*?[ \t]*([A-Za-z_$][\w$]*)/.exec(code.slice(i,i+120));
            if(nm)names.add(nm[1]);
            continue;
        }
        /* walk to the end of the STATEMENT, tracking bracket depth so a `;`
           inside a for-header or an object literal cannot end it early. */
        let depth=0,j=i;
        for(;j<code.length;j++){
            const ch=code[j];
            if('([{'.includes(ch))depth++;
            else if(')]}'.includes(ch))depth--;
            else if(ch===';'&&depth<=0)break;
            else if(ch==='\n'&&depth<=0){
                /* a wrapped list continues only while the statement is
                   unterminated AND the next line is indented; a new column-0
                   declaration is a new statement. */
                const nl=code.slice(j+1,j+40);
                if(/^[A-Za-z_$}\/]/.test(nl))break;
            }
        }
        const body=code.slice(i,j);
        let d=0,head=true,cur='';
        for(let k=0;k<body.length;k++){
            const ch=body[k];
            if('([{'.includes(ch)){d++;continue;}
            if(')]}'.includes(ch)){d--;continue;}
            if(d>0)continue;
            if(ch===','){if(cur&&!RESERVED.has(cur))names.add(cur);head=true;cur='';continue;}
            if(head){
                /* leading whitespace between the keyword (or a comma) and the
                   identifier keeps us in the head. Without this the FIRST
                   declarator of every statement was dropped — the statement
                   body starts at the space after `const`, and a space is not
                   an identifier character, so head flipped false before a
                   single letter was read. Caught by diffing this scanner
                   against the line-based one it replaced: 811 names short. */
                if(!cur&&/\s/.test(ch))continue;
                if(/[A-Za-z_$]/.test(ch)||(cur&&/[\w$]/.test(ch))){cur+=ch;continue;}
                if(cur){if(!RESERVED.has(cur))names.add(cur);cur='';}
                head=false;continue;
            }
        }
        if(cur&&!RESERVED.has(cur))names.add(cur);
    }
    return [...names];
}

/* the FIRST <script> (classic, not a module) carries the inlined simplex-noise
   2.4.0 the whole terrain generator runs on. Its export tail branches on
   `exports`/`module`, which under Node make it take the COMMONJS branch and
   never touch `window` — so the browser assignment the game relies on never
   happens. The tail is REPLACED OUTRIGHT rather than patched around. */
export function sliceNoise(htmlPath){
    const html=fs.readFileSync(htmlPath,'utf8');
    const open=html.indexOf('<script>');
    const start=html.indexOf('>',open)+1;
    const end=html.indexOf('</script>',start);
    let src=html.slice(start,end);
    const cut=src.indexOf('  // amd');
    if(cut<0)throw new Error('simplex export tail not found');
    return src.slice(0,cut)+'\n  globalThis.SimplexNoise=SimplexNoise;\n})();\n';
}

export function build(htmlPath,outPath){
    let src=sliceNoise(htmlPath)+'\n'+sliceModule(htmlPath);
    /* resolve to the SHIM, not to three directly: an ESM namespace is frozen,
       so WebGLRenderer has to be swapped at resolution rather than patched
       after import. Everything else the shim re-exports is the real r170. */
    const shim=path.join(HERE,'three_shim.mjs');
    const three=path.join(HERE,'node_modules','three','build','three.module.js');
    src=src.replace(/import \* as THREE from 'three';/,
        `import * as THREE from ${JSON.stringify('file://'+shim)};`);
    /* ConvexGeometry is an addon; the rig does not need a real one — the only
       consumer is the shelter mesh. A minimal stand-in keeps the import honest
       instead of deleting a line the shipped file has. */
    src=src.replace(/import \{ ConvexGeometry \} from 'three\/addons\/geometries\/ConvexGeometry\.js';/,
        `import * as THREE_NS from ${JSON.stringify('file://'+three)};\nclass ConvexGeometry extends THREE_NS.BufferGeometry{constructor(){super();}}`);
    const names=topLevelNames(src);
    src+='\n/* ---- rig export tail ---- */\nexport {'+names.join(',')+'};\n';
    fs.writeFileSync(outPath,src);
    return names;
}

if(process.argv[1]&&process.argv[1].endsWith('extract.mjs')){
    const names=build(process.argv[2],process.argv[3]);
    console.log('exports:',names.length);
}
