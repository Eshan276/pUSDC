import { useEffect, useState } from "react";
import { formatUnits, getAddress, type Address } from "viem";
import { ArrowLeft, ArrowRight, Check, Clock, FastForward, Send, KeyRound, LifeBuoy, PackageOpen, Pencil, ShieldCheck, TriangleAlert, Wallet, Zap } from "lucide-react";
import { pusdcAbi } from "../abi";
import { DECIMALS, IS_TESTNET, Param, PUSDC, type ParamId } from "../config";
import { durationError, fromSeconds, toSeconds, useBounds, type Bound, type Dur, type Unit } from "../lib/duration";
import { addressProblem, fmtAmount, fmtCountdown, fmtDate, fmtDuration, parseAmount, shortAddr } from "../lib/format";
import { isStricter, rememberBackup, type ProtectionData } from "../lib/useProtection";
import { useTx } from "../lib/useTx";
import { Button, Card, Field, HoldButton, Notice, inputClass, useNow } from "./ui";

const p = { address: PUSDC, abi: pusdcAbi } as const;

type Settings = { limit: string; hold: Dur; off: Dur; lock: Dur };
const d = (n: number, unit: Unit): Dur => ({ n: String(n), unit });
const EVERYDAY: Settings = { limit: "1000", hold: d(3, "days"), off: d(7, "days"), lock: d(7, "days") };
const SAVINGS: Settings = { limit: "100", hold: d(7, "days"), off: d(30, "days"), lock: d(30, "days") };
const QUICK: Settings = { limit: "100", hold: d(2, "minutes"), off: d(5, "minutes"), lock: d(3, "minutes") };

function presetsFor(isDemo: boolean): { id: string; title: string; body: string; s?: Settings }[] {
  return [
    ...(isDemo ? [{ id: "quick", title: "Quick demo", body: "Minutes instead of days, so you can watch everything happen live.", s: QUICK }] : []),
    { id: "everyday", title: "Everyday", body: "For money you spend. Up to 1,000 a day is instant; more waits 3 days.", s: EVERYDAY },
    { id: "savings", title: "Savings", body: "For money you rarely touch. 100 a day is instant; more waits a week.", s: SAVINGS },
    { id: "custom", title: "Custom", body: "Choose every number yourself, in minutes, hours or days." },
  ];
}

/** A whole number plus a minutes/hours/days picker. */
function DurationInput({ id, value, onChange, invalid }: { id: string; value: Dur; onChange: (d: Dur) => void; invalid?: boolean }) {
  return (
    <div className="flex gap-2">
      <input id={id} inputMode="numeric" value={value.n} aria-invalid={invalid} onChange={(e) => onChange({ ...value, n: e.target.value.trim() })} className={`${inputClass} min-w-0 flex-1`} />
      <select aria-label="Unit" value={value.unit} onChange={(e) => onChange({ ...value, unit: e.target.value as Unit })} className={inputClass.replace("w-full", "w-32 shrink-0")}>
        <option value="minutes">minutes</option>
        <option value="hours">hours</option>
        <option value="days">days</option>
      </select>
    </div>
  );
}

function limitError(v: string) {
  if (v.trim() === "0") return;
  if (!parseAmount(v)) return "Enter an amount (0 means every transfer waits).";
}
const limitUnits = (v: string) => (v.trim() === "0" ? 0n : parseAmount(v) ?? 0n);

export function ProtectionPanel({ d, address }: { d: ProtectionData; address: Address }) {
  if (!d.protected) return <SetupWizard address={address} hasFunds={d.balance > 0n} />;
  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <div className="space-y-6 lg:col-span-3">
        <SettingsCard d={d} address={address} />
        <TurnOffCard d={d} address={address} />
      </div>
      <div className="lg:col-span-2">
        <EmergencyCard d={d} address={address} />
      </div>
    </div>
  );
}

/* ───────────────────────── setup wizard ───────────────────────── */

