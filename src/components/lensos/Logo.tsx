type LogoProps = {
  size?: number;
  className?: string;
};

const BLADES = [0, 60, 120, 180, 240, 300];

/** Six-blade aperture. Same mark as the tab icon, scaled wherever we draw an “o”. */
export function IrisGlyph() {
  return (
    <g>
      {BLADES.map((deg, i) => (
        <path
          key={deg}
          d="M16 4.6 L25.9 10.3 L16 16 Z"
          fill="currentColor"
          fillOpacity={i % 2 === 0 ? 0.92 : 0.45}
          transform={`rotate(${deg} 16 16)`}
        />
      ))}
      <circle
        cx="16"
        cy="16"
        r="11.4"
        stroke="currentColor"
        strokeOpacity="0.9"
        strokeWidth="1.6"
        fill="none"
      />
      <circle
        cx="16"
        cy="16"
        r="14.2"
        stroke="currentColor"
        strokeOpacity="0.2"
        strokeWidth="1.15"
        fill="none"
      />
    </g>
  );
}

/**
 * LensLabs mark — a six-blade aperture iris.
 * Monochrome: inherits `currentColor`, blades alternate opacity for depth.
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
      <IrisGlyph />
    </svg>
  );
}

export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`flex items-center gap-2 ${className}`}>
      <LogoMark className="text-ink" />
      <span className="font-display text-[15px] font-semibold tracking-tight">
        Lens<span className="text-moss">Labs</span>
      </span>
    </span>
  );
}
