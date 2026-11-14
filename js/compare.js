// compare.js
// The "You vs Pro" panel: two stick figures, scaled to the same height, feet on the same
// ground line and court to the right, kept in step by their trophy and contact moments.
// "Side by side" draws them next to each other; "Overlay" draws the pro faintly over you.

import { alignTime, normaliseFrame, motionFrameAt } from './analysis.js';

// Bones by position in MOTION_JOINTS: 0 nose, 1/2 shoulders, 3/4 elbows, 5/6 wrists,
// 7/8 hips, 9/10 knees, 11/12 ankles (odd = left, even = right).
const FIG_BONES = [[1, 2], [1, 3], [3, 5], [2, 4], [4, 6], [1, 7], [2, 8], [7, 8], [7, 9], [9, 11], [8, 10], [10, 12], [0, 1], [0, 2]];
const FIG_COLORS = { you: '#f4ebe0', pro: '#e9c18c' };

export function createComparison(canvas) {
  const ctx = canvas.getContext('2d');
  let you = null, pro = null, mode = 'side', flip = false;

  function figure(fr, ox, scale, groundY, color, alpha, hand) {
    if (!fr) return;
    const P = (p) => [ox + p.x * scale, groundY - p.y * scale];
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(3, scale / 70);
    ctx.lineCap = 'round';
    for (const [a, b] of FIG_BONES) {
      const [x1, y1] = P(fr.joints[a]), [x2, y2] = P(fr.joints[b]);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
    // Highlight the hitting arm
    const arm = hand === 'left' ? [1, 3, 5] : [2, 4, 6];
    ctx.strokeStyle = '#f29350';
    ctx.beginPath();
    arm.forEach((i, k) => { const [x, y] = P(fr.joints[i]); k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.stroke();
    const [hx, hy] = P(fr.joints[0]);
    ctx.strokeStyle = color;
    ctx.beginPath(); ctx.arc(hx, hy, scale * 0.045, 0, 7); ctx.stroke();
    if (fr.ball) {
      const [bx, by] = P(fr.ball);
      ctx.fillStyle = '#dbe65c';
      ctx.beginPath(); ctx.arc(bx, by, Math.max(4, scale * 0.02), 0, 7); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function label(text, x, y, color) {
    ctx.font = `600 ${Math.round(canvas.height / 16)}px -apple-system, BlinkMacSystemFont, system-ui, sans-serif`;
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.fillText(text, x, y);
    ctx.textAlign = 'start';
  }

  function draw(t) {
    const W = canvas.width, Hc = canvas.height;
    ctx.clearRect(0, 0, W, Hc);
    const g = ctx.createLinearGradient(0, 0, W * 0.6, Hc);
    g.addColorStop(0, '#0c0a08'); g.addColorStop(0.55, '#2a1d14'); g.addColorStop(1, '#0c0a08');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, Hc);
    const ground = Hc * 0.9;
    ctx.fillStyle = '#9a5428';
    ctx.fillRect(0, ground, W, Hc - ground);
    ctx.strokeStyle = 'rgba(244,235,224,0.9)';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(0, ground); ctx.lineTo(W, ground); ctx.stroke();
    // Height guides at 1x and 1.5x player height
    const scale = Hc * 0.42; // pixels per player height
    ctx.setLineDash([6, 8]);
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1;
    for (const k of [1, 1.5]) { ctx.beginPath(); ctx.moveTo(0, ground - k * scale); ctx.lineTo(W, ground - k * scale); ctx.stroke(); }
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = `${Math.round(Hc / 30)}px -apple-system, BlinkMacSystemFont, system-ui, sans-serif`;
    ctx.fillText('1.0 × height', 8, ground - scale - 6);
    ctx.fillText('1.5 × height', 8, ground - 1.5 * scale - 6);
    if (!you || !pro) return;

    // You are drawn exactly as filmed; the pro is turned to face the same way as you.
    const facing = you.motion.dir || 1;
    const yf = normaliseFrame(you.motion, motionFrameAt(you.motion, t), facing);
    const pf = normaliseFrame(pro.motion, motionFrameAt(pro.motion, alignTime(t, you.motion, pro.motion)), flip ? -facing : facing);
    if (mode === 'side') {
      figure(yf, W * 0.27, scale, ground, FIG_COLORS.you, 1, you.motion.hand);
      figure(pf, W * 0.7, scale, ground, FIG_COLORS.pro, 1, pro.motion.hand);
      label('You', W * 0.27, Hc * 0.08, FIG_COLORS.you);
      label(pro.name, W * 0.7, Hc * 0.08, FIG_COLORS.pro);
    } else {
      figure(pf, W * 0.48, scale, ground, FIG_COLORS.pro, 0.55, pro.motion.hand);
      figure(yf, W * 0.48, scale, ground, FIG_COLORS.you, 1, you.motion.hand);
      label('You (white) · ' + pro.name + ' (sand)', W * 0.5, Hc * 0.08, '#f4ebe0');
    }
  }

  return {
    set(youMotion, proMotion, proName) {
      you = youMotion ? { motion: youMotion } : null;
      pro = proMotion ? { motion: proMotion, name: proName } : null;
    },
    setMode(m) { mode = m; },
    setFlip(f) { flip = f; },
    draw,
  };
}