function SetupWizard({ address, hasFunds }: { address: Address; hasFunds: boolean }) {
  const { run, busy } = useTx();
  const [step, setStep] = useState(0);
  const [backup, setBackup] = useState("");
  const [owns, setOwns] = useState(false);
  const bounds = useBounds();
  const presets = presetsFor(bounds.isDemo);
  const [preset, setPreset] = useState(bounds.isDemo ? "quick" : "everyday");
  const [custom, setCustom] = useState<Settings>(bounds.isDemo ? QUICK : { limit: "500", hold: d(1, "days"), off: d(7, "days"), lock: d(1, "days") });
  const [picked, setPicked] = useState(false);
  // Bounds arrive from the contract after the first render: on a demo deployment, start on "Quick demo".
  useEffect(() => {
    if (bounds.loaded && bounds.isDemo && !picked) {
      setPreset("quick");
      setCustom(QUICK);
    }
  }, [bounds.loaded, bounds.isDemo, picked]);
  const [fastLane, setFastLane] = useState(false);
  const [tried, setTried] = useState(false);
  const s = (preset === "custom" ? custom : presets.find((x) => x.id === preset)?.s) ?? EVERYDAY;

  const backupError =
    addressProblem(backup, "Enter your backup wallet's address.") ??
    (backup.toLowerCase() === address.toLowerCase()
        ? "Your backup has to be a different wallet from this one."
        : !owns
          ? "Please confirm you control this wallet."
          : undefined);
  const errs = {
    limit: limitError(s.limit),
    hold: durationError(s.hold, bounds.hold),
    off: durationError(s.off, bounds.offDelay),
    lock: durationError(s.lock, bounds.lock),
  };
  const settingsOk = !Object.values(errs).some(Boolean);

  const next = () => {
    setTried(true);
    if (step === 0 && backupError) return;
    if (step === 1 && !settingsOk) return;
    setTried(false);
    setStep(step + 1);
  };
  const turnOn = async () => {
    // Remember the backup we chose, so the dashboard can flag a hijacked setup.
    rememberBackup(address, getAddress(backup));
    await run(
      "protect",
      {
        ...p,
        functionName: "protect",
        args: [getAddress(backup), limitUnits(s.limit), BigInt(toSeconds(s.hold)), BigInt(toSeconds(s.off)), BigInt(toSeconds(s.lock)), fastLane],
      },
      "You're protected 🎉",
    );
  };

  const steps = ["Backup wallet", "Your limits", "Review"];
  return (
    <Card className="mx-auto max-w-2xl">
      <ol className="mb-6 flex items-center gap-2 text-sm" aria-label="Setup progress">
        {steps.map((label, i) => (
          <li key={label} className="flex flex-1 items-center gap-2" aria-current={i === step ? "step" : undefined}>
            <span className={`grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold ${i < step ? "bg-primary text-primary-foreground" : i === step ? "bg-primary-soft text-primary-soft-foreground ring-2 ring-primary" : "bg-muted text-muted-foreground"}`}>
              {i < step ? <Check className="size-4" aria-hidden /> : i + 1}
            </span>
            <span className={`hidden sm:inline ${i === step ? "font-semibold" : "text-muted-foreground"}`}>{label}</span>
            {i < steps.length - 1 && <span className="h-px flex-1 bg-border" aria-hidden />}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <div className="space-y-5">
          <div>
            <h2 className="text-xl font-bold">First, pick a backup wallet</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              A second wallet that only you control, like a hardware wallet or a wallet on another device. It can stop suspicious transfers,
              and in an emergency your funds go there.
            </p>
          </div>
          <Field label="Backup wallet address" htmlFor="backup" error={tried ? backupError : undefined} hint="Tip: don't use a wallet on this same device. If this one is stolen, that one might be too.">
            <input id="backup" autoComplete="off" spellCheck={false} placeholder="0x…" value={backup} onChange={(e) => setBackup(e.target.value.trim())} className={`${inputClass} font-mono text-sm`} />
          </Field>
          <Notice tone={hasFunds ? "warning" : "info"} icon={<KeyRound />} title="Best on a fresh wallet">
            Protection guards against theft from now on. If anyone might already have this wallet's key, set up protection on a brand-new
            wallet instead, then move your funds in.{hasFunds ? " This wallet already holds funds, so be sure its key has never been exposed." : ""}
          </Notice>
          <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg bg-muted p-4 text-sm">
            <input type="checkbox" checked={owns} onChange={(e) => setOwns(e.target.checked)} className="mt-0.5 size-5 accent-[var(--primary)]" />
            <span>I control this wallet and its recovery phrase is saved somewhere safe.</span>
          </label>
        </div>
      )}

      {step === 1 && (
        <div className="space-y-5">
          <div>
            <h2 className="text-xl font-bold">How careful should it be?</h2>
            <p className="mt-1 text-sm text-muted-foreground">You can tighten these any time, instantly. Loosening them later takes a waiting period.</p>
          </div>
          <div className={`grid gap-3 sm:grid-cols-2 ${presets.length === 3 ? "lg:grid-cols-3" : "lg:grid-cols-4"}`} role="radiogroup" aria-label="Protection style">
            {presets.map((x) => (
              <button
                key={x.id}
                role="radio"
                aria-checked={preset === x.id}
                onClick={() => (setPreset(x.id), setPicked(true))}
                className={`rounded-lg border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${preset === x.id ? "border-primary bg-primary-soft" : "border-border hover:bg-muted"}`}
              >
                <span className="flex items-center justify-between font-bold">
                  {x.title} {preset === x.id && <Check className="size-4 text-primary" aria-hidden />}
                </span>
                <span className="mt-1 block text-sm text-muted-foreground">{x.body}</span>
              </button>
            ))}
          </div>
          {preset === "custom" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Instant spending per day (pUSDC)" htmlFor="c-limit" error={tried ? errs.limit : undefined}>
                <input id="c-limit" inputMode="decimal" value={custom.limit} onChange={(e) => setCustom({ ...custom, limit: e.target.value })} className={inputClass} />
              </Field>
              <Field label="Bigger transfers wait" htmlFor="c-hold" error={tried ? errs.hold : undefined} hint={rangeHint(bounds.hold)}>
                <DurationInput id="c-hold" value={custom.hold} invalid={tried && !!errs.hold} onChange={(v) => setCustom({ ...custom, hold: v })} />
              </Field>
              <Field label="Loosening settings waits" htmlFor="c-off" error={tried ? errs.off : undefined} hint={rangeHint(bounds.offDelay)}>
                <DurationInput id="c-off" value={custom.off} invalid={tried && !!errs.off} onChange={(v) => setCustom({ ...custom, off: v })} />
              </Field>
              <Field label="Emergency lock" htmlFor="c-lock" error={tried ? errs.lock : undefined} hint={rangeHint(bounds.lock)}>
                <DurationInput id="c-lock" value={custom.lock} invalid={tried && !!errs.lock} onChange={(v) => setCustom({ ...custom, lock: v })} />
              </Field>
            </div>
          )}
          <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-border p-4 text-sm">
            <input type="checkbox" checked={fastLane} onChange={(e) => setFastLane(e.target.checked)} className="mt-0.5 size-5 accent-[var(--primary)]" />
            <span className="space-y-1">
              <span className="block font-semibold">Let my backup approve big transfers instantly (optional)</span>
              <span className="block text-muted-foreground">
                Skip the wait when your backup says yes. Only turn this on if your backup is held by someone else, or kept somewhere you
                can't reach quickly. Someone forcing you could otherwise make you approve with both.
              </span>
            </span>
          </label>
          {IS_TESTNET && !bounds.isDemo && preset !== "custom" && (
            <p className="text-sm text-muted-foreground">Trying it out? Pick Custom with the shortest waits, so you can watch a scheduled transfer go through.</p>
          )}
        </div>
      )}

      {step === 2 && (
        <div className="space-y-5">
          <h2 className="text-xl font-bold">Here's how you'll be protected</h2>
          <ul className="space-y-3">
            {[
              { icon: Zap, text: limitUnits(s.limit) > 0n ? `Up to ${fmtAmount(limitUnits(s.limit))} pUSDC a day goes out instantly.` : "Every transfer waits. Nothing goes out instantly." },
              { icon: Clock, text: `Anything more waits ${fmtDuration(toSeconds(s.hold))}. You or your backup can cancel it during that time.` },
              { icon: Wallet, text: `Your backup wallet is ${shortAddr(backup)}.` },
              ...(fastLane ? [{ icon: FastForward, text: "Your backup can approve a big transfer to send it right away." }] : []),
              {
                icon: Send,
                text: `Heads up: a big send from MetaMask or any other wallet app is scheduled too. Your wallet shows it as sent, but the recipient only gets it after ${fmtDuration(toSeconds(s.hold))}${fastLane ? " (or when your backup approves)" : ""}. Don't use big sends for payments that must arrive now.`,
              },
              { icon: LifeBuoy, text: `In an emergency, everything moves to your backup and stays locked for ${fmtDuration(toSeconds(s.lock))}.` },
              { icon: ShieldCheck, text: `Turning protection off or loosening any setting takes ${fmtDuration(toSeconds(s.off))}.` },
            ].map(({ icon: Icon, text }) => (
              <li key={text} className="flex gap-3 rounded-lg bg-muted p-4 text-sm">
                <Icon className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
                {text}
              </li>
            ))}
          </ul>
          <p className="text-sm text-muted-foreground">Turning this on is instant and costs only a small network fee.</p>
        </div>
      )}

      <div className="mt-6 flex justify-between gap-3">
        {step > 0 ? (
          <Button variant="ghost" onClick={() => setStep(step - 1)}>
            <ArrowLeft className="size-4" aria-hidden /> Back
          </Button>
        ) : (
          <span />
        )}
        {step < 2 ? (
          <Button onClick={next}>
            Continue <ArrowRight className="size-4" aria-hidden />
          </Button>
        ) : (
          <Button onClick={turnOn} loading={busy === "protect"}>
            <ShieldCheck className="size-4" aria-hidden /> Turn on protection
          </Button>
        )}
      </div>
    </Card>
  );
}

