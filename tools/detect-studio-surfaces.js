// Detect large, rectangular dark display surfaces in an 8-bit RGB/RGBA PNG.
// Usage: node tools/detect-studio-surfaces.js [image.png] [darkness-threshold]
// No dependencies: reads PNG scanlines and finds connected dark components.
'use strict';
const fs = require('node:fs');
const zlib = require('node:zlib');
const filename = process.argv[2] || 'Studio_Portrait.png';
const threshold = Number(process.argv[3] || 64);
const png = fs.readFileSync(filename);
if (!png.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw Error('Expected PNG');
let width, height, channels;
const chunks = [];
for (let offset = 8; offset < png.length;) {
  const length = png.readUInt32BE(offset);
  const type = png.toString('ascii', offset + 4, offset + 8);
  const data = png.subarray(offset + 8, offset + 8 + length);
  if (type === 'IHDR') {
    width = data.readUInt32BE(0); height = data.readUInt32BE(4);
    channels = data[9] === 2 ? 3 : data[9] === 6 ? 4 : 0;
    if (data[8] !== 8 || !channels || data[12]) throw Error('Requires non-interlaced 8-bit RGB/RGBA PNG');
  } else if (type === 'IDAT') chunks.push(data);
  offset += length + 12;
}
const raw = zlib.inflateSync(Buffer.concat(chunks));
const stride = width * channels;
const pixels = Buffer.alloc(stride * height);
function paeth(a, b, c) {
  const p = a + b - c, pa = Math.abs(p-a), pb = Math.abs(p-b), pc = Math.abs(p-c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
for (let y = 0; y < height; y++) {
  const filter = raw[y * (stride + 1)];
  for (let x = 0; x < stride; x++) {
    const index = y * stride + x;
    const a = x >= channels ? pixels[index-channels] : 0;
    const b = y ? pixels[index-stride] : 0;
    const c = y && x >= channels ? pixels[index-stride-channels] : 0;
    const prediction = filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b : filter === 3 ? Math.floor((a+b)/2) : filter === 4 ? paeth(a,b,c) : NaN;
    if (Number.isNaN(prediction)) throw Error('Unknown PNG filter');
    pixels[index] = (raw[y*(stride+1)+1+x] + prediction) & 255;
  }
}
const dark = new Uint8Array(width * height);
for (let i = 0; i < dark.length; i++) {
  const offset = i * channels;
  dark[i] = Math.max(pixels[offset], pixels[offset+1], pixels[offset+2]) <= threshold && (channels !== 4 || pixels[offset+3] > 127) ? 1 : 0;
}
const queue = new Int32Array(dark.length), components = [];
for (let start = 0; start < dark.length; start++) {
  if (!dark[start]) continue;
  let head = 0, tail = 1, minX = width, minY = height, maxX = 0, maxY = 0;
  queue[0] = start; dark[start] = 0;
  while (head < tail) {
    const index = queue[head++], x = index % width, y = Math.floor(index / width);
    minX = Math.min(minX,x); maxX = Math.max(maxX,x); minY = Math.min(minY,y); maxY = Math.max(maxY,y);
    if (x > 0 && dark[index-1]) { dark[index-1] = 0; queue[tail++] = index-1; }
    if (x+1 < width && dark[index+1]) { dark[index+1] = 0; queue[tail++] = index+1; }
    if (y > 0 && dark[index-width]) { dark[index-width] = 0; queue[tail++] = index-width; }
    if (y+1 < height && dark[index+width]) { dark[index+width] = 0; queue[tail++] = index+width; }
  }
  const w = maxX-minX+1, h = maxY-minY+1, fill = tail/(w*h);
  if (w < width*0.08 || h < height*0.04 || fill < 0.95) continue;
  components.push({x:minX,y:minY,width:w,height:h,fill:Number(fill.toFixed(6)),pixels:tail,percent:{left:100*minX/width,top:100*minY/height,width:100*w/width,height:100*h/height}});
}
components.sort((a,b) => Math.abs(a.y-b.y) < 20 ? a.x-b.x : a.y-b.y);
console.log(JSON.stringify({filename,width,height,threshold,surfaces:components},null,2));
