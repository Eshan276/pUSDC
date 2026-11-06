import { useReadContracts } from "wagmi";
import { pusdcAbi } from "../abi";
import { DAY, PUSDC } from "../config";
import { fmtDuration } from "./format";

export type Unit = "minutes" | "hours" | "days";
export const UNIT_SECONDS: Record<Unit, number> = { minutes: 60, hours: 3600, days: DAY };
/** A duration as typed by the user: a whole number plus a unit. */
export type Dur = { n: string; unit: Unit };

export const toSeconds = (d: Dur) => Number(d.n) * UNIT_SECONDS[d.unit];

/** Picks the largest unit that represents `seconds` exactly. */
export function fromSeconds(seconds: number): Dur {
  if (seconds % DAY === 0) return { n: String(seconds / DAY), unit: "days" };
  if (seconds % 3600 === 0) return { n: String(seconds / 3600), unit: "hours" };
  return { n: String(Math.max(1, Math.round(seconds / 60))), unit: "minutes" };
}

export type Bound = { min: number; max: number };
export function durationError(d: Dur, b: Bound): string | undefined {
  if (!/^\d+$/.test(d.n) || Number(d.n) <= 0) return "Enter a whole number.";
  const s = toSeconds(d);
  if (s < b.min || s > b.max) return `Choose between ${fmtDuration(b.min)} and ${fmtDuration(b.max)}.`;
}

const p = { address: PUSDC, abi: pusdcAbi } as const;
const FALLBACK = { hold: { min: DAY, max: 30 * DAY }, offDelay: { min: 7 * DAY, max: 365 * DAY }, lock: { min: DAY, max: 365 * DAY } };

/**
 * This deployment's allowed range for each duration, read from the contract (minimums are set per deployment:
 * days in production, minutes on a demo deployment).
 */
export function useBounds() {
  const { data } = useReadContracts({
    allowFailure: false,
    query: { staleTime: Infinity },
    contracts: [
      { ...p, functionName: "MIN_HOLD_WINDOW" },
      { ...p, functionName: "MAX_HOLD_WINDOW" },
      { ...p, functionName: "MIN_OFF_DELAY" },
      { ...p, functionName: "MAX_OFF_DELAY" },
      { ...p, functionName: "MIN_LOCK_DURATION" },
      { ...p, functionName: "MAX_LOCK_DURATION" },
    ],
  });
  const b = data
    ? {
        hold: { min: Number(data[0]), max: Number(data[1]) },
        offDelay: { min: Number(data[2]), max: Number(data[3]) },
        lock: { min: Number(data[4]), max: Number(data[5]) },
      }
    : FALLBACK;
  /** A demo deployment allows sub-day durations, so the whole flow can be shown live. */
  return { ...b, isDemo: b.hold.min < DAY, loaded: !!data };
}
