import { useSyncExternalStore } from "react";
import type { Address } from "viem";

/** Who completes a big transfer once its wait is over. Saved on this device only (no server, nothing on-chain). */
export type Completer = "me" | "recipient";

const key = (a: Address) => `protected-usdc:completer:${a.toLowerCase()}`;
const listeners = new Set<() => void>();

export function getCompleter(a: Address): Completer {
  return localStorage.getItem(key(a)) === "recipient" ? "recipient" : "me";
}
export function setCompleter(a: Address, c: Completer) {
  localStorage.setItem(key(a), c);
  listeners.forEach((l) => l());
}
export function useCompleter(a: Address): Completer {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => getCompleter(a),
  );
}

/** Link that opens one scheduled transfer for anyone (the recipient usually), so they can complete it. */
export const shareLink = (id: bigint) => `${location.origin}${location.pathname}#incoming/${id}`;
