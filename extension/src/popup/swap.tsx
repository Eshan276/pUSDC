import { useEffect, useState } from "react";
import { decodeEventLog, encodeFunctionData, formatUnits } from "viem";
import { ArrowDown, ArrowLeft, CalendarClock, Clock } from "lucide-react";
import { pusdcAbi, schedulerAbi, usdcAbi } from "@abi";
import { Button, Card, Notice } from "@ui/ui";
import { Mark } from "@ui/Mark";
import { DECIMALS, PUSDC, SCHEDULER, USDC, poolKey } from "../shared/chain";
import { estimateFee } from "../shared/fee";
import { fmtAmount, fmtDuration, parseAmount } from "../shared/format";
import type { Protection } from "../shared/read";
import { FeeLine } from "./wallet";
import type { useSend } from "./useSend";

type Tok = "USDC" | "pUSDC";
type Route = "oneToOne" | "v4";
const SLIPPAGES = [0.5, 1, 3];
const V4_ENABLED = SCHEDULER !== "0x0000000000000000000000000000000000000000";

function TokenPill({ tok }: { tok: Tok }) {
  return (
    <span className="flex shrink-0 items-center gap-2 rounded-full bg-card py-1.5 pl-1.5 pr-3 text-sm font-semibold shadow-sm">
      {tok === "pUSDC" ? <Mark className="size-6" /> : <span className="grid size-6 place-items-center rounded-full bg-[#2775ca] text-[11px] font-bold text-white" aria-hidden>$</span>}
      {tok}
    </span>
  );
}

