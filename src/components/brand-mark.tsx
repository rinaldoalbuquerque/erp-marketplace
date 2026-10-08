/**
 * Logo: a shipping tag with an amber eyelet. Decorative (a text label sits next to it).
 * `mono` draws everything in the current color (for large background use).
 */
export function BrandMark({
  className = "size-7",
  mono = false,
}: {
  className?: string;
  mono?: boolean;
}) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true" focusable="false">
      <path
        d="M4 9.5A3.5 3.5 0 0 1 7.5 6h12.1a3.5 3.5 0 0 1 2.5 1l6 6a3.5 3.5 0 0 1 0 5l-6 6a3.5 3.5 0 0 1-2.5 1H7.5A3.5 3.5 0 0 1 4 21.5z"
        fill="currentColor"
      />
      {mono ? null : (
        <>
          <circle cx="21" cy="15.5" r="2.6" fill="var(--signal)" />
          <path
            d="M9 12h7M9 16h5M9 20h7"
            stroke="var(--sidebar)"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </>
      )}
    </svg>
  );
}
