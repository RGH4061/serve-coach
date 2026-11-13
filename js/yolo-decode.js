// yolo-decode.js
// Turns YOLO's raw output numbers into ball and racquet boxes (no browser code, so it can be tested).

const CLASS_BALL = 32;   // COCO "sports ball"
const CLASS_RACKET = 38; // COCO "tennis racket"

// YOLO11 output is 84 rows x 8400 candidate boxes: rows 0-3 are box centre x, y, width, height,
// rows 4-83 are the confidence for each of the 80 COCO object types.
// Overlap between two boxes: 0 = none, 1 = identical.
function iou(a, b) {
  const ix = Math.max(0, Math.min(a.x + a.w / 2, b.x + b.w / 2) - Math.max(a.x - a.w / 2, b.x - b.w / 2));
  const iy = Math.max(0, Math.min(a.y + a.h / 2, b.y + b.h / 2) - Math.max(a.y - a.h / 2, b.y - b.h / 2));
  const inter = ix * iy;
  return inter / (a.w * a.h + b.w * b.h - inter || 1);
}

export function decodeYolo(out, { scale, padX, padY }, n = 8400, classes = { ball: CLASS_BALL, racket: CLASS_RACKET }) {
  const pick = (cls, minConf) => {
    const found = [];
    for (let i = 0; i < n; i++) {
      const conf = out[(4 + cls) * n + i];
      if (conf < minConf) continue;
      found.push({
        x: (out[i] - padX) / scale,
        y: (out[n + i] - padY) / scale,
        w: out[2 * n + i] / scale,
        h: out[3 * n + i] / scale,
        conf,
      });
    }
    // Remove overlapping duplicates, keep the most confident.
    found.sort((a, b) => b.conf - a.conf);
    const kept = [];
    for (const b of found) {
      if (kept.every((k) => iou(k, b) < 0.45)) kept.push(b);
      if (kept.length >= 5) break;
    }
    return kept;
  };
  return { balls: pick(classes.ball, 0.12), rackets: pick(classes.racket, 0.2) };
}

// Pick one ball per frame: the candidate closest to where the ball was last seen,
// otherwise the most confident one.
export function chooseBall(candidates, last, maxJump) {
  if (!candidates.length) return null;
  if (last) {
    const near = candidates
      .map((c) => ({ c, d: Math.hypot(c.x - last.x, c.y - last.y) }))
      .filter((o) => o.d < maxJump)
      .sort((a, b) => a.d - b.d);
    if (near.length) return near[0].c;
  }
  return candidates[0];
}
