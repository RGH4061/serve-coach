// dashboard.js
// Draws the results dashboard: score ring, top fixes, phase cards with range gauges, progress chart.
// It only builds HTML from an analysis result, so it works with real or example data.

import { METRICS, PHASES } from './analysis.js';

// Formats a measurement. Distances are stored in player heights (H); if we know the player's
// real height, show them in centimetres or metres instead.
export function fmt(value, unit, heightCm) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '–';
  if (unit === '°') return `${value.toFixed(0)}°`;
  if (unit === 's') return `${value.toFixed(2)} s`;
  if (unit === 'sparc') return value.toFixed(2);
  if (unit === 'of 3') return `${Math.round(Math.max(0, Math.min(3, value)))} of 3`;
  if (unit === 'H/s') return heightCm ? `${((value * heightCm) / 100).toFixed(2)} m/s` : `${value.toFixed(2)} H/s`;
  if (unit === 'H/s²') return heightCm ? `${((value * heightCm) / 100).toFixed(1)} m/s²` : `${value.toFixed(1)} H/s²`;
  if (heightCm) {
    const cm = value * heightCm;
    return Math.abs(cm) >= 100 ? `${(cm / 100).toFixed(2)} m` : `${Math.round(cm)} cm`;
  }
  return `${value.toFixed(2)} H`;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const statusOf = (score) => (score === null || score === undefined ? 'missing' : score >= 85 ? 'good' : score >= 50 ? 'close' : 'work');
const STATUS_WORD = { good: 'Pro range', close: 'Close', work: 'Work on', missing: 'Not measured' };

// ---------- summary: score ring, profile chips, top fixes ----------
export function renderSummary(el, r) {
  const c = r.comparison;
  const score = c.overall ?? 0;
  const circ = 2 * Math.PI * 52;
  const state = statusOf(c.overall);
  const stanceNote = r.stance !== r.detectedStance ? `chosen · detected ${r.detectedStance}` : r.stanceUnsure ? 'detected · hard to tell from this angle, set it on the left' : 'detected';
  const quality = [
    ['Player', r.framesWithPlayer, r.framesWithPlayer >= 20],
    ['Ball', r.framesWithBall, r.framesWithBall >= 5],
    ['Racquet', r.framesWithRacket, r.framesWithRacket >= 3],
  ];
  el.innerHTML = `
    <div class="score-row">
      <svg class="ring ${state}" viewBox="0 0 120 120" role="img" aria-label="Serve score ${c.overall ?? 'not available'} out of 100">
        <circle class="ring-track" cx="60" cy="60" r="52"></circle>
        <circle class="ring-value" cx="60" cy="60" r="52" stroke-dasharray="${(score / 100) * circ} ${circ}" transform="rotate(-90 60 60)"></circle>
        <text x="60" y="55" class="ring-num">${c.overall ?? '–'}</text>
        <text x="60" y="84" class="ring-label">of 100</text>
      </svg>
      <div class="profile">
        <p class="eyebrow">Serve score</p>
        <div class="chips">
          <span class="tag">${r.hand === 'right' ? 'Right-handed' : 'Left-handed'}</span>
          <span class="tag">${r.stance === 'pinpoint' ? 'Pinpoint' : 'Platform'} stance <small>${esc(stanceNote)}</small></span>
        </div>
        <p class="compared">Compared with ${c.comparedWith.map(esc).join(', ')} · ${esc(r.stance)} servers</p>
        <ul class="quality">
          ${quality.map(([name, n, ok]) => `<li class="${ok ? 'ok' : 'low'}"><span>${name}</span><b>${n}</b> frames</li>`).join('')}
        </ul>
      </div>
    </div>
    <h3>Top things to work on</h3>
    <ol class="fixes">
      ${r.feedback.length ? r.feedback.map((f) => `
        <li>
          <strong>${esc(f.label)}</strong>
          <p>${esc(f.text)}</p>
          ${f.linked.length ? `<span class="linked">Linked to: ${f.linked.map(esc).join(', ')}</span>` : ''}
        </li>`).join('') : '<li><strong>All measured areas are in the pro range.</strong><p>Film another serve from a different angle to check the rest.</p></li>'}
    </ol>`;
}

