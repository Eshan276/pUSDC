import { useEffect, useState } from "react";
import { ArrowLeft, ChevronRight, ExternalLink, History, KeyRound, Lock, LogOut, ShieldAlert, ShieldCheck, Siren, Timer } from "lucide-react";
import type { Address } from "viem";
import { isAddress } from "viem";
import { pusdcAbi } from "@abi";
import { Button, Card, Field, HoldButton, Notice, inputClass } from "@ui/ui";
import { PUSDC, EXPLORER, DECIMALS } from "../shared/chain";
import { Param, durError, unitFor, type Bounds } from "../shared/presets";
import { useBounds, useChainNow } from "./useWallet";
import { fmtAmount, fmtDate, fmtDuration, parseAmount, shortAddr } from "../shared/format";
import type { Protection } from "../shared/read";
import type { WalletState } from "../shared/messages";
import { call } from "./api";
import { PhraseGrid, strength } from "./Onboarding";
import { useSend, type Activity } from "./useSend";

type Tx = ReturnType<typeof useSend>;
type Page = "menu" | "protection" | "security" | "activity" | "emergency";

export function MoreTab(p: { data: Protection | undefined; me: Address; tx: Tx; state: WalletState; refresh: () => void; initialPage?: Page }) {
  const [page, setPage] = useState<Page>(p.initialPage ?? "menu");
  useEffect(() => { if (p.initialPage) setPage(p.initialPage); }, [p.initialPage]);

  if (page === "menu") {
    const rows: { id: Page | "lock"; icon: typeof Lock; title: string; sub: string }[] = [
      { id: "protection", icon: ShieldCheck, title: "Protection settings", sub: p.data?.protected ? "Limit, waiting time, backup" : "Not turned on yet" },
      { id: "emergency", icon: ShieldAlert, title: "Emergency", sub: "Move everything to safety" },
      { id: "security", icon: Lock, title: "Security", sub: "Password, emergency PIN, auto-lock, recovery phrase" },
      { id: "activity", icon: History, title: "Activity", sub: "What you've done in this wallet" },
    ];
    return (
      <>
        <h2 className="text-lg font-extrabold">More</h2>
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.id}>
              <button onClick={() => setPage(r.id as Page)} className="flex w-full items-center gap-3 rounded-2xl border border-border bg-card p-3 text-left hover:bg-muted">
                <span className="grid size-9 place-items-center rounded-xl bg-primary-soft text-primary"><r.icon className="size-5" aria-hidden /></span>
                <span className="min-w-0 flex-1"><span className="block font-semibold">{r.title}</span><span className="block truncate text-xs text-muted-foreground">{r.sub}</span></span>
                <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
        <a className="flex items-center justify-center gap-1 text-sm text-primary underline" href={`${EXPLORER}/address/${p.me}`} target="_blank" rel="noreferrer">View my wallet on Basescan <ExternalLink className="size-3" aria-hidden /></a>
        <Button variant="secondary" className="w-full" onClick={async () => { await call({ t: "lock" }); p.refresh(); }}><Lock className="size-4" aria-hidden />Lock wallet</Button>
      </>
    );
  }
  return (
    <>
      <button onClick={() => setPage("menu")} className="flex items-center gap-1 self-start text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" aria-hidden />More</button>
      {page === "protection" && <ProtectionSettings {...p} />}
      {page === "emergency" && <Emergency {...p} />}
      {page === "security" && <Security {...p} />}
      {page === "activity" && <ActivityList />}
    </>
  );
}

/* ───────── emergency ───────── */

function Emergency({ data, me, tx }: { data: Protection | undefined; me: Address; tx: Tx }) {
  return (
    <Card className="space-y-3">
      <h2 className="flex items-center gap-2 text-lg font-extrabold text-danger"><ShieldAlert className="size-5" aria-hidden />Emergency</h2>
      {data?.protected ? (
        <>
          <p className="text-sm text-muted-foreground">If your keys are stolen or you're being forced, this moves everything to your backup wallet ({shortAddr(data.backup)}), cancels scheduled transfers and settings changes, and locks the funds for {fmtDuration(data.lockDuration)}.</p>
          <HoldButton loading={tx.busy === "stress"} onConfirm={() => tx.run("stress", { address: PUSDC, abi: pusdcAbi, functionName: "stress", args: [me] }, "Funds moved to your backup")}>Hold to move everything to safety</HoldButton>
          <p className="text-xs text-muted-foreground">Press and hold for a second and a half so it can't be triggered by accident.</p>
        </>
      ) : <Notice tone="warning">Turn on protection first. The emergency button needs a backup wallet to send funds to.</Notice>}
    </Card>
  );
}

