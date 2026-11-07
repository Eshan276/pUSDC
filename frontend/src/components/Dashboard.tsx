import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { Address } from "viem";
import { useWatchAsset } from "wagmi";
import { ArrowRight, Clock, Droplets, FastForward, Lock, PlusCircle, RefreshCw, ShieldAlert, ShieldCheck, ShieldOff, TriangleAlert } from "lucide-react";
import { pusdcAbi, usdcAbi } from "../abi";
import { DECIMALS, IS_TESTNET, PUSDC, SCHEDULER, USDC } from "../config";
import { fmtAmount, fmtCountdown, fmtDate, fmtDuration, shortAddr, toUnits } from "../lib/format";
import { knownBackups, useProtection, type ProtectionData } from "../lib/useProtection";
import { useAnonStatus } from "../lib/anonRpc";
import { useTx } from "../lib/useTx";
import { Button, Card, Notice, Progress, Skeleton, useNow } from "./ui";
import { SendPanel, WrapPanel } from "./Panels";
import { SwapPanel } from "./Swap";
import { ProtectionPanel } from "./Protection";
import { GuardianPanel } from "./Guardian";

const SWAP_ENABLED = SCHEDULER !== "0x0000000000000000000000000000000000000000";
const TABS = [
  { id: "send", label: "Send" },
  ...(SWAP_ENABLED ? [{ id: "swap", label: "Swap" } as const] : []),
  { id: "wrap", label: "Add & withdraw" },
  { id: "protection", label: "Protection" },
  { id: "backup", label: "I'm a backup" },
] as const;
type TabId = (typeof TABS)[number]["id"];

function useHashTab(): [TabId, (t: TabId) => void] {
  const read = () => (TABS.find((t) => `#${t.id}` === window.location.hash)?.id ?? "send") as TabId;
  const [tab, setTab] = useState<TabId>(read);
  useEffect(() => {
    const on = () => setTab(read());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const go = (t: TabId) => {
    history.replaceState(null, "", `#${t}`);
    setTab(t);
  };
  return [tab, go];
}

export function Dashboard({ address }: { address: Address }) {
  const { data, loading, error, refetch } = useProtection(address);
  const [tab, setTab] = useHashTab();

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
    <div className="space-y-6 pt-4">
      <div className="grid gap-6 lg:grid-cols-5">
        <StatusCard d={data} address={address} onSetup={() => setTab("protection")} />
        <BalanceCard d={data} address={address} onAdd={() => setTab("wrap")} />
      </div>
      <Tabs tab={tab} setTab={setTab} />
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === "send" && <SendPanel d={data} address={address} />}
        {tab === "swap" && <SwapPanel d={data} address={address} />}
        {tab === "wrap" && <WrapPanel d={data} />}
        {tab === "protection" && <ProtectionPanel d={data} address={address} />}
        {tab === "backup" && <GuardianPanel me={address} />}
      </div>
    </div>
  );
}

