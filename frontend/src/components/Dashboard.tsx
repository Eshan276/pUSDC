import { useEffect, useState } from "react";
import type { Address } from "viem";
import { formatUnits } from "viem";
import { useWatchAsset } from "wagmi";
import { ArrowDownToLine, ArrowLeft, ArrowLeftRight, Check, ChevronRight, Clock, Copy, Droplets, FastForward, LifeBuoy, Lock, Plus, PlusCircle, RefreshCw, Send, ShieldAlert, ShieldCheck, ShieldOff, TriangleAlert } from "lucide-react";
import { pusdcAbi, usdcAbi } from "../abi";
import { DECIMALS, IS_TESTNET, PUSDC, SCHEDULER, USDC } from "../config";
import { fmtAmount, fmtCountdown, fmtDate, fmtDuration, shortAddr, toUnits } from "../lib/format";
import { knownBackups, useProtection, type ProtectionData } from "../lib/useProtection";
import { useAnonStatus } from "../lib/anonRpc";
import { useTx } from "../lib/useTx";
import { Button, Card, Notice, Progress, Skeleton, useNow } from "./ui";
import { Mark } from "./Mark";
import { PendingList, SendPanel, WrapPanel } from "./Panels";
import { SwapPanel } from "./Swap";
import { ProtectionPanel } from "./Protection";
import { GuardianPanel } from "./Guardian";

const SWAP_ENABLED = SCHEDULER !== "0x0000000000000000000000000000000000000000";
const SCREENS = ["home", "send", "swap", "wrap", "protection", "backup", "receive"] as const;
type Screen = (typeof SCREENS)[number];
const TITLES: Record<Screen, string> = { home: "Wallet", send: "Send", swap: "Swap", wrap: "Add & withdraw", protection: "Protection", backup: "I'm a backup", receive: "Receive" };

/** Which wallet screen is open, kept in the URL hash so links and the back button work. */
function useScreen(): [Screen, (s: Screen) => void] {
  const read = (): Screen => {
    const id = window.location.hash.replace("#", "") as Screen;
    return SCREENS.includes(id) && (id !== "swap" || SWAP_ENABLED) ? id : "home";
  };
  const [screen, setScreen] = useState<Screen>(read);
  useEffect(() => {
    const on = () => setScreen(read());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const go = (s: Screen) => {
    history.pushState(null, "", s === "home" ? window.location.pathname + window.location.search : `#${s}`);
    setScreen(s);
    window.scrollTo({ top: 0 });
  };
  useEffect(() => {
    const on = () => setScreen(read());
    window.addEventListener("popstate", on);
    return () => window.removeEventListener("popstate", on);
  }, []);
  return [screen, go];
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const fmtUsd = (v: bigint) => usd.format(Number(formatUnits(v, DECIMALS)));

export function Dashboard({ address }: { address: Address }) {
  const { data, loading, error, refetch } = useProtection(address);
  const [screen, go] = useScreen();

  if (loading) return <DashboardSkeleton />;
  if (error || !data)
    return (
      <div className="mx-auto mt-16 max-w-md space-y-4">
        <Notice tone="danger" icon={<TriangleAlert />} title="Couldn't reach the network">
          This is usually temporary. Check your connection and try again.
        </Notice>
        <Button variant="secondary" onClick={() => refetch()} className="w-full">
          <RefreshCw className="size-4" aria-hidden /> Try again
        </Button>
      </div>
    );

  return (
    <div className="wallet-col mx-auto w-full max-w-[520px] space-y-5 pt-5">
      {screen === "home" ? (
        <Home d={data} address={address} go={go} />
      ) : (
        <>
          <ScreenHeader title={TITLES[screen]} onBack={() => go("home")} />
          <Alerts d={data} address={address} />
          {screen === "send" && <SendPanel d={data} address={address} />}
          {screen === "swap" && <SwapPanel d={data} address={address} />}
          {screen === "wrap" && <WrapPanel d={data} />}
          {screen === "protection" && <ProtectionPanel d={data} address={address} />}
          {screen === "backup" && <GuardianPanel me={address} />}
          {screen === "receive" && <ReceiveScreen d={data} address={address} />}
        </>
      )}
    </div>
  );
}

/* ───────────────────────── home ───────────────────────── */

function Home({ d, address, go }: { d: ProtectionData; address: Address; go: (s: Screen) => void }) {
  const actions = [
    { id: "send" as const, label: "Send", icon: Send },
    ...(SWAP_ENABLED ? [{ id: "swap" as const, label: "Swap", icon: ArrowLeftRight }] : []),
    { id: "wrap" as const, label: "Add", icon: Plus },
    { id: "receive" as const, label: "Receive", icon: ArrowDownToLine },
  ];
  return (
    <>
      <AccountBar address={address} />
      <Alerts d={d} address={address} />
      <BalanceHero d={d} go={go} />
      <div className="grid grid-cols-4 gap-2" role="group" aria-label="Actions">
        {actions.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => go(id)} className="group flex flex-col items-center gap-2 rounded-xl py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <span className="grid size-14 place-items-center rounded-full bg-ink text-white transition-colors group-hover:bg-ink-hover group-active:scale-95">
              <Icon className="size-6" aria-hidden />
            </span>
            <span className="font-mono text-xs">{label}</span>
          </button>
        ))}
      </div>

      <Assets d={d} go={go} />

      {d.pending.length > 0 && <PendingList title="Scheduled transfers" transfers={d.pending} loading={d.pendingLoading} role="owner" fastLane={d.fastLane} />}

      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        <Row
          icon={d.protected ? ShieldCheck : ShieldOff}
          tone={d.protected ? "primary" : "muted"}
          title="Protection"
          sub={d.protected ? `Up to ${fmtAmount(d.dailyLimit)} pUSDC a day · bigger waits ${fmtDuration(d.holdWindow)}` : "Off. Set it up in a minute"}
          onClick={() => go("protection")}
        />
        <Row icon={LifeBuoy} tone="muted" title="I'm a backup" sub="Watch over someone else's wallet" onClick={() => go("backup")} />
      </ul>
      <div className="pb-6" />
    </>
  );
}

