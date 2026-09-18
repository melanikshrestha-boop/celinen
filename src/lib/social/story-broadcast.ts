/** One set of hearted photos, sent to every connected story destination at once:
 * the contract shared by the composer (browser) and the broadcaster (Worker).
 * Pure: no network, no storage.
 *
 * Shape of the thing. A story is one photo, not an album, so a set of N photos
 * posted to M destinations is N x M publishes. Each one is its own unit with its
 * own idempotency, because Instagram accepting photo 3 tells you nothing about
 * whether Facebook accepted photo 1. A destination's status is a roll-up of its
 * units; the photographer sees one line per destination and can open it.
 *
 * Platform limits (checked 2026-09-18, see docs/STORIES-SETUP.md for sources):
 *  - Instagram stories: JPEG, <= 8 MB, 9:16 recommended to avoid cropping.
 *    `media_type=STORIES`, one image per container, no carousel, no caption.
 *  - Facebook Page photo stories: <= 10 MB. A photo used in a published post
 *    cannot be reused for a story, so every story gets its own upload.
 *  - Snapchat: no third-party server-side story publish exists. See SNAPCHAT below.
 */
import { z } from "zod";
import { PUBLISHING_BUCKET, jpegDimensions, sha256Hex } from "./instagram-post";

export { PUBLISHING_BUCKET, jpegDimensions, sha256Hex };

/** 9:16. Both Meta platforms recommend it; anything else is cropped or padded by them. */
export const STORY_FORMAT = { width: 1080, height: 1920, label: "9:16" } as const;
/** Instagram's limit is 8 MB and Facebook's is 10 MB; the smaller one governs. */
export const STORY_IMAGE_BYTES = 8 * 1024 * 1024;
/** One publish request per photo per destination: a long set is a long queue. */
export const STORY_SET_LIMIT = 20;

/** Where a set can go. `snapchat` is a hand-off, not a publish — see below. */
export const STORY_DESTINATIONS = ["instagram-story", "facebook-story", "snapchat"] as const;
export type StoryDestination = (typeof STORY_DESTINATIONS)[number];
export const storyDestination = z.enum(STORY_DESTINATIONS);

export const DESTINATION_LABELS: Record<StoryDestination, string> = {
  "instagram-story": "Instagram",
  "facebook-story": "Facebook",
  snapchat: "Snapchat",
};

/** Destinations Celinen publishes to itself, through the platform's own API. */
export const SERVER_DESTINATIONS = [
  "instagram-story",
  "facebook-story",
] as const satisfies readonly StoryDestination[];
export const isServerDestination = (
  destination: StoryDestination,
): destination is (typeof SERVER_DESTINATIONS)[number] =>
  (SERVER_DESTINATIONS as readonly string[]).includes(destination);

/** Snapchat has no compliant third-party story publish: Creative Kit shares a
 * link (never the photo's pixels) and needs the native SDK for media, and the
 * Public Profile API is allowlisted to Snap partners posting to brand Public
 * Profiles, not to a photographer's own account. Automating a personal account
 * would breach Snap's Terms, so Celinen hands the framed JPEGs to the phone's
 * own share sheet (or a download) and the photographer posts them. This is
 * recorded as handed off; it is never reported as posted. */
export const SNAPCHAT_HANDOFF =
  "Snapchat has no story API for other apps. Celinen saves the framed photos so you can post them.";

export const storyItem = z
  .object({
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    bytes: z.number().int().min(1).max(STORY_IMAGE_BYTES),
    width: z.literal(STORY_FORMAT.width),
    height: z.literal(STORY_FORMAT.height),
  })
  .strict();
export type StoryItem = z.infer<typeof storyItem>;

export const storyBroadcastInput = z
  .object({
    /** Chosen by the composer once per broadcast. A retry with the same id can never post twice. */
    id: z.string().uuid(),
    source: z.enum(["develop", "cull"]),
    /** Only the destinations Celinen publishes to are broadcast; Snapchat is a
     * browser hand-off and never reaches the Worker. */
    destinations: z.array(z.enum(SERVER_DESTINATIONS)).min(1).max(SERVER_DESTINATIONS.length),
    items: z.array(storyItem).min(1).max(STORY_SET_LIMIT),
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.destinations).size !== value.destinations.length)
      context.addIssue({
        code: "custom",
        message: "Choose each destination once.",
        path: ["destinations"],
      });
    if (new Set(value.items.map((item) => item.sha256)).size !== value.items.length)
      context.addIssue({ code: "custom", message: "Remove duplicate photos.", path: ["items"] });
  });
export type StoryBroadcastInput = z.infer<typeof storyBroadcastInput>;

/** One photo going to one destination. */
export type StoryUnitStatus =
  | "pending" // nothing has been sent for this photo yet
  | "preparing" // the platform is being given the photo
  | "processing" // the platform has it and has not finished reading it
  | "publishing" // the publish call was sent; its answer has not been recorded
  | "posted"
  | "failed" // nothing is on the platform; retry is safe
  | "uncertain"; // the publish may have succeeded; never sent again

export type StoryUnit = {
  status: StoryUnitStatus;
  note: string;
  /** Instagram: the creation container. Settles an uncertain publish. */
  containerId?: string;
  containerCreatedAt?: string;
  /** Facebook: the unpublished photo the story is made from. */
  photoId?: string;
  /** What the platform called the story once it existed. */
  storyId?: string;
  postedAt?: string;
};

