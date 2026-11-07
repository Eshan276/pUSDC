import { useEffect, useRef, useState } from "react";
import { decodeEventLog, formatUnits } from "viem";
import { useConnection, useSwitchChain } from "wagmi";
import { ArrowDown, CalendarClock, Check, ChevronDown, Info, Settings2, Zap } from "lucide-react";
import { pusdcAbi, schedulerAbi, usdcAbi } from "../abi";
import { CHAIN, DECIMALS, POOL_KEY, PUSDC, SCHEDULER, USDC } from "../config";
import { fmtAmount, fmtDate, fmtDuration, fmtUsd, parseAmount } from "../lib/format";
import type { ProtectionData } from "../lib/useProtection";
import { useTx } from "../lib/useTx";
import { ConnectButton } from "../App";
import { Button, Card, Notice } from "./ui";
import { Mark } from "./Mark";
import { PendingList, RouteNotice, route } from "./Panels";

const SWAP_ENABLED = SCHEDULER !== "0x0000000000000000000000000000000000000000";
const SLIPPAGES = [0.5, 1, 3];
type TokenId = "pUSDC" | "USDC";
const NAMES: Record<TokenId, string> = { pUSDC: "Protected USDC", USDC: "USD Coin" };

function TokenLogo({ id, className = "size-7" }: { id: TokenId; className?: string }) {
  if (id === "pUSDC") return <Mark className={className} />;
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <circle cx="16" cy="16" r="16" fill="#2775ca" />
      <text x="16" y="21.5" textAnchor="middle" fontSize="17" fontWeight="600" fill="#fff" fontFamily="DM Sans Variable, sans-serif">$</text>
    </svg>
  );
}

