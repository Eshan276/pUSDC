import { createConfig, http } from "wagmi";
import { baseSepolia } from "wagmi/chains";
import { injected, mock } from "wagmi/connectors";
import type { Address } from "viem";

export const EXPLORER = "https://sepolia.basescan.org";

/** Demo deployment on Base Sepolia (see the repo README). The demo USDC can be minted by anyone. */
export const PUSDC = ((import.meta.env.VITE_PUSDC as string | undefined) ?? "0xCabC4016cc24d2A2509552378dE6e232241295a3") as Address;
export const USDC = ((import.meta.env.VITE_USDC as string | undefined) ?? "0xC75FDBDb1805528aC07A256aeDEe171d1Da509Be") as Address;
export const DECIMALS = 6;
export const IS_TESTNET = true;

export const DAY = 86_400;

/** Matches ProtectedERC20.Param. */
export const Param = { DailyLimit: 0, HoldWindow: 1, OffDelay: 2, LockDuration: 3 } as const;
export type ParamId = (typeof Param)[keyof typeof Param];

const RPC_URL = (import.meta.env.VITE_RPC_URL as string | undefined) ?? "https://sepolia.base.org";
// Wallet-side requests (e.g. the dev test-mode connector) use the chain's own RPC, so keep it in sync.
export const CHAIN = { ...baseSepolia, rpcUrls: { default: { http: [RPC_URL] } } } as const;

/**
 * DEV-ONLY test mode: `npm run dev` with VITE_RPC_URL pointing at an anvil fork started with
 * --auto-impersonate, then open /?as=0xADDRESS to act as that address. Stripped from production builds.
 */
const ACT_AS = import.meta.env.DEV ? (new URLSearchParams(location.search).get("as") as Address | null) : null;
export const TEST_MODE = !!ACT_AS;

// Browser-extension wallets only: no WalletConnect relay, no third-party trackers.
export const config = createConfig({
  chains: [CHAIN],
  connectors: ACT_AS ? [mock({ accounts: [ACT_AS], features: { reconnect: true } }), injected()] : [injected()],
  transports: { [CHAIN.id]: http(RPC_URL) },
});

declare module "wagmi" {
  interface Register {
    config: typeof config;
  }
}
