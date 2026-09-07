import { normalizeWebResults } from "./research";
import { createClient } from "@supabase/supabase-js";

type SearchAdmission = {
  take: (owner: string, lease: string) => Promise<boolean>;
  release: (lease: string) => Promise<void>;
};
function searchAdmission(): SearchAdmission {
  const url = process.env["SUPABASE_URL"],
    key = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!url || !key) throw new Error("Web search request protection is not configured.");
  const db = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(5000) }),
    },
  });
  return {
    async take(owner, lease) {
      const { data, error } = await db.rpc("workspace_take_search", {
        owner_id: owner,
        lease_id: lease,
      });
      if (error)
        throw new Error(
          "Web search protection is unavailable. Apply the workspace search migration and retry.",
        );
      return data === true;
    },
    async release(lease) {
      await db.rpc("workspace_release_search", { lease_id: lease });
    },
  };
}
/** Failed admission never reaches the paid provider. Attempts, including failures, consume budget. */
export async function admittedWebSearch(
  owner: string,
  query: string,
  key: string,
  admission: SearchAdmission = searchAdmission(),
  request: typeof fetch = fetch,
) {
  const lease = crypto.randomUUID();
  if (!(await admission.take(owner, lease)))
    throw new Error(
      "Web search reached its usage limit or is busy. Try later, or open the search in your browser.",
    );
  try {
    return await performWebSearch(query, key, request);
  } finally {
    try {
      await admission.release(lease);
    } catch {
      /* The durable lease expires; never bypass admission on cleanup failure. */
    }
  }
}

export async function performWebSearch(query: string, key: string, request: typeof fetch = fetch) {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", "10");
  url.searchParams.set("safesearch", "moderate");
  const response = await request(url, {
    headers: { "X-Subscription-Token": key, Accept: "application/json" },
    signal: AbortSignal.timeout(12000),
    redirect: "error",
  });
  if (!response.ok)
    throw new Error(
      response.status === 429
        ? "Web search is busy. Wait a moment and retry."
        : "The search provider could not complete this request.",
    );
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Search returned an empty response.");
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > 1_000_000) {
      await reader.cancel();
      throw new Error("Search returned too much data. Try a narrower query.");
    }
    chunks.push(value);
  }
  const body = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return {
    query,
    results: normalizeWebResults(JSON.parse(new TextDecoder().decode(body))),
    searchedAt: new Date().toISOString(),
  };
}