/** The token picker pill: shows the token and opens a small list, like an exchange's token selector. */
function TokenPill({ value, onPick, balances }: { value: TokenId; onPick: (t: TokenId) => void; balances?: Record<TokenId, bigint> }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => (document.removeEventListener("mousedown", away), document.removeEventListener("keydown", esc));
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Select token, currently ${value}`}
        className="flex items-center gap-2 rounded-full bg-card py-1.5 pl-1.5 pr-3 text-lg font-semibold shadow-sm ring-1 ring-border transition-colors hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <TokenLogo id={value} /> {value} <ChevronDown className="size-4 text-muted-foreground" aria-hidden />
      </button>
      {open && (
        <ul role="listbox" aria-label="Tokens" className="absolute right-0 z-20 mt-2 w-64 overflow-hidden rounded-2xl border border-border bg-card p-1 shadow-xl">
          {(["pUSDC", "USDC"] as const).map((t) => (
            <li key={t} role="option" aria-selected={t === value}>
              <button type="button" onClick={() => (onPick(t), setOpen(false))} className="flex w-full items-center gap-3 rounded-xl p-3 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                <TokenLogo id={t} className="size-9" />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{t}</span>
                  <span className="block text-sm text-muted-foreground">{NAMES[t]}</span>
                </span>
                {balances && <span className="text-sm tabular text-muted-foreground">{fmtAmount(balances[t])}</span>}
                {t === value && <Check className="size-4 text-primary" aria-hidden />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Box({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-muted p-4 transition-colors focus-within:bg-primary-soft/60">
      <p className="text-sm font-medium text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}

/**
 * The exchange-style swap card. USDC -> pUSDC wraps 1:1 (approve first if needed). pUSDC -> USDC unwraps 1:1, or, for a
 * protected account that wants a real Uniswap v4 trade, schedules it to run after the hold. Works before connecting too.
 */
export function SwapCard({ d }: { d?: ProtectionData }) {
  const { isConnected, chainId } = useConnection();
  const { mutate: switchChain, isPending: switching } = useSwitchChain();
  const { run, busy } = useTx();
  const [pay, setPay] = useState<TokenId>("USDC");
  const [amt, setAmt] = useState("");
  const [settings, setSettings] = useState(false);
  const [useV4, setUseV4] = useState(false);
  const [slip, setSlip] = useState(1);
  const receive: TokenId = pay === "USDC" ? "pUSDC" : "USDC";
  const wrongChain = isConnected && chainId !== CHAIN.id;
  const amount = parseAmount(amt);
  const balance = d ? (pay === "USDC" ? d.usdcBalance : d.available) : 0n;
  const balances = d ? { pUSDC: d.available, USDC: d.usdcBalance } : undefined;
  const v4 = pay === "pUSDC" && useV4 && SWAP_ENABLED && !!d?.protected;
  const minOut = amount && v4 ? (amount * BigInt(Math.round((100 - slip) * 100))) / 10000n : amount ?? 0n;
  const r = d && pay === "pUSDC" && !v4 ? route(d, amount) : undefined;
  const needsApproval = !!d && pay === "USDC" && !!amount && d.usdcAllowance < amount;

  const flip = () => { setPay(receive); setAmt(""); };
  const pick = (t: TokenId) => (t === pay ? undefined : flip());

  let label = "Swap";
  let disabled = false;
  let busyKey: string | null = null;
  if (!d) { label = "Loading…"; disabled = true; }
  else if (!amount) { label = "Enter an amount"; disabled = true; }
  else if (amount > balance) { label = `Insufficient ${pay} balance`; disabled = true; }
  else if (pay === "USDC" && needsApproval) { label = "Approve USDC"; busyKey = "approve"; }
  else if (pay === "USDC") { label = "Swap"; busyKey = "wrap"; }
  else if (v4) { label = "Schedule swap"; busyKey = "q"; }
  else if (r?.kind === "scheduled") { label = "Schedule withdrawal"; busyKey = "unwrap"; }
  else { label = "Swap"; busyKey = "unwrap"; }

  async function submit() {
    if (!d || !amount || disabled) return;
    if (pay === "USDC") {
      if (needsApproval) { await run("approve", { address: USDC, abi: usdcAbi, functionName: "approve", args: [PUSDC, amount] }, "USDC approved. Now swap."); return; }
      if (await run("wrap", { address: PUSDC, abi: pusdcAbi, functionName: "deposit", args: [amount] }, `Swapped ${fmtAmount(amount)} USDC for ${fmtAmount(amount)} pUSDC`)) setAmt("");
      return;
    }
    if (v4) {
      const receipt = await run("q", { address: PUSDC, abi: pusdcAbi, functionName: "queueTransfer", args: [SCHEDULER, amount] }, "Step 1 of 2 done: funds set aside");
      if (!receipt) return;
      let id: bigint | undefined;
      for (const log of receipt.logs) {
        try { const ev = decodeEventLog({ abi: pusdcAbi, data: log.data, topics: log.topics }); if (ev.eventName === "TransferQueued") id = ev.args.id; } catch { /* not ours */ }
      }
      if (id === undefined) return;
      const ok = await run("reg", { address: SCHEDULER, abi: schedulerAbi, functionName: "register", args: [id, POOL_KEY, minOut] }, `Swap scheduled for ${fmtDate(Math.floor(Date.now() / 1000) + d.holdWindow)}`);
      if (ok) setAmt("");
      return;
    }
    const ok = r?.kind === "scheduled"
      ? await run("unwrap", { address: PUSDC, abi: pusdcAbi, functionName: "queueTransfer", args: [PUSDC, amount] }, "Withdrawal scheduled")
      : await run("unwrap", { address: PUSDC, abi: pusdcAbi, functionName: "withdraw", args: [amount] }, `Swapped ${fmtAmount(amount)} pUSDC for ${fmtAmount(amount)} USDC`);
    if (ok) setAmt("");
  }

  const swaps = d?.pending.filter((t) => t.to.toLowerCase() === SCHEDULER.toLowerCase()) ?? [];
  const showDetails = !!d && !!amount && amount <= balance;

  return (
    <div className="space-y-4">
      <Card className="!p-3 sm:!p-4">
        <div className="mb-3 flex items-center justify-between px-1">
          <h1 className="text-xl">Swap</h1>
          <button
            type="button"
            onClick={() => setSettings(!settings)}
            aria-expanded={settings}
            aria-label="Swap settings"
            className={`grid size-9 place-items-center rounded-full transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${settings ? "bg-primary-soft text-primary" : "text-muted-foreground"}`}
          >
            <Settings2 className="size-5" aria-hidden />
          </button>
        </div>

        {settings && (
          <div className="mb-3 space-y-3 rounded-2xl border border-border p-4 text-sm">
            <div>
              <p className="font-medium">Route for pUSDC → USDC</p>
              <div role="radiogroup" aria-label="Route" className="mt-2 grid grid-cols-2 gap-1 rounded-xl bg-muted p-1">
                {[{ v: false, t: "Unwrap 1:1" }, { v: true, t: "Uniswap v4" }].map((o) => (
                  <button key={o.t} role="radio" aria-checked={useV4 === o.v} disabled={o.v && !SWAP_ENABLED} onClick={() => setUseV4(o.v)}
                    className={`min-h-10 rounded-lg font-semibold disabled:opacity-50 ${useV4 === o.v ? "bg-card shadow-sm" : "text-muted-foreground"}`}>{o.t}</button>
                ))}
              </div>
              <p className="mt-2 text-muted-foreground">{useV4 ? "A real trade in the Uniswap v4 pool. It is scheduled and runs after your wait; the USDC always comes back to this wallet." : "Exact 1:1 straight from the contract. No price impact, no fees."}</p>
            </div>
            {useV4 && (
              <div>
                <p className="font-medium">Max price drop while waiting</p>
                <div role="radiogroup" aria-label="Slippage" className="mt-2 flex gap-1">
                  {SLIPPAGES.map((s) => (
                    <button key={s} role="radio" aria-checked={slip === s} onClick={() => setSlip(s)} className={`min-h-10 flex-1 rounded-lg text-sm font-semibold ${slip === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>{s}%</button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="relative space-y-1">
          <Box label="You pay">
            <div className="mt-1 flex items-center gap-3">
              <input
                aria-label="Amount to pay"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0"
                value={amt}
                onChange={(e) => setAmt(e.target.value.replace(/[^0-9.,]/g, ""))}
                className="min-w-0 flex-1 bg-transparent text-4xl font-medium tabular outline-none placeholder:text-muted-foreground/40"
              />
              <TokenPill value={pay} onPick={pick} balances={balances} />
            </div>
            <div className="mt-2 flex items-center justify-between text-sm text-muted-foreground">
              <span className="tabular">{amount ? fmtUsd(amount) : "$0.00"}</span>
              <span className="flex items-center gap-2">
                {d ? <>Balance: <span className="tabular">{fmtAmount(balance)}</span></> : "Connect to see your balance"}
                {d && balance > 0n && (
                  <button type="button" onClick={() => setAmt(formatUnits(balance, DECIMALS))} className="rounded-md bg-primary-soft px-2 py-0.5 text-xs font-bold text-primary-soft-foreground hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">MAX</button>
                )}
              </span>
            </div>
          </Box>

          <button
            type="button"
            onClick={flip}
            aria-label="Switch tokens"
            className="absolute left-1/2 top-1/2 z-10 grid size-10 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-xl border-4 border-card bg-muted text-foreground transition-transform hover:rotate-180 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowDown className="size-5" aria-hidden />
          </button>

          <Box label={v4 ? "You receive (at least)" : "You receive"}>
            <div className="mt-1 flex items-center gap-3">
              <output aria-label="Amount to receive" className={`min-w-0 flex-1 truncate text-4xl font-medium tabular ${amount ? "" : "text-muted-foreground/40"}`}>
                {amount ? formatUnits(minOut, DECIMALS) : "0"}
              </output>
              <TokenPill value={receive} onPick={(t) => t === receive && flip()} balances={balances} />
            </div>
            <div className="mt-2 flex items-center justify-between text-sm text-muted-foreground">
              <span className="tabular">{amount ? fmtUsd(minOut) : "$0.00"}</span>
              {d && <span>Balance: <span className="tabular">{fmtAmount(receive === "USDC" ? d.usdcBalance : d.available)}</span></span>}
            </div>
          </Box>
        </div>

        {showDetails && (
          <dl className="mt-3 space-y-1.5 rounded-2xl border border-border px-4 py-3 text-sm">
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Rate</dt><dd className="font-medium tabular">1 {pay} = 1 {receive}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Route</dt><dd className="font-medium">{v4 ? "Uniswap v4 pool, scheduled" : pay === "USDC" ? "Wrap, held 1:1 in the contract" : "Unwrap, straight from the contract"}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Fee</dt><dd className="font-medium">{v4 ? "Pool fee 0.05%" : "None"}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Arrives</dt><dd className="font-medium">{v4 || r?.kind === "scheduled" ? `After ${fmtDuration(d!.holdWindow)}` : "Instantly"}</dd></div>
          </dl>
        )}

        <div className="mt-3">
          {!isConnected ? (
            <ConnectButton className="min-h-14 w-full text-lg" label="Connect wallet" />
          ) : wrongChain ? (
            <Button className="min-h-14 w-full text-lg" onClick={() => switchChain({ chainId: CHAIN.id })} loading={switching}>Switch to {CHAIN.name}</Button>
          ) : (
            <Button className="min-h-14 w-full text-lg" onClick={submit} disabled={disabled} loading={!!busyKey && (busy === busyKey || (busyKey === "q" && busy === "reg"))}
              variant={disabled ? "secondary" : "primary"}>
              {busy === "q" ? "Step 1 of 2: setting funds aside…" : busy === "reg" ? "Step 2 of 2: attaching swap terms…" : label}
            </Button>
          )}
        </div>
      </Card>

      {d && amount && amount <= balance && pay === "pUSDC" && !v4 && r && <RouteNotice r={r} d={d} verb="Swap" />}
      {v4 && <Notice tone="warning" icon={<CalendarClock />} title={`Runs after ${fmtDuration(d!.holdWindow)}`}>Two quick confirmations: first set the pUSDC aside, then attach the swap terms so your backup can review them. If the price drops more than {slip}% by then, the swap won't run and your pUSDC stays yours.</Notice>}
      {pay === "pUSDC" && useV4 && d && !d.protected && <Notice tone="info" icon={<Zap />}>Protection is off, so there's nothing to schedule. Swap 1:1 here, or trade instantly in any Uniswap app.</Notice>}
      {pay === "USDC" && !!d && <p className="flex items-start gap-2 px-2 text-sm text-muted-foreground"><Info className="mt-0.5 size-4 shrink-0" aria-hidden /> Every pUSDC is backed 1:1 by a USDC held in the contract. Swapping in is instant and free.</p>}

      {d && d.pending.length > 0 && <PendingList title={swaps.length ? "Pending swaps and transfers" : "Pending transfers"} transfers={d.pending} loading={d.pendingLoading} role="owner" fastLane={d.fastLane} />}
    </div>
  );
}
