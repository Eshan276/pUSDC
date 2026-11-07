import { useState } from "react";
import type { TransactionReceipt } from "viem";
import { encodeFunctionData, type Abi, type Address } from "viem";
import { call } from "./api";
import { publicClient, EXPLORER } from "../shared/chain";
import { friendlyError, NEEDS_ETH } from "../shared/errors";
import { useToast } from "@ui/toast";

type C = { address: Address; abi: Abi; functionName: string; args?: readonly unknown[] };
export type Activity = { hash: `0x${string}`; title: string; at: number };

async function remember(a: Activity) {
  const { activity } = await chrome.storage.local.get("activity");
  await chrome.storage.local.set({ activity: [a, ...((activity as Activity[]) ?? [])].slice(0, 30) });
}

/** Simulate (for a clear reason on failure) -> sign + send in the service worker -> wait -> toast + history. */
export function useSend(account: Address | undefined, after: () => void) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  async function guarded(key: string, success: string, submit: () => Promise<`0x${string}`>): Promise<TransactionReceipt | false> {
    if (!account) return false;
    setBusy(key);
    try {
      if ((await publicClient.getBalance({ address: account })) === 0n) throw new Error(NEEDS_ETH);
      const hash = await submit();
      toast.show({ kind: "info", title: "Waiting for the network…", body: "This usually takes a few seconds." });
      const r = await publicClient.waitForTransactionReceipt({ hash });
      if (r.status !== "success") throw new Error("The network rejected this transaction.");
      toast.show({ kind: "success", title: success, href: `${EXPLORER}/tx/${hash}` });
      void remember({ hash, title: success, at: Math.floor(Date.now() / 1000) });
      return r;
    } catch (e) {
      const msg = friendlyError(e);
      if (msg) toast.show({ kind: "error", title: "That didn't go through", body: msg });
      return false;
    } finally {
      setBusy(null);
      after();
    }
  }

  /** A contract call. */
  function run(key: string, c: C, success: string): Promise<TransactionReceipt | false> {
    return guarded(key, success, async () => {
      await publicClient.simulateContract({ ...c, account } as never);
      return call<`0x${string}`>({ t: "send", to: c.address, data: encodeFunctionData(c as never) });
    });
  }

  /** A plain ETH transfer. */
  function sendEth(key: string, to: Address, value: bigint, success: string): Promise<TransactionReceipt | false> {
    return guarded(key, success, async () => {
      await publicClient.call({ account, to, value });
      return call<`0x${string}`>({ t: "send", to, data: "0x", value: value.toString() });
    });
  }

  return { run, sendEth, busy, account };
}
