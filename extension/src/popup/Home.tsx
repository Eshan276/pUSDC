import { useEffect, useState, type ReactNode } from "react";
import { ArrowDownToLine, ArrowLeftRight, Clock, Copy, Eye as EyeIcon, KeyRound, Plus, Send, Settings, ShieldCheck, Wallet } from "lucide-react";
import type { Address } from "viem";
import { isAddress, encodeFunctionData, parseEther } from "viem";
import { pusdcAbi, usdcAbi } from "@abi";
import { Button, Card, Field, Notice, Skeleton, inputClass } from "@ui/ui";
import { useToast } from "@ui/toast";
import { PUSDC, USDC } from "../shared/chain";
import { estimateFee } from "../shared/fee";
import { fmtAmount, fmtDuration, fmtEth, parseAmount } from "../shared/format";
import type { WalletState } from "../shared/messages";
import { useActivity, useProtection } from "./useWallet";
import { useSend } from "./useSend";
import { WaitingTab, GuardianTab } from "./Waiting";
import { MoreTab } from "./More";
import { Checklist, SetupWizard } from "./Protect";
import { AccountBar, AccountSwitcher, ActionRow, ActivityRow, Assets, BalanceHero, FeeLine, LOW_ETH, SettingsRow } from "./wallet";
import { QrCode } from "./qr";
import { SwapScreen } from "./swap";

const TABS = [
  { id: "wallet", label: "Wallet", icon: Wallet },
  { id: "send", label: "Send", icon: Send },
  { id: "waiting", label: "Waiting", icon: Clock },
  { id: "guard", label: "Guard", icon: EyeIcon },
  { id: "more", label: "More", icon: Settings },
] as const;
type Tab = (typeof TABS)[number]["id"];

export function Home({ state, refresh }: { state: WalletState; refresh: () => void }) {
  const [tab, setTab] = useState<Tab>("wallet");
  const [wizard, setWizard] = useState(false);
  const [morePage, setMorePage] = useState<"security" | "protection" | "activity" | "sites" | undefined>();
  const [swapping, setSwapping] = useState(false);
  const [resetKey, setResetKey] = useState(0); // tapping the active tab goes back to its first screen
  const [backedUp, setBackedUp] = useState(true);
  const [hideList, setHideList] = useState(false);
  useEffect(() => {
    chrome.storage.local.get(["backedUp", "hideChecklist"]).then((r) => { setBackedUp(r.backedUp !== false); setHideList(!!r.hideChecklist); });
  }, []);
  const me = state.address as Address;
  const { data, error, reload } = useProtection(state.duress ? undefined : me);
  const tx = useSend(me, reload);

  if (state.duress) return <Decoy address={me} />;
  const checklist = data && !hideList ? (
    <Checklist data={data} state={state} backedUp={backedUp} tx={tx} onProtect={() => setWizard(true)}
      onPin={() => { setMorePage("security"); setTab("more"); }}
      onDismiss={() => { setHideList(true); void chrome.storage.local.set({ hideChecklist: true }); }} />
  ) : null;
  const waiting = data ? data.pending.length + data.pendingChanges.filter(Boolean).length + (data.pendingBackup ? 1 : 0) + (data.flagOffAt ? 1 : 0) : 0;

  return (
    <>
      <AccountSwitcher state={state} refresh={refresh} />
      {error && <Notice tone="warning">Can't reach the network right now. Showing the last numbers we had.</Notice>}
      <main className="flex-1 space-y-4 pb-2" id="panel">
        {!backedUp && (
          <Notice tone="warning" icon={<KeyRound />} title="Back up your recovery phrase">
            You haven't confirmed it yet. <button className="underline" onClick={() => { setMorePage("security"); setTab("more"); }}>Show it now</button>.
          </Notice>
        )}
        {swapping && data ? <SwapScreen data={data} me={me} tx={tx} onBack={() => setSwapping(false)} /> : wizard && data ? <SetupWizard me={me} tx={tx} noEth={data.eth === 0n} onClose={() => setWizard(false)} /> : (<>
        {tab === "wallet" && <WalletTab data={data} me={me} tx={tx} waiting={waiting} checklist={checklist} onProtect={() => setWizard(true)} go={(t) => { setTab(t); setWizard(false); setMorePage(undefined); }} openMore={(p) => { setMorePage(p); setTab("more"); }} onSwap={() => setSwapping(true)} />}
        {tab === "send" && <SendTab data={data} tx={tx} me={me} />}
        {tab === "waiting" && <WaitingTab data={data} tx={tx} />}
        {tab === "guard" && <GuardianTab state={state} me={me} refresh={refresh} />}
        {tab === "more" && <MoreTab key={resetKey} data={data} me={me} tx={tx} state={state} refresh={refresh} initialPage={morePage} />}
        </>)}
      </main>
      <nav className="sticky bottom-0 grid grid-cols-5 gap-1 rounded-xl border border-border bg-card p-1" aria-label="Sections">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => { if (id === tab) setResetKey((k) => k + 1); setTab(id); setWizard(false); setSwapping(false); setMorePage(undefined); }} aria-current={tab === id ? "page" : undefined}
            className={`relative flex flex-col items-center gap-0.5 rounded-lg py-2 font-mono text-[11px] font-medium ${tab === id ? "bg-primary-soft text-primary-soft-foreground" : "text-muted-foreground hover:bg-muted"}`}>
            <Icon className="size-5" aria-hidden />{label}
            {id === "waiting" && waiting > 0 && <span className="absolute right-3 top-1 grid size-4 place-items-center rounded-full bg-warning-foreground text-[10px] text-warning-soft">{waiting}</span>}
          </button>
        ))}
      </nav>
    </>
  );
}

