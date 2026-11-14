// backdrop.js
// The deepest background layer: a photograph of a clay court at night (img/clay-court.jpg),
// blended into a blurred copy that fills the screen, with dust drifting slowly through its
// beam of light. The scene is drawn once (and on resize); only the dust moves. Movement stops if the user
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

  // The photograph: a clay court at night with a beam of light and dust.
  const photo = new Image();
  photo.src = window.__BACKDROP_IMG || 'img/clay-court.jpg';
  photo.decoding = 'async';

  function paintScene() {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    g.fillStyle = '#0c0a08';
    g.fillRect(0, 0, W, H);
    const iw0 = photo.naturalWidth, ih0 = photo.naturalHeight;

    // Centre the photo in the area to the right of the sidebar (or the whole screen on phones).
    const cssW = W / dpr;
    const cx = (cssW > 820 ? 320 + (cssW - 320) / 2 : cssW / 2) * dpr;
    const ih = H * 1.04, iw = (iw0 / ih0) * ih;
    const ix = cx - iw / 2, iy = H - ih;

    if (iw0) {
      // 1. A blurred, darker copy stretched across the whole screen, so the clay and the light
      //    carry on beyond the edges of the photo.
      const scale = Math.max(W / iw0, H / ih0);
      g.save();
      g.filter = `blur(${Math.round(60 * dpr)}px) brightness(0.55) saturate(1.1)`;
      g.drawImage(photo, (W - iw0 * scale) / 2, H - ih0 * scale, iw0 * scale, ih0 * scale);
      g.restore();

      // 2. The sharp photo, with its left and right edges faded into the blurred copy.
      const s = document.createElement('canvas');
      s.width = Math.ceil(iw); s.height = Math.ceil(ih);
      const sg = s.getContext('2d');
      sg.drawImage(photo, 0, 0, iw, ih);
      sg.globalCompositeOperation = 'destination-in';
      const fade = sg.createLinearGradient(0, 0, iw, 0);
      fade.addColorStop(0, 'rgba(0,0,0,0)');
      fade.addColorStop(0.22, 'rgba(0,0,0,1)');
      fade.addColorStop(0.78, 'rgba(0,0,0,1)');
      fade.addColorStop(1, 'rgba(0,0,0,0)');
      sg.fillStyle = fade;
      sg.fillRect(0, 0, iw, ih);
      g.drawImage(s, ix, iy);
    }

    // The light beam in the photo, extended across the screen, for placing the moving dust.
    const at = (fx, fy) => ({ x: ix + fx * iw, y: iy + fy * ih });
    beam = { top: [at(0, 0.44), at(1, 0.62)], far: [at(0, 0.78), at(1, 0.76)] };

    // Soft vignette, and a slight darkening so the panels' text stays easy to read.
    const vig = g.createRadialGradient(cx, H * 0.6, Math.min(W, H) * 0.2, cx, H * 0.55, Math.max(W, H) * 0.85);
    vig.addColorStop(0, 'rgba(0, 0, 0, 0.05)');
    vig.addColorStop(1, 'rgba(0, 0, 0, 0.6)');
    g.fillStyle = vig;
    g.fillRect(0, 0, W, H);

    // Fine grain, so the upscaled photo and gradients don't look smeared or banded.
    const grain = g.createImageData(W, H);
    for (let i = 0; i < grain.data.length; i += 4) {
      const v = rand() * 255;
      grain.data[i] = grain.data[i + 1] = grain.data[i + 2] = v;
      grain.data[i + 3] = 8;
    }
    const gc = document.createElement('canvas');
    gc.width = W; gc.height = H;
    gc.getContext('2d').putImageData(grain, 0, 0);
    g.drawImage(gc, 0, 0);
    return c;
  }

  // Dust: mostly inside the beam, a few specks elsewhere
  function inBeam(x, y) {
    const lineY = ([p, q]) => p.y + ((q.y - p.y) * (x - p.x)) / ((q.x - p.x) || 1);
    return y > lineY(beam.top) && y < lineY(beam.far);
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
  // Redraw with the photo once it has loaded.
  if (!photo.complete) photo.addEventListener('load', resize, { once: true });
})();
