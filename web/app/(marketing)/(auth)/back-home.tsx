import Link from "next/link";

/**
 * The way back to the marketing site, shared by every signed-out screen.
 *
 * It used to be the brand panel's wordmark, which is hidden below the split
 * breakpoint, plus a separate mobile-only mark — so a signed-out returning
 * visitor on a laptop had no way home at all. One link, always present.
 */
export function BackHome({ label }: { label: string }) {
  return (
    <Link href="/" className="m-back-home">
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M19 12H5M12 19l-7-7 7-7" />
      </svg>
      {label}
    </Link>
  );
}
