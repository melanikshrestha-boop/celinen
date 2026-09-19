/** Social connectors: the contract shared by the Social accounts page and the
 * Worker. Pure: no network, no storage, no secrets.
 *
 * Every limit below is the platform's documented one (URLs beside each), so a
 * post is refused here, in plain English, before any provider call is made.
 */
import { z } from "zod";
import { jpegDimensions } from "./instagram-post";

export const SOCIAL_PROVIDERS = [
  "instagram",
  "facebook_page",
  "threads",
  "linkedin",
  "x",
  "tiktok",
  "youtube",
] as const;
export type SocialProvider = (typeof SOCIAL_PROVIDERS)[number];
export const isSocialProvider = (value: unknown): value is SocialProvider =>
  typeof value === "string" && (SOCIAL_PROVIDERS as readonly string[]).includes(value);

export const PROVIDER_LABEL: Record<SocialProvider, string> = {
  instagram: "Instagram",
  facebook_page: "Facebook Page",
  threads: "Threads",
  linkedin: "LinkedIn",
  x: "X",
  tiktok: "TikTok",
  youtube: "YouTube",
};

/** The page's network ids (social-accounts.ts) that a provider serves. */
export const PROVIDER_FOR_NETWORK: Record<string, SocialProvider> = {
  instagram: "instagram",
  facebook: "facebook_page",
  threads: "threads",
  linkedin: "linkedin",
  x: "x",
  tiktok: "tiktok",
  "youtube-shorts": "youtube",
};

/** Worker secrets each provider needs, by exact name. `PUBLISH_ORIGIN` and
 * `SOCIAL_TOKEN_KEY` are shared by all of them. */
export const PROVIDER_SECRETS: Record<SocialProvider, readonly string[]> = {
  instagram: ["INSTAGRAM_APP_ID", "INSTAGRAM_APP_SECRET"],
  facebook_page: ["FACEBOOK_APP_ID", "FACEBOOK_APP_SECRET"],
  threads: ["THREADS_APP_ID", "THREADS_APP_SECRET"],
  linkedin: ["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET"],
  x: ["X_CLIENT_ID", "X_CLIENT_SECRET"],
  tiktok: ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"],
  youtube: ["GOOGLE_YOUTUBE_CLIENT_ID", "GOOGLE_YOUTUBE_CLIENT_SECRET"],
};
export const SHARED_SECRETS = ["SOCIAL_TOKEN_KEY", "PUBLISH_ORIGIN"] as const;

/** The exact callback each developer portal must list. */
export const connectorRedirect = (origin: string, provider: SocialProvider) =>
  provider === "instagram" ? `${origin}/publish` : `${origin}/publish?connector=${provider}`;

export type UnitKind = "post" | "story" | "reel" | "video";
export type MediaKind = "image" | "video";

/** What the page declares and the Worker re-verifies byte for byte. */
export const mediaItem = z
  .object({
    kind: z.enum(["image", "video"]),
    mime: z.enum(["image/jpeg", "video/mp4", "video/quicktime"]),
    bytes: z
      .number()
      .int()
      .min(1)
      .max(1024 * 1024 * 1024),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    width: z.number().int().min(1).max(8192),
    height: z.number().int().min(1).max(8192),
    durationMs: z
      .number()
      .int()
      .min(0)
      .max(24 * 60 * 60_000)
      .optional(),
  })
  .strict()
  .refine(
    (item) => (item.kind === "image") === (item.mime === "image/jpeg"),
    "Media type mismatch.",
  )
  .refine(
    (item) => item.kind === "image" || item.durationMs !== undefined,
    "Video needs a duration.",
  );
export type MediaItem = z.infer<typeof mediaItem>;
/** A stored media item: the declared facts plus where the bytes are. */
export type StoredMedia = MediaItem & { bucket: string; path: string };

