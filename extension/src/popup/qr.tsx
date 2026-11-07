import { useMemo } from "react";
import qrcode from "qrcode-generator";

/** A QR code as crisp inline SVG, generated here with no network. Dark modules on a white tile so any scanner reads it. */
export function QrCode({ value, label = "QR code" }: { value: string; label?: string }) {
  const svg = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(value);
    qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
  }, [value]);
  return (
    <div role="img" aria-label={label} data-testid="qr" className="mx-auto size-44 rounded-2xl border border-border bg-white p-3 [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: svg }} />
  );
}
