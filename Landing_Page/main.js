// Protected USDC landing page. No dependencies, no trackers.

/**
 * Where "Launch app" buttons go. The app lives in /frontend (Vite); point this at wherever it is hosted
 * (an ENS/IPFS gateway, Vercel, …). Until then it falls back to the local dev server.
 */
const APP_URL = "http://localhost:5173";

document.documentElement.classList.add("js");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const fmt = new Intl.NumberFormat("en-US");

// App links
for (const a of document.querySelectorAll("[data-app-link]")) {
  a.href = APP_URL;
  a.target = "_blank";
  a.rel = "noopener";
}

// Nav background once the page scrolls
const nav = document.querySelector(".nav");
const onScroll = () => nav.classList.toggle("scrolled", window.scrollY > 24);
onScroll();
window.addEventListener("scroll", onScroll, { passive: true });

// Blue panel: its text eases in once the panel is mostly on screen
const introEl = document.querySelector(".intro");
if (introEl) new IntersectionObserver(([e]) => e.isIntersecting && introEl.classList.add("in"), { threshold: 0.3 }).observe(introEl);

// Reveal on scroll, with a small stagger for siblings
const revealIO = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.classList.add("in");
      revealIO.unobserve(e.target);
    }
  },
  { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
);
for (const el of document.querySelectorAll(".reveal")) {
  const siblings = [...el.parentElement.children].filter((c) => c.classList.contains("reveal"));
  el.style.setProperty("--d", `${Math.min(siblings.indexOf(el), 4) * 0.08}s`);
  revealIO.observe(el);
}

// The hero background is the ASCII canvas in ascii.js (it pauses itself when off screen).

// Film: silent preview loop when visible; the button restarts it with sound and controls
const film = document.querySelector(".film");
const filmVideo = film.querySelector("video");
const playBtn = film.querySelector(".play-btn");
let filmStarted = false;
if (!reduceMotion) {
  new IntersectionObserver(
    ([e]) => {
      if (filmStarted) {
        if (!e.isIntersecting) filmVideo.pause();
        return;
      }
      e.isIntersecting ? filmVideo.play().catch(() => {}) : filmVideo.pause();
    },
    { threshold: 0.35 },
  ).observe(film);
}
playBtn.addEventListener("click", () => {
  filmStarted = true;
  filmVideo.currentTime = 0;
  filmVideo.muted = false;
  filmVideo.loop = false;
  filmVideo.controls = true;
  film.classList.add("playing");
  filmVideo.play().catch(() => {});
});
filmVideo.addEventListener("ended", () => {
  film.classList.remove("playing");
  filmVideo.controls = false;
  filmVideo.muted = true;
  filmVideo.loop = true;
  filmStarted = false;
  playBtn.querySelector(".play-label").textContent = "play again";
});

// Card films: play while on screen, poster only for reduced motion
for (const v of document.querySelectorAll(".card-video")) {
  if (reduceMotion) continue;
  new IntersectionObserver(
    ([e]) => {
      if (e.isIntersecting) v.play().catch(() => {});
      else v.pause();
    },
    { threshold: 0.4 },
  ).observe(v);
}

// Simulator: mirrors the app's rule. At or under the daily limit → instant; above it → scheduled for the hold window.
const limit = document.getElementById("limit");
const amount = document.getElementById("amount");
const limitOut = document.getElementById("limit-out");
const amountOut = document.getElementById("amount-out");
const verdict = document.getElementById("verdict");
const vTag = document.getElementById("verdict-tag");
const vTitle = document.getElementById("verdict-title");
const vSub = document.getElementById("verdict-sub");
const dateFmt = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" });

function fill(input) {
  const p = ((input.value - input.min) / (input.max - input.min)) * 100;
  input.style.setProperty("--p", `${p}%`);
}
function simulate() {
  const lim = Number(limit.value);
  const amt = Number(amount.value);
  const hold = Number(document.querySelector('input[name="hold"]:checked').value);
  limitOut.textContent = fmt.format(lim);
  amountOut.textContent = fmt.format(amt);
  fill(limit);
  fill(amount);

  const over = amt > lim;
  amount.classList.toggle("over", over);
  verdict.classList.toggle("wait", over);
  if (over) {
    const lands = new Date(Date.now() + hold * 86_400_000);
    vTag.textContent = "Scheduled";
    vTitle.textContent = `Lands ${dateFmt.format(lands)}`;
    vSub.textContent = `It's over your ${fmt.format(lim)} daily limit, so it waits ${hold} day${hold > 1 ? "s" : ""}. If it wasn't you, your backup wallet cancels it and the money never leaves.`;
  } else {
    vTag.textContent = "Instant";
    vTitle.textContent = "Goes through right away";
    vSub.textContent = "It's within your daily limit, so it works exactly like USDC.";
  }
}
document.getElementById("sim").addEventListener("input", simulate);
simulate();

// Copy contract addresses
for (const btn of document.querySelectorAll("[data-copy]")) {
  btn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(btn.dataset.copy);
      btn.textContent = "Copied";
    } catch {
      btn.textContent = "Press ⌘C";
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(btn.parentElement.querySelector(".addr-val"));
      sel.removeAllRanges();
      sel.addRange(range);
    }
    btn.classList.add("done");
    setTimeout(() => {
      btn.textContent = "Copy";
      btn.classList.remove("done");
    }, 1600);
  });
}
