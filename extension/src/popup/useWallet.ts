import { useCallback, useEffect, useState } from "react";
import type { Address } from "viem";
import { call } from "./api";
import { chainNow, readBounds, readProtection, type Protection } from "../shared/read";
import { DEFAULT_BOUNDS, type Bounds } from "../shared/presets";
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

export function useBounds(): Bounds {
  const [b, setB] = useState<Bounds>(DEFAULT_BOUNDS);
  useEffect(() => { void readBounds().then(setB); }, []);
  return b;
}

/** Like useNow, but on the chain's clock (see chainNow). Ticks every second. */
export function useChainNow(): number {
  const [now, setNow] = useState(chainNow);
  useEffect(() => {
    const t = setInterval(() => setNow(chainNow()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}