/* ───────── protection settings ───────── */

type ParamRow = { id: number; title: string; help: string; key?: "hold" | "off" | "lock" };
const PARAMS: ParamRow[] = [
  { id: Param.DailyLimit, title: "Daily limit", help: "How much can leave instantly each day. Lower is stricter." },
  { id: Param.HoldWindow, title: "Waiting time for big transfers", help: "Longer is stricter.", key: "hold" },
  { id: Param.OffDelay, title: "Delay before loosening", help: "Longer is stricter.", key: "off" },
  { id: Param.LockDuration, title: "Safety lock after an emergency", help: "Longer is stricter.", key: "lock" },
];

function ProtectionSettings({ data, tx, me }: { data: Protection | undefined; tx: Tx; me: Address }) {
  const now = useChainNow();
  const bounds: Bounds = useBounds();
  const unit = unitFor(bounds);
  const rangeOf = (i: number) => bounds[PARAMS[i].key!];
  const [edit, setEdit] = useState<number | null>(null);
  const [val, setVal] = useState("");
  const [bk, setBk] = useState("");
  const [confirmOff, setConfirmOff] = useState(false);
  if (!data) return null;
  if (!data.protected) return <Notice tone="info" title="Protection is off">Turn it on from the Wallet tab.</Notice>;

  const current = [data.dailyLimit, BigInt(data.holdWindow), BigInt(data.offDelay), BigInt(data.lockDuration)];
  const show = (i: number) => (i === 0 ? `${fmtAmount(data.dailyLimit)} pUSDC` : fmtDuration(Number(current[i])));
  const parsed = (i: number): bigint | undefined => {
    if (i === 0) return val.trim() === "0" ? 0n : parseAmount(val);
    return durError(val, rangeOf(i), unit) ? undefined : BigInt(Number(val) * unit.secs);
  };
  // Mirrors the contract's _isIncrease: stricter changes apply instantly, looser ones wait.
  const stricter = (i: number, v: bigint) => (i === 0 ? v <= current[0] : v >= current[i]);
  const delayEnd = fmtDate(now + data.offDelay);

  return (
    <>
      <h2 className="text-lg font-extrabold">Protection settings</h2>
      {PARAMS.map((p, i) => {
        const v = edit === i ? parsed(i) : undefined;
        const pend = data.pendingChanges[i];
        return (
          <Card key={p.id} className="space-y-2 !p-4">
            <div className="flex items-start justify-between gap-2">
              <div><p className="text-sm font-semibold">{p.title}</p><p className="text-xs text-muted-foreground">{p.help}</p></div>
              <p className="shrink-0 text-sm font-bold">{show(i)}</p>
            </div>
            {pend && <Notice tone="warning">Change to {i === 0 ? fmtAmount(pend.value) : fmtDuration(Number(pend.value))} applies {fmtDate(pend.effectiveAt)}.</Notice>}
            {edit === i ? (
              <>
                <Field label={`New value (${i === 0 ? "pUSDC" : unit.label})`} htmlFor={`p${i}`} error={val && v === undefined ? (i === 0 ? "Enter an amount." : durError(val, rangeOf(i), unit)) : undefined}>
                  <input id={`p${i}`} autoFocus className={inputClass} inputMode="decimal" value={val} onChange={(e) => setVal(e.target.value)} />
                </Field>
                {v !== undefined && (stricter(i, v)
                  ? <p className="rounded-xl bg-primary-soft px-3 py-2 text-xs text-primary-soft-foreground">Stricter, so this applies <b>right away</b>.</p>
                  : <p className="rounded-xl bg-warning-soft px-3 py-2 text-xs text-warning-foreground">Looser, so this waits until <b>{delayEnd}</b>. You can cancel it before then.</p>)}
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button>
                  <Button className="flex-1" disabled={v === undefined} loading={tx.busy === `p${i}`}
                    onClick={async () => { if (await tx.run(`p${i}`, { address: PUSDC, abi: pusdcAbi, functionName: "setParam", args: [p.id, v!] }, stricter(i, v!) ? "Updated" : "Change scheduled")) setEdit(null); }}>Save</Button>
                </div>
              </>
            ) : <Button variant="secondary" onClick={() => { setEdit(i); setVal(i === 0 ? String(Number(current[0]) / 10 ** DECIMALS) : String(Number(current[i]) / unit.secs)); }}>Change</Button>}
          </Card>
        );
      })}

      <Card className="space-y-2 !p-4">
        <p className="text-sm font-semibold">Backup wallet</p>
        <p className="font-mono text-sm">{data.backup}</p>
        {data.pendingBackup ? <Notice tone="warning">Changing to {shortAddr(data.pendingBackup.backup)} on {fmtDate(data.pendingBackup.effectiveAt)}.</Notice> : (
          <>
            <Field label="Change to" htmlFor="newbk" hint={`Takes ${fmtDuration(data.offDelay)} to apply.`} error={bk && (!isAddress(bk) || bk.toLowerCase() === me.toLowerCase()) ? "Enter a different, valid address." : undefined}>
              <input id="newbk" className={`${inputClass} font-mono text-sm`} value={bk} onChange={(e) => setBk(e.target.value.trim())} placeholder="0x…" />
            </Field>
            <Button variant="secondary" disabled={!isAddress(bk) || bk.toLowerCase() === me.toLowerCase()} loading={tx.busy === "bk"}
              onClick={() => tx.run("bk", { address: PUSDC, abi: pusdcAbi, functionName: "requestBackupChange", args: [bk as Address] }, "Backup change scheduled")}>Request change</Button>
          </>
        )}
      </Card>

      <Card className="space-y-2 !p-4">
        <p className="text-sm font-semibold">Turn protection off</p>
        {data.flagOffAt > 0 ? <Notice tone="warning">Protection turns off {fmtDate(data.flagOffAt)}.</Notice> : !confirmOff ? (
          <Button variant="secondary" onClick={() => setConfirmOff(true)}>Turn off…</Button>
        ) : (
          <>
            <Notice tone="warning">It will stay on for {fmtDuration(data.offDelay)} more, so a thief can't switch it off quickly. You can cancel any time before then.</Notice>
            <div className="flex gap-2"><Button variant="ghost" onClick={() => setConfirmOff(false)}>Keep it on</Button><Button variant="danger" loading={tx.busy === "off"} onClick={async () => { if (await tx.run("off", { address: PUSDC, abi: pusdcAbi, functionName: "requestFlagOff" }, "Turn-off scheduled")) setConfirmOff(false); }}>Schedule turn-off</Button></div>
          </>
        )}
      </Card>
    </>
  );
}

