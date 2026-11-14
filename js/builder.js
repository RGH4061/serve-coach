// builder.js
// Reference builder: measures several serves of one pro with exactly the same code as the
// main page, lets you fix key moments and drop bad measurements, then averages them into a
// pro entry and downloads an updated data/pros.json.

import { analyseServe, exportMotion, averageServes, upsertPro, METRICS, PHASES } from './analysis.js';
import { fmt } from './dashboard.js';
import { createViewer } from './viewer.js';
import { processVideo, loadVideoFile, workSize, isPhone } from './pipeline.js';

const $ = (id) => document.getElementById(id);
const video = $('video');
const work = document.createElement('canvas');
const viewer = createViewer({
  video, canvas: $('overlay'), range: $('scrub'), markers: $('ticks'), time: $('time'),
  play: $('play'), back: $('back'), fwd: $('fwd'), speed: $('speed'),
  showPose: $('showPose'), showBall: $('showBall'), showRacket: $('showRacket'), trimShade: $('trimShade'),
});

let refs = null;
let trim = null;
let frames = null;     // detections for the clip being reviewed
let manual = {};       // key moments set by hand
let current = null;    // analysis of the clip being reviewed
let keep = {};         // which measurements to keep for this serve
const serves = [];     // serves added to this pro: { result, keep, motion, label }
let motionPick = 0;    // which serve's movement is used for the stick figure

const setStatus = (m) => { $('status').textContent = m; };
const heightCm = () => { const v = Number($('heightCm').value); return v >= 140 && v <= 230 ? v : null; };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- pro alias ----------
function checkId() {
  const id = $('proId').value.trim();
  const exists = refs && refs.pros.some((p) => p.id === id);
  $('idNote').textContent = !id ? 'Give the pro an alias.' : exists ? `${id} already exists and will be replaced when you save.` : 'New pro.';
  $('summaryTitle').textContent = `${id || 'This pro'} so far`;
}
$('proId').addEventListener('input', checkId);
$('heightCm').addEventListener('input', () => { renderReview(); renderAverage(); });

// ---------- choose and trim a clip ----------
$('file').addEventListener('change', () => {
  const file = $('file').files[0];
  if (!file) return;
  $('fileName').textContent = file.name;
  setStatus('Opening the video…');
  loadVideoFile(video, file, {
    onError: setStatus,
    onReady: () => {
      const s = Math.min(1, workSize() / Math.max(video.videoWidth, video.videoHeight));
      work.width = Math.round(video.videoWidth * s);
      work.height = Math.round(video.videoHeight * s);
      frames = null; current = null; manual = {};
      viewer.set({ mode: 'live', width: work.width, height: work.height, duration: video.duration, step: 1 / Number($('rate').value) });
      setTrim(null);
      $('trimTools').classList.remove('hidden');
      $('keyTools').classList.add('hidden');
      $('reviewPanel').classList.add('hidden');
      $('analyse').disabled = false;
      setStatus(`${video.duration.toFixed(1)} s clip. Trim it to one serve, then analyse.`);
    },
  });
});

function setTrim(next) {
  trim = next;
  viewer.setTrim(trim);
  const a = trim ? trim.start : 0, b = trim ? trim.end : (video.duration || 0);
  $('trimInfo').textContent = trim ? `${a.toFixed(2)} s to ${b.toFixed(2)} s (${(b - a).toFixed(2)} s)` : `Whole clip (${b.toFixed(2)} s)`;
}
$('trimStart').addEventListener('click', () => {
  const end = trim ? trim.end : video.duration, t = viewer.now();
  if (t < end - 0.2) setTrim({ start: t, end });
});
$('trimEnd').addEventListener('click', () => {
  const start = trim ? trim.start : 0, t = viewer.now();
  if (t > start + 0.2) setTrim({ start, end: t });
});
$('trimClear').addEventListener('click', () => setTrim(null));