export const unitOptions = z
  .object({
    /** YouTube: public | unlisted | private. TikTok: the creator's privacy level. */
    privacy: z.string().max(40).optional(),
    /** Instagram Reels: also show in the feed grid. */
    shareToFeed: z.boolean().optional(),
    /** LinkedIn: post as this organization URN instead of the member. */
    organization: z
      .string()
      .regex(/^urn:li:organization:\d+$/)
      .optional(),
    /** TikTok: creator-side toggles. */
    disableComment: z.boolean().optional(),
    disableDuet: z.boolean().optional(),
    disableStitch: z.boolean().optional(),
  })
  .strict();
export type UnitOptions = z.infer<typeof unitOptions>;

export const scheduleInput = z
  .object({
    /** Chosen by the page once; the same id can never schedule twice. */
    id: z.string().uuid(),
    providers: z.array(z.enum(SOCIAL_PROVIDERS)).min(1).max(SOCIAL_PROVIDERS.length),
    kind: z.enum(["post", "story", "reel", "video"]).default("post"),
    caption: z.string().max(20000),
    title: z.string().max(400).optional(),
    scheduledAt: z.string().datetime({ offset: true }),
    media: z.array(mediaItem).max(20).default([]),
    options: unitOptions.default({}),
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.providers).size !== value.providers.length)
      context.addIssue({ code: "custom", message: "Each network once.", path: ["providers"] });
    if (new Set(value.media.map((item) => item.sha256)).size !== value.media.length)
      context.addIssue({ code: "custom", message: "Remove duplicate media.", path: ["media"] });
    const videos = value.media.filter((item) => item.kind === "video").length;
    if (videos > 1)
      context.addIssue({ code: "custom", message: "One video per post.", path: ["media"] });
    if (videos && value.media.length > 1)
      context.addIssue({
        code: "custom",
        message: "A video posts on its own, without photos.",
        path: ["media"],
      });
  });
export type ScheduleInput = z.infer<typeof scheduleInput>;

export type ScheduleStatus =
  "scheduled" | "publishing" | "posted" | "failed" | "uncertain" | "cancelled";

export type ScheduledPostView = {
  id: string;
  groupId: string;
  provider: SocialProvider;
  accountId: string;
  kind: UnitKind;
  caption: string;
  title: string | null;
  media: { kind: MediaKind; width: number; height: number; durationMs?: number }[];
  scheduledAt: string;
  status: ScheduleStatus;
  attempts: number;
  nextAttemptAt: string | null;
  lastError: string | null;
  result: { remoteId: string; url?: string } | null;
  postedAt: string | null;
  createdAt: string;
};

/** Every provider limit used for pre-flight validation. */
type ImageLimits = {
  maxBytes: number;
  minWidth: number;
  maxWidth: number;
  /** width / height */
  minAspect: number;
  maxAspect: number;
  maxCount: number;
};
type VideoLimits = {
  maxBytes: number;
  minMs: number;
  maxMs: number;
  minAspect: number;
  maxAspect: number;
};
export type ProviderLimits = {
  caption: number;
  /** Unit kinds this provider accepts. */
  kinds: readonly UnitKind[];
  image: ImageLimits | null;
  video: VideoLimits | null;
  /** Documented daily posting cap, when the platform states one. */
  dailyPosts: number | null;
  textOnly: boolean;
};

