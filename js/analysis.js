// analysis.js
// Turns per-frame detections (body joints, ball, racquet) into serve measurements.
// This file has no browser code in it, so it can be tested on its own.
//
// Each frame looks like:
//   { t: seconds, pose: [33 points {x, y, v}] or null, ball: {x, y, conf} or null,
//     racket: {x, y, w, h, conf} or null }
// All x/y values are in video pixels (y grows DOWNWARDS, like on a screen).

// MediaPipe Pose joint numbers we use
export const J = {
  nose: 0,
  lShoulder: 11, rShoulder: 12,
  lElbow: 13, rElbow: 14,
  lWrist: 15, rWrist: 16,
  lHip: 23, rHip: 24,
  lKnee: 25, rKnee: 26,
  lAnkle: 27, rAnkle: 28,
};

// ---------- small maths helpers ----------
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const median = (arr) => {
  const s = arr.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!s.length) return NaN;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const percentile = (arr, q) => {
  const s = arr.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : NaN;
};
// Angle at point b (in degrees) made by a-b-c. 180 = straight line.
export function angleAt(a, b, c) {
  const v1 = { x: a.x - b.x, y: a.y - b.y };
  const v2 = { x: c.x - b.x, y: c.y - b.y };
  const cos = (v1.x * v2.x + v1.y * v2.y) / (Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y) || 1);
  return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
}

// Smooth joint positions over 3 neighbouring frames to reduce jitter.
function smoothPoses(frames) {
  return frames.map((f, i) => {
    if (!f.pose) return f;
    const group = [frames[i - 1], f, frames[i + 1]].filter((g) => g && g.pose);
    const pose = f.pose.map((_, j) => {
      let x = 0, y = 0;
      group.forEach((g) => { x += g.pose[j].x; y += g.pose[j].y; });
      return { x: x / group.length, y: y / group.length, v: f.pose[j].v };
    });
    return { ...f, pose };
  });
}

