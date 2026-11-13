// app.js
// Wires the page together:
//   sidebar options -> run the models frame by frame -> measure the serve -> draw the dashboard.
// Before a video is analysed, the dashboard shows example results from a computer-generated serve.

import { analyseServe, compareToPros, buildFeedback, ISSUES, exportMotion, pickPro } from './analysis.js';
import { createComparison } from './compare.js';
import { renderSummary, renderPhases, renderHistory } from './dashboard.js';
import { createViewer } from './viewer.js';
import { makeServe, FPS } from './synthetic.js';

const $ = (id) => document.getElementById(id);
const video = $('video');
const work = document.createElement('canvas');
const wctx = work.getContext('2d', { willReadFrequently: true });

let refs = null;        // professional reference numbers (data/pros.json)
let lastResult = null;  // the latest real analysis
let shown = null;       // whichever result is on screen (example or real)
let shownMotion = null; // that result's movement, for the stick-figure comparison
const isPreview = Boolean(window.__PREVIEW);

const viewer = createViewer({
  video, canvas: $('overlay'), range: $('scrub'), markers: $('ticks'), time: $('time'),
  play: $('play'), back: $('back'), fwd: $('fwd'), speed: $('speed'),
  showPose: $('showPose'), showBall: $('showBall'), showRacket: $('showRacket'), trimShade: $('trimShade'),
});

// ---------- you vs pro ----------
const comparison = createComparison($('compareCanvas'));
viewer.onFrame((t) => { if (!$('comparePanel').classList.contains('hidden')) comparison.draw(t); });
document.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('.seg button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  comparison.setMode(b.dataset.mode);
}));
const motionCache = {};
async function loadMotion(path) {
  if (window.__PRO_MOTIONS && window.__PRO_MOTIONS[path]) return window.__PRO_MOTIONS[path];
  if (!motionCache[path]) motionCache[path] = fetch(path).then((r) => r.json());
  return motionCache[path];
}
async function showComparison(r, motion) {
  const choice = pickPro(refs, { stance: r.stance, view: r.view || 'side', hand: r.hand, heightCm: heightCm() });
  if (!choice || !motion || !motion.frames.length) { $('comparePanel').classList.add('hidden'); return; }
  const proMotion = await loadMotion(choice.pro.motion);
  comparison.set(motion, proMotion, choice.pro.id);
  $('compareTitle').textContent = `You vs ${choice.pro.id}`;
  const p = choice.pro;
  $('compareNotes').innerHTML = `
    <h3>${p.id}</h3>
    <p>${p.stance === 'pinpoint' ? 'Pinpoint' : 'Platform'} stance · ${p.hand}-handed${p.heightCm ? ` · ${p.heightCm} cm` : ''} · filmed ${p.view}-on</p>
    <p class="why">Picked because: ${choice.notes.join(' · ')}.</p>
    <ul>
      <li>Both figures are scaled to the same height, so you compare shape and timing, not size.</li>
      <li>They are lined up on the trophy and contact moments, so a slower serve still matches up.</li>
      <li>Hitting arm is shown in blue. Use the timeline or Play above to move both together.</li>
    </ul>`;
  $('comparePanel').classList.remove('hidden');
}

// ---------- trimming ----------
let trim = null; // { start, end } in seconds, or null for the whole clip
function setTrim(next) {
  trim = next;
  viewer.setTrim(trim);
  const a = trim ? trim.start : 0, b = trim ? trim.end : (video.duration || 0);
  $('trimInfo').textContent = trim ? `Analysing ${a.toFixed(2)} s to ${b.toFixed(2)} s (${(b - a).toFixed(2)} s)` : `Whole clip (${b.toFixed(2)} s)`;
}
$('trimStart').addEventListener('click', () => {
  const end = trim ? trim.end : video.duration;
  const t = viewer.now();
  if (t >= end - 0.2) return setStatus('The start must be at least 0.2 s before the end.');
  setTrim({ start: t, end });
});
$('trimEnd').addEventListener('click', () => {
  const start = trim ? trim.start : 0;
  const t = viewer.now();
  if (t <= start + 0.2) return setStatus('The end must be at least 0.2 s after the start.');
  setTrim({ start, end: t });
});
$('trimClear').addEventListener('click', () => setTrim(null));

