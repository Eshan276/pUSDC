import {
  bytesToHex, createWalletClient, http, isAddress, hexToBigInt, type Address, type Hex,
} from "viem";
import { english, generateMnemonic, mnemonicToAccount, type HDAccount } from "viem/accounts";
import { encodeFunctionData } from "viem";
import { pusdcAbi } from "@abi";
import { CHAIN, CHAIN_ID_HEX, PUSDC, RPC_URL, cfgReady, publicClient } from "../shared/chain";
import { alertKeys, readProtection } from "../shared/read";
import { fmtAmount, shortAddr } from "../shared/format";
import type { Approval, ApprovalKind, Req, Res, WalletState } from "../shared/messages";
import { addDuress, changePassword, createVault, unlockVault, type VaultRecord } from "./vault";

// ---------- state ----------
// Secrets live only in chrome.storage.session (memory, never written to disk, cleared when the browser closes).
type Session = { mnemonic?: string; duress?: boolean; decoy?: Address };
const local = chrome.storage.local;
const session = chrome.storage.session;
const getSession = async (): Promise<Session> => ((await session.get("s")).s as Session) ?? {};
const setSession = (s: Session) => session.set({ s });
const getVault = async () => (await local.get("vault")).vault as VaultRecord | undefined;
const getWatch = async () => ((await local.get("watch")).watch as Address[] | undefined) ?? [];
const getAutolock = async () => ((await local.get("autolock")).autolock as number | undefined) ?? 15;
const getConnected = async () => ((await local.get("connected")).connected as string[] | undefined) ?? [];

// Deriving an HD account re-hashes the seed every time, so keep the ones we've made (memory only, like the session).
const accCache = new Map<string, HDAccount>();
const accountOf = (mnemonic: string, index = 0): HDAccount => {
  const k = `${index}:${mnemonic}`;
  let a = accCache.get(k);
  if (!a) { a = mnemonicToAccount(mnemonic, { addressIndex: index }); accCache.set(k, a); }
  return a;
};

// Several accounts from the same recovery phrase: how many, which one is active, and their names.
const MAX_ACCOUNTS = 10;
type Meta = { count: number; selected: number; names: Record<string, string> };
async function getMeta(): Promise<Meta> {
  const r = await local.get(["accountCount", "selected", "accountNames"]);
  const count = Math.min(MAX_ACCOUNTS, Math.max(1, (r.accountCount as number | undefined) ?? 1));
  const selected = Math.min(count - 1, Math.max(0, (r.selected as number | undefined) ?? 0));
  return { count, selected, names: (r.accountNames as Record<string, string> | undefined) ?? {} };
}
const nameOf = (m: Meta, i: number) => m.names[String(i)]?.trim() || `Account ${i + 1}`;
/** The account every signature comes from. */
async function active(s: Session): Promise<HDAccount> {
  if (!s.mnemonic) throw new Error("Wallet is locked.");
  return accountOf(s.mnemonic, (await getMeta()).selected);
}
// The decoy shown after a duress unlock is an index no real account uses.
const DECOY_INDEX = 9999;

const approvals = new Map<string, { a: Approval; resolve: (v: unknown) => void; reject: (e: unknown) => void }>();

async function publicState(): Promise<WalletState> {
  const v = await getVault();
  const s = await getSession();
  const unlocked = !!s.mnemonic || !!s.duress;
  const meta = await getMeta();
  return {
    hasVault: !!v,
    locked: !unlocked,
    duress: !!s.duress,
    address: s.duress ? s.decoy : s.mnemonic ? accountOf(s.mnemonic, meta.selected).address : undefined,
    accounts: s.mnemonic ? Array.from({ length: meta.count }, (_, i) => ({ index: i, address: accountOf(s.mnemonic!, i).address, name: nameOf(meta, i) })) : [],
    selected: meta.selected,
    connected: await getConnected(),
    hasDuressPin: !!v?.duress,
    autolock: await getAutolock(),
    watch: await getWatch(),
    approvals: s.duress ? [] : [...approvals.values()].map((x) => x.a),
  };
}

// ---------- signing ----------
async function sendTx(to: Address, data: Hex, value = 0n, from?: HDAccount): Promise<Hex> {
  const account = from ?? (await active(await getSession()));
  const wallet = createWalletClient({ account, chain: CHAIN, transport: http(RPC_URL) });
  // Simulate first so a doomed transaction fails here, with a reason, before costing gas.
  await publicClient.call({ account, to, data, value });
  // +30%: estimates run low on the first outgoing transfer after protection settings change.
  const gas = await publicClient.estimateGas({ account, to, data, value });
  return wallet.sendTransaction({ to, data, value, gas: (gas * 13n) / 10n });
}