// ---------- metric definitions ----------
// unit "H" means "player heights" so tall and short players compare fairly.
export const METRICS = {
  kneeFlex:      { level: 1, plain: 'knee bend', phase: 'load', scale: [0, 100], label: 'Knee bend (deepest)', unit: '°', tol: 8, weight: 1.2,
                   low: 'Bend your knees more as you toss — think "sit into the serve" so your legs can drive you up.',
                   high: 'You are bending very deeply; a little less bend can make the leg drive quicker and more controlled.' },
  trophyElbow:   { level: 2, plain: 'arm position at the trophy', phase: 'trophy', scale: [40, 180], label: 'Hitting elbow angle at trophy', unit: '°', tol: 15, weight: 0.8,
                   low: 'Your hitting elbow is very bent at the trophy position; open it a little so the racquet sits up behind your head.',
                   high: 'Your hitting arm is quite straight at the trophy position; bend the elbow to about a right angle to load the racquet.' },
  shoulderTilt:  { level: 3, plain: 'shoulder tilt', phase: 'trophy', scale: [-10, 50], label: 'Shoulder tilt at trophy', unit: '°', tol: 7, weight: 1.0,
                   low: 'Tilt your shoulders more at the trophy position — tossing shoulder up, hitting shoulder down — to help you hit up to the ball.',
                   high: 'Your shoulders are tilting a lot; this can pull the toss behind you. Aim for a slightly flatter tilt.' },
  tossHeight:    { level: 1, plain: 'toss height', phase: 'toss', scale: [-0.2, 0.7], label: 'Toss peak above contact point', unit: 'H', tol: 0.1, weight: 1.0,
                   low: 'Your toss is low, so you are rushing. Toss a little higher so the ball peaks just above where you hit it.',
                   high: 'Your toss is going quite high, so the ball is falling fast at contact. Toss a bit lower for better timing.' },
  tossPlacement: { level: 2, plain: 'toss position', sideOnly: true, phase: 'toss', scale: [-0.3, 0.8], label: 'Toss in front of front foot', unit: 'H', tol: 0.12, weight: 1.3,
                   low: 'Your toss is not far enough in front. Toss slightly more into the court so your body moves forward into the ball.',
                   high: 'Your toss is far in front of you, which often sends the ball into the net. Bring the toss back slightly.' },
  racquetDrop:   { level: 3, plain: 'racquet drop', phase: 'contact', scale: [-0.2, 0.4], label: 'Racquet drop below shoulder', unit: 'H', tol: 0.08, weight: 0.8,
                   low: 'The racquet is not dropping far down your back. Relax your arm so the racquet falls lower before swinging up.',
                   high: 'Your racquet drop is very deep; that is not usually a problem, but check it is not slowing your swing.' },
  contactHeight: { level: 1, plain: 'contact height', phase: 'contact', scale: [1.0, 1.8], label: 'Contact height above ground', unit: 'H', tol: 0.08, weight: 1.3,
                   low: 'You are hitting the ball low. Reach up fully and hit at the top of your reach — low contact is a common reason serves go into the net.',
                   high: 'Your contact point is very high — great reach. Make sure you are not waiting for the ball to drop.' },
  armExtension:  { level: 2, plain: 'reaching up at contact', phase: 'contact', scale: [120, 180], label: 'Hitting arm straightness at contact', unit: '°', tol: 10, weight: 1.0,
                   low: 'Your arm is bent at contact. Hit up with a straight arm at full stretch.',
                   high: 'Good full extension at contact.' },
  jump:          { level: 2, plain: 'jumping into the ball', phase: 'finish', scale: [0, 0.3], label: 'Jump height (feet off ground)', unit: 'H', tol: 0.05, weight: 0.7,
                   low: 'You are staying on the ground. Let your leg drive lift you up into the ball.',
                   high: 'Big jump — make sure you stay balanced and land well.' },
  legDriveLead:  { level: 3, plain: 'leg drive timing', phase: 'finish', scale: [0, 0.5], label: 'Leg drive before contact', unit: 's', tol: 0.08, weight: 1.0,
                   low: 'Your legs and arm are firing almost together. Push up with your legs first, then let the arm follow.',
                   high: 'Your leg drive is happening a long time before contact, so the energy is lost. Link the push up and swing more tightly.' },
  landing:       { level: 2, plain: 'moving into the court', sideOnly: true, phase: 'finish', scale: [0, 1.2], label: 'Landing distance into court', unit: 'H', tol: 0.15, weight: 0.6,
                   low: 'You are landing close to where you started. Let your body move forward into the court after contact.',
                   high: 'You are travelling a long way forward after the serve — good if you serve and volley, otherwise check your balance.' },
  driveSpeed:    { level: 1, plain: 'drive up from your knees', phase: 'finish', scale: [0, 1.6], label: 'Drive speed up from the load', unit: 'H/s', tol: 0.12, weight: 1.2,
                   low: 'Your body rises slowly out of the knee bend. Push hard off the ground so your hips drive up towards the ball. This upward drive is a big source of serve power.',
                   high: 'Very fast drive up out of the load. Make sure you stay balanced and on line.' },
  driveAccel:    { level: 2, plain: 'explosive push', phase: 'finish', scale: [0, 14], label: 'Drive acceleration (power)', unit: 'H/s²', tol: 1.5, weight: 1.2,
                   low: 'Your push up from the bottom of the knee bend builds speed slowly. Think "explode up": a quicker, sharper push, rather than a long slow stand-up.',
                   high: 'Very explosive push. Good, as long as the toss and arm keep up with it.' },
  driveTime:     { level: 3, plain: 'push time', phase: 'finish', scale: [0, 0.8], label: 'Push time (start of push to peak)', unit: 's', tol: 0.08, weight: 0.6,
                   low: 'Your push up is very short; check you are fully loading the legs before driving up.',
                   high: 'It takes a long time to get from the knee bend to full stretch. Make the push up quicker and more explosive.' },
  driveRise:     { level: 3, plain: 'hip rise', phase: 'finish', scale: [0, 0.4], label: 'Hip rise from load to peak', unit: 'H', tol: 0.05, weight: 0.6,
                   low: 'Your hips don\'t travel far up from the load. A deeper knee bend and a full push give a longer, more powerful drive.',
                   high: 'Big hip rise from the load. Good use of the legs.' },
  flowSmoothness: { level: 1, plain: 'smooth rhythm', phase: 'flow', scale: [-8, -1], label: 'Smoothness (bounce to landing)', unit: 'sparc', tol: 0.5, weight: 1.0,
                   low: 'Your motion speeds up and slows down in jerky bursts. Aim for one continuous rhythm from the bounce to the landing, building speed steadily into contact.',
                   high: 'Very smooth, continuous motion from the bounce to the landing.' },
  flowPause:     { level: 2, plain: 'no long pauses', phase: 'flow', scale: [0, 0.8], label: 'Longest pause in the motion', unit: 's', tol: 0.08, weight: 0.8,
                   low: 'Your motion never pauses, which is fine as long as it stays controlled.',
                   high: 'There is a noticeable stop in your motion (often at the trophy or just after the toss). A brief hold is fine, but a long stop breaks the rhythm and wastes the energy you have built up.' },
  chainOrder:    { level: 2, plain: 'body parts firing in order', phase: 'flow', scale: [0, 3], label: 'Kinetic chain order (hips → shoulders → elbow → wrist)', unit: 'of 3', tol: 0.5, weight: 1.0,
                   low: 'Your body parts are not speeding up in order. Power flows up a chain: hips first, then shoulders, then elbow, then wrist and racquet. Let each one lead the next rather than swinging with the arm.',
                   high: 'Good sequencing.' },
};

// Detail levels for the breakdown: 1 = Simple, 2 = Intermediate, 3 = Pro depth.
export const DETAIL = { simple: 1, intermediate: 2, pro: 3 };

// The stages of the serve, in order, used to group measurements on the dashboard.
export const PHASES = {
  toss:    { label: 'Toss', hint: 'Ball release to peak' },
  load:    { label: 'Load', hint: 'Knee bend and coil' },
  trophy:  { label: 'Trophy', hint: 'Racquet up, tossing arm high' },
  contact: { label: 'Swing & contact', hint: 'Racquet drop to impact' },
  finish:  { label: 'Drive & landing', hint: 'Leg drive, jump, follow-through' },
};