// ---------- sidebar set-up ----------
for (const [key, issue] of Object.entries(ISSUES)) {
  const label = document.createElement('label');
  label.className = 'issue';
  label.innerHTML = `<input type="checkbox" id="issue-${key}" value="${key}"><span>${issue.label}</span>`;
  $('issues').appendChild(label);
}
// Player height: optional, remembered in this browser, used to show real distances.
const heightCm = () => {
  const v = Number($('heightCm').value);
  return v >= 100 && v <= 230 ? v : null;
};
try { $('heightCm').value = localStorage.getItem('playerHeightCm') || ''; } catch { /* ignore */ }
$('heightCm').addEventListener('input', () => {
  try { localStorage.setItem('playerHeightCm', $('heightCm').value); } catch { /* ignore */ }
  if (shown) {
    shown.playerHeightCm = heightCm();
    renderPhases($('phases'), shown.comparison, heightCm());
    showComparison(shown, shownMotion);
  }
  setRefNote();
});

const ticked = () => [...document.querySelectorAll('#issues input:checked')].map((i) => i.value);

// ---------- example dashboard (shown until a real video is analysed) ----------
function showExample() {
  // Shift the stick figure so it sits in the middle of a smaller drawing area.
  const move = (p) => p && { ...p, x: p.x - 250, y: p.y - 300 };
  const frames = makeServe().map((f) => ({ ...f, pose: f.pose.map(move), ball: move(f.ball), racket: move(f.racket) }));
  const r = analyseServe(frames, {});
  // Nudge a few numbers so the example shows a typical club player rather than a perfect serve.
  Object.assign(r.metrics, { kneeFlex: 41, contactHeight: 1.41, tossPlacement: 0.58, armExtension: 157, landing: 0.33 });
  r.comparison = compareToPros(r, refs);
  r.feedback = buildFeedback(r.comparison, ['net']);
  shown = r;
  shownMotion = exportMotion(frames, r);
  showComparison(r, shownMotion);
  renderSummary($('summary'), r);
  renderPhases($('phases'), r.comparison, heightCm());
  const weeks = [52, 57, 55, 63, r.comparison.overall];
  renderHistory($('history'), weeks.map((overall, i) => ({ overall, date: Date.now() - (weeks.length - 1 - i) * 7 * 864e5 })));
  viewer.set({ mode: 'example', frames, keyFrames: r.keyFrames, width: 560, height: 640, duration: frames[frames.length - 1].t, step: 1 / FPS });
  setRefNote();
}

function setRefNote() {
  const placeholder = refs.pros.some((p) => p.source === 'placeholder');
  $('refNote').textContent = (heightCm() ? `Distances use a player height of ${heightCm()} cm.` : 'H = player height (1.00 H is full height). Enter a height on the left to see cm and metres.') + ' Scoring score-0.1.' +
    (placeholder ? ' Pro A and Pro B are placeholder estimates until real pro footage is processed.' : '');
}

// ---------- choosing a video ----------
$('file').addEventListener('change', () => {
  const file = $('file').files[0];
  if (!file) return;
  $('fileName').textContent = file.name;
  video.src = URL.createObjectURL(file);
  video.onloadedmetadata = () => {
    // Work at up to 1280 px on the long side: enough detail, but not too slow.
    const s = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight));
    work.width = Math.round(video.videoWidth * s);
    work.height = Math.round(video.videoHeight * s);
    viewer.set({ mode: 'live', width: work.width, height: work.height, duration: video.duration, step: 1 / Number($('rate').value) });
    $('banner').innerHTML = '<b>Video loaded.</b> Trim it to the serve under the video, check the options on the left, then press Analyse serve.';
    $('trimTools').classList.remove('hidden');
    $('comparePanel').classList.add('hidden');
    setTrim(null);
    viewer.seek(0);
    $('analyse').disabled = false;
    setStatus(`${video.duration.toFixed(1)} s clip, ${video.videoWidth}×${video.videoHeight}.`);
  };
  video.onerror = () => setStatus('This browser can\'t play that video format. On iPhone use "Most Compatible", or try Safari.');
});

