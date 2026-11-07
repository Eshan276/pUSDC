import { ConnectButton } from "../App";
import { Mark } from "./Mark";

/** What you see before a wallet is connected: just the connect step, like any wallet. */
export function Welcome() {
  return (
    <div className="mx-auto flex min-h-[68dvh] max-w-sm flex-col items-center justify-center gap-7 text-center">
      <Mark className="size-20" />
      <div className="space-y-2">
        <h1 className="text-3xl">Protected USDC</h1>
        <p className="text-muted-foreground text-pretty">Connect your wallet to see your balance, send, swap and manage protection.</p>
      </div>
      <ConnectButton className="w-full" />
    </div>
  );
}
