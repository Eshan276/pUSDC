/** The Protected USDC mark (a disc with a shield-in-P cut out). Takes its colour from the text colour. */
export function Mark({ className = "size-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden>
      <defs>
        <mask id="pw-mark-cut">
          <rect width="40" height="40" fill="#fff" />
          <path d="M13.5 30.5V11.5h7.25a6.25 6.25 0 0 1 0 12.5H13.5" fill="none" stroke="#000" strokeWidth="4.2" strokeLinejoin="round" />
          <path d="M20.6 15.6l2.6 1.1v1.9c0 1.6-1.1 2.7-2.6 3.2-1.5-.5-2.6-1.6-2.6-3.2v-1.9z" fill="#000" />
        </mask>
      </defs>
      <circle cx="20" cy="20" r="19" fill="currentColor" mask="url(#pw-mark-cut)" />
    </svg>
  );
}
