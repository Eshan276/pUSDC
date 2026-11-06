import { Hourglass, LifeBuoy, ShieldCheck, Zap } from "lucide-react";
import { ConnectButton } from "../App";

const points = [
  {
    icon: Zap,
    title: "Everyday payments stay instant",
    body: "Spend up to your own daily limit like normal. Payments and swaps just work.",
  },
  {
    icon: Hourglass,
    title: "Big transfers wait their turn",
    body: "Anything larger is scheduled for later. If it wasn't you, your backup wallet cancels it.",
  },
  {
    icon: LifeBuoy,
    title: "An emergency button",
    body: "One action moves everything to your backup wallet and locks it, even if someone is forcing you.",
  },
];

export function Welcome() {
  return (
    <div className="pt-10 sm:pt-16">
      <div className="mx-auto max-w-2xl text-center">
        <span className="inline-flex items-center gap-2 rounded-full bg-primary-soft px-3 py-1 text-sm font-medium text-primary-soft-foreground">
          <ShieldCheck className="size-4" aria-hidden /> Theft protection for your stablecoins
        </span>
        <h1 className="mt-5 text-4xl font-extrabold tracking-tight text-balance sm:text-5xl">Your dollars, with a seatbelt.</h1>
        <p className="mx-auto mt-4 max-w-xl text-lg text-muted-foreground text-pretty">
          Protected USDC works just like USDC, until someone tries to take it all at once. Then it gives you time to stop them.
        </p>
        <div className="mt-8 flex justify-center">
          <ConnectButton />
        </div>
      </div>

      <ul className="mt-14 grid gap-4 sm:grid-cols-3">
        {points.map(({ icon: Icon, title, body }) => (
          <li key={title} className="rounded-3xl border border-border bg-card p-6">
            <span className="grid size-11 place-items-center rounded-2xl bg-primary-soft text-primary-soft-foreground">
              <Icon className="size-5" aria-hidden />
            </span>
            <h2 className="mt-4 font-bold">{title}</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{body}</p>
          </li>
        ))}
      </ul>

      <div className="mx-auto mt-10 max-w-2xl rounded-3xl bg-muted p-6 text-sm leading-relaxed">
        <h2 className="font-bold">Why a thief can't just switch it off</h2>
        <p className="mt-1.5 text-muted-foreground">
          Turning protection on is instant. Turning it off, or loosening any setting, takes a waiting period you choose (at least a
          week). During that time you'll see it coming, and your backup wallet can step in.
        </p>
      </div>
    </div>
  );
}