// Which measurements matter most for each tick-box problem.
export const ISSUES = {
  net:      { label: 'Serves into the net', metrics: ['contactHeight', 'tossPlacement', 'armExtension', 'tossHeight', 'kneeFlex'] },
  long:     { label: 'Serves go long', metrics: ['tossPlacement', 'shoulderTilt', 'contactHeight', 'tossHeight'] },
  wide:     { label: 'Serves go wide', metrics: ['tossPlacement', 'shoulderTilt'] },
  doubles:  { label: 'Lots of double faults', metrics: ['tossHeight', 'tossPlacement', 'contactHeight'] },
  power:    { label: 'Lack of power', metrics: ['kneeFlex', 'legDriveLead', 'racquetDrop', 'trophyElbow', 'jump'] },
  toss:     { label: 'Toss is inconsistent', metrics: ['tossHeight', 'tossPlacement'] },
};

// ---------- the main analysis ----------
// options: { hand: 'auto'|'right'|'left', stance: 'auto'|'pinpoint'|'platform', timeScale: 1 }
// timeScale: 1 for real-time clips, 4 if the clip was saved as 4x slow motion, etc.
export function analyseServe(rawFrames, options = {}) {
  const timeScale = options.timeScale || 1;
  const frames = smoothPoses(rawFrames.filter((f) => f.pose));
  if (frames.length < 10) {
    throw new Error('Could not find the player clearly in enough frames. Check the whole body is in shot.');
  }
  const P = (f, j) => f.pose[j];
  const n = frames.length;
  const early = frames.slice(0, Math.max(3, Math.round(n * 0.15)));

  // 1. Player height in pixels (nose to ankles, plus a bit for the top of the head)
  // Measured from body segment lengths (shin, thigh, torso, neck) rather than standing height,
  // so it still works when the player is bent over bouncing the ball. Ankle-to-nose is about
  // 88% of full height, hence the 1.136.
  const upright = frames.slice(0, Math.max(10, Math.round(n * 0.9)));
  const seg = (fn) => percentile(upright.map(fn), 0.75);
  const H = 1.136 * (
    seg((f) => (dist(P(f, J.lKnee), P(f, J.lAnkle)) + dist(P(f, J.rKnee), P(f, J.rAnkle))) / 2) +
    seg((f) => (dist(P(f, J.lHip), P(f, J.lKnee)) + dist(P(f, J.rHip), P(f, J.rKnee))) / 2) +
    seg((f) => dist(mid(P(f, J.lHip), P(f, J.rHip)), mid(P(f, J.lShoulder), P(f, J.rShoulder)))) +
    seg((f) => dist(mid(P(f, J.lShoulder), P(f, J.rShoulder)), P(f, J.nose))));

  // 2. Which hand hits? The hitting wrist reaches higher (smaller y) than the tossing wrist.
  let hand = options.hand;
  if (!hand || hand === 'auto') {
    const minL = Math.min(...frames.map((f) => P(f, J.lWrist).y));
    const minR = Math.min(...frames.map((f) => P(f, J.rWrist).y));
    hand = minR <= minL ? 'right' : 'left';
  }
  const S = hand === 'right'
    ? { hS: J.rShoulder, hE: J.rElbow, hW: J.rWrist, tS: J.lShoulder, tW: J.lWrist }
    : { hS: J.lShoulder, hE: J.lElbow, hW: J.lWrist, tS: J.rShoulder, tW: J.rWrist };

  // 3. Contact = when the hitting wrist is at its highest. Refine with the ball if seen nearby.
  // Key moments can be set by hand (options.keyFrames, in seconds), e.g. in the reference builder.
  const manual = options.keyFrames || {};
  const nearestIdx = (t) => frames.reduce((bi, f, i) => (Math.abs(f.t - t) < Math.abs(frames[bi].t - t) ? i : bi), 0);
  let contactIdx = 0;
  frames.forEach((f, i) => { if (P(f, S.hW).y < P(frames[contactIdx], S.hW).y) contactIdx = i; });
  let best = Infinity;
  if (Number.isFinite(manual.contact)) { contactIdx = nearestIdx(manual.contact); best = -1; }
  for (let i = Math.max(0, contactIdx - 3); best >= 0 && i <= Math.min(n - 1, contactIdx + 3); i++) {
    const b = frames[i].ball;
    if (!b) continue;
    const d = dist(b, P(frames[i], S.hW));
    if (d < best && d < 0.6 * H) { best = d; contactIdx = i; }
  }
  const contact = frames[contactIdx];

  // 4. Trophy position. Coaches and sports scientists usually take this as the moment of
  //    deepest knee bend, with the tossing arm up and the hitting elbow raised to about
  //    shoulder height. We look between the toss arm passing shoulder height and contact.
  const kneeBend = (f) => ((180 - angleAt(P(f, J.lHip), P(f, J.lKnee), P(f, J.lAnkle))) +
                           (180 - angleAt(P(f, J.rHip), P(f, J.rKnee), P(f, J.rAnkle)))) / 2;
  let tossUpIdx = 0;
  while (tossUpIdx < contactIdx && P(frames[tossUpIdx], S.tW).y > P(frames[tossUpIdx], S.tS).y) tossUpIdx++;
  if (tossUpIdx >= contactIdx) tossUpIdx = 0;
  const elbowUp = (f) => P(f, S.hE).y < P(f, S.hS).y + 0.1 * H;
  let trophyIdx = -1;
  for (const needElbow of [true, false]) {
    for (let i = tossUpIdx; i < contactIdx; i++) {
      if (needElbow && !elbowUp(frames[i])) continue;
      if (trophyIdx < 0 || kneeBend(frames[i]) > kneeBend(frames[trophyIdx])) trophyIdx = i;
    }
    if (trophyIdx >= 0) break;
  }
  if (trophyIdx < 0) trophyIdx = Math.max(0, contactIdx - 1);
  if (Number.isFinite(manual.trophy)) trophyIdx = Math.min(nearestIdx(manual.trophy), Math.max(0, contactIdx - 1));
  const trophy = frames[trophyIdx];

  // Ground level: where the feet are in the half-second before the trophy position,
  // when the player is set at the baseline (not walking in or bouncing the ball).
  const setUp = frames.filter((f) => f.t >= trophy.t - 0.5 * timeScale && f.t <= trophy.t);
  const groundY = median(setUp.map((f) => Math.max(P(f, J.lAnkle).y, P(f, J.rAnkle).y)));

  // 5. Which way is the court? The player moves towards it during the serve.
  const hipX = (f) => mid(P(f, J.lHip), P(f, J.rHip)).x;
  const endF = frames[Math.min(n - 1, contactIdx + 5)];
  let dir = Math.sign(hipX(endF) - hipX(frames[0])) || 1;
  const frontAnkleX = (f) => (dir > 0 ? Math.max : Math.min)(P(f, J.lAnkle).x, P(f, J.rAnkle).x);

  // 6. Stance: pinpoint if the back foot slides up so the feet come close together.
  const gap = (f) => Math.abs(P(f, J.lAnkle).x - P(f, J.rAnkle).x) / H;
  const gapStart = median(early.map(gap));
  const gapMin = Math.min(...frames.slice(0, Math.max(1, contactIdx)).map(gap));
  const detectedStance = gapStart > 0.12 && gapMin < gapStart * 0.5 ? 'pinpoint' : 'platform';
  const stance = options.stance && options.stance !== 'auto' ? options.stance : detectedStance;

  const m = {};

  // Knee bend: deepest average knee bend before contact (0° = straight leg)
  m.kneeFlex = Math.max(...frames.slice(0, contactIdx + 1).map((f) => {
    const l = 180 - angleAt(P(f, J.lHip), P(f, J.lKnee), P(f, J.lAnkle));
    const r = 180 - angleAt(P(f, J.rHip), P(f, J.rKnee), P(f, J.rAnkle));
    return (l + r) / 2;
  }));

  // Trophy position checks
  m.trophyElbow = angleAt(P(trophy, S.hS), P(trophy, S.hE), P(trophy, S.hW));
  const ts = P(trophy, S.tS), hs = P(trophy, S.hS);
  m.shoulderTilt = (Math.atan2(hs.y - ts.y, Math.abs(hs.x - ts.x) + 1e-6) * 180) / Math.PI;

  // Contact checks (use the ball if we saw it near the wrist, otherwise the wrist + racquet allowance)
  const contactPoint = contact.ball && dist(contact.ball, P(contact, S.hW)) < 0.6 * H ? contact.ball : null;
  m.contactHeight = contactPoint
    ? (groundY - contactPoint.y) / H
    : (groundY - P(contact, S.hW).y) / H + 0.25; // wrist is roughly 0.25 H below the ball at contact
  m.contactSource = contactPoint ? 'ball' : 'wrist estimate';
  m.armExtension = angleAt(P(contact, S.hS), P(contact, S.hE), P(contact, S.hW));
  // Jump: highest the lower foot gets off the ground, around contact (±0.15 s of real time)
  const win = 0.15 * timeScale;
  m.jump = Math.max(0, ...frames.filter((f) => Math.abs(f.t - contact.t) <= win)
    .map((f) => (groundY - Math.max(P(f, J.lAnkle).y, P(f, J.rAnkle).y)) / H));

  // Toss: highest ball position above the head before contact
  const headY = (f) => P(f, J.nose).y;
  let peak = null;
  frames.slice(0, contactIdx + 1).forEach((f) => {
    if (f.ball && f.ball.y < headY(f) && (!peak || f.ball.y < peak.y)) peak = { ...f.ball, f };
  });
  // Only trust the peak if the ball is seen rising just before it and falling just after it.
  // Otherwise the real top of the toss was probably out of shot or missed.
  if (peak && !Number.isFinite(manual.tossPeak)) {
    const win = 0.3 * timeScale;
    const seen = frames.filter((f) => f.ball && f.f !== peak.f && Math.abs(f.t - peak.f.t) <= win);
    const before = seen.some((f) => f.t < peak.f.t && f.ball.y > peak.y);
    const after = seen.some((f) => f.t > peak.f.t && f.ball.y > peak.y);
    if (!(before && after)) { peak = null; m.tossNote = 'top of the toss not seen'; }
  }
  if (Number.isFinite(manual.tossPeak)) {
    // Use the ball seen closest in time to the chosen moment (within 3 frames).
    const i = nearestIdx(manual.tossPeak);
    const near = frames.slice(Math.max(0, i - 3), i + 4).filter((f) => f.ball)
      .sort((a, b) => Math.abs(a.t - manual.tossPeak) - Math.abs(b.t - manual.tossPeak))[0];
    peak = near ? { ...near.ball, f: near } : null;
  }
  if (peak) {
    const cY = contactPoint ? contactPoint.y : groundY - m.contactHeight * H;
    m.tossHeight = (cY - peak.y) / H;
    m.tossPlacement = ((peak.x - frontAnkleX(trophy)) * dir) / H;
  }

  // Racquet drop: lowest racquet point near the hitting hand between trophy and contact
  let low = null;
  frames.slice(trophyIdx, contactIdx + 1).forEach((f) => {
    // The drop is over well before contact; anything "below the hand" at contact is a false detection.
    if (contact.t - f.t < 0.05 * timeScale) return;
    if (!f.racket || dist(f.racket, P(f, S.hW)) > 0.6 * H) return;
    const below = (f.racket.y - P(f, S.hS).y) / H; // how far below the shoulder, in this frame
    if (below > 0 && f.racket.y > P(f, S.hW).y && (!low || below > low.below)) low = { below, t: f.t };
  });
  // Only count frames where the racquet is seen below the shoulder and the hand, i.e. really
  // dropped behind the back. It is often too blurred to detect there, so if it is never seen
  // this stays blank rather than guessing from the racquet on its way up.
  if (low) m.racquetDrop = low.below;

  // Leg drive timing: when the hips rise fastest compared with when contact happens
  let peakRise = -Infinity, riseIdx = null;
  for (let i = 1; i <= contactIdx; i++) {
    const dy = mid(P(frames[i - 1], J.lHip), P(frames[i - 1], J.rHip)).y - mid(P(frames[i], J.lHip), P(frames[i], J.rHip)).y;
    const v = dy / (frames[i].t - frames[i - 1].t || 1e-3);
    if (v > peakRise) { peakRise = v; riseIdx = i; }
  }
  if (riseIdx !== null) m.legDriveLead = (contact.t - frames[riseIdx].t) / timeScale;

  // Drive up out of the load (an indication of power). Follows the middle of the hips as a
  // stand-in for the body's centre of mass:
  //   load base   = lowest hip position between the toss and contact
  //   peak        = highest hip position, up to 0.25 s after contact (usually in the air)
  //   driveSpeed  = fastest upward hip speed on the way up (player heights per second, real time)
  //   driveAccel  = average upward acceleration from the start of the push to that fastest moment
  //   driveTime   = real time from the start of the push to the peak
  //   driveRise   = how far the hips rise from the load base to the peak
  const hipUp = frames.map((f) => (groundY - mid(P(f, J.lHip), P(f, J.rHip)).y) / H);
  const half = 0.03 * timeScale; // extra smoothing: ±30 ms of real time, as speeds amplify jitter
  const hipS = frames.map((f, i) => {
    let sum = 0, k = 0;
    for (let j = i; j >= 0 && f.t - frames[j].t <= half; j--) { sum += hipUp[j]; k++; }
    for (let j = i + 1; j < n && frames[j].t - f.t <= half; j++) { sum += hipUp[j]; k++; }
    return sum / k;
  });
  let baseIdx = tossUpIdx;
  for (let i = tossUpIdx; i <= contactIdx; i++) if (hipS[i] < hipS[baseIdx]) baseIdx = i;
  let peakIdx = baseIdx;
  for (let i = baseIdx; i < n && frames[i].t - contact.t <= 0.25 * timeScale; i++) if (hipS[i] > hipS[peakIdx]) peakIdx = i;
  let pushIdx = baseIdx;
  if (peakIdx > baseIdx + 1) {
    const vel = (i) => (hipS[i + 1] - hipS[i - 1]) / ((frames[i + 1].t - frames[i - 1].t) / timeScale);
    let vMax = -Infinity, vIdx = baseIdx;
    for (let i = Math.max(1, baseIdx); i <= Math.min(peakIdx, n - 2); i++) if (vel(i) > vMax) { vMax = vel(i); vIdx = i; }
    if (vMax > 0) {
      // The push starts when the hips begin rising in earnest (above 10% of top speed), not at the
      // lowest point, so a player who holds the bottom of the knee bend isn't marked as slow.
      pushIdx = vIdx;
      while (pushIdx > Math.max(1, baseIdx) && vel(pushIdx - 1) > 0.1 * vMax) pushIdx--;
      const tToV = (frames[vIdx].t - frames[pushIdx].t) / timeScale;
      m.driveSpeed = vMax;
      if (tToV > 0) m.driveAccel = vMax / tToV;
      m.driveTime = (frames[peakIdx].t - frames[pushIdx].t) / timeScale;
      m.driveRise = hipS[peakIdx] - hipS[baseIdx];
    }
  }
  const keyExtra = { loadBase: frames[baseIdx].t, pushStart: frames[pushIdx].t, drivePeak: frames[peakIdx].t };

  // Landing: where the front foot first touches down after contact (not where the player
  // runs to afterwards, e.g. a doubles player moving in to the net).
  const after = frames.slice(contactIdx + 1).filter((f) => f.t - contact.t <= 0.6 * timeScale);
  const lowFoot = (f) => Math.max(P(f, J.lAnkle).y, P(f, J.rAnkle).y);
  const wasAir = after.findIndex((f) => groundY - lowFoot(f) > 0.03 * H);
  const touch = wasAir >= 0 ? after.slice(wasAir).find((f) => groundY - lowFoot(f) <= 0.03 * H) : null;
  if (touch) m.landing = (frontAnkleX(touch) * dir - frontAnkleX(trophy) * dir) / H;

  // ---------- Flow: how smooth the whole motion is, from the last ball bounce to landing ----------
  const flow = analyseFlow({ frames, P, S, H, groundY, timeScale, tossUpIdx, trophyIdx, contactIdx, touch, contact });
  Object.assign(m, flow.metrics);

  // Forward/backward distances can only be measured when filmed side-on.
  const view = options.view || 'side';
  if (view !== 'side') for (const [k, def] of Object.entries(METRICS)) if (def.sideOnly) delete m[k];

  return {
    version: 'analysis-0.3',
    hand, stance, detectedStance, dir, view, timeScale,
    // The back foot sliding up only shows clearly side-on, so treat the detected stance as a guess otherwise.
    stanceUnsure: view !== 'side' && (!options.stance || options.stance === 'auto'),
    playerHeightPx: H,
    groundY,
    anchorX: mid(P(trophy, J.lAnkle), P(trophy, J.rAnkle)).x,
    playerHeightCm: options.heightCm || null,
    keyFrames: { trophy: trophy.t, contact: contact.t, tossPeak: peak ? peak.f.t : null },
    driveFrames: keyExtra,
    flow: flow.curve,
    manualKeyFrames: Object.keys(manual).filter((k) => Number.isFinite(manual[k])),
    framesWithPlayer: n,
    framesWithBall: frames.filter((f) => f.ball).length,
    framesWithRacket: frames.filter((f) => f.racket).length,
    metrics: m,
  };
}

