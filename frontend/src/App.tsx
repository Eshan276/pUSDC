import { useConnection, useConnect, useConnectors, useDisconnect, useSwitchChain } from "wagmi";
import { useState } from "react";
import { EyeOff, Loader2, LogOut, ShieldCheck, TriangleAlert, Wifi } from "lucide-react";
import { privateRpcEnabled, retryPrivate, setPrivateRpc, useAnonStatus } from "./lib/anonRpc";
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
          <PrivacyPill />
          {isConnected && (
            <Button variant="secondary" onClick={() => disconnect()} aria-label={`Disconnect ${address}`} className="font-mono text-xs">
              {shortAddr(address)} <LogOut className="size-4" aria-hidden />
            </Button>
          )}
        </div>
      </header>

      <PrivacyBanner />
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

/** Header pill: is the app reading the chain privately (through the Nox mixnet)? Click for details. */
function PrivacyPill() {
  const status = useAnonStatus();
  const [open, setOpen] = useState(false);
  const enabled = privateRpcEnabled();
  const look = {
    private: { cls: "bg-primary-soft text-primary-soft-foreground", icon: <EyeOff className="size-3.5" aria-hidden />, text: "Private connection" },
    connecting: { cls: "bg-muted text-muted-foreground", icon: <Loader2 className="size-3.5 motion-safe:animate-spin" aria-hidden />, text: "Connecting privately…" },
    failed: { cls: "bg-warning-soft text-warning-foreground", icon: <TriangleAlert className="size-3.5" aria-hidden />, text: "Standard connection" },
    off: { cls: "bg-muted text-muted-foreground", icon: <Wifi className="size-3.5" aria-hidden />, text: enabled ? "Private connection" : "Standard connection" },
  }[status];
  return (
    <div className="relative" onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className={`inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${look.cls}`}
      >
        {look.icon} {look.text}
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-80 space-y-3 rounded-2xl border border-border bg-card p-4 text-sm shadow-lg">
          <p className="font-semibold">Who can see what you look up?</p>
          <p className="text-muted-foreground">
            {enabled
              ? "This app reads the blockchain through the Nox mixnet (anon-rpc), so the RPC provider can't tell which wallets you check, including the one you're a backup for."
              : "Private connection is off. The RPC provider can see which wallets you look up, including the one you're a backup for."}{" "}
            Your wallet extension still sends transactions through its own provider.
          </p>
          <div className="flex flex-wrap gap-2">
            {status === "failed" && (
              <Button variant="secondary" onClick={retryPrivate}>
                Try private again
              </Button>
            )}
            <Button variant="ghost" onClick={() => (setPrivateRpc(!enabled), setOpen(false))}>
              {enabled ? "Turn off (faster)" : "Turn on private connection"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function PrivacyBanner() {
  const status = useAnonStatus();
  if (status !== "failed") return null;
  return (
    <div className="mx-auto mb-4 max-w-5xl px-4 sm:px-6">
      <Notice tone="warning" icon={<TriangleAlert />} title="Private connection unavailable">
        <p>
          The mixnet didn't respond, so the app is using a normal connection: the RPC provider can see which wallets you look up.
        </p>
        <Button variant="secondary" className="mt-2" onClick={retryPrivate}>
          Try private again
        </Button>
      </Notice>
    </div>
  );
}