function Avatar({ address, className = "size-10" }: { address: string; className?: string }) {
  // A repeatable blue-ish gradient from the address, so each account looks like itself.
  const n = parseInt(address.slice(2, 10), 16);
  const h1 = 190 + (n % 70), h2 = 200 + ((n >> 8) % 70);
  return <span aria-hidden className={`${className} shrink-0 rounded-full`} style={{ background: `linear-gradient(135deg, hsl(${h1} 78% 52%), hsl(${h2} 72% 32%))` }} />;
}

function AccountBar({ address }: { address: Address }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-3">
      <Avatar address={address} />
      <div className="min-w-0 flex-1">
        <p className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">Account</p>
        <button
          onClick={() => navigator.clipboard?.writeText(address).then(() => (setCopied(true), setTimeout(() => setCopied(false), 1500)))}
          className="flex items-center gap-1.5 rounded font-mono text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Copy your address"
        >
          {shortAddr(address)} {copied ? <Check className="size-3.5 text-primary" aria-hidden /> : <Copy className="size-3.5 text-muted-foreground" aria-hidden />}
        </button>
      </div>
    </div>
  );
}

function BalanceHero({ d, go }: { d: ProtectionData; go: (s: Screen) => void }) {
  const chips = [
    { label: "Free", value: d.available, show: true },
    { label: "Scheduled", value: d.reserved, show: d.reserved > 0n },
    { label: "Locked", value: d.locked, show: d.locked > 0n },
  ].filter((c) => c.show);
  return (
    <Card className="space-y-4 !p-6">
      <div>
        <p className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">Total balance</p>
        <p className="mt-1 text-[2.6rem] font-light leading-none tracking-tight tabular">{fmtUsd(d.balance)}</p>
        <p className="mt-2 font-mono text-xs text-muted-foreground tabular">{fmtAmount(d.balance)} pUSDC</p>
      </div>
      {chips.length > 1 && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-muted-foreground">
          {chips.map((c) => (
            <li key={c.label}>
              {c.label} <b className="font-semibold text-foreground tabular">{fmtAmount(c.value)}</b>
            </li>
          ))}
        </ul>
      )}
      {d.protected ? (
        <button onClick={() => go("protection")} className="block w-full space-y-2 rounded-lg bg-primary-soft p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <span className="flex items-center justify-between gap-2 text-sm font-medium text-primary-soft-foreground">
            <span className="flex items-center gap-1.5"><ShieldCheck className="size-4" aria-hidden /> You're protected</span>
            <span className="font-mono text-xs tabular"><b>{fmtAmount(d.dailyRemaining)}</b> of {fmtAmount(d.dailyLimit)} left today</span>
          </span>
          <Progress value={d.dailyLimit > 0n ? Number((d.dailyRemaining * 100n) / d.dailyLimit) : 0} label="Daily spending left" />
        </button>
      ) : (
        <div className="flex items-center justify-between gap-3 rounded-lg bg-warning-soft p-3">
          <span className="flex items-center gap-2 text-sm font-medium text-warning-foreground"><ShieldOff className="size-4 shrink-0" aria-hidden /> Protection is off</span>
          <Button onClick={() => go("protection")} className="min-h-9 shrink-0 text-xs">Set it up</Button>
        </div>
      )}
    </Card>
  );
}

