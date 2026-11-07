import { formatEther, formatUnits, isAddress, parseUnits } from "viem";
import { DAY, DECIMALS } from "./chain";

const nf = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
export const fmtAmount = (v: bigint | undefined) => (v === undefined ? "–" : nf.format(Number(formatUnits(v, DECIMALS))));

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
export const shortAddr = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");
export const looksLikeAddress = (s: string) => isAddress(s, { strict: false });

export function fmtDuration(seconds: number): string {
  if (seconds >= DAY) { const d = Math.round(seconds / DAY); return `${d} day${d === 1 ? "" : "s"}`; }
  if (seconds >= 3600) { const h = Math.round(seconds / 3600); return `${h} hour${h === 1 ? "" : "s"}`; }
  const m = Math.max(1, Math.round(seconds / 60));
  return `${m} minute${m === 1 ? "" : "s"}`;
}
export function fmtCountdown(seconds: number): string {
  if (seconds <= 0) return "now";
  const d = Math.floor(seconds / DAY), h = Math.floor((seconds % DAY) / 3600), m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${Math.floor(seconds % 60)}s`;
}
export const fmtDate = (ts: number | bigint) =>
  new Date(Number(ts) * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/** 1500000000000000n -> "0.0015". Shows tiny amounts instead of rounding them to 0. */
export function fmtEth(v: bigint | undefined): string {
  if (v === undefined) return "–";
  if (v === 0n) return "0";
  const n = Number(formatEther(v));
  return n < 0.00001 ? "<0.00001" : n.toLocaleString(undefined, { maximumSignificantDigits: 4 });
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
/** 12000000000n (6 decimals) -> "$12,000.00". pUSDC and USDC are both pegged 1:1 to a dollar. */
export const fmtUsd = (v: bigint) => usd.format(Number(formatUnits(v, DECIMALS)));
