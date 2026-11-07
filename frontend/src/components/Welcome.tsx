import { Hourglass, LifeBuoy, Zap } from "lucide-react";
import { ConnectButton } from "../App";
import { AsciiArt } from "./AsciiArt";

const points = [
  {
    icon: Zap,
    title: "Everyday payments stay instant",
    body: "Spend up to your own daily limit like normal. Payments and swaps just work.",
  },
  {
    icon: Hourglass,
    title: "Big transfers wait their turn",
    body: "Anything larger is scheduled for later, even if you press Send in MetaMask. If it wasn't you, your backup wallet cancels it.",
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
      <section className="grid items-center gap-10 md:grid-cols-[1.1fr_1fr]">
        <div>
          <h1 className="text-[2.5rem] leading-[1.08] text-balance sm:text-5xl lg:text-[3.4rem]">
            Your dollars move instantly, until someone tries to <em className="hl">take it all</em>
          </h1>
          <p className="mt-6 max-w-md text-lg text-muted-foreground text-pretty">
            Protected USDC works just like USDC, until someone tries to take it all at once. Then it gives you time to stop them.
          </p>
          <div className="mt-8">
            <ConnectButton />
          </div>
        </div>
        <AsciiArt />
      </section>

      <ul className="mt-16 grid gap-4 sm:grid-cols-3">
        {points.map(({ icon: Icon, title, body }) => (
          <li key={title} className="rounded-xl border border-border bg-card p-6">
            <span className="grid size-10 place-items-center rounded-lg bg-primary-soft text-primary-soft-foreground">
              <Icon className="size-5" aria-hidden />
            </span>
            <h2 className="mt-4 text-lg">{title}</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{body}</p>
          </li>
        ))}
      </ul>

      <div className="mt-10 rounded-xl border border-border bg-card p-6 text-sm leading-relaxed">
        <h2 className="text-lg">Why a thief can't just switch it off</h2>
        <p className="mt-1.5 max-w-2xl text-muted-foreground">
          Turning protection on is instant. Turning it off, or loosening any setting, takes a waiting period you choose. During that time you'll see it coming, and your backup wallet can step in.
        </p>
      </div>
    </div>
  );
}
