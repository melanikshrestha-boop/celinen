import { profileMetadata } from "@/lib/account-profile";
if (location.hostname !== "127.0.0.1" || location.port !== "8083")
  throw new Error("Isolated QA origin only");
const key = "lenslabs.account-qa.user";
const initial = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  email: "vincent.long.photographer@example.test",
  email_confirmed_at: "2026-09-01T00:00:00Z",
  app_metadata: { provider: "google" },
  user_metadata: { full_name: "Vincent van Gogh" },
};
let user = JSON.parse(localStorage.getItem(key) ?? JSON.stringify(initial));
let event: ((event: string, session: unknown) => void) | null = null;
const session = () => (user ? { user, access_token: "synthetic-fixture-token" } : null);
export const qa = {
  failNext: false,
  saves: 0,
  delay: 0,
  verifyDelay: 0,
  refresh() {
    event?.("TOKEN_REFRESHED", session());
  },
  paths: [] as string[],
  errors: [] as string[],
  swap() {
    user = {
      ...initial,
      id: crypto.randomUUID(),
      user_metadata: { full_name: "Second QA account" },
    };
    event?.("SIGNED_IN", session());
  },
  reset() {
    localStorage.removeItem(key);
    location.reload();
  },
};
Object.assign(window, { __accountQA: qa });
window.addEventListener("error", (event) => qa.errors.push(event.message));
window.addEventListener("unhandledrejection", (event) => qa.errors.push(String(event.reason)));
export const supabase = {
  auth: {
    getUser: async () => {
      const snapshot = structuredClone(user);
      if (qa.verifyDelay) await new Promise((resolve) => setTimeout(resolve, qa.verifyDelay));
      return { data: { user: snapshot }, error: null };
    },
    getSession: async () => ({ data: { session: session() }, error: null }),
    onAuthStateChange: (receive: typeof event) => {
      event = receive;
      return {
        data: {
          subscription: {
            unsubscribe() {
              event = null;
            },
          },
        },
      };
    },
    signOut: async () => {
      user = null;
      localStorage.setItem(key, "null");
      event?.("SIGNED_OUT", null);
      return { error: null };
    },
  },
};
export async function saveAccountProfile({
  data,
}: {
  data: { expectedOwner: string; name: string; workspaceName: string };
}) {
  qa.saves++;
  await new Promise((resolve) => setTimeout(resolve, qa.delay));
  if (qa.failNext) {
    qa.failNext = false;
    throw new Error("Test connection failed. Retry your save.");
  }
  if (data.expectedOwner !== user?.id)
    throw new Error("Your account changed. Reopen settings before saving.");
  const metadata = profileMetadata({ name: data.name, workspaceName: data.workspaceName });
  user = { ...user, user_metadata: { ...user.user_metadata, ...metadata } };
  localStorage.setItem(key, JSON.stringify(user));
  return metadata;
}
export const webSearchReadiness = async () => ({ configured: false });
