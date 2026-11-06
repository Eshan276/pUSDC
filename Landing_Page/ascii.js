// Hero artwork: ten separate rectangular clusters of repeated characters (: * L V I S), laid out as the pinwheel measured
// from the reference at 1144x648. Real text in <pre> elements, so it stays pixel-sharp at any size. Motion is deliberately
// quiet: each cluster breathes in opacity on its own timing, a few drift a pixel or two, and now and then a character
// steps to a neighbouring weight. No falling code, no resizing.
(() => {
  const root = document.querySelector(".ascii");
  if (!root) return;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const RAMP = [":", "*", "L", "V", "I", "S"];
  const level = (d) => Math.max(0, Math.min(RAMP.length - 1, Math.floor(d * RAMP.length)));

  // x, y: offset in reference px from the artwork's top-left; c, r: characters across and down;
  // d: weight at the left and right edges (0 = lightest glyph, 1 = heaviest).
  const CLUSTERS = [
    { x: 0, y: 95, c: 10, r: 5, d: [0.0, 0.1] },
    { x: 142, y: 42, c: 10, r: 5, d: [0.18, 0.46] },
    { x: 194, y: 92, c: 10, r: 5, d: [0.4, 0.66] },
    { x: 89, y: 135, c: 10, r: 5, d: [0.2, 0.5] },
    { x: 301, y: 0, c: 10, r: 5, d: [0.58, 0.74] },
    { x: 301, y: 93, c: 10, r: 5, d: [0.66, 0.84] },
    { x: 407, y: 40, c: 10, r: 10, d: [0.74, 1.0] },
    { x: 355, y: 145, c: 10, r: 5, d: [0.78, 0.9] },
    { x: 301, y: 198, c: 10, r: 5, d: [0.78, 0.84] },
    { x: 407, y: 198, c: 10, r: 5, d: [0.92, 1.0] },
  ];

  // Small deterministic noise so the clusters look hand-set, not generated, and are identical on every load.
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

  const clusters = CLUSTERS.map((cl, i) => {
    const grid = Array.from({ length: cl.r }, (_, row) =>
      Array.from({ length: cl.c }, (_, col) => {
        const t = col / (cl.c - 1);
        const base = cl.d[0] + (cl.d[1] - cl.d[0]) * t + (row / cl.r - 0.5) * 0.06;
        return level(base + (rnd() - 0.5) * 0.16);
      }),
    );
    const pre = document.createElement("pre");
    pre.className = "cl";
    pre.style.setProperty("--x", cl.x);
    pre.style.setProperty("--y", cl.y);
    pre.style.setProperty("--i", i);
    pre.style.setProperty("--t", `${5 + ((i * 1.7) % 4)}s`); // each breathes on its own clock
    // Light clusters are paler, heavy ones darker, as in the reference.
    pre.style.setProperty("--a", (0.42 + ((cl.d[0] + cl.d[1]) / 2) * 0.58).toFixed(2));
    if (i % 3 === 1) pre.classList.add("drift");
    const render = () => (pre.textContent = grid.map((row) => row.map((v) => RAMP[v]).join("")).join("\n"));
    render();
    root.appendChild(pre);
    return { grid, render, cl };
  });

  if (reduce) return;

  // Every so often, one character in one cluster steps a weight up or down, then settles back.
  setInterval(() => {
    if (document.hidden) return;
    const k = clusters[(rnd() * clusters.length) | 0];
    const row = (rnd() * k.cl.r) | 0, col = (rnd() * k.cl.c) | 0;
    const was = k.grid[row][col];
    const next = Math.max(0, Math.min(RAMP.length - 1, was + (rnd() < 0.5 ? -1 : 1)));
    if (next === was) return;
    k.grid[row][col] = next; k.render();
    setTimeout(() => { k.grid[row][col] = was; k.render(); }, 700 + rnd() * 900);
  }, 420);
})();
