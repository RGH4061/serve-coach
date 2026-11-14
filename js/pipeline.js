// pipeline.js
// Steps through a video and runs the detectors on each frame. Shared by the main page and
// the reference builder, so users and pros are always measured in exactly the same way.

function seekVideo(video, t) {
  return new Promise((resolve) => {
    const done = () => { video.removeEventListener('seeked', done); resolve(); };
    video.addEventListener('seeked', done);
    video.currentTime = t;
  });
}

// det: the detectors module. work: a canvas sized to the analysis resolution.
// Returns one entry per analysed frame: { t, pose, ball, racket }.
export async function processVideo({ video, work, det, start = 0, end = video.duration, rate = 60, onFrame, onProgress }) {
  const ctx = work.getContext('2d', { willReadFrequently: true });
  const step = 1 / rate;
  const total = Math.max(1, Math.floor((end - start) / step));
  const out = [];
  let lastBall = null;
  video.pause();
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
  }
  return out;
}
