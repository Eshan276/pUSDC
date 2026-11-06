import { createPublicClient, http } from "viem";
import { baseSepolia } from "viem/chains";

export const EXPLORER = "https://sepolia.basescan.org";
/** Demo deployment on Base Sepolia (see the repo README). */
export const PUSDC = "0xCabC4016cc24d2A2509552378dE6e232241295a3" as const;
export const USDC = "0xC75FDBDb1805528aC07A256aeDEe171d1Da509Be" as const;
export const DECIMALS = 6;
export const DAY = 86_400;
export const RPC_URL = (import.meta.env.VITE_RPC_URL as string | undefined) ?? "https://sepolia.base.org";
export const CHAIN = baseSepolia;
export const CHAIN_ID_HEX = `0x${CHAIN.id.toString(16)}`;

export const publicClient = createPublicClient({ chain: CHAIN, transport: http(RPC_URL) });
