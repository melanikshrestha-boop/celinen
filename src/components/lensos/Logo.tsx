type LogoProps = {
  size?: number;
  className?: string;
};

/**
 * Lens OS mark — an aperture ring whose inner cut forms an "L".
 * Monochrome: inherits `currentColor` for the ring, punches the glyph out.
 */
export function LogoMark({ size = 26, className = "" }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <defs>
        <mask id="lensos-mark-mask">
          <rect width="32" height="32" fill="black" />
          <circle cx="16" cy="16" r="14" fill="white" />
          {/* L glyph punched out */}
          <path
            d="M12 8.5h3.1v11.6h6.4v3.4H12z"
            fill="black"
          />
          {/* aperture blade cuts */}
          <path d="M2 16 L11 7 L11 9.6 L4.6 16Z" fill="black" />
          <path d="M30 16 L21 25 L21 22.4 L27.4 16Z" fill="black" />
        </mask>
      </defs>
      <circle cx="16" cy="16" r="14" fill="currentColor" mask="url(#lensos-mark-mask)" />
      <circle
        cx="16"
        cy="16"
        r="15"
        stroke="currentColor"
        strokeOpacity="0.22"
        strokeWidth="1"
      />
    </svg>
  );
}

export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`flex items-center gap-2 ${className}`}>
      <LogoMark className="text-ink" />
      <span className="font-display text-[15px] font-semibold tracking-tight">
        Lens<span className="text-moss"> OS</span>
      </span>
    </span>
  );
}
