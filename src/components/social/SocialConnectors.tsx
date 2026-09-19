/** Threads, LinkedIn, X, TikTok and YouTube inside Social accounts: one row
 * each with the account name and Connect, Reconnect or Disconnect. A provider
 * whose Worker secrets are absent says exactly which names are missing instead
 * of showing a button that cannot work. Also owns the `?connector=<provider>`
 * half of the `/publish` callback for these five.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Link2 } from "lucide-react";
import {
  disconnectSocialConnector,
  finishSocialConnector,
  socialConnectors,
  startSocialConnector,
} from "@/lib/business/social-connectors.functions";
import { isSocialProvider, type SocialProvider } from "@/lib/social/connectors";
import "./instagram.css";

type Connector = Awaited<ReturnType<typeof socialConnectors>>[number];
/** Instagram and Facebook keep their own cards above this list. */
const LISTED: SocialProvider[] = ["threads", "linkedin", "x", "tiktok", "youtube"];
const message = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

export function SocialConnectors({ onChange }: { onChange?: (rows: Connector[]) => void }) {
  const [rows, setRows] = useState<Connector[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<SocialProvider | null>(null);
  const callback = useRef(false);

  const refresh = useCallback(async () => {
    const next = await socialConnectors();
    setRows(next);
    onChange?.(next);
    return next;
  }, [onChange]);

  useEffect(() => {
    let live = true;
    const query = new URLSearchParams(window.location.search);
    const connector = query.get("connector");
    const code = query.get("code"),
      state = query.get("state");
    const ours =
      !callback.current &&
      isSocialProvider(connector) &&
      LISTED.includes(connector) &&
      (code || query.has("error"));
    const start = async () => {
      if (ours) {
        callback.current = true;
        // The code is single-use; keep it out of history and referrers.
        window.history.replaceState(null, "", window.location.pathname);
        if (!code || !state)
          throw new Error("The connection was cancelled. Nothing was connected.");
        await finishSocialConnector({ data: { provider: connector, code, state } });
      }
      if (live) await refresh();
    };
    start().catch(
      (reason) => live && setError(message(reason, "Connections are unavailable right now.")),
    );
    return () => {
      live = false;
    };
  }, [refresh]);

  async function run(provider: SocialProvider, work: () => Promise<unknown>, fallback: string) {
    setBusy(provider);
    setError(null);
    try {
      await work();
    } catch (reason) {
      setError(message(reason, fallback));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="ig-account" aria-label="More networks">
      {rows
        .filter((row) => LISTED.includes(row.provider))
        .map((row) => (
          <div key={row.provider} className="ig-account__head">
            <Link2 size={18} aria-hidden="true" />
            <h2>{row.connection ? `${row.label} · ${row.connection.accountName}` : row.label}</h2>
            <span className="ig-account__spacer" />
            {row.configured ? (
              <>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() =>
                    void run(
                      row.provider,
                      async () =>
                        window.location.assign(
                          await startSocialConnector({ data: { provider: row.provider } }),
                        ),
                      `${row.label} could not be connected.`,
                    )
                  }
                >
                  {row.connection ? "Reconnect" : "Connect"}
                </button>
                {row.connection ? (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() =>
                      void run(
                        row.provider,
                        async () => {
                          await disconnectSocialConnector({ data: { provider: row.provider } });
                          await refresh();
                        },
                        `Could not disconnect ${row.label}.`,
                      )
                    }
                  >
                    Disconnect
                  </button>
                ) : null}
              </>
            ) : (
              <span className="ig-account__note">Missing {row.missing.join(", ")}</span>
            )}
            {row.connection?.state === "reconnect" ? (
              <span className="ig-account__note">{row.connection.reason}</span>
            ) : null}
          </div>
        ))}
      {error ? (
        <p role="alert" className="ig-account__error">
          {error}
        </p>
      ) : null}
    </section>
  );
}
