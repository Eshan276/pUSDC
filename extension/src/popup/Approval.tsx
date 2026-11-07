import { useState } from "react";
import { Clock, Globe, ShieldAlert } from "lucide-react";
import { decodeFunctionData, hexToBigInt, type Address, type Hex } from "viem";
import { pusdcAbi } from "@abi";
import { Button, Card, Notice, Skeleton } from "@ui/ui";
import { PUSDC } from "../shared/chain";
import { fmtAmount, fmtDuration, shortAddr } from "../shared/format";
import type { WalletState } from "../shared/messages";
import { call } from "./api";
import { useProtection } from "./useWallet";

type TxParams = { to?: Address; data?: Hex; value?: Hex };

/** Plain-language read of a transaction, plus a check against the wallet's own protection rules. */
function describe(tx: TxParams) {
  if (tx.to?.toLowerCase() !== PUSDC.toLowerCase() || !tx.data || tx.data === "0x") return null;
  try {
    const d = decodeFunctionData({ abi: pusdcAbi, data: tx.data });
    return { name: d.functionName, args: (d.args ?? []) as readonly unknown[] };
  } catch { return null; }
}

export function Approval({ id, state, onDone }: { id: string; state: WalletState; onDone: () => void }) {
  const a = state.approvals.find((x) => x.id === id);
  const me = state.address as Address;
  const { data } = useProtection(me);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();

  async function answer(approved: boolean, override?: { to: Address; data: Hex }) {
    setBusy(true); setErr(undefined);
    try { await call({ t: "approve", id, approved, override }); onDone(); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); setBusy(false); }
  }

  if (!a) return <Notice tone="warning">This request has expired. Close this window and try again from the site.</Notice>;

  const origin = (
    <p className="flex items-center gap-2 break-all rounded-2xl bg-muted px-3 py-2 text-sm"><Globe className="size-4 shrink-0" aria-hidden />{a.origin}</p>
  );

  if (a.kind === "connect")
    return (
      <Card className="space-y-4">
        <h2 className="text-lg font-extrabold">Connect to this site?</h2>
        {origin}
        <p className="text-sm text-muted-foreground">It will see your address and balances, and can ask you to approve payments. It can never move money by itself.</p>
        {err && <Notice tone="danger">{err}</Notice>}
        <div className="grid grid-cols-2 gap-2"><Button variant="secondary" loading={busy} onClick={() => answer(false)}>Cancel</Button><Button loading={busy} onClick={() => answer(true)}>Connect</Button></div>
      </Card>
    );

  if (a.kind === "sign" || a.kind === "typed") {
    const body = a.kind === "sign" ? String(a.params.find((p) => typeof p === "string" && !/^0x[0-9a-fA-F]{40}$/.test(p as string)) ?? "") : String(a.params[1] ?? "");
    return (
      <Card className="space-y-4">
        <h2 className="text-lg font-extrabold">Sign this message?</h2>
        {origin}
        <Notice tone="warning" icon={<ShieldAlert />}>Only sign things you recognise. Signing proves you own this wallet.</Notice>
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-2xl bg-muted p-3 font-mono text-xs">{body}</pre>
        {err && <Notice tone="danger">{err}</Notice>}
        <div className="grid grid-cols-2 gap-2"><Button variant="secondary" loading={busy} onClick={() => answer(false)}>Reject</Button><Button loading={busy} onClick={() => answer(true)}>Sign</Button></div>
      </Card>
    );
  }

  const tx = a.params[0] as TxParams;
  const dec = describe(tx);
  const transfer = dec?.name === "transfer" ? { to: dec.args[0] as Address, amount: dec.args[1] as bigint } : null;
  const overLimit = !!(transfer && data?.protected && transfer.amount > data.dailyRemaining);
  const tooLarge = !!(transfer && data && transfer.amount > data.available);
  const value = tx.value ? hexToBigInt(tx.value) : 0n;

  return (
    <Card className="space-y-4">
      <h2 className="text-lg font-extrabold">Approve this transaction?</h2>
      {origin}
      {!data ? <Skeleton className="h-16" /> : (
        <>
          <div className="space-y-1 rounded-2xl bg-muted p-3 text-sm">
            <p className="font-semibold">{dec ? `pUSDC: ${dec.name}` : `Contract call to ${shortAddr(tx.to)}`}</p>
            {transfer && <p>Send {fmtAmount(transfer.amount)} pUSDC to <span className="font-mono">{shortAddr(transfer.to)}</span></p>}
            {value > 0n && <p>Also sends {Number(value) / 1e18} ETH</p>}
            {!dec && tx.data && tx.data !== "0x" && <p className="break-all font-mono text-xs text-muted-foreground">{tx.data.slice(0, 74)}{tx.data.length > 74 && "…"}</p>}
          </div>
          {overLimit && !tooLarge && (
            <Notice tone="warning" icon={<Clock />} title="Over your daily limit">
              The token will schedule this automatically instead of sending it now. It will wait {fmtDuration(data.holdWindow)}, and you or your backup can stop it before then.
            </Notice>
          )}
          {tooLarge && <Notice tone="danger">Only {fmtAmount(data.available)} pUSDC is ready to use, so this can't go through.</Notice>}
          {err && <Notice tone="danger">{err}</Notice>}
          <div className="grid gap-2">
            {!tooLarge && <Button loading={busy} onClick={() => answer(true)}>{overLimit ? "Approve and schedule" : "Approve"}</Button>}
            <Button variant="secondary" loading={busy} onClick={() => answer(false)}>Reject</Button>
          </div>
        </>
      )}
    </Card>
  );
}
