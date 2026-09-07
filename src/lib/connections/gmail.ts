export const GMAIL_READONLY = "https://www.googleapis.com/auth/gmail.readonly";
export type GmailStatus = {
  state: "disconnected" | "connecting" | "connected";
  email: string | null;
  note: string;
};
export type MailMessage = {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  date: string;
  snippet: string;
  text?: string;
};
export type GmailTokenResponse = {
  access_token?: string;
  expires_in?: number | string;
  scope?: string;
  error?: string;
};
const messageId = (value: string) => /^[A-Za-z0-9_-]{1,200}$/.test(value);
type Part = {
  mimeType?: string;
  filename?: string;
  body?: { data?: string };
  headers?: { name: string; value: string }[];
  parts?: Part[];
};
type RawMail = { id?: string; threadId?: string; snippet?: string; payload?: Part };

export function plainMail(raw: RawMail, includeText = false): MailMessage {
  if (!raw || typeof raw.id !== "string" || !messageId(raw.id))
    throw new Error("Gmail returned an invalid message reference.");
  const headers = Array.isArray(raw.payload?.headers) ? raw.payload.headers : [];
  const header = (name: string) => {
    const value = headers.find(
      (entry) => typeof entry?.name === "string" && entry.name.toLowerCase() === name,
    )?.value;
    return typeof value === "string" ? value.slice(0, 1000) : "";
  };
  const result: MailMessage = {
    id: raw.id,
    threadId: typeof raw.threadId === "string" && messageId(raw.threadId) ? raw.threadId : raw.id,
    subject: header("subject") || "(No subject)",
    from: header("from"),
    date: header("date"),
    snippet: typeof raw.snippet === "string" ? raw.snippet.slice(0, 1000) : "",
  };
  if (includeText) {
    let visited = 0;
    const texts: string[] = [];
    const visit = (part: Part | undefined, depth: number) => {
      if (!part || typeof part !== "object" || depth > 10 || ++visited > 200 || part.filename)
        return;
      if (
        part.mimeType === "text/plain" &&
        typeof part.body?.data === "string" &&
        part.body.data.length <= 250_000
      ) {
        try {
          const binary = atob(part.body.data.replace(/-/g, "+").replace(/_/g, "/"));
          texts.push(
            new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0))),
          );
        } catch {
          /* Invalid or non-text content is not rendered. */
        }
      }
      for (const child of Array.isArray(part.parts) ? part.parts : []) visit(child, depth + 1);
    };
    visit(raw.payload, 0);
    result.text =
      texts.join("\n\n").slice(0, 100_000) ||
      "This message has no readable plain-text body. Open the original in Gmail to view its formatting.";
  }
  return result;
}

