import { useEffect, useState } from "react";
import { Clock, Copy, Eye as EyeIcon, KeyRound, Lock, Send, Settings, ShieldCheck, Wallet } from "lucide-react";
import type { Address } from "viem";
import { isAddress } from "viem";
import { pusdcAbi, usdcAbi } from "@abi";
import { Button, Card, Field, Notice, Progress, Skeleton, inputClass } from "@ui/ui";
import { useToast } from "@ui/toast";
import { PUSDC, USDC } from "../shared/chain";
import { fmtAmount, fmtDuration, fmtEth, parseAmount, shortAddr } from "../shared/format";
import type { WalletState } from "../shared/messages";
import { useProtection } from "./useWallet";
import { useSend } from "./useSend";
import { WaitingTab, GuardianTab } from "./Waiting";
import { MoreTab } from "./More";
import { Checklist, SetupWizard } from "./Protect";

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
  const [morePage, setMorePage] = useState<"security" | undefined>();
  const [backedUp, setBackedUp] = useState(true);
  const [hideList, setHideList] = useState(false);
  useEffect(() => {
    chrome.storage.local.get(["backedUp", "hideChecklist"]).then((r) => { setBackedUp(r.backedUp !== false); setHideList(!!r.hideChecklist); });
  }, []);
  const me = state.address as Address;
  const { data, error, reload } = useProtection(state.duress ? undefined : me);
  const tx = useSend(me, reload);

  if (state.duress) return <Decoy address={me} />;
  const waiting = data ? data.pending.length + data.pendingChanges.filter(Boolean).length + (data.pendingBackup ? 1 : 0) + (data.flagOffAt ? 1 : 0) : 0;

  return (
    <>
      <AddressChip address={me} />
      <BalanceBar data={data} />
      {error && <Notice tone="warning">Can't reach the network right now. Showing the last numbers we had.</Notice>}
      <main className="flex-1 space-y-4 pb-2" id="panel">
        {!backedUp && (
          <Notice tone="warning" icon={<KeyRound />} title="Back up your recovery phrase">
            You haven't confirmed it yet. <button className="underline" onClick={() => { setMorePage("security"); setTab("more"); }}>Show it now</button>.
          </Notice>
        )}
        {wizard && data ? <SetupWizard me={me} tx={tx} noEth={data.eth === 0n} onClose={() => setWizard(false)} /> : (<>
        {tab === "wallet" && data && !hideList && (
          <Checklist data={data} state={state} backedUp={backedUp} tx={tx} onProtect={() => setWizard(true)}
            onPin={() => { setMorePage("security"); setTab("more"); }}
            onDismiss={() => { setHideList(true); void chrome.storage.local.set({ hideChecklist: true }); }} />
        )}
        {tab === "wallet" && <WalletTab data={data} me={me} tx={tx} onProtect={() => setWizard(true)} />}
        {tab === "send" && <SendTab data={data} tx={tx} />}
        {tab === "waiting" && <WaitingTab data={data} tx={tx} />}
        {tab === "guard" && <GuardianTab state={state} me={me} refresh={refresh} />}
        {tab === "more" && <MoreTab data={data} me={me} tx={tx} state={state} refresh={refresh} initialPage={morePage} />}
        </>)}
      </main>
      <nav className="sticky bottom-0 grid grid-cols-5 gap-1 rounded-2xl border border-border bg-card p-1" aria-label="Sections">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => { setTab(id); setWizard(false); setMorePage(undefined); }} aria-current={tab === id ? "page" : undefined}
            className={`relative flex flex-col items-center gap-0.5 rounded-xl py-2 text-[11px] font-semibold ${tab === id ? "bg-primary-soft text-primary-soft-foreground" : "text-muted-foreground hover:bg-muted"}`}>
            <Icon className="size-5" aria-hidden />{label}
            {id === "waiting" && waiting > 0 && <span className="absolute right-3 top-1 grid size-4 place-items-center rounded-full bg-warning-foreground text-[10px] text-warning-soft">{waiting}</span>}
          </button>
        ))}
      </nav>
    </>
  );
}

