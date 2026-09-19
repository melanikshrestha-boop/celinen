import type { SocialProvider } from "../../social/connectors";
import { facebookPublisher } from "./facebook.server";
import { instagramPublisher } from "./instagram.server";
import { linkedinPublisher } from "./linkedin.server";
import { threadsPublisher } from "./threads.server";
import { tiktokPublisher } from "./tiktok.server";
import { xPublisher } from "./x.server";
import { youtubePublisher } from "./youtube.server";
import type { Publisher } from "./types";

export const PUBLISHERS: Record<SocialProvider, Publisher> = {
  instagram: instagramPublisher,
  facebook_page: facebookPublisher,
  threads: threadsPublisher,
  linkedin: linkedinPublisher,
  x: xPublisher,
  tiktok: tiktokPublisher,
  youtube: youtubePublisher,
};
export type {
  Publisher,
  PublishContext,
  PublishResult,
  ReconcileResult,
  PublishUnit,
} from "./types";
