import { createPublicClient, http } from "viem";
import { baseSepolia } from "viem/chains";

export const EXPLORER = "https://sepolia.basescan.org";
/** Demo deployment on Base Sepolia (see the repo README). */
/** Defaults; override with VITE_PUSDC / VITE_USDC at build time, or at runtime from More → Demo token (see loadConfig). */
export const DEFAULT_PUSDC = ((import.meta.env.VITE_PUSDC as string | undefined) ?? "0x033B36fE536e97d312Ece98750A0302eF31CBBab") as `0x${string}`;
export const DEFAULT_USDC = ((import.meta.env.VITE_USDC as string | undefined) ?? "0xC75FDBDb1805528aC07A256aeDEe171d1Da509Be") as `0x${string}`;
/** Live bindings: importers see the new value after the user switches token. */
export let PUSDC: `0x${string}` = DEFAULT_PUSDC;
export let USDC: `0x${string}` = DEFAULT_USDC;
export const DECIMALS = 6;
export const DAY = 86_400;
export const RPC_URL = (import.meta.env.VITE_RPC_URL as string | undefined) ?? "https://sepolia.base.org";
export const CHAIN = baseSepolia;
export const CHAIN_ID_HEX = `0x${CHAIN.id.toString(16)}`;

export const publicClient = createPublicClient({ chain: CHAIN, transport: http(RPC_URL) });

type Override = { pusdc: `0x${string}`; usdc: `0x${string}` };
function apply(o?: Override) { PUSDC = o?.pusdc ?? DEFAULT_PUSDC; USDC = o?.usdc ?? DEFAULT_USDC; }
const read = async () => (await chrome.storage.local.get("tokenOverride")).tokenOverride as Override | undefined;
/** Resolves once the saved token choice is loaded. Await it before reading PUSDC/USDC at startup. */
export const cfgReady: Promise<void> = read().then(apply);
chrome.storage.onChanged.addListener((c) => { if (c.tokenOverride) apply(c.tokenOverride.newValue as Override | undefined); });
/** Saves a token choice (or clears it with undefined). */
export async function setTokenOverride(o?: Override) {
  if (o) await chrome.storage.local.set({ tokenOverride: o }); else await chrome.storage.local.remove("tokenOverride");
  apply(o);
}
