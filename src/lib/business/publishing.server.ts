import { businessDatabase } from "./database.server";
import { instagramConnection, instagramCredential, instagramRequest } from "./instagram.server";
import {
  newPublication,
  validatePublicSelection,
  type Publication,
  type PublicationInput,
} from "./publishing";
import { objectPath } from "../delivery/workflow";
import { owned } from "../delivery/remote.server";
import { publicPhotographer } from "../commerce/service.server";
import { facebookStatus } from "./facebook.server";
import { publishStories } from "./story-publishing.server";
import { DEFAULT_SOCIAL_FRAME } from "../social-frame";
const BUCKET = "publishing-media-v1";

export async function listPublications(owner: string) {
  const { data, error } = await businessDatabase()
    .from("social_publications")
    .select("record")
    .eq("owner_id", owner)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error)
    throw new Error("Publishing needs the business workspace migration and server connection.");
  // Studio Instagram posts share the table but not the delivery publication shape.
  return (data ?? [])
    .filter((row) => (row.record as { kind?: unknown }).kind === undefined)
    .map((row) => row.record as Publication);
}
export async function createPublication(owner: string, input: PublicationInput) {
  const db = businessDatabase();
  const previous = await db
    .from("social_publications")
    .select("record")
    .eq("owner_id", owner)
    .eq("id", input.id)
    .maybeSingle();
  if (previous.error) throw new Error("Publishing storage is unavailable.");
  if (previous.data) {
    const old = previous.data.record as Publication;
    if (
      old.roomId !== input.roomId ||
      old.caption !== input.caption ||
      old.title !== input.title ||
      old.instagram !== input.instagram ||
      old.portfolio !== input.portfolio ||
      !!old.instagramStory !== !!input.instagramStory ||
      !!old.facebookStory !== !!input.facebookStory ||
      JSON.stringify(old.frame) !== JSON.stringify(input.frame) ||
      JSON.stringify(old.versionIds) !== JSON.stringify(input.versionIds)
    )
      throw new Error("This draft already exists with different content. Start a new draft.");
    return old;
  }
  const room = await owned(input.roomId, owner);
  validatePublicSelection(room.state, input.versionIds, input.instagram && !input.frame);
  const account = input.instagram || input.instagramStory ? await instagramConnection(owner) : null;
  if (
    (input.instagram || input.instagramStory) &&
    (!account || Date.parse(account.expires_at) < Date.now() + 60000)
  )
    throw new Error("Connect Instagram before preparing an Instagram post.");
  // Bounded account storage. Draft ids are retained across retries in the composer.
  const { count, error: countError } = await db
    .from("social_publications")
    .select("id", { head: true, count: "exact" })
    .eq("owner_id", owner);
  if (countError || (count ?? 0) >= 1000)
    throw new Error("Publishing storage is full or unavailable.");
  const record = newPublication(input, account?.account_id);
  if (input.facebookStory) {
    const facebook = await facebookStatus(owner);
    if (!facebook.active || !facebook.selected)
      throw new Error("Connect Facebook and choose a Page before preparing a Story.");
    record.facebookPageId = facebook.selected;
  }
  const { error } = await db
    .from("social_publications")
    .insert({ id: input.id, owner_id: owner, record });
  if (error)
    throw new Error(
      "Could not save the publishing draft. Nothing was posted; retry with the same draft.",
    );
  return record;
}

