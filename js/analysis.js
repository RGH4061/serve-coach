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
  kneeFlex:      { phase: 'load', scale: [0, 100], label: 'Knee bend (deepest)', unit: '°', tol: 8, weight: 1.2,
                   low: 'Bend your knees more as you toss — think "sit into the serve" so your legs can drive you up.',
                   high: 'You are bending very deeply; a little less bend can make the leg drive quicker and more controlled.' },
  trophyElbow:   { phase: 'trophy', scale: [40, 180], label: 'Hitting elbow angle at trophy', unit: '°', tol: 15, weight: 0.8,
                   low: 'Your hitting elbow is very bent at the trophy position; open it a little so the racquet sits up behind your head.',
                   high: 'Your hitting arm is quite straight at the trophy position; bend the elbow to about a right angle to load the racquet.' },
  shoulderTilt:  { phase: 'trophy', scale: [-10, 50], label: 'Shoulder tilt at trophy', unit: '°', tol: 7, weight: 1.0,
                   low: 'Tilt your shoulders more at the trophy position — tossing shoulder up, hitting shoulder down — to help you hit up to the ball.',
                   high: 'Your shoulders are tilting a lot; this can pull the toss behind you. Aim for a slightly flatter tilt.' },
  tossHeight:    { phase: 'toss', scale: [-0.2, 0.7], label: 'Toss peak above contact', unit: 'H', tol: 0.1, weight: 1.0,
                   low: 'Your toss is low, so you are rushing. Toss a little higher so the ball peaks just above where you hit it.',
                   high: 'Your toss is going quite high, so the ball is falling fast at contact. Toss a bit lower for better timing.' },
  tossPlacement: { phase: 'toss', scale: [-0.3, 0.8], label: 'Toss in front of front foot', unit: 'H', tol: 0.12, weight: 1.3,
                   low: 'Your toss is not far enough in front. Toss slightly more into the court so your body moves forward into the ball.',
                   high: 'Your toss is far in front of you, which often sends the ball into the net. Bring the toss back slightly.' },
  racquetDrop:   { phase: 'contact', scale: [-0.2, 0.4], label: 'Racquet drop below shoulder', unit: 'H', tol: 0.08, weight: 0.8,
                   low: 'The racquet is not dropping far down your back. Relax your arm so the racquet falls lower before swinging up.',
                   high: 'Your racquet drop is very deep; that is not usually a problem, but check it is not slowing your swing.' },
  contactHeight: { phase: 'contact', scale: [1.0, 1.8], label: 'Contact height', unit: 'H', tol: 0.08, weight: 1.3,
                   low: 'You are hitting the ball low. Reach up fully and hit at the top of your reach — low contact is a common reason serves go into the net.',
                   high: 'Your contact point is very high — great reach. Make sure you are not waiting for the ball to drop.' },
  armExtension:  { phase: 'contact', scale: [120, 180], label: 'Hitting arm straightness at contact', unit: '°', tol: 10, weight: 1.0,
                   low: 'Your arm is bent at contact. Hit up with a straight arm at full stretch.',
                   high: 'Good full extension at contact.' },
  jump:          { phase: 'finish', scale: [0, 0.3], label: 'Feet off ground at contact', unit: 'H', tol: 0.05, weight: 0.7,
                   low: 'You are staying on the ground. Let your leg drive lift you up into the ball.',
                   high: 'Big jump — make sure you stay balanced and land well.' },
  legDriveLead:  { phase: 'finish', scale: [0, 0.5], label: 'Leg drive before contact', unit: 's', tol: 0.08, weight: 1.0,
                   low: 'Your legs and arm are firing almost together. Push up with your legs first, then let the arm follow.',
                   high: 'Your leg drive is happening a long time before contact, so the energy is lost. Link the push up and swing more tightly.' },
  landing:       { phase: 'finish', scale: [0, 1.2], label: 'Landing distance into court', unit: 'H', tol: 0.15, weight: 0.6,
                   low: 'You are landing close to where you started. Let your body move forward into the court after contact.',
                   high: 'You are travelling a long way forward after the serve — good if you serve and volley, otherwise check your balance.' },
};

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
  const H = median(early.map((f) => (mid(P(f, J.lAnkle), P(f, J.rAnkle)).y - P(f, J.nose).y) * 1.12));
  const groundY = median(early.map((f) => Math.max(P(f, J.lAnkle).y, P(f, J.rAnkle).y)));

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
  let contactIdx = 0;
  frames.forEach((f, i) => { if (P(f, S.hW).y < P(frames[contactIdx], S.hW).y) contactIdx = i; });
  let best = Infinity;
  for (let i = Math.max(0, contactIdx - 3); i <= Math.min(n - 1, contactIdx + 3); i++) {
    const b = frames[i].ball;
    if (!b) continue;
    const d = dist(b, P(frames[i], S.hW));
    if (d < best && d < 0.6 * H) { best = d; contactIdx = i; }
  }
  const contact = frames[contactIdx];

  // 4. Trophy position = when the tossing arm is highest, before contact.
  let trophyIdx = 0;
  for (let i = 0; i < contactIdx; i++) if (P(frames[i], S.tW).y < P(frames[trophyIdx], S.tW).y) trophyIdx = i;
  const trophy = frames[trophyIdx];

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
  m.jump = Math.max(0, (groundY - Math.max(P(contact, J.lAnkle).y, P(contact, J.rAnkle).y)) / H);

  // Toss: highest ball position above the head before contact
  const headY = (f) => P(f, J.nose).y;
  let peak = null;
  frames.slice(0, contactIdx + 1).forEach((f) => {
    if (f.ball && f.ball.y < headY(f) && (!peak || f.ball.y < peak.y)) peak = { ...f.ball, f };
  });
  if (peak) {
    const cY = contactPoint ? contactPoint.y : groundY - m.contactHeight * H;
    m.tossHeight = (cY - peak.y) / H;
    m.tossPlacement = ((peak.x - frontAnkleX(trophy)) * dir) / H;
  }

  // Racquet drop: lowest racquet point near the hitting hand between trophy and contact
  let low = null;
  frames.slice(trophyIdx, contactIdx + 1).forEach((f) => {
    if (f.racket && dist(f.racket, P(f, S.hW)) < 0.6 * H && (!low || f.racket.y > low.y)) low = f.racket;
  });
  if (low) {
    const shY = P(frames[trophyIdx], S.hS).y;
    m.racquetDrop = (low.y - shY) / H;
  }

  // Leg drive timing: when the hips rise fastest compared with when contact happens
  let peakRise = -Infinity, riseIdx = null;
  for (let i = 1; i <= contactIdx; i++) {
    const dy = mid(P(frames[i - 1], J.lHip), P(frames[i - 1], J.rHip)).y - mid(P(frames[i], J.lHip), P(frames[i], J.rHip)).y;
    const v = dy / (frames[i].t - frames[i - 1].t || 1e-3);
    if (v > peakRise) { peakRise = v; riseIdx = i; }
  }
  if (riseIdx !== null) m.legDriveLead = (contact.t - frames[riseIdx].t) / timeScale;

  // Landing: how far forward the front foot ends up (needs ~0.5 s of video after contact)
  if (n - 1 - contactIdx >= 5) {
    const after = frames.slice(contactIdx);
    const furthest = Math.max(...after.map((f) => frontAnkleX(f) * dir));
    m.landing = (furthest - frontAnkleX(frames[0]) * dir) / H;
  }

  return {
    version: 'analysis-0.1',
    hand, stance, detectedStance, dir,
    playerHeightPx: H,
    keyFrames: { trophy: trophy.t, contact: contact.t, tossPeak: peak ? peak.f.t : null },
    framesWithPlayer: n,
    framesWithBall: frames.filter((f) => f.ball).length,
    framesWithRacket: frames.filter((f) => f.racket).length,
    metrics: m,
  };
}

// ---------- comparing with professional references ----------
// refs: the contents of data/pros.json
export function compareToPros(result, refs) {
  const pros = refs.pros.filter((p) => p.stance === result.stance);
  const group = pros.length ? pros : refs.pros;
  const rows = [];
  let total = 0, weights = 0;
  for (const [key, def] of Object.entries(METRICS)) {
    const value = result.metrics[key];
    const proVals = group.map((p) => p.metrics[key]).filter(Number.isFinite);
    if (!Number.isFinite(value) || !proVals.length) {
      rows.push({ key, def, value: null, status: 'missing' });
      continue;
    }
    const lo = Math.min(...proVals) - def.tol;
    const hi = Math.max(...proVals) + def.tol;
    const off = value < lo ? lo - value : value > hi ? value - hi : 0;
    // Inside the pro range scores 100. Falls to 0 at three tolerances outside it.
    const score = Math.max(0, Math.round(100 * (1 - off / (3 * def.tol))));
    const status = off === 0 ? 'good' : score >= 50 ? 'close' : 'work';
    const direction = value < lo ? 'low' : value > hi ? 'high' : null;
    rows.push({ key, def, value, lo, hi, score, status, direction });
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