// ---------- comparing with professional references ----------
// refs: the contents of data/pros.json
export function compareToPros(result, refs) {
  // Compare with pros of the same stance, filmed from the same angle if we have any.
  const sameStance = refs.pros.filter((p) => p.stance === result.stance);
  const sameView = sameStance.filter((p) => (p.view || 'side') === (result.view || 'side'));
  const group = sameView.length ? sameView : sameStance.length ? sameStance : refs.pros;
  const rows = [];
  let total = 0, weights = 0;
  for (const [key, def] of Object.entries(METRICS)) {
    const value = result.metrics[key];
    // Use the closest group that has this measurement: same stance and angle, then same stance, then anyone.
    const has = (list) => list.filter((p) => Number.isFinite(p.metrics[key]));
    const used = [group, sameStance, refs.pros].map(has).find((l) => l.length) || [];
    const proVals = used.map((p) => p.metrics[key]);
    if (!Number.isFinite(value) || !proVals.length) {
      rows.push({ key, def, value: null, status: 'missing' });
      continue;
    }
    // Never show a range outside what's physically possible (e.g. a negative pause).
    const lo = Math.max(def.scale[0], Math.min(...proVals) - def.tol);
    const hi = Math.min(def.scale[1], Math.max(...proVals) + def.tol);
    const off = value < lo ? lo - value : value > hi ? value - hi : 0;
    // Inside the pro range scores 100. Falls to 0 at three tolerances outside it.
    const score = Math.max(0, Math.round(100 * (1 - off / (3 * def.tol))));
    const status = off === 0 ? 'good' : score >= 50 ? 'close' : 'work';
    const direction = value < lo ? 'low' : value > hi ? 'high' : null;
    rows.push({ key, def, value, lo, hi, score, status, direction, pros: used.map((p) => ({ id: p.id, value: p.metrics[key] })) });
    total += score * def.weight;
    weights += def.weight;
  }
  return {
    scoringVersion: 'score-0.1',
    comparedWith: group.map((p) => p.id),
    overall: weights ? Math.round(total / weights) : null,
    rows,
  };
}

