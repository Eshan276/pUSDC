import { useEffect, useState, type ReactNode } from "react";
import { ArrowDownToLine, Clock, Copy, Eye as EyeIcon, KeyRound, Plus, Send, Settings, ShieldCheck, Wallet } from "lucide-react";
import type { Address } from "viem";
import { isAddress } from "viem";
import { pusdcAbi, usdcAbi } from "@abi";
import { Button, Card, Field, Notice, Skeleton, inputClass } from "@ui/ui";
import { useToast } from "@ui/toast";
import { PUSDC, USDC } from "../shared/chain";
import { fmtAmount, fmtDuration, parseAmount } from "../shared/format";
import type { WalletState } from "../shared/messages";
import { useProtection } from "./useWallet";
import { useSend } from "./useSend";
import { WaitingTab, GuardianTab } from "./Waiting";
import { MoreTab } from "./More";
import { Checklist, SetupWizard } from "./Protect";
import { AccountBar, ActionRow, Assets, BalanceHero, LOW_ETH, SettingsRow } from "./wallet";

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
  const [morePage, setMorePage] = useState<"security" | "protection" | undefined>();
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
      <AccountBar address={me} />
      {error && <Notice tone="warning">Can't reach the network right now. Showing the last numbers we had.</Notice>}
      <main className="flex-1 space-y-4 pb-2" id="panel">
        {!backedUp && (
          <Notice tone="warning" icon={<KeyRound />} title="Back up your recovery phrase">
            You haven't confirmed it yet. <button className="underline" onClick={() => { setMorePage("security"); setTab("more"); }}>Show it now</button>.
          </Notice>
        )}
        {wizard && data ? <SetupWizard me={me} tx={tx} noEth={data.eth === 0n} onClose={() => setWizard(false)} /> : (<>
        {tab === "wallet" && <WalletTab data={data} me={me} tx={tx} waiting={waiting} checklist={checklist} onProtect={() => setWizard(true)} go={(t) => { setTab(t); setWizard(false); setMorePage(undefined); }} openProtection={() => { setMorePage("protection"); setTab("more"); }} />}
        {tab === "send" && <SendTab data={data} tx={tx} />}
        {tab === "waiting" && <WaitingTab data={data} tx={tx} />}
        {tab === "guard" && <GuardianTab state={state} me={me} refresh={refresh} />}
        {tab === "more" && <MoreTab data={data} me={me} tx={tx} state={state} refresh={refresh} initialPage={morePage} />}
        </>)}
      </main>
      <nav className="sticky bottom-0 grid grid-cols-5 gap-1 rounded-xl border border-border bg-card p-1" aria-label="Sections">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => { setTab(id); setWizard(false); setMorePage(undefined); }} aria-current={tab === id ? "page" : undefined}
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

function WalletTab({ data, me, tx, waiting, checklist, onProtect, go, openProtection }: {
  data: D; me: Address; tx: Tx; waiting: number; checklist: ReactNode; onProtect: () => void; go: (t: Tab) => void; openProtection: () => void;
}) {
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
        { label: "Add", icon: Plus, onClick: toAdd },
        { label: "Receive", icon: ArrowDownToLine, onClick: () => setReceive(!receive) },
        { label: "Waiting", icon: Clock, onClick: () => go("waiting"), badge: waiting },
      ]} />

      {checklist}

      {receive && (
        <Card className="space-y-3 text-center">
          <p className="text-sm text-muted-foreground">Send USDC or pUSDC on <b className="font-semibold text-foreground">Base Sepolia</b> to this address. Receiving is never slowed down.</p>
          <p className="break-all rounded-lg bg-muted p-3 font-mono text-xs leading-relaxed">{me}</p>
          <Button className="w-full" onClick={() => navigator.clipboard.writeText(me).then(() => toast.show({ kind: "success", title: "Address copied" }))}><Copy className="size-4" aria-hidden />Copy address</Button>
        </Card>
      )}

      <Assets data={data} onProtectUsdc={toAdd} />

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

