/** Original LensLabs vector companions; no imported mascots or task-status claims. */
export function CompanionArt({
  kind,
  image,
  animate = false,
}: {
  kind: "cat" | "dog";
  image?: string;
  animate?: boolean;
}) {
  return (
    <span className={`lenslabs-companion${animate ? " is-animated" : ""}`}>
      {image ? (
        <img src={image} alt="Custom companion" />
      ) : (
        <svg viewBox="0 0 80 80" role="img" aria-label={`LensLabs ${kind} companion`}>
          <path
            d="M58 64c18 0 14-21 8-17"
            fill="none"
            stroke="#bdb19a"
            strokeWidth="6"
            strokeLinecap="round"
          />
          <path d="M21 61c0-18 8-27 19-27s20 9 20 27v8H21Z" fill="#bdb19a" />
          {kind === "cat" ? (
            <path d="m21 33 1-24 17 12 19-12 2 25Z" fill="#ddd2bd" />
          ) : (
            <>
              <path d="M25 23C7 13 8 44 22 43m33-20c18-10 17 21 3 20" fill="#8d806a" />
              <path d="M21 31c0-12 8-18 19-18s20 6 20 18Z" fill="#ddd2bd" />
            </>
          )}
          <ellipse cx="40" cy="35" rx="22" ry="19" fill="#ddd2bd" />
          <g className="companion-eyes" fill="#292a2d">
            <ellipse cx="31" cy="34" rx="2" ry="3" />
            <ellipse cx="49" cy="34" rx="2" ry="3" />
          </g>
          <path
            d="m37 41 3 3 3-3m-3 3v3"
            fill="none"
            stroke="#6c6056"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <path d="M27 69h9m9 0h9" stroke="#8d806a" strokeWidth="3" strokeLinecap="round" />
          <circle cx="40" cy="56" r="3" fill="#eab74e" />
        </svg>
      )}
    </span>
  );
}
