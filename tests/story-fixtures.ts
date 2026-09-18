/** Recorded-shape fakes for story broadcasting: the Instagram Graph fake from
 * the feed tests, plus Facebook's Page endpoints, on one fetch. Nothing here
 * touches the network.
 *
 * Facebook paths are prefixed `fb:` so a route can tell `{id}/photos` on a Page
 * apart from `{id}/media` on an Instagram account without guessing from the id.
 */
import { FakeGraph, type GraphCall } from "./instagram-fixtures";

export { FakeDatabase, graphError } from "./instagram-fixtures";
export type { GraphCall } from "./instagram-fixtures";

/** Facebook's own error envelope, same shape as Instagram's. */
export const facebookError = (status: number, code: number, subcode?: number) =>
  Response.json(
    {
      error: {
        message: "upstream detail with secrets",
        type: "OAuthException",
        code,
        ...(subcode ? { error_subcode: subcode } : {}),
        fbtrace_id: "x",
      },
    },
    { status },
  );

export class FakeSocialGraph extends FakeGraph {
  /** Unpublished photo ids handed out by `{page}/photos`, in order. */
  photoIds: string[] = [];
  /** What `{page}/stories` reports, for reconciling a lost confirmation. */
  pageStories: { post_id: string; media_id: string; status: string }[] = [];
  nextPhoto = 900_000;
  nextStory = 500_000;

  constructor() {
    super();
    // POST {page-id}/photos with published=false returns an unpublished photo id.
    this.on("POST", /fb:\d+\/photos$/, () => {
      const id = String(this.nextPhoto++);
      this.photoIds.push(id);
      return { id };
    })
      // POST {page-id}/photo_stories with photo_id returns success + post_id.
      .on("POST", /fb:\d+\/photo_stories$/, (call: GraphCall) => {
        const postId = `${call.path.split(":")[1]!.split("/")[0]}_${this.nextStory++}`;
        this.pageStories.push({
          post_id: postId,
          media_id: call.body["photo_id"] ?? "",
          status: "PUBLISHED",
        });
        return { success: true, post_id: postId };
      })
      .on("GET", /fb:\d+\/stories/, () => ({ data: this.pageStories }));
  }

  /** Both hosts on one fetch. Instagram keeps its bare path; Facebook gets `fb:`. */
  override fetch = (async (input: unknown, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const versioned = /^\/v\d+\.0\//.test(url.pathname);
    const bare = url.pathname.replace(/^\/v\d+\.0\//, "").replace(/^\//, "") + url.search;
    const path =
      url.hostname === "graph.instagram.com" && versioned
        ? bare
        : url.hostname === "graph.facebook.com" && versioned
          ? `fb:${bare}`
          : url.href;
    const body = Object.fromEntries(
      new URLSearchParams(init?.body instanceof URLSearchParams ? init.body : ""),
    );
    const call: GraphCall = {
      method,
      path: decodeURIComponent(path),
      body,
      auth: new Headers(init?.headers).get("Authorization"),
    };
    this.calls.push(call);
    for (const [pattern, handler] of this.routes) {
      if (!pattern.test(`${method} ${call.path}`)) continue;
      const result = handler(call);
      if (result instanceof Response) return result;
      if (result instanceof Error) throw result;
      return Response.json(result);
    }
    return Response.json({ error: { message: "unknown route", code: 100 } }, { status: 400 });
  }) as typeof fetch;
}
