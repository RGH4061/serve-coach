// Tests the serve analysis on a made-up (synthetic) serve where we know the right answers.
// Run with:  node tests/analysis.test.mjs
import { readFileSync } from 'node:fs';
import { analyseServe, compareToPros, buildFeedback, exportMotion, pickPro, alignTime, normaliseFrame, motionFrameAt } from '../js/analysis.js';
import { makeServe, H, G, FPS } from '../js/synthetic.js';

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
check('first landing step forward of the trophy foot', m.landing > 0.15 && m.landing < 0.6, m.landing?.toFixed(2));
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

// Stick-figure comparison helpers
const motion = exportMotion(makeServe(), r);
check('motion covers trophy to after contact', motion.frames[0].t <= r.keyFrames.trophy && motion.frames.at(-1).t > r.keyFrames.contact, `${motion.frames[0].t}-${motion.frames.at(-1).t}`);
const atContact = normaliseFrame(motion, motionFrameAt(motion, r.keyFrames.contact));
check('normalised feet near ground at start', Math.abs(normaliseFrame(motion, motion.frames[0]).joints[11].y) < 0.05);
check('normalised ball ~1.55 H at contact', near(atContact.ball.y, 1.55, 0.06), atContact.ball.y.toFixed(2));
const slowMotion = { ...motion, timeScale: 4, keyFrames: { trophy: motion.keyFrames.trophy * 4, contact: motion.keyFrames.contact * 4 } };
check('alignTime maps trophy to trophy', Math.abs(alignTime(r.keyFrames.trophy, motion, slowMotion) - slowMotion.keyFrames.trophy) < 1e-9);
check('alignTime maps contact to contact', Math.abs(alignTime(r.keyFrames.contact, motion, slowMotion) - slowMotion.keyFrames.contact) < 1e-9);
check('alignTime keeps real-time pace after contact', Math.abs(alignTime(r.keyFrames.contact + 0.1, motion, slowMotion) - (slowMotion.keyFrames.contact + 0.4)) < 1e-9);
const lib = { pros: [
  { id: 'P1', stance: 'platform', view: 'side', hand: 'right', heightCm: 200, motion: 'x' },
  { id: 'P2', stance: 'pinpoint', view: 'front', hand: 'right', heightCm: 180, motion: 'x' },
  { id: 'P3', stance: 'pinpoint', view: 'side', hand: 'left', heightCm: 185, motion: 'x' },
  { id: 'P4', stance: 'pinpoint', view: 'side', hand: 'right', heightCm: 198, motion: 'x' },
  { id: 'P5', stance: 'pinpoint', view: 'side', hand: 'right', heightCm: 183 },
] };
check('pickPro: stance, then view, then hand, then height', pickPro(lib, { stance: 'pinpoint', view: 'side', hand: 'right', heightCm: 183 }).pro.id === 'P4');
check('pickPro: left-hander gets left-handed pro', pickPro(lib, { stance: 'pinpoint', view: 'side', hand: 'left', heightCm: 183 }).pro.id === 'P3');
check('pickPro: ignores pros without movement data', pickPro({ pros: [lib.pros[4]] }, { stance: 'pinpoint', hand: 'right' }) === null);
const front = analyseServe(makeServe(), { view: 'front' });
check('front-on view drops side-only measurements', !('tossPlacement' in front.metrics) && !('landing' in front.metrics));

console.log(failures ? `\n${failures} test(s) failed` : '\nAll tests passed');
process.exit(failures ? 1 : 0);
