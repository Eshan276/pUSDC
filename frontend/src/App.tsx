import { useConnection, useConnect, useConnectors, useDisconnect, useSwitchChain } from "wagmi";
import { useState } from "react";
import { EyeOff, Loader2, LogOut, TriangleAlert, Wifi } from "lucide-react";
import { privateRpcEnabled, retryPrivate, setPrivateRpc, useAnonStatus } from "./lib/anonRpc";
import { CHAIN, TEST_MODE } from "./config";
import { shortAddr } from "./lib/format";
import { Button, Notice } from "./components/ui";
import { Mark } from "./components/Mark";
import { Avatar } from "./components/Avatar";
import { PAGES, PAGE_LABELS, usePage } from "./lib/usePage";
import { Dashboard, GuestPage } from "./components/Dashboard";
import { friendlyError } from "./lib/errors";

export default function App() {
  const { address, chainId, isConnected } = useConnection();
  const { mutate: disconnect } = useDisconnect();
  const [page, go] = usePage();
  const wrongChain = isConnected && chainId !== CHAIN.id;

  const nav = PAGES.map((p) => (
    <a
      key={p}
      href={`#${p}`}
      onClick={(e) => (e.preventDefault(), go(p))}
      aria-current={page === p ? "page" : undefined}
      className={`whitespace-nowrap rounded-full px-4 py-2 text-[15px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${page === p ? "bg-primary-soft text-primary" : "text-muted-foreground hover:bg-card hover:text-foreground"}`}
    >
      {PAGE_LABELS[p]}
    </a>
  ));

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 bg-background/70 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6">
          <a href="#swap" onClick={(e) => (e.preventDefault(), go("swap"))} className="flex items-center gap-2 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Mark className="size-8" />
            <span className="hidden whitespace-nowrap text-xl font-bold tracking-tight sm:inline">Protected USDC</span>
          </a>
          <nav aria-label="Pages" className="ml-2 hidden gap-1 md:flex">{nav}</nav>
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden items-center gap-1.5 whitespace-nowrap rounded-full bg-card px-3 py-2 text-sm font-medium shadow-sm ring-1 ring-border xl:inline-flex">
              <i className="size-2.5 rounded-full bg-primary" aria-hidden /> {CHAIN.name}
            </span>
            <PrivacyPill />
            {isConnected ? (
              <button
                onClick={() => disconnect()}
                aria-label={`Disconnect ${address}`}
                title="Disconnect"
                className="flex items-center gap-2 whitespace-nowrap rounded-full bg-card py-1.5 pl-1.5 pr-3 text-sm font-semibold shadow-sm ring-1 ring-border transition-colors hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Avatar address={address!} className="size-7" /> <span className="font-mono">{shortAddr(address)}</span> <LogOut className="size-4 text-muted-foreground" aria-hidden />
              </button>
            ) : (
              <ConnectButton className="!min-h-10 !rounded-full px-5 text-sm" label="Connect" compact />
            )}
          </div>
        </div>
        <nav aria-label="Pages" className="flex gap-1 overflow-x-auto px-4 pb-2 md:hidden">{nav}</nav>
      </header>

      <PrivacyBanner />
      <main className="mx-auto w-full max-w-[520px] px-4 pb-24 pt-6 sm:pt-12">
        {!isConnected ? <GuestPage page={page} /> : wrongChain && page !== "swap" ? <WrongNetwork /> : <Dashboard address={address!} page={page} go={go} />}
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

export function ConnectButton({ className = "", label = "Connect your wallet", compact = false }: { className?: string; label?: string; compact?: boolean }) {
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
          className={`inline-flex min-h-12 items-center justify-center rounded-2xl bg-primary px-6 text-[15px] font-semibold text-primary-foreground hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${className}`}
        >
          {label === "Connect your wallet" ? "Get a browser wallet" : label}
        </a>
        {!compact && <p className="text-center text-sm text-muted-foreground">You'll need a wallet extension like MetaMask or Rabby. It's free.</p>}
      </div>
    );
  return (
    <div className="space-y-2">
      <Button onClick={() => connect({ connector: connectors[0] })} loading={isPending} className={`min-h-12 px-6 text-sm ${className}`}>
        {label}
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
        aria-label={look.text}
        title={look.text}
        className={`inline-flex min-h-9 items-center gap-1.5 whitespace-nowrap rounded-full px-3 font-mono text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${look.cls}`}
      >
        {look.icon} <span className="hidden whitespace-nowrap xl:inline">{look.text}</span>
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-80 space-y-3 rounded-lg border border-border bg-card p-4 text-sm shadow-lg">
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
