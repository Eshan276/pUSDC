import { useState, type ReactNode } from "react";
import { Check, ChevronRight, Copy, ShieldCheck, ShieldOff } from "lucide-react";
import type { Address } from "viem";
import { Button, Card, Progress } from "@ui/ui";
import { Mark } from "@ui/Mark";
import { useToast } from "@ui/toast";
import { fmtAmount, fmtEth, fmtUsd, shortAddr } from "../shared/format";
import type { Protection } from "../shared/read";

/** Same wallet look as the web app: account row, one big balance, round actions, asset list, settings-style rows. */

export function Avatar({ address, className = "size-10" }: { address: string; className?: string }) {
  // A repeatable blue-ish gradient from the address, so each account looks like itself.
  const n = parseInt(address.slice(2, 10), 16);
  const h1 = 190 + (n % 70), h2 = 200 + ((n >> 8) % 70);
  return <span aria-hidden className={`${className} shrink-0 rounded-full`} style={{ background: `linear-gradient(135deg, hsl(${h1} 78% 52%), hsl(${h2} 72% 32%))` }} />;
}

export function AccountBar({ address }: { address: Address }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-3">
      <Avatar address={address} />
      <div className="min-w-0 flex-1">
        <p className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">Account</p>
        <button
          onClick={() => navigator.clipboard.writeText(address).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); toast.show({ kind: "success", title: "Address copied" }); })}
          className="flex items-center gap-1.5 rounded font-mono text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Copy your address"
        >
          {shortAddr(address)} {copied ? <Check className="size-3.5 text-primary" aria-hidden /> : <Copy className="size-3.5 text-muted-foreground" aria-hidden />}
        </button>
      </div>
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
          <span className="relative grid size-12 place-items-center rounded-full bg-ink text-white transition-colors group-hover:bg-ink-hover group-active:scale-95">
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
      </ul>
    </section>
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
