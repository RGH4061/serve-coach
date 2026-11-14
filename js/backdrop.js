// backdrop.js
// The deepest background layer: a clay court at night with perspective court lines, a beam of
// warm light coming in from the left, and dust drifting slowly through the beam.
// The scene is drawn once (and on resize); only the dust moves. Movement stops if the user
// prefers reduced motion or the tab is hidden.

(() => {
  const canvas = document.createElement('canvas');
  canvas.id = 'backdrop';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.prepend(canvas);
  const ctx = canvas.getContext('2d');
  const still = window.matchMedia('(prefers-reduced-motion: reduce)');
  let scene = null, dust = [], W = 0, H = 0, dpr = 1, beam = null;

  // A fixed pseudo-random sequence, so the dust looks the same on every visit.
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

  function paintScene() {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    const horizon = H * 0.6;

    // Night sky: near-black, slightly warmer towards the floor
    const sky = g.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, '#080706');
    sky.addColorStop(1, '#16100b');
    g.fillStyle = sky;
    g.fillRect(0, 0, W, horizon);

    // Clay floor, darker in the distance
    const floor = g.createLinearGradient(0, horizon, 0, H);
    floor.addColorStop(0, '#2b170c');
    floor.addColorStop(0.45, '#5a2e14');
    floor.addColorStop(1, '#8a4620');
    g.fillStyle = floor;
    g.fillRect(0, horizon, W, H - horizon);

    // Court lines in perspective, converging on a point off to the right
    const vp = { x: W * 1.25, y: horizon - H * 0.02 };
    const line = (x0, w0, alpha) => {
      // A strip from the bottom edge towards the vanishing point, narrowing with distance
      const grad = g.createLinearGradient(x0, H, vp.x, vp.y);
      grad.addColorStop(0, `rgba(244, 235, 224, ${alpha})`);
      grad.addColorStop(0.75, `rgba(244, 235, 224, ${alpha * 0.25})`);
      grad.addColorStop(1, 'rgba(244, 235, 224, 0)');
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(x0 - w0 / 2, H);
      g.lineTo(x0 + w0 / 2, H);
      g.lineTo(vp.x, vp.y + 0.5);
      g.lineTo(vp.x, vp.y - 0.5);
      g.closePath();
      g.fill();
    };
    g.filter = 'blur(0.6px)';
    line(W * 0.02, Math.max(10, W * 0.012), 0.5);  // sideline
    line(W * 0.2, Math.max(8, W * 0.009), 0.35);   // doubles alley line
    // A line across the court (a service line), flatter and fainter
    const yS = horizon + (H - horizon) * 0.18;
    const across = g.createLinearGradient(0, yS, W, yS);
    across.addColorStop(0, 'rgba(244, 235, 224, 0)');
    across.addColorStop(0.35, 'rgba(244, 235, 224, 0.22)');
    across.addColorStop(1, 'rgba(244, 235, 224, 0.05)');
    g.fillStyle = across;
    g.beginPath();
    g.moveTo(0, yS + 4); g.lineTo(W, yS - H * 0.04); g.lineTo(W, yS - H * 0.04 + 2); g.lineTo(0, yS + 7);
    g.closePath(); g.fill();
    g.filter = 'none';

    // Light beam from the left, falling diagonally across the scene onto the clay
    beam = {
      top: [{ x: -W * 0.1, y: H * 0.28 }, { x: -W * 0.1, y: H * 0.5 }],
      far: [{ x: W * 1.05, y: H * 0.55 }, { x: W * 1.05, y: H * 0.86 }],
    };
    g.save();
    g.filter = `blur(${Math.round(Math.min(W, H) * 0.04)}px)`;
    const b = g.createLinearGradient(0, H * 0.35, W, H * 0.7);
    b.addColorStop(0, 'rgba(233, 193, 140, 0.38)');
    b.addColorStop(0.5, 'rgba(233, 193, 140, 0.16)');
    b.addColorStop(1, 'rgba(233, 193, 140, 0.02)');
    g.fillStyle = b;
    g.beginPath();
    g.moveTo(beam.top[0].x, beam.top[0].y);
    g.lineTo(beam.far[0].x, beam.far[0].y);
    g.lineTo(beam.far[1].x, beam.far[1].y);
    g.lineTo(beam.top[1].x, beam.top[1].y);
    g.closePath();
    g.fill();
    // Where the beam lands on the clay
    const pool = g.createRadialGradient(W * 0.3, H * 0.74, 0, W * 0.3, H * 0.74, W * 0.45);
    pool.addColorStop(0, 'rgba(240, 170, 100, 0.22)');
    pool.addColorStop(1, 'rgba(240, 170, 100, 0)');
    g.fillStyle = pool;
    g.fillRect(0, horizon - H * 0.1, W, H);
    g.restore();

    // Edges fall off into darkness
    const vig = g.createRadialGradient(W * 0.45, H * 0.55, Math.min(W, H) * 0.25, W * 0.5, H * 0.5, Math.max(W, H) * 0.8);
    vig.addColorStop(0, 'rgba(0, 0, 0, 0)');
    vig.addColorStop(1, 'rgba(0, 0, 0, 0.6)');
    g.fillStyle = vig;
    g.fillRect(0, 0, W, H);

    // Fine grain, so the gradients don't band
    const grain = g.createImageData(W, H);
    for (let i = 0; i < grain.data.length; i += 4) {
      const v = rand() * 255;
      grain.data[i] = grain.data[i + 1] = grain.data[i + 2] = v;
      grain.data[i + 3] = 7;
    }
    const gc = document.createElement('canvas');
    gc.width = W; gc.height = H;
    gc.getContext('2d').putImageData(grain, 0, 0);
    g.drawImage(gc, 0, 0);
    return c;
  }

  // Dust: mostly inside the beam, a few specks elsewhere
  function inBeam(x, y) {
    const k = x / W;
    const top = (beam.top[0].y + (beam.far[0].y - beam.top[0].y) * k);
    const bottom = (beam.top[1].y + (beam.far[1].y - beam.top[1].y) * k);
    return y > top && y < bottom;
  }
  function makeDust() {
    const n = Math.round((W * H) / (dpr * dpr) / 4500);
    dust = [];
    for (let i = 0; i < n; i++) {
      let x, y, tries = 0;
      do { x = rand() * W; y = rand() * H; tries++; } while (!inBeam(x, y) && rand() > 0.12 && tries < 20);
      dust.push({
        x, y,
        r: (0.4 + rand() * 1.4) * dpr,
        a: 0.12 + rand() * 0.5,
        vx: (0.04 + rand() * 0.12) * dpr,
        vy: (-0.03 + rand() * 0.05) * dpr,
        phase: rand() * Math.PI * 2,
      });
    }
  }

  function draw(t = 0) {
    ctx.drawImage(scene, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    for (const d of dust) {
      const glow = inBeam(d.x, d.y) ? 1 : 0.35;
      const twinkle = 0.75 + 0.25 * Math.sin(t / 1400 + d.phase);
      ctx.fillStyle = `rgba(245, 214, 170, ${d.a * glow * twinkle})`;
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  let last = 0, running = false;
  function tick(t) {
    if (!running) return;
    if (t - last > 33) { // about 30 frames a second is plenty for drifting dust
      for (const d of dust) {
        d.x += d.vx + Math.sin(t / 2000 + d.phase) * 0.05 * dpr;
        d.y += d.vy + Math.cos(t / 2600 + d.phase) * 0.04 * dpr;
        if (d.x > W + 5) d.x = -5;
        if (d.y < -5) d.y = H + 5;
        if (d.y > H + 5) d.y = -5;
      }
      draw(t);
      last = t;
    }
    requestAnimationFrame(tick);
  }
  function setRunning() {
    const want = !still.matches && !document.hidden;
    if (want && !running) { running = true; requestAnimationFrame(tick); }
    if (!want) running = false;
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.round(window.innerWidth * dpr);
    H = Math.round(window.innerHeight * dpr);
    canvas.width = W; canvas.height = H;
    seed = 7;
    scene = paintScene();
    makeDust();
    draw();
  }

  let pending = null;
  window.addEventListener('resize', () => { clearTimeout(pending); pending = setTimeout(resize, 150); });
  document.addEventListener('visibilitychange', setRunning);
  still.addEventListener('change', setRunning);
  resize();
  setRunning();
})();