const MB = 1024 * 1024;
export const PROVIDER_LIMITS: Record<SocialProvider, ProviderLimits> = {
  // https://developers.facebook.com/docs/instagram-platform/content-publishing
  instagram: {
    caption: 2200,
    kinds: ["post", "story", "reel"],
    image: {
      maxBytes: 8 * MB,
      minWidth: 320,
      maxWidth: 1440,
      minAspect: 0.8,
      maxAspect: 1.91,
      maxCount: 10,
    },
    // Reels: MP4/MOV, H.264/AAC, <= 1 GB, 3 s – 15 min, 9:16 recommended (0.01:1 – 10:1 accepted).
    video: {
      maxBytes: 1024 * MB,
      minMs: 3_000,
      maxMs: 15 * 60_000,
      minAspect: 0.01,
      maxAspect: 10,
    },
    dailyPosts: 100,
    textOnly: false,
  },
  // https://developers.facebook.com/docs/pages-api/posts and /docs/video-api/guides/publishing
  facebook_page: {
    caption: 63206,
    kinds: ["post", "story", "video"],
    image: {
      maxBytes: 10 * MB,
      minWidth: 1,
      maxWidth: 8192,
      minAspect: 0.05,
      maxAspect: 20,
      maxCount: 10,
    },
    // Page video: <= 1 GB non-resumable (Celinen sends a URL), up to 240 min.
    video: {
      maxBytes: 1024 * MB,
      minMs: 1_000,
      maxMs: 240 * 60_000,
      minAspect: 0.05,
      maxAspect: 20,
    },
    dailyPosts: null,
    textOnly: true,
  },
  // https://developers.facebook.com/docs/threads/posts and /docs/threads/overview (limits)
  threads: {
    caption: 500,
    kinds: ["post"],
    // JPEG/PNG, <= 8 MB, width 320–1440, aspect up to 10:1; carousel 2–20 items.
    image: {
      maxBytes: 8 * MB,
      minWidth: 320,
      maxWidth: 1440,
      minAspect: 0.1,
      maxAspect: 10,
      maxCount: 20,
    },
    // MOV/MP4, <= 1 GB, <= 5 min, aspect 0.01:1 – 10:1.
    video: { maxBytes: 1024 * MB, minMs: 1_000, maxMs: 5 * 60_000, minAspect: 0.01, maxAspect: 10 },
    dailyPosts: 250,
    textOnly: true,
  },
  // https://learn.microsoft.com/linkedin/marketing/community-management/shares/posts-api
  // https://learn.microsoft.com/linkedin/marketing/community-management/shares/images-api
  // https://learn.microsoft.com/linkedin/marketing/community-management/shares/videos-api
  linkedin: {
    caption: 3000,
    kinds: ["post"],
    // Images API: JPG/PNG/GIF, <= 250 MB, <= 36,152,320 pixels. Celinen stays well inside.
    image: {
      maxBytes: 8 * MB,
      minWidth: 1,
      maxWidth: 6012,
      minAspect: 0.05,
      maxAspect: 20,
      maxCount: 20,
    },
    // Videos API: 75 KB – 500 MB, 3 s – 30 min, aspect 1:2.4 – 2.4:1.
    video: {
      maxBytes: 500 * MB,
      minMs: 3_000,
      maxMs: 30 * 60_000,
      minAspect: 1 / 2.4,
      maxAspect: 2.4,
    },
    dailyPosts: 150,
    textOnly: true,
  },
  // https://docs.x.com/x-api/posts/creation-of-a-post and https://docs.x.com/x-api/media/quickstart/media-upload-chunked
  x: {
    caption: 280,
    kinds: ["post"],
    // JPEG/PNG/WEBP <= 5 MB, up to 4 per post.
    image: {
      maxBytes: 5 * MB,
      minWidth: 4,
      maxWidth: 8192,
      minAspect: 1 / 3,
      maxAspect: 3,
      maxCount: 4,
    },
    // MP4 (H.264/AAC), <= 512 MB, 0.5 s – 140 s, aspect 1:3 – 3:1.
    video: { maxBytes: 512 * MB, minMs: 500, maxMs: 140_000, minAspect: 1 / 3, maxAspect: 3 },
    // Free tier: 17 posts / 24 h per user; Basic: 100 / 24 h. Read live from response headers.
    dailyPosts: 17,
    textOnly: true,
  },
  // https://developers.tiktok.com/doc/content-posting-api-reference-direct-post
  // https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide
  tiktok: {
    // Video title: 2200 characters (UTF-16). Photo description: 4000.
    caption: 2200,
    kinds: ["post", "video"],
    // Photo posts: JPEG/WEBP, <= 20 MB each, up to 35 images (pulled from a verified URL).
    image: {
      maxBytes: 20 * MB,
      minWidth: 1,
      maxWidth: 8192,
      minAspect: 0.05,
      maxAspect: 20,
      maxCount: 35,
    },
    // MP4/MOV/WebM, <= 4 GB (Celinen's bucket allows 1 GB), 3 s – creator's max (usually 10 min).
    video: {
      maxBytes: 1024 * MB,
      minMs: 3_000,
      maxMs: 10 * 60_000,
      minAspect: 0.05,
      maxAspect: 20,
    },
    dailyPosts: null,
    textOnly: false,
  },
  // https://developers.google.com/youtube/v3/docs/videos/insert and /guides/using_resumable_upload_protocol
  youtube: {
    // Description <= 5000 bytes; title <= 100 characters (checked separately).
    caption: 5000,
    kinds: ["video"],
    image: null,
    // Shorts are vertical videos up to 3 minutes; longer uploads are ordinary videos.
    video: {
      maxBytes: 1024 * MB,
      minMs: 1_000,
      maxMs: 12 * 60 * 60_000,
      minAspect: 0.05,
      maxAspect: 20,
    },
    // 10,000 quota units per day by default; videos.insert costs 1,600 → 6 uploads.
    dailyPosts: 6,
    textOnly: false,
  },
};
export const YOUTUBE_INSERT_UNITS = 1600;
export const YOUTUBE_DEFAULT_QUOTA = 10_000;

