// app.js
// Connects the page to the models and the analysis:
//   upload video -> step through frames -> detect body/ball/racquet -> measure -> compare -> show.

import { loadModels, detectPose, detectObjects, chooseBall } from './detectors.js';
import { analyseServe, compareToPros, buildFeedback, METRICS, ISSUES } from './analysis.js';

const $ = (id) => document.getElementById(id);
const video = $('video');
const overlay = $('overlay');
const octx = overlay.getContext('2d');
const work = document.createElement('canvas');
const wctx = work.getContext('2d', { willReadFrequently: true });

let frames = [];      // detections for every analysed frame
let lastResult = null;
let refs = null;      // professional reference data

// ---------- set up the page ----------
for (const [key, issue] of Object.entries(ISSUES)) {
  const label = document.createElement('label');
  label.innerHTML = `<input type="checkbox" value="${key}"> ${issue.label}`;
  $('issues').appendChild(label);
}
fetch('data/pros.json').then((r) => r.json()).then((d) => { refs = d; });
renderHistory();

$('file').addEventListener('change', () => {
  const file = $('file').files[0];
  if (!file) return;
  video.src = URL.createObjectURL(file);
  frames = [];
  $('viewer').classList.remove('hidden');
  $('results').classList.add('hidden');
  $('file').nextElementSibling.textContent = file.name;
  video.onloadedmetadata = () => {
    // Work at up to 1280 px on the long side: enough detail, but not too slow.
    const s = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight));
    work.width = overlay.width = Math.round(video.videoWidth * s);
    work.height = overlay.height = Math.round(video.videoHeight * s);
    $('analyse').disabled = false;
    setStatus(`Loaded: ${video.duration.toFixed(1)} s, ${video.videoWidth}×${video.videoHeight}.`);
  };
  video.onerror = () => setStatus('This browser cannot play that video format. Try "Most Compatible" on iPhone, or Safari.');
});

// ---------- run the analysis ----------
$('analyse').addEventListener('click', async () => {
  $('analyse').disabled = true;
  $('progressWrap').classList.remove('hidden');
  try {
    await loadModels(setStatus);
    frames = await processVideo();
    const options = {
      hand: $('hand').value,
      stance: $('stance').value,
      timeScale: Number($('timeScale').value),
    };
    lastResult = analyseServe(frames, options);
    lastResult.issues = [...document.querySelectorAll('#issues input:checked')].map((i) => i.value);
    lastResult.comparison = compareToPros(lastResult, refs);
    lastResult.feedback = buildFeedback(lastResult.comparison, lastResult.issues);
    lastResult.date = new Date().toISOString();
    showResults(lastResult);
    saveHistory(lastResult);
    setStatus('Done. Use the buttons above the video to check the key moments.');
    seekTo(lastResult.keyFrames.contact);
  } catch (err) {
    console.error(err);
    setStatus('Something went wrong: ' + err.message);
  } finally {
    $('analyse').disabled = false;
    $('progressWrap').classList.add('hidden');
  }
});

function seekTo(t) {
  return new Promise((resolve) => {
    const done = () => { video.removeEventListener('seeked', done); resolve(); };
    video.addEventListener('seeked', done);
    video.currentTime = t;
  });
}

async function processVideo() {
  const rate = Number($('rate').value);
  const step = 1 / rate;
  const total = Math.floor(video.duration / step);
  const out = [];
  let lastBall = null;
  video.pause();
  for (let i = 0; i < total; i++) {
    const t = i * step;
    await seekTo(t);
    wctx.drawImage(video, 0, 0, work.width, work.height);
    const pose = detectPose(work, Math.round(t * 1000) + 1);
    const { balls, rackets } = await detectObjects(work);
    const ball = chooseBall(balls, lastBall, work.height * 0.25);
    if (ball) lastBall = ball;
    out.push({ t, pose, ball, racket: rackets[0] || null });
    $('progressBar').style.width = `${((i + 1) / total) * 100}%`;
    setStatus(`Analysing frame ${i + 1} of ${total}…`);
    drawOverlay(out[out.length - 1]);
  }
  return out;
}

