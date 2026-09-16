import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import {
  GMAIL_READONLY,
  GmailSession,
  type GmailStatus,
  type GmailTokenResponse,
} from "@/lib/connections/gmail";

type GoogleOAuth = {
  initTokenClient: (config: {
    client_id: string;
    scope: string;
    include_granted_scopes: boolean;
    callback: (response: GmailTokenResponse) => void;
    error_callback: (error: { type?: string }) => void;
  }) => { requestAccessToken: (options: { prompt: string }) => void };
  revoke: (token: string, done: (result: { successful?: boolean }) => void) => void;
};
const googleOAuth = () =>
  (window as Window & { google?: { accounts?: { oauth2?: GoogleOAuth } } }).google?.accounts
    ?.oauth2;
const GmailContext = createContext<{
  session: GmailSession;
  status: GmailStatus;
  configured: boolean;
  ready: boolean;
  connect: () => void;
  disconnect: () => Promise<void>;
} | null>(null);
// This hook and provider deliberately share the same account-owned context.
// eslint-disable-next-line react-refresh/only-export-components
export const useGmail = () => {
  const context = useContext(GmailContext);
  if (!context) throw new Error("Gmail must be opened inside the workspace.");
  return context;
};

export function GmailConnection({ children }: { children: ReactNode }) {
  const clientId = import.meta.env["VITE_GOOGLE_GMAIL_CLIENT_ID"] as string | undefined;
  const configured = Boolean(clientId?.endsWith(".apps.googleusercontent.com"));
  const [status, setStatus] = useState<GmailStatus>({
    state: "disconnected",
    email: null,
    note: "",
  });
  const alive = useRef(true);
  const [session] = useState(
    () =>
      new GmailSession((next) => {
        if (alive.current) setStatus(next);
      }),
  );
  const [ready, setReady] = useState(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      session.clear();
    };
  }, [session]);
  useEffect(() => {
    if (!configured) return;
    if (googleOAuth()) {
      setReady(true);
      return;
    }
    let script = document.querySelector<HTMLScriptElement>(
      'script[src="https://accounts.google.com/gsi/client"]',
    );
    const owned = !script;
    script ??= document.createElement("script");
    const failed = () => {
      clearTimeout(timer);
      setStatus({
        state: "disconnected",
        email: null,
        note: "Google's connection window could not load. Reload this page to retry.",
      });
    };
    const loaded = () => {
      clearTimeout(timer);
      if (googleOAuth()) setReady(true);
      else failed();
    };
    const timer = setTimeout(failed, 15_000);
    script.addEventListener("load", loaded);
    script.addEventListener("error", failed);
    if (owned) {
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      document.head.append(script);
    }
    return () => {
      clearTimeout(timer);
      script.removeEventListener("load", loaded);
      script.removeEventListener("error", failed);
    };
  }, [configured]);
  const connect = () => {
    const oauth = googleOAuth();
    if (!clientId || !ready || !oauth) return;
    const generation = session.begin();
    try {
      const client = oauth.initTokenClient({
        client_id: clientId,
        scope: GMAIL_READONLY,
        include_granted_scopes: false,
        callback: (response) => {
          if (alive.current) void session.authorize(response, generation);
        },
        error_callback: (error) =>
          session.fail(
            generation,
            error?.type === "popup_closed"
              ? "Connection cancelled. No mailbox was connected."
              : "Google's window could not open. Allow popups, then try again.",
          ),
      });
      client.requestAccessToken({ prompt: "consent select_account" });
    } catch {
      session.fail(generation, "Google's connection window could not open. Try again.");
    }
  };
  const disconnect = async () => {
    const oauth = googleOAuth();
    if (!oauth) {
      session.clear(
        "Disconnected locally. Manage remaining Google access in your Google account settings.",
      );
      return;
    }
    const generation = session.generation + 1;
    const removed = await session.revoke(oauth.revoke.bind(oauth));
    if (alive.current && session.generation === generation)
      setStatus({
        state: "disconnected",
        email: null,
        note: removed
          ? "Gmail access revoked."
          : "Disconnected locally. Google could not confirm revocation; remove Celinen access in your Google account settings.",
      });
  };
  return (
    <GmailContext.Provider value={{ session, status, configured, ready, connect, disconnect }}>
      {children}
    </GmailContext.Provider>
  );
}
