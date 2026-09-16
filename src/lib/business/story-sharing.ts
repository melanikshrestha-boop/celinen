import { z } from "zod";
import { APPLICATION_ORIGIN, applicationUrl } from "../application-origin";

export const publicStoryId = z.string().uuid();
export const creatorInquiryPath = (owner: string) =>
  `/photographers?creator=${publicStoryId.parse(owner)}`;

/** Only an explicitly published story ID goes into a forwarded link. Never copy location.href. */
export function publicStoryInvitation(
  id: string,
  title: string,
  creator?: string | null,
  origin = APPLICATION_ORIGIN,
) {
  const url = applicationUrl(`/p/${publicStoryId.parse(id)}`, origin);
  const name = creator?.trim();
  const text = name ? `${title} — work by ${name}.` : `Take a look at ${title}.`;
  return {
    url,
    title,
    text,
    emailHref: `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(`${text}\n\n${url}`)}`,
  };
}

export function publicStoryHead(
  id: string,
  story?: { title: string; caption: string; creator?: { displayName: string } | null },
  origin = APPLICATION_ORIGIN,
) {
  const description = story
    ? story.caption.trim().replace(/\s+/g, " ").slice(0, 200) || "View this public photo story."
    : "This public story is unavailable.";
  const title = story
    ? `${story.title}${story.creator ? ` — ${story.creator.displayName}` : ""}`
    : "Story unavailable — Celinen";
  const meta = [
    { title },
    { name: "description", content: description },
    { name: "referrer", content: "no-referrer" },
    { name: "robots", content: "noindex, noarchive" },
    { property: "og:type", content: "website" },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
    { name: "twitter:card", content: story ? "summary_large_image" : "summary" },
  ];
  if (!story) return { meta };
  const url = publicStoryInvitation(id, story.title, null, origin).url;
  const image = applicationUrl(`/api/public/stories/${publicStoryId.parse(id)}/cover`, origin);
  return {
    meta: [
      ...meta,
      { property: "og:url", content: url },
      { property: "og:image", content: image },
      { property: "og:image:type", content: "image/jpeg" },
      { property: "og:image:alt", content: `Cover photograph for ${story.title}` },
      { name: "twitter:image", content: image },
      { name: "twitter:image:alt", content: `Cover photograph for ${story.title}` },
    ],
    links: [{ rel: "canonical", href: url }],
  };
}