/** Platforms count characters (an emoji is one), not UTF-16 units. */
const chars = (text: string) => Array.from(text).length;
/** X counts every URL as 23 characters regardless of length. */
export function xWeightedLength(text: string) {
  const urls = text.match(/https?:\/\/\S+/g) ?? [];
  let length = chars(text);
  for (const url of urls) length += 23 - chars(url);
  return length;
}

/** Null when the provider will accept this unit, otherwise the reason. */
export function validateUnit(
  provider: SocialProvider,
  kind: UnitKind,
  caption: string,
  title: string | null | undefined,
  media: readonly MediaItem[],
): string | null {
  const limits = PROVIDER_LIMITS[provider];
  const label = PROVIDER_LABEL[provider];
  if (!limits.kinds.includes(kind)) return `${label} cannot take this kind of post.`;
  const length = provider === "x" ? xWeightedLength(caption) : chars(caption);
  if (length > limits.caption)
    return `${label} captions are limited to ${limits.caption} characters.`;
  if (provider === "youtube") {
    if (!title?.trim()) return "YouTube needs a title.";
    if (chars(title) > 100) return "YouTube titles are limited to 100 characters.";
    if (/[<>]/.test(title)) return "YouTube titles cannot contain < or >.";
  }
  const images = media.filter((item) => item.kind === "image");
  const videos = media.filter((item) => item.kind === "video");
  if (!media.length) {
    if (!limits.textOnly) return `${label} needs a photo or video.`;
    if (!caption.trim()) return "Write a caption first.";
    return null;
  }
  if (kind === "story" && media.length !== 1) return "A story is one photo.";
  if (kind === "reel" || kind === "video") {
    if (videos.length !== 1 || images.length) return `${label} needs one video for this.`;
  }
  if (provider === "instagram" && kind === "post" && videos.length)
    return "Instagram videos post as Reels.";
  if (provider === "youtube" && videos.length !== 1) return "YouTube needs one video.";
  if (images.length) {
    if (!limits.image) return `${label} does not take photos here.`;
    if (images.length > limits.image.maxCount)
      return `${label} allows ${limits.image.maxCount} photos per post.`;
    for (const item of images) {
      if (item.bytes > limits.image.maxBytes)
        return `${label} photos must be under ${Math.round(limits.image.maxBytes / MB)} MB.`;
      if (item.width < limits.image.minWidth || item.width > limits.image.maxWidth)
        return `${label} photos must be ${limits.image.minWidth}–${limits.image.maxWidth} px wide.`;
      const aspect = item.width / item.height;
      if (kind === "story") {
        // Stories are 9:16 frames; anything else is cropped by the platform.
        if (Math.abs(aspect - 9 / 16) > 0.02) return "Stories must be framed 9:16 (1080×1920).";
      } else if (aspect < limits.image.minAspect - 1e-9 || aspect > limits.image.maxAspect + 1e-9)
        return `${label} rejected the photo shape.`;
    }
  }
  if (videos.length) {
    if (!limits.video) return `${label} does not take video.`;
    const item = videos[0]!;
    if (item.bytes > limits.video.maxBytes)
      return `${label} videos must be under ${Math.round(limits.video.maxBytes / MB)} MB.`;
    const duration = item.durationMs ?? 0;
    if (duration < limits.video.minMs)
      return `${label} videos must be at least ${limits.video.minMs / 1000} seconds.`;
    if (duration > limits.video.maxMs)
      return `${label} videos must be under ${Math.round(limits.video.maxMs / 60_000)} minutes.`;
    const aspect = item.width / item.height;
    if (aspect < limits.video.minAspect - 1e-9 || aspect > limits.video.maxAspect + 1e-9)
      return `${label} rejected the video shape.`;
  }
  return null;
}

