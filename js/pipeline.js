// pipeline.js
// Steps through a video and runs the detectors on each frame. Shared by the main page and
// the reference builder, so users and pros are always measured in exactly the same way.

// Phones (especially Safari on iPhone) are less reliable than desktop browsers here, so:
//  - every seek has a time limit, so one missed "seeked" event can't freeze the analysis
//  - after seeking we wait for the new frame to actually be painted before reading it
function seekVideo(video, t) {
  return new Promise((resolve) => {
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      video.removeEventListener('seeked', done);
      clearTimeout(timer);
      if (video.requestVideoFrameCallback) {
        let painted = false;
        video.requestVideoFrameCallback(() => { if (!painted) { painted = true; resolve(); } });
        setTimeout(() => { if (!painted) { painted = true; resolve(); } }, 120);
      } else {
        setTimeout(resolve, 30);
      }
    };
    const timer = setTimeout(done, 3000);
    video.addEventListener('seeked', done);
    video.currentTime = t;
  });
}

// Small screens and touch devices get a lighter workload.
export const isPhone = () => window.matchMedia('(max-width: 820px), (pointer: coarse)').matches;
export const workSize = () => (isPhone() ? 960 : 1280);

// Loads a chosen file into the video element. iPhone Safari won't load anything until told to,
// and some formats never load, so give a clear message instead of waiting forever.
export function loadVideoFile(video, file, { onReady, onError }) {
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  let ok = false;
  const timer = setTimeout(() => { if (!ok) onError('The video didn\'t open. On iPhone, try choosing it again, or set Settings › Camera › Formats to "Most Compatible".'); }, 8000);
  video.onloadedmetadata = () => { ok = true; clearTimeout(timer); onReady(); };
  video.onerror = () => { ok = true; clearTimeout(timer); onError('This browser can\'t play that video format. On iPhone use "Most Compatible" in Settings › Camera › Formats, or try Safari.'); };
  video.src = URL.createObjectURL(file);
  video.load();
}

// Keeps the phone screen awake while analysing (if the browser allows it).
async function keepAwake() {
  try { return await navigator.wakeLock.request('screen'); } catch { return null; }
}

// det: the detectors module. work: a canvas sized to the analysis resolution.
// Returns one entry per analysed frame: { t, pose, ball, racket }.
export async function processVideo({ video, work, det, start = 0, end = video.duration, rate = 60, onFrame, onProgress }) {
  const ctx = work.getContext('2d', { willReadFrequently: true });
  const step = 1 / rate;
  const total = Math.max(1, Math.floor((end - start) / step));
  const out = [];
  let lastBall = null;
  // iPhone Safari sometimes gives blank frames until the video has played once.
  try { await video.play(); } catch { /* not allowed; carry on */ }
  video.pause();
  const lock = await keepAwake();
  for (let i = 0; i < total; i++) {
    const t = start + i * step;
    await seekVideo(video, t);
    ctx.drawImage(video, 0, 0, work.width, work.height);
    const pose = det.detectPose(work, Math.round(t * 1000) + 1);
    const { balls, rackets } = await det.detectObjects(work);
    const ball = det.chooseBall(balls, lastBall, work.height * 0.25);
    if (ball) lastBall = ball;
    out.push({ t, pose, ball, racket: rackets[0] || null });
    if (onFrame) onFrame(out[out.length - 1]);
    if (onProgress) onProgress(i + 1, total);
    if (document.hidden) throw new Error('Analysis stopped because the page went into the background. Keep this tab open and the screen on, then try again.');
  }
  if (lock) lock.release().catch(() => {});
  return out;
}