// ---------- phase cards with gauges ----------
function gauge(row, hc) {
  const [min, max] = row.def.scale;
  const pct = (v) => Math.max(0, Math.min(100, ((v - min) / (max - min)) * 100));
  if (row.status === 'missing') {
    return `<div class="gauge empty"><span>Not seen in this clip</span></div>`;
  }
  const left = pct(row.lo), right = pct(row.hi);
  return `
    <div class="gauge" role="img" aria-label="${esc(row.def.label)}: you ${fmt(row.value, row.def.unit, hc)}, pro range ${fmt(row.lo, row.def.unit, hc)} to ${fmt(row.hi, row.def.unit, hc)}">
      <div class="band" style="left:${left}%;width:${Math.max(1, right - left)}%"></div>
      <div class="marker ${statusOf(row.score)}" style="left:${pct(row.value)}%"></div>
    </div>`;
}

export function renderPhases(el, comparison, heightCm, level = 2, result = null) {
  const byPhase = {};
  for (const row of comparison.rows) (byPhase[row.def.phase] ||= []).push(row);
  const timing = level >= 3 && result ? timingStrip(result) : '';
  el.innerHTML = timing + `<div class="phases">` + Object.entries(PHASES).map(([key, phase], i) => {
    const all = byPhase[key] || [];
    const scored = all.filter((r) => r.status !== 'missing');
    const w = scored.reduce((a, r) => a + r.def.weight, 0);
    const phaseScore = w ? Math.round(scored.reduce((a, r) => a + r.score * r.def.weight, 0) / w) : null;
    const st = statusOf(phaseScore);
    const head = `
        <header>
          <div>
            <span class="step">${i + 1}</span>
            <h3>${phase.label}</h3>
            <p>${phase.hint}</p>
          </div>
          <span class="pill ${st}">${phaseScore ?? '–'}</span>
        </header>`;
    if (level <= 1) return `<article class="phase ${st}">${head}${simpleBody(all, st)}</article>`;
    const rows = all.filter((r) => r.def.level <= level);
    return `<article class="phase ${st}">${head}${rows.map((row) => metricRow(row, heightCm, level)).join('')}</article>`;
  }).join('') + `</div>`;
}

const VERDICT = { good: 'Pro level', close: 'Nearly there', work: 'Focus here', missing: 'Not measured' };

// Simple: a plain-words verdict per phase instead of numbers.
function simpleBody(rows, st) {
  const good = rows.filter((r) => statusOf(r.score) === 'good').map((r) => r.def.plain);
  const fix = rows.filter((r) => r.status !== 'missing' && statusOf(r.score) !== 'good')
    .sort((a, b) => a.score - b.score)
    .map((r) => `${r.def.plain} <span class="hint-word">(${r.direction === 'low' ? 'needs more' : 'too much'})</span>`);
  return `
    <p class="verdict ${st}">${VERDICT[st]}</p>
    ${good.length ? `<p class="plain"><b>Doing well:</b> ${good.map(esc).join(', ')}</p>` : ''}
    ${fix.length ? `<p class="plain"><b>Work on:</b> ${fix.join(', ')}</p>` : ''}
    ${!good.length && !fix.length ? '<p class="plain">Not enough was seen in this clip to judge this part.</p>' : ''}`;
}

function proRange(row, heightCm) {
  const a = fmt(row.lo, row.def.unit, heightCm), b = fmt(row.hi, row.def.unit, heightCm);
  return a === b ? a : `${a} – ${b}`;
}

function metricRow(row, heightCm, level) {
  const st = statusOf(row.score);
  const proLine = level >= 3 && row.pros && row.pros.length
    ? `<div class="metric-pros">${row.pros.map((p) => `${esc(p.id)} ${fmt(p.value, row.def.unit, heightCm)}`).join(' · ')}</div>` : '';
  return `
    <div class="metric">
      <div class="metric-head"><span>${esc(row.def.label)}</span><b>${fmt(row.value, row.def.unit, heightCm)}</b></div>
      ${gauge(row, heightCm)}
      <div class="metric-foot">
        <span>${row.status === 'missing' ? '' : `Pro ${proRange(row, heightCm)}`}</span>
        <span class="word ${st}">${level >= 3 && row.status !== 'missing' ? `${row.score} · ` : ''}${STATUS_WORD[st]}</span>
      </div>
      ${proLine}
    </div>`;
}

