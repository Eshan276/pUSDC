import type { Address, Hex } from "viem";
import { publicClient } from "./chain";

/** Network fee in wei for a transaction: estimated gas (+30%, as the wallet sends it) times the current gas price. */
export async function estimateFee(tx: { from: Address; to: Address; data?: Hex; value?: bigint }): Promise<bigint | undefined> {
  try {
    const [gas, price] = await Promise.all([
      publicClient.estimateGas({ account: tx.from, to: tx.to, data: tx.data, value: tx.value }),
      publicClient.getGasPrice(),
    ]);
    return (gas * 13n / 10n) * price;
  } catch {
    return undefined; // would fail anyway; the real error shows when sending
  }
}
