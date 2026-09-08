import { businessDatabase } from "./database.server";
import { publicStoryId } from "./story-sharing";
import { publicationInput } from "./publishing";

const headers = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, noarchive",
};

/** A stable crawler URL, not a permanent signed-storage URL or a private-gallery bypass. */
export async function storyCoverResponse(id: string, db?: ReturnType<typeof businessDatabase>) {
  if (!publicStoryId.safeParse(id).success)
    return new Response("Story unavailable", { status: 404, headers });
  try {
    const database = db ?? businessDatabase();
    const { data, error } = await database
      .from("social_publications")
      .select("record,owner_id")
      .eq("id", id)
      .maybeSingle();
    const post = data?.record;
    const input = publicationInput.safeParse(
      post && {
        id: post.id,
        roomId: post.roomId,
        title: post.title,
        caption: post.caption,
        versionIds: post.versionIds,
        instagram: post.instagram,
        portfolio: post.portfolio,
        permission: post.permission,
      },
    );
    if (error) return new Response("Preview temporarily unavailable", { status: 503, headers });
    if (
      !data ||
      !input.success ||
      input.data.id !== id ||
      !input.data.portfolio ||
      post.destinations?.portfolio?.status !== "published" ||
      !publicStoryId.safeParse(data.owner_id).success
    )
      return new Response("Story unavailable", { status: 404, headers });
    const path = `${data.owner_id}/${id}/${input.data.versionIds[0]}.jpg`;
    if (post.paths?.[0] !== path)
      return new Response("Story unavailable", { status: 404, headers });
    const storage = database.storage.from("publishing-media-v1");
    const info = await storage.info(path);
    if (
      info.error ||
      info.data?.contentType !== "image/jpeg" ||
      !info.data.size ||
      info.data.size > 8 * 1024 * 1024
    )
      return new Response("Preview temporarily unavailable", { status: 503, headers });
    const image = await storage.download(path);
    if (image.error || !image.data || image.data.size !== info.data.size)
      return new Response("Preview temporarily unavailable", { status: 503, headers });
    const magic = new Uint8Array(await image.data.slice(0, 3).arrayBuffer());
    if (magic[0] !== 0xff || magic[1] !== 0xd8 || magic[2] !== 0xff)
      return new Response("Preview temporarily unavailable", { status: 503, headers });
    return new Response(image.data, {
      headers: {
        ...headers,
        "Content-Type": "image/jpeg",
        "Content-Length": String(image.data.size),
      },
    });
  } catch {
    return new Response("Preview temporarily unavailable", { status: 503, headers });
  }
}