/* ───────────────────────── settings ───────────────────────── */

const rangeHint = (b: Bound) => `Between ${fmtDuration(b.min)} and ${fmtDuration(b.max)}`;

const ROWS: { param: ParamId; label: string; help: string; unit: "amount" | "time"; bound?: "hold" | "offDelay" | "lock" }[] = [
  { param: Param.DailyLimit, label: "Instant spending per day", help: "Lower is safer.", unit: "amount" },
  { param: Param.HoldWindow, label: "Bigger transfers wait", help: "Longer gives you more time to react.", unit: "time", bound: "hold" },
  { param: Param.OffDelay, label: "Loosening settings waits", help: "Also how long turning protection off takes.", unit: "time", bound: "offDelay" },
  { param: Param.LockDuration, label: "Emergency lock", help: "How long funds stay locked after the emergency button.", unit: "time", bound: "lock" },
];

function SettingsCard({ d, address }: { d: ProtectionData; address: Address }) {
  const current: Record<number, bigint> = { 0: d.dailyLimit, 1: BigInt(d.holdWindow), 2: BigInt(d.offDelay), 3: BigInt(d.lockDuration) };
  return (
    <Card className="space-y-2">
      <h2 className="text-lg font-bold">Your settings</h2>
      <p className="text-sm text-muted-foreground">Making things stricter applies instantly. Loosening waits {fmtDuration(d.offDelay)}, so a thief can't quietly undo your protection.</p>
      <ul className="divide-y divide-border">
        {ROWS.map((r) => (
          <ParamRow key={r.param} row={r} current={current[r.param]} d={d} />
        ))}
        <FastLaneRow d={d} />
        <BackupRow d={d} address={address} />
      </ul>
    </Card>
  );
}