// ---------- analyse ----------
$('analyse').addEventListener('click', async () => {
  $('analyse').disabled = true;
  $('progressWrap').classList.remove('hidden');
  try {
    const det = await import('./detectors.js');
    await det.loadModels(setStatus);
    frames = await processVideo({
      video, work, det,
      start: trim ? trim.start : 0,
      end: trim ? trim.end : video.duration,
      rate: Number($('rate').value),
      onFrame: (f) => viewer.drawFrame(f),
      onProgress: (i, n) => { $('progressBar').style.width = `${(i / n) * 100}%`; setStatus(`Analysing frame ${i} of ${n}…`); },
    });
    manual = {};
    keep = {};
    measure(true);
    viewer.set({ mode: 'live', frames, keyFrames: current.keyFrames, width: work.width, height: work.height, duration: video.duration, step: 1 / Number($('rate').value) });
    viewer.setTrim(trim);
    $('keyTools').classList.remove('hidden');
    setStatus('Check the Trophy, Toss peak and Contact markers under the video.');
  } catch (err) {
    console.error(err);
    setStatus(err.message);
  } finally {
    $('analyse').disabled = false;
    $('progressWrap').classList.add('hidden');
  }
});

function measure(fresh) {
  const opts = {
    hand: $('hand').value, stance: $('stance').value, view: $('view').value,
    timeScale: Number($('timeScale').value), heightCm: heightCm(), keyFrames: manual,
  };
  // Later serves follow the stance and hand of the first serve added.
  if (serves.length) { opts.stance = serves[0].result.stance; opts.hand = serves[0].result.hand; }
  current = analyseServe(frames, opts);
  for (const k of Object.keys(METRICS)) if (fresh || !(k in keep)) keep[k] = Number.isFinite(current.metrics[k]);
  viewer.setKeyFrames(current.keyFrames);
  renderReview();
}

document.querySelectorAll('[data-set]').forEach((b) => b.addEventListener('click', () => {
  if (!frames) return;
  manual[b.dataset.set] = viewer.now();
  measure(false);
  setStatus(`${b.textContent.replace(' is here', '')} set by hand at ${viewer.now().toFixed(3)} s.`);
}));
$('autoKeys').addEventListener('click', () => { if (frames) { manual = {}; measure(false); setStatus('Key moments back to automatic.'); } });

// ---------- review table ----------
function renderReview() {
  if (!current) return;
  $('reviewPanel').classList.remove('hidden');
  const r = current;
  const hand = r.manualKeyFrames.length ? `Set by hand: ${r.manualKeyFrames.join(', ')}.` : 'All key moments automatic.';
  $('reviewInfo').textContent = `${r.hand}-handed, ${r.stance} stance (detected ${r.detectedStance}). Player in ${r.framesWithPlayer} frames, ball in ${r.framesWithBall}, racquet in ${r.framesWithRacket}. ${hand}`;
  $('reviewRows').innerHTML = Object.entries(METRICS).map(([k, def]) => {
    const v = r.metrics[k];
    const ok = Number.isFinite(v);
    return `<tr class="${ok ? '' : 'muted-item'}">
      <td><input type="checkbox" data-keep="${k}" ${keep[k] ? 'checked' : ''} ${ok ? '' : 'disabled'} aria-label="Keep ${esc(def.label)}"></td>
      <td>${esc(def.label)}</td><td>${ok ? fmt(v, def.unit, heightCm()) : 'Not measured'}</td><td>${PHASES[def.phase].label}</td></tr>`;
  }).join('');
  document.querySelectorAll('[data-keep]').forEach((c) => c.addEventListener('change', () => { keep[c.dataset.keep] = c.checked; }));
}