async function panic(mnemonic: string) {
  // Duress unlock: sweep every protected account to its backup, then forget the keys.
  const { count } = await getMeta();
  for (let i = 0; i < count; i++) {
    try {
      const account = accountOf(mnemonic, i);
      const prot = await readProtection(account.address);
      if (prot.protected) {
        await sendTx(PUSDC, encodeFunctionData({ abi: pusdcAbi, functionName: "stress", args: [account.address] }), 0n, account);
      }
    } catch (e) {
      console.warn(`duress stress failed for account ${i}`, e);
    }
  }
}

// ---------- dApp requests ----------
function ask(kind: ApprovalKind, origin: string, params: unknown[]): Promise<unknown> {
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    approvals.set(id, { a: { id, kind, origin, params }, resolve, reject });
    chrome.windows.create({ url: chrome.runtime.getURL(`popup.html#approve=${id}`), type: "popup", width: 400, height: 640 });
    keepAlive(true);
  });
}
let ping: ReturnType<typeof setInterval> | undefined;
function keepAlive(on: boolean) {
  if (on && !ping) ping = setInterval(() => chrome.runtime.getPlatformInfo(), 20_000);
  if (!on && ping && approvals.size === 0) { clearInterval(ping); ping = undefined; }
}

async function rpc(method: string, params: unknown[], origin: string): Promise<unknown> {
  const s = await getSession();
  const addr = s.mnemonic ? (await active(s)).address : undefined;
  const connected = (await getConnected()).includes(origin);
  switch (method) {
    case "eth_chainId": return CHAIN_ID_HEX;
    case "net_version": return String(CHAIN.id);
    case "eth_accounts": return connected && addr ? [addr] : [];
    case "eth_requestAccounts": {
      if (connected && addr) return [addr];
      await ask("connect", origin, []);
      const s2 = await getSession();
      return s2.mnemonic ? [(await active(s2)).address] : [];
    }
    case "wallet_switchEthereumChain": {
      const id = (params[0] as { chainId?: string })?.chainId;
      if (id?.toLowerCase() === CHAIN_ID_HEX) return null;
      throw rpcErr(4902, "This wallet only supports Base Sepolia for now.");
    }
    case "wallet_addEthereumChain": throw rpcErr(4200, "This wallet only supports Base Sepolia for now.");
    case "wallet_watchAsset": return true;
    case "eth_sendTransaction": {
      if (!connected) throw rpcErr(4100, "Connect your wallet to this site first.");
      return ask("tx", origin, params);
    }
    case "personal_sign": case "eth_sign": {
      if (!connected) throw rpcErr(4100, "Connect your wallet to this site first.");
      return ask("sign", origin, params);
    }
    case "eth_signTypedData_v4": {
      if (!connected) throw rpcErr(4100, "Connect your wallet to this site first.");
      return ask("typed", origin, params);
    }
    default:
      return publicClient.request({ method, params } as never);
  }
}
const rpcErr = (code: number, message: string) => Object.assign(new Error(message), { code });

async function executeApproval(a: Approval, override?: { to: Address; data: Hex }): Promise<unknown> {
  const s = await getSession();
  if (!s.mnemonic) throw rpcErr(4100, "Wallet is locked.");
  const account = await active(s);
  switch (a.kind) {
    case "connect": {
      const list = await getConnected();
      if (!list.includes(a.origin)) await local.set({ connected: [...list, a.origin] });
      return [account.address];
    }
    case "tx": {
      const tx = a.params[0] as { to: Address; data?: Hex; value?: Hex };
      const to = override?.to ?? tx.to;
      const data = override?.data ?? tx.data ?? "0x";
      return sendTx(to, data, override ? 0n : tx.value ? hexToBigInt(tx.value) : 0n);
    }
    case "sign": {
      const [first, second] = a.params as string[];
      const msg = isAddress(first) && !isAddress(second) ? second : first; // personal_sign(msg, addr) vs eth_sign(addr, msg)
      return account.signMessage({ message: msg.startsWith("0x") ? { raw: msg as Hex } : msg });
    }
    case "typed": {
      const typed = JSON.parse(a.params[1] as string);
      const { EIP712Domain: _d, ...types } = typed.types;
      return account.signTypedData({ domain: typed.domain, types, primaryType: typed.primaryType, message: typed.message });
    }
  }
}

