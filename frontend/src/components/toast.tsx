import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { CheckCircle2, ExternalLink, Info, TriangleAlert, X } from "lucide-react";

type Toast = { id: number; kind: "info" | "success" | "error"; title: string; body?: string; href?: string };
const Ctx = createContext<{ show: (t: Omit<Toast, "id">) => void }>({ show: () => {} });
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = useCallback((id: number) => setToasts((ts) => ts.filter((t) => t.id !== id)), []);
  const show = useCallback(
    (t: Omit<Toast, "id">) => {
      const id = Date.now() + Math.random();
      // Only one "waiting" toast at a time; a result replaces it.
      setToasts((ts) => [...ts.filter((x) => x.kind !== "info"), { ...t, id }].slice(-2));
      if (t.kind !== "error") setTimeout(() => dismiss(id), t.kind === "info" ? 15000 : 5000);
    },
    [dismiss],
  );
  const Icon = { info: Info, success: CheckCircle2, error: TriangleAlert };
  const tone = {
    info: "bg-card text-foreground",
    success: "bg-primary-soft text-primary-soft-foreground",
    error: "bg-danger-soft text-danger-soft-foreground",
  };
  return (
    <Ctx.Provider value={{ show }}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:bottom-auto sm:top-20 sm:items-end"
        aria-live="polite"
        role="status"
      >
        {toasts.map((t) => {
          const I = Icon[t.kind];
          return (
            <div key={t.id} className={`pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-2xl border border-border p-4 shadow-lg ${tone[t.kind]}`}>
              <I className="mt-0.5 size-5 shrink-0" aria-hidden />
              <div className="min-w-0 flex-1 text-sm">
                <p className="font-semibold">{t.title}</p>
                {t.body && <p className="mt-0.5 opacity-90">{t.body}</p>}
                {t.href && (
                  <a href={t.href} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 rounded font-medium underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    View on Basescan <ExternalLink className="size-3.5" aria-hidden />
                  </a>
                )}
              </div>
              <button onClick={() => dismiss(t.id)} aria-label="Dismiss" className="-m-2 rounded-lg p-2 opacity-70 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <X className="size-4" aria-hidden />
              </button>
            </div>
          );
        })}
      </div>
    </Ctx.Provider>
  );
}
