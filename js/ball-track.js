// ball-track.js
// Follows the one tossed ball through a single-serve clip.
//
// 1. Zoomed search: searchRegion() picks the part of the frame where the ball should be
//    (above the player's head, around the hands, and wherever the tracker predicts), so YOLO
//    can look at it enlarged instead of as a few pixels in the whole frame.
// 2. Tracking: once the ball has been found, its next position is predicted from its recent
//    speed and the way it is slowing or falling. Only candidates close to that prediction are
//    accepted, and a weak detection is accepted there because that's exactly where the ball
//    should be. Balls lying on the court and bright spots elsewhere are ignored.
// No browser code here, so it can be tested on its own.

const NOSE = 0, L_SH = 11, R_SH = 12, L_WR = 15, R_WR = 16, L_HIP = 23, R_HIP = 24, L_AN = 27, R_AN = 28;

// Rough player size in pixels from one frame's joints (shoulder-to-ankle span, scaled to full height).
export function bodyScale(pose) {
  if (!pose) return null;
  const shY = (pose[L_SH].y + pose[R_SH].y) / 2;
  const anY = (pose[L_AN].y + pose[R_AN].y) / 2;
  const span = Math.abs(anY - shY);
  return span > 4 ? span / 0.8 : null;
}

// The square to search (in analysis-canvas pixels), or null if we don't know where the player is.
// Covers from the hips to well above the head, around the head and both hands, and includes
// the predicted ball position if the tracker has one.
export function searchRegion(pose, predicted, width, height) {
  const H = bodyScale(pose);
  if (!H) return null;
  const xs = [pose[NOSE].x, pose[L_WR].x, pose[R_WR].x];
  const ys = [pose[NOSE].y - 1.0 * H, (pose[L_HIP].y + pose[R_HIP].y) / 2];
  if (predicted) { xs.push(predicted.x); ys.push(predicted.y); }
  let x0 = Math.min(...xs) - 0.35 * H, x1 = Math.max(...xs) + 0.35 * H;
  let y0 = Math.min(...ys) - 0.15 * H, y1 = Math.max(...ys);
  // Make it square (YOLO's input is square) and keep it inside the frame.
  const side = Math.min(Math.max(x1 - x0, y1 - y0), width, height);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  x0 = Math.max(0, Math.min(width - side, cx - side / 2));
  y0 = Math.max(0, Math.min(height - side, cy - side / 2));
  return { x: x0, y: y0, size: side };
}

// Merge candidates from the whole-frame and zoomed searches, dropping duplicates.
export function mergeCandidates(a, b) {
  const all = [...a, ...b].sort((p, q) => q.conf - p.conf);
  const kept = [];
  for (const c of all) if (kept.every((k) => Math.hypot(k.x - c.x, k.y - c.y) > Math.max(6, (k.w + c.w) / 4))) kept.push(c);
  return kept;
}

export function createBallTracker({ startConf = 0.15, keepConf = 0.05, maxMissSeconds = 0.25 } = {}) {
  let hist = [];        // recent accepted sightings: { t, x, y }
  let lastSeenT = null;
  let prevT = null, frameDt = null; // time between analysed frames

  function motion() {
    const n = hist.length;
    if (n < 2) return null;
    const a = hist[n - 2], b = hist[n - 1];
    const vx = (b.x - a.x) / (b.t - a.t), vy = (b.y - a.y) / (b.t - a.t);
    let ay = 0;
    if (n >= 3) {
      const z = hist[n - 3];
      const vy0 = (a.y - z.y) / (a.t - z.t);
      ay = (vy - vy0) / ((b.t - z.t) / 2);
    }
    return { vx, vy, ay };
  }

  function predict(t) {
    if (!hist.length) return null;
    const last = hist[hist.length - 1];
    const m = motion();
    if (!m) return { x: last.x, y: last.y };
    const dt = t - last.t;
    return { x: last.x + m.vx * dt, y: last.y + m.vy * dt + 0.5 * m.ay * dt * dt };
  }

  // candidates: [{ x, y, w, h, conf }] in analysis pixels. pose: this frame's joints (for size
  // and for finding the ball near the player). Returns the accepted ball or null.
  function update(t, candidates, pose) {
    const H = bodyScale(pose) || 200;
    if (prevT !== null && t > prevT) frameDt = t - prevT;
    prevT = t;
    if (hist.length && lastSeenT !== null && t - lastSeenT > maxMissSeconds) { hist = []; lastSeenT = null; }

    let pick = null;
    if (hist.length) {
      const p = predict(t);
      const misses = frameDt ? Math.max(0, Math.round((t - lastSeenT) / frameDt) - 1) : 0; // frames missed in a row
      const gate = Math.max(10, 0.1 * H) * (hist.length < 2 ? 2.5 : 1) * (1 + 0.5 * Math.min(4, misses));
      let best = Infinity;
      for (const c of candidates) {
        if (c.conf < keepConf) continue;
        const d = Math.hypot(c.x - p.x, c.y - p.y);
        if (d > gate) continue;
        const score = d / gate - c.conf; // close to the prediction and confident
        if (score < best) { best = score; pick = c; }
      }
    }
    if (!pick && pose) {
      // (Re)start: a confident ball close to the player, at hand height or above (not on the ground).
      const hipY = (pose[L_HIP].y + pose[R_HIP].y) / 2;
      const cx = pose[NOSE].x;
      const near = candidates
        .filter((c) => c.conf >= startConf && Math.abs(c.x - cx) < 1.0 * H && c.y < hipY && c.y > pose[NOSE].y - 2.0 * H)
        .sort((a, b) => b.conf - a.conf);
      if (near.length) { pick = near[0]; if (hist.length) hist = []; }
    }
    if (pick) {
      hist.push({ t, x: pick.x, y: pick.y });
      if (hist.length > 6) hist.shift();
      lastSeenT = t;
      return { ...pick, tracked: hist.length > 1 };
    }
    return null;
  }

  return { update, predict };
}
