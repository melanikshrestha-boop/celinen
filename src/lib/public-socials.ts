/** Public Celinen presence. Swap the handle here when the live accounts change. */
const HANDLE = "lenslab";

export const PUBLIC_SOCIALS = [
  { label: "Twitter / X", href: `https://x.com/${HANDLE}` },
  { label: "Instagram", href: `https://www.instagram.com/${HANDLE}` },
  { label: "Facebook", href: `https://www.facebook.com/${HANDLE}` },
  { label: "Snapchat", href: `https://www.snapchat.com/add/${HANDLE}` },
  { label: "TikTok", href: `https://www.tiktok.com/@${HANDLE}` },
  { label: "YouTube", href: `https://www.youtube.com/@${HANDLE}` },
  { label: "LinkedIn", href: `https://www.linkedin.com/company/${HANDLE}` },
  { label: "Discord", href: `https://discord.gg/${HANDLE}` },
] as const;
