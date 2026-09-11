import type { Publication } from "./publishing";
import { instagramCredential, instagramRequest } from "./instagram.server";
import { facebookCredential, facebookRequest } from "./facebook.server";

type Dependencies = {
  instagramCredential: typeof instagramCredential;
  instagramRequest: typeof instagramRequest;
  facebookCredential: typeof facebookCredential;
  facebookRequest: typeof facebookRequest;
};
/** Called under the publication row lease. Commit intent before each visible provider write. */
export async function publishStories(
  owner: string,
  post: Publication,
  imageUrl: () => Promise<string>,
  save: () => Promise<void>,
  dependencies: Dependencies = {
    instagramCredential,
    instagramRequest,
    facebookCredential,
    facebookRequest,
  },
) {
  for (const destination of ["instagramStory", "facebookStory"] as const) {
    if (!post[destination] || post.destinations[destination]?.status === "published") continue;
    const set = async (
      status: NonNullable<Publication["destinations"][typeof destination]>["status"],
      note: string,
      id?: string,
    ) => {
      post.destinations[destination] = { status, note, ...(id ? { id } : {}) };
      await save();
    };
    try {
      const uncertain = ["publishing", "uncertain"].includes(
        post.destinations[destination]?.status ?? "",
      );
      if (destination === "instagramStory") {
        const token = await dependencies.instagramCredential(owner, post.instagramAccountId!);
        if (uncertain) {
          const status = post.storyContainerId
            ? await dependencies.instagramRequest(
                `${post.storyContainerId}?fields=status_code`,
                token,
              )
            : null;
          await set(
            status?.status_code === "PUBLISHED" ? "published" : "uncertain",
            status?.status_code === "PUBLISHED"
              ? "Instagram confirmed the Story."
              : "Outcome unconfirmed. Check Instagram; LensLabs will not post this Story twice.",
          );
          continue;
        }
        const account = await dependencies.instagramRequest("me?fields=account_type", token);
        if (account.account_type !== "BUSINESS")
          throw new Error(
            "Instagram Story publishing requires a Business account. Use the prepared Story file for other account types.",
          );
        await set("preparing", "Preparing Instagram Story…");
        if (!post.storyContainerId) {
          const result = await dependencies.instagramRequest(
            `${post.instagramAccountId}/media`,
            token,
            new URLSearchParams({ image_url: await imageUrl(), media_type: "STORIES" }),
          );
          if (typeof result.id !== "string" || !/^\d+$/.test(result.id))
            throw new Error("Instagram did not return a Story container.");
          post.storyContainerId = result.id;
          await save();
        }
        const progress = await dependencies.instagramRequest(
          `${post.storyContainerId}?fields=status_code`,
          token,
        );
        if (progress.status_code !== "FINISHED") {
          if (["ERROR", "EXPIRED"].includes(String(progress.status_code))) {
            delete post.storyContainerId;
            await save();
          }
          throw new Error("Instagram is still preparing the Story. Wait a moment, then continue.");
        }
        await set("publishing", "Waiting for Instagram Story confirmation…");
        const result = await dependencies.instagramRequest(
          `${post.instagramAccountId}/media_publish`,
          token,
          new URLSearchParams({ creation_id: post.storyContainerId }),
        );
        if (typeof result.id !== "string" || !/^\d+$/.test(result.id))
          throw new Error("Instagram did not confirm the Story.");
        await set("published", "Published to Instagram Stories.", result.id);
      } else {
        if (uncertain) {
          await set(
            "uncertain",
            "Outcome unconfirmed. Check your Facebook Page; LensLabs will not post this Story twice.",
          );
          continue;
        }
        const token = await dependencies.facebookCredential(owner, post.facebookPageId!);
        await set("preparing", "Preparing Facebook Page Story…");
        if (!post.facebookPhotoId) {
          const result = await dependencies.facebookRequest(
            `${post.facebookPageId}/photos`,
            token,
            new URLSearchParams({ url: await imageUrl(), published: "false" }),
          );
          if (typeof result.id !== "string" || !/^\d+$/.test(result.id))
            throw new Error("Facebook did not return a photo ID.");
          post.facebookPhotoId = result.id;
          await save();
        }
        await set("publishing", "Waiting for Facebook Story confirmation…");
        const result = await dependencies.facebookRequest(
          `${post.facebookPageId}/photo_stories`,
          token,
          new URLSearchParams({ photo_id: post.facebookPhotoId }),
        );
        if (
          result.success !== true ||
          typeof result.post_id !== "string" ||
          !/^[\d_]+$/.test(result.post_id)
        )
          throw new Error("Facebook did not confirm the Story.");
        await set("published", "Published to Facebook Page Stories.", result.post_id);
      }
    } catch (error) {
      const status = post.destinations[destination]?.status;
      if (String(status) === "published") throw error; // A failed durable receipt must not become a retryable post.
      const uncertain = status === "publishing" || status === "uncertain";
      await set(
        uncertain ? "uncertain" : "failed",
        uncertain
          ? "Confirmation interrupted. Check the destination; this Story will not be sent again."
          : error instanceof Error
            ? error.message
            : "Story preparation failed.",
      );
    }
  }
}