// Turns the comparison plus the ticked problems into coaching notes, most important first.
export function buildFeedback(comparison, ticked = []) {
  const flagged = new Set(ticked.flatMap((k) => (ISSUES[k] ? ISSUES[k].metrics : [])));
  const items = comparison.rows
    .filter((r) => r.status === 'close' || r.status === 'work')
    .map((r) => ({
      key: r.key,
      label: r.def.label,
      text: r.def[r.direction] || '',
      linked: ticked.filter((k) => ISSUES[k] && ISSUES[k].metrics.includes(r.key)).map((k) => ISSUES[k].label),
      priority: (100 - r.score) * r.def.weight * (flagged.has(r.key) ? 2 : 1),
    }))
    .sort((a, b) => b.priority - a.priority);
  return items.slice(0, 3);
}

// ---------- stick-figure comparison with a pro ----------
// Joints kept for drawing: nose, shoulders, elbows, wrists, hips, knees, ankles.
export const MOTION_JOINTS = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];

// A compact copy of the movement (from about 2.5 s before the trophy, to include the ball
// bounce, until just after landing),
// so a serve can be replayed as a stick figure or saved as a pro reference.
export function exportMotion(frames, r) {
  const ts = r.timeScale || 1;
  const r1 = (v) => Math.round(v * 10) / 10;
  const keep = frames.filter((f) => f.pose && f.t >= r.keyFrames.trophy - 2.5 * ts && f.t <= r.keyFrames.contact + 0.8 * ts);
  return {
    hand: r.hand, stance: r.stance, view: r.view || 'side', dir: r.dir, timeScale: ts,
    H: r.playerHeightPx, groundY: r.groundY, anchorX: r.anchorX, keyFrames: r.keyFrames,
    frames: keep.map((f) => ({
      t: Math.round(f.t * 1000) / 1000,
      j: MOTION_JOINTS.map((i) => [r1(f.pose[i].x), r1(f.pose[i].y)]),
      b: f.ball ? [r1(f.ball.x), r1(f.ball.y)] : null,
    })),
  };
}