/** Always-visible balances, so they're on screen in every tab and in the setup wizard. */
function BalanceBar({ data }: { data: D }) {
  if (!data) return <Skeleton className="h-14" />;
  const lowEth = data.eth < LOW_ETH;
  const cell = (label: string, value: string, warn?: boolean) => (
    <div className={`min-w-0 flex-1 rounded-2xl px-3 py-2 ${warn ? "bg-warning-soft text-warning-foreground" : "bg-muted"}`}>
      <p className="truncate text-[11px] opacity-80">{label}</p>
      <p className="truncate text-sm font-extrabold">{value}</p>
    </div>
  );
  return (
    <div className="flex gap-2" role="group" aria-label="Balances">
      {cell("pUSDC", fmtAmount(data.balance))}
      {cell("USDC", fmtAmount(data.usdcBalance))}
      {cell(lowEth ? "ETH · low" : "ETH", fmtEth(data.eth), lowEth)}
    </div>
  );
}

function AddressChip({ address }: { address: Address }) {
  const toast = useToast();
  return (
    <button className="flex items-center gap-2 self-start rounded-full bg-muted px-3 py-1.5 font-mono text-xs"
      onClick={() => navigator.clipboard.writeText(address).then(() => toast.show({ kind: "success", title: "Address copied" }))}
      aria-label="Copy your address">
      {shortAddr(address)}<Copy className="size-3.5" aria-hidden />
    </button>
  );
}

/** What an attacker sees after a duress unlock: an ordinary, empty wallet that cannot move anything. */
function Decoy({ address }: { address: Address }) {
  return (
    <>
      <AddressChip address={address} />
      <Card className="space-y-1"><p className="text-sm text-muted-foreground">Balance</p><p className="text-3xl font-extrabold">0 <span className="text-base font-semibold text-muted-foreground">pUSDC</span></p></Card>
      <p className="text-center text-sm text-muted-foreground">No assets yet.</p>
    </>
  );
}

type Tx = ReturnType<typeof useSend>;
const LOW_ETH = 200_000_000_000_000n; // 0.0002 ETH, enough for roughly a handful of actions on Base

function Row({ label, value, low }: { label: string; value: string; low?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={`shrink-0 font-semibold ${low ? "text-warning-foreground" : ""}`}>{value}</dd>
    </div>
  );
}
type D = ReturnType<typeof useProtection>["data"];

