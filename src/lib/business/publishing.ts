import { z } from "zod";
import { downloadable, type DeliveryState, type DeliveryVersion } from "../delivery/workflow";
import { socialFrameSchema } from "../social-frame";

export const publicationInput = z
  .object({
    id: z.string().uuid(),
    roomId: z.string().uuid(),
    title: z.string().trim().min(1).max(160),
    caption: z.string().max(2200),
    versionIds: z.array(z.string().uuid()).min(1).max(10),
    instagram: z.boolean(),
    instagramStory: z.boolean().optional(),
    facebookStory: z.boolean().optional(),
    frame: socialFrameSchema.optional(),
    portfolio: z.boolean(),
    permission: z.literal(true),
  })
  .strict()
  .refine(
    (v) => v.instagram || v.portfolio || v.instagramStory || v.facebookStory,
    "Choose at least one destination.",
  )
  .refine(
    (v) => !(v.instagramStory || v.facebookStory) || v.versionIds.length === 1,
    "Choose one photo for a Story publication.",
  )
  .refine((v) => new Set(v.versionIds).size === v.versionIds.length, "Remove duplicate photos.");
export type PublicationInput = z.infer<typeof publicationInput>;
export type Destination = {
  status: "off" | "pending" | "preparing" | "publishing" | "published" | "failed" | "uncertain";
  note: string;
  id?: string;
  url?: string;
};
export type Publication = PublicationInput & {
  createdAt: string;
  permissionAt: string;
  paths: string[];
  containerId?: string;
  childContainers?: string[];
  instagramAccountId?: string;
  facebookPageId?: string;
  instagramPaths?: string[];
  storyPath?: string;
  storyContainerId?: string;
  facebookPhotoId?: string;
  destinations: {
    instagram: Destination;
    portfolio: Destination;
    instagramStory?: Destination;
    facebookStory?: Destination;
  };
};
export function eligibleVersions(
  state: DeliveryState,
  now = new Date().toISOString(),
): DeliveryVersion[] {
  return state.photos.flatMap((p) =>
    p.versions.filter((v) => v.ready && p.published === v.id && downloadable(state, v.id, now)),
  );
}
export function validatePublicSelection(state: DeliveryState, ids: string[], instagram: boolean) {
  const available = eligibleVersions(state);
  return ids.map((id) => {
    const version = available.find((v) => v.id === id);
    if (!version)
      throw new Error(
        "Only approved, released final versions can be published. Refresh this shoot.",
      );
    const image = version.variants.phone;
    if (image.bytes > 8 * 1024 * 1024) throw new Error("Social images must be smaller than 8 MB.");
    if (instagram && (image.width / image.height < 0.8 || image.width / image.height > 1.91))
      throw new Error(
        "Instagram photos must fit between 4:5 portrait and 1.91:1 landscape. Prepare a social crop in Studio first.",
      );
    return version;
  });
}
export function newPublication(input: PublicationInput, accountId?: string): Publication {
  const now = new Date().toISOString();
  return {
    ...publicationInput.parse(input),
    createdAt: now,
    permissionAt: now,
    paths: [],
    ...(accountId ? { instagramAccountId: accountId } : {}),
    destinations: {
      instagram: { status: input.instagram ? "pending" : "off", note: "" },
      portfolio: { status: input.portfolio ? "pending" : "off", note: "" },
      ...(input.instagramStory ? { instagramStory: { status: "pending" as const, note: "" } } : {}),
      ...(input.facebookStory ? { facebookStory: { status: "pending" as const, note: "" } } : {}),
    },
  };
}
const tags: Record<string, string[]> = {
  sports: ["SportsPhotography", "GameDay", "SportsPortraits"],
  wedding: ["WeddingPhotography", "WeddingStory", "WeddingDetails"],
  portrait: ["PortraitPhotography", "PortraitSession", "Portraits"],
  property: ["RealEstatePhotography", "ArchitecturePhotography", "InteriorPhotography"],
  brand: ["BrandPhotography", "BrandStory", "CommercialPhotography"],
};
/** Uses only supplied facts. Never guesses identities, locations, awards or releases from photos. */
export function captionDraft(title: string, story: string, genre: string, tone: string) {
  const cleanTitle = title.trim().slice(0, 160),
    cleanStory = story.trim().slice(0, 1400);
  const opening =
    tone === "minimal"
      ? cleanTitle
      : tone === "warm"
        ? `${cleanTitle} — a few moments worth keeping.`
        : `${cleanTitle}. The details tell the story.`;
  return `${opening}${cleanStory ? `\n\n${cleanStory}` : ""}\n\n${(tags[genre] ?? ["Photography", "PhotoStory"]).map((t) => `#${t}`).join(" ")}`;
}
export function canRetryInstagram(publication: Publication) {
  return !["off", "published", "publishing", "uncertain"].includes(
    publication.destinations.instagram.status,
  );
}
