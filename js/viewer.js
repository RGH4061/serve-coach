// viewer.js
// The video panel: draws the skeleton, ball and racquet on top of the video, and runs the
// timeline with markers for the trophy, toss peak and contact. In example mode there is no
// video, so it animates the computer-generated stick figure instead.

const BONES = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [24, 26], [26, 28], [27, 31], [28, 32], [0, 11], [0, 12]];
const KEYS = [['tossPeak', 'Toss peak'], ['trophy', 'Trophy'], ['contact', 'Contact']];

export function createViewer(els) {
  const { video, canvas, range, markers, time, play, back, fwd, speed, showPose, showBall, showRacket, trimShade } = els;
  const ctx = canvas.getContext('2d');
  const s = { mode: 'example', frames: [], keyFrames: {}, t: 0, playing: false, duration: 1, step: 1 / 60, prev: null, trim: null, onFrame: null };

  const now = () => (s.mode === 'live' ? video.currentTime : s.t);
  function seek(t) {
    t = Math.max(0, Math.min(s.duration, t));
    if (s.mode === 'live') video.currentTime = t; else s.t = t;
  }
  function frameAt(t) {
    let best = null;
    for (const f of s.frames) if (!best || Math.abs(f.t - t) < Math.abs(best.t - t)) best = f;
    return best;
  }

  function drawFrame(f) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (s.mode === 'example') {
      // Simple court backdrop for the example stick figure
      ctx.fillStyle = '#21405f';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#2f5d86';
      ctx.fillRect(0, canvas.height * 0.94, canvas.width, canvas.height * 0.06);
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(0, canvas.height * 0.94); ctx.lineTo(canvas.width, canvas.height * 0.94); ctx.stroke();
    }
    if (!f) return;
    const lw = Math.max(2, canvas.width / 280);
    if (showPose.checked && f.pose) {
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.lineWidth = lw;
      ctx.lineCap = 'round';
      for (const [a, b] of BONES) {
        if (!f.pose[a] || !f.pose[b]) continue;
        ctx.beginPath(); ctx.moveTo(f.pose[a].x, f.pose[a].y); ctx.lineTo(f.pose[b].x, f.pose[b].y); ctx.stroke();
      }
      ctx.fillStyle = '#4da3ff';
      for (const p of f.pose.slice(11, 29)) { ctx.beginPath(); ctx.arc(p.x, p.y, lw * 1.6, 0, 7); ctx.fill(); }
      ctx.beginPath(); ctx.arc(f.pose[0].x, f.pose[0].y, lw * 4, 0, 7); ctx.stroke();
    }
    if (showRacket.checked && f.racket) {
      const r = f.racket;
      ctx.strokeStyle = '#ff9f43';
      ctx.lineWidth = lw;
      ctx.strokeRect(r.x - r.w / 2, r.y - r.h / 2, r.w, r.h);
    }
    if (showBall.checked) {
      ctx.fillStyle = 'rgba(223,255,79,0.55)';
      s.frames.filter((g) => g.ball && g.t <= f.t && g.t > f.t - 0.6)
        .forEach((g) => { ctx.beginPath(); ctx.arc(g.ball.x, g.ball.y, lw * 2, 0, 7); ctx.fill(); });
      if (f.ball) {
        ctx.fillStyle = '#dfff4f';
        ctx.beginPath(); ctx.arc(f.ball.x, f.ball.y, Math.max(f.ball.w / 2, lw * 3), 0, 7); ctx.fill();
      }
    }
    const hit = KEYS.find(([k]) => s.keyFrames[k] !== null && s.keyFrames[k] !== undefined && Math.abs(s.keyFrames[k] - f.t) < s.step * 0.75);
    if (hit) {
      ctx.font = `600 ${Math.round(canvas.height / 20)}px "Barlow Condensed", system-ui, sans-serif`;
      ctx.fillStyle = '#dfff4f';
      ctx.fillText(hit[1].toUpperCase(), canvas.width * 0.03, canvas.height * 0.08);
    }
  }

  function placeMarkers() {
    // Labels that sit close together go on alternate rows so they don't overlap.
    let lastPct = -100, row = 0;
    markers.innerHTML = KEYS.filter(([k]) => Number.isFinite(s.keyFrames[k]))
      .sort((a, b) => s.keyFrames[a[0]] - s.keyFrames[b[0]])
      .map(([k, label]) => {
        const pct = (s.keyFrames[k] / s.duration) * 100;
        row = pct - lastPct < 12 ? 1 - row : 0;
        lastPct = pct;
        return `<button type="button" class="tick${row ? ' low' : ''}" data-key="${k}" style="left:${pct}%" title="Jump to ${label}">${label}</button>`;
      }).join('');
    markers.querySelectorAll('.tick').forEach((b) => b.addEventListener('click', () => { stop(); seek(s.keyFrames[b.dataset.key]); }));
  }

  function stop() { s.playing = false; video.pause(); play.textContent = 'Play'; }

  play.addEventListener('click', () => {
    if (s.playing) return stop();
    const start = s.trim ? s.trim.start : 0, end = s.trim ? s.trim.end : s.duration;
    if (now() < start || now() >= end - s.step) seek(start);
    s.playing = true;
    play.textContent = 'Pause';
    if (s.mode === 'live') { video.playbackRate = Number(speed.value); video.play(); }
  });
  video.addEventListener('ended', stop);
  speed.addEventListener('change', () => { video.playbackRate = Number(speed.value); });
  back.addEventListener('click', () => { stop(); seek(now() - s.step); });
  fwd.addEventListener('click', () => { stop(); seek(now() + s.step); });
  range.addEventListener('input', () => { stop(); seek(Number(range.value)); });
  [showPose, showBall, showRacket].forEach((c) => c.addEventListener('change', () => drawFrame(frameAt(now()))));

  function loop(ts) {
    const dt = s.prev ? (ts - s.prev) / 1000 : 0;
    s.prev = ts;
    if (s.playing && s.mode === 'example') {
      s.t += dt * Number(speed.value);
      if (s.t >= s.duration) { s.t = s.duration; stop(); }
    }
    // When trimmed, playback stops at the end of the trimmed part.
    if (s.playing && s.mode === 'live' && s.trim && video.currentTime >= s.trim.end) { stop(); seek(s.trim.end); }
    const t = now();
    if (document.activeElement !== range) range.value = t;
    time.textContent = `${t.toFixed(2)} s / ${s.duration.toFixed(2)} s`;
    if (s.frames.length || s.mode === 'example') drawFrame(frameAt(t));
    if (s.onFrame) s.onFrame(t);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  return {
    // mode 'example' (stick figure) or 'live' (real video)
    set({ mode, frames = [], keyFrames = {}, width, height, duration, step }) {
      stop();
      Object.assign(s, { mode, frames, keyFrames, duration: duration || 1, step: step || s.step });
      if (mode === 'example') this.setTrim(null);
      canvas.width = width; canvas.height = height;
      canvas.classList.toggle('solo', mode === 'example');
      video.classList.toggle('hidden', mode === 'example');
      range.max = s.duration; range.step = 0.001;
      placeMarkers();
      seek(keyFrames.contact ?? 0);
    },
    drawFrame,
    seek,
    now,
    onFrame(fn) { s.onFrame = fn; },
    setKeyFrames(keyFrames) { s.keyFrames = keyFrames; placeMarkers(); },
    // Highlight the part of the clip that will be analysed (null = whole clip).
    setTrim(trim) {
      s.trim = trim;
      trimShade.classList.toggle('hidden', !trim);
      if (trim) {
        trimShade.style.left = `${(trim.start / s.duration) * 100}%`;
        trimShade.style.width = `${((trim.end - trim.start) / s.duration) * 100}%`;
      }
    },
  };
}