$('addServe').addEventListener('click', () => {
  if (!current) return;
  if (serves.length && current.stance !== serves[0].result.stance) {
    return setStatus(`This serve looks ${current.stance} but the pro's first serve was ${serves[0].result.stance}. Set the stance in Pro details and re-analyse.`);
  }
  serves.push({ result: current, keep: { ...keep }, motion: exportMotion(frames, current), label: $('fileName').textContent });
  current = null; frames = null;
  $('reviewPanel').classList.add('hidden');
  $('keyTools').classList.add('hidden');
  renderServes();
  renderAverage();
  setStatus(`Serve ${serves.length} added. Choose the next clip, or download when you have 3–5.`);
});

// ---------- serves list and averages ----------
function renderServes() {
  $('serveList').innerHTML = serves.length ? serves.map((s, i) => `
    <li>
      <span>${esc(s.label)}</span>
      <label class="pick"><input type="radio" name="motionPick" value="${i}" ${i === motionPick ? 'checked' : ''}> stick figure</label>
      <button type="button" class="link" data-remove="${i}">Remove</button>
    </li>`).join('') : '<li class="muted-item">None yet</li>';
  document.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', () => {
    serves.splice(Number(b.dataset.remove), 1);
    motionPick = Math.min(motionPick, Math.max(0, serves.length - 1));
    renderServes(); renderAverage();
  }));
  document.querySelectorAll('[name=motionPick]').forEach((r) => r.addEventListener('change', () => { motionPick = Number(r.value); }));
  $('save').disabled = !serves.length;
}

function renderAverage() {
  if (!serves.length) {
    $('avgRows').innerHTML = '<tr><td colspan="4" class="muted-item">Add a serve to see the pro\'s numbers.</td></tr>';
    return;
  }
  const avg = averageServes(serves);
  $('avgRows').innerHTML = Object.entries(METRICS).map(([k, def]) => {
    const vals = serves.filter((s) => s.keep[k] && Number.isFinite(s.result.metrics[k])).map((s) => s.result.metrics[k]);
    const spread = vals.length > 1 ? `${fmt(Math.min(...vals), def.unit, heightCm())} – ${fmt(Math.max(...vals), def.unit, heightCm())}` : '–';
    return `<tr class="${vals.length ? '' : 'muted-item'}"><td>${esc(def.label)}</td><td>${fmt(avg[k], def.unit, heightCm())}</td><td>${vals.length}</td><td>${spread}</td></tr>`;
  }).join('');
}

// ---------- save ----------
$('save').addEventListener('click', () => {
  const id = $('proId').value.trim();
  if (!id) return setStatus('Give the pro an alias first.');
  const first = serves[0].result;
  const entry = {
    id,
    stance: first.stance,
    hand: first.hand,
    view: $('view').value,
    heightCm: heightCm(),
    level: $('level').value,
    source: 'footage',
    analysisVersion: first.version,
    serves: serves.length,
    metrics: averageServes(serves),
    motion: serves[motionPick].motion,
  };
  const updated = upsertPro(refs, entry);
  // Keep pros.json readable: indent everything except the long movement data.
  const motions = [];
  const text = JSON.stringify(updated, (k, v) => (k === 'motion' && typeof v === 'object' ? `@@MOTION${motions.push(v) - 1}@@` : v), 2)
    .replace(/"@@MOTION(\d+)@@"/g, (_, i) => JSON.stringify(motions[Number(i)]));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text + '\n'], { type: 'application/json' }));
  a.download = 'pros.json';
  a.click();
  setStatus(`Downloaded pros.json with ${id} (${serves.length} serve${serves.length > 1 ? 's' : ''}). Replace data/pros.json in your repo with it, then commit and push.`);
});

// ---------- start ----------
(async () => {
  refs = await fetch('data/pros.json', { cache: 'no-store' }).then((r) => r.json());
  // Suggest the next free alias: Pro D, Pro E, ...
  for (let c = 68; c < 91; c++) {
    const id = `Pro ${String.fromCharCode(c)}`;
    if (!refs.pros.some((p) => p.id === id)) { $('proId').value = id; break; }
  }
  checkId();
})();
