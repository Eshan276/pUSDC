import { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Clock, Eye, EyeOff, KeyRound, Lock, LifeBuoy, ShieldCheck, Zap } from "lucide-react";
import { Button, Card, Field, Notice, inputClass } from "@ui/ui";
import { call } from "./api";

/* ───────── shared bits ───────── */

function Pw({ id, value, onChange, label, hint, autoFocus }: { id: string; value: string; onChange: (v: string) => void; label: string; hint?: string; autoFocus?: boolean }) {
  const [show, setShow] = useState(false);
  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <div className="relative">
        <input id={id} type={show ? "text" : "password"} className={inputClass} value={value} autoFocus={autoFocus} onChange={(e) => onChange(e.target.value)} autoComplete="off" />
        <button type="button" onClick={() => setShow(!show)} aria-label={show ? "Hide password" : "Show password"} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
          {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
    </Field>
  );
}

export function strength(pw: string): { score: 0 | 1 | 2 | 3; label: string } {
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[a-z]/.test(pw) && /[A-Z0-9\W]/.test(pw)) s++;
  const score = Math.min(3, s) as 0 | 1 | 2 | 3;
  return { score, label: ["Too short", "Okay", "Good", "Strong"][score] };
}

function Meter({ pw }: { pw: string }) {
  const { score, label } = strength(pw);
  if (!pw) return null;
  return (
    <div className="space-y-1" aria-live="polite">
      <div className="flex gap-1" aria-hidden>
        {[1, 2, 3].map((i) => <span key={i} className={`h-1.5 flex-1 rounded-full ${i <= score ? (score === 1 ? "bg-warning-foreground" : "bg-primary") : "bg-muted"}`} />)}
      </div>
      <p className="text-xs text-muted-foreground">Password strength: {label}</p>
    </div>
  );
}

function Dots({ n, i }: { n: number; i: number }) {
  return (
    <div className="flex justify-center gap-1.5" role="img" aria-label={`Step ${i + 1} of ${n}`}>
      {Array.from({ length: n }, (_, k) => <span key={k} className={`h-1.5 rounded-full transition-all ${k === i ? "w-6 bg-primary" : "w-1.5 bg-border"}`} />)}
    </div>
  );
}

const SLIDES = [
  { icon: ShieldCheck, title: "Your dollars, with a seatbelt.", body: "Protected Wallet is a self-custody wallet for protected tokens like pUSDC. Only you hold the keys. We never see them." },
  { icon: Clock, title: "Small is instant. Big can wait.", body: "Everyday payments go through right away. Larger ones wait a few days first, so you have time to notice and stop anything that wasn't you." },
  { icon: LifeBuoy, title: "A backup who can step in.", body: "You pick a second wallet you control. If your keys are ever stolen or you're forced to unlock, it can pull your money to safety." },
] as const;

type Step = "intro" | "choose" | "password" | "phrase" | "quiz" | "import";

/* ───────── onboarding ───────── */