// Pro depth: the order and real-time spacing of the key moments, measured from contact.
function timingStrip(r) {
  const ts = r.timeScale || 1;
  const k = { ...(r.driveFrames || {}), ...r.keyFrames };
  const items = [
    ['loadBase', 'Load base'], ['pushStart', 'Push starts'], ['trophy', 'Trophy'],
    ['tossPeak', 'Toss peak'], ['contact', 'Contact'], ['drivePeak', 'Highest point'],
  ].filter(([key]) => Number.isFinite(k[key])).sort((a, b) => k[a[0]] - k[b[0]]);
  return `<div class="timing">${items.map(([key, label]) => {
    const dt = (k[key] - k.contact) / ts;
    return `<div><span>${label}</span><b>${key === 'contact' ? '0.00 s' : `${dt > 0 ? '+' : ''}${dt.toFixed(2)} s`}</b></div>`;
  }).join('')}<p class="timing-note">Real time, relative to contact.</p></div>`;
}

// ---------- progress chart ----------
export function renderHistory(el, history) {
  if (!history.length) {
    el.innerHTML = '<p class="empty-note">Your scores will appear here after your first analysis. Scans are saved in this browser.</p>';
    return;
  }
  const W = 1000, Hh = 200, padL = 34, padR = 16, padT = 14, padB = 28;
  const n = history.length;
  const x = (i) => padL + (n === 1 ? (W - padL - padR) / 2 : (i / (n - 1)) * (W - padL - padR));
  const y = (v) => padT + (1 - v / 100) * (Hh - padT - padB);
  const pts = history.map((h, i) => [x(i), y(h.overall ?? 0)]);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const area = `${line} L${pts[n - 1][0].toFixed(1)},${y(0)} L${pts[0][0].toFixed(1)},${y(0)} Z`;
  const date = (d) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const last = history[n - 1], first = history[0];
  const change = n > 1 ? (last.overall ?? 0) - (first.overall ?? 0) : null;
  el.innerHTML = `
    <div class="history-head">
      <div><span class="big">${last.overall ?? '–'}</span> latest</div>
      ${change !== null ? `<div class="delta ${change >= 0 ? 'up' : 'down'}">${change >= 0 ? '▲' : '▼'} ${Math.abs(change)} since ${date(first.date)}</div>` : ''}
      <div class="muted">${n} scan${n > 1 ? 's' : ''}</div>
    </div>
    <svg class="chart" viewBox="0 0 ${W} ${Hh}" role="img" aria-label="Serve score over time">
      ${[0, 50, 100].map((v) => `<line class="grid" x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}"></line><text class="axis" x="${padL - 8}" y="${y(v) + 4}" text-anchor="end">${v}</text>`).join('')}
      <path class="area" d="${area}"></path>
      <path class="line" d="${line}"></path>
      ${pts.map((p, i) => `<circle class="${i === n - 1 ? 'pt last' : 'pt'}" cx="${p[0]}" cy="${p[1]}" r="${i === n - 1 ? 5 : 3}"></circle>`).join('')}
      ${history.map((h, i) => (n <= 8 || i % Math.ceil(n / 8) === 0 || i === n - 1) ? `<text class="axis" x="${x(i)}" y="${Hh - 8}" text-anchor="middle">${date(h.date)}</text>` : '').join('')}
    </svg>`;
}

// ---------- flow of the serve ----------
export function renderFlow(el, pill, r, comparison, heightCm, level = 2) {
  const rows = comparison.rows.filter((row) => row.def.phase === 'flow');
  const scored = rows.filter((x) => x.status !== 'missing');
  const w = scored.reduce((a, x) => a + x.def.weight, 0);
  const score = w ? Math.round(scored.reduce((a, x) => a + x.score * x.def.weight, 0) / w) : null;
  const st = statusOf(score);
  pill.className = `pill ${st}`;
  pill.textContent = score ?? '–';
  const c = r.flow;
  const chart = c && c.t.length > 3 ? flowChart(c, heightCm, level) : '<p class="empty-note">Not enough of the motion was seen to draw the flow.</p>';
  const body = level <= 1
    ? `<div class="flow-simple">${simpleBody(rows, st)}</div>`
    : `<div class="flow-metrics">${rows.filter((x) => x.def.level <= level).map((x) => metricRow(x, heightCm, level)).join('')}</div>`;
  el.innerHTML = chart + body;
}

function flowChart(c, heightCm, level) {
  const ts = c.timeScale || 1;
  const t0 = c.marks.contact;
  const xs = c.t.map((t) => (t - t0) / ts);
  const ys = c.v.map((v) => (heightCm ? (v * heightCm) / 100 : v));
  const W = 1000, Hc = 220, padL = 44, padR = 16, padT = 34, padB = 30;
  const xMin = xs[0], xMax = xs[xs.length - 1];
  const yMax = Math.max(...ys) * 1.1 || 1;
  const X = (x) => padL + ((x - xMin) / (xMax - xMin || 1)) * (W - padL - padR);
  const Y = (y) => padT + (1 - y / yMax) * (Hc - padT - padB);
  const line = xs.map((x, i) => `${i ? 'L' : 'M'}${X(x).toFixed(1)},${Y(ys[i]).toFixed(1)}`).join(' ');
  const area = `${line} L${X(xMax).toFixed(1)},${Y(0)} L${X(xMin).toFixed(1)},${Y(0)} Z`;
  const unit = heightCm ? 'm/s' : 'H/s';
  const names = [['bounce', 'Bounce'], ['start', 'Motion starts'], ['trophy', 'Trophy'], ['contact', 'Contact'], ['landing', 'Landing']];
  let lastX = -1e9, row = 0;
  const marks = names.filter(([k]) => Number.isFinite(c.marks[k])).map(([k, label]) => {
    const x = X((c.marks[k] - t0) / ts);
    row = x - lastX < 90 ? 1 - row : 0;
    lastX = x;
    return `<line class="mark" x1="${x}" x2="${x}" y1="${padT - 6}" y2="${Y(0)}"></line>
      <text class="mark-label" x="${x}" y="${row ? 26 : 12}" text-anchor="${x > W - 80 ? 'end' : x < padL + 40 ? 'start' : 'middle'}">${label}</text>`;
  }).join('');
  const pause = c.pause ? `<rect class="pause" x="${X((c.pause[0] - t0) / ts)}" y="${padT}" width="${Math.max(2, X((c.pause[1] - t0) / ts) - X((c.pause[0] - t0) / ts))}" height="${Y(0) - padT}"></rect>` : '';
  const chain = level >= 3 && c.chainPeaks ? Object.entries({ Hip: c.chainPeaks.hips, Shoulder: c.chainPeaks.shoulders, Elbow: c.chainPeaks.elbow, Wrist: c.chainPeaks.wrist })
    .map(([label, t], i) => `<circle class="chain" cx="${X((t - t0) / ts)}" cy="${Y(0) - 8 - i * 9}" r="3.5"></circle><text class="axis" x="${X((t - t0) / ts) + (i % 2 ? -7 : 7)}" y="${Y(0) - 5 - i * 9}" text-anchor="${i % 2 ? 'end' : 'start'}">${label}</text>`).join('') : '';
  const ticks = [];
  for (let v = Math.ceil(xMin * 2) / 2; v <= xMax; v += 0.5) ticks.push(v);
  return `
    <svg class="chart flow-chart" viewBox="0 0 ${W} ${Hc}" role="img" aria-label="Whole-body speed from the bounce to landing">
      <line class="grid" x1="${padL}" x2="${W - padR}" y1="${Y(0)}" y2="${Y(0)}"></line>
      <line class="grid" x1="${padL}" x2="${W - padR}" y1="${Y(yMax / 1.1)}" y2="${Y(yMax / 1.1)}"></line>
      <text class="axis" x="${padL - 6}" y="${Y(yMax / 1.1) + 4}" text-anchor="end">${(yMax / 1.1).toFixed(1)}</text>
      <text class="axis" x="${padL - 6}" y="${Y(0) + 4}" text-anchor="end">0</text>
      ${pause}
      <path class="area" d="${area}"></path>
      <path class="line" d="${line}"></path>
      ${marks}
      ${chain}
      ${ticks.map((v) => `<text class="axis" x="${X(v)}" y="${Hc - 8}" text-anchor="middle">${v === 0 ? '0 s' : `${v > 0 ? '+' : ''}${v.toFixed(1)}`}</text>`).join('')}
    </svg>
    <p class="footnote">Whole-body speed (${unit}) in real time, relative to contact. A smooth serve builds speed in one continuous wave into contact${c.pause ? '; the shaded band is your longest pause' : ''}.</p>`;
}