function WalletTab({ data, me, tx, onProtect }: { data: D; me: Address; tx: Tx; onProtect: () => void }) {
  const [amt, setAmt] = useState("");
  if (!data) return <Skeleton className="h-48" />;
  const wrapAmt = parseAmount(amt);

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
      <Card className="space-y-4">
        <div>
          <p className="text-sm text-muted-foreground">Ready to use</p>
          <p className="text-3xl font-extrabold">{fmtAmount(data.available)} <span className="text-base font-semibold text-muted-foreground">pUSDC</span></p>
          {data.balance === 0n && <p className="mt-1 text-sm text-muted-foreground">You don't have any pUSDC yet. Use "Add or take out money" below.</p>}
          {data.balance > 0n && data.available < data.balance && <p className="mt-1 text-sm text-muted-foreground">Total {fmtAmount(data.balance)} pUSDC, but part of it isn't free to move right now.</p>}
        </div>
        <dl className="divide-y divide-border rounded-2xl border border-border text-sm">
          <Row label="Total pUSDC" value={`${fmtAmount(data.balance)} pUSDC`} />
          {data.reserved > 0n && <Row label="Set aside for scheduled transfers" value={`${fmtAmount(data.reserved)} pUSDC`} />}
          {data.locked > 0n && <Row label={`Locked until ${new Date(data.lockedUntil * 1000).toLocaleDateString()}`} value={`${fmtAmount(data.locked)} pUSDC`} />}
          <Row label="Plain USDC (not protected yet)" value={`${fmtAmount(data.usdcBalance)} USDC`} />
          <Row label="ETH for network fees" value={`${fmtEth(data.eth)} ETH`} low={data.eth < LOW_ETH} />
        </dl>
        {data.eth < LOW_ETH && (
          <Notice tone="warning" title={data.eth === 0n ? "You have no ETH for network fees." : "You're low on ETH for network fees."}>
            Every action costs a tiny fee. Copy your address and paste it into a free <a className="underline" href="https://www.alchemy.com/faucets/base-sepolia" target="_blank" rel="noreferrer">Base Sepolia faucet</a>.
          </Notice>
        )}
      </Card>

      {data.protected ? <ProtectedStatus data={data} /> : (
        <Card className="space-y-3">
          <h2 className="flex items-center gap-2 font-extrabold"><ShieldCheck className="size-5 text-primary" aria-hidden />Protection is off</h2>
          <p className="text-sm text-muted-foreground">Right now this works like any other wallet. Turn protection on to keep small payments instant and give big ones a safety delay.</p>
          <Button className="w-full" onClick={onProtect}>Set up protection</Button>
        </Card>
      )}

      <Card className="space-y-3">
        <h2 className="font-extrabold">Add or take out money</h2>
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
    </>
  );
}

function ProtectedStatus({ data }: { data: NonNullable<D> }) {
  const used = data.dailyLimit === 0n ? 1 : Number(data.dailyLimit - data.dailyRemaining) / Number(data.dailyLimit);
  return (
    <Card className="space-y-3">
      <h2 className="flex items-center gap-2 font-extrabold text-primary"><ShieldCheck className="size-5" aria-hidden />You're protected</h2>
      <Progress value={Math.min(1, Math.max(0, used))} label="Daily limit used" />
      <p className="text-sm text-muted-foreground">{fmtAmount(data.dailyRemaining)} of {fmtAmount(data.dailyLimit)} pUSDC left today. Bigger transfers wait {fmtDuration(data.holdWindow)}. Backup: <span className="font-mono">{shortAddr(data.backup)}</span></p>
      {data.lockedUntil * 1000 > Date.now() && <Notice tone="warning" icon={<Lock />}>Some funds are locked for safety.</Notice>}
    </Card>
  );
}

function SendTab({ data, tx }: { data: D; tx: Tx }) {
  const [to, setTo] = useState("");
  const [amt, setAmt] = useState("");
  useEffect(() => { /* keep fields on refresh */ }, [data]);
  if (!data) return <Skeleton className="h-48" />;
  const amount = parseAmount(amt);
  const valid = isAddress(to);
  const tooMuch = !!amount && amount > data.available;
  const instant = !data.protected || (!!amount && amount <= data.dailyRemaining);

  async function go() {
    if (!amount || !valid) return;
    const call = instant
      ? { address: PUSDC, abi: pusdcAbi, functionName: "transfer", args: [to as Address, amount] }
      : { address: PUSDC, abi: pusdcAbi, functionName: "queueTransfer", args: [to as Address, amount] };
    if (await tx.run("send", call, instant ? "Sent" : "Scheduled. It will be ready after the waiting time.")) { setTo(""); setAmt(""); }
  }

  return (
    <Card className="space-y-4">
      <h2 className="text-lg font-extrabold">Send pUSDC</h2>
      <Field label="To" htmlFor="to" error={to && !valid ? "That doesn't look like an address." : undefined}>
        <input id="to" className={`${inputClass} font-mono text-sm`} value={to} onChange={(e) => setTo(e.target.value.trim())} placeholder="0x…" />
      </Field>
      <Field label="Amount" htmlFor="amt" error={tooMuch ? `Only ${fmtAmount(data.available)} is ready to use.` : undefined}>
        <input id="amt" inputMode="decimal" className={inputClass} value={amt} onChange={(e) => setAmt(e.target.value)} placeholder="0.00" />
      </Field>
      {amount && !tooMuch && (instant
        ? <Notice tone="success" icon={<Send />}>This goes out right away.</Notice>
        : <Notice tone="warning" icon={<Clock />} title={`This is over today's limit, so it will wait ${fmtDuration(data.holdWindow)}.`}>You can stop it any time before then, and so can your backup wallet.</Notice>)}
      <Button className="w-full" disabled={!valid || !amount || tooMuch} loading={tx.busy === "send"} onClick={go}>
        {instant ? "Send now" : "Schedule transfer"}
      </Button>
    </Card>
  );
}

