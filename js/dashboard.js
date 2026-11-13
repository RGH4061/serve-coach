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
  const stanceNote = r.stance === r.detectedStance ? 'detected' : `chosen · detected ${r.detectedStance}`;
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

export function renderPhases(el, comparison, heightCm) {
  const byPhase = {};
  for (const row of comparison.rows) (byPhase[row.def.phase] ||= []).push(row);
  el.innerHTML = Object.entries(PHASES).map(([key, phase], i) => {
    const rows = byPhase[key] || [];
    const scored = rows.filter((r) => r.status !== 'missing');
    const w = scored.reduce((a, r) => a + r.def.weight, 0);
    const phaseScore = w ? Math.round(scored.reduce((a, r) => a + r.score * r.def.weight, 0) / w) : null;
    const st = statusOf(phaseScore);
    return `
      <article class="phase ${st}">
        <header>
          <div>
            <span class="step">${i + 1}</span>
            <h3>${phase.label}</h3>
            <p>${phase.hint}</p>
          </div>
          <span class="pill ${st}">${phaseScore ?? '–'}</span>
        </header>
        ${rows.map((row) => `
          <div class="metric">
            <div class="metric-head"><span>${esc(row.def.label)}</span><b>${fmt(row.value, row.def.unit, heightCm)}</b></div>
            ${gauge(row, heightCm)}
            <div class="metric-foot">
              <span>${row.status === 'missing' ? '' : `Pro ${fmt(row.lo, row.def.unit, heightCm)} – ${fmt(row.hi, row.def.unit, heightCm)}`}</span>
              <span class="word ${statusOf(row.score)}">${STATUS_WORD[statusOf(row.score)]}</span>
            </div>
          </div>`).join('')}
      </article>`;
  }).join('');
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
