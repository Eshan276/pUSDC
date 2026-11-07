import { useSyncExternalStore } from "react";
import { AnonRpcWorker } from "@anon-rpc/browser-harness";

/**
 * Private RPC reads via anon-rpc (https://github.com/ethereum/anon-rpc), on by default.
 *
 * Why it matters here: the "I'm a backup" view looks up the wallet you protect. Over a normal RPC, the provider learns
 * "this IP watches that wallet", which links your backup to your main wallet. That's exactly what a wrench attacker
 * would want. Routed through the Nox mixnet, the RPC provider can't tell who asked.
 *
 * Scope: the app's own reads. Your wallet extension still sends transactions (and does its own lookups) through its
 * own RPC provider.
 */

/** Nox: a Sphinx-packet mixnet worker (its IWorkerSpecifier lives on Ethereum Sepolia). */
const NOX_SPECIFIER = "0x35133267A8F7EC35046a83DCA0f4Ca8A6e1b7A9A";
/** Used once to read the specifier contract (by design not anonymized; reveals only "this page uses Nox"). */
const BOOTSTRAP_RPC = "https://sepolia.gateway.tenderly.co";
const PREF_KEY = "protected-usdc:private-rpc";

export type AnonStatus = "off" | "connecting" | "private" | "failed";

let status: AnonStatus = "off";
let worker: AnonRpcWorker | null = null;
const listeners = new Set<() => void>();
const setStatus = (s: AnonStatus) => {
  status = s;
  listeners.forEach((l) => l());
};

export const privateRpcEnabled = () => localStorage.getItem(PREF_KEY) !== "off";

/** Anonymizing needs a public RPC; the dev test mode talks to a local anvil, which a mixnet can't reach. */
function canAnonymize(url: string) {
  return !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/.test(url);
}

function start() {
  if (worker) return worker;
  setStatus("connecting");
  const rpcProvider = {
    async request({ method, params }: { method: string; params?: unknown[] }) {
      const r = await fetch(BOOTSTRAP_RPC, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: params ?? [] }),
      });
      const j = await r.json();
      if (j.error) throw new Error(j.error.message);
      return j.result;
    },
  };
  worker = new AnonRpcWorker({ address: NOX_SPECIFIER, config: {}, preExisting: { rpcProvider } } as never);
  worker.ready.then(
    () => setStatus("private"),
    () => setStatus("failed"),
  );
  return worker;
}

/** A drop-in `fetch` for viem's http transport: through the mixnet when possible, otherwise a normal fetch. */
export const privateFetch: typeof fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!privateRpcEnabled() || !canAnonymize(url) || status === "failed") return fetch(input, init);
  const w = start();
  try {
    // Only the parts a JSON-RPC call needs cross into the sandboxed worker.
    return await w.fetch(url, { method: init?.method ?? "POST", headers: init?.headers, body: init?.body });
  } catch (e) {
    if ((status as AnonStatus) === "failed") return fetch(input, init); // the worker never came up: fall back (the UI says so)
    throw e;
  }
};

/** Retry the private connection after a failure. */
export function retryPrivate() {
  worker?.close();
  worker = null;
  setStatus("off");
  start();
}

export function setPrivateRpc(on: boolean) {
  localStorage.setItem(PREF_KEY, on ? "on" : "off");
  if (!on) {
    worker?.close();
    worker = null;
    setStatus("off");
  } else retryPrivate();
}

export function useAnonStatus(): AnonStatus {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => status,
  );
}

/** Start connecting right away (on page load) so the ~15s mixnet bootstrap overlaps with the welcome screen. */
export function warmUp(rpcUrl: string) {
  if (privateRpcEnabled() && canAnonymize(rpcUrl)) start();
}
