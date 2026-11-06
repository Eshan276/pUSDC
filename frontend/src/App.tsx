import { useConnection, useConnect, useConnectors, useDisconnect, useSwitchChain } from "wagmi";
import { LogOut, ShieldCheck, Wifi } from "lucide-react";
import { CHAIN, TEST_MODE } from "./config";
import { shortAddr } from "./lib/format";
import { Button, Notice } from "./components/ui";
import { Welcome } from "./components/Welcome";
import { Dashboard } from "./components/Dashboard";
import { friendlyError } from "./lib/errors";

export default function App() {
  const { address, chainId, isConnected } = useConnection();
  const { mutate: disconnect } = useDisconnect();
  const wrongChain = isConnected && chainId !== CHAIN.id;

  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
        <a href="./" className="flex items-center gap-2 rounded-xl font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <span className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground">
            <ShieldCheck className="size-5" aria-hidden />
          </span>
          <span className="text-lg tracking-tight">Protected USDC</span>
        </a>
        <div className="flex items-center gap-2">
          <span className="hidden items-center gap-1.5 rounded-full bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground sm:inline-flex">
            <Wifi className="size-3.5" aria-hidden /> {CHAIN.name} · test network
          </span>
          {isConnected && (
            <Button variant="secondary" onClick={() => disconnect()} aria-label={`Disconnect ${address}`} className="font-mono text-xs">
              {shortAddr(address)} <LogOut className="size-4" aria-hidden />
            </Button>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 pb-24 sm:px-6">
        {!isConnected ? <Welcome /> : wrongChain ? <WrongNetwork /> : <Dashboard address={address!} />}
      </main>

      <footer className="mx-auto max-w-5xl px-4 pb-10 text-center text-xs text-muted-foreground sm:px-6">
        Open source (MIT) · No sign-up, no tracking · Your keys never leave your wallet
      </footer>
    </div>
  );
}

function WrongNetwork() {
  const { mutate: switchChain, isPending, error } = useSwitchChain();
  return (
    <div className="mx-auto mt-16 max-w-md space-y-4 text-center">
      <h1 className="text-2xl font-bold">One small switch</h1>
      <p className="text-muted-foreground">Protected USDC lives on {CHAIN.name}, a free test network. Your wallet is on a different one.</p>
      <Button onClick={() => switchChain({ chainId: CHAIN.id })} loading={isPending} className="w-full">
        Switch to {CHAIN.name}
      </Button>
      {error && friendlyError(error) && <Notice tone="danger">{friendlyError(error)}</Notice>}
    </div>
  );
}

export function ConnectButton({ className = "" }: { className?: string }) {
  const connectors = useConnectors();
  const { mutate: connect, isPending, error } = useConnect();
  const hasWallet = TEST_MODE || (typeof window !== "undefined" && "ethereum" in window);
  if (!hasWallet)
    return (
      <div className="space-y-2">
        <a
          href="https://metamask.io/download/"
          target="_blank"
          rel="noreferrer"
          className={`inline-flex min-h-12 items-center justify-center rounded-xl bg-primary px-6 font-semibold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${className}`}
        >
          Get a browser wallet
        </a>
        <p className="text-sm text-muted-foreground">You'll need a wallet extension like MetaMask or Rabby. It's free.</p>
      </div>
    );
  return (
    <div className="space-y-2">
      <Button onClick={() => connect({ connector: connectors[0] })} loading={isPending} className={`min-h-12 px-6 text-base ${className}`}>
        Connect your wallet
      </Button>
      {error && friendlyError(error) && <Notice tone="danger">{friendlyError(error)}</Notice>}
    </div>
  );
}
