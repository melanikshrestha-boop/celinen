/** Official school marks from conference sites. Sports is a club crest; wedding is a ring. */

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
          <circle cx="14" cy="14" r="13" fill="#034694" />
          <circle cx="14" cy="14" r="11.15" fill="none" stroke="#C9A227" strokeWidth="1.35" />
          <path
            fill="#fff"
            d="M15.2 6.4c.35 1.7-.15 2.7-1.05 3.35-.2-.7-.7-1.25-1.45-1.55.85.15 1.45.7 1.7 1.45-.85-.2-1.7.1-2.25.85 1.05-.35 2.05-.05 2.65.85.15 1.15-.2 2.05-.9 2.7l.35 4.15c.05.7-.2 1.2-.7 1.55l-1.15.7c-.45.25-.75.15-.95-.25l-.55-1.15c-.25.85-.85 1.45-1.7 1.75.55-.85.55-1.75.1-2.55-.7.95-1.75 1.15-2.85.7.95-.15 1.6-.7 1.9-1.5-.95.2-1.7-.2-2.15-1.05.8.05 1.45-.25 1.85-.9-.85-.05-1.4-.55-1.55-1.4.7.35 1.4.3 2.05-.1-.35-.55-.4-1.15-.15-1.75.55.55 1.2.75 1.95.55-.15-.7.05-1.3.55-1.8.15.7.55 1.2 1.15 1.45.05-1.05.55-1.8 1.45-2.2-.05.75.2 1.35.75 1.75.2-1.15.85-1.9 1.85-2.2z"
          />
        </svg>
      );
    case "wedding":
      return (
        <svg viewBox="0 0 28 28" aria-hidden="true">
          <circle cx="14" cy="16.4" r="6.35" fill="none" stroke="#C9A227" strokeWidth="2.35" />
          <path fill="#F4FBFF" stroke="#C9A227" strokeWidth="1.15" strokeLinejoin="round" d="M14 5.2 17.35 9.4 14 12.05 10.65 9.4Z" />
          <path fill="#C9A227" d="M14 12.05 17.35 9.4 14 8.15 10.65 9.4Z" />
        </svg>
      );
    default:
      return null;
  }
}
