import { useEffect, useState } from "react";
import { useConnection } from "wagmi";
import type { Address } from "viem";
import { CheckCircle2, Gift, Link2, MailOpen } from "lucide-react";
import { pusdcAbi } from "../abi";
import { PUSDC, SCHEDULER } from "../config";
import { fmtAmount, fmtCountdown, fmtDate, shortAddr } from "../lib/format";
import { shareLink } from "../lib/prefs";
import { useIncoming } from "../lib/useIncoming";
import type { PendingTransfer } from "../lib/useProtection";
import { useTx } from "../lib/useTx";
import { Button, Card, Notice, useNow } from "./ui";
import { useToast } from "./toast";

const p = { address: PUSDC, abi: pusdcAbi } as const;

/** Copies a link the sender can give the recipient, so they can complete the transfer themselves. */
export function CopyLinkButton({ id, label = "Copy link for recipient" }: { id: bigint; label?: string }) {
  const toast = useToast();
  return (
    <Button
      variant="secondary"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(shareLink(id));
          toast.show({ kind: "success", title: "Link copied", body: "Send it to the recipient. They can open it and complete the transfer when it's ready." });
        } catch {
          toast.show({ kind: "error", title: "Couldn't copy", body: shareLink(id) });
        }
      }}
    >
      <Link2 className="size-4" aria-hidden /> {label}
    </Button>
  );
}

function IncomingRow({ t, connected }: { t: PendingTransfer & { pending?: boolean }; connected: boolean }) {
  const now = useNow();
  const { run, busy } = useTx();
  const left = t.executableAt + 5 - now;
  const ready = left <= 0;
  return (
    <li className="space-y-3 rounded-2xl border border-border p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-bold tabular">{fmtAmount(t.amount)} pUSDC</p>
          <p className="truncate text-sm text-muted-foreground">
            from <span className="font-mono">{shortAddr(t.from)}</span>
          </p>
        </div>
        {ready ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-primary-soft px-2.5 py-1 text-xs font-semibold text-primary-soft-foreground">
            <CheckCircle2 className="size-3.5" aria-hidden /> Ready
          </span>
        ) : (
          <span className="rounded-full bg-warning-soft px-2.5 py-1 text-xs font-semibold text-warning-foreground tabular">{fmtCountdown(left)}</span>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{ready ? "Ready now. Complete it to receive the pUSDC." : `Can be completed ${fmtDate(t.executableAt)}`}</p>
      {ready && connected && (
        <Button loading={busy === `in${t.id}`} onClick={() => run(`in${t.id}`, { ...p, functionName: "executeTransfer", args: [t.id] }, `Received ${fmtAmount(t.amount)} pUSDC`)}>
          Complete and receive
        </Button>
      )}
    </li>
  );
}

/** Scheduled transfers on their way TO the connected wallet. */
export function IncomingList({ address }: { address: Address }) {
  const { incoming, loading } = useIncoming(address);
  const list = incoming.filter((t) => t.to.toLowerCase() !== SCHEDULER.toLowerCase());
  return (
    <Card className="space-y-4">
      <h2 className="text-lg font-bold">On its way to you</h2>
      {loading ? (
        <div className="h-16 rounded-2xl bg-muted motion-safe:animate-pulse" aria-hidden />
      ) : list.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-4 text-center">
          <MailOpen className="size-8 text-muted-foreground" aria-hidden />
          <p className="text-sm font-semibold">Nothing incoming</p>
          <p className="text-sm text-muted-foreground">When someone schedules a big transfer to you, it shows up here.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {list.map((t) => (
            <IncomingRow key={String(t.id)} t={t} connected />
          ))}
        </ul>
      )}
    </Card>
  );
}

function sharedIdFromHash(): bigint | undefined {
  const m = location.hash.match(/^#incoming\/(\d+)$/);
  return m ? BigInt(m[1]) : undefined;
}

/** Opened from a shared link (#incoming/<id>): shows that transfer to anyone, with a Complete button once ready. */
export function SharedTransfer() {
  const [id, setId] = useState(sharedIdFromHash);
  useEffect(() => {
    const on = () => setId(sharedIdFromHash());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const { isConnected } = useConnection();
  const { shared, loading } = useIncoming(undefined, id);
  if (id === undefined) return null;
  return (
    <div className="mx-auto mb-6 mt-4 max-w-xl">
      <Card className="space-y-4 border-primary/40">
        <div className="flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-2xl bg-primary-soft text-primary-soft-foreground">
            <Gift className="size-5" aria-hidden />
          </span>
          <div>
            <h2 className="text-lg font-bold">A transfer is on its way</h2>
            {shared && (
              <p className="text-sm text-muted-foreground">
                to <span className="font-mono">{shortAddr(shared.to)}</span>
              </p>
            )}
          </div>
        </div>
        {loading || !shared ? (
          <div className="h-16 rounded-2xl bg-muted motion-safe:animate-pulse" aria-hidden />
        ) : !shared.pending ? (
          <Notice tone="info" title="This transfer is no longer pending">
            It has already been completed, or the sender cancelled it.
          </Notice>
        ) : (
          <>
            <ul>
              <IncomingRow t={shared} connected={isConnected} />
            </ul>
            {!isConnected && <p className="text-sm text-muted-foreground">Connect any wallet to complete it. The pUSDC always goes to the recipient above.</p>}
          </>
        )}
        <Button
          variant="ghost"
          onClick={() => {
            history.replaceState(null, "", location.pathname);
            setId(undefined);
          }}
        >
          Close
        </Button>
      </Card>
    </div>
  );
}