// ---------- running the analysis ----------
async function getDetectors() {
  if (isPreview) throw new Error('This is a layout preview. Open the live site to analyse your own video.');
  return import('./detectors.js');
}

$('analyse').addEventListener('click', async () => {
  $('analyse').disabled = true;
  $('progressWrap').classList.remove('hidden');
  try {
    const det = await getDetectors();
    await det.loadModels(setStatus);
    const frames = await processVideo(det);
    const r = analyseServe(frames, { hand: $('hand').value, stance: $('stance').value, timeScale: Number($('timeScale').value), heightCm: heightCm(), view: $('view').value });
    r.issues = ticked();
    r.comparison = compareToPros(r, refs);
    r.feedback = buildFeedback(r.comparison, r.issues);
    r.date = new Date().toISOString();
    lastResult = shown = r;
    shownMotion = r.motion = exportMotion(frames, r);
    showComparison(r, shownMotion);
    renderSummary($('summary'), r);
    renderPhases($('phases'), r.comparison, heightCm());
    saveHistory(r);
    viewer.set({ mode: 'live', frames, keyFrames: r.keyFrames, width: work.width, height: work.height, duration: video.duration, step: 1 / Number($('rate').value) });
    viewer.setTrim(trim);
    $('banner').classList.add('hidden');
    setStatus('Done. Click the markers under the video to check each key moment.');
  } catch (err) {
    console.error(err);
    setStatus(err.message);
  } finally {
    $('analyse').disabled = false;
    $('progressWrap').classList.add('hidden');
  }
});

function seekVideo(t) {
  return new Promise((resolve) => {
    const done = () => { video.removeEventListener('seeked', done); resolve(); };
    video.addEventListener('seeked', done);
    video.currentTime = t;
  });
}

async function processVideo(det) {
  const step = 1 / Number($('rate').value);
  const start = trim ? trim.start : 0;
  const end = trim ? trim.end : video.duration;
  const total = Math.max(1, Math.floor((end - start) / step));
  const out = [];
  let lastBall = null;
  video.pause();
  for (let i = 0; i < total; i++) {
    const t = start + i * step;
    await seekVideo(t);
    wctx.drawImage(video, 0, 0, work.width, work.height);
    const pose = det.detectPose(work, Math.round(t * 1000) + 1);
    const { balls, rackets } = await det.detectObjects(work);
    const ball = det.chooseBall(balls, lastBall, work.height * 0.25);
    if (ball) lastBall = ball;
    out.push({ t, pose, ball, racket: rackets[0] || null });
    viewer.drawFrame(out[out.length - 1]);
    $('progressBar').style.width = `${((i + 1) / total) * 100}%`;
    setStatus(`Analysing frame ${i + 1} of ${total}…`);
  }
  return out;
}

// ---------- download ----------
$('download').addEventListener('click', () => {
  if (!lastResult) return setStatus('Analyse a video first, then download its numbers.');
  const { comparison, feedback, ...core } = lastResult;
  const blob = new Blob([JSON.stringify({ ...core, overall: comparison.overall }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `serve-analysis-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
});

// ---------- history (saved in this browser only, for now) ----------
function loadHistory() {
  try { return JSON.parse(localStorage.getItem('serveHistory') || '[]'); } catch { return []; }
}
function saveHistory(r) {
  let h = loadHistory();
  h.push({ date: r.date, stance: r.stance, overall: r.comparison.overall, metrics: r.metrics });
  h = h.slice(-50);
  try { localStorage.setItem('serveHistory', JSON.stringify(h)); } catch { /* storage unavailable */ }
  renderHistory($('history'), h);
}

function setStatus(msg) { $('status').textContent = msg; }

// ---------- start ----------
(async () => {
  refs = window.__PROS || await fetch('data/pros.json').then((r) => r.json());
  showExample();
  const h = loadHistory();
  if (h.length) renderHistory($('history'), h);
  if (isPreview) setStatus('Layout preview with example data. Video analysis runs on the live site.');
})();
