import { useState, type ReactNode } from "react";
import { ArrowDownLeft, ArrowUpRight, Check, ChevronDown, ChevronRight, Copy, ExternalLink, Pencil, Plus, ShieldCheck, ShieldOff, Zap } from "lucide-react";
import type { Address } from "viem";
import { Button, Card, Progress } from "@ui/ui";
import { Mark } from "@ui/Mark";
import { useToast } from "@ui/toast";
import { fmtAmount, fmtEth, fmtUsd, shortAddr } from "../shared/format";
import { EXPLORER, PUSDC } from "../shared/chain";
import { isZero, type ActivityItem } from "../shared/activity";
import type { Protection } from "../shared/read";
import type { WalletState } from "../shared/messages";
import { call } from "./api";

/** Same wallet look as the web app: account row, one big balance, round actions, asset list, settings-style rows. */

export function Avatar({ address, className = "size-10" }: { address: string; className?: string }) {
  // A repeatable blue-ish gradient from the address, so each account looks like itself.
  const n = parseInt(address.slice(2, 10), 16);
  const h1 = 190 + (n % 70), h2 = 200 + ((n >> 8) % 70);
  return <span aria-hidden className={`${className} shrink-0 rounded-full`} style={{ background: `linear-gradient(135deg, hsl(${h1} 78% 52%), hsl(${h2} 72% 32%))` }} />;
}

function CopyAddress({ address }: { address: Address }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => navigator.clipboard.writeText(address).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); toast.show({ kind: "success", title: "Address copied" }); })}
      className="grid size-9 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label="Copy your address"
    >
      {copied ? <Check className="size-4 text-primary" aria-hidden /> : <Copy className="size-4" aria-hidden />}
    </button>
  );
}

/** Used where there is only an address (the decoy wallet). */
export function AccountBar({ address }: { address: Address }) {
  return (
    <div className="flex items-center gap-3">
      <Avatar address={address} />
      <div className="min-w-0 flex-1">
        <p className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">Account 1</p>
        <p className="font-mono text-sm font-medium">{shortAddr(address)}</p>
      </div>
      <CopyAddress address={address} />
    </div>
  );
}