// Choose the pro to show next to the player. Most important first: same stance, same camera
// angle, similar height, same hitting hand. Returns the pro and the reasons for the choice.
export function pickPro(refs, { stance, view = 'side', hand, heightCm }) {
  const options = refs.pros.filter((p) => p.motion);
  if (!options.length) return null;
  const cost = (p) =>
    (p.stance === stance ? 0 : 100) +
    ((p.view || 'side') === view ? 0 : 50) +
    (p.hand === hand ? 0 : 20) +
    (heightCm && p.heightCm ? Math.abs(p.heightCm - heightCm) / 2 : 5);
  const pro = options.slice().sort((a, b) => cost(a) - cost(b))[0];
  const notes = [];
  notes.push(pro.stance === stance ? `same ${stance} stance` : `no ${stance}-stance pro yet`);
  notes.push((pro.view || 'side') === view ? `same camera angle` : `filmed ${pro.view}-on, you are ${view}-on`);
  if (heightCm && pro.heightCm) notes.push(`${pro.heightCm} cm vs your ${heightCm} cm`);
  notes.push(pro.hand === hand ? `${hand}-handed` : `pro is ${pro.hand}-handed`);
  return { pro, notes };
}

// Lines up two serves by their key moments, so both figures reach the trophy and contact
// together even if one serve is faster. Returns the pro's time for the player's time t.
export function alignTime(t, you, pro) {
  const yk = you.keyFrames, pk = pro.keyFrames;
  const ys = you.timeScale || 1, ps = pro.timeScale || 1;
  if (t <= yk.trophy) return pk.trophy - ((yk.trophy - t) / ys) * ps;
  if (t >= yk.contact) return pk.contact + ((t - yk.contact) / ys) * ps;
  const k = (t - yk.trophy) / (yk.contact - yk.trophy || 1);
  return pk.trophy + k * (pk.contact - pk.trophy);
}

