// Tests the serve analysis on a made-up (synthetic) serve where we know the right answers.
// Run with:  node tests/analysis.test.mjs
import { readFileSync } from 'node:fs';
import { analyseServe, compareToPros, buildFeedback, J } from '../js/analysis.js';

const H = 300;          // player height in pixels
const G = 900;          // ground level (y) in pixels
const FPS = 60;
const lerp = (a, b, k) => a + (b - a) * Math.max(0, Math.min(1, k));
const ease = (t, t0, t1) => Math.max(0, Math.min(1, (t - t0) / (t1 - t0)));

// A right-handed pinpoint serve hitting towards +x.
//  0.0-0.9 s: knees bend, toss arm rises (trophy at 0.9 s), back foot slides up to the front foot
//  0.9-1.3 s: legs drive up (fastest around 1.15 s), hitting arm swings up to contact at 1.3 s
//  1.3-2.0 s: lands 0.6 H into the court
function makeServe() {
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

let failures = 0;
const check = (name, cond, detail) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? '  -> ' + detail : ''}`);
  if (!cond) failures++;
};
const near = (v, target, tol) => Number.isFinite(v) && Math.abs(v - target) <= tol;

const r = analyseServe(makeServe(), { timeScale: 1 });
const m = r.metrics;
check('hand detected as right', r.hand === 'right', r.hand);
check('stance detected as pinpoint', r.detectedStance === 'pinpoint', r.detectedStance);
check('court direction is +x', r.dir === 1, r.dir);
check('contact near 1.30 s', near(r.keyFrames.contact, 1.3, 0.04), r.keyFrames.contact);
check('trophy near 0.90 s', near(r.keyFrames.trophy, 0.9, 0.1), r.keyFrames.trophy);
check('contact height ~1.55 H (from ball)', near(m.contactHeight, 1.55, 0.06) && m.contactSource === 'ball', `${m.contactHeight?.toFixed(2)} ${m.contactSource}`);
check('toss height ~0.25 H', near(m.tossHeight, 0.25, 0.05), m.tossHeight?.toFixed(2));
check('toss placement ~0.35 H in front', near(m.tossPlacement, 0.35, 0.06), m.tossPlacement?.toFixed(2));
check('jump ~0.12 H', near(m.jump, 0.12, 0.03), m.jump?.toFixed(2));
check('landing ~0.6 H', near(m.landing, 0.6, 0.1), m.landing?.toFixed(2));
check('leg drive before contact', m.legDriveLead > 0.03 && m.legDriveLead < 0.35, m.legDriveLead?.toFixed(2));
check('knee bend measured', m.kneeFlex > 15 && m.kneeFlex < 120, m.kneeFlex?.toFixed(0));
check('arm straight at contact', m.armExtension > 160, m.armExtension?.toFixed(0));
check('trophy elbow bent', m.trophyElbow > 60 && m.trophyElbow < 130, m.trophyElbow?.toFixed(0));
check('tossing shoulder higher at trophy', m.shoulderTilt > 5, m.shoulderTilt?.toFixed(0));
check('racquet drop below shoulder', m.racquetDrop > 0.05, m.racquetDrop?.toFixed(2));

// Slow-motion clip: the same serve stretched 4x in time should give the same leg-drive timing
const slow = makeServe().map((f) => ({ ...f, t: f.t * 4 }));
const r4 = analyseServe(slow, { timeScale: 4 });
check('slow-mo time scaling', near(r4.metrics.legDriveLead, m.legDriveLead, 0.02), r4.metrics.legDriveLead?.toFixed(2));

// Left-handed mirror image
const mirror = makeServe().map((f) => ({ ...f, pose: f.pose.map((p, j) => {
  const swap = { 11: 12, 12: 11, 13: 14, 14: 13, 15: 16, 16: 15, 23: 24, 24: 23, 25: 26, 26: 25, 27: 28, 28: 27 };
  const q = f.pose[swap[j] ?? j];
  return { x: 1000 - q.x, y: q.y, v: 1 };
}), ball: f.ball && { ...f.ball, x: 1000 - f.ball.x }, racket: f.racket && { ...f.racket, x: 1000 - f.racket.x } }));
const rl = analyseServe(mirror, {});
check('left-handed mirror detected', rl.hand === 'left' && rl.dir === -1, `${rl.hand} dir ${rl.dir}`);
check('mirror gives same toss placement', near(rl.metrics.tossPlacement, m.tossPlacement, 0.01), rl.metrics.tossPlacement?.toFixed(2));

// Comparison and feedback
const refs = JSON.parse(readFileSync(new URL('../data/pros.json', import.meta.url)));
const c = compareToPros(r, refs);
check('compared with pinpoint pro', c.comparedWith.includes('Pro A') && !c.comparedWith.includes('Pro B'), c.comparedWith.join(','));
check('overall score 0-100', c.overall >= 0 && c.overall <= 100, c.overall);
const lowServe = { ...r, metrics: { ...m, contactHeight: 1.2 } };
const fb = buildFeedback(compareToPros(lowServe, refs), ['net']);
check('low contact + "net" ticked puts contact height first', fb[0] && fb[0].key === 'contactHeight', fb.map((f) => f.key).join(','));

console.log(failures ? `\n${failures} test(s) failed` : '\nAll tests passed');
process.exit(failures ? 1 : 0);