/** Short-lived credentials live only in this account-owned instance, never browser storage. */
export class GmailSession {
  #credential: { token: string; expiresAt: number } | null = null;
  #generation = 0;
  #requests = new Set<AbortController>();
  status: GmailStatus = { state: "disconnected", email: null, note: "" };
  constructor(
    private readonly changed: (status: GmailStatus) => void,
    private readonly request: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}
  get generation() {
    return this.#generation;
  }
  #set(status: GmailStatus) {
    this.status = status;
    this.changed(status);
  }
  clear(note = "") {
    this.#generation++;
    this.#credential = null;
    for (const controller of this.#requests) controller.abort();
    this.#requests.clear();
    this.#set({ state: "disconnected", email: null, note });
  }
  begin() {
    this.clear();
    this.#set({
      state: "connecting",
      email: null,
      note: "Choose your Gmail account in Google's window.",
    });
    return this.#generation;
  }
  fail(generation: number, note: string) {
    if (generation === this.#generation) this.clear(note);
  }
  async authorize(response: unknown, generation: number) {
    if (generation !== this.#generation) return;
    try {
      const grant =
        response && typeof response === "object"
          ? (response as Partial<Record<keyof GmailTokenResponse, unknown>>)
          : {};
      const seconds =
        typeof grant.expires_in === "number" || typeof grant.expires_in === "string"
          ? Number(grant.expires_in)
          : NaN;
      if (
        grant.error ||
        typeof grant.access_token !== "string" ||
        !grant.access_token ||
        grant.access_token.length > 16_384 ||
        typeof grant.scope !== "string" ||
        !grant.scope.split(/\s+/).includes(GMAIL_READONLY) ||
        !Number.isFinite(seconds) ||
        seconds <= 30
      ) {
        this.fail(generation, "Gmail read permission was not granted. Nothing was connected.");
        return;
      }
      this.#credential = {
        token: grant.access_token,
        expiresAt: this.now() + Math.min(seconds, 86_400) * 1000,
      };
      const profile = (await this.#get(
        "profile",
        new URLSearchParams({ fields: "emailAddress" }),
      )) as { emailAddress?: string };
      if (generation !== this.#generation) return;
      if (
        !profile ||
        typeof profile.emailAddress !== "string" ||
        !/^[^\s@]+@[^\s@]+$/.test(profile.emailAddress) ||
        profile.emailAddress.length > 320
      )
        throw new Error("Gmail could not confirm the connected mailbox.");
      this.#set({
        state: "connected",
        email: profile.emailAddress,
        note: "Read-only · connected for this session",
      });
    } catch (error) {
      this.fail(generation, error instanceof Error ? error.message : "Gmail could not connect.");
    }
  }
  async #get(path: string, query: URLSearchParams, signal?: AbortSignal): Promise<unknown> {
    const credential = this.#credential,
      generation = this.#generation;
    if (!credential || credential.expiresAt - this.now() < 30_000) {
      this.clear("Gmail access expired. Reconnect to continue.");
      throw new Error("Reconnect Gmail to continue.");
    }
    const controller = new AbortController();
    this.#requests.add(controller);
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) controller.abort();
    const timeout = setTimeout(abort, 15_000);
    try {
      const response = await this.request(
        `https://gmail.googleapis.com/gmail/v1/users/me/${path}?${query}`,
        {
          method: "GET",
          headers: { Authorization: `Bearer ${credential.token}` },
          cache: "no-store",
          credentials: "omit",
          redirect: "error",
          signal: controller.signal,
        },
      );
      if (generation !== this.#generation || controller.signal.aborted)
        throw new Error("Gmail request cancelled.");
      if (response.status === 401) {
        this.clear("Gmail access expired or was revoked. Reconnect to continue.");
        throw new Error("Reconnect Gmail to continue.");
      }
      if (!response.ok)
        throw new Error(
          response.status === 429
            ? "Gmail is busy. Try again shortly."
            : "Gmail could not read this request. Check the connection and try again.",
        );
      const reader = response.body?.getReader();
      if (!reader) throw new Error("Gmail returned an empty response.");
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 2_000_000) {
          await reader.cancel();
          throw new Error("This message is too large to preview. Open it in Gmail.");
        }
        chunks.push(value);
      }
      if (generation !== this.#generation || controller.signal.aborted)
        throw new Error("Gmail request cancelled.");
      const body = new Uint8Array(bytes);
      let offset = 0;
      for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return JSON.parse(new TextDecoder().decode(body));
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      this.#requests.delete(controller);
    }
  }
  async search(query: string, pageToken = "", signal?: AbortSignal) {
    if (query.length > 500 || pageToken.length > 2000)
      throw new Error("Use a shorter Gmail search.");
    const params = new URLSearchParams({
      q: query,
      maxResults: "15",
      fields: "messages(id),nextPageToken",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const generation = this.#generation;
    const data = (await this.#get("messages", params, signal)) as {
      messages?: { id?: string }[];
      nextPageToken?: string;
    };
    const ids = Array.isArray(data.messages)
      ? data.messages
          .slice(0, 15)
          .map((row) => row?.id)
          .filter((id): id is string => typeof id === "string" && messageId(id))
      : [];
    const messages: MailMessage[] = [];
    // Three metadata reads at a time, never an unbounded mailbox import.
    for (let index = 0; index < ids.length; index += 3)
      messages.push(
        ...(await Promise.all(
          ids.slice(index, index + 3).map(async (id) =>
            plainMail(
              (await this.#get(
                `messages/${id}`,
                new URLSearchParams({
                  format: "metadata",
                  fields: "id,threadId,snippet,payload/headers",
                }),
                signal,
              )) as RawMail,
            ),
          ),
        )),
      );
    if (generation !== this.#generation) throw new Error("Gmail account changed.");
    return {
      messages,
      nextPageToken:
        typeof data.nextPageToken === "string" && data.nextPageToken.length <= 2000
          ? data.nextPageToken
          : "",
    };
  }
  async read(id: string, signal?: AbortSignal) {
    if (!messageId(id)) throw new Error("Invalid Gmail message reference.");
    return plainMail(
      (await this.#get(
        `messages/${id}`,
        new URLSearchParams({ format: "full", fields: "id,threadId,snippet,payload" }),
        signal,
      )) as RawMail,
      true,
    );
  }
  async revoke(revoke: (token: string, done: (result: { successful?: boolean }) => void) => void) {
    const token = this.#credential?.token;
    this.clear("Disconnected on this device.");
    if (!token) return false;
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 10_000);
      try {
        revoke(token, (result) => {
          clearTimeout(timer);
          resolve(result?.successful === true);
        });
      } catch {
        clearTimeout(timer);
        resolve(false);
      }
    });
  }
}