// ---------- popup requests ----------
async function handle(req: Req): Promise<unknown> {
  switch (req.t) {
    case "state": return publicState();
    case "create": {
      if (await getVault()) throw new Error("A wallet already exists. Unlock it instead.");
      const mnemonic = generateMnemonic(english);
      await local.set({ vault: await createVault(mnemonic, req.password), accountCount: 1, selected: 0, accountNames: {} });
      await setSession({ mnemonic });
      return { mnemonic };
    }
    case "import": {
      const m = req.mnemonic.trim().toLowerCase().replace(/\s+/g, " ");
      try { accountOf(m); } catch { throw new Error("That recovery phrase isn't valid. Check each word."); }
      await local.set({ vault: await createVault(m, req.password), accountCount: 1, selected: 0, accountNames: {} });
      await setSession({ mnemonic: m });
      return null;
    }
    case "unlock": {
      const v = await getVault();
      if (!v) throw new Error("No wallet yet.");
      const r = await unlockVault(v, req.pin);
      if (!r) throw new Error("That password isn't right.");
      if (r.mode === "duress") {
        await setSession({ mnemonic: r.mnemonic }); // briefly, so the sweep can be signed
        await panic(r.mnemonic);
        // Keep only a decoy address (an unused index, key discarded): an empty wallet that cannot sign anything.
        await setSession({ duress: true, decoy: accountOf(r.mnemonic, DECOY_INDEX).address });
      } else {
        await setSession({ mnemonic: r.mnemonic });
      }
      return null;
    }
    case "lock": await setSession({}); return null;
    case "changePassword": {
      const v = await getVault();
      if (!v) throw new Error("No wallet yet.");
      if (req.newPassword.length < 8) throw new Error("Use at least 8 characters.");
      await local.set({ vault: await changePassword(v, req.oldPassword, req.newPassword) });
      return null;
    }
    case "autolock": {
      await local.set({ autolock: req.minutes });
      await scheduleLock();
      return null;
    }
    case "wipe": {
      const v = await getVault();
      const r = v && (await unlockVault(v, req.password));
      if (!r || r.mode !== "normal") throw new Error("That password isn't right.");
      await local.clear(); await session.clear();
      return null;
    }
    case "reveal": {
      const v = await getVault();
      const r = v && (await unlockVault(v, req.password));
      if (!r || r.mode !== "normal") throw new Error("That password isn't right.");
      return r.mnemonic;
    }
    case "setDuress": {
      const v = await getVault();
      if (!v) throw new Error("No wallet yet.");
      await local.set({ vault: await addDuress(v, req.password, req.duressPin) });
      return null;
    }
    case "clearDuress": {
      const v = await getVault();
      if (v) { const { duress: _d, ...rest } = v; await local.set({ vault: rest }); }
      return null;
    }
    case "send": {
      if ((await getSession()).duress) throw new Error("Network is busy. Try again later.");
      return sendTx(req.to, req.data, req.value ? BigInt(req.value) : 0n);
    }
    case "watch": {
      await local.set({ watch: req.list.filter((a) => isAddress(a)) });
      return null;
    }
    case "addAccount": {
      const s = await getSession();
      if (!s.mnemonic) throw new Error("Wallet is locked.");
      const meta = await getMeta();
      if (meta.count >= MAX_ACCOUNTS) throw new Error(`You can have up to ${MAX_ACCOUNTS} accounts.`);
      await local.set({ accountCount: meta.count + 1, selected: meta.count });
      return meta.count;
    }
    case "selectAccount": {
      const meta = await getMeta();
      if (!Number.isInteger(req.index) || req.index < 0 || req.index >= meta.count) throw new Error("That account doesn't exist.");
      await local.set({ selected: req.index });
      return null;
    }
    case "renameAccount": {
      const meta = await getMeta();
      if (req.index < 0 || req.index >= meta.count) throw new Error("That account doesn't exist.");
      const name = req.name.trim().slice(0, 24);
      const names = { ...meta.names };
      if (name) names[String(req.index)] = name; else delete names[String(req.index)];
      await local.set({ accountNames: names });
      return null;
    }
    case "exportKey": {
      const v = await getVault();
      const r = v && (await unlockVault(v, req.password));
      if (!r || r.mode !== "normal") throw new Error("That password isn't right.");
      const key = accountOf(r.mnemonic, (await getMeta()).selected).getHdKey().privateKey;
      if (!key) throw new Error("Couldn't read this account's key.");
      return bytesToHex(key);
    }
    case "disconnectSite": {
      await local.set({ connected: (await getConnected()).filter((o) => o !== req.origin) });
      return null;
    }
    case "approve": {
      const item = approvals.get(req.id);
      if (!item) throw new Error("This request has expired. Ask the site to try again.");
      approvals.delete(req.id);
      keepAlive(false);
      if (!req.approved) { item.reject(rpcErr(4001, "User rejected the request.")); return null; }
      try { item.resolve(await executeApproval(item.a, req.override)); }
      catch (e) { item.reject(e); throw e; }
      return null;
    }
  }
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  const done = (r: Res) => reply(JSON.parse(JSON.stringify(r, (_k, v) => (typeof v === "bigint" ? v.toString() : v))));
  if (msg?.dapp) {
    if (sender.tab === undefined) return;
    cfgReady.then(() => rpc(msg.method, msg.params ?? [], msg.origin)).then(
      (data) => done({ ok: true, data }),
      (e) => reply({ ok: false, error: e?.shortMessage ?? e?.message ?? "Request failed", code: e?.code ?? -32603 }),
    );
    return true;
  }
  if (sender.id !== chrome.runtime.id) return;
  if ((msg as Req).t !== "state" && (msg as Req).t !== "lock") void scheduleLock();
  cfgReady.then(() => handle(msg as Req)).then(
    (data) => done({ ok: true, data }),
    (e) => reply({ ok: false, error: e?.shortMessage ?? e?.message ?? String(e) }),
  );
  return true;
});

