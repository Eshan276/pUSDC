import { useState } from "react";
import { decodeEventLog, formatUnits, type Address } from "viem";
import { ArrowDownUp, CalendarClock, Zap } from "lucide-react";
import { pusdcAbi, schedulerAbi } from "../abi";
import { DECIMALS, POOL_KEY, PUSDC, SCHEDULER } from "../config";
import { fmtAmount, fmtDate, fmtDuration, parseAmount } from "../lib/format";
import type { ProtectionData } from "../lib/useProtection";
import { useTx } from "../lib/useTx";
import { Button, Card, Field, Notice, inputClass } from "./ui";
import { PendingList } from "./Panels";

const SLIPPAGES = [0.5, 1, 3];

/**
 * Big swaps without switching protection off: schedule a transfer to ScheduledSwap, attach the swap terms,
 * and after the hold anyone completes it on Uniswap v4. The output always goes back to this wallet.
 */
export function SwapPanel({ d }: { d: ProtectionData; address: Address }) {
  const { run, busy } = useTx();
  const [amt, setAmt] = useState("");
  const [slip, setSlip] = useState(1);
  const amount = parseAmount(amt);
  const minOut = amount ? (amount * BigInt(Math.round((100 - slip) * 100))) / 10000n : 0n;
  const err = amt && !amount ? "Enter a valid amount." : amount && amount > d.available ? `Only ${fmtAmount(d.available)} pUSDC is free to swap.` : undefined;
  const swaps = d.pending.filter((t) => t.to.toLowerCase() === SCHEDULER.toLowerCase());

  async function schedule() {
    if (!amount || err) return;
    const receipt = await run("q", { address: PUSDC, abi: pusdcAbi, functionName: "queueTransfer", args: [SCHEDULER, amount] }, "Step 1 of 2 done: funds set aside");
    if (!receipt) return;
    // Read the new transfer's id from its TransferQueued event.
    let id: bigint | undefined;
    for (const log of receipt.logs) {
      try {
        const ev = decodeEventLog({ abi: pusdcAbi, data: log.data, topics: log.topics });
        if (ev.eventName === "TransferQueued") id = ev.args.id;
      } catch {
        /* not ours */
      }
    }
    if (id === undefined) return;
    const ok = await run("reg", { address: SCHEDULER, abi: schedulerAbi, functionName: "register", args: [id, POOL_KEY, minOut] }, `Swap scheduled for ${fmtDate(Math.floor(Date.now() / 1000) + d.holdWindow)}`);
    if (ok) setAmt("");
  }

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <Card className="space-y-5 lg:col-span-3">
        <div>
          <h2 className="text-lg font-bold">Swap pUSDC → USDC on Uniswap</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Small swaps work in any app. For a big one, schedule it here: it runs on Uniswap v4 after your {fmtDuration(d.holdWindow)} wait, and
            the USDC always comes back to this wallet. If it wasn't you, cancel it, or your backup can.
          </p>
        </div>
        <Field label="pUSDC to swap" htmlFor="swap-amount" error={err} hint={`Free to swap: ${fmtAmount(d.available)}`}>
          <div className="relative">
            <input id="swap-amount" inputMode="decimal" autoComplete="off" placeholder="0.00" value={amt} onChange={(e) => setAmt(e.target.value)} className={`${inputClass} pr-20 text-lg font-semibold tabular`} />
            <button type="button" onClick={() => setAmt(formatUnits(d.available, DECIMALS))} className="absolute inset-y-1.5 right-1.5 rounded-lg px-3 text-xs font-bold text-primary hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              MAX
            </button>
          </div>
        </Field>
        <div className="flex items-center justify-center text-muted-foreground" aria-hidden>
          <ArrowDownUp className="size-5" />
        </div>
        <div className="rounded-lg bg-muted p-4 text-sm">
          <p className="flex justify-between gap-2">
            <span className="text-muted-foreground">You'll get at least</span>
            <span className="font-bold tabular">{fmtAmount(minOut)} USDC</span>
          </p>
          <div className="mt-3 flex items-center justify-between gap-2">
            <span id="slip-label" className="text-muted-foreground">Max price drop while waiting</span>
            <div role="radiogroup" aria-labelledby="slip-label" className="flex gap-1">
              {SLIPPAGES.map((s) => (
                <button key={s} role="radio" aria-checked={slip === s} onClick={() => setSlip(s)} className={`min-h-10 rounded-lg px-3 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${slip === s ? "bg-card shadow-sm" : "text-muted-foreground"}`}>
                  {s}%
                </button>
              ))}
            </div>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">If the price moves more than this by then, the swap simply won't run and your pUSDC stays yours.</p>
        </div>
        <Notice tone="warning" icon={<CalendarClock />} title={`Runs after ${fmtDuration(d.holdWindow)}${d.fastLane ? ", or as soon as your backup approves" : ""}`}>
          Two quick confirmations: first set the pUSDC aside, then attach the swap terms (pool and minimum output) so your backup can review them.
        </Notice>
        <Button className="w-full" onClick={schedule} disabled={!amount || !!err} loading={busy === "q" || busy === "reg"}>
          {busy === "q" ? "Step 1 of 2: setting funds aside…" : busy === "reg" ? "Step 2 of 2: attaching swap terms…" : "Schedule swap"}
        </Button>
        {!d.protected && (
          <Notice tone="info" icon={<Zap />}>
            Protection is off, so you could also swap instantly in any Uniswap app.
          </Notice>
        )}
      </Card>
      <div className="lg:col-span-2">
        <PendingList title="Your scheduled swaps" transfers={swaps} loading={d.pendingLoading} role="owner" fastLane={d.fastLane} emptyText="Swaps you schedule wait here until they can run." />
      </div>
    </div>
  );
}
