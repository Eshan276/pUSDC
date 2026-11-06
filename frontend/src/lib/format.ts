import { formatUnits, isAddress, parseUnits } from "viem";
import { DAY, DECIMALS } from "../config";

const nf = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

/** 1234500000n -> "1,234.5" (user's locale). */
export function fmtAmount(v: bigint | undefined): string {
  if (v === undefined) return "–";
  return nf.format(Number(formatUnits(v, DECIMALS)));
}

/** "1,234.5" / "1234.5" -> 1234500000n; undefined if not a valid positive amount. */
export function parseAmount(s: string): bigint | undefined {
  const clean = s.replace(/[,\s_]/g, "");
  if (!/^\d*\.?\d*$/.test(clean) || clean === "" || clean === ".") return undefined;
  try {
    const v = parseUnits(clean, DECIMALS);
    return v > 0n ? v : undefined;
  } catch {
    return undefined;
  }
}

export function toUnits(n: number): bigint {
  return parseUnits(String(n), DECIMALS);
}

export const shortAddr = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");

/** 259200 -> "3 days", 3600 -> "1 hour". */
export function fmtDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s >= DAY) {
    const d = s / DAY;
    const r = Number.isInteger(d) ? d : Math.round(d * 10) / 10;
    return `${r} day${r === 1 ? "" : "s"}`;
  }
  if (s >= 3600) {
    const h = Math.round(s / 3600);
    return `${h} hour${h === 1 ? "" : "s"}`;
  }
  const m = Math.max(1, Math.round(s / 60));
  return `${m} minute${m === 1 ? "" : "s"}`;
}

/** Countdown like "2d 4h", "3h 12m", "45s". */
export function fmtCountdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / DAY);
  const h = Math.floor((s % DAY) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

const df = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
export const fmtDate = (unixSeconds: number | bigint) => df.format(new Date(Number(unixSeconds) * 1000));

/** Explains what's wrong with a typed address, or undefined if it's fine. */
export function addressProblem(v: string, empty = "Enter a wallet address."): string | undefined {
  if (!v) return empty;
  if (!isAddress(v, { strict: false })) return "That doesn't look like a wallet address (0x… with 40 characters).";
  // Mixed-case addresses carry a checksum; a mismatch usually means a typo.
  if (!isAddress(v)) return "This address has a capital-letter mistake. Copy it again from your wallet, or paste it in all lowercase.";
}
