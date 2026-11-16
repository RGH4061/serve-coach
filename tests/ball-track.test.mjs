// Tests the ball tracker on a simulated toss with noise, missed frames and distractions.
// Run with:  node tests/ball-track.test.mjs
import { createBallTracker, searchRegion, mergeCandidates } from '../js/ball-track.js';

let failures = 0;
const check = (name, cond, detail) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? '  -> ' + detail : ''}`);
  if (!cond) failures++;
};
let seed = 3;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

// A standing player, 300 px tall, feet at y = 900, head around y = 620.
const pose = Array.from({ length: 33 }, () => ({ x: 500, y: 750 }));
pose[0] = { x: 500, y: 630 };                       // nose
pose[11] = { x: 490, y: 660 }; pose[12] = { x: 510, y: 660 }; // shoulders
pose[15] = { x: 520, y: 600 }; pose[16] = { x: 470, y: 700 }; // wrists
pose[23] = { x: 495, y: 745 }; pose[24] = { x: 505, y: 745 }; // hips
pose[27] = { x: 480, y: 900 }; pose[28] = { x: 520, y: 900 }; // ankles

// True ball: tossed from the hand at y 600, up about 230 px over 0.5 s, then falling (60 fps).
const g = 1840; // px/s² for this player size
const truth = [];
for (let i = 0; i <= 45; i++) { const t = i / 60; truth.push({ t, x: 520 + 15 * t, y: 600 - 920 * t + 0.5 * g * t * t }); }

function frameCandidates(i) {
  const b = truth[i];
  const c = [];
  // The real ball: seen strongly 40% of the time, weakly 35%, missed 25%
  const r = rand();
  if (r < 0.4) c.push({ x: b.x + (rand() - 0.5) * 4, y: b.y + (rand() - 0.5) * 4, w: 8, h: 8, conf: 0.3 + rand() * 0.4 });
  else if (r < 0.75) c.push({ x: b.x + (rand() - 0.5) * 6, y: b.y + (rand() - 0.5) * 6, w: 8, h: 8, conf: 0.05 + rand() * 0.07 });
  // A spare ball lying on the court, detected confidently every frame
  c.push({ x: 700, y: 890, w: 10, h: 10, conf: 0.6 });
  // A random false detection somewhere in the frame now and then
  if (rand() < 0.3) c.push({ x: rand() * 1000, y: rand() * 900, w: 8, h: 8, conf: 0.08 + rand() * 0.1 });
  return c;
}

const tracker = createBallTracker();
let found = 0, wrong = 0, strongOnly = 0;
for (let i = 0; i < truth.length; i++) {
  const cands = frameCandidates(i);
  if (cands.some((c) => c.conf >= 0.12 && Math.hypot(c.x - truth[i].x, c.y - truth[i].y) < 10)) strongOnly++;
  const ball = tracker.update(truth[i].t, cands, pose);
  if (ball) {
    if (Math.hypot(ball.x - truth[i].x, ball.y - truth[i].y) < 12) found++; else wrong++;
  }
}
console.log(`frames ${truth.length}: strong detections alone ${strongOnly}, tracker found ${found}, wrong picks ${wrong}`);
check('tracker finds the ball in more frames than strong detections alone', found > strongOnly + 5, `${found} vs ${strongOnly}`);
check('tracker never picks the ball lying on the court or a stray detection', wrong === 0, wrong);

// The predicted position follows the toss even with no detection
const t2 = createBallTracker();
for (let i = 0; i < 6; i++) t2.update(truth[i].t, [{ ...truth[i], w: 8, h: 8, conf: 0.5 }], pose);
const p = t2.predict(truth[9].t);
check('prediction 3 frames ahead is within 10 px', Math.hypot(p.x - truth[9].x, p.y - truth[9].y) < 10, `${Math.hypot(p.x - truth[9].x, p.y - truth[9].y).toFixed(1)} px`);

// Search region covers above the head and the predicted ball, and stays in the frame
const reg = searchRegion(pose, { x: 560, y: 300 }, 1280, 960);
check('search region includes the space above the head', reg.y < 630 - 200, JSON.stringify(reg));
check('search region includes the predicted ball', reg.x <= 560 && reg.x + reg.size >= 560 && reg.y <= 300 && reg.y + reg.size >= 300);
check('search region stays inside the frame', reg.x >= 0 && reg.y >= 0 && reg.x + reg.size <= 1280 && reg.y + reg.size <= 960);
check('merge drops duplicates', mergeCandidates([{ x: 10, y: 10, w: 8, conf: 0.3 }], [{ x: 12, y: 11, w: 8, conf: 0.5 }]).length === 1);

console.log(failures ? `\n${failures} test(s) failed` : '\nAll tests passed');
process.exit(failures ? 1 : 0);