/** The row lease serializes both destinations. Never repeat an uncertain media_publish call. */
export async function runPublication(
  owner: string,
  id: string,
  dependencies?: {
    db: ReturnType<typeof businessDatabase>;
    owned: typeof owned;
    instagramCredential: typeof instagramCredential;
    instagramRequest: typeof instagramRequest;
  },
) {
  const db = dependencies?.db ?? businessDatabase(),
    lease = crypto.randomUUID();
  const readOwned = dependencies?.owned ?? owned;
  const getCredential = dependencies?.instagramCredential ?? instagramCredential;
  const requestInstagram = dependencies?.instagramRequest ?? instagramRequest;
  const { data: claimed, error } = await db
    .from("social_publications")
    .update({ lease, lease_until: new Date(Date.now() + 180000).toISOString() })
    .eq("id", id)
    .eq("owner_id", owner)
    .or(`lease.is.null,lease_until.lt.${new Date().toISOString()}`)
    .select("record,revision")
    .maybeSingle();
  if (error || !claimed)
    throw new Error(
      "This publication is already running or unavailable. Refresh its status shortly.",
    );
  const post = claimed.record as Publication;
  let revision = Number(claimed.revision);
  const save = async () => {
    const { data, error } = await db
      .from("social_publications")
      .update({
        record: post,
        revision: revision + 1,
        lease_until: new Date(Date.now() + 180000).toISOString(),
      })
      .eq("id", id)
      .eq("owner_id", owner)
      .eq("lease", lease)
      .select("id")
      .maybeSingle();
    if (error || !data)
      throw new Error("Could not save publication progress. Refresh before doing anything else.");
    revision++;
  };
  try {
    const room = await readOwned(post.roomId, owner);
    const versions = validatePublicSelection(
      room.state,
      post.versionIds,
      post.instagram && !post.frame,
    );
    const { data: bucket, error: bucketError } = await db.storage.getBucket(BUCKET);
    if (
      bucketError ||
      !bucket ||
      bucket.public ||
      bucket.file_size_limit !== 8388608 ||
      bucket.allowed_mime_types?.length !== 1 ||
      bucket.allowed_mime_types[0] !== "image/jpeg"
    )
      throw new Error("Publishing media storage is not safely configured.");
    // Independent JPEG copies. Gallery invitation revocation cannot make unrelated originals public.
    for (let index = post.paths.length; index < versions.length; index++) {
      const v = versions[index]!,
        path = `${owner}/${post.id}/${v.id}.jpg`;
      const source = objectPath(owner, post.roomId, v, "phone");
      const copy = await db.storage
        .from("delivery-private-v1")
        .copy(source, path, { destinationBucket: BUCKET });
      if (copy.error) {
        // A timed-out copy may already exist. Only accept the expected JPEG and exact size.
        const existing = await db.storage.from(BUCKET).info(path);
        if (
          existing.error ||
          existing.data?.size !== v.variants.phone.bytes ||
          existing.data?.contentType !== "image/jpeg"
        )
          throw new Error(
            "Could not prepare public copies. Retry; your private gallery is unchanged.",
          );
      }
      post.paths.push(path);
      await save();
    }
    // Framed derivatives are separate from portfolio copies and never overwrite a gallery image.
    if (
      (post.frame && post.instagram && !post.instagramPaths) ||
      ((post.instagramStory || post.facebookStory) && !post.storyPath)
    ) {
      const { nativePublicationFrame } = await import("./native-frame.server");
      const render = async (index: number, format: "portrait" | "square" | "story") => {
        const source = await db.storage
          .from("delivery-private-v1")
          .download(objectPath(owner, post.roomId, versions[index]!, "phone"));
        if (
          source.error ||
          !source.data ||
          source.data.size !== versions[index]!.variants.phone.bytes
        )
          throw new Error("Could not load the approved photo for social preparation.");
        const hash = Array.from(
          new Uint8Array(await crypto.subtle.digest("SHA-256", await source.data.arrayBuffer())),
          (byte) => byte.toString(16).padStart(2, "0"),
        ).join("");
        if (hash !== versions[index]!.variants.phone.sha256)
          throw new Error("Approved photo bytes changed. Refresh the delivery before publishing.");
        const image = await nativePublicationFrame(source.data, {
          ...(post.frame ?? DEFAULT_SOCIAL_FRAME),
          format,
        });
        const path = `${owner}/${post.id}/${versions[index]!.id}-${format}.jpg`;
        const result = await db.storage
          .from(BUCKET)
          .upload(path, image, { contentType: "image/jpeg", upsert: true });
        if (result.error)
          throw new Error("Could not save the framed social copy. Nothing new was posted.");
        return path;
      };
      if (post.frame && post.instagram && !post.instagramPaths) {
        const paths: string[] = [];
        for (let index = 0; index < versions.length; index++)
          paths.push(await render(index, post.frame.format === "square" ? "square" : "portrait"));
        post.instagramPaths = paths;
        await save();
      }
      if ((post.instagramStory || post.facebookStory) && !post.storyPath) {
        post.storyPath = await render(0, "story");
        await save();
      }
    }
    if (post.portfolio && post.destinations.portfolio.status !== "published") {
      post.destinations.portfolio = {
        status: "published",
        note: "Published to your Celinen portfolio.",
        url: `/p/${post.id}`,
      };
      await save();
    }
    if (post.instagram && post.destinations.instagram.status !== "published") {
      try {
        const token = await getCredential(owner, post.instagramAccountId!);
        if (["publishing", "uncertain"].includes(post.destinations.instagram.status)) {
          const status = post.containerId
            ? await requestInstagram(`${post.containerId}?fields=status_code`, token)
            : null;
          post.destinations.instagram =
            status?.status_code === "PUBLISHED"
              ? { status: "published", note: "Instagram confirmed this post was published." }
              : {
                  status: "uncertain",
                  note: "Instagram has not confirmed the outcome. Check your profile before starting another post. This request will not be sent twice.",
                };
          await save();
          // Other destinations may still complete while this feed outcome remains uncertain.
        } else {
          post.destinations.instagram = {
            status: "preparing",
            note: "Preparing Instagram images…",
          };
          await save();
          if (!post.containerId) {
            const ids: string[] = post.childContainers ?? [];
            const feedPaths = post.instagramPaths ?? post.paths;
            for (const path of feedPaths.slice(ids.length)) {
              const signed = await db.storage.from(BUCKET).createSignedUrl(path, 3600);
              if (signed.error || !signed.data?.signedUrl)
                throw new Error("Could not prepare Instagram access to this photo.");
              const result = await requestInstagram(
                `${post.instagramAccountId}/media`,
                token,
                new URLSearchParams({
                  image_url: signed.data.signedUrl,
                  ...(feedPaths.length > 1
                    ? { is_carousel_item: "true" }
                    : { caption: post.caption }),
                }),
              );
              if (typeof result.id !== "string" || !/^\d+$/.test(result.id))
                throw new Error("Instagram did not return an image container.");
              ids.push(result.id);
              post.childContainers = ids;
              await save();
            }
            if (ids.length > 1) {
              // Children must finish processing before a carousel container is requested.
              for (const child of ids) {
                const status = await requestInstagram(`${child}?fields=status_code`, token);
                if (status.status_code !== "FINISHED") {
                  if (["EXPIRED", "ERROR"].includes(String(status.status_code)))
                    delete post.childContainers;
                  throw new Error(
                    "Instagram is still preparing these photos. Wait a moment, then retry.",
                  );
                }
              }
              const carousel = await requestInstagram(
                `${post.instagramAccountId}/media`,
                token,
                new URLSearchParams({
                  media_type: "CAROUSEL",
                  children: ids.join(","),
                  caption: post.caption,
                }),
              );
              if (typeof carousel.id !== "string" || !/^\d+$/.test(carousel.id))
                throw new Error("Instagram did not return a carousel container.");
              post.containerId = carousel.id;
            } else post.containerId = ids[0]!;
            await save();
          }
          const status = await requestInstagram(`${post.containerId}?fields=status_code`, token);
          if (status.status_code !== "FINISHED") {
            if (status.status_code === "EXPIRED" || status.status_code === "ERROR") {
              delete post.containerId;
              delete post.childContainers;
            }
            throw new Error(
              "Instagram has not finished preparing this post. Wait a moment and retry.",
            );
          }
          // Durable write before the only externally visible mutation.
          post.destinations.instagram = {
            status: "publishing",
            note: "Waiting for Instagram confirmation…",
          };
          await save();
          const result = await requestInstagram(
            `${post.instagramAccountId}/media_publish`,
            token,
            new URLSearchParams({ creation_id: post.containerId! }),
          );
          if (typeof result.id !== "string" || !/^\d+$/.test(result.id))
            throw new Error("Instagram did not confirm the published post.");
          post.destinations.instagram = {
            status: "published",
            note: "Published to Instagram.",
            id: result.id,
          };
          await save();
          try {
            const media = await requestInstagram(`${result.id}?fields=permalink`, token);
            if (
              typeof media.permalink === "string" &&
              /^https:\/\/(www\.)?instagram\.com\//.test(media.permalink)
            )
              post.destinations.instagram.url = media.permalink;
          } catch {
            /* Confirmed publishing does not depend on permalink retrieval. */
          }
          await save();
        }
      } catch (e) {
        if (post.destinations.instagram.status !== "published") {
          const uncertain = ["publishing", "uncertain"].includes(
            post.destinations.instagram.status,
          );
          post.destinations.instagram = {
            status: uncertain ? "uncertain" : "failed",
            note: uncertain
              ? "Confirmation was interrupted. Refresh to check Instagram; we will not send this post again."
              : e instanceof Error
                ? e.message
                : "Instagram could not publish.",
          };
          await save();
        }
      }
    }
    if (post.instagramStory || post.facebookStory)
      await publishStories(
        owner,
        post,
        async () => {
          if (!post.storyPath) throw new Error("Prepare the Story frame first.");
          const result = await db.storage.from(BUCKET).createSignedUrl(post.storyPath, 3600);
          if (result.error || !result.data?.signedUrl)
            throw new Error("Could not give the social platform temporary access to this Story.");
          return result.data.signedUrl;
        },
        save,
      );
    return post;
  } finally {
    await db
      .from("social_publications")
      .update({ lease: null, lease_until: null })
      .eq("id", id)
      .eq("owner_id", owner)
      .eq("lease", lease);
  }
}

