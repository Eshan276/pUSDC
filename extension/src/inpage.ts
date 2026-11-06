// EIP-1193 provider injected into pages (also announced via EIP-6963 so dApps can find it next to other wallets).
type Listener = (...a: unknown[]) => void;
const listeners: Record<string, Listener[]> = {};
const pending = new Map<string, { ok: (v: unknown) => void; fail: (e: unknown) => void }>();

window.addEventListener("message", (e) => {
  if (e.source !== window || e.data?.target !== "pw-inpage") return;
  const p = pending.get(e.data.id);
  if (!p) return;
  pending.delete(e.data.id);
  const res = e.data.res;
  res.ok ? p.ok(res.data) : p.fail(Object.assign(new Error(res.error), { code: res.code ?? -32603 }));
});

const provider = {
  isProtectedWallet: true,
  request({ method, params }: { method: string; params?: unknown[] }) {
    return new Promise((ok, fail) => {
      const id = crypto.randomUUID();
      pending.set(id, { ok, fail });
      window.postMessage({ target: "pw-content", id, method, params: params ?? [] }, location.origin);
    });
  },
  on(ev: string, fn: Listener) { (listeners[ev] ??= []).push(fn); return provider; },
  removeListener(ev: string, fn: Listener) { listeners[ev] = (listeners[ev] ?? []).filter((f) => f !== fn); return provider; },
  isConnected: () => true,
};

const info = {
  uuid: "6f4f0f1e-7a52-4a52-9a3e-5a9c9f0f9a11",
  name: "Protected Wallet",
  icon: "data:image/svg+xml;base64," + btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#0f766e"/><path d="M16 6l8 3v7c0 5-3.5 8-8 10-4.5-2-8-5-8-10V9z" fill="#fff"/></svg>'),
  rdns: "app.protectedtoken.wallet",
};
const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }));
window.addEventListener("eip6963:requestProvider", announce);
announce();
// Don't clobber MetaMask etc. if they got there first.
if (!(window as unknown as { ethereum?: unknown }).ethereum) (window as unknown as { ethereum: unknown }).ethereum = provider;