/** What an attacker sees after a duress unlock: an ordinary, empty wallet that cannot move anything. */
function Decoy({ address }: { address: Address }) {
  return (
    <>
      <AccountBar address={address} />
      <Card className="space-y-1 !p-5">
        <p className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">Total balance</p>
        <p className="text-[2.2rem] font-light leading-none tracking-tight">$0.00</p>
        <p className="pt-1 font-mono text-xs text-muted-foreground">0 pUSDC</p>
      </Card>
      <p className="text-center text-sm text-muted-foreground">No assets yet.</p>
    </>
  );
}

type Tx = ReturnType<typeof useSend>;

type D = ReturnType<typeof useProtection>["data"];

function WalletTab({ data, me, tx, waiting, checklist, onProtect, go, openMore, onSwap }: {
  data: D; me: Address; tx: Tx; waiting: number; checklist: ReactNode; onProtect: () => void; go: (t: Tab) => void;
  openMore: (p: "protection" | "activity" | "sites") => void; onSwap: () => void;
}) {
  const openProtection = () => openMore("protection");
  const activity = useActivity(me);
  const [amt, setAmt] = useState("");
  const [receive, setReceive] = useState(false);
  const toast = useToast();
  if (!data) return <Skeleton className="h-48" />;
  const wrapAmt = parseAmount(amt);
  const toAdd = () => document.getElementById("add-money")?.scrollIntoView({ behavior: "smooth", block: "start" });

  async function wrap() {
    if (!wrapAmt) return;
    if (data!.usdcAllowance < wrapAmt) {
      const ok = await tx.run("approve", { address: USDC, abi: usdcAbi, functionName: "approve", args: [PUSDC, wrapAmt] }, "Approved");
      if (!ok) return;
    }
    if (await tx.run("wrap", { address: PUSDC, abi: pusdcAbi, functionName: "deposit", args: [wrapAmt] }, "Added to your protected balance")) setAmt("");
  }

  return (
    <>
      <BalanceHero data={data} onProtect={onProtect} onSettings={openProtection} />
      {data.eth < LOW_ETH && (
        <Notice tone="warning" title={data.eth === 0n ? "You have no ETH for network fees." : "You're low on ETH for network fees."}>
          Every action costs a tiny fee. Copy your address and paste it into a free <a className="underline" href="https://www.alchemy.com/faucets/base-sepolia" target="_blank" rel="noreferrer">Base Sepolia faucet</a>.
        </Notice>
      )}

      <ActionRow actions={[
        { label: "Send", icon: Send, onClick: () => go("send") },
        { label: "Swap", icon: ArrowLeftRight, onClick: onSwap },
        { label: "Add", icon: Plus, onClick: toAdd },
        { label: "Receive", icon: ArrowDownToLine, onClick: () => setReceive(!receive) },
        { label: "Waiting", icon: Clock, onClick: () => go("waiting"), badge: waiting },
      ]} />

      {receive && (
        <Card className="space-y-3 text-center">
          <QrCode value={me} label="QR code for your address" />
          <p className="text-sm text-muted-foreground">Send ETH, USDC or pUSDC on <b className="font-semibold text-foreground">Base Sepolia</b> to this address. Receiving is never slowed down.</p>
          <p className="break-all rounded-lg bg-muted p-3 font-mono text-xs leading-relaxed">{me}</p>
          <Button className="w-full" onClick={() => navigator.clipboard.writeText(me).then(() => toast.show({ kind: "success", title: "Address copied" }))}><Copy className="size-4" aria-hidden />Copy address</Button>
        </Card>
      )}

      {checklist}


      <Assets data={data} onProtectUsdc={toAdd} />

      <section aria-label="Recent activity">
        <div className="mb-2 flex items-center justify-between px-1">
          <h2 className="font-mono text-[11px] font-normal uppercase tracking-wide text-muted-foreground">Recent activity</h2>
          <button onClick={() => openMore("activity")} className="font-mono text-[11px] font-medium text-primary hover:underline">See all</button>
        </div>
        {activity.loading && !activity.items ? <Skeleton className="h-16" /> : activity.items?.length ? (
          <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">{activity.items.slice(0, 3).map((i) => <ActivityRow key={`${i.hash}${i.dir}${i.amount}`} item={i} />)}</ul>
        ) : <p className="rounded-2xl border border-border bg-card p-4 text-center text-sm text-muted-foreground">No activity yet.</p>}
      </section>

      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        <SettingsRow
          icon={ShieldCheck}
          title="Protection"
          sub={data.protected ? `Up to ${fmtAmount(data.dailyLimit)} pUSDC a day · bigger waits ${fmtDuration(data.holdWindow)}` : "Off. Set it up in a minute"}
          onClick={data.protected ? openProtection : onProtect}
        />
      </ul>

      <div id="add-money">
        <Card className="space-y-3">
          <h2 className="text-base">Add or take out money</h2>
          <Field label="Amount" htmlFor="wrap-amt"><input id="wrap-amt" inputMode="decimal" className={inputClass} value={amt} onChange={(e) => setAmt(e.target.value)} placeholder="0.00" /></Field>
          <div className="grid grid-cols-2 gap-2">
            <Button disabled={!wrapAmt || wrapAmt > data.usdcBalance} loading={tx.busy === "approve" || tx.busy === "wrap"} onClick={wrap}>Add (USDC → pUSDC)</Button>
            <Button variant="secondary" disabled={!wrapAmt || wrapAmt > data.available || (data.protected && wrapAmt > data.dailyRemaining)} loading={tx.busy === "unwrap"}
              onClick={() => tx.run("unwrap", { address: PUSDC, abi: pusdcAbi, functionName: "withdraw", args: [wrapAmt!] }, "Withdrawn to USDC")}>Take out</Button>
          </div>
          {data.protected && wrapAmt && wrapAmt > data.dailyRemaining && <p className="text-xs text-muted-foreground">Taking out counts toward your daily limit ({fmtAmount(data.dailyRemaining)} left today).</p>}
          <Button variant="ghost" className="w-full" loading={tx.busy === "faucet"}
            onClick={() => tx.run("faucet", { address: USDC, abi: usdcAbi, functionName: "mint", args: [me, 10_000_000000n] }, "10,000 test USDC added")}>
            Get 10,000 test USDC
          </Button>
        </Card>
      </div>
    </>
  );
}

