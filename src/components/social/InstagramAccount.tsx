/** Instagram inside Social accounts: connection, posts sent from Celinen, the
 * account's own posts with insights, and comment moderation.
 *
 * On screen: one card. The top row is the connected @username with Connect,
 * Reconnect or Disconnect. Below it, posts sent from Cull or Develop that still
 * need attention, then a grid of the account's posts. Choosing a post opens its
 * numbers (reach, likes, comments, saves, shares) and its comments, each with
 * Reply, Hide/Unhide and Delete. Delete asks once more before it happens.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, Instagram } from "lucide-react";
import {
  advanceInstagramPost,
  discardInstagramPost,
  finishInstagramConnection,
  instagramAccount,
  instagramCommentAction,
  instagramComments,
  instagramInsights,
  instagramMedia,
  startInstagramConnection,
} from "@/lib/business/instagram.functions";
import { disconnectInstagram } from "@/lib/business/publishing.functions";
import {
  INSIGHT_METRICS,
  type InstagramCommentView,
  type InstagramInsights,
  type InstagramMediaView,
} from "@/lib/social/instagram-manage";
import { instagramPostDiscardable } from "@/lib/social/instagram-post";
import "./instagram.css";

type Account = Awaited<ReturnType<typeof instagramAccount>>;
const METRIC_LABELS: Record<(typeof INSIGHT_METRICS)[number], string> = {
  reach: "Reach",
  likes: "Likes",
  comments: "Comments",
  saved: "Saves",
  shares: "Shares",
};
const message = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;
const number = (value: number) => value.toLocaleString("en-US");

export function InstagramAccount() {
  const [account, setAccount] = useState<Account | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [media, setMedia] = useState<InstagramMediaView[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [chosen, setChosen] = useState<InstagramMediaView | null>(null);
  const callback = useRef(false);

  const connection = account?.connection;
  const can = (scope: string) => !!connection?.active && connection.scopes.includes(scope as never);

  const refresh = useCallback(async () => {
    const next = await instagramAccount();
    setAccount(next);
    return next;
  }, []);

  const loadMedia = useCallback(async (after: string | null) => {
    const page = await instagramMedia({ data: { after } });
    setMedia((current) => (after ? [...current, ...page.media] : page.media));
    setNext(page.next);
  }, []);

  useEffect(() => {
    let live = true;
    const query = new URLSearchParams(window.location.search);
    const code = query.get("code"),
      state = query.get("state");
    // Every other network shares this callback path and names itself with ?connector=.
    const ours = !callback.current && !query.has("connector") && (code || query.has("error"));
    const start = async () => {
      if (ours) {
        callback.current = true;
        // The code is single-use; keep it out of history and referrers.
        window.history.replaceState(null, "", window.location.pathname);
        if (!code || !state)
          throw new Error("Instagram connection was cancelled. Nothing was connected.");
        await finishInstagramConnection({ data: { code, state } });
      }
      const loaded = await refresh();
      if (live && loaded.connection?.active) await loadMedia(null);
    };
    start().catch(
      (reason) => live && setError(message(reason, "Instagram is unavailable right now.")),
    );
    return () => {
      live = false;
    };
  }, [refresh, loadMedia]);

  async function run(work: () => Promise<unknown>, fallback: string) {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (reason) {
      setError(message(reason, fallback));
    } finally {
      setBusy(false);
    }
  }

  const pending = (account?.posts ?? []).filter((post) => post.status !== "published").slice(0, 5);

  return (
    <section className="ig-account" aria-label="Instagram">
      <div className="ig-account__head">
        <Instagram size={18} aria-hidden="true" />
        <h2>{connection ? `@${connection.username}` : "Instagram"}</h2>
        <span className="ig-account__spacer" />
        {account && !account.configured ? null : (
          <>
            <button
              type="button"
              disabled={busy || !account}
              onClick={() =>
                void run(
                  async () => window.location.assign(await startInstagramConnection()),
                  "Instagram could not be connected.",
                )
              }
            >
              {connection ? "Reconnect" : "Connect"}
            </button>
            {connection && (
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await disconnectInstagram();
                    setMedia([]);
                    setChosen(null);
                    await refresh();
                  }, "Could not disconnect Instagram.")
                }
              >
                Disconnect
              </button>
            )}
          </>
        )}
      </div>
      {account && !account.configured && (
        <p className="ig-account__note">Missing {account.missing.join(", ")}</p>
      )}
      {connection && !connection.active && (
        <p className="ig-account__note">Access expired. Reconnect.</p>
      )}
      {error && (
        <p role="alert" className="ig-account__error">
          {error}
        </p>
      )}

      {pending.length > 0 && (
        <ul className="ig-account__posts">
          {pending.map((post) => (
            <li key={post.id}>
              <span className="ig-account__post-caption">
                {post.caption.split("\n")[0] || `${post.photos} photos`}
              </span>
              <span className="ig-account__post-note">{post.note}</span>
              {(post.status === "uncertain" ||
                post.status === "processing" ||
                post.status === "preparing") && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      async () => (
                        await advanceInstagramPost({ data: { id: post.id } }),
                        refresh()
                      ),
                      "Could not check this post.",
                    )
                  }
                >
                  Check again
                </button>
              )}
              {instagramPostDiscardable(post.status) && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      async () => (
                        await discardInstagramPost({ data: { id: post.id } }),
                        refresh()
                      ),
                      "Could not discard this post.",
                    )
                  }
                >
                  Discard
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {connection?.active && (
        <>
          <ul className="ig-account__grid">
            {media.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  aria-pressed={chosen?.id === item.id}
                  aria-label={item.caption.split("\n")[0] || item.timestamp}
                  onClick={() => setChosen(chosen?.id === item.id ? null : item)}
                >
                  {item.image ? (
                    <img src={item.image} alt="" loading="lazy" referrerPolicy="no-referrer" />
                  ) : (
                    <span />
                  )}
                </button>
              </li>
            ))}
          </ul>
          {next && (
            <button
              type="button"
              className="ig-account__more"
              disabled={busy}
              onClick={() => void run(() => loadMedia(next), "Could not load more posts.")}
            >
              More
            </button>
          )}
          {chosen && (
            <PostDetail
              key={chosen.id}
              media={chosen}
              insights={can("instagram_business_manage_insights")}
              comments={can("instagram_business_manage_comments")}
            />
          )}
        </>
      )}
    </section>
  );
}

function PostDetail({
  media,
  insights,
  comments,
}: {
  media: InstagramMediaView;
  insights: boolean;
  comments: boolean;
}) {
  const [numbers, setNumbers] = useState<InstagramInsights | null>(null);
  const [thread, setThread] = useState<InstagramCommentView[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [replying, setReplying] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const loadComments = useCallback(
    async (after: string | null) => {
      const page = await instagramComments({ data: { mediaId: media.id, after } });
      setThread((current) => (after && current ? [...current, ...page.comments] : page.comments));
      setNext(page.next);
    },
    [media.id],
  );

  useEffect(() => {
    let live = true;
    if (insights)
      void instagramInsights({ data: { mediaId: media.id } }).then(
        (value) => live && setNumbers(value),
        (reason) => live && setError(message(reason, "Insights are unavailable.")),
      );
    if (comments)
      void loadComments(null).catch(
        (reason) => live && setError(message(reason, "Comments are unavailable.")),
      );
    return () => {
      live = false;
    };
  }, [media.id, insights, comments, loadComments]);

  async function act(id: string, work: () => Promise<unknown>) {
    setBusy(id);
    setError(null);
    try {
      await work();
      await loadComments(null);
    } catch (reason) {
      setError(message(reason, "Instagram did not accept that."));
    } finally {
      setBusy(null);
    }
  }

  const row = (
    comment: InstagramCommentView | InstagramCommentView["replies"][number],
    topLevel: boolean,
  ) => (
    <li key={comment.id} className={comment.hidden ? "is-hidden" : undefined}>
      <p>
        <strong>{comment.username}</strong> {comment.text}
      </p>
      <div className="ig-account__actions">
        {topLevel && !comment.hidden && (
          <button
            type="button"
            disabled={!!busy}
            onClick={() => (setReplying(replying === comment.id ? null : comment.id), setReply(""))}
          >
            Reply
          </button>
        )}
        <button
          type="button"
          disabled={!!busy}
          onClick={() =>
            void act(comment.id, () =>
              instagramCommentAction({
                data: {
                  action: "hide",
                  mediaId: media.id,
                  commentId: comment.id,
                  hidden: !comment.hidden,
                },
              }),
            )
          }
        >
          {comment.hidden ? "Unhide" : "Hide"}
        </button>
        {confirmDelete === comment.id ? (
          <>
            <button
              type="button"
              className="is-danger"
              disabled={!!busy}
              onClick={() =>
                void act(comment.id, async () => {
                  await instagramCommentAction({
                    data: { action: "delete", mediaId: media.id, commentId: comment.id },
                  });
                  setConfirmDelete(null);
                })
              }
            >
              Delete comment
            </button>
            <button type="button" onClick={() => setConfirmDelete(null)}>
              Keep
            </button>
          </>
        ) : (
          <button type="button" disabled={!!busy} onClick={() => setConfirmDelete(comment.id)}>
            Delete
          </button>
        )}
      </div>
      {topLevel && replying === comment.id && (
        <form
          className="ig-account__reply"
          onSubmit={(event) => {
            event.preventDefault();
            const text = reply.trim();
            if (!text) return;
            void act(comment.id, async () => {
              await instagramCommentAction({
                data: { action: "reply", mediaId: media.id, commentId: comment.id, message: text },
              });
              setReplying(null);
              setReply("");
            });
          }}
        >
          <input
            value={reply}
            maxLength={2200}
            onChange={(event) => setReply(event.target.value)}
            aria-label={`Reply to ${comment.username}`}
            autoFocus
          />
          <button type="submit" disabled={!!busy || !reply.trim()}>
            Send
          </button>
        </form>
      )}
      {"replies" in comment && comment.replies.length > 0 && (
        <ul>{comment.replies.map((child) => row(child as InstagramCommentView, false))}</ul>
      )}
    </li>
  );

  return (
    <div className="ig-account__detail">
      <div className="ig-account__detail-head">
        <p>{media.caption.split("\n")[0]}</p>
        {media.permalink && (
          <a href={media.permalink} target="_blank" rel="noreferrer" aria-label="Open on Instagram">
            <ExternalLink size={14} />
          </a>
        )}
      </div>
      {insights ? (
        <dl className="ig-account__metrics">
          {INSIGHT_METRICS.map((metric) => (
            <div key={metric}>
              <dt>{METRIC_LABELS[metric]}</dt>
              <dd>{numbers?.[metric] === undefined ? "–" : number(numbers[metric]!)}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="ig-account__note">Reconnect to allow insights.</p>
      )}
      {error && (
        <p role="alert" className="ig-account__error">
          {error}
        </p>
      )}
      {comments ? (
        thread && (
          <>
            <ul className="ig-account__comments">{thread.map((comment) => row(comment, true))}</ul>
            {next && (
              <button
                type="button"
                className="ig-account__more"
                disabled={!!busy}
                onClick={() => void loadComments(next)}
              >
                More comments
              </button>
            )}
          </>
        )
      ) : (
        <p className="ig-account__note">Reconnect to allow comment management.</p>
      )}
    </div>
  );
}