function ParamRow({ row, current, d }: { row: (typeof ROWS)[number]; current: bigint; d: ProtectionData }) {
  const { run, busy } = useTx();
  const [editing, setEditing] = useState(false);
  const bounds = useBounds();
  const [v, setV] = useState("");
  const [dur, setDur] = useState<Dur>({ n: "", unit: "days" });
  const show = (x: bigint) => (row.unit === "amount" ? `${fmtAmount(x)} pUSDC` : fmtDuration(Number(x)));
  const err = row.unit === "amount" ? limitError(v) : durationError(dur, bounds[row.bound!]);
  const value = err ? 0n : row.unit === "amount" ? limitUnits(v) : BigInt(toSeconds(dur));
  const instant = !err && isStricter(row.param, value, current);
  const id = `param-${row.param}`;

  const save = async () => {
    if (err) return;
    const ok = await run(
      id,
      { ...p, functionName: "setParam", args: [row.param, value] },
      instant ? "Updated. You're even safer now" : `Change scheduled for ${fmtDate(Math.floor(Date.now() / 1000) + d.offDelay)}`,
    );
    if (ok) setEditing(false);
  };

  return (
    <li className="py-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-semibold">{row.label}</p>
          <p className="text-sm text-muted-foreground">{row.help}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="whitespace-nowrap font-bold tabular">{show(current)}</span>
          {!editing && (
            <button
              onClick={() => (row.unit === "amount" ? setV(formatUnits(current, DECIMALS)) : setDur(fromSeconds(Number(current))), setEditing(true))}
              aria-label={`Change ${row.label}`}
              className="grid size-10 place-items-center rounded-md text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Pencil className="size-4" aria-hidden />
            </button>
          )}
        </div>
      </div>
      {editing && (
        <div className="mt-3 space-y-3 rounded-lg bg-muted p-4">
          <Field label={row.unit === "amount" ? "New value (pUSDC)" : "New value"} htmlFor={id} error={err && (v || dur.n) ? err : undefined} hint={row.bound ? rangeHint(bounds[row.bound]) : undefined}>
            {row.unit === "amount" ? (
              <input id={id} inputMode="decimal" value={v} onChange={(e) => setV(e.target.value)} className={inputClass} />
            ) : (
              <DurationInput id={id} value={dur} onChange={setDur} />
            )}
          </Field>
          {!err &&
            (instant ? (
              <Notice tone="success" icon={<Zap />}>Stricter, so this applies instantly.</Notice>
            ) : (
              <Notice tone="warning" icon={<Clock />}>
                Looser, so this waits {fmtDuration(d.offDelay)} and applies {fmtDate(Math.floor(Date.now() / 1000) + d.offDelay)}.
              </Notice>
            ))}
          <div className="flex gap-2">
            <Button onClick={save} loading={busy === id} disabled={!!err}>
              Save
            </Button>
            <Button variant="ghost" onClick={() => setEditing(false)}>
              Never mind
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

function FastLaneRow({ d }: { d: ProtectionData }) {
  const { run, busy } = useTx();
  const pending = d.fastLaneAt > 0;
  return (
    <li className="py-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-semibold">Backup can approve instantly</p>
          <p className="text-sm text-muted-foreground">
            {d.fastLane
              ? "On: your backup can send a scheduled transfer right away."
              : pending
                ? `Turning on ${fmtDate(d.fastLaneAt)}.`
                : "Off: big transfers always wait."}
          </p>
        </div>
        {d.fastLane || pending ? (
          <Button
            variant="secondary"
            loading={busy === "lane"}
            onClick={() => run("lane", { ...p, functionName: "setFastLane", args: [false] }, pending ? "Cancelled" : "Turned off. Big transfers always wait now")}
          >
            {pending ? "Cancel" : "Turn off"}
          </Button>
        ) : (
          <Button
            variant="secondary"
            loading={busy === "lane"}
            onClick={() => run("lane", { ...p, functionName: "setFastLane", args: [true] }, `Scheduled: turns on ${fmtDate(Math.floor(Date.now() / 1000) + d.offDelay)}`)}
          >
            Turn on…
          </Button>
        )}
      </div>
      {!d.fastLane && !pending && (
        <p className="mt-2 text-xs text-muted-foreground">Turning this on is a loosening, so it waits {fmtDuration(d.offDelay)}. Turning it off is instant.</p>
      )}
    </li>
  );
}

function BackupRow({ d, address }: { d: ProtectionData; address: Address }) {
  const { run, busy } = useTx();
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState("");
  const err = addressProblem(v) ?? (v.toLowerCase() === address.toLowerCase() ? "Your backup has to be a different wallet." : v.toLowerCase() === d.backup.toLowerCase() ? "That's already your backup." : undefined);
  const save = async () => {
    if (err) return;
    rememberBackup(address, getAddress(v));
    if (await run("backup", { ...p, functionName: "requestBackupChange", args: [getAddress(v)] }, `Backup change scheduled for ${fmtDate(Math.floor(Date.now() / 1000) + d.offDelay)}`)) setEditing(false);
  };
  return (
    <li className="py-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-semibold">Backup wallet</p>
          <p className="text-sm text-muted-foreground">Can stop transfers and receives funds in an emergency.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-bold">{shortAddr(d.backup)}</span>
          {!editing && (
            <button onClick={() => (setV(""), setEditing(true))} aria-label="Change backup wallet" className="grid size-10 place-items-center rounded-md text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <Pencil className="size-4" aria-hidden />
            </button>
          )}
        </div>
      </div>
      {editing && (
        <div className="mt-3 space-y-3 rounded-lg bg-muted p-4">
          <Field label="New backup wallet" htmlFor="new-backup" error={v ? err : undefined}>
            <input id="new-backup" autoComplete="off" spellCheck={false} placeholder="0x…" value={v} onChange={(e) => setV(e.target.value.trim())} className={`${inputClass} font-mono text-sm`} />
          </Field>
          <Notice tone="warning" icon={<Clock />}>
            Changing your backup always waits {fmtDuration(d.offDelay)}. Until then, your current backup keeps its powers.
          </Notice>
          <div className="flex gap-2">
            <Button onClick={save} loading={busy === "backup"} disabled={!!err}>
              Schedule change
            </Button>
            <Button variant="ghost" onClick={() => setEditing(false)}>
              Never mind
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

/* ───────────────────────── turn off + emergency ───────────────────────── */

function TurnOffCard({ d, address }: { d: ProtectionData; address: Address }) {
  const { run, busy } = useTx();
  const now = useNow();
  const [confirm, setConfirm] = useState(false);
  if (d.flagOffAt > 0)
    return (
      <Card className="space-y-3">
        <h2 className="text-lg font-bold">Turning protection off</h2>
        <p className="text-sm text-muted-foreground">
          Protection ends {fmtDate(d.flagOffAt)} (in {fmtCountdown(d.flagOffAt - now)}). Until then, everything stays protected.
        </p>
        <Button variant="secondary" loading={busy === "cancelOff"} onClick={() => run("cancelOff", { ...p, functionName: "cancelFlagOff" }, "Protection stays on")}>
          Keep me protected
        </Button>
      </Card>
    );
  return (
    <Card className="space-y-3">
      <h2 className="text-lg font-bold">Turn protection off</h2>
      <p className="text-sm text-muted-foreground">
        This takes {fmtDuration(d.offDelay)}, so nobody can switch it off and drain you in a hurry. You can change your mind before then.
      </p>
      <Notice tone="warning" icon={<TriangleAlert />} title="Might someone else have this wallet's key?">
        Then don't turn protection off: whoever holds a copy of the key could take everything the moment it ends. Move your funds to a
        new wallet instead. They stay protected on the way.
      </Notice>
      <MoveOut d={d} address={address} />
      {!confirm ? (
        <Button variant="secondary" onClick={() => setConfirm(true)}>
          Turn off protection…
        </Button>
      ) : (
        <div className="space-y-3 rounded-lg bg-muted p-4">
          <p className="text-sm font-semibold">Protection would end {fmtDate(Math.floor(Date.now() / 1000) + d.offDelay)}. Start the countdown?</p>
          <div className="flex gap-2">
            <Button variant="secondary" loading={busy === "off"} onClick={async () => (await run("off", { ...p, functionName: "requestFlagOff" }, "Countdown started")) && setConfirm(false)}>
              Yes, start countdown
            </Button>
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              Keep it on
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function EmergencyCard({ d, address }: { d: ProtectionData; address: Address }) {
  const { run, busy } = useTx();
  return (
    <Card className="space-y-4 border-danger/40">
      <div className="flex items-center gap-3">
        <span className="grid size-11 place-items-center rounded-lg bg-danger-soft text-danger-soft-foreground">
          <LifeBuoy className="size-5" aria-hidden />
        </span>
        <h2 className="text-lg font-bold">Emergency button</h2>
      </div>
      <p className="text-sm leading-relaxed text-muted-foreground">
        Being threatened, or think your key was stolen? This sends{" "}
        {d.available > 0n ? `all ${fmtAmount(d.available)} pUSDC` : "any pUSDC you hold (right now you have none free)"} to your backup (
        {shortAddr(d.backup)}) and locks it there for {fmtDuration(d.lockDuration)}. Nobody can move it during that time, not even you. Any scheduled transfers are
        cancelled.
      </p>
      <HoldButton loading={busy === "stress"} onConfirm={() => run("stress", { ...p, functionName: "stress", args: [address] }, "Your funds are safe with your backup")}>
        Hold to send everything to safety
      </HoldButton>
      <p className="text-xs text-muted-foreground">Press and hold for 1.5 seconds. Your backup wallet can also do this for you from the "I'm a backup" tab.</p>
    </Card>
  );
}

/** Safer than switching protection off: send everything to a fresh wallet (scheduled if above the daily limit). */
function MoveOut({ d, address }: { d: ProtectionData; address: Address }) {
  const { run, busy } = useTx();
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState("");
  const [tried, setTried] = useState(false);
  const err = addressProblem(to, "Enter your new wallet's address.") ?? (to.toLowerCase() === address.toLowerCase() ? "That's this same wallet." : to.toLowerCase() === d.backup.toLowerCase() ? "Use a new wallet, not your backup." : undefined);
  const instant = d.available <= d.dailyRemaining;
  if (!open)
    return (
      <Button variant="secondary" onClick={() => setOpen(true)} disabled={d.available === 0n}>
        <PackageOpen className="size-4" aria-hidden /> Move everything to a new wallet
      </Button>
    );
  return (
    <form
      className="space-y-3 rounded-lg bg-muted p-4"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        setTried(true);
        if (err) return;
        const ok = await run(
          "moveout",
          { ...p, functionName: instant ? "transfer" : "queueTransfer", args: [getAddress(to), d.available] },
          instant ? "Moved to your new wallet" : `Move scheduled for ${fmtDate(Math.floor(Date.now() / 1000) + d.holdWindow)}`,
        );
        if (ok) setOpen(false);
      }}
    >
      <Field label="New wallet address" htmlFor="moveout" error={tried ? err : undefined} hint="Ideally a brand-new wallet. Turn protection on there before or right after the funds arrive.">
        <input id="moveout" autoComplete="off" spellCheck={false} placeholder="0x…" value={to} onChange={(e) => setTo(e.target.value.trim())} className={`${inputClass} font-mono text-sm`} />
      </Field>
      <p className="text-sm">
        {instant
          ? `${fmtAmount(d.available)} pUSDC is within today's limit, so it moves instantly.`
          : `${fmtAmount(d.available)} pUSDC is above today's limit, so the move waits ${fmtDuration(d.holdWindow)}${d.fastLane ? ", or your backup can approve it right away" : ""}. Your backup can still stop it if it wasn't you.`}
      </p>
      <div className="flex gap-2">
        <Button type="submit" loading={busy === "moveout"}>
          {instant ? "Move now" : "Schedule the move"}
        </Button>
        <Button variant="ghost" type="button" onClick={() => setOpen(false)}>
          Never mind
        </Button>
      </div>
    </form>
  );
}