/* ───────── security ───────── */

const LOCKS = [{ m: 1, l: "1 min" }, { m: 5, l: "5 min" }, { m: 15, l: "15 min" }, { m: 60, l: "1 hour" }, { m: 0, l: "Never" }];

function Security({ data, state, refresh }: { data: Protection | undefined; state: WalletState; refresh: () => void }) {
  const [pw, setPw] = useState("");
  const [np, setNp] = useState("");
  const [duress, setDuress] = useState("");
  const [phrase, setPhrase] = useState<string>();
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string }>();
  const [wipe, setWipe] = useState(false);
  const run = async (fn: () => Promise<void>, ok?: string) => {
    setMsg(undefined);
    try { await fn(); if (ok) setMsg({ tone: "success", text: ok }); } catch (e) { setMsg({ tone: "danger", text: e instanceof Error ? e.message : String(e) }); }
  };
  return (
    <>
      <h2 className="text-lg font-extrabold">Security</h2>
      <Card className="space-y-3">
        <Field label="Your password" htmlFor="s-pw" hint="Needed for the actions below."><input id="s-pw" type="password" className={inputClass} value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      </Card>

      <Card className="space-y-3">
        <h3 className="flex items-center gap-2 font-extrabold"><Siren className="size-5" aria-hidden />Emergency PIN</h3>
        <p className="text-sm text-muted-foreground">If someone forces you to unlock, type this PIN instead of your password. It quietly moves your money to your backup, then shows a believable empty wallet.{state.hasDuressPin && <b> Your emergency PIN is set.</b>}</p>
        <Field label="New emergency PIN" htmlFor="s-pin" hint="At least 4 characters, different from your password."><input id="s-pin" type="password" className={inputClass} value={duress} onChange={(e) => setDuress(e.target.value)} /></Field>
        <div className="flex gap-2">
          <Button className="flex-1" disabled={!pw || duress.length < 4} onClick={() => run(async () => { await call({ t: "setDuress", password: pw, duressPin: duress }); setDuress(""); refresh(); }, "Emergency PIN saved.")}>{state.hasDuressPin ? "Replace PIN" : "Save PIN"}</Button>
          {state.hasDuressPin && <Button variant="secondary" onClick={() => run(async () => { await call({ t: "clearDuress" }); refresh(); }, "Emergency PIN removed.")}>Remove</Button>}
        </div>
        {!data?.protected && <Notice tone="warning">Protection is off, so the PIN can only show a decoy; it can't move money yet.</Notice>}
      </Card>

      <Card className="space-y-3">
        <h3 className="flex items-center gap-2 font-extrabold"><Timer className="size-5" aria-hidden />Auto-lock</h3>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Auto-lock after">
          {LOCKS.map((o) => (
            <button key={o.m} role="radio" aria-checked={state.autolock === o.m} onClick={() => run(async () => { await call({ t: "autolock", minutes: o.m }); refresh(); })}
              className={`rounded-full border px-3 py-1.5 text-sm ${state.autolock === o.m ? "border-primary bg-primary-soft font-semibold" : "border-border hover:bg-muted"}`}>{o.l}</button>
          ))}
        </div>
      </Card>

      <Card className="space-y-3">
        <h3 className="font-extrabold">Change password</h3>
        <Field label="New password" htmlFor="s-np" hint={np ? `Strength: ${strength(np).label}` : undefined}><input id="s-np" type="password" className={inputClass} value={np} onChange={(e) => setNp(e.target.value)} /></Field>
        <Button variant="secondary" disabled={!pw || np.length < 8} onClick={() => run(async () => { await call({ t: "changePassword", oldPassword: pw, newPassword: np }); setNp(""); setPw(""); }, "Password changed.")}>Change password</Button>
      </Card>

      <Card className="space-y-3">
        <h3 className="flex items-center gap-2 font-extrabold"><KeyRound className="size-5" aria-hidden />Recovery phrase</h3>
        {phrase ? <><PhraseGrid phrase={phrase} /><Button variant="ghost" onClick={() => setPhrase(undefined)}>Hide</Button></> : (
          <Button variant="secondary" disabled={!pw} onClick={() => run(async () => { setPhrase(await call<string>({ t: "reveal", password: pw })); })}>Show phrase</Button>
        )}
      </Card>

      <Card className="space-y-3">
        <h3 className="flex items-center gap-2 font-extrabold text-danger"><LogOut className="size-5" aria-hidden />Remove wallet from this device</h3>
        {!wipe ? <Button variant="secondary" onClick={() => setWipe(true)}>Remove…</Button> : (
          <>
            <Notice tone="danger">This deletes the wallet from this browser. Without your recovery phrase, the money in it is gone for good.</Notice>
            <div className="flex gap-2"><Button variant="ghost" onClick={() => setWipe(false)}>Keep it</Button><Button variant="danger" disabled={!pw} onClick={() => run(async () => { await call({ t: "wipe", password: pw }); refresh(); })}>Remove wallet</Button></div>
          </>
        )}
      </Card>
    </>
  );
}

/* ───────── activity ───────── */

function ActivityList() {
  const [items, setItems] = useState<Activity[]>();
  useEffect(() => { chrome.storage.local.get("activity").then((r) => setItems((r.activity as Activity[]) ?? [])); }, []);
  return (
    <>
      <h2 className="text-lg font-extrabold">Activity</h2>
      {items?.length === 0 && <p className="text-sm text-muted-foreground">Nothing yet. Things you do in this wallet will show up here.</p>}
      <ul className="space-y-2">
        {items?.map((a) => (
          <li key={a.hash}>
            <a href={`${EXPLORER}/tx/${a.hash}`} target="_blank" rel="noreferrer" className="flex items-center justify-between gap-2 rounded-2xl border border-border bg-card p-3 text-sm hover:bg-muted">
              <span><span className="block font-semibold">{a.title}</span><span className="text-xs text-muted-foreground">{new Date(a.at * 1000).toLocaleString()}</span></span>
              <ExternalLink className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            </a>
          </li>
        ))}
      </ul>
    </>
  );
}