type SendTok = "pUSDC" | "USDC" | "ETH";

function parseTok(s: string, tok: SendTok): bigint | undefined {
  const clean = s.replace(/[,\s_]/g, "");
  if (!/^\d*\.?\d*$/.test(clean) || clean === "" || clean === ".") return undefined;
  try {
    if (tok === "ETH") { const v = parseEther(clean); return v > 0n ? v : undefined; }
    return parseAmount(clean);
  } catch { return undefined; }
}

function SendTab({ data, tx, me }: { data: D; tx: Tx; me: Address }) {
  const [tok, setTok] = useState<SendTok>("pUSDC");
  const [to, setTo] = useState("");
  const [amt, setAmt] = useState("");
  const [fee, setFee] = useState<bigint>();
  const amount = data ? parseTok(amt, tok) : undefined;
  const valid = isAddress(to);
  const balance = !data ? 0n : tok === "pUSDC" ? data.available : tok === "USDC" ? data.usdcBalance : data.eth;
  const instant = !data || tok !== "pUSDC" || !data.protected || (!!amount && amount <= data.dailyRemaining);
  const shortOfEth = !!data && tok === "ETH" && !!amount && fee !== undefined && amount + fee > data.eth;
  const tooMuch = !!amount && (amount > balance || shortOfEth);

  // What the button will send, for the fee estimate.
  const call = !amount || !valid ? undefined
    : tok === "ETH" ? { to: to as Address, data: "0x" as `0x${string}`, value: amount }
    : tok === "USDC" ? { to: USDC, data: encodeFunctionData({ abi: usdcAbi, functionName: "transfer", args: [to as Address, amount] }) }
    : { to: PUSDC, data: encodeFunctionData({ abi: pusdcAbi, functionName: instant ? "transfer" : "queueTransfer", args: [to as Address, amount] }) };
  const callKey = call ? `${call.to}${call.data}${call.value ?? ""}` : "";
  useEffect(() => {
    setFee(undefined);
    if (!call || !data || (tok !== "ETH" && amount! > balance)) return;
    let live = true;
    void estimateFee({ from: me, ...call }).then((f) => live && setFee(f));
    return () => { live = false; };
  }, [callKey, me]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!data) return <Skeleton className="h-48" />;

  async function go() {
    if (!amount || !valid) return;
    const dest = to as Address;
    const ok = tok === "ETH" ? await tx.sendEth("send", dest, amount, "Sent ETH")
      : tok === "USDC" ? await tx.run("send", { address: USDC, abi: usdcAbi, functionName: "transfer", args: [dest, amount] }, "Sent USDC")
      : await tx.run("send", { address: PUSDC, abi: pusdcAbi, functionName: instant ? "transfer" : "queueTransfer", args: [dest, amount] }, instant ? "Sent" : "Scheduled. It will be ready after the waiting time.");
    if (ok) { setTo(""); setAmt(""); }
  }
  const unit = tok;

  return (
    <Card className="space-y-4">
      <h2 className="text-lg font-extrabold">Send</h2>
      <div className="grid grid-cols-3 gap-1 rounded-2xl bg-muted p-1" role="radiogroup" aria-label="Choose asset">
        {(["pUSDC", "USDC", "ETH"] as const).map((t) => (
          <button key={t} role="radio" aria-checked={tok === t} onClick={() => { setTok(t); setAmt(""); }} className={`min-h-10 rounded-xl text-sm font-semibold ${tok === t ? "bg-card shadow-sm" : "text-muted-foreground"}`}>{t}</button>
        ))}
      </div>
      <Field label="To" htmlFor="to" error={to && !valid ? "That doesn't look like an address." : undefined}>
        <input id="to" className={`${inputClass} font-mono text-sm`} value={to} onChange={(e) => setTo(e.target.value.trim())} placeholder="0x…" />
      </Field>
      <Field label="Amount" htmlFor="amt" error={tooMuch ? (shortOfEth ? "Not enough ETH for the amount plus the network fee." : `Only ${tok === "ETH" ? fmtEth(balance) : fmtAmount(balance)} ${unit} is ready to use.`) : undefined}>
        <input id="amt" inputMode="decimal" className={inputClass} value={amt} onChange={(e) => setAmt(e.target.value)} placeholder="0.00" />
      </Field>
      <p className="font-mono text-xs text-muted-foreground">Balance {tok === "ETH" ? fmtEth(balance) : fmtAmount(balance)} {unit}</p>
      {amount && !tooMuch && (instant
        ? <Notice tone="success" icon={<Send />}>This goes out right away.</Notice>
        : <Notice tone="warning" icon={<Clock />} title={`This is over today's limit, so it will wait ${fmtDuration(data.holdWindow)}.`}>You can stop it any time before then, and so can your backup wallet.</Notice>)}
      {!!amount && !tooMuch && valid && <FeeLine fee={fee} />}
      <Button className="w-full" disabled={!valid || !amount || tooMuch} loading={tx.busy === "send"} onClick={go}>
        {instant ? "Send now" : "Schedule transfer"}
      </Button>
    </Card>
  );
}

