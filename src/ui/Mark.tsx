/** The mark: a ladder of prices stepping down. */
export function Mark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden="true" focusable="false">
      <path d="M1 3h6v4h5v4h5v5H1z" fill="#d2b06a" />
    </svg>
  );
}