export function Onboarding({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<Step>("intro");
  const [slide, setSlide] = useState(0);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [agree, setAgree] = useState(false);
  const [phrase, setPhrase] = useState("");
  const [imported, setImported] = useState("");
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function go(fn: () => Promise<void>) {
    setErr(undefined); setBusy(true);
    try { await fn(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  const pwErr = pw.length < 8 ? "Use at least 8 characters." : pw !== pw2 ? "The two passwords don't match." : undefined;
  const flow = step === "import" ? "import" : "create";

  if (step === "intro") {
    const S = SLIDES[slide];
    return (
      <Card className="space-y-6 py-8 text-center">
        <span className="mx-auto grid size-16 place-items-center rounded-3xl bg-primary-soft text-primary"><S.icon className="size-8" aria-hidden /></span>
        <div className="space-y-2" aria-live="polite">
          <h2 className="text-xl font-extrabold">{S.title}</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">{S.body}</p>
        </div>
        <Dots n={SLIDES.length} i={slide} />
        <div className="flex gap-2">
          {slide > 0 && <Button variant="ghost" onClick={() => setSlide(slide - 1)} aria-label="Previous"><ArrowLeft className="size-4" /></Button>}
          <Button className="flex-1" onClick={() => (slide < SLIDES.length - 1 ? setSlide(slide + 1) : setStep("choose"))}>
            {slide < SLIDES.length - 1 ? "Next" : "Get started"} <ArrowRight className="size-4" aria-hidden />
          </Button>
        </div>
        {slide < SLIDES.length - 1 && <button className="text-xs text-muted-foreground underline" onClick={() => setStep("choose")}>Skip intro</button>}
      </Card>
    );
  }

  if (step === "choose")
    return (
      <Card className="space-y-4">
        <h2 className="text-xl font-extrabold">Set up your wallet</h2>
        <button onClick={() => setStep("password")} className="flex w-full items-center gap-3 rounded-2xl border border-border p-4 text-left hover:bg-muted">
          <Zap className="size-6 text-primary" aria-hidden /><span><span className="block font-semibold">Create a new wallet</span><span className="text-sm text-muted-foreground">Takes about two minutes.</span></span>
        </button>
        <button onClick={() => setStep("import")} className="flex w-full items-center gap-3 rounded-2xl border border-border p-4 text-left hover:bg-muted">
          <KeyRound className="size-6 text-primary" aria-hidden /><span><span className="block font-semibold">I have a recovery phrase</span><span className="text-sm text-muted-foreground">Bring a wallet you already use.</span></span>
        </button>
        <Button variant="ghost" onClick={() => setStep("intro")}><ArrowLeft className="size-4" aria-hidden />Back</Button>
      </Card>
    );

  if (step === "password" || step === "import")
    return (
      <Card className="space-y-4">
        <Dots n={flow === "create" ? 4 : 2} i={flow === "create" ? 0 : 0} />
        <h2 className="text-lg font-extrabold">{flow === "create" ? "Create a password" : "Import your wallet"}</h2>
        {flow === "import" && (
          <>
            <Notice tone="info" icon={<KeyRound />}>Your phrase is encrypted on this device and never leaves it.</Notice>
            <Field label="Recovery phrase" htmlFor="phrase" hint="12 or 24 words, separated by spaces.">
              <textarea id="phrase" rows={3} autoFocus className={`${inputClass} py-3 font-mono text-sm`} value={imported} onChange={(e) => setImported(e.target.value)} />
            </Field>
          </>
        )}
        <Pw id="pw" label="Password" value={pw} onChange={setPw} hint="It unlocks this wallet on this device. We can't reset it for you." autoFocus={flow === "create"} />
        <Meter pw={pw} />
        <Pw id="pw2" label="Repeat password" value={pw2} onChange={setPw2} />
        {flow === "create" && (
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={agree} onChange={(e) => setAgree(e.target.checked)} />I understand nobody can recover my wallet for me if I lose my password and recovery phrase.</label>
        )}
        {(err || (pw && pw2 && pwErr)) && <Notice tone="danger">{err ?? pwErr}</Notice>}
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => setStep("choose")}>Back</Button>
          <Button className="flex-1" loading={busy} disabled={!!pwErr || (flow === "create" ? !agree : !imported.trim())}
            onClick={() => go(async () => {
              if (flow === "create") {
                const r = await call<{ mnemonic: string }>({ t: "create", password: pw });
                await chrome.storage.local.set({ backedUp: false });
                setPhrase(r.mnemonic); setStep("phrase");
              } else {
                await call({ t: "import", mnemonic: imported, password: pw });
                await chrome.storage.local.set({ backedUp: true });
                onDone();
              }
            })}>
            {flow === "create" ? "Continue" : "Import wallet"}
          </Button>
        </div>
      </Card>
    );

  if (step === "phrase") return <Phrase phrase={phrase} onNext={() => setStep("quiz")} />;
  return <Quiz phrase={phrase} onBack={() => setStep("phrase")} onDone={async () => { await chrome.storage.local.set({ backedUp: true }); onDone(); }} />;
}

/* ───────── recovery phrase ───────── */

export function PhraseGrid({ phrase, hidden }: { phrase: string; hidden?: boolean }) {
  return (
    <ol className={`grid grid-cols-3 gap-2 rounded-2xl bg-muted p-3 text-sm ${hidden ? "select-none blur-sm" : ""}`} aria-hidden={hidden}>
      {phrase.split(" ").map((w, i) => (
        <li key={i} className="flex items-baseline gap-1.5 rounded-lg bg-card px-2 py-1.5"><span className="w-4 text-right text-[10px] text-muted-foreground">{i + 1}</span><span className="font-mono">{w}</span></li>
      ))}
    </ol>
  );
}

function Phrase({ phrase, onNext }: { phrase: string; onNext: () => void }) {
  const [shown, setShown] = useState(false);
  return (
    <Card className="space-y-4">
      <Dots n={4} i={1} />
      <h2 className="text-lg font-extrabold">Your recovery phrase</h2>
      <Notice tone="warning" icon={<KeyRound />} title="Write these 12 words on paper, in order.">
        Anyone with them controls your money. Never type them into a website, or take a screenshot.
      </Notice>
      <PhraseGrid phrase={phrase} hidden={!shown} />
      {!shown ? <Button variant="secondary" className="w-full" onClick={() => setShown(true)}><Eye className="size-4" aria-hidden />Reveal (make sure nobody is looking)</Button>
        : <Button className="w-full" onClick={onNext}>I wrote it down</Button>}
    </Card>
  );
}

function Quiz({ phrase, onBack, onDone }: { phrase: string; onBack: () => void; onDone: () => void }) {
  const words = phrase.split(" ");
  const idx = useMemo(() => {
    const s = new Set<number>();
    while (s.size < 3) s.add(Math.floor(Math.random() * words.length));
    return [...s].sort((a, b) => a - b);
  }, [words.length]);
  const [ans, setAns] = useState<string[]>(["", "", ""]);
  const [tried, setTried] = useState(false);
  const ok = idx.every((w, k) => ans[k].trim().toLowerCase() === words[w]);
  return (
    <Card className="space-y-4">
      <Dots n={4} i={2} />
      <h2 className="text-lg font-extrabold">Quick check</h2>
      <p className="text-sm text-muted-foreground">Type these words from your paper copy, to be sure you got it right.</p>
      {idx.map((w, k) => (
        <Field key={w} label={`Word #${w + 1}`} htmlFor={`q${k}`} error={tried && !ok && ans[k].trim().toLowerCase() !== words[w] ? "That's not the word." : undefined}>
          <input id={`q${k}`} className={`${inputClass} font-mono`} autoComplete="off" autoCapitalize="none" value={ans[k]} onChange={(e) => setAns(ans.map((a, j) => (j === k ? e.target.value : a)))} />
        </Field>
      ))}
      <div className="flex gap-2">
        <Button variant="ghost" onClick={onBack}>Show phrase again</Button>
        <Button className="flex-1" onClick={() => (ok ? onDone() : setTried(true))}><Check className="size-4" aria-hidden />Confirm</Button>
      </div>
    </Card>
  );
}

/* ───────── unlock ───────── */

export function Unlock({ onDone }: { onDone: () => void }) {
  const [pin, setPin] = useState("");
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(undefined);
    try { await call({ t: "unlock", pin }); onDone(); } catch (x) { setErr(x instanceof Error ? x.message : String(x)); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={submit}>
      <Card className="space-y-4">
        <h2 className="flex items-center gap-2 text-lg font-extrabold"><Lock className="size-5" aria-hidden />Welcome back</h2>
        <Field label="Password" htmlFor="pin" error={err}>
          <input id="pin" type="password" autoFocus className={inputClass} value={pin} onChange={(e) => setPin(e.target.value)} />
        </Field>
        <Button type="submit" className="w-full" loading={busy} disabled={!pin}>Unlock</Button>
      </Card>
    </form>
  );
}
