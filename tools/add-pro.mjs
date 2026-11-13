// Adds a professional reference from a file saved with "Download analysis (JSON)".
//
// Usage:
//   node tools/add-pro.mjs <analysis.json> "<Pro id>" [--height 185] [--view side|front|behind] [--hand right|left]
//
// It writes the movement to data/pros/<id>.json (for the side-by-side stick figure) and adds
// or updates the pro's measurements in data/pros.json. No video is stored.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const [file, id, ...rest] = process.argv.slice(2);
if (!file || !id) {
  console.error('Usage: node tools/add-pro.mjs <analysis.json> "<Pro id>" [--height 185] [--view side] [--hand right]');
  process.exit(1);
}
const opt = {};
for (let i = 0; i < rest.length; i += 2) opt[rest[i].replace(/^--/, '')] = rest[i + 1];

const a = JSON.parse(readFileSync(file, 'utf8'));
if (!a.motion || !a.metrics) {
  console.error('That file has no movement data. Re-run the clip on the current site and download again.');
  process.exit(1);
}
const root = new URL('../', import.meta.url);
const slug = id.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const motionPath = `data/pros/${slug}.json`;
mkdirSync(new URL('data/pros/', root), { recursive: true });
writeFileSync(new URL(motionPath, root), JSON.stringify(a.motion));

const metrics = {};
for (const [k, v] of Object.entries(a.metrics)) if (Number.isFinite(v)) metrics[k] = Math.round(v * 1000) / 1000;

const refsUrl = new URL('data/pros.json', root);
const refs = JSON.parse(readFileSync(refsUrl, 'utf8'));
const entry = {
  id,
  stance: a.stance,
  hand: opt.hand || a.hand,
  view: opt.view || a.view || 'side',
  heightCm: opt.height ? Number(opt.height) : (a.playerHeightCm || null),
  source: 'footage',
  analysisVersion: a.version,
  motion: motionPath,
  metrics,
};
const i = refs.pros.findIndex((p) => p.id === id);
if (i >= 0) refs.pros[i] = entry; else refs.pros.push(entry);
writeFileSync(refsUrl, JSON.stringify(refs, null, 2) + '\n');
console.log(`${i >= 0 ? 'Updated' : 'Added'} ${id}: ${entry.stance}, ${entry.hand}-handed, ${entry.view}-on, ${Object.keys(metrics).length} measurements, ${a.motion.frames.length} motion frames.`);