// ---------- drawing on top of the video ----------
const BONES = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [24, 26], [26, 28], [27, 31], [28, 32], [0, 11], [0, 12]];

function frameAt(t) {
  if (!frames.length) return null;
  let best = frames[0];
  for (const f of frames) if (Math.abs(f.t - t) < Math.abs(best.t - t)) best = f;
  return best;
}

function drawOverlay(f) {
  octx.clearRect(0, 0, overlay.width, overlay.height);
  if (!f) return;
  const lw = Math.max(2, overlay.width / 300);
  if ($('showPose').checked && f.pose) {
    octx.strokeStyle = 'rgba(255,255,255,0.9)';
    octx.lineWidth = lw;
    for (const [a, b] of BONES) {
      octx.beginPath();
      octx.moveTo(f.pose[a].x, f.pose[a].y);
      octx.lineTo(f.pose[b].x, f.pose[b].y);
      octx.stroke();
    }
    octx.fillStyle = '#2f7d4f';
    for (const p of f.pose.slice(11)) { octx.beginPath(); octx.arc(p.x, p.y, lw * 1.5, 0, 7); octx.fill(); }
  }
  if ($('showRacket').checked && f.racket) {
    const r = f.racket;
    octx.strokeStyle = '#4fc3f7';
    octx.lineWidth = lw;
    octx.strokeRect(r.x - r.w / 2, r.y - r.h / 2, r.w, r.h);
  }
  if ($('showBall').checked) {
    // Trail of the last few ball positions
    const trail = frames.filter((g) => g.ball && g.t <= f.t && g.t > f.t - 0.6);
    octx.fillStyle = 'rgba(215,242,43,0.5)';
    trail.forEach((g) => { octx.beginPath(); octx.arc(g.ball.x, g.ball.y, lw * 2, 0, 7); octx.fill(); });
    if (f.ball) {
      octx.strokeStyle = '#d7f22b';
      octx.lineWidth = lw * 1.5;
      octx.beginPath(); octx.arc(f.ball.x, f.ball.y, Math.max(f.ball.w, 8) * 0.8, 0, 7); octx.stroke();
    }
  }
  if (lastResult) {
    const k = lastResult.keyFrames;
    const label = [['trophy', 'TROPHY'], ['tossPeak', 'TOSS PEAK'], ['contact', 'CONTACT']]
      .find(([key]) => k[key] !== null && Math.abs(k[key] - f.t) < 0.02);
    if (label) {
      octx.font = `bold ${Math.round(overlay.height / 18)}px system-ui`;
      octx.fillStyle = '#d7f22b';
      octx.fillText(label[1], 20, overlay.height / 12);
    }
  }
}

function renderLoop() {
  drawOverlay(frameAt(video.currentTime));
  requestAnimationFrame(renderLoop);
}
requestAnimationFrame(renderLoop);

// ---------- playback controls ----------
$('play').addEventListener('click', () => {
  video.playbackRate = Number($('speed').value);
  if (video.paused) { video.play(); $('play').textContent = 'Pause'; } else { video.pause(); $('play').textContent = 'Play'; }
});
video.addEventListener('ended', () => { $('play').textContent = 'Play'; });
$('speed').addEventListener('change', () => { video.playbackRate = Number($('speed').value); });
const stepSize = () => 1 / Number($('rate').value);
$('back').addEventListener('click', () => { video.pause(); video.currentTime = Math.max(0, video.currentTime - stepSize()); });
$('fwd').addEventListener('click', () => { video.pause(); video.currentTime = Math.min(video.duration, video.currentTime + stepSize()); });
document.querySelectorAll('.jump button').forEach((b) => b.addEventListener('click', () => {
  const t = lastResult && lastResult.keyFrames[b.dataset.key];
  if (t !== null && t !== undefined) { video.pause(); video.currentTime = t; }
}));

