import { DAY } from "./chain";

/** Protocol bounds, mirrored from ProtectedERC20 (days). */
export const BOUNDS = { hold: { min: 1, max: 30 }, offDelay: { min: 7, max: 365 }, lock: { min: 1, max: 365 } } as const;
export const Param = { DailyLimit: 0, HoldWindow: 1, OffDelay: 2, LockDuration: 3 } as const;

export type Settings = { limit: string; hold: string; off: string; lock: string };
export const PRESETS: { id: string; title: string; body: string; s: Settings }[] = [
  { id: "everyday", title: "Everyday", body: "For money you spend. Up to 1,000 a day is instant; more waits 3 days.", s: { limit: "1000", hold: "3", off: "7", lock: "7" } },
  { id: "savings", title: "Savings", body: "For money you rarely touch. 100 a day is instant; more waits a week.", s: { limit: "100", hold: "7", off: "30", lock: "30" } },
  { id: "custom", title: "Custom", body: "Choose every number yourself.", s: { limit: "500", hold: "1", off: "7", lock: "1" } },
];
export const toSeconds = (days: string) => BigInt(Number(days) * DAY);
export function daysError(v: string, b: { min: number; max: number }) {
  const n = Number(v);
  if (!/^\d+$/.test(v) || n < b.min || n > b.max) return `Choose a whole number of days from ${b.min} to ${b.max}.`;
}