/** What a provider refused, in Celinen's words. Upstream text is never stored:
 * it can echo request data and tokens. */
export type SocialErrorKind =
  | "auth" // token expired/revoked → reconnect
  | "permission" // scope not granted → reconnect and allow
  | "rate-limit" // try later
  | "quota" // daily cap reached → try tomorrow
  | "media" // the platform rejected the file
  | "rejected" // the platform refused the request as made
  | "duplicate" // the platform already has this post
  | "not-ready" // still processing; poll again
  | "unavailable" // no answer or 5xx
  | "config"; // Celinen is missing a secret or setting
export class SocialApiError extends Error {
  constructor(
    message: string,
    readonly kind: SocialErrorKind,
    /** HTTP status, or 0 when no response arrived (network, timeout). */
    readonly status = 0,
    readonly retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = "SocialApiError";
  }
  /** The platform answered and the answer means the request did nothing. */
  get definitive() {
    return this.status >= 400 && this.status < 500;
  }
  /** Worth another attempt later without a human. */
  get retryable() {
    return this.kind === "rate-limit" || this.kind === "unavailable" || this.kind === "not-ready";
  }
}

/** Retry schedule for retryable failures: a minute, then longer. Five attempts. */
export const RETRY_BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000] as const;
export const MAX_ATTEMPTS = 5;
export function backoffMs(attempt: number, error?: SocialApiError | null) {
  const base = RETRY_BACKOFF_MS[Math.min(Math.max(attempt - 1, 0), RETRY_BACKOFF_MS.length - 1)]!;
  return Math.max(base, error?.retryAfterMs ?? 0);
}
/** Uncertain rows are re-checked a few times, then left for a human. */
export const RECONCILE_BACKOFF_MS = [2 * 60_000, 10 * 60_000, 60 * 60_000] as const;
export const MAX_RECONCILES = 3;

/** Reads the frame size from a PNG header. Null if not a PNG. */
export function pngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24 || signature.some((byte, index) => bytes[index] !== byte)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (String.fromCharCode(...bytes.subarray(12, 16)) !== "IHDR") return null;
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

export const imageDimensions = (bytes: Uint8Array) => jpegDimensions(bytes) ?? pngDimensions(bytes);

export type Mp4Probe = { durationMs: number; width: number; height: number; brand: string };
/** Reads duration and the first video track's size from an MP4/MOV without
 * loading the file: only box headers and the `moov` box are fetched. Works
 * whether `moov` sits before or after `mdat`. Null when it is not ISO BMFF.
 */
