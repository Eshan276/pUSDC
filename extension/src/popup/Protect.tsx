import { useState } from "react";
import { ArrowLeft, ArrowRight, Check, Circle, CheckCircle2, ExternalLink, ShieldCheck } from "lucide-react";
import { isAddress, type Address } from "viem";
import { pusdcAbi, usdcAbi } from "@abi";
import { Button, Card, Field, Notice, inputClass } from "@ui/ui";
import { PUSDC, USDC } from "../shared/chain";
import { BOUNDS, PRESETS, daysError, toSeconds, type Settings } from "../shared/presets";
import { fmtAmount, fmtDuration, parseAmount } from "../shared/format";
import type { Protection } from "../shared/read";
import type { WalletState } from "../shared/messages";
import type { useSend } from "./useSend";

type Tx = ReturnType<typeof useSend>;
const FAUCET = "https://www.alchemy.com/faucets/base-sepolia";

const limitError = (v: string) => (v.trim() === "0" || parseAmount(v) ? undefined : "Enter an amount (0 means every transfer waits).");
const limitUnits = (v: string) => (v.trim() === "0" ? 0n : parseAmount(v) ?? 0n);

/** "Get ready" checklist; each step ticks itself off from on-chain state. */
export function Checklist({ data, state, backedUp, tx, onProtect, onPin, onDismiss }: {
  data: Protection; state: WalletState; backedUp: boolean; tx: Tx; onProtect: () => void; onPin: () => void; onDismiss: () => void;
}) {
  const hasGas = data.eth > 0n;
  const hasFunds = data.balance > 0n;
  const steps = [
    { done: hasGas, title: "Get a little ETH for network fees", body: <>Each action costs a tiny fee. On this test network it's free: paste your address into a faucet. <a className="underline" href={FAUCET} target="_blank" rel="noreferrer">Open a faucet <ExternalLink className="inline size-3" aria-hidden /></a></> },
    { done: hasFunds, title: "Add some money", body: "Grab 10,000 test USDC and add it to your protected balance in one go.", action: hasGas && !hasFunds ? <Button loading={tx.busy === "start"} onClick={() => getStarted(tx)}>Get 10,000 test pUSDC</Button> : null },
    { done: data.protected, title: "Turn on protection", body: "Pick a backup wallet and how careful to be.", action: hasGas && !data.protected ? <Button onClick={onProtect}>Set up protection</Button> : null },
    { done: state.hasDuressPin, title: "Set an emergency PIN", body: "A second password that secretly moves your money to safety if you're ever forced to unlock.", action: !state.hasDuressPin ? <Button variant="secondary" onClick={onPin}>Choose a PIN</Button> : null },
  ];
  const left = steps.filter((s) => !s.done).length;
  if (left === 0 && backedUp) return null;
  return (
    <Card className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h2 className="font-extrabold">Get ready</h2>
        <span className="text-xs text-muted-foreground">{steps.length - left} of {steps.length} done</span>
      </div>
      <ol className="space-y-4">
        {steps.map((s) => (
          <li key={s.title} className="flex gap-3">
            {s.done ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-primary" aria-label="Done" /> : <Circle className="mt-0.5 size-5 shrink-0 text-border" aria-label="To do" />}
            <div className="min-w-0 space-y-1.5">
              <p className={`text-sm font-semibold ${s.done ? "text-muted-foreground line-through" : ""}`}>{s.title}</p>
              {!s.done && <p className="text-sm text-muted-foreground">{s.body}</p>}
              {!s.done && s.action}
            </div>
          </li>
        ))}
      </ol>
      {left === 0 && <Button variant="ghost" onClick={onDismiss}>Hide this</Button>}
    </Card>
  );
}

async function getStarted(tx: Tx) {
  const amt = 10_000_000000n;
  const me = tx.account!;
  if (!(await tx.run("start", { address: USDC, abi: usdcAbi, functionName: "mint", args: [me, amt] }, "Test USDC received"))) return;
  if (!(await tx.run("start", { address: USDC, abi: usdcAbi, functionName: "approve", args: [PUSDC, amt] }, "Approved"))) return;
  await tx.run("start", { address: PUSDC, abi: pusdcAbi, functionName: "deposit", args: [amt] }, "10,000 pUSDC added to your wallet");
}

/** 3 steps: backup wallet → how careful → review. */
export function SetupWizard({ me, tx, onClose, noEth }: { me: Address; tx: Tx; onClose: () => void; noEth?: boolean }) {
  const [step, setStep] = useState(0);
  const [backup, setBackup] = useState("");
  const [owns, setOwns] = useState(false);
  const [preset, setPreset] = useState("everyday");
  const [custom, setCustom] = useState<Settings>(PRESETS[2].s);
  const s = preset === "custom" ? custom : PRESETS.find((x) => x.id === preset)!.s;

  const backupError = !backup ? "Enter your backup wallet's address." : !isAddress(backup) ? "That doesn't look like an address." : backup.toLowerCase() === me.toLowerCase() ? "Your backup has to be a different wallet from this one." : undefined;
  const settingsError = limitError(s.limit) ?? daysError(s.hold, BOUNDS.hold) ?? daysError(s.off, BOUNDS.offDelay) ?? daysError(s.lock, BOUNDS.lock);

  async function confirm() {
    const ok = await tx.run("protect", { address: PUSDC, abi: pusdcAbi, functionName: "protect", args: [backup as Address, limitUnits(s.limit), toSeconds(s.hold), toSeconds(s.off), toSeconds(s.lock)] }, "Protection is on");
    if (ok) onClose();
  }

  return (
    <Card className="space-y-4">
      <div className="flex items-center gap-2">
        <button onClick={step === 0 ? onClose : () => setStep(step - 1)} className="rounded-full p-1 hover:bg-muted" aria-label="Back"><ArrowLeft className="size-5" /></button>
        <h2 className="font-extrabold">Turn on protection <span className="text-sm font-medium text-muted-foreground">· step {step + 1} of 3</span></h2>
      </div>

      {step === 0 && (
        <>
          <p className="text-sm text-muted-foreground">Your backup wallet is the one that can stop a suspicious transfer or move your funds to safety. Choose a wallet you control, ideally on a different device, that you don't use every day.</p>
          <Field label="Backup wallet address" htmlFor="bk" error={backup ? backupError : undefined}>
            <input id="bk" className={`${inputClass} font-mono text-sm`} value={backup} onChange={(e) => setBackup(e.target.value.trim())} placeholder="0x…" />
          </Field>
          <Notice tone="warning" title="Double-check this one.">Whoever controls the backup can move your funds to themselves in an emergency. Changing it later takes {" "}a week.</Notice>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={owns} onChange={(e) => setOwns(e.target.checked)} />I control this wallet and have its recovery phrase.</label>
          <Button className="w-full" disabled={!!backupError || !owns} onClick={() => setStep(1)}>Next <ArrowRight className="size-4" aria-hidden /></Button>
        </>
      )}

      {step === 1 && (
        <>
          <div role="radiogroup" aria-label="Protection level" className="space-y-2">
            {PRESETS.map((x) => (
              <button key={x.id} role="radio" aria-checked={preset === x.id} onClick={() => setPreset(x.id)}
                className={`w-full rounded-2xl border p-3 text-left ${preset === x.id ? "border-primary bg-primary-soft" : "border-border hover:bg-muted"}`}>
                <span className="flex items-center gap-1.5 font-semibold">{x.title}{preset === x.id && <Check className="size-4 text-primary" aria-hidden />}</span>
                <span className="text-sm text-muted-foreground">{x.body}</span>
              </button>
            ))}
          </div>
          {preset === "custom" && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Daily limit (pUSDC)" htmlFor="c-limit" error={limitError(custom.limit)}><input id="c-limit" className={inputClass} inputMode="decimal" value={custom.limit} onChange={(e) => setCustom({ ...custom, limit: e.target.value })} /></Field>
              <Field label="Big transfers wait (days)" htmlFor="c-hold" error={daysError(custom.hold, BOUNDS.hold)}><input id="c-hold" className={inputClass} inputMode="numeric" value={custom.hold} onChange={(e) => setCustom({ ...custom, hold: e.target.value })} /></Field>
              <Field label="Turning off waits (days)" htmlFor="c-off" error={daysError(custom.off, BOUNDS.offDelay)}><input id="c-off" className={inputClass} inputMode="numeric" value={custom.off} onChange={(e) => setCustom({ ...custom, off: e.target.value })} /></Field>
              <Field label="Safety lock (days)" htmlFor="c-lock" error={daysError(custom.lock, BOUNDS.lock)}><input id="c-lock" className={inputClass} inputMode="numeric" value={custom.lock} onChange={(e) => setCustom({ ...custom, lock: e.target.value })} /></Field>
            </div>
          )}
          <Button className="w-full" disabled={!!settingsError} onClick={() => setStep(2)}>Review <ArrowRight className="size-4" aria-hidden /></Button>
        </>
      )}

      {step === 2 && (
        <>
          <ul className="space-y-2 rounded-2xl bg-muted p-4 text-sm">
            <li>Up to <b>{fmtAmount(limitUnits(s.limit))} pUSDC a day</b> goes out instantly.</li>
            <li>Anything bigger waits <b>{fmtDuration(Number(s.hold) * 86400)}</b>. You or your backup can stop it.</li>
            <li>Loosening protection takes <b>{fmtDuration(Number(s.off) * 86400)}</b> to apply (making it stricter is instant).</li>
            <li>In an emergency, funds move to <span className="font-mono">{backup.slice(0, 6)}…{backup.slice(-4)}</span> and stay locked for <b>{fmtDuration(Number(s.lock) * 86400)}</b>.</li>
          </ul>
          {noEth && <Notice tone="warning" title="You need a little ETH first.">Turning protection on is a network transaction. Copy your address and paste it into a free <a className="underline" href={FAUCET} target="_blank" rel="noreferrer">Base Sepolia faucet</a>, then come back.</Notice>}
          <Notice tone="success" icon={<ShieldCheck />}>Receiving money is never slowed down.</Notice>
          <Button className="w-full" loading={tx.busy === "protect"} onClick={confirm}>Turn on protection</Button>
        </>
      )}
    </Card>
  );
}
