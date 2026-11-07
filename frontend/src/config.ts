import { createConfig, http } from "wagmi";
import { baseSepolia } from "wagmi/chains";
import { injected, mock } from "wagmi/connectors";
import type { Address } from "viem";
import { privateFetch } from "./lib/anonRpc";

export const EXPLORER = "https://sepolia.basescan.org";

/** Demo deployment on Base Sepolia (see the repo README). The demo USDC can be minted by anyone. */
export const PUSDC = ((import.meta.env.VITE_PUSDC as string | undefined) ?? "0x033B36fE536e97d312Ece98750A0302eF31CBBab") as Address;
export const USDC = ((import.meta.env.VITE_USDC as string | undefined) ?? "0xC75FDBDb1805528aC07A256aeDEe171d1Da509Be") as Address;
export const DECIMALS = 6;

/** Uniswap v4 scheduled swaps (see src/ScheduledSwap.sol). Set VITE_SCHEDULER to the zero address to hide the feature. */
export const SCHEDULER = ((import.meta.env.VITE_SCHEDULER as string | undefined) ?? "0x3aa82e9d481FDdf1913381ae2692c3FF272e4158") as Address;
const [C0, C1] = PUSDC.toLowerCase() < USDC.toLowerCase() ? [PUSDC, USDC] : [USDC, PUSDC];
/** The hookless 0.05% pUSDC/USDC v4 pool created by script/DeployScheduledSwap.s.sol. */
export const POOL_KEY = { currency0: C0, currency1: C1, fee: 500, tickSpacing: 10, hooks: "0x0000000000000000000000000000000000000000" as Address } as const;
export const IS_TESTNET = true;

export const DAY = 86_400;

/** Matches ProtectedERC20.Param. */
export const Param = { DailyLimit: 0, HoldWindow: 1, OffDelay: 2, LockDuration: 3 } as const;
export type ParamId = (typeof Param)[keyof typeof Param];

export const RPC_URL = (import.meta.env.VITE_RPC_URL as string | undefined) ?? "https://sepolia.base.org";
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
  // App reads go through anon-rpc (Nox mixnet) by default; see lib/anonRpc.ts.
  transports: { [CHAIN.id]: http(RPC_URL, { fetchFn: privateFetch, batch: true }) },
});

declare module "wagmi" {
  interface Register {
    config: typeof config;
  }
}
