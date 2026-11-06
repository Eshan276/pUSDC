import type { Address } from "viem";
import { pusdcAbi, usdcAbi } from "@abi";
import { PUSDC, USDC, publicClient } from "./chain";
import { DEFAULT_BOUNDS, type Bounds } from "./presets";

const p = { address: PUSDC, abi: pusdcAbi } as const;

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
      { ...p, functionName: "balanceOf", args: [a] },
      { ...p, functionName: "availableBalanceOf", args: [a] },
      { ...p, functionName: "reservedOf", args: [a] },
      { ...p, functionName: "lockOf", args: [a] },
      { ...p, functionName: "protectionOf", args: [a] },
      { ...p, functionName: "dailyLimitRemaining", args: [a] },
      { ...p, functionName: "pendingParamChange", args: [a, 0] },
      { ...p, functionName: "pendingParamChange", args: [a, 1] },
      { ...p, functionName: "pendingParamChange", args: [a, 2] },
      { ...p, functionName: "pendingParamChange", args: [a, 3] },
      { ...p, functionName: "pendingBackupChange", args: [a] },
      { ...p, functionName: "pendingTransferIds", args: [a] },
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
        contracts: ids.map((id) => ({ ...p, functionName: "getQueuedTransfer", args: [id] }) as const),
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
/** Reads the allowed time ranges from the contract. Older deployments lack these views, so fall back to the real-token rules. */
export function readBounds(): Promise<Bounds> {
  boundsCache ??= publicClient
    .multicall({
      allowFailure: true,
      contracts: [
        { ...p, functionName: "paramBounds", args: [1] },
        { ...p, functionName: "paramBounds", args: [2] },
        { ...p, functionName: "paramBounds", args: [3] },
        { ...p, functionName: "limitPeriod" },
      ],
    })
    .then(([h, o, l, per]) => {
      if ([h, o, l, per].some((x) => x.status !== "success")) return DEFAULT_BOUNDS;
      const r = (x: unknown) => [Number((x as readonly [bigint, bigint])[0]), Number((x as readonly [bigint, bigint])[1])] as [number, number];
      return { hold: r(h.result), off: r(o.result), lock: r(l.result), limitPeriod: Number(per.result) };
    })
    .catch(() => { boundsCache = undefined; return DEFAULT_BOUNDS; });
  return boundsCache;
}
