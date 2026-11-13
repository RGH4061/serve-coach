// app.js
// Wires the page together:
//   sidebar options -> run the models frame by frame -> measure the serve -> draw the dashboard.
// Before a video is analysed, the dashboard shows example results from a computer-generated serve.

import { analyseServe, compareToPros, buildFeedback, ISSUES } from './analysis.js';
import { renderSummary, renderPhases, renderHistory } from './dashboard.js';
import { createViewer } from './viewer.js';
import { makeServe, FPS } from './synthetic.js';

const $ = (id) => document.getElementById(id);
const video = $('video');
const work = document.createElement('canvas');
const wctx = work.getContext('2d', { willReadFrequently: true });

let refs = null;        // professional reference numbers (data/pros.json)
let lastResult = null;  // the latest real analysis
const isPreview = Boolean(window.__PREVIEW);

const viewer = createViewer({
  video, canvas: $('overlay'), range: $('scrub'), markers: $('ticks'), time: $('time'),
  play: $('play'), back: $('back'), fwd: $('fwd'), speed: $('speed'),
  showPose: $('showPose'), showBall: $('showBall'), showRacket: $('showRacket'),
});

// ---------- sidebar set-up ----------
for (const [key, issue] of Object.entries(ISSUES)) {
  const label = document.createElement('label');
  label.className = 'issue';
  label.innerHTML = `<input type="checkbox" id="issue-${key}" value="${key}"><span>${issue.label}</span>`;
  $('issues').appendChild(label);
}
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
  renderSummary($('summary'), r);
  renderPhases($('phases'), r.comparison);
  const weeks = [52, 57, 55, 63, r.comparison.overall];
  renderHistory($('history'), weeks.map((overall, i) => ({ overall, date: Date.now() - (weeks.length - 1 - i) * 7 * 864e5 })));
  viewer.set({ mode: 'example', frames, keyFrames: r.keyFrames, width: 560, height: 640, duration: frames[frames.length - 1].t, step: 1 / FPS });
  setRefNote();
}

function setRefNote() {
  const placeholder = refs.pros.some((p) => p.source === 'placeholder');
  $('refNote').textContent = 'H = player height (1.00 H is your full height). Scoring score-0.1.' +
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
    $('banner').innerHTML = '<b>Video loaded.</b> Check the options on the left, then press Analyse serve. The results below are still the example.';
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
    const r = analyseServe(frames, { hand: $('hand').value, stance: $('stance').value, timeScale: Number($('timeScale').value) });
    r.issues = ticked();
    r.comparison = compareToPros(r, refs);
    r.feedback = buildFeedback(r.comparison, r.issues);
    r.date = new Date().toISOString();
    lastResult = r;
    renderSummary($('summary'), r);
    renderPhases($('phases'), r.comparison);
    saveHistory(r);
    viewer.set({ mode: 'live', frames, keyFrames: r.keyFrames, width: work.width, height: work.height, duration: video.duration, step: 1 / Number($('rate').value) });
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
  const total = Math.floor(video.duration / step);
  const out = [];
  let lastBall = null;
  video.pause();
  for (let i = 0; i < total; i++) {
    const t = i * step;
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