/** A destination's roll-up, which is what the photographer reads. */
export type DestinationStatus =
  | "pending"
  | "working"
  | "posted" // every photo is on this destination
  | "partial" // some photos are on it, and the rest are not going to be
  | "failed" // nothing is on it, and retrying is safe
  | "uncertain" // something may be on it; Celinen will not send it again
  | "needs-reconnect"; // the connection is missing, expired or short a permission

export type DestinationState = {
  status: DestinationStatus;
  note: string;
  /** One per item, in the same order. */
  units: StoryUnit[];
};

export type StoryBroadcastStatus =
  | "awaiting-upload"
  | "broadcasting"
  | "done" // every destination has settled; read each one for what happened
  | "discarded"
  | "expired";

export type StoryBroadcastRecord = {
  kind: "story-broadcast";
  version: 1;
  id: string;
  source: StoryBroadcastInput["source"];
  items: (StoryItem & { path: string })[];
  destinations: Partial<Record<StoryDestination, DestinationState>>;
  createdAt: string;
  updatedAt: string;
  status: StoryBroadcastStatus;
  note: string;
  /** Uploaded bytes matched every declared hash and JPEG header. */
  verifiedAt?: string;
  mediaRemovedAt?: string;
  /** Instagram account and Facebook Page as they were when this was confirmed. */
  instagramAccountId?: string;
  instagramUsername?: string;
  facebookPageId?: string;
  facebookPageName?: string;
};

export const isStoryBroadcastRecord = (value: unknown): value is StoryBroadcastRecord =>
  !!value && typeof value === "object" && (value as { kind?: unknown }).kind === "story-broadcast";

/** The broadcast id is the idempotency key; the same id must always mean the same set. */
export function sameStoryBroadcast(record: StoryBroadcastRecord, input: StoryBroadcastInput) {
  return (
    record.source === input.source &&
    record.items.length === input.items.length &&
    record.items.every(
      (item, index) =>
        item.sha256 === input.items[index]!.sha256 && item.bytes === input.items[index]!.bytes,
    ) &&
    input.destinations.every((destination) => !!record.destinations[destination])
  );
}

/** A unit that has been sent, or may have been, is never sent again. */
export const unitSendable = (unit: StoryUnit) =>
  unit.status === "pending" ||
  unit.status === "preparing" ||
  unit.status === "processing" ||
  unit.status === "failed";

export const unitSettled = (unit: StoryUnit) =>
  unit.status === "posted" || unit.status === "failed" || unit.status === "uncertain";

/** What one line in the results reads, derived from its units rather than stored
 * separately, so the roll-up can never disagree with the photos underneath it. */
export function rollUpDestination(units: readonly StoryUnit[]): DestinationStatus {
  if (!units.length) return "pending";
  const posted = units.filter((unit) => unit.status === "posted").length;
  if (posted === units.length) return "posted";
  if (units.some((unit) => !unitSettled(unit))) return "working";
  if (units.some((unit) => unit.status === "uncertain")) return posted ? "partial" : "uncertain";
  return posted ? "partial" : "failed";
}

export const destinationSettled = (state: DestinationState) =>
  state.status === "posted" ||
  state.status === "partial" ||
  state.status === "failed" ||
  state.status === "uncertain" ||
  state.status === "needs-reconnect";

/** Retry sends only the photos that are safe to send again. Everything the
 * platform may already have stays where it is. */
export const destinationRetryable = (state: DestinationState) =>
  state.status !== "posted" && state.units.some(unitSendable);

export const broadcastSettled = (record: StoryBroadcastRecord) =>
  record.status === "done" || record.status === "discarded" || record.status === "expired";

/** Discard is only offered when nothing can be (or may have been) on a platform. */
export const broadcastDiscardable = (record: StoryBroadcastRecord) =>
  record.status === "awaiting-upload" ||
  Object.values(record.destinations).every(
    (state) => !state || state.units.every((unit) => unit.status === "pending"),
  );

export type StoryBroadcastView = {
  id: string;
  status: StoryBroadcastStatus;
  note: string;
  source: StoryBroadcastRecord["source"];
  photos: number;
  createdAt: string;
  destinations: {
    destination: StoryDestination;
    label: string;
    status: DestinationStatus;
    note: string;
    posted: number;
    total: number;
  }[];
};

export function viewStoryBroadcast(record: StoryBroadcastRecord): StoryBroadcastView {
  return {
    id: record.id,
    status: record.status,
    note: record.note,
    source: record.source,
    photos: record.items.length,
    createdAt: record.createdAt,
    destinations: STORY_DESTINATIONS.flatMap((destination) => {
      const state = record.destinations[destination];
      if (!state) return [];
      return [
        {
          destination,
          label: DESTINATION_LABELS[destination],
          status: state.status,
          note: state.note,
          posted: state.units.filter((unit) => unit.status === "posted").length,
          total: state.units.length,
        },
      ];
    }),
  };
}

/** Wording for one destination line. Kept here so the page and any later
 * surface say the same thing about the same state. */
export function destinationSummary(
  status: DestinationStatus,
  posted: number,
  total: number,
): string {
  switch (status) {
    case "posted":
      return total === 1 ? "Posted" : `Posted ${posted}`;
    case "partial":
      return `Posted ${posted} of ${total}`;
    case "working":
      return "Posting";
    case "failed":
      return "Failed";
    case "uncertain":
      return "Unconfirmed";
    case "needs-reconnect":
      return "Reconnect";
    default:
      return "Waiting";
  }
}