// Turns a motion frame into body-relative coordinates: units of player height, feet at 0,
// centred on where the feet were at the trophy position. courtDir sets which way the court
// is drawn: 1 = to the right, -1 = to the left. Passing a serve's own dir draws it exactly as
// filmed; passing another serve's dir turns it to face the same way as that one.
export function normaliseFrame(motion, frame, courtDir = 1) {
  if (!frame) return null;
  const n = (x, y) => ({ x: ((x - motion.anchorX) * (motion.dir || 1) * courtDir) / motion.H, y: (motion.groundY - y) / motion.H });
  return { joints: frame.j.map(([x, y]) => n(x, y)), ball: frame.b ? n(frame.b[0], frame.b[1]) : null };
}

export function motionFrameAt(motion, t) {
  let best = null;
  for (const f of motion.frames) if (!best || Math.abs(f.t - t) < Math.abs(best.t - t)) best = f;
  return best;
}

// ---------- building a pro reference from several serves ----------
// Averages the measurements the builder kept for each serve. A measurement only counts for a
// serve if it was measured and not switched off.
export function averageServes(serves) {
  const out = {};
  for (const key of Object.keys(METRICS)) {
    const vals = serves.filter((s) => s.keep[key] && Number.isFinite(s.result.metrics[key])).map((s) => s.result.metrics[key]);
    if (vals.length) out[key] = Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 1000) / 1000;
  }
  return out;
}

// Returns the reference list with this pro added, or replaced if the id already exists.
export function upsertPro(refs, entry) {
  const pros = refs.pros.filter((p) => p.id !== entry.id).concat([entry]);
  return { ...refs, pros };
}

// ---------- flow helpers ----------
// Spectral arc length (SPARC, Balasubramanian et al. 2015): a standard smoothness measure for a
// speed profile. Closer to 0 = smoother; more negative = more jerky changes of speed. It copes
// with video jitter better than jerk-based measures.
export function sparc(speed, fs, fMax = 10, ampTh = 0.05) {
  const n = speed.length;
  if (n < 8) return NaN;
  const N = 2 ** (Math.ceil(Math.log2(n)) + 4);
  const df = fs / N;
  const kMax = Math.min(Math.floor(fMax / df), N / 2);
  const mag = [];
  for (let k = 0; k <= kMax; k++) {
    let re = 0, im = 0;
    const w = (-2 * Math.PI * k) / N;
    for (let i = 0; i < n; i++) { re += speed[i] * Math.cos(w * i); im += speed[i] * Math.sin(w * i); }
    mag.push(Math.hypot(re, im));
  }
  const top = Math.max(...mag) || 1;
  const M = mag.map((v) => v / top);
  let last = 0;
  M.forEach((v, k) => { if (v >= ampTh) last = k; });
  if (last < 1) return NaN;
  let arc = 0;
  for (let k = 1; k <= last; k++) arc += Math.hypot(1 / last, M[k] - M[k - 1]);
  return -arc;
}

