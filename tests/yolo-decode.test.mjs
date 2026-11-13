// Checks our YOLO output decoding against Ultralytics' own results on a sample image.
// Usage: node tests/yolo-decode.test.mjs <out.bin> <meta.json>
import { readFileSync } from 'node:fs';
import { decodeYolo } from '../js/yolo-decode.js';
const [bin, metaPath] = process.argv.slice(2);
const buf = readFileSync(bin);
const out = new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
const { balls } = decodeYolo(out, meta, 8400, { ball: 0, racket: 38 }); // class 0 = person, as a stand-in
console.log(balls.map((b) => [b.x, b.y, b.w, b.h].map(Math.round).concat(+b.conf.toFixed(2))));
