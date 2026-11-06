import { DAY } from "./chain";

export const Param = { DailyLimit: 0, HoldWindow: 1, OffDelay: 2, LockDuration: 3 } as const;

/** Allowed ranges in seconds, read from the contract (the demo variant allows minutes; the real token days). */
export type Bounds = { hold: [number, number]; off: [number, number]; lock: [number, number]; limitPeriod: number };
export const DEFAULT_BOUNDS: Bounds = { hold: [DAY, 30 * DAY], off: [7 * DAY, 365 * DAY], lock: [DAY, 365 * DAY], limitPeriod: DAY };

/** Minutes when the contract allows sub-day delays, days otherwise. */
export type Unit = { name: "minutes" | "days"; secs: number; label: string };
export const unitFor = (b: Bounds): Unit => (b.hold[0] < DAY ? { name: "minutes", secs: 60, label: "minutes" } : { name: "days", secs: DAY, label: "days" });
export const isFast = (b: Bounds) => b.hold[0] < DAY;

export type Settings = { limit: string; hold: string; off: string; lock: string };
/** Preset times are written in days; `presetIn` converts them to the active unit. */
export const PRESETS: { id: string; title: string; body: string; s: Settings; fastOnly?: boolean; hideInFast?: boolean }[] = [
  { id: "fast", title: "Fast demo", body: "For trying things out. Up to 100 is instant; more waits 2 minutes.", s: { limit: "100", hold: "2", off: "2", lock: "2" }, fastOnly: true },
  { id: "everyday", title: "Everyday", body: "For money you spend. Up to 1,000 a day is instant; more waits 3 days.", s: { limit: "1000", hold: "3", off: "7", lock: "7" }, hideInFast: true },
  { id: "savings", title: "Savings", body: "For money you rarely touch. 100 a day is instant; more waits a week.", s: { limit: "100", hold: "7", off: "30", lock: "30" }, hideInFast: true },
  { id: "custom", title: "Custom", body: "Choose every number yourself.", s: { limit: "500", hold: "1", off: "7", lock: "1" } },
];
export const presetsFor = (b: Bounds) => PRESETS.filter((p) => (isFast(b) ? !p.hideInFast : !p.fastOnly));
/** The custom preset's starting numbers in the active unit (its days values are meaningless in minutes). */
export const customStart = (b: Bounds): Settings => (isFast(b) ? { limit: "100", hold: "2", off: "2", lock: "2" } : PRESETS[3].s);

export const toSeconds = (v: string, u: Unit) => BigInt(Math.round(Number(v) * u.secs));
export function durError(v: string, range: [number, number], u: Unit) {
  const n = Number(v) * u.secs;
  const lo = range[0] / u.secs, hi = range[1] / u.secs;
  if (!/^\d+$/.test(v) || n < range[0] || n > range[1]) return `Choose a whole number of ${u.label} from ${lo} to ${hi}.`;
}
