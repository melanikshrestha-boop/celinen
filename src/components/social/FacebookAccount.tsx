/** Facebook inside Social accounts: the connection, and which Page stories go to.
 *
 * This also owns the `?connector=facebook` half of the `/publish` callback. The
 * Instagram card deliberately ignores that query, and the desk that used to
 * handle it is no longer mounted, so without this card the Facebook connection
 * can be started but never finished.
 *
 * Page stories need a chosen Page: a Facebook account may administer several,
 * and the story broadcaster refuses to guess which one the photographer meant.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Facebook } from "lucide-react";
import {
  chooseFacebookPage,
  completeFacebook,
  connectFacebook,
  disconnectFacebook,
} from "@/lib/business/facebook.functions";
import { facebookAccount } from "@/lib/business/story-broadcast.functions";
import "./instagram.css";

type Account = Awaited<ReturnType<typeof facebookAccount>>;
const message = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

export function FacebookAccount() {
  const [account, setAccount] = useState<Account | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const callback = useRef(false);

  const refresh = useCallback(async () => setAccount(await facebookAccount()), []);

  useEffect(() => {
    let live = true;
    const query = new URLSearchParams(window.location.search);
    const code = query.get("code"),
      state = query.get("state");
    const ours =
      !callback.current && query.get("connector") === "facebook" && (code || query.has("error"));
    const start = async () => {
      if (ours) {
        callback.current = true;
        // The code is single-use; keep it out of history and referrers.
        window.history.replaceState(null, "", window.location.pathname);
        if (!code || !state)
          throw new Error("Facebook connection was cancelled. Nothing was connected.");
        await completeFacebook({ data: { code, state } });
      }
      if (live) await refresh();
    };
    start().catch(
      (reason) => live && setError(message(reason, "Facebook is unavailable right now.")),
    );
    return () => {
      live = false;
    };
  }, [refresh]);

  async function run(work: () => Promise<unknown>, fallback: string) {
    setBusy(true);
    setError(null);
    try {
      await work();
      await refresh();
    } catch (reason) {
      setError(message(reason, fallback));
    } finally {
      setBusy(false);
    }
  }

  if (account && !account.configured)
    return (
      <section className="ig-account" aria-label="Facebook">
        <div className="ig-account__head">
          <Facebook size={18} aria-hidden="true" />
          <h2>Facebook</h2>
          <span className="ig-account__spacer" />
          <span className="ig-account__note">Missing {account.missing.join(", ")}</span>
        </div>
      </section>
    );

  return (
    <section className="ig-account" aria-label="Facebook">
      <div className="ig-account__head">
        <Facebook size={18} aria-hidden="true" />
        <h2>{account?.selectedName || "Facebook"}</h2>
        <span className="ig-account__spacer" />
        <button
          type="button"
          disabled={busy || !account}
          onClick={() =>
            void run(
              async () => window.location.assign(await connectFacebook()),
              "Facebook could not be connected.",
            )
          }
        >
          {account?.pages.length ? "Reconnect" : "Connect"}
        </button>
        {account?.pages.length ? (
          <button
            type="button"
            className="is-danger"
            disabled={busy}
            onClick={() => void run(() => disconnectFacebook(), "Facebook could not be removed.")}
          >
            Disconnect
          </button>
        ) : null}
      </div>

      {error ? (
        <p className="ig-account__error" role="alert">
          {error}
        </p>
      ) : null}

      {account && account.pages.length > 1 ? (
        <ul className="ig-account__posts">
          {account.pages.map((page) => (
            <li key={page.id}>
              <button
                type="button"
                aria-pressed={account.selected === page.id}
                disabled={busy}
                onClick={() =>
                  void run(
                    () => chooseFacebookPage({ data: { id: page.id } }),
                    "That Page could not be selected.",
                  )
                }
              >
                {page.name}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {account && account.pages.length === 1 && !account.selected ? (
        <p className="ig-account__note">
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void run(
                () => chooseFacebookPage({ data: { id: account.pages[0]!.id } }),
                "That Page could not be selected.",
              )
            }
          >
            Use {account.pages[0]!.name}
          </button>
        </p>
      ) : null}
    </section>
  );
}
