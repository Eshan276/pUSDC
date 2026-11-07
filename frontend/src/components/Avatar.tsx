/** A repeatable blue-ish gradient from the address, so each account looks like itself. */
export function Avatar({ address, className = "size-10" }: { address: string; className?: string }) {
  const n = parseInt(address.slice(2, 10), 16);
  const h1 = 190 + (n % 70), h2 = 200 + ((n >> 8) % 70);
  return <span aria-hidden className={`${className} shrink-0 rounded-full`} style={{ background: `linear-gradient(135deg, hsl(${h1} 78% 52%), hsl(${h2} 72% 32%))` }} />;
}
