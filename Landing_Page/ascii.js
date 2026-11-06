// Hero art: a stepped shield built from rectangular blocks of ASCII characters. Glyph weight follows a density field
// (":" lightest -> "$" heaviest), and each block slowly grows and shrinks row by row, so the silhouette idles and
// loops without ever stopping. Canvas text only: no dependencies, no network.
(() => {
  const canvas = document.querySelector(".hero-ascii");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const RAMP = [":", "*", "L", "V", "I", "$"];
  // Blue family, light to dark, matching the heavier glyphs.
  const COLORS = ["rgba(39,117,202,0.38)", "rgba(39,117,202,0.55)", "rgba(39,117,202,0.72)", "rgba(33,100,185,0.86)", "rgba(28,84,162,0.95)", "rgb(20,62,128)"];

  // The silhouette on a coarse grid: per row, the first and last block column that is filled.
  const SHAPE = [[0, 6], [0, 6], [0, 6], [0, 6], [1, 5], [1, 5], [2, 4], [3, 3]];
  const GX = 7, GY = SHAPE.length, BW = 10, BH = 4; // blocks across/down, characters per block
  const COLS = GX * (BW + 1) - 1, ROWS = GY * (BH + 1) - 1; // one empty character between blocks, like the reference

  const hash = (a, b, c) => {
    let x = Math.imul(a + 1, 374761393) ^ Math.imul(b + 1, 668265263) ^ Math.imul(c + 1, 2147483647);
    x = Math.imul(x ^ (x >>> 13), 1274126177);
    return ((x ^ (x >>> 16)) >>> 0) / 4294967295;
  };
  const smooth = (x) => x * x * (3 - 2 * x);

  let w = 0, h = 0, dpr = 1, cw = 8, ch = 11, fs = 13;
  function resize() {
    const r = canvas.parentElement.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = r.width; h = r.height;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Fit the whole figure inside the canvas with some air around it.
    cw = Math.max(4.2, Math.min((w * 0.9) / COLS, (h * 0.78) / (ROWS * 1.5), 7.4));
    fs = cw / 0.6; ch = fs * 0.92;
    ctx.font = `500 ${fs.toFixed(1)}px "JetBrains Mono", ui-monospace, monospace`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
  }

  // Which blocks exist, plus a per-block personality so they don't move in lockstep.
  const blocks = [];
  SHAPE.forEach(([a, b], by) => { for (let bx = a; bx <= b; bx++) blocks.push({ bx, by, key: by * GX + bx }); });

  function frame(t) {
    ctx.clearRect(0, 0, w, h);
    const x0 = (w - COLS * cw) / 2;
    const y0 = (h - ROWS * ch) / 2;
    const tick = Math.floor(t * 2.5);

    for (const { bx, by, key } of blocks) {
      const ph = hash(key, 1, 7) * 6.283;
      const sp = 0.3 + hash(key, 2, 7) * 0.35;
      const edge = by === 0 || bx === SHAPE[by][0] || bx === SHAPE[by][1];
      const minF = edge ? 0.3 : 0.65;               // outer blocks breathe more than the core
      const f = minF + (1 - minF) * smooth(0.5 + 0.5 * Math.sin(t * sp + ph));
      const rowsShown = Math.max(1, Math.round(f * BH));
      const fromTop = hash(key, 3, 7) > 0.5;

      for (let j = 0; j < BH; j++) {
        // Rows are revealed from the top or the bottom of the block, depending on the block.
        if (fromTop ? j >= rowsShown : j < BH - rowsShown) continue;
        const r = by * (BH + 1) + j;
        for (let i = 0; i < BW; i++) {
          const c = bx * (BW + 1) + i;
          // Density: heavier toward the lower right, with a wave drifting across and a little per-character noise.
          let v = 0.12 + 0.52 * (c / COLS) + 0.3 * (r / ROWS);
          v += 0.16 * Math.sin(c * 0.09 - r * 0.07 - t * 0.8);
          v += (hash(c, r, tick) - 0.5) * 0.2;
          const lvl = Math.max(0, Math.min(RAMP.length - 1, Math.floor(v * RAMP.length)));
          ctx.fillStyle = COLORS[lvl];
          ctx.fillText(RAMP[lvl], x0 + (c + 0.5) * cw, y0 + (r + 0.5) * ch);
        }
      }
    }
  }

  let raf = 0, last = 0, running = false;
  const t0 = performance.now();
  function loop(now) {
    raf = requestAnimationFrame(loop);
    if (now - last < 1000 / 24) return;
    last = now;
    frame((now - t0) / 1000);
  }
  const start = () => { if (!running && !reduce) { running = true; raf = requestAnimationFrame(loop); } };
  const stop = () => { running = false; cancelAnimationFrame(raf); };

  const init = () => {
    resize();
    frame(reduce ? 3 : 0);
    new ResizeObserver(() => { resize(); if (!running) frame(reduce ? 3 : (performance.now() - t0) / 1000); }).observe(canvas.parentElement);
    new IntersectionObserver(([e]) => (e.isIntersecting && !document.hidden ? start() : stop())).observe(canvas);
    document.addEventListener("visibilitychange", () => (document.hidden ? stop() : start()));
    start();
  };
  (document.fonts?.load('500 14px "JetBrains Mono"') ?? Promise.resolve()).then(init, init);
})();