function Assets({ d, go }: { d: ProtectionData; go: (s: Screen) => void }) {
  return (
    <section aria-label="Assets">
      <h2 className="mb-2 px-1 font-mono text-[11px] font-normal uppercase tracking-wide text-muted-foreground">Assets</h2>
      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        <li className="flex items-center gap-3 p-4">
          <Mark className="size-10 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="font-medium">Protected USDC</p>
            <p className="font-mono text-xs text-muted-foreground">pUSDC · protected</p>
          </div>
          <div className="text-right">
            <p className="font-medium tabular">{fmtUsd(d.balance)}</p>
            <p className="font-mono text-xs text-muted-foreground tabular">{fmtAmount(d.balance)}</p>
          </div>
        </li>
        <li className="flex items-center gap-3 p-4">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-muted font-mono text-sm font-semibold text-muted-foreground" aria-hidden>$</span>
          <div className="min-w-0 flex-1">
            <p className="font-medium">USD Coin</p>
            <p className="font-mono text-xs text-muted-foreground">USDC · not protected</p>
          </div>
          <div className="text-right">
            <p className="font-medium tabular">{fmtUsd(d.usdcBalance)}</p>
            {d.usdcBalance > 0n ? (
              <button onClick={() => go("wrap")} className="font-mono text-xs font-medium text-primary underline-offset-2 hover:underline">Protect it</button>
            ) : (
              <p className="font-mono text-xs text-muted-foreground tabular">{fmtAmount(d.usdcBalance)}</p>
            )}
          </div>
        </li>
      </ul>
    </section>
  );
}

function Row({ icon: Icon, tone, title, sub, onClick }: { icon: typeof ShieldCheck; tone: "primary" | "muted"; title: string; sub: string; onClick: () => void }) {
  return (
    <li>
      <button onClick={onClick} className="flex w-full items-center gap-3 p-4 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
        <span className={`grid size-10 shrink-0 place-items-center rounded-lg ${tone === "primary" ? "bg-primary-soft text-primary-soft-foreground" : "bg-muted text-muted-foreground"}`}>
          <Icon className="size-5" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-medium">{title}</span>
          <span className="block truncate text-sm text-muted-foreground">{sub}</span>
        </span>
        <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
      </button>
    </li>
  );
}

function ScreenHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <button onClick={onBack} aria-label="Back to wallet" className="grid size-10 place-items-center rounded-full hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <ArrowLeft className="size-5" aria-hidden />
      </button>
      <h1 className="text-2xl">{title}</h1>
    </div>
  );
}

