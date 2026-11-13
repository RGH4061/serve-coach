// Builds preview.html: one self-contained file of the page with example data, for sharing
// the layout without the AI models. Usage: node tools/build-preview.mjs
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

// Join the page's modules into one script, dropping import/export keywords.
const modules = ['js/analysis.js', 'js/synthetic.js', 'js/dashboard.js', 'js/viewer.js', 'js/compare.js', 'js/app.js'];
const bundle = modules.map((m) => `// ---- ${m} ----\n` + read(m)
  .split('\n')
  .filter((line) => !/^import .* from '.*';$/.test(line) && !/^export \{.*\} from/.test(line))
  .map((line) => line.replace(/^export (function|const|class|async function)/, '$1'))
  .join('\n')).join('\n');

let html = read('index.html')
  .replace('<link rel="stylesheet" href="css/style.css">', `<style>\n${read('css/style.css')}\n</style>`)
  .replace(/\s*<!-- ONNX Runtime[^\n]*\n\s*<script src="[^"]*ort\.min\.js"><\/script>/, '')
  .replace('<title>Serve Coach</title>', '<title>Serve Coach Dashboard</title>')
  .replace('<script type="module" src="js/app.js"></script>',
    `<script>window.__PREVIEW = true; window.__PROS = ${JSON.stringify(JSON.parse(read('data/pros.json')))}; window.__PRO_MOTIONS = ${JSON.stringify(Object.fromEntries(readdirSync(new URL('data/pros/', root)).map((f) => [`data/pros/${f}`, JSON.parse(read(`data/pros/${f}`))])))};</script>\n  <script type="module">\n${bundle}\n</script>`);

writeFileSync(new URL('preview.html', root), html);
console.log('wrote preview.html', html.length, 'bytes');
