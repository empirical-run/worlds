import { useId } from "react";

export function Logo({ height = 11 }: { height?: number }) {
  const gapId = useId();
  return (
    <svg
      className="logo"
      viewBox="2 12 28 10"
      height={height}
      width={height * 2.8}
      aria-hidden="true"
    >
      <mask id={gapId}>
        <rect x="2" y="12" width="28" height="10" fill="#fff" />
        <circle cx="20" cy="22" r="11.5" fill="#000" />
      </mask>
      <path fillOpacity={0.45} mask={`url(#${gapId})`} d="M2 22a10 10 0 0 1 20 0z" />
      <path d="M10 22a10 10 0 0 1 20 0z" />
    </svg>
  );
}
