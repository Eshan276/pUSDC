import { useState } from "react";
import { useConfig, useConnection } from "wagmi";
import { getPublicClient, simulateContract, waitForTransactionReceipt, writeContract } from "wagmi/actions";
import { useQueryClient } from "@tanstack/react-query";
import type { Abi, Address } from "viem";
import { friendlyError } from "./errors";
import { useToast } from "../components/toast";
import { EXPLORER } from "../config";

type Call = { address: Address; abi: Abi; functionName: string; args?: readonly unknown[] };

/**
 * Sends a contract transaction the friendly way:
 * 1. simulate first, so a doomed transaction shows a clear reason before the wallet even opens;
 * 2. add a 30% gas buffer (estimates run low on transfers that clear storage);
 * 3. wait for confirmation, toast the result with an explorer link and refresh all reads.
 */
export function useTx() {
  const config = useConfig();
  const { address } = useConnection();
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  async function run(key: string, call: Call, success: string): Promise<boolean> {
    if (!address) return false;
    setBusy(key);
    try {
      const { request } = await simulateContract(config, { ...call, account: address } as never);
      const gas = await getPublicClient(config)!.estimateContractGas({ ...call, account: address } as never);
      const hash = await writeContract(config, { ...(request as object), gas: (gas * 13n) / 10n } as never);
      toast.show({ kind: "info", title: "Waiting for the network…", body: "This usually takes a few seconds." });
      const receipt = await waitForTransactionReceipt(config, { hash });
      if (receipt.status !== "success") throw new Error("The network rejected this transaction.");
      toast.show({ kind: "success", title: success, href: `${EXPLORER}/tx/${hash}` });
      return true;
    } catch (e) {
      const msg = friendlyError(e);
      if (msg) toast.show({ kind: "error", title: "That didn't go through", body: msg });
      return false;
    } finally {
      setBusy(null);
      await qc.invalidateQueries();
    }
  }

  return { run, busy };
}