export async function probeMp4(
  read: (offset: number, length: number) => Promise<Uint8Array>,
  size: number,
): Promise<Mp4Probe | null> {
  const MAX_MOOV = 16 * MB;
  const u32 = (b: Uint8Array, o: number) =>
    ((b[o]! << 24) >>> 0) + (b[o + 1]! << 16) + (b[o + 2]! << 8) + b[o + 3]!;
  const u64 = (b: Uint8Array, o: number) => u32(b, o) * 2 ** 32 + u32(b, o + 4);
  const type = (b: Uint8Array, o: number) =>
    String.fromCharCode(b[o]!, b[o + 1]!, b[o + 2]!, b[o + 3]!);
  let offset = 0;
  let brand = "";
  let moov: Uint8Array | null = null;
  for (let boxes = 0; offset + 8 <= size && boxes < 64; boxes++) {
    const head = await read(offset, Math.min(16, size - offset));
    if (head.length < 8) return null;
    let length = u32(head, 0);
    const name = type(head, 4);
    let headerSize = 8;
    if (length === 1) {
      if (head.length < 16) return null;
      length = u64(head, 8);
      headerSize = 16;
    } else if (length === 0) length = size - offset;
    if (length < headerSize) return null;
    if (boxes === 0) {
      if (name !== "ftyp") return null;
      const ftyp = await read(offset + 8, Math.min(4, size - offset - 8));
      brand = ftyp.length === 4 ? type(ftyp, 0) : "";
    }
    if (name === "moov") {
      if (length > MAX_MOOV) return null;
      moov = await read(offset + headerSize, length - headerSize);
      break;
    }
    offset += length;
  }
  if (!moov) return null;
  // Walk moov's children: mvhd for duration, trak/tkhd for the first sized track.
  let durationMs = -1;
  let width = 0,
    height = 0;
  const children = (buffer: Uint8Array, visit: (name: string, body: Uint8Array) => void) => {
    let at = 0;
    while (at + 8 <= buffer.length) {
      let length = u32(buffer, at);
      const name = type(buffer, at + 4);
      let header = 8;
      if (length === 1) {
        length = u64(buffer, at + 8);
        header = 16;
      } else if (length === 0) length = buffer.length - at;
      if (length < header || at + length > buffer.length) return;
      visit(name, buffer.subarray(at + header, at + length));
      at += length;
    }
  };
  children(moov, (name, body) => {
    if (name === "mvhd" && body.length >= 20) {
      const version = body[0];
      const timescale = version === 1 ? u32(body, 20) : u32(body, 12);
      const duration = version === 1 ? u64(body, 24) : u32(body, 16);
      if (timescale > 0) durationMs = Math.round((duration / timescale) * 1000);
    }
    if (name === "trak" && !(width && height)) {
      children(body, (child, inner) => {
        if (child !== "tkhd") return;
        // tkhd v0: matrix at 40, width at 76, height at 80; v1 shifts by 12 bytes.
        const version = inner[0];
        const base = version === 1 ? 88 : 76;
        if (inner.length < base + 8) return;
        // 16.16 fixed point; audio tracks are 0×0.
        const w = u32(inner, base) / 65536;
        const h = u32(inner, base + 4) / 65536;
        if (w > 0 && h > 0) {
          // The track matrix may rotate the frame; report the presentation size.
          const a = u32(inner, base - 36) / 65536;
          const rotated = Math.abs(a) < 0.5;
          width = Math.round(rotated ? h : w);
          height = Math.round(rotated ? w : h);
        }
      });
    }
  });
  if (durationMs < 0 || !width || !height) return null;
  return { durationMs, width, height, brand };
}

export const settledStatus = (status: ScheduleStatus) =>
  status === "posted" || status === "failed" || status === "cancelled";
