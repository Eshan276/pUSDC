// Hero background: an idle-looping field of ASCII characters. A protection shield slowly turns like a coin, lit by a
// moving sheen, with a pulse ringing out from its centre, over faint "matrix" rain. No dependencies, no network.
(() => {
  const canvas = document.querySelector(".hero-ascii");
  if (!canvas) return;
  const ctx = canvas.getContext("2d", { alpha: false });
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const RAMP = " .:-=+*#%@";
  const GLYPHS = "01<>/\\{}[]|+=:;";
  const CW = 11, CH = 19; // cell size in CSS px
  const LEVELS = 28;
  // Palette: deep navy -> USDC blue -> pale blue-white. Pre-built so a frame is just lookups.
  const lerp = (a, b, t) => a + (b - a) * t;
  const palette = Array.from({ length: LEVELS }, (_, i) => {
    const t = i / (LEVELS - 1);
    const lo = [28, 52, 92], mid = [39, 117, 202], hi = [190, 218, 255];
    const [a, b, u] = t < 0.6 ? [lo, mid, t / 0.6] : [mid, hi, (t - 0.6) / 0.4];
    return `rgb(${lerp(a[0], b[0], u) | 0},${lerp(a[1], b[1], u) | 0},${lerp(a[2], b[2], u) | 0})`;
  });

  let w = 0, h = 0, cols = 0, rows = 0, dpr = 1, rain = [];
  function resize() {
    const r = canvas.parentElement.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = r.width; h = r.height;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cols = Math.ceil(w / CW); rows = Math.ceil(h / CH);
    ctx.font = `500 ${Math.round(CH * 0.74)}px "JetBrains Mono", ui-monospace, monospace`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    rain = Array.from({ length: cols }, () => ({ speed: 2.5 + Math.random() * 5, off: Math.random() * 100, len: 6 + Math.random() * 16 }));
  }

  // Shield outline: half-width at height v (v runs top -1 to bottom +1). Flat shoulders, curving to a point.
  const HALF = 0.78;
  const profile = (v) => {
    if (v < -0.95 || v > 1) return -1;
    if (v <= 0.15) return HALF;
    const t = (v - 0.15) / 0.85;
    return HALF * Math.pow(1 - Math.pow(t, 1.6), 0.6);
  };
  const hash = (a, b, c) => {
    let x = Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ Math.imul(c, 2147483647);
    x = Math.imul(x ^ (x >>> 13), 1274126177);
    return ((x ^ (x >>> 16)) >>> 0) / 4294967295;
  };

  function frame(t) {
    ctx.fillStyle = "#070b13";
    ctx.fillRect(0, 0, w, h);

    const S = Math.min(w * 0.3, h * 0.44);          // shield scale
    const cx = w / 2, cy = h * 0.5;
    const yaw = 0.62 * Math.sin(t * 0.55);            // gentle sway, like a sign in the wind (never edge-on)
    const squash = Math.cos(yaw);
    const tick = Math.floor(t * 7);

    for (let r = 0; r < rows; r++) {
      const y = r * CH + CH / 2;
      const v = (y - cy) / S;
      for (let c = 0; c < cols; c++) {
        const x = c * CW + CW / 2;
        const u = (x - cx) / S;
        let I = 0, glyph = null;

        // Matrix rain: faint streaks falling down each column.
        const col = rain[c];
        const head = (t * col.speed + col.off) % (rows + col.len + 8);
        const d = head - r;
        if (d >= 0 && d < col.len) {
          I = (1 - d / col.len) * (d < 1 ? 0.45 : 0.24);
          glyph = GLYPHS[(hash(c, r, tick) * GLYPHS.length) | 0];
        } else if (hash(c, r, tick >> 1) > 0.985) {
          I = 0.16; glyph = GLYPHS[(hash(r, c, tick) * GLYPHS.length) | 0];
        }

        // Shield (rotating): test in un-squashed space.
        const sx = u / squash;
        const p = profile(v);
        if (p > 0 && Math.abs(sx) <= p) {
          const edge = (p - Math.abs(sx)) * squash;             // distance to the outline, on screen
          const ax = sx / 0.6, av = (v - 0.04) / 0.6;            // inner shield, scaled down
          const pi = profile(av);
          const innerEdge = pi > 0 && Math.abs(ax) <= pi ? (pi - Math.abs(ax)) * 0.6 * squash : -1;
          const sheen = 0.5 + 0.5 * Math.sin(sx * 3.2 + t * 1.5 - v * 2.2 - yaw * 4);
          const face = 0.7 + 0.3 * squash;                      // dimmer when turned edge-on
          let s = 0.24 + 0.24 * sheen;                              // body fill
          if (innerEdge >= 0) s += 0.1;
          if (edge < 0.07 * squash + 0.012) s = 1;               // outer outline
          else if (innerEdge >= 0 && innerEdge < 0.05 * squash + 0.01) s = 0.9; // inner outline
          // pulse ringing out from the centre
          const dist = Math.hypot(sx * squash, v - 0.1);
          const ring = (t * 0.45) % 1.3;
          s += 0.45 * Math.exp(-Math.pow((dist - ring) / 0.07, 2));
          s = Math.min(1, s * face);
          if (s > I) { I = s; glyph = RAMP[Math.min(RAMP.length - 1, (s * RAMP.length) | 0)]; }
        }

        if (I < 0.07 || !glyph || glyph === " ") continue;
        ctx.fillStyle = palette[Math.min(LEVELS - 1, (I * LEVELS) | 0)];
        ctx.fillText(glyph, x, y);
      }
    }
  }

  let raf = 0, last = 0, running = false, t0 = performance.now();
  function loop(now) {
    raf = requestAnimationFrame(loop);
    if (now - last < 1000 / 30) return;                           // 30 fps is plenty for text
    last = now;
    frame((now - t0) / 1000);
  }
  const start = () => { if (!running && !reduce) { running = true; raf = requestAnimationFrame(loop); } };
  const stop = () => { running = false; cancelAnimationFrame(raf); };

  const init = () => {
    resize();
    frame(reduce ? 1.1 : 0);
    new ResizeObserver(() => { resize(); if (!running) frame(reduce ? 1.1 : (performance.now() - t0) / 1000); }).observe(canvas.parentElement);
    new IntersectionObserver(([e]) => (e.isIntersecting && !document.hidden ? start() : stop())).observe(canvas);
    document.addEventListener("visibilitychange", () => (document.hidden ? stop() : start()));
    start();
  };
  // Wait for the self-hosted mono font so the first frame uses it.
  (document.fonts?.load('500 14px "JetBrains Mono"') ?? Promise.resolve()).then(init, init);
})();