// ---------- results ----------
function fmt(value, unit) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '–';
  if (unit === '°') return `${value.toFixed(0)}°`;
  if (unit === 's') return `${value.toFixed(2)} s`;
  return `${value.toFixed(2)} H`;
}

function showResults(r) {
  $('results').classList.remove('hidden');
  const c = r.comparison;
  $('overall').textContent = c.overall ?? '–';
  const stanceNote = r.stance === r.detectedStance ? '(detected)' : `(you chose this; we detected ${r.detectedStance})`;
  const warnings = [];
  if (r.framesWithBall < 5) warnings.push('The ball was hard to see, so toss measurements may be missing. Film against a plain background with the toss in shot.');
  if (r.framesWithRacket < 3) warnings.push('The racquet was rarely detected, so racquet drop may be missing.');
  $('summaryText').innerHTML = `
    <p><strong>${r.hand === 'right' ? 'Right' : 'Left'}-handed, ${r.stance} stance</strong> ${stanceNote}.<br>
    Compared with: ${c.comparedWith.join(', ')} (${r.stance} servers).</p>
    <p class="hint">Player found in ${r.framesWithPlayer} frames · ball in ${r.framesWithBall} · racquet in ${r.framesWithRacket}.</p>
    ${warnings.map((w) => `<p class="hint">⚠ ${w}</p>`).join('')}`;

  $('feedback').innerHTML = r.feedback.length
    ? r.feedback.map((f) => `<li><strong>${f.label}.</strong> ${f.text}
        ${f.linked.length ? `<span class="linked">Linked to what you ticked: ${f.linked.join(', ')}</span>` : ''}</li>`).join('')
    : '<li>Everything we could measure is within the pro range. Nice serve!</li>';

  $('metricRows').innerHTML = c.rows.map((row) => `
    <tr>
      <td>${row.def.label}</td>
      <td>${fmt(row.value, row.def.unit)}</td>
      <td>${row.status === 'missing' ? '–' : `${fmt(row.lo, row.def.unit)} to ${fmt(row.hi, row.def.unit)}`}</td>
      <td><span class="chip ${row.status}">${row.status === 'missing' ? 'n/a' : row.score}</span></td>
    </tr>`).join('');

  const placeholder = refs.pros.some((p) => p.source === 'placeholder');
  $('refNote').textContent = `H = your height (1.00 H is your full height). Scoring ${c.scoringVersion}.` +
    (placeholder ? ' Pro reference values are placeholder estimates until real footage is processed.' : '');
}

$('download').addEventListener('click', () => {
  if (!lastResult) return;
  const { comparison, feedback, ...core } = lastResult;
  const blob = new Blob([JSON.stringify({ ...core, comparison: { overall: comparison.overall } }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `serve-analysis-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
});

// ---------- history (kept in this browser only, for now) ----------
function loadHistory() {
  try { return JSON.parse(localStorage.getItem('serveHistory') || '[]'); } catch { return []; }
}
function saveHistory(r) {
  try {
    const h = loadHistory();
    h.push({ date: r.date, stance: r.stance, overall: r.comparison.overall, metrics: r.metrics });
    localStorage.setItem('serveHistory', JSON.stringify(h.slice(-50)));
  } catch { /* storage not available - ignore */ }
  renderHistory();
}
function renderHistory() {
  const h = loadHistory();
  if (!h.length) return;
  $('historyCard').classList.remove('hidden');
  $('historyRows').innerHTML = h.slice().reverse().map((s) =>
    `<tr><td>${new Date(s.date).toLocaleString('en-GB')}</td><td>${s.stance}</td><td>${s.overall ?? '–'}</td></tr>`).join('');
}

function setStatus(msg) { $('status').textContent = msg; }
