/** The mark: a brass ladder of prices committed buyers will pay, and the loan in black, always under it. */
export function Mark({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <path d="M4 4h20v14h16v14h20v28H4z" fill="#d2b06a" />
      <path d="M4 18 50 60H4z" fill="#111111" />
    </svg>
  );
}