export async function publicPortfolio(id: string, db = businessDatabase()) {
  const { data, error } = await db
    .from("social_publications")
    .select("record,owner_id")
    .eq("id", id)
    .maybeSingle();
  const post = data?.record as Publication | undefined;
  if (
    error ||
    !post ||
    !post.permission ||
    !post.portfolio ||
    !post.paths.length ||
    post.destinations.portfolio.status !== "published"
  )
    throw new Error("This portfolio story is not available.");
  const { data: urls, error: mediaError } = await db.storage
    .from(BUCKET)
    .createSignedUrls(post.paths, 120);
  if (mediaError || urls?.some((row) => row.error))
    throw new Error("Photos are temporarily unavailable.");
  return {
    title: post.title,
    caption: post.caption,
    // A missing/unavailable public profile must not expose a private account name.
    creator: await publicPhotographer(data!.owner_id, db).catch(() => null),
    portfolioUrl: `/photographer/${data!.owner_id}`,
    images: (urls ?? []).flatMap((row) => (row.signedUrl ? [row.signedUrl] : [])),
  };
}
export async function publicPortfolioIndex(owner: string, db = businessDatabase()) {
  const { data, error } = await db
    .from("social_publications")
    .select("id,record")
    .eq("owner_id", owner)
    .eq("record->destinations->portfolio->>status", "published")
    .order("created_at", { ascending: false })
    .limit(60);
  if (error) throw new Error("This portfolio is temporarily unavailable.");
  const rows = (data ?? []).filter(
    (row) =>
      (row.record as Publication).destinations.portfolio.status === "published" &&
      (row.record as Publication).paths.length > 0,
  );
  const paths = rows.flatMap((row) => (row.record as Publication).paths.slice(0, 1));
  if (!paths.length) return [];
  const signed = await db.storage.from(BUCKET).createSignedUrls(paths, 120);
  if (signed.error || signed.data?.some((row) => row.error))
    throw new Error("Portfolio images are temporarily unavailable.");
  return rows.map((row, i) => ({
    id: row.id as string,
    title: (row.record as Publication).title,
    image: signed.data?.[i]?.signedUrl ?? "",
  }));
}
export async function unpublishPortfolio(owner: string, id: string) {
  const db = businessDatabase();
  const { data, error } = await db
    .from("social_publications")
    .select("record,revision")
    .eq("id", id)
    .eq("owner_id", owner)
    .maybeSingle();
  if (error || !data) throw new Error("This publication is unavailable.");
  const post = data.record as Publication;
  post.portfolio = false;
  post.destinations.portfolio = {
    status: "off",
    note: "Removed from portfolio. Existing image links expire within two minutes.",
  };
  const result = await db
    .from("social_publications")
    .update({ record: post, revision: Number(data.revision) + 1 })
    .eq("id", id)
    .eq("owner_id", owner)
    .is("lease", null)
    .eq("revision", data.revision)
    .select("id")
    .maybeSingle();
  if (result.error || !result.data)
    throw new Error("Could not unpublish. Retry after the current operation finishes.");
  return post;
}
