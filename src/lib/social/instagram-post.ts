/** Instagram feed posts made in Cull or Develop: the contract shared by the
 * composer (browser) and the publisher (Worker). Pure: no network, no storage.
 *
 * Platform limits come from Meta's content-publishing guide (checked 2026-09-17):
 * JPEG only, <= 8 MB, width 320–1440, aspect 4:5 through 1.91:1, carousel 2–10,
 * caption <= 2200 characters, <= 30 hashtags, <= 20 @mentions.
 */
import { z } from "zod";

export const INSTAGRAM_CAPTION_LIMIT = 2200;
export const INSTAGRAM_HASHTAG_LIMIT = 30;
export const INSTAGRAM_MENTION_LIMIT = 20;
export const INSTAGRAM_CAROUSEL_LIMIT = 10;
export const INSTAGRAM_IMAGE_BYTES = 8 * 1024 * 1024;
/** Media bucket shared with delivery publishing: private, JPEG only, 8 MiB. */
export const PUBLISHING_BUCKET = "publishing-media-v1";

export const INSTAGRAM_FEED_FORMATS = {
  portrait: { width: 1080, height: 1350, label: "4:5" },
  square: { width: 1080, height: 1080, label: "1:1" },
} as const;
export type InstagramFeedFormat = keyof typeof INSTAGRAM_FEED_FORMATS;

export const hashtagCount = (caption: string) => caption.match(/(^|\s)#[^\s#]+/gu)?.length ?? 0;
export const mentionCount = (caption: string) =>
  caption.match(/(^|\s)@[A-Za-z0-9._]+/g)?.length ?? 0;
/** Instagram counts characters, not UTF-16 units; an emoji is one. */
export const captionLength = (caption: string) => Array.from(caption).length;

/** Null when Instagram will accept the caption, otherwise the reason. */
export function captionProblem(caption: string): string | null {
  if (captionLength(caption) > INSTAGRAM_CAPTION_LIMIT)
    return `Captions are limited to ${INSTAGRAM_CAPTION_LIMIT} characters.`;
  if (hashtagCount(caption) > INSTAGRAM_HASHTAG_LIMIT)
    return `Instagram allows ${INSTAGRAM_HASHTAG_LIMIT} hashtags per post.`;
  if (mentionCount(caption) > INSTAGRAM_MENTION_LIMIT)
    return `Instagram allows ${INSTAGRAM_MENTION_LIMIT} @mentions per post.`;
  return null;
}

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
export const instagramPostItem = z
  .object({
    sha256,
    bytes: z.number().int().min(1).max(INSTAGRAM_IMAGE_BYTES),
    width: z.number().int().min(320).max(1440),
    height: z.number().int().min(1).max(1800),
  })
  .strict()
  .refine((item) => item.width / item.height >= 0.8 - 1e-9, "Photos cannot be taller than 4:5.")
  .refine((item) => item.width / item.height <= 1.91 + 1e-9, "Photos cannot be wider than 1.91:1.");
export type InstagramPostItem = z.infer<typeof instagramPostItem>;

export const instagramPostInput = z
  .object({
    /** Chosen by the composer once per post. A retry with the same id can never post twice. */
    id: z.string().uuid(),
    source: z.enum(["cull", "develop"]),
    format: z.enum(["portrait", "square"]),
    caption: z.string().max(8800),
    items: z.array(instagramPostItem).min(1).max(INSTAGRAM_CAROUSEL_LIMIT),
  })
  .strict()
  .superRefine((value, context) => {
    const problem = captionProblem(value.caption);
    if (problem) context.addIssue({ code: "custom", message: problem, path: ["caption"] });
    const expected = INSTAGRAM_FEED_FORMATS[value.format];
    if (
      value.items.some((item) => item.width !== expected.width || item.height !== expected.height)
    )
      context.addIssue({
        code: "custom",
        message: "Every photo in a post must be framed to the same feed size.",
        path: ["items"],
      });
    if (new Set(value.items.map((item) => item.sha256)).size !== value.items.length)
      context.addIssue({ code: "custom", message: "Remove duplicate photos.", path: ["items"] });
  });
export type InstagramPostInput = z.infer<typeof instagramPostInput>;

export type InstagramPostStatus =
  | "awaiting-upload" // draft saved; the page is uploading the framed JPEGs
  | "preparing" // Instagram is being given the photos
  | "processing" // containers exist; Instagram has not finished reading them
  | "publishing" // media_publish was sent; its answer has not been recorded
  | "published"
  | "failed" // nothing is on Instagram; retry is safe
  | "uncertain" // media_publish may have succeeded; never sent again
  | "discarded"
  | "expired";

export type InstagramPostRecord = {
  kind: "instagram-post";
  version: 1;
  id: string;
  source: InstagramPostInput["source"];
  format: InstagramFeedFormat;
  caption: string;
  accountId: string;
  username: string;
  items: (InstagramPostItem & { path: string })[];
  createdAt: string;
  updatedAt: string;
  status: InstagramPostStatus;
  note: string;
  /** Uploaded bytes matched every declared hash and JPEG header. */
  verifiedAt?: string;
  children?: string[];
  containerId?: string;
  containerCreatedAt?: string;
  mediaId?: string;
  permalink?: string;
  publishedAt?: string;
  mediaRemovedAt?: string;
};

export const isInstagramPostRecord = (value: unknown): value is InstagramPostRecord =>
  !!value && typeof value === "object" && (value as { kind?: unknown }).kind === "instagram-post";

/** The post id is the idempotency key; the same id must always mean the same post. */
export function sameInstagramPost(record: InstagramPostRecord, input: InstagramPostInput) {
  return (
    record.source === input.source &&
    record.format === input.format &&
    record.caption === input.caption &&
    record.items.length === input.items.length &&
    record.items.every(
      (item, index) =>
        item.sha256 === input.items[index]!.sha256 &&
        item.bytes === input.items[index]!.bytes &&
        item.width === input.items[index]!.width &&
        item.height === input.items[index]!.height,
    )
  );
}

export const instagramPostSettled = (status: InstagramPostStatus) =>
  status === "published" ||
  status === "failed" ||
  status === "uncertain" ||
  status === "discarded" ||
  status === "expired";

/** Discard is only offered when nothing can be (or may have been) on Instagram. */
export const instagramPostDiscardable = (status: InstagramPostStatus) =>
  status === "awaiting-upload" || status === "failed";

/** Reads the frame size from a baseline or progressive JPEG header. Null if not a JPEG. */
export function jpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1]!;
    if (marker === 0xff) {
      offset++; // fill byte
      continue;
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      offset += 2; // markers without a length
      continue;
    }
    const length = (bytes[offset + 2]! << 8) | bytes[offset + 3]!;
    if (length < 2) return null;
    // SOF0..SOF15 except DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (offset + 9 > bytes.length) return null;
      return {
        height: (bytes[offset + 5]! << 8) | bytes[offset + 6]!,
        width: (bytes[offset + 7]! << 8) | bytes[offset + 8]!,
      };
    }
    if (marker === 0xda || marker === 0xd9) return null; // scan before a frame header
    offset += 2 + length;
  }
  return null;
}

export async function sha256Hex(bytes: BufferSource) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