function ReceiveScreen({ d, address }: { d: ProtectionData; address: Address }) {
  const { run, busy } = useTx();
  const { mutate: watchAsset } = useWatchAsset();
  const [copied, setCopied] = useState(false);
  return (
    <Card className="space-y-5">
      <div className="flex flex-col items-center gap-3 text-center">
        <Avatar address={address} className="size-16" />
        <p className="text-sm text-muted-foreground">Send USDC or pUSDC on <b className="font-semibold text-foreground">Base Sepolia</b> to this address. Receiving is never slowed down, even with protection on.</p>
        <p className="break-all rounded-lg bg-muted p-4 font-mono text-sm leading-relaxed">{address}</p>
        <Button
          onClick={() => navigator.clipboard?.writeText(address).then(() => (setCopied(true), setTimeout(() => setCopied(false), 1500)))}
          className="w-full"
        >
          {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />} {copied ? "Copied" : "Copy address"}
        </Button>
      </div>
      <div className="flex flex-wrap gap-2 border-t border-border pt-4">
        {IS_TESTNET && (
          <Button variant="secondary" loading={busy === "faucet"} onClick={() => run("faucet", { address: USDC, abi: usdcAbi, functionName: "mint", args: [address, toUnits(10_000)] }, "10,000 test USDC added")}>
            <Droplets className="size-4" aria-hidden /> Get 10,000 test USDC
          </Button>
        )}
        <Button variant="ghost" onClick={() => watchAsset({ type: "ERC20", options: { address: PUSDC, symbol: "pUSDC", decimals: DECIMALS } })}>
          <PlusCircle className="size-4" aria-hidden /> Show pUSDC in my wallet
        </Button>
      </div>
      {d.locked > 0n && <p className="font-mono text-xs text-muted-foreground">{fmtAmount(d.locked)} pUSDC is locked and can't be moved yet.</p>}
    </Card>
  );
}

/* ───────────────────────── alerts (same safety notices as before) ───────────────────────── */

function Alerts({ d, address }: { d: ProtectionData; address: Address }) {
  const now = useNow();
  const { run, busy } = useTx();
  const p = { address: PUSDC, abi: pusdcAbi } as const;
  if (!d.protected) return d.locked > 0n ? <LockedNotice d={d} now={now} /> : null;
  // If this browser set up protection but the on-chain backup is one we never chose, someone else holding
  // this key probably front-ran the setup with their own backup.
  const mine = knownBackups(address);
  const hijacked = mine.length > 0 && !mine.includes(d.backup.toLowerCase());
  const changes = Object.entries(d.pendingChanges).filter(([, c]) => c && c.effectiveAt > now);
  const labels = ["Daily limit", "Waiting time for big transfers", "Waiting time to loosen settings", "Emergency lock"];
  const show = (i: number, v: bigint) => (i === 0 ? `${fmtAmount(v)} pUSDC` : fmtDuration(Number(v)));
  const any = hijacked || d.flagOffAt > 0 || changes.length > 0 || d.fastLaneAt > now || (d.pendingBackup && d.pendingBackup.effectiveAt > now) || d.locked > 0n;
  if (!any) return null;
  return (
    <div className="space-y-3">
      {hijacked && (
        <Notice tone="danger" icon={<ShieldAlert />} title="This backup isn't one you chose">
          <p>
            The backup on record is {shortAddr(d.backup)}, which you never entered here. Someone else may have this wallet's key and set up
            protection first. Don't use the emergency button (it would send funds to their backup) and don't add more funds. Move what you can
            to a brand-new wallet.
          </p>
        </Notice>
      )}

      {d.flagOffAt > 0 && (
        <Notice tone="warning" icon={<Clock />} title={`Protection turns off in ${fmtCountdown(d.flagOffAt - now)}`}>
          <p>Scheduled for {fmtDate(d.flagOffAt)}. If this wasn't you, cancel it now and consider the emergency button.</p>
          <Button variant="secondary" className="mt-2" loading={busy === "cancelOff"} onClick={() => run("cancelOff", { ...p, functionName: "cancelFlagOff" }, "Protection stays on")}>
            Cancel, keep me protected
          </Button>
        </Notice>
      )}

      {changes.map(([k, c]) => (
        <Notice key={k} tone="warning" icon={<Clock />} title={`${labels[+k]} changes to ${show(+k, c!.value)}`}>
          <p>Takes effect {fmtDate(c!.effectiveAt)} (in {fmtCountdown(c!.effectiveAt - now)}). Didn't do this? Cancel it.</p>
          <Button variant="secondary" className="mt-2" loading={busy === `cp${k}`} onClick={() => run(`cp${k}`, { ...p, functionName: "cancelParamChange", args: [+k] }, "Change cancelled")}>
            Cancel change
          </Button>
        </Notice>
      ))}

      {d.fastLaneAt > now && (
        <Notice tone="warning" icon={<FastForward />} title={`Instant backup approval turns on in ${fmtCountdown(d.fastLaneAt - now)}`}>
          <p>After that, your backup can send big transfers right away. Didn't do this? Cancel it.</p>
          <Button variant="secondary" className="mt-2" loading={busy === "lane"} onClick={() => run("lane", { ...p, functionName: "setFastLane", args: [false] }, "Cancelled")}>
            Cancel change
          </Button>
        </Notice>
      )}

      {d.pendingBackup && d.pendingBackup.effectiveAt > now && (
        <Notice tone="warning" icon={<Clock />} title={`Backup wallet changes to ${shortAddr(d.pendingBackup.backup)}`}>
          <p>Takes effect {fmtDate(d.pendingBackup.effectiveAt)}. If this wasn't you, cancel it, or use the emergency button.</p>
          <Button variant="secondary" className="mt-2" loading={busy === "cb"} onClick={() => run("cb", { ...p, functionName: "cancelBackupChange" }, "Backup change cancelled")}>
            Cancel change
          </Button>
        </Notice>
      )}
      {d.locked > 0n && <LockedNotice d={d} now={now} />}
    </div>
  );
}

function LockedNotice({ d, now }: { d: ProtectionData; now: number }) {
  return (
    <Notice tone="info" icon={<Lock />} title={`${fmtAmount(d.locked)} pUSDC is locked for safety`}>
      It was moved here by an emergency action and unlocks {fmtDate(d.lockedUntil)} (in {fmtCountdown(d.lockedUntil - now)}). Nobody can
      move it before then, not even you.
    </Notice>
  );
}

function DashboardSkeleton() {
  const anon = useAnonStatus();
  return (
    <div className="mx-auto w-full max-w-[520px] space-y-5 pt-5" aria-busy="true" aria-label="Loading your account">
      {anon === "connecting" && (
        <p className="text-center text-sm text-muted-foreground" role="status">
          Connecting privately through the Nox mixnet. The first load takes about 15 seconds.
        </p>
      )}
      <Skeleton className="h-10 w-48" />
      <Skeleton className="h-52" />
      <Skeleton className="h-24" />
      <Skeleton className="h-40" />
    </div>
  );
}
