import { useEffect, useRef } from "react";

// Ten separate clusters of repeated characters (: * L V I S) in a pinwheel, measured from the landing page's artwork.
// Real text in <pre> blocks. Motion is deliberately quiet: each cluster breathes in opacity, a few drift a pixel or two,
// and now and then one character steps to a neighbouring weight. Static under reduced motion.
const RAMP = [":", "*", "L", "V", "I", "S"];
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
const level = (d: number) => Math.max(0, Math.min(RAMP.length - 1, Math.floor(d * RAMP.length)));

export function AsciiArt() {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let seed = 7; // deterministic, so it looks the same on every load
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

    const clusters = CLUSTERS.map((cl, i) => {
      const grid = Array.from({ length: cl.r }, (_, row) =>
        Array.from({ length: cl.c }, (_, col) => level(cl.d[0] + (cl.d[1] - cl.d[0]) * (col / (cl.c - 1)) + (row / cl.r - 0.5) * 0.06 + (rnd() - 0.5) * 0.16)),
      );
      const pre = document.createElement("pre");
      pre.className = "cl" + (i % 3 === 1 ? " drift" : "");
      pre.style.setProperty("--x", String(cl.x));
      pre.style.setProperty("--y", String(cl.y));
      pre.style.setProperty("--i", String(i));
      pre.style.setProperty("--t", `${5 + ((i * 1.7) % 4)}s`);
      pre.style.setProperty("--a", (0.42 + ((cl.d[0] + cl.d[1]) / 2) * 0.58).toFixed(2));
      const render = () => (pre.textContent = grid.map((row) => row.map((v) => RAMP[v]).join("")).join("\n"));
      render();
      el.appendChild(pre);
      return { grid, render, cl, pre };
    });

    if (reduce) return () => clusters.forEach((k) => k.pre.remove());
    const timers: number[] = [];
    const tick = window.setInterval(() => {
      if (document.hidden) return;
      const k = clusters[(rnd() * clusters.length) | 0];
      const row = (rnd() * k.cl.r) | 0, col = (rnd() * k.cl.c) | 0;
      const was = k.grid[row][col];
      const next = Math.max(0, Math.min(RAMP.length - 1, was + (rnd() < 0.5 ? -1 : 1)));
      if (next === was) return;
      k.grid[row][col] = next; k.render();
      timers.push(window.setTimeout(() => { k.grid[row][col] = was; k.render(); }, 700 + rnd() * 900));
    }, 420);
    return () => { clearInterval(tick); timers.forEach(clearTimeout); clusters.forEach((k) => k.pre.remove()); };
  }, []);
  return <div ref={root} className="ascii" aria-hidden />;
}
