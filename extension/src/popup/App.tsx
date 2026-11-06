import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { useWalletState } from "./useWallet";
import { Onboarding, Unlock } from "./Onboarding";
import { Home } from "./Home";
import { Approval } from "./Approval";
import { Skeleton } from "@ui/ui";

export function App() {
  const { state, refresh } = useWalletState();
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const f = () => setHash(location.hash);
    addEventListener("hashchange", f);
    return () => removeEventListener("hashchange", f);
  }, []);
  const inTab = new URLSearchParams(location.search).has("tab");
  const approveId = /approve=([\w-]+)/.exec(hash)?.[1];

  let body;
  if (!state) body = <Skeleton className="h-40" />;
  else if (!state.hasVault) body = <Onboarding onDone={refresh} />;
  else if (state.locked) body = <Unlock onDone={refresh} />;
  else if (approveId) body = <Approval id={approveId} state={state} onDone={() => window.close()} />;
  else body = <Home state={state} refresh={refresh} />;

  return (
    <div className={`mx-auto flex min-h-[560px] flex-col gap-4 p-4 ${approveId ? "approval-window" : ""} ${inTab ? "max-w-[440px] pt-10" : ""}`}>
      <header className="flex items-center gap-2">
        <span className="grid size-8 place-items-center rounded-xl bg-primary text-primary-foreground"><ShieldCheck className="size-5" aria-hidden /></span>
        <h1 className="text-base font-extrabold">Protected Wallet</h1>
        <span className="ml-auto rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">Base Sepolia</span>
      </header>
      {body}
    </div>
  );
}
