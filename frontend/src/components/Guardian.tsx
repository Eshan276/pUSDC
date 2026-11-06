import { useEffect, useState } from "react";
import { getAddress, type Address } from "viem";
import { HeartHandshake, LifeBuoy, ShieldCheck, ShieldOff, TriangleAlert, X } from "lucide-react";
import { pusdcAbi } from "../abi";
import { PUSDC } from "../config";
import { addressProblem, fmtAmount, fmtDuration, shortAddr } from "../lib/format";
import { useProtection } from "../lib/useProtection";
import { useTx } from "../lib/useTx";
import { Button, Card, Field, HoldButton, Notice, Skeleton, inputClass } from "./ui";
import { PendingList } from "./Panels";

const KEY = "protected-usdc:watching";

/** Wallets this browser watches as a backup. Stored locally only; nothing leaves the device. */
function useWatched(): [Address[], (a: Address) => void, (a: Address) => void] {
  const [list, setList] = useState<Address[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(KEY) ?? "[]");
    } catch {
      return [];
    }
  });
  useEffect(() => localStorage.setItem(KEY, JSON.stringify(list)), [list]);
  return [
    list,
    (a) => setList((l) => (l.some((x) => x.toLowerCase() === a.toLowerCase()) ? l : [...l, a])),
    (a) => setList((l) => l.filter((x) => x !== a)),
  ];
}

export function GuardianPanel({ me }: { me: Address }) {
  const [watched, add, remove] = useWatched();
  const [v, setV] = useState("");
  const [tried, setTried] = useState(false);
  const err = addressProblem(v, "Enter the address of the wallet you protect.") ?? (v.toLowerCase() === me.toLowerCase() ? "That's your own wallet." : undefined);

  return (
    <div className="space-y-6">
      <Card className="space-y-4">
        <div className="flex items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-primary-soft text-primary-soft-foreground">
            <HeartHandshake className="size-5" aria-hidden />
          </span>
          <div>
            <h2 className="text-lg font-bold">Looking out for someone</h2>
            <p className="text-sm text-muted-foreground">
              If you're someone's backup wallet (maybe your own second wallet), add theirs here. You'll see their scheduled transfers and can stop
              anything suspicious.
            </p>
          </div>
        </div>
        <form
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            setTried(true);
            if (err) return;
            add(getAddress(v));
            setV("");
            setTried(false);
          }}
          noValidate
        >
          <div className="flex-1">
            <Field label="Wallet you protect" htmlFor="watch" error={tried ? err : undefined}>
              <input id="watch" autoComplete="off" spellCheck={false} placeholder="0x…" value={v} onChange={(e) => setV(e.target.value.trim())} className={`${inputClass} font-mono text-sm`} />
            </Field>
          </div>
          <Button type="submit" className={tried && err ? "sm:mb-7" : ""}>
            Watch this wallet
          </Button>
        </form>
      </Card>

      {watched.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <ShieldCheck className="size-10 text-muted-foreground" aria-hidden />
          <p className="font-semibold">You're not watching any wallets yet</p>
          <p className="max-w-sm text-sm text-muted-foreground">Add a wallet above. The list stays in this browser only.</p>
        </div>
      ) : (
        watched.map((a) => <Watched key={a} account={a} me={me} onRemove={() => remove(a)} />)
      )}
    </div>
  );
}

function Watched({ account, me, onRemove }: { account: Address; me: Address; onRemove: () => void }) {
  const { data, loading } = useProtection(account);
  const { run, busy } = useTx();
  if (loading || !data) return <Skeleton className="h-48" />;
  const amBackup = data.backup.toLowerCase() === me.toLowerCase();

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <Card className="space-y-4 lg:col-span-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className={`grid size-11 place-items-center rounded-2xl ${data.protected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
              {data.protected ? <ShieldCheck className="size-5" aria-hidden /> : <ShieldOff className="size-5" aria-hidden />}
            </span>
            <div>
              <p className="font-mono text-sm font-bold">{shortAddr(account)}</p>
              <p className="text-sm text-muted-foreground">
                {data.protected ? "Protected" : "Not protected"} · {fmtAmount(data.balance)} pUSDC
              </p>
            </div>
          </div>
          <button onClick={onRemove} aria-label={`Stop watching ${account}`} className="grid size-10 place-items-center rounded-xl text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <X className="size-4" aria-hidden />
          </button>
        </div>
        {!amBackup ? (
          <Notice tone="warning" icon={<TriangleAlert />} title="You're not this wallet's backup">
            Their backup is {shortAddr(data.backup) || "not set"}. You can watch, but only their backup can stop transfers or use the emergency button.
          </Notice>
        ) : (
          data.protected && (
            <div className="space-y-3 rounded-2xl bg-danger-soft p-4">
              <p className="flex items-center gap-2 font-semibold text-danger-soft-foreground">
                <LifeBuoy className="size-5" aria-hidden /> Emergency: bring their funds to you
              </p>
              <p className="text-sm text-danger-soft-foreground">
                Moves all {fmtAmount(data.available)} pUSDC to your wallet, locked for {fmtDuration(data.lockDuration)}, and cancels their scheduled
                transfers.
              </p>
              <HoldButton loading={busy === "stress"} onConfirm={() => run("stress", { address: PUSDC, abi: pusdcAbi, functionName: "stress", args: [account] }, "Their funds are safe with you")}>
                Hold to move funds to safety
              </HoldButton>
            </div>
          )
        )}
      </Card>
      <div className="lg:col-span-2">
        <PendingList title="Their scheduled transfers" transfers={data.pending} loading={data.pendingLoading} role={amBackup ? "backup" : "owner"} />
      </div>
    </div>
  );
}
