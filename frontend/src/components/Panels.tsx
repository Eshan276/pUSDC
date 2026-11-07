import { useState } from "react";
import { formatUnits, getAddress, type Address } from "viem";
import { CalendarClock, CheckCircle2, ExternalLink, Hourglass, Inbox, Send, Zap } from "lucide-react";
import { pusdcAbi, schedulerAbi } from "../abi";
import { useReadContracts } from "wagmi";
import { DECIMALS, EXPLORER, POOL_KEY, PUSDC, SCHEDULER } from "../config";
import { addressProblem, fmtAmount, fmtCountdown, fmtDate, fmtDuration, parseAmount, shortAddr } from "../lib/format";
import type { PendingTransfer, ProtectionData } from "../lib/useProtection";
import { useTx } from "../lib/useTx";
import { Button, Card, Field, Notice, inputClass, useNow } from "./ui";

const p = { address: PUSDC, abi: pusdcAbi } as const;

/** Decides whether an outgoing amount goes out instantly or has to be scheduled. */
export function route(d: ProtectionData, amount: bigint | undefined) {
  if (!amount) return { kind: "none" as const };
  if (amount > d.available) return { kind: "tooMuch" as const };
  if (!d.protected || amount <= d.dailyRemaining) return { kind: "instant" as const };
  return { kind: "scheduled" as const, at: Math.floor(Date.now() / 1000) + d.holdWindow };
}

function AmountField({ id, label, value, onChange, max, maxLabel, error }: { id: string; label: string; value: string; onChange: (v: string) => void; max: bigint; maxLabel: string; error?: string }) {
  return (
    <Field label={label} htmlFor={id} error={error} hint={`${maxLabel}: ${fmtAmount(max)}`}>
      <div className="relative">
        <input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          placeholder="0.00"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-error` : `${id}-hint`}
          className={`${inputClass} pr-20 text-lg font-semibold tabular`}
        />
        <button
          type="button"
          onClick={() => onChange(formatUnits(max, DECIMALS))}
          className="absolute inset-y-1.5 right-1.5 rounded-lg px-3 text-xs font-bold text-primary hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          MAX
        </button>
      </div>
    </Field>
  );
}

export function RouteNotice({ r, d, verb }: { r: ReturnType<typeof route>; d: ProtectionData; verb: string }) {
  if (r.kind === "instant")
    return (
      <Notice tone="success" icon={<Zap />} title={`${verb} instantly`}>
        {d.protected ? `Within today's limit (${fmtAmount(d.dailyRemaining)} left).` : "Protection is off, so there's no limit."}
      </Notice>
    );
  if (r.kind === "scheduled")
    return (
      <Notice tone="warning" icon={<Hourglass />} title={`Scheduled: ${verb.toLowerCase()} on ${fmtDate(r.at)}`}>
        This is more than today's limit ({fmtAmount(d.dailyRemaining)} left), so it waits {fmtDuration(d.holdWindow)}. If it wasn't you,
        you or your backup can cancel it before then.
        {d.fastLane && " Your backup can also approve it to send it right away."}
        {d.dailyRemaining > 0n && ` Want it faster? Send ${fmtAmount(d.dailyRemaining)} now and the rest tomorrow.`}
      </Notice>
    );
  return null;
}

