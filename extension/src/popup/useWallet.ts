import { useCallback, useEffect, useState } from "react";
import type { Address } from "viem";
import { call } from "./api";
import { readProtection, type Protection } from "../shared/read";
import type { WalletState } from "../shared/messages";

export function useWalletState() {
  const [state, setState] = useState<WalletState>();
  const refresh = useCallback(async () => setState(await call<WalletState>({ t: "state" })), []);
  useEffect(() => { void refresh(); }, [refresh]);
  return { state, refresh };
}

/** Polls the chain for one address. */
export function useProtection(address?: Address, every = 6000) {
  const [data, setData] = useState<Protection>();
  const [error, setError] = useState<string>();
  const load = useCallback(async () => {
    if (!address) return;
    try { setData(await readProtection(address)); setError(undefined); }
    catch (e) { setError(e instanceof Error ? e.message : "Couldn't reach the network."); }
  }, [address]);
  useEffect(() => {
    setData(undefined);
    void load();
    const t = setInterval(load, every);
    return () => clearInterval(t);
  }, [load, every]);
  return { data, error, reload: load };
}
