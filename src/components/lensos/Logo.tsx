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
          <path d="M12.4 9h3.2v11.4h6.2v3.2h-9.4z" fill="black" />
          {/* aperture blade: a diagonal slice through the top-left rim */}
          <path d="M2.6 11.5 11.5 2.6 13.6 3.7 3.7 13.6z" fill="black" />
        </mask>
      </defs>
      <circle cx="16" cy="16" r="14" fill="currentColor" mask="url(#lensos-mark-mask)" />

      <circle
        cx="16"
        cy="16"
        r="14"
        stroke="currentColor"
        strokeOpacity="0.18"
        strokeWidth="1"
        fill="none"
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