function Tabs({ tab, setTab }: { tab: TabId; setTab: (t: TabId) => void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent, i: number) => {
    const dir = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!dir) return;
    const next = (i + dir + TABS.length) % TABS.length;
    setTab(TABS[next].id);
    refs.current[next]?.focus();
  };
  return (
    <div role="tablist" aria-label="Actions" className={`grid gap-1 rounded-2xl bg-muted p-1 sm:flex ${TABS.length > 4 ? "grid-cols-3" : "grid-cols-2"}`}>
      {TABS.map((t, i) => (
        <button
          key={t.id}
          ref={(el) => {
            refs.current[i] = el;
          }}
          id={`tab-${t.id}`}
          role="tab"
          aria-selected={tab === t.id}
          aria-controls={`panel-${t.id}`}
          tabIndex={tab === t.id ? 0 : -1}
          onClick={() => setTab(t.id)}
          onKeyDown={(e) => onKey(e, i)}
          className={`min-h-11 flex-1 whitespace-nowrap rounded-xl px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
            tab === t.id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function StatusCard({ d, address, onSetup }: { d: ProtectionData; address: Address; onSetup: () => void }) {
  const now = useNow();
  const { run, busy } = useTx();
  const p = { address: PUSDC, abi: pusdcAbi } as const;

  if (!d.protected)
    return (
      <Card className="lg:col-span-3">
        <div className="flex items-start gap-4">
          <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-muted text-muted-foreground">
            <ShieldOff className="size-6" aria-hidden />
          </span>
          <div className="space-y-1">
            <h1 className="text-xl font-bold">Protection is off</h1>
            <p className="text-sm text-muted-foreground">
              Right now your pUSDC works like plain USDC: anyone holding your key could move all of it in one go.
            </p>
          </div>
        </div>
        <Button onClick={onSetup} className="mt-5 w-full sm:w-auto">
          Set up protection <ArrowRight className="size-4" aria-hidden />
        </Button>
        {d.locked > 0n && <LockedNotice d={d} now={now} />}
      </Card>
    );

  const used = d.dailyLimit - d.dailyRemaining;
  // If this browser set up protection but the on-chain backup is one we never chose, someone else holding
  // this key probably front-ran the setup with their own backup.
  const mine = knownBackups(address);
  const hijacked = mine.length > 0 && !mine.includes(d.backup.toLowerCase());
  const changes = Object.entries(d.pendingChanges).filter(([, c]) => c && c.effectiveAt > now);
  const labels = ["Daily limit", "Waiting time for big transfers", "Waiting time to loosen settings", "Emergency lock"];
  const show = (i: number, v: bigint) => (i === 0 ? `${fmtAmount(v)} pUSDC` : fmtDuration(Number(v)));

  return (
    <Card className="space-y-5 lg:col-span-3">
      <div className="flex items-start gap-4">
        <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-primary text-primary-foreground">
          <ShieldCheck className="size-6" aria-hidden />
        </span>
        <div className="space-y-1">
          <h1 className="text-xl font-bold">You're protected</h1>
          <p className="text-sm text-muted-foreground">
            Bigger transfers wait {fmtDuration(d.holdWindow)}, and your backup {shortAddr(d.backup)} can stop them
            {d.fastLane ? " or approve them instantly" : ""}.
          </p>
        </div>
      </div>

      {hijacked && (
        <Notice tone="danger" icon={<ShieldAlert />} title="This backup isn't one you chose">
          <p>
            The backup on record is {shortAddr(d.backup)}, which you never entered here. Someone else may have this wallet's key and set up
            protection first. Don't use the emergency button (it would send funds to their backup) and don't add more funds. Move what you can
            to a brand-new wallet.
          </p>
        </Notice>
      )}

      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-2 text-sm">
          <span className="font-semibold">Instant spending left today</span>
          <span className="tabular">
            <span className="font-bold">{fmtAmount(d.dailyRemaining)}</span>
            <span className="text-muted-foreground"> of {fmtAmount(d.dailyLimit)}</span>
          </span>
        </div>
        <Progress value={d.dailyLimit > 0n ? Number((d.dailyRemaining * 100n) / d.dailyLimit) : 0} label="Daily spending left" />
        <p className="text-xs text-muted-foreground">
          {used > 0n ? "Resets 24 hours after your first payment of the day." : "Your full daily limit is available."} Sending more from
          MetaMask or another app? It's scheduled automatically and arrives after {fmtDuration(d.holdWindow)}. It shows up under your
          scheduled transfers.
        </p>
      </div>

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
    </Card>
  );
}

function LockedNotice({ d, now }: { d: ProtectionData; now: number }) {
  return (
    <div className="mt-4">
      <Notice tone="info" icon={<Lock />} title={`${fmtAmount(d.locked)} pUSDC is locked for safety`}>
        It was moved here by an emergency action and unlocks {fmtDate(d.lockedUntil)} (in {fmtCountdown(d.lockedUntil - now)}). Nobody can
        move it before then, not even you.
      </Notice>
    </div>
  );
}

function BalanceCard({ d, address, onAdd }: { d: ProtectionData; address: Address; onAdd: () => void }) {
  const { run, busy } = useTx();
  const { mutate: watchAsset } = useWatchAsset();
  const rows = [
    { label: "Free to use", value: d.available, show: true },
    { label: "Scheduled to leave", value: d.reserved, show: d.reserved > 0n },
    { label: "Locked for safety", value: d.locked, show: d.locked > 0n },
  ];
  return (
    <Card className="space-y-4 lg:col-span-2">
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground">Your Protected USDC</h2>
        <p className="mt-1 text-4xl font-extrabold tracking-tight tabular">
          {fmtAmount(d.balance)} <span className="text-base font-semibold text-muted-foreground">pUSDC</span>
        </p>
      </div>
      <dl className="space-y-2 text-sm">
        {rows
          .filter((r) => r.show)
          .map((r) => (
            <div key={r.label} className="flex justify-between gap-2">
              <dt className="text-muted-foreground">{r.label}</dt>
              <dd className="font-semibold tabular">{fmtAmount(r.value)}</dd>
            </div>
          ))}
        <div className="flex justify-between gap-2 border-t border-border pt-2">
          <dt className="text-muted-foreground">Plain USDC in wallet</dt>
          <dd className="font-semibold tabular">{fmtAmount(d.usdcBalance)}</dd>
        </div>
      </dl>
      {d.balance === 0n && d.usdcBalance > 0n && (
        <Button onClick={onAdd} className="w-full">
          Start protecting my USDC <ArrowRight className="size-4" aria-hidden />
        </Button>
      )}
      <div className="flex flex-wrap gap-2">
        {IS_TESTNET && (
          <Button
            variant="secondary"
            loading={busy === "faucet"}
            onClick={() => run("faucet", { address: USDC, abi: usdcAbi, functionName: "mint", args: [address, toUnits(10_000)] }, "10,000 test USDC added")}
          >
            <Droplets className="size-4" aria-hidden /> Get 10,000 test USDC
          </Button>
        )}
        <Button
          variant="ghost"
          onClick={() => watchAsset({ type: "ERC20", options: { address: PUSDC, symbol: "pUSDC", decimals: DECIMALS } })}
        >
          <PlusCircle className="size-4" aria-hidden /> Show pUSDC in my wallet
        </Button>
        <Button
          variant="ghost"
          onClick={() => watchAsset({ type: "ERC20", options: { address: USDC, symbol: "USDC", decimals: DECIMALS } })}
        >
          <PlusCircle className="size-4" aria-hidden /> Show {IS_TESTNET ? "test USDC" : "USDC"} in my wallet
        </Button>
      </div>
    </Card>
  );
}

function DashboardSkeleton() {
  const anon = useAnonStatus();
  return (
    <div className="space-y-6 pt-4" aria-busy="true" aria-label="Loading your account">
      {anon === "connecting" && (
        <p className="text-center text-sm text-muted-foreground" role="status">
          Connecting privately through the Nox mixnet. The first load takes about 15 seconds.
        </p>
      )}
      <div className="grid gap-6 lg:grid-cols-5">
        <Skeleton className="h-56 lg:col-span-3" />
        <Skeleton className="h-56 lg:col-span-2" />
      </div>
      <Skeleton className="h-12" />
      <Skeleton className="h-72" />
    </div>
  );
}
