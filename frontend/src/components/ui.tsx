import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Loader2 } from "lucide-react";

const focus = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

type Variant = "primary" | "secondary" | "ghost" | "danger";
const variants: Record<Variant, string> = {
  primary: "bg-primary text-primary-foreground hover:brightness-95",
  secondary: "bg-card text-foreground border border-border hover:bg-muted",
  ghost: "text-foreground hover:bg-muted",
  danger: "bg-danger text-danger-foreground hover:brightness-110",
};

export function Button({
  variant = "primary",
  loading,
  className = "",
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean }) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl px-5 text-[15px] font-semibold transition-[filter,background-color,opacity,transform] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${focus} ${className}`}
    >
      {loading && <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-3xl border border-border bg-card p-5 shadow-[0_1px_2px_rgb(16_40_90/0.04),0_16px_40px_-16px_rgb(18_70_160/0.22)] sm:p-6 ${className}`}>{children}</section>;
}

export function Notice({ tone = "info", icon, title, children }: { tone?: "info" | "warning" | "danger" | "success"; icon?: ReactNode; title?: string; children?: ReactNode }) {
  const t = {
    info: "bg-muted text-foreground",
    success: "bg-primary-soft text-primary-soft-foreground",
    warning: "bg-warning-soft text-warning-foreground",
    danger: "bg-danger-soft text-danger-soft-foreground",
  }[tone];
  return (
    <div className={`flex gap-3 rounded-2xl p-4 text-sm ${t}`}>
      {icon && <span className="mt-0.5 shrink-0 [&>svg]:size-5" aria-hidden>{icon}</span>}
      <div className="min-w-0 space-y-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className="leading-relaxed">{children}</div>}
      </div>
    </div>
  );
}

export function Field({ label, hint, error, htmlFor, children }: { label: string; hint?: ReactNode; error?: string; htmlFor: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-muted-foreground">{label}</label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} className="text-sm text-danger-soft-foreground" role="alert">{error}</p>
      ) : hint ? (
        <p id={`${htmlFor}-hint`} className="text-sm text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

export const inputClass = `w-full min-h-12 rounded-2xl border border-transparent bg-muted px-4 text-base placeholder:text-muted-foreground/80 ${focus}`;

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`rounded-md bg-muted motion-safe:animate-pulse ${className}`} aria-hidden />;
}

export function Progress({ value, label }: { value: number; label: string }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div role="progressbar" aria-label={label} aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
      <div className="h-full rounded-full bg-primary motion-safe:transition-[width] motion-safe:duration-500" style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Ticks every second, for countdowns. */
export function useNow(): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/**
 * Press and hold to confirm. Used for irreversible emergency actions so they can't be triggered by a stray tap.
 * Keyboard: hold Space or Enter.
 */
export function HoldButton({ onConfirm, children, disabled, loading, ms = 1500 }: { onConfirm: () => void; children: ReactNode; disabled?: boolean; loading?: boolean; ms?: number }) {
  const [progress, setProgress] = useState(0);
  const start = useRef<number | null>(null);
  const raf = useRef<number | null>(null);
  const stop = () => {
    start.current = null;
    if (raf.current) cancelAnimationFrame(raf.current);
    setProgress(0);
  };
  const tick = (t: number) => {
    if (start.current === null) start.current = t;
    const p = Math.min(1, (t - start.current) / ms);
    setProgress(p);
    if (p >= 1) {
      stop();
      onConfirm();
    } else raf.current = requestAnimationFrame(tick);
  };
  const begin = () => {
    if (disabled || loading || start.current !== null) return;
    raf.current = requestAnimationFrame(tick);
  };
  return (
    <button
      type="button"
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      onPointerDown={begin}
      onPointerUp={stop}
      onPointerLeave={stop}
      onKeyDown={(e) => (e.key === " " || e.key === "Enter") && (e.preventDefault(), begin())}
      onKeyUp={stop}
      className={`relative inline-flex min-h-12 w-full select-none items-center justify-center gap-2 overflow-hidden rounded-md bg-danger px-4 text-sm font-semibold text-danger-foreground touch-none disabled:cursor-not-allowed disabled:opacity-50 ${focus}`}
    >
      <span className="absolute inset-y-0 left-0 bg-black/20" style={{ width: `${progress * 100}%` }} aria-hidden />
      <span className="relative flex items-center gap-2">
        {loading && <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden />}
        {children}
      </span>
    </button>
  );
}