/** A Uniswap-style swap card. USDC <-> pUSDC is always 1:1 (wrap / unwrap); pUSDC -> USDC can also go through the Uniswap v4 pool as a scheduled swap. */
export function SwapScreen({ data, me, tx, onBack }: { data: Protection; me: `0x${string}`; tx: ReturnType<typeof useSend>; onBack: () => void }) {
  const [pay, setPay] = useState<Tok>("USDC");
  const [amt, setAmt] = useState("");
  const [route, setRoute] = useState<Route>("oneToOne");
  const [slip, setSlip] = useState(1);
  const [fee, setFee] = useState<bigint>();
  const recv: Tok = pay === "USDC" ? "pUSDC" : "USDC";
  const amount = parseAmount(amt);
  const balance = pay === "USDC" ? data.usdcBalance : data.available;
  const v4 = pay === "pUSDC" && route === "v4";
  const needsApproval = pay === "USDC" && !!amount && data.usdcAllowance < amount;
  const scheduled = pay === "pUSDC" && route === "oneToOne" && data.protected && !!amount && amount > data.dailyRemaining;
  const minOut = amount ? (amount * BigInt(Math.round((100 - slip) * 100))) / 10000n : 0n;
  const tooMuch = !!amount && amount > balance;
  const busy = tx.busy === "swap-approve" || tx.busy === "swap" || tx.busy === "swap-q" || tx.busy === "swap-reg";

  const flip = () => { setPay(recv); setAmt(""); setRoute("oneToOne"); };

  // The call the button will make next, for the fee estimate.
  const next = !amount || tooMuch ? undefined
    : needsApproval ? { to: USDC, data: encodeFunctionData({ abi: usdcAbi, functionName: "approve", args: [PUSDC, amount] }) }
    : pay === "USDC" ? { to: PUSDC, data: encodeFunctionData({ abi: pusdcAbi, functionName: "deposit", args: [amount] }) }
    : v4 ? { to: PUSDC, data: encodeFunctionData({ abi: pusdcAbi, functionName: "queueTransfer", args: [SCHEDULER, amount] }) }
    : scheduled ? { to: PUSDC, data: encodeFunctionData({ abi: pusdcAbi, functionName: "queueTransfer", args: [PUSDC, amount] }) }
    : { to: PUSDC, data: encodeFunctionData({ abi: pusdcAbi, functionName: "withdraw", args: [amount] }) };
  const nextKey = next ? `${next.to}${next.data}` : "";
  useEffect(() => {
    setFee(undefined);
    if (!next) return;
    let live = true;
    void estimateFee({ from: me, to: next.to, data: next.data }).then((f) => live && setFee(f));
    return () => { live = false; };
  }, [nextKey, me]); // eslint-disable-line react-hooks/exhaustive-deps

  async function approve() {
    if (!amount) return;
    await tx.run("swap-approve", { address: USDC, abi: usdcAbi, functionName: "approve", args: [PUSDC, amount] }, "USDC approved");
  }
  async function swap() {
    if (!amount) return;
    if (pay === "USDC") {
      if (await tx.run("swap", { address: PUSDC, abi: pusdcAbi, functionName: "deposit", args: [amount] }, `Swapped ${fmtAmount(amount)} USDC for pUSDC`)) setAmt("");
      return;
    }
    if (v4) {
      const receipt = await tx.run("swap-q", { address: PUSDC, abi: pusdcAbi, functionName: "queueTransfer", args: [SCHEDULER, amount] }, "Step 1 of 2: funds set aside");
      if (!receipt) return;
      let id: bigint | undefined;
      for (const log of receipt.logs) {
        try {
          const ev = decodeEventLog({ abi: pusdcAbi, data: log.data, topics: log.topics });
          if (ev.eventName === "TransferQueued") id = ev.args.id;
        } catch { /* not ours */ }
      }
      if (id === undefined) return;
      if (await tx.run("swap-reg", { address: SCHEDULER, abi: schedulerAbi, functionName: "register", args: [id, poolKey(), minOut] }, "Swap scheduled on Uniswap v4")) setAmt("");
      return;
    }
    const ok = scheduled
      ? await tx.run("swap", { address: PUSDC, abi: pusdcAbi, functionName: "queueTransfer", args: [PUSDC, amount] }, "Withdrawal scheduled")
      : await tx.run("swap", { address: PUSDC, abi: pusdcAbi, functionName: "withdraw", args: [amount] }, `Swapped ${fmtAmount(amount)} pUSDC for USDC`);
    if (ok) setAmt("");
  }

  const label = !amount ? "Enter an amount"
    : tooMuch ? `Insufficient ${pay} balance`
    : needsApproval ? "Approve USDC"
    : busy && tx.busy === "swap-q" ? "Step 1 of 2: setting funds aside…"
    : busy && tx.busy === "swap-reg" ? "Step 2 of 2: attaching swap terms…"
    : v4 || scheduled ? "Schedule swap" : "Swap";
  const disabled = !amount || tooMuch;
  const receiveText = !amount ? "0" : v4 ? fmtAmount(minOut) : fmtAmount(amount);

  return (
    <>
      <div className="flex items-center gap-2">
        <button onClick={onBack} aria-label="Back to wallet" className="grid size-9 place-items-center rounded-full hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><ArrowLeft className="size-5" aria-hidden /></button>
        <h2 className="text-xl">Swap</h2>
      </div>

      <Card className="!p-2">
        <div className="rounded-2xl bg-muted p-4">
          <p className="text-sm text-muted-foreground">You pay</p>
          <div className="mt-1 flex items-center justify-between gap-2">
            <input aria-label="Amount to swap" inputMode="decimal" autoComplete="off" placeholder="0" value={amt} onChange={(e) => setAmt(e.target.value)} className="min-w-0 flex-1 bg-transparent text-3xl font-medium tabular outline-none placeholder:text-muted-foreground/60" />
            <TokenPill tok={pay} />
          </div>
          <div className="mt-2 flex items-center justify-between font-mono text-xs text-muted-foreground">
            <span>Balance {fmtAmount(balance)}</span>
            <button className="font-semibold text-primary hover:underline" onClick={() => setAmt(formatUnits(balance, DECIMALS))}>MAX</button>
          </div>
        </div>

        <div className="relative z-10 -my-3 flex justify-center">
          <button onClick={flip} aria-label="Switch tokens" className="grid size-10 place-items-center rounded-xl border-4 border-card bg-muted text-foreground transition-transform hover:bg-primary-soft active:rotate-180"><ArrowDown className="size-4" aria-hidden /></button>
        </div>

        <div className="rounded-2xl bg-muted p-4 pt-5">
          <p className="text-sm text-muted-foreground">{v4 ? "You receive at least" : "You receive"}</p>
          <div className="mt-1 flex items-center justify-between gap-2">
            <p className="min-w-0 flex-1 truncate text-3xl font-medium tabular" data-testid="receive">{receiveText}</p>
            <TokenPill tok={recv} />
          </div>
          <p className="mt-2 font-mono text-xs text-muted-foreground">Balance {fmtAmount(recv === "USDC" ? data.usdcBalance : data.balance)}</p>
        </div>

        <div className="p-1 pt-2">
          <Button className="w-full min-h-14 text-base" disabled={disabled} loading={busy && !(tx.busy === "swap-q" || tx.busy === "swap-reg")} onClick={needsApproval ? approve : swap}>
            {tx.busy === "swap-approve" ? "Approving…" : tx.busy === "swap" ? "Swapping…" : label}
          </Button>
        </div>
      </Card>

      {pay === "pUSDC" && V4_ENABLED && (
        <div className="grid grid-cols-2 gap-1 rounded-2xl bg-muted p-1" role="radiogroup" aria-label="Route">
          {([["oneToOne", "Unwrap 1:1"], ["v4", "Uniswap v4"]] as const).map(([r, l]) => (
            <button key={r} role="radio" aria-checked={route === r} onClick={() => setRoute(r)} className={`min-h-10 rounded-xl text-sm font-semibold ${route === r ? "bg-card shadow-sm" : "text-muted-foreground"}`}>{l}</button>
          ))}
        </div>
      )}

      {!!amount && !tooMuch && (
        <Card className="space-y-2 !p-4 text-sm">
          <p className="flex justify-between"><span className="text-muted-foreground">Rate</span><span className="font-mono text-xs">1 {pay} = 1 {recv}</span></p>
          <p className="flex justify-between"><span className="text-muted-foreground">Route</span><span className="font-mono text-xs" data-testid="route">{v4 ? "Uniswap v4 · scheduled" : pay === "USDC" ? "Wrap · exactly 1:1" : scheduled ? "Unwrap · scheduled" : "Unwrap · exactly 1:1"}</span></p>
          {v4 && (
            <div className="flex items-center justify-between gap-2">
              <span id="slip-label" className="text-muted-foreground">Max price drop</span>
              <div role="radiogroup" aria-labelledby="slip-label" className="flex gap-1">
                {SLIPPAGES.map((s) => <button key={s} role="radio" aria-checked={slip === s} onClick={() => setSlip(s)} className={`min-h-8 rounded-lg px-2.5 font-mono text-xs font-semibold ${slip === s ? "bg-primary-soft text-primary-soft-foreground" : "text-muted-foreground hover:bg-muted"}`}>{s}%</button>)}
              </div>
            </div>
          )}
          <FeeLine fee={fee} />
        </Card>
      )}

      {(v4 || scheduled) && !!amount && !tooMuch && (
        <Notice tone="warning" icon={v4 ? <CalendarClock /> : <Clock />} title={`Runs after ${fmtDuration(data.holdWindow)}`}>
          {v4 ? "Two quick confirmations: first the pUSDC is set aside, then the swap terms are attached so your backup can review them. If the price moves more than your limit by then, the swap won't run and your pUSDC stays yours." : "This is over today's limit, so it waits. You or your backup can stop it before then."}
        </Notice>
      )}
    </>
  );
}
