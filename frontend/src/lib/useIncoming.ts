import { useReadContract, useReadContracts } from "wagmi";
import type { Address } from "viem";
import { pusdcAbi } from "../abi";
import { PUSDC } from "../config";
import type { PendingTransfer } from "./useProtection";

const p = { address: PUSDC, abi: pusdcAbi } as const;
/** How many of the most recent scheduled transfers to scan. */
const WINDOW = 300;

type Q = { from: Address; to: Address; amount: bigint; executableAt: bigint };

/**
 * Pending scheduled transfers addressed TO `account` (or a single shared id).
 * Reads the most recent transfers in one batched call and filters locally. No event-log queries (the public RPC
 * caps them at 200 blocks), and the RPC can't tell which recipient we're interested in.
 */
export function useIncoming(account?: Address, sharedId?: bigint) {
  const count = useReadContract({ ...p, functionName: "queuedTransferCount", query: { refetchInterval: 10000 } });
  const n = count.data ?? 0n;
  const ids: bigint[] = [];
  for (let i = n; i > 0n && ids.length < WINDOW; i--) ids.push(i);
  if (sharedId !== undefined && sharedId > 0n && !ids.includes(sharedId)) ids.push(sharedId);

  const reads = useReadContracts({
    allowFailure: false,
    query: { enabled: ids.length > 0, refetchInterval: 10000 },
    contracts: ids.map((id) => ({ ...p, functionName: "getQueuedTransfer", args: [id] }) as const),
  });

  const all: (PendingTransfer & { pending: boolean })[] = (reads.data ?? []).map((r, i) => {
    const [q, pending] = r as unknown as readonly [Q, boolean];
    return { id: ids[i], from: q.from, to: q.to, amount: q.amount, executableAt: Number(q.executableAt), pending };
  });

  const mine = account ? all.filter((t) => t.pending && t.to.toLowerCase() === account.toLowerCase()) : [];
  const shared = sharedId !== undefined ? all.find((t) => t.id === sharedId) : undefined;
  return {
    loading: count.isLoading || (ids.length > 0 && reads.isLoading),
    incoming: mine.sort((a, b) => a.executableAt - b.executableAt),
    shared,
  };
}
