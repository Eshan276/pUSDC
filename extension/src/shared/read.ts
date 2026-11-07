import type { Address } from "viem";
import { pusdcAbi, usdcAbi } from "@abi";
import { PUSDC, USDC, publicClient } from "./chain";
import { DEFAULT_BOUNDS, type Bounds } from "./presets";

const P = () => ({ address: PUSDC, abi: pusdcAbi }) as const;

/** Seconds the chain's clock is ahead of this computer's. Countdowns add it so they match what the contract will enforce. */
let clockOffset = 0;
export const chainNow = () => Math.floor(Date.now() / 1000) + clockOffset;

export type PendingTransfer = { id: bigint; from: Address; to: Address; amount: bigint; executableAt: number };
export type PendingChange = { value: bigint; effectiveAt: number };

/** Everything the wallet needs to know about one account's protection, in one multicall round trip. */
export async function readProtection(a: Address) {
  const r = await publicClient.multicall({
    allowFailure: false,
    contracts: [
      { ...P(), functionName: "balanceOf", args: [a] },
      { ...P(), functionName: "availableBalanceOf", args: [a] },
      { ...P(), functionName: "reservedOf", args: [a] },
      { ...P(), functionName: "lockOf", args: [a] },
      { ...P(), functionName: "protectionOf", args: [a] },
      { ...P(), functionName: "dailyLimitRemaining", args: [a] },
      { ...P(), functionName: "pendingParamChange", args: [a, 0] },
      { ...P(), functionName: "pendingParamChange", args: [a, 1] },
      { ...P(), functionName: "pendingParamChange", args: [a, 2] },
      { ...P(), functionName: "pendingParamChange", args: [a, 3] },
      { ...P(), functionName: "pendingBackupChange", args: [a] },
      { ...P(), functionName: "pendingTransferIds", args: [a] },
      { address: USDC, abi: usdcAbi, functionName: "balanceOf", args: [a] },
      { address: USDC, abi: usdcAbi, functionName: "allowance", args: [a, PUSDC] },
    ],
  });
  const [balance, available, reserved, lock, prot, remaining, c0, c1, c2, c3, bkp, ids, usdcBalance, usdcAllowance] = r;
  const [eth, block] = await Promise.all([publicClient.getBalance({ address: a }), publicClient.getBlock()]);
  clockOffset = Number(block.timestamp) - Math.floor(Date.now() / 1000);
  const details = ids.length
    ? await publicClient.multicall({
        allowFailure: false,
        contracts: ids.map((id) => ({ ...P(), functionName: "getQueuedTransfer", args: [id] }) as const),
      })
    : [];
  const pending: PendingTransfer[] = details
    .map((d, i) => {
      const q = (d as unknown as readonly [{ from: Address; to: Address; amount: bigint; executableAt: bigint }, boolean])[0];
      return { id: ids[i], from: q.from, to: q.to, amount: q.amount, executableAt: Number(q.executableAt) };
    })
    .sort((x, y) => x.executableAt - y.executableAt);
  const toChange = (c: readonly [bigint, bigint]): PendingChange | undefined =>
    c[1] > 0n ? { value: c[0], effectiveAt: Number(c[1]) } : undefined;
  return {
    address: a,
    balance, available, reserved,
    locked: lock[0], lockedUntil: Number(lock[1]),
    protected: prot.active, backup: prot.backup,
    dailyLimit: prot.dailyLimit, holdWindow: Number(prot.holdWindow), offDelay: Number(prot.offDelay),
    lockDuration: Number(prot.lockDuration), flagOffAt: Number(prot.flagOffAt),
    dailyRemaining: remaining,
    pendingChanges: [toChange(c0), toChange(c1), toChange(c2), toChange(c3)],
    pendingBackup: bkp[1] > 0n ? { backup: bkp[0], effectiveAt: Number(bkp[1]) } : undefined,
    pending, usdcBalance, usdcAllowance, eth,
  };
}
export type Protection = Awaited<ReturnType<typeof readProtection>>;

/** A stable fingerprint of "things a guardian should be told about", for change detection. */
export function alertKeys(x: Protection): string[] {
  const k: string[] = [];
  for (const t of x.pending) k.push(`transfer:${t.id}`);
  x.pendingChanges.forEach((c, i) => c && k.push(`param${i}:${c.value}:${c.effectiveAt}`));
  if (x.pendingBackup) k.push(`backup:${x.pendingBackup.backup}:${x.pendingBackup.effectiveAt}`);
  if (x.flagOffAt > 0) k.push(`flagoff:${x.flagOffAt}`);
  return k;
}

let boundsCache: Promise<Bounds> | undefined;
export const resetBounds = () => { boundsCache = undefined; };

/**
 * Reads this deployment's allowed time ranges. Minimums are fixed per deployment (days on a production token,
 * minutes on a demo one); maximums are constants. Falls back to the production rules if the reads fail.
 */
export function readBounds(): Promise<Bounds> {
  boundsCache ??= publicClient
    .multicall({
      allowFailure: true,
      contracts: [
        { ...P(), functionName: "MIN_HOLD_WINDOW" }, { ...P(), functionName: "MAX_HOLD_WINDOW" },
        { ...P(), functionName: "MIN_OFF_DELAY" }, { ...P(), functionName: "MAX_OFF_DELAY" },
        { ...P(), functionName: "MIN_LOCK_DURATION" }, { ...P(), functionName: "MAX_LOCK_DURATION" },
        { ...P(), functionName: "LIMIT_PERIOD" },
      ],
    })
    .then((r) => {
      if (r.some((x) => x.status !== "success")) return DEFAULT_BOUNDS;
      const n = (i: number) => Number(r[i].result as bigint);
      return { hold: [n(0), n(1)], off: [n(2), n(3)], lock: [n(4), n(5)], limitPeriod: n(6) } as Bounds;
    })
    .catch(() => { boundsCache = undefined; return DEFAULT_BOUNDS; });
  return boundsCache;
}