export function SendPanel({ d, address }: { d: ProtectionData; address: Address }) {
  const { run, busy } = useTx();
  const [to, setTo] = useState("");
  const [amt, setAmt] = useState("");
  const [touched, setTouched] = useState(false);
  const amount = parseAmount(amt);
  const r = route(d, amount);
  const toError = addressProblem(to, "Enter who you're sending to.") ?? (to.toLowerCase() === address.toLowerCase() ? "That's your own wallet." : undefined);
  const amtError = !amt ? "Enter an amount." : !amount ? "Enter a valid amount." : r.kind === "tooMuch" ? `You only have ${fmtAmount(d.available)} pUSDC free to send.` : undefined;
  // Show "valid/too much" problems as you type; "enter an amount" only after you try to submit.
  const amtShown = amt ? amtError : touched ? amtError : undefined;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (toError || amtError || !amount) return;
    const ok =
      r.kind === "scheduled"
        ? await run("send", { ...p, functionName: "queueTransfer", args: [getAddress(to), amount] }, `Transfer scheduled for ${fmtDate(r.at)}`)
        : await run("send", { ...p, functionName: "transfer", args: [getAddress(to), amount] }, `Sent ${fmtAmount(amount)} pUSDC`);
    if (ok) {
      setAmt("");
      setTouched(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <Card className="lg:col-span-3">
        <form onSubmit={submit} className="space-y-5" noValidate>
          <h2 className="text-lg font-bold">Send pUSDC</h2>
          <Field label="To" htmlFor="send-to" error={touched ? toError : undefined}>
            <input
              id="send-to"
              autoComplete="off"
              spellCheck={false}
              placeholder="0x…"
              value={to}
              onChange={(e) => setTo(e.target.value.trim())}
              aria-invalid={touched && !!toError}
              className={`${inputClass} font-mono text-sm`}
            />
          </Field>
          <AmountField id="send-amount" label="Amount" value={amt} onChange={setAmt} max={d.available} maxLabel="Free to send" error={amtShown} />
          <RouteNotice r={r} d={d} verb="Arrives" />
          <Button type="submit" loading={busy === "send"} className="w-full">
            {r.kind === "scheduled" ? <CalendarClock className="size-4" aria-hidden /> : <Send className="size-4" aria-hidden />}
            {r.kind === "scheduled" ? "Schedule transfer" : "Send now"}
          </Button>
        </form>
      </Card>
      <div className="lg:col-span-2">
        <PendingList title="Your scheduled transfers" transfers={d.pending} loading={d.pendingLoading} role="owner" fastLane={d.fastLane} />
      </div>
    </div>
  );
}

/** Scheduled (queued) transfers with countdowns. Owner and backup can cancel; anyone can complete a ready one. */
export function PendingList({ title, transfers, loading, role, fastLane, emptyText }: { title: string; transfers: PendingTransfer[]; loading?: boolean; role: "owner" | "backup" | "watcher"; fastLane?: boolean; emptyText?: string }) {
  const now = useNow();
  const { run, busy } = useTx();
  // Swap terms for transfers headed to ScheduledSwap, so owner and backup can review them during the hold.
  const swapIds = transfers.filter((t) => t.to.toLowerCase() === SCHEDULER.toLowerCase()).map((t) => t.id);
  const orders = useReadContracts({
    allowFailure: false,
    query: { enabled: swapIds.length > 0, refetchInterval: 5000 },
    contracts: swapIds.map((id) => ({ address: SCHEDULER, abi: schedulerAbi, functionName: "orderOf", args: [id] }) as const),
  });
  const orderOf = (id: bigint) => {
    const i = swapIds.indexOf(id);
    return i >= 0 ? (orders.data?.[i] as { key: { currency0: string; currency1: string; fee: number; hooks: string }; minOut: bigint; status: number } | undefined) : undefined;
  };
  return (
    <Card className="space-y-4">
      <h2 className="text-lg font-bold">{title}</h2>
      {loading ? (
        <div className="h-20 rounded-lg bg-muted motion-safe:animate-pulse" aria-hidden />
      ) : transfers.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-6 text-center">
          <Inbox className="size-8 text-muted-foreground" aria-hidden />
          <p className="text-sm font-semibold">Nothing scheduled</p>
          <p className="text-sm text-muted-foreground">{emptyText ?? "Transfers above the daily limit wait here until they're ready."}</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {transfers.map((t) => {
            // 5s margin: the chain's clock only advances with each block (~2s on Base).
            const left = t.executableAt + 5 - now;
            const ready = left <= 0;
            const unwrap = t.to.toLowerCase() === PUSDC.toLowerCase();
            const isSwap = t.to.toLowerCase() === SCHEDULER.toLowerCase();
            const order = isSwap ? orderOf(t.id) : undefined;
            const registered = order?.status === 1;
            const usualPool =
              registered &&
              order!.key.currency0.toLowerCase() === POOL_KEY.currency0.toLowerCase() &&
              order!.key.currency1.toLowerCase() === POOL_KEY.currency1.toLowerCase() &&
              order!.key.fee === POOL_KEY.fee;
            return (
              <li key={String(t.id)} className="space-y-3 rounded-lg border border-border p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-bold tabular">{fmtAmount(t.amount)} pUSDC</p>
                    <p className="truncate text-sm text-muted-foreground">
                      {isSwap ? (
                        registered ? `Swap to USDC on Uniswap v4, at least ${fmtAmount(order!.minOut)} USDC` : "Swap (terms not attached yet)"
                      ) : unwrap ? (
                        "Withdraw to USDC"
                      ) : (
                        <>
                          to <span className="font-mono">{shortAddr(t.to)}</span>
                        </>
                      )}
                    </p>
                  </div>
                  {ready ? (
                    <span className="inline-flex items-center gap-1 rounded bg-primary-soft px-2 py-1 font-mono text-xs font-medium text-primary-soft-foreground">
                      <CheckCircle2 className="size-3.5" aria-hidden /> Ready
                    </span>
                  ) : (
                    <span className="rounded bg-warning-soft px-2 py-1 font-mono text-xs font-medium text-warning-foreground tabular">{fmtCountdown(left)}</span>
                  )}
                </div>
                {!ready && (
                  <p className="text-xs text-muted-foreground">
                    Can go through {fmtDate(t.executableAt)}
                    {fastLane && role === "owner" ? ", or sooner if your backup approves it" : ""}
                  </p>
                )}
                {isSwap && order && (!registered || !usualPool) && role !== "owner" && (
                  <p className="rounded-md bg-warning-soft p-3 text-xs text-warning-foreground">
                    {!registered
                      ? "No swap terms attached. If it goes through, the pUSDC can only be refunded to the owner."
                      : "This uses an unusual pool. If the owner didn't set this up, stop it."}
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  {!ready && fastLane && role === "backup" && (
                    <Button loading={busy === `ap${t.id}`} onClick={() => run(`ap${t.id}`, { ...p, functionName: "approveTransfer", args: [t.id] }, "Approved and sent")}>
                      Approve now
                    </Button>
                  )}
                  {ready && (
                    <Button
                      loading={busy === `ex${t.id}`}
                      onClick={() =>
                        isSwap && registered
                          ? run(`ex${t.id}`, { address: SCHEDULER, abi: schedulerAbi, functionName: "execute", args: [t.id] }, "Swap done. USDC is in the owner's wallet")
                          : run(`ex${t.id}`, { ...p, functionName: "executeTransfer", args: [t.id] }, "Transfer completed")
                      }
                    >
                      {isSwap && registered ? "Complete swap" : "Complete transfer"}
                    </Button>
                  )}
                  {role !== "watcher" && (
                  <Button
                    variant={role === "backup" ? "danger" : "secondary"}
                    loading={busy === `cx${t.id}`}
                    onClick={() => run(`cx${t.id}`, { ...p, functionName: "cancelTransfer", args: [t.id] }, "Transfer cancelled, funds stay put")}
                  >
                    {role === "backup" ? "Stop this transfer" : "Cancel"}
                  </Button>
                  )}
                  <a
                    href={`${EXPLORER}/address/${t.to}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-11 items-center gap-1 rounded-md px-3 text-sm font-medium text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Recipient <ExternalLink className="size-3.5" aria-hidden />
                  </a>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
