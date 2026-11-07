import { parseAbiItem, type Address, type Hex } from "viem";
import { PUSDC, USDC, publicClient } from "./chain";

const transfer = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const ZERO = "0x0000000000000000000000000000000000000000";

export type LocalAction = { hash: Hex; title: string; at: number };
export type ActivityItem = {
  hash: Hex;
  /** Seconds since epoch (block time, or when you did it). */
  time: number;
  dir: "in" | "out" | "other";
  token?: "pUSDC" | "USDC";
  amount?: bigint;
  /** The other side of the transfer. */
  other?: Address;
  /** What you did, when this wallet recorded it. */
  title?: string;
};

const WINDOW = 9_000n; // most recent blocks to scan (about 5 hours on Base)
// Public RPCs cap getLogs ranges: Base Sepolia's accepts about 200 blocks, so that is the unit of work.
const CHUNK = 200n;
const PARALLEL = 12;

type Logs = Awaited<ReturnType<typeof publicClient.getLogs<typeof transfer>>>;

/** getLogs over [from, to] for both tokens. If the RPC refuses the range (too wide, or it straddles a node boundary), split it and retry each half. */
async function logsIn(args: { from: Address } | { to: Address }, from: bigint, to: bigint): Promise<Logs> {
  try {
    return await publicClient.getLogs({ address: [PUSDC, USDC], event: transfer, args, fromBlock: from, toBlock: to });
  } catch {
    if (from >= to) return [];
    const mid = from + (to - from) / 2n;
    const [a, b] = await Promise.all([logsIn(args, from, mid), logsIn(args, mid + 1n, to)]);
    return [...a, ...b];
  }
}

/** Runs async tasks with at most `n` in flight, so a long scan can't flood the RPC. */
async function pooled<T>(tasks: (() => Promise<T>)[], n: number): Promise<T[]> {
  const out: T[] = new Array(tasks.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, tasks.length) }, async () => { while (i < tasks.length) { const k = i++; out[k] = await tasks[k](); } }));
  return out;
}

type Raw = ActivityItem & { block: bigint };
type Scan = { upTo: bigint; raw: Raw[]; times: Map<bigint, number> };
const scans = new Map<string, Scan>();
const inflight = new Map<string, Promise<ActivityItem[]>>();

/**
 * Transfer logs to and from `me` for pUSDC and USDC over the last ~9,000 blocks. The first call scans the window; later calls
 * only fetch blocks mined since. Ranges the RPC refuses are split; whatever still fails is skipped, never thrown.
 */
export function readOnchainActivity(me: Address): Promise<ActivityItem[]> {
  const key = `${me.toLowerCase()}:${PUSDC}:${USDC}`;
  const running = inflight.get(key);
  if (running) return running;
  const job = scan(me, key).finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
}

async function scan(me: Address, key: string): Promise<ActivityItem[]> {
  let latest: bigint;
  try { latest = await publicClient.getBlockNumber(); } catch { return render(scans.get(key)); }
  const prev = scans.get(key);
  const cur: Scan = prev ?? { upTo: (latest > WINDOW ? latest - WINDOW : 0n) - 1n, raw: [], times: new Map() };
  const tasks: (() => Promise<Logs>)[] = [];
  for (let from = cur.upTo + 1n; from <= latest; from += CHUNK) {
    const to = from + CHUNK - 1n > latest ? latest : from + CHUNK - 1n;
    for (const args of [{ from: me }, { to: me }] as const) tasks.push(() => logsIn(args, from, to));
  }
  const seen = new Set(cur.raw.map((r) => `${r.hash}:${r.block}:${r.dir}:${r.amount}:${r.other}`));
  for (const logs of await pooled(tasks, PARALLEL))
    for (const l of logs) {
      if (!l.args.from || !l.args.to) continue;
      const out = l.args.from.toLowerCase() === me.toLowerCase();
      const r: Raw = { hash: l.transactionHash, block: l.blockNumber, time: 0, dir: out ? "out" : "in", token: l.address.toLowerCase() === PUSDC.toLowerCase() ? "pUSDC" : "USDC", amount: l.args.value, other: out ? l.args.to : l.args.from };
      const k = `${r.hash}:${r.block}:${r.dir}:${r.amount}:${r.other}`;
      if (!seen.has(k)) { seen.add(k); cur.raw.push(r); }
    }
  // Block times for the newest few dozen we don't have yet.
  const missing = [...new Set(cur.raw.map((r) => r.block))].filter((b) => !cur.times.has(b)).sort((a, b) => (a < b ? 1 : -1)).slice(0, 40);
  await Promise.all(missing.map((b) => publicClient.getBlock({ blockNumber: b }).then((x) => cur.times.set(b, Number(x.timestamp))).catch(() => {})));
  cur.upTo = latest;
  scans.set(key, cur);
  return render(cur);
}

function render(c?: Scan): ActivityItem[] {
  if (!c) return [];
  return c.raw.map(({ block, ...r }) => ({ ...r, time: c.times.get(block) ?? 0 })).sort((a, b) => b.time - a.time);
}

/** On-chain transfers plus what this wallet recorded (approvals, protection changes and so on), newest first. */
export function mergeActivity(chain: ActivityItem[], local: LocalAction[]): ActivityItem[] {
  const titles = new Map(local.map((l) => [l.hash.toLowerCase(), l.title]));
  const have = new Set(chain.map((c) => c.hash.toLowerCase()));
  const merged: ActivityItem[] = chain.map((c) => ({ ...c, title: titles.get(c.hash.toLowerCase()) }));
  for (const l of local) if (!have.has(l.hash.toLowerCase())) merged.push({ hash: l.hash, time: l.at, dir: "other", title: l.title });
  return merged.sort((a, b) => b.time - a.time);
}

export const isZero = (a?: string) => a?.toLowerCase() === ZERO;
