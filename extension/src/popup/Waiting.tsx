import { useState } from "react";
import { Clock, EyeOff, ShieldAlert } from "lucide-react";
import { isAddress, type Address } from "viem";
import { pusdcAbi } from "@abi";
import { Button, Card, Field, HoldButton, Notice, Skeleton, inputClass, useNow } from "@ui/ui";
import { PUSDC } from "../shared/chain";
import { fmtAmount, fmtCountdown, fmtDate, shortAddr } from "../shared/format";
import type { Protection } from "../shared/read";
import type { WalletState } from "../shared/messages";
import { call } from "./api";
import { useProtection } from "./useWallet";
import { useSend } from "./useSend";

type Tx = ReturnType<typeof useSend>;
const PARAM_NAMES = ["daily limit", "waiting time", "turn-off delay", "lock time"];

/** Everything pending on a wallet: scheduled transfers and queued weakening of protection. `canStop` = viewer may cancel. */
export function PendingView({ data, tx, viewer }: { data: Protection; tx: Tx; viewer: Address }) {
  const now = useNow();
  const isOwner = data.address.toLowerCase() === viewer.toLowerCase();
  const c = (functionName: string, args: readonly unknown[] = []) => ({ address: PUSDC, abi: pusdcAbi, functionName, args }) as const;
  const none = !data.pending.length && !data.flagOffAt && !data.pendingBackup && !data.pendingChanges.some(Boolean);
  if (none) return <p className="text-sm text-muted-foreground">Nothing is waiting.</p>;
  return (
    <div className="space-y-3">
      {data.flagOffAt > 0 && (
        <Notice tone="warning" icon={<ShieldAlert />} title="Protection is set to turn off">
          It will switch off {fmtDate(data.flagOffAt)}.
          {isOwner && <div className="mt-2"><Button variant="secondary" loading={tx.busy === "ffo"} onClick={() => tx.run("ffo", c("cancelFlagOff"), "Protection stays on")}>Keep protection on</Button></div>}
        </Notice>
      )}
      {data.pendingBackup && (
        <Notice tone="warning" icon={<ShieldAlert />} title="Backup wallet change requested">
          New backup {shortAddr(data.pendingBackup.backup)} takes over {fmtDate(data.pendingBackup.effectiveAt)}.
          {isOwner && <div className="mt-2"><Button variant="secondary" loading={tx.busy === "cbk"} onClick={() => tx.run("cbk", c("cancelBackupChange"), "Backup unchanged")}>Cancel change</Button></div>}
        </Notice>
      )}
      {data.pendingChanges.map((ch, i) => ch && (
        <Notice key={i} tone="warning" icon={<Clock />} title={`Looser ${PARAM_NAMES[i]} scheduled`}>
          Applies {fmtDate(ch.effectiveAt)}.
          {isOwner && <div className="mt-2"><Button variant="secondary" loading={tx.busy === `cp${i}`} onClick={() => tx.run(`cp${i}`, c("cancelParamChange", [i]), "Change cancelled")}>Cancel change</Button></div>}
        </Notice>
      ))}
      {data.pending.map((t) => {
        const left = t.executableAt - now;
        return (
          <Card key={String(t.id)} className="space-y-2 !p-4">
            <p className="font-semibold">{fmtAmount(t.amount)} pUSDC → <span className="font-mono text-sm">{shortAddr(t.to)}</span></p>
            <p className="text-sm text-muted-foreground">{left > 0 ? `Ready in ${fmtCountdown(left)}` : "Ready to complete"}</p>
            <div className="flex gap-2">
              {left <= 0 && <Button loading={tx.busy === `ex${t.id}`} onClick={() => tx.run(`ex${t.id}`, c("executeTransfer", [t.id]), "Transfer completed")}>Complete</Button>}
              <Button variant="secondary" loading={tx.busy === `ca${t.id}`} onClick={() => tx.run(`ca${t.id}`, c("cancelTransfer", [t.id]), "Transfer stopped")}>
                {isOwner ? "Stop" : "Stop this transfer"}
              </Button>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

export function WaitingTab({ data, tx }: { data: Protection | undefined; tx: Tx }) {
  if (!data) return <Skeleton className="h-40" />;
  return (
    <>
      <h2 className="text-lg font-extrabold">Waiting</h2>
      <p className="text-sm text-muted-foreground">Large transfers and looser settings wait here so you can stop them if they weren't you.</p>
      <PendingView data={data} tx={tx} viewer={data.address} />
    </>
  );
}

export function GuardianTab({ state, me, refresh }: { state: WalletState; me: Address; refresh: () => void }) {
  const [input, setInput] = useState("");
  const [err, setErr] = useState<string>();
  async function add() {
    if (!isAddress(input)) return setErr("That doesn't look like an address.");
    if (state.watch.some((a) => a.toLowerCase() === input.toLowerCase())) return setErr("Already watching that wallet.");
    await call({ t: "watch", list: [...state.watch, input as Address] });
    setInput(""); setErr(undefined); refresh();
  }
  return (
    <>
      <h2 className="text-lg font-extrabold">Watch over a wallet</h2>
      <p className="text-sm text-muted-foreground">If you're someone's backup, add their address. You'll get a notification when something is queued, and can stop it here.</p>
      <Field label="Wallet to watch" htmlFor="watch" error={err}>
        <div className="flex gap-2">
          <input id="watch" className={`${inputClass} font-mono text-sm`} value={input} onChange={(e) => setInput(e.target.value.trim())} placeholder="0x…" />
          <Button onClick={add}>Add</Button>
        </div>
      </Field>
      {state.watch.length === 0 && <p className="text-sm text-muted-foreground">Not watching anyone yet.</p>}
      {state.watch.map((a) => (
        <WatchRow key={a} address={a} me={me} onRemove={async () => { await call({ t: "watch", list: state.watch.filter((x) => x !== a) }); refresh(); }} />
      ))}
    </>
  );
}

function WatchRow({ address, me, onRemove }: { address: Address; me: Address; onRemove: () => void }) {
  const { data, reload } = useProtection(address);
  const tx = useSend(me, reload);
  const amBackup = data?.backup.toLowerCase() === me.toLowerCase();
  return (
    <Card className="space-y-3 !p-4">
      <div className="flex items-center gap-2">
        <p className="font-mono text-sm">{shortAddr(address)}</p>
        <button className="ml-auto text-muted-foreground" onClick={onRemove} aria-label={`Stop watching ${shortAddr(address)}`}><EyeOff className="size-4" /></button>
      </div>
      {!data ? <Skeleton className="h-10" /> : (
        <>
          {!data.protected && <p className="text-sm text-muted-foreground">Protection isn't on for this wallet.</p>}
          {data.protected && !amBackup && <Notice tone="info">You're not this wallet's backup, so you can watch but not act.</Notice>}
          <PendingView data={data} tx={tx} viewer={me} />
          {data.protected && amBackup && (
            <div className="space-y-1">
              <HoldButton loading={tx.busy === "stress"} onConfirm={() => tx.run("stress", { address: PUSDC, abi: pusdcAbi, functionName: "stress", args: [address] }, "Funds moved to safety")}>Move everything to safety</HoldButton>
              <p className="text-xs text-muted-foreground">Press and hold. Sends all funds to you and locks them for {Math.round(data.lockDuration / 86400)} days.</p>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
