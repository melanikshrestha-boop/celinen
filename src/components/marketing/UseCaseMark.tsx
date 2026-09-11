/** Official school marks from conference sites. Sports/wedding are filled camera and rings — never lucide tiles. */

import { schoolMarkSrc } from "@/components/marketing/college-football";

export function UseCaseMark({ id }: { id: string }) {
  const src = schoolMarkSrc(id);
  if (src) {
    return <img src={src} alt="" />;
  }

  switch (id) {
    case "sports":
      return (
        <svg viewBox="0 0 28 28" aria-hidden="true">
          <rect x="10" y="5.6" width="8" height="3.1" rx="1" fill="#142a36" />
          <rect x="4.6" y="8.2" width="18.8" height="14.2" rx="3.1" fill="#142a36" />
          <circle cx="14" cy="15.3" r="5.15" fill="#4d6fff" />
          <circle cx="14" cy="15.3" r="3.1" fill="#142a36" />
          <circle cx="12.7" cy="14.05" r="1" fill="#fff" fillOpacity=".35" />
        </svg>
      );
    case "wedding":
      return (
        <svg viewBox="0 0 28 28" aria-hidden="true">
          <circle
            cx="11.15"
            cy="14"
            r="6.1"
            fill="none"
            stroke="#C4A574"
            strokeWidth="2.2"
          />
          <circle
            cx="16.85"
            cy="14"
            r="6.1"
            fill="none"
            stroke="#8F6B3E"
            strokeWidth="2.2"
          />
        </svg>
      );
    default:
      return null;
  }
}
