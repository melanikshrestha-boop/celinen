import { useEffect, useMemo, useState } from "react";
import {
  GENIE_POLLS,
  STANCE_LABEL,
  type BlogComment,
  type CommentStance,
} from "@/lib/blog-comments";
import {
  listBlogThread,
  postBlogComment,
  voteBlogComment,
  voteGeniePoll,
} from "@/lib/blog-comments.functions";

const VOTE_KEY = (id: string) => `foto-blog-vote:${id}`;
const POLL_KEY = (slug: string) => `foto-blog-poll:${slug}`;

export function BlogComments({ slug }: { slug: string }) {
  const [comments, setComments] = useState<BlogComment[]>([]);
  const [poll, setPoll] = useState<Record<string, number>>({});
  const [name, setName] = useState("");
  const [stance, setStance] = useState<CommentStance>("improve");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pollPicked, setPollPicked] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void listBlogThread({ data: { slug } })
      .then((thread) => {
        if (!alive) return;
        setComments(thread.comments);
        setPoll(thread.poll);
      })
      .catch(() => {
        if (alive) setError("Could not load notes. Try again.");
      });
    setPollPicked(typeof localStorage === "undefined" ? null : localStorage.getItem(POLL_KEY(slug)));
    return () => {
      alive = false;
    };
  }, [slug]);

  const totalPoll = useMemo(
    () => Object.values(poll).reduce((sum, n) => sum + n, 0),
    [poll],
  );

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const comment = await postBlogComment({ data: { slug, name, stance, body } });
      setComments((current) => [...current, comment]);
      setBody("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save that note.");
    } finally {
      setBusy(false);
    }
  };

  const vote = async (id: string, delta: "like" | "dislike") => {
    if (typeof localStorage !== "undefined" && localStorage.getItem(VOTE_KEY(id))) return;
    try {
      const next = await voteBlogComment({ data: { id, delta } });
      if (typeof localStorage !== "undefined") localStorage.setItem(VOTE_KEY(id), delta);
      setComments((current) => current.map((row) => (row.id === id ? next : row)));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Vote did not save.");
    }
  };

  const pickPoll = async (option: string) => {
    if (pollPicked) return;
    try {
      const next = await voteGeniePoll({ data: { slug, option } });
      setPoll(next);
      setPollPicked(option);
      if (typeof localStorage !== "undefined") localStorage.setItem(POLL_KEY(slug), option);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Poll did not save.");
    }
  };

  return (
    <section className="blog-comments" aria-labelledby="blog-comments-heading">
      <h2 id="blog-comments-heading">Talk back</h2>
      <p>
        Like it, hate it, or tell us what to build. Notes are stored with this FOTO site so the
        product can actually change.
      </p>

      {slug === "sports-photographer-genie" && (
        <div className="blog-comments__poll">
          <p>Which pain is loudest on your card?</p>
          <ul>
            {GENIE_POLLS.map((option) => {
              const count = poll[option.id] ?? 0;
              const share = totalPoll ? Math.round((count / totalPoll) * 100) : 0;
              return (
                <li key={option.id}>
                  <button
                    type="button"
                    aria-pressed={pollPicked === option.id}
                    disabled={Boolean(pollPicked)}
                    onClick={() => void pickPoll(option.id)}
                  >
                    <span>{option.label}</span>
                    <strong>
                      {count} · {share}%
                    </strong>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <form
        className="blog-comments__form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label htmlFor="blog-comment-name">Name</label>
        <input
          id="blog-comment-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          autoComplete="nickname"
          placeholder="Your name"
        />
        <fieldset>
          <legend>This note is</legend>
          {(Object.keys(STANCE_LABEL) as CommentStance[]).map((key) => (
            <label key={key}>
              <input
                type="radio"
                name="stance"
                checked={stance === key}
                onChange={() => setStance(key)}
              />
              {STANCE_LABEL[key]}
            </label>
          ))}
        </fieldset>
        <label htmlFor="blog-comment-body">Note</label>
        <textarea
          id="blog-comment-body"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={5}
          placeholder="What works, what is wrong, what to ship next."
        />
        {error ? <p className="blog-comments__error">{error}</p> : null}
        <button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Post note"}
        </button>
      </form>

      <ol className="blog-comments__list">
        {comments.length === 0 ? (
          <li className="blog-comments__empty">No notes yet. Be the first photographer.</li>
        ) : (
          comments.map((comment) => (
            <li key={comment.id}>
              <p>
                <strong>{comment.name}</strong>
                <span>{STANCE_LABEL[comment.stance]}</span>
                <time dateTime={comment.createdAt}>
                  {new Date(comment.createdAt).toLocaleString()}
                </time>
              </p>
              <p>{comment.body}</p>
              <div>
                <button type="button" onClick={() => void vote(comment.id, "like")}>
                  Agree {comment.likes}
                </button>
                <button type="button" onClick={() => void vote(comment.id, "dislike")}>
                  Disagree {comment.dislikes}
                </button>
              </div>
            </li>
          ))
        )}
      </ol>
    </section>
  );
}