// ---------- guardian: watch wallets, tell the user about anything pending ----------
chrome.alarms.create("guard", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((al) => { if (al.name === "guard") void guard(); });
chrome.runtime.onStartup.addListener(() => void guard());

async function guard() {
  await cfgReady;
  const s = await getSession();
  const meta = await getMeta();
  const mineList = s.mnemonic ? Array.from({ length: meta.count }, (_, i) => accountOf(s.mnemonic!, i).address) : [];
  const mineSet = new Set(mineList.map((a) => a.toLowerCase()));
  // Watching works while locked too; your own accounts are added when it's unlocked.
  const targets = [...new Set([...mineList, ...(await getWatch())])];
  const seen = ((await local.get("seen")).seen as Record<string, string[]> | undefined) ?? {};
  const next: Record<string, string[]> = {};
  let alerts = 0;
  for (const addr of targets) {
    try {
      const x = await readProtection(addr);
      const keys = alertKeys(x);
      next[addr] = keys;
      const fresh = keys.filter((k) => !(seen[addr] ?? []).includes(k));
      alerts += keys.length;
      if (fresh.length && addr in seen) {
        const t = x.pending.find((p) => fresh.includes(`transfer:${p.id}`));
        chrome.notifications.create(`${addr}:${fresh[0]}`, {
          type: "basic",
          iconUrl: "icon.png",
          title: mineSet.has(addr.toLowerCase()) ? "Something is waiting on your wallet" : `Activity on ${shortAddr(addr)}`,
          message: t
            ? `${fmtAmount(t.amount)} pUSDC is scheduled to ${shortAddr(t.to)}. Open Protected Wallet to stop it if it wasn't you.`
            : "A protection setting change is waiting. Open Protected Wallet to review it.",
          priority: 2,
        });
      }
    } catch { next[addr] = seen[addr] ?? []; }
  }
  await local.set({ seen: next });
  await chrome.action.setBadgeBackgroundColor({ color: "#b45309" });
  await chrome.action.setBadgeText({ text: alerts ? String(alerts) : "" });
}

// ---------- auto-lock ----------
async function scheduleLock() {
  const m = await getAutolock();
  if (m > 0) chrome.alarms.create("autolock", { delayInMinutes: m });
  else await chrome.alarms.clear("autolock");
}
chrome.alarms.onAlarm.addListener(async (al) => {
  if (al.name === "autolock" && approvals.size === 0) await setSession({});
});

// First install: open the full-page welcome flow instead of a cramped popup.
chrome.runtime.onInstalled.addListener((d) => {
  if (d.reason === "install") void chrome.tabs.create({ url: chrome.runtime.getURL("popup.html?tab=1") });
});