/** The active account, with a list to switch, rename or add accounts (all derived from the same recovery phrase). */
export function AccountSwitcher({ state, refresh }: { state: WalletState; refresh: () => void }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [err, setErr] = useState<string>();
  const me = state.accounts.find((a) => a.index === state.selected) ?? state.accounts[0];
  if (!me) return null;

  const act = async (fn: () => Promise<unknown>) => {
    setErr(undefined);
    try { await fn(); refresh(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  };

  return (
    <div className="relative" onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
      <div className="flex items-center gap-2">
        <button
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-label="Switch account"
          className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl p-1 pr-2 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Avatar address={me.address} />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1 text-sm font-semibold"><span className="truncate">{me.name}</span><ChevronDown className={`size-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} aria-hidden /></span>
            <span className="block font-mono text-xs text-muted-foreground">{shortAddr(me.address)}</span>
          </span>
        </button>
        <CopyAddress address={me.address} />
      </div>

      {open && (
        <div className="absolute inset-x-0 top-full z-30 mt-2 space-y-1 rounded-2xl border border-border bg-card p-2 shadow-[0_16px_40px_-12px_rgb(18_70_160/0.3)]" role="menu" aria-label="Accounts">
          {state.accounts.map((a) => (
            <div key={a.index} className={`flex items-center gap-2 rounded-xl p-2 ${a.index === state.selected ? "bg-primary-soft" : "hover:bg-muted"}`}>
              {editing === a.index ? (
                <form className="flex min-w-0 flex-1 items-center gap-2" onSubmit={(e) => { e.preventDefault(); void act(async () => { await call({ t: "renameAccount", index: a.index, name }); setEditing(null); }); }}>
                  <Avatar address={a.address} className="size-8" />
                  <input aria-label="Account name" autoFocus maxLength={24} value={name} onChange={(e) => setName(e.target.value)} className="min-h-9 min-w-0 flex-1 rounded-lg border border-border bg-background px-2 text-sm" />
                  <Button type="submit" className="min-h-9 px-3 text-xs">Save</Button>
                </form>
              ) : (
                <>
                  <button role="menuitem" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => void act(async () => { await call({ t: "selectAccount", index: a.index }); setOpen(false); })}>
                    <Avatar address={a.address} className="size-8" />
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{a.name}</span><span className="block font-mono text-[11px] text-muted-foreground">{shortAddr(a.address)}</span></span>
                    {a.index === state.selected && <Check className="size-4 shrink-0 text-primary" aria-label="Selected" />}
                  </button>
                  <button aria-label={`Rename ${a.name}`} onClick={() => { setEditing(a.index); setName(a.name); }} className="grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-card"><Pencil className="size-3.5" aria-hidden /></button>
                </>
              )}
            </div>
          ))}
          <Button variant="secondary" className="w-full" disabled={state.accounts.length >= 10} onClick={() => void act(async () => { await call({ t: "addAccount" }); setOpen(false); })}>
            <Plus className="size-4" aria-hidden /> Add account
          </Button>
          {err && <p className="px-2 text-xs text-danger-soft-foreground" role="alert">{err}</p>}
        </div>
      )}
    </div>
  );
}

export const LOW_ETH = 200_000_000_000_000n; // 0.0002 ETH: roughly a handful of actions on Base

export function BalanceHero({ data, onProtect, onSettings }: { data: Protection; onProtect: () => void; onSettings: () => void }) {
  const chips = [
    { label: "Free", value: data.available, show: true },
    { label: "Scheduled", value: data.reserved, show: data.reserved > 0n },
    { label: "Locked", value: data.locked, show: data.locked > 0n },
  ].filter((c) => c.show);
  const low = data.eth < LOW_ETH;
  return (
    <Card className="space-y-3 !p-5">
      <div>
        <p className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">Total balance</p>
        <p className="mt-1 text-[2.2rem] font-light leading-none tracking-tight tabular">{fmtUsd(data.balance)}</p>
        <p className="mt-2 font-mono text-xs text-muted-foreground tabular">{fmtAmount(data.balance)} pUSDC</p>
        {data.balance === 0n && <p className="mt-2 text-sm text-muted-foreground">You don't have any pUSDC yet. Use "Add or take out money" below.</p>}
      </div>
      {chips.length > 1 && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-muted-foreground">
          {chips.map((c) => <li key={c.label}>{c.label} <b className="font-semibold text-foreground tabular">{fmtAmount(c.value)}</b></li>)}
        </ul>
      )}
      <p className="flex items-center justify-between gap-2 font-mono text-xs">
        <span className="text-muted-foreground">ETH for network fees</span>
        <b className={`font-semibold ${low ? "text-warning-foreground" : ""}`}>{fmtEth(data.eth)} ETH{low ? " · low" : ""}</b>
      </p>
      {data.protected ? (
        <button onClick={onSettings} className="block w-full space-y-2 rounded-lg bg-primary-soft p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <span className="flex items-center justify-between gap-2 text-sm font-medium text-primary-soft-foreground">
            <span className="flex items-center gap-1.5"><ShieldCheck className="size-4" aria-hidden /> You're protected</span>
            <span className="font-mono text-[11px] tabular"><b>{fmtAmount(data.dailyRemaining)}</b> of {fmtAmount(data.dailyLimit)} left today</span>
          </span>
          <Progress value={data.dailyLimit > 0n ? Number((data.dailyRemaining * 100n) / data.dailyLimit) : 0} label="Daily spending left" />
        </button>
      ) : (
        <div className="flex items-center justify-between gap-3 rounded-lg bg-warning-soft p-3">
          <span className="flex items-center gap-2 text-sm font-medium text-warning-foreground"><ShieldOff className="size-4 shrink-0" aria-hidden /> Protection is off</span>
          <Button onClick={onProtect} className="min-h-9 shrink-0 text-xs">Set up protection</Button>
        </div>
      )}
    </Card>
  );
}

export function ActionRow({ actions }: { actions: { label: string; icon: typeof Copy; onClick: () => void; badge?: number }[] }) {
  return (
    <div className={`grid gap-1`} style={{ gridTemplateColumns: `repeat(${actions.length}, minmax(0, 1fr))` }} role="group" aria-label="Actions">
      {actions.map(({ label, icon: Icon, onClick, badge }) => (
        <button key={label} onClick={onClick} className="group relative flex flex-col items-center gap-1.5 rounded-xl py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <span className="relative grid size-12 place-items-center rounded-full bg-primary text-primary-foreground transition-all group-hover:brightness-95 group-active:scale-95">
            <Icon className="size-5" aria-hidden />
            {!!badge && <span className="absolute -right-1 -top-1 grid size-4 place-items-center rounded-full bg-warning-foreground text-[10px] text-warning-soft">{badge}</span>}
          </span>
          <span className="font-mono text-[11px]">{label}</span>
        </button>
      ))}
    </div>
  );
}

export function Assets({ data, onProtectUsdc }: { data: Protection; onProtectUsdc: () => void }) {
  return (
    <section aria-label="Assets">
      <h2 className="mb-2 px-1 font-mono text-[11px] font-normal uppercase tracking-wide text-muted-foreground">Assets</h2>
      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        <li className="flex items-center gap-3 p-3">
          <Mark className="size-9 shrink-0" />
          <div className="min-w-0 flex-1"><p className="text-sm font-medium">Protected USDC</p><p className="font-mono text-[11px] text-muted-foreground">pUSDC · protected</p></div>
          <div className="text-right"><p className="text-sm font-medium tabular">{fmtUsd(data.balance)}</p><p className="font-mono text-[11px] text-muted-foreground tabular">{fmtAmount(data.balance)}</p></div>
        </li>
        <li className="flex items-center gap-3 p-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted font-mono text-sm font-semibold text-muted-foreground" aria-hidden>$</span>
          <div className="min-w-0 flex-1"><p className="text-sm font-medium">USD Coin</p><p className="font-mono text-[11px] text-muted-foreground">USDC · not protected</p></div>
          <div className="text-right">
            <p className="text-sm font-medium tabular">{fmtUsd(data.usdcBalance)}</p>
            {data.usdcBalance > 0n ? <button onClick={onProtectUsdc} className="font-mono text-[11px] font-medium text-primary hover:underline">Protect it</button> : <p className="font-mono text-[11px] text-muted-foreground tabular">{fmtAmount(data.usdcBalance)}</p>}
          </div>
        </li>
        <li className="flex items-center gap-3 p-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[#eef0fb] text-[#4a5fc1]" aria-hidden><Zap className="size-4" /></span>
          <div className="min-w-0 flex-1"><p className="text-sm font-medium">Ether</p><p className="font-mono text-[11px] text-muted-foreground">ETH · pays network fees</p></div>
          <div className="text-right"><p className="text-sm font-medium tabular">{fmtEth(data.eth)} ETH</p></div>
        </li>
      </ul>
    </section>
  );
}

/** "Network fee ≈ 0.000012 ETH" (or a quiet placeholder while it's being worked out). */
export function FeeLine({ fee }: { fee: bigint | undefined }) {
  return (
    <p className="flex items-center justify-between font-mono text-xs text-muted-foreground" data-testid="fee">
      <span>Network fee</span>
      <span>{fee === undefined ? "–" : `≈ ${fmtEth(fee)} ETH`}</span>
    </p>
  );
}

function ago(t: number) {
  if (!t) return "";
  const s = Math.max(0, Math.floor(Date.now() / 1000) - t);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(t * 1000).toLocaleDateString();
}

/** Plain words for a transfer: wraps, unwraps and test mints read as what they are, not as sends to a contract. */
function describe(item: ActivityItem): { headline: string; sub: string } {
  if (item.amount === undefined) return { headline: item.title ?? "Transaction", sub: "" };
  const amt = fmtAmount(item.amount);
  const out = item.dir === "out";
  const fromZero = !out && isZero(item.other);
  const toZero = out && isZero(item.other);
  const withToken = item.other?.toLowerCase() === PUSDC.toLowerCase();
  if (item.token === "pUSDC" && fromZero) return { headline: `Added ${amt} pUSDC`, sub: "Wrapped from USDC, 1:1" };
  if (item.token === "pUSDC" && toZero) return { headline: `Withdrew ${amt} pUSDC`, sub: "Unwrapped to USDC, 1:1" };
  if (item.token === "USDC" && out && withToken) return { headline: `Wrapped ${amt} USDC`, sub: "Into protected pUSDC" };
  if (item.token === "USDC" && !out && withToken) return { headline: `Unwrapped ${amt} USDC`, sub: "From protected pUSDC" };
  if (fromZero) return { headline: `Received ${amt} ${item.token}`, sub: "Minted (test faucet)" };
  return { headline: `${out ? "Sent" : "Received"} ${amt} ${item.token}`, sub: `${out ? "To" : "From"} ${item.other ? shortAddr(item.other) : ""}` };
}

export function ActivityRow({ item }: { item: ActivityItem }) {
  const out = item.dir === "out";
  const { headline, sub } = describe(item);
  return (
    <li>
      <a href={`${EXPLORER}/tx/${item.hash}`} target="_blank" rel="noreferrer" className="flex items-center gap-3 p-3 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" data-testid="activity-row" data-dir={item.dir}>
        <span className={`grid size-9 shrink-0 place-items-center rounded-full ${item.dir === "other" ? "bg-muted text-muted-foreground" : out ? "bg-muted text-foreground" : "bg-primary-soft text-primary-soft-foreground"}`}>
          {item.dir === "other" ? <Check className="size-4" aria-hidden /> : out ? <ArrowUpRight className="size-4" aria-hidden /> : <ArrowDownLeft className="size-4" aria-hidden />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{headline}</span>
          <span className="block truncate font-mono text-[11px] text-muted-foreground">{sub || (item.time ? ago(item.time) : "")}</span>
        </span>
        <span className="shrink-0 text-right font-mono text-[11px] text-muted-foreground">{item.time ? ago(item.time) : ""}<ExternalLink className="ml-auto mt-1 size-3" aria-hidden /></span>
      </a>
    </li>
  );
}

export function SettingsRow({ icon: Icon, title, sub, onClick, children }: { icon: typeof Copy; title: string; sub: string; onClick: () => void; children?: ReactNode }) {
  return (
    <li>
      <button onClick={onClick} className="flex w-full items-center gap-3 p-3 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary-soft-foreground"><Icon className="size-4" aria-hidden /></span>
        <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{title}</span><span className="block truncate text-xs text-muted-foreground">{sub}</span></span>
        {children ?? <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
      </button>
    </li>
  );
}
