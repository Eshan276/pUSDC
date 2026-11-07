import { useReadContracts } from "wagmi";
import type { Address } from "viem";
import { pusdcAbi, usdcAbi } from "../abi";
import { PUSDC, USDC } from "../config";

const p = { address: PUSDC, abi: pusdcAbi } as const;

export type PendingTransfer = { id: bigint; from: Address; to: Address; amount: bigint; executableAt: number };
export type PendingChange = { value: bigint; effectiveAt: number };

/** Everything the app needs to know about one account's protection, refreshed every few seconds. */
export function useProtection(account?: Address, refetchInterval = 5000) {
  const enabled = !!account;
  const a = account!;
  const reads = useReadContracts({
    allowFailure: false,
    query: { enabled, refetchInterval },
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

  const ids = (reads.data?.[11] ?? []) as readonly bigint[];
  const details = useReadContracts({
    allowFailure: false,
    query: { enabled: ids.length > 0, refetchInterval },
    contracts: ids.map((id) => ({ ...p, functionName: "getQueuedTransfer", args: [id] }) as const),
  });

  if (!reads.data) return { loading: reads.isLoading, error: reads.error, refetch: reads.refetch, data: undefined };

  const [bal, available, reserved, lock, prot, remaining, c0, c1, c2, c3, bkp, , usdcBal, usdcAllowance] = reads.data;
  const toChange = (c: readonly [bigint, bigint]): PendingChange | undefined =>
    c[1] > 0n ? { value: c[0], effectiveAt: Number(c[1]) } : undefined;

  const pending: PendingTransfer[] = (details.data ?? [])
    .map((d, i) => {
      const [q] = d as unknown as readonly [{ from: Address; to: Address; amount: bigint; executableAt: bigint }, boolean];
      return { id: ids[i], from: q.from, to: q.to, amount: q.amount, executableAt: Number(q.executableAt) };
    })
    .sort((x, y) => x.executableAt - y.executableAt);

  return {
    loading: false,
    error: null,
    refetch: reads.refetch,
    data: {
      balance: bal,
      available,
      reserved,
      locked: lock[0],
      lockedUntil: Number(lock[1]),
      protected: prot.active,
      backup: prot.backup,
      dailyLimit: prot.dailyLimit,
      holdWindow: Number(prot.holdWindow),
      offDelay: Number(prot.offDelay),
      lockDuration: Number(prot.lockDuration),
      flagOffAt: Number(prot.flagOffAt),
      fastLane: prot.fastLane,
      fastLaneAt: Number(prot.fastLaneAt),
      dailyRemaining: remaining,
      pendingChanges: { 0: toChange(c0), 1: toChange(c1), 2: toChange(c2), 3: toChange(c3) } as Record<number, PendingChange | undefined>,
      pendingBackup: bkp[1] > 0n ? { backup: bkp[0], effectiveAt: Number(bkp[1]) } : undefined,
      pending,
      pendingLoading: ids.length > 0 && !details.data,
      usdcBalance: usdcBal,
      usdcAllowance,
    },
  };
}

export type ProtectionData = NonNullable<ReturnType<typeof useProtection>["data"]>;

/** True if `value` makes protection stronger (applies instantly on-chain). Mirrors the contract's _isIncrease. */
export function isStricter(param: number, value: bigint, current: bigint) {
  return param === 0 ? value <= current : value >= current;
}


/* Backups this browser has set for an account. Used to spot a hijacked setup (someone else holding the same key
   front-ran protect() with their own backup). Stored locally only. */
const backupsKey = (a: Address) => `protected-usdc:backups:${a.toLowerCase()}`;
export function rememberBackup(account: Address, backup: Address) {
  const list = knownBackups(account);
  if (!list.includes(backup.toLowerCase())) list.push(backup.toLowerCase());
  localStorage.setItem(backupsKey(account), JSON.stringify(list));
}
export function knownBackups(account: Address): string[] {
  try {
    return JSON.parse(localStorage.getItem(backupsKey(account)) ?? "[]");
  } catch {
    return [];
  }
}