function analyseFlow({ frames, P, S, H, groundY, timeScale, tossUpIdx, trophyIdx, contactIdx, touch, contact }) {
  const n = frames.length;
  const JOINTS = MOTION_JOINTS;
  const realDt = (a, b) => (frames[b].t - frames[a].t) / timeScale;

  // Whole-body speed: average speed of the main joints, in player heights per second (real time).
  const raw = frames.map((f, i) => {
    if (i === 0) return 0;
    const g = frames[i - 1];
    const dt = realDt(i - 1, i) || 1e-3;
    let sum = 0;
    for (const j of JOINTS) sum += Math.hypot(f.pose[j].x - g.pose[j].x, f.pose[j].y - g.pose[j].y);
    return sum / JOINTS.length / H / dt;
  });
  raw[0] = raw[1] || 0;
  const half = 0.04 * timeScale;
  const speed = frames.map((f, i) => {
    let sum = 0, k = 0;
    for (let j = i; j >= 0 && f.t - frames[j].t <= half; j--) { sum += raw[j]; k++; }
    for (let j = i + 1; j < n && frames[j].t - f.t <= half; j++) { sum += raw[j]; k++; }
    return sum / k;
  });

  // Start: the last ball bounce before the toss (ball at its lowest, near the ground).
  let bounceIdx = null;
  for (let i = 1; i < Math.max(1, tossUpIdx) - 1; i++) {
    const b = frames[i].ball, a = frames[i - 1].ball, c = frames[i + 1].ball;
    if (b && a && c && b.y >= a.y && b.y >= c.y && groundY - b.y < 0.3 * H) bounceIdx = i;
  }
  const startIdx = bounceIdx ?? 0;
  // End: first touchdown after contact, or 0.6 s after contact.
  let endIdx = touch ? frames.indexOf(touch) : -1;
  if (endIdx < 0) { endIdx = contactIdx; while (endIdx < n - 1 && realDt(contactIdx, endIdx + 1) <= 0.6) endIdx++; }

  const seg = speed.slice(startIdx, endIdx + 1);
  const fs = (seg.length - 1) / (realDt(startIdx, endIdx) || 1);
  const metrics = {};
  const smooth = sparc(seg, fs);
  if (Number.isFinite(smooth) && realDt(startIdx, endIdx) > 0.4) metrics.flowSmoothness = smooth;

  // Longest pause once the serve motion has started (ignores standing still after the bounce).
  const peak = Math.max(...speed.slice(startIdx, contactIdx + 1));
  const slow = 0.08 * peak; // "paused" = moving at under 8% of top speed
  let moveIdx = startIdx;
  while (moveIdx < contactIdx && speed[moveIdx] < 0.12 * peak) moveIdx++; // motion has started at 12% of top speed
  let longest = 0, runStart = null, pause = null;
  for (let i = moveIdx; i <= contactIdx; i++) {
    if (speed[i] < slow) {
      if (runStart === null) runStart = i;
      const len = realDt(runStart, i);
      if (len > longest) { longest = len; pause = [frames[runStart].t, frames[i].t]; }
    } else runStart = null;
  }
  if (contactIdx > moveIdx) metrics.flowPause = longest;

  // Kinetic chain: when hips, shoulders, elbow and wrist each reach top speed (trophy to contact).
  const partSpeed = (pick) => frames.map((f, i) => {
    if (i === 0) return 0;
    const a = pick(frames[i - 1]), b = pick(f);
    return Math.hypot(b.x - a.x, b.y - a.y) / (realDt(i - 1, i) || 1e-3);
  });
  // Hitting-side hip and shoulder: on flat video their movement shows the body's rotation better
  // than the middle of the hips or shoulders does.
  const hHip = S.hS === J.rShoulder ? J.rHip : J.lHip;
  const parts = [(f) => P(f, hHip), (f) => P(f, S.hS), (f) => P(f, S.hE), (f) => P(f, S.hW)];
  let endChain = contactIdx;
  while (endChain < n - 1 && realDt(contactIdx, endChain + 1) <= 0.05) endChain++;
  const peaks = parts.map((pick) => {
    const v = partSpeed(pick);
    let best = trophyIdx;
    for (let i = trophyIdx; i <= endChain; i++) if (v[i] > v[best]) best = i;
    return frames[best].t;
  });
  if (contactIdx > trophyIdx + 2) {
    const tolT = 0.5 * (frames[1].t - frames[0].t);
    metrics.chainOrder = [0, 1, 2].filter((k) => peaks[k] <= peaks[k + 1] + tolT).length;
  }

  // A compact speed curve for the dashboard chart (about 80 points).
  const every = Math.max(1, Math.ceil((endIdx - startIdx + 1) / 80));
  const curve = {
    t: [], v: [],
    marks: {
      bounce: bounceIdx !== null ? frames[bounceIdx].t : null,
      start: frames[moveIdx].t, trophy: frames[trophyIdx].t, contact: contact.t,
      landing: touch ? touch.t : null,
    },
    pause: longest >= 0.05 ? pause : null,
    chainPeaks: { hips: peaks[0], shoulders: peaks[1], elbow: peaks[2], wrist: peaks[3] },
    timeScale,
  };
  for (let i = startIdx; i <= endIdx; i += every) { curve.t.push(Math.round(frames[i].t * 1000) / 1000); curve.v.push(Math.round(speed[i] * 1000) / 1000); }
  return { metrics, curve };
}
