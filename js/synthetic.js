// synthetic.js
// A made-up, computer-generated serve (a stick figure). Used for the tests and for the
// example dashboard shown before you upload a video. It is not real player data.
import { J } from './analysis.js';

export const H = 300;          // player height in pixels
export const G = 900;          // ground level (y) in pixels
export const FPS = 60;
const lerp = (a, b, k) => a + (b - a) * Math.max(0, Math.min(1, k));
const ease = (t, t0, t1) => Math.max(0, Math.min(1, (t - t0) / (t1 - t0)));

// A right-handed pinpoint serve hitting towards +x.
//  0.0-0.9 s: knees bend, toss arm rises (trophy at 0.9 s), back foot slides up to the front foot
//  0.9-1.3 s: legs drive up (fastest around 1.15 s), hitting arm swings up to contact at 1.3 s
//  1.3-2.0 s: lands 0.6 H into the court
export function makeServe() {
  const frames = [];
  for (let i = 0; i < 2 * FPS; i++) {
    const t = i / FPS;
    const lift = t < 1.0 ? 0 : t < 1.3 ? lerp(0, 0.12 * H, ease(t, 1.0, 1.3)) : lerp(0.12 * H, 0, ease(t, 1.3, 1.5));
    const fwd = t < 1.3 ? 0 : lerp(0, 0.6 * H, ease(t, 1.3, 1.6));
    const sink = t < 0.9 ? lerp(0, 0.08 * H, ease(t, 0.3, 0.9)) : lerp(0.08 * H, 0, ease(t, 0.9, 1.25));
    const frontX = 500 + fwd;
    const backX = t < 0.9 ? lerp(500 - 0.35 * H, 500 - 0.05 * H, ease(t, 0.3, 0.8)) : 500 - 0.05 * H + fwd;
    const hipY = G - 0.52 * H + sink - lift;
    const hipX = 480 + fwd * 0.9 + (t > 0.9 ? lerp(0, 20, ease(t, 0.9, 1.3)) : 0);
    // Knees pushed forward when sinking, giving a bend
    const kneeFwd = sink * 1.6;
    const shY = hipY - 0.3 * H;
    const pose = Array.from({ length: 33 }, () => ({ x: hipX, y: hipY, v: 1 }));
    const set = (j, x, y) => { pose[j] = { x, y, v: 1 }; };
    set(J.nose, hipX + 5, shY - 0.07 * H); // nose ~0.89 H above the ankle joint, like a real body
    // Shoulder tilt at trophy: tossing (left) shoulder higher
    const tilt = t < 0.9 ? lerp(0, 0.05 * H, ease(t, 0.4, 0.9)) : lerp(0.05 * H, -0.04 * H, ease(t, 0.9, 1.3));
    set(J.lShoulder, hipX + 0.06 * H, shY - tilt);
    set(J.rShoulder, hipX - 0.06 * H, shY + tilt);
    // Toss (left) arm: rises to straight up at trophy
    const tossUp = t < 0.9 ? ease(t, 0.3, 0.9) : 1 - ease(t, 0.95, 1.3);
    set(J.lElbow, hipX + 0.08 * H, shY - tilt - 0.17 * H * tossUp + 0.17 * H * (1 - tossUp));
    set(J.lWrist, hipX + 0.1 * H, shY - tilt - 0.33 * H * tossUp + 0.3 * H * (1 - tossUp));
    // Hitting (right) arm: bent elbow at trophy (~95 deg), straight up at contact
    const reach = ease(t, 1.05, 1.3) * (t <= 1.3 ? 1 : 1 - ease(t, 1.3, 1.5));
    const rs = pose[J.rShoulder];
    const elbow = { x: rs.x - 0.18 * H * (1 - reach), y: rs.y - 0.02 * H - 0.16 * H * reach };
    const wrist = { x: elbow.x + 0.02 * H * (1 - reach), y: elbow.y - 0.15 * H };
    set(J.rElbow, elbow.x, elbow.y);
    set(J.rWrist, wrist.x + 0.0, wrist.y - 0.02 * H * reach);
    set(J.lHip, hipX + 0.04 * H, hipY); set(J.rHip, hipX - 0.04 * H, hipY);
    set(J.lKnee, (frontX + hipX) / 2 + kneeFwd, (hipY + G - lift) / 2);
    set(J.rKnee, (backX + hipX) / 2 + kneeFwd, (hipY + G - lift) / 2);
    set(J.lAnkle, frontX, G - lift); set(J.rAnkle, backX, G - lift);
    // Ball: tossed from 0.6 s, peaks 0.25 H above contact at 1.15 s, 0.35 H in front of front foot
    let ball = null;
    const contactY = G - 1.55 * H;
    if (t >= 0.6 && t <= 1.3) {
      const peakY = contactY - 0.25 * H;
      const k = t <= 1.15 ? ease(t, 0.6, 1.15) : 1 - ease(t, 1.15, 1.3);
      const y = t <= 1.15 ? lerp(hipY - 0.3 * H, peakY, 1 - (1 - k) ** 2) : lerp(contactY, peakY, k ** 0.5);
      ball = { x: 500 + 0.35 * H, y, w: 10, h: 10, conf: 0.6 };
    }
    if (Math.abs(t - 1.3) < 0.5 / FPS) ball = { x: pose[J.rWrist].x + 10, y: contactY, w: 10, h: 10, conf: 0.6 };
    // Racquet: dropped behind the back just before swinging up
    let racket = null;
    if (t > 0.95 && t < 1.1) racket = { x: rs.x - 0.1 * H, y: rs.y + 0.15 * H, w: 30, h: 60, conf: 0.5 };
    frames.push({ t, pose, ball, racket });
  }
  return frames;
}
