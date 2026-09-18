/** Recorded-shape fakes for Instagram publishing tests: an in-memory Supabase
 * (rows + private storage) and a Graph API that answers like Meta's documented
 * responses. Nothing here touches the network.
 */
type Row = Record<string, unknown> & { id: string; owner_id: string };

const read = (row: Row, key: string): unknown => {
  const [column, ...path] = key.split(/->>?/);
  let value: unknown = row[column!];
  for (const part of path) value = (value as Record<string, unknown> | undefined)?.[part];
  return value;
};

export class FakeDatabase {
  /** The clock rows are stamped with. Tests that move a fake clock set this, so
   * a row's age is measured on the same clock the code under test reads. */
  now: () => number = () => Date.now();
  tables = new Map<string, Row[]>();
  objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  removed: string[] = [];
  signedUrls: string[] = [];
  bucket = { public: false, file_size_limit: 8388608, allowed_mime_types: ["image/jpeg"] };

  rows(table: string) {
    if (!this.tables.has(table)) this.tables.set(table, []);
    return this.tables.get(table)!;
  }

  from(table: string) {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- builder closures outlive the call
    const db = this;
    const filters: ((row: Row) => boolean)[] = [];
    let mode: "select" | "insert" | "update" | "delete" = "select";
    let payload: Record<string, unknown> | null = null;
    let head = false;
    let limit = Infinity;
    let returning = false;
    const run = () => {
      const rows = db.rows(table);
      if (mode === "insert") {
        const row = structuredClone(payload) as Row;
        if (rows.some((existing) => existing.id === row.id && row.id !== undefined))
          return { data: null, error: { message: "duplicate key" } };
        rows.push({
          revision: 0,
          lease: null,
          lease_until: null,
          created_at: new Date(db.now()).toISOString(),
          ...row,
        });
        return { data: null, error: null };
      }
      const matched = rows.filter((row) => filters.every((filter) => filter(row))).slice(0, limit);
      if (mode === "update") {
        for (const row of matched) Object.assign(row, structuredClone(payload));
        return { data: returning ? structuredClone(matched) : null, error: null };
      }
      if (mode === "delete") {
        db.tables.set(
          table,
          rows.filter((row) => !matched.includes(row)),
        );
        return { data: structuredClone(matched), error: null };
      }
      return head
        ? { data: null, count: matched.length, error: null }
        : { data: structuredClone(matched), error: null };
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a chainable query double
    const builder: any = {
      select: (_columns?: string, options?: { head?: boolean }) => {
        if (mode !== "select") returning = true;
        head = !!options?.head;
        return builder;
      },
      insert: (row: Record<string, unknown>) => {
        mode = "insert";
        payload = row;
        return builder;
      },
      upsert: (row: Record<string, unknown>) => {
        const rows = db.rows(table);
        const index = rows.findIndex((existing) => existing.owner_id === row["owner_id"]);
        if (index >= 0) rows[index] = { ...rows[index]!, ...structuredClone(row) } as Row;
        else rows.push(structuredClone(row) as Row);
        return Promise.resolve({ error: null });
      },
      update: (patch: Record<string, unknown>) => {
        mode = "update";
        payload = patch;
        return builder;
      },
      delete: () => {
        mode = "delete";
        return builder;
      },
      eq: (key: string, value: unknown) => (
        filters.push((row) => read(row, key) === value),
        builder
      ),
      is: (key: string, value: null) => (
        filters.push((row) => (read(row, key) ?? null) === value),
        builder
      ),
      lt: (key: string, value: string) => (
        filters.push((row) => String(read(row, key)) < value),
        builder
      ),
      gt: (key: string, value: string) => (
        filters.push((row) => String(read(row, key)) > value),
        builder
      ),
      or: (expression: string) => {
        // Only the lease claim expression is used: lease.is.null,lease_until.lt.<iso>
        const until = expression.split("lease_until.lt.")[1]!;
        filters.push((row) => row["lease"] == null || String(row["lease_until"]) < until);
        return builder;
      },
      order: () => builder,
      limit: (value: number) => ((limit = value), builder),
      maybeSingle: async () => {
        const result = run();
        const data = Array.isArray(result.data) ? (result.data[0] ?? null) : result.data;
        return { ...result, data };
      },
      then: (resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) =>
        Promise.resolve(run()).then(resolve, reject),
    };
    return builder;
  }

  storage = {
    getBucket: async () => ({ data: this.bucket, error: null }),
    from: (bucket: string) => ({
      createSignedUploadUrl: async (path: string) => ({
        data: {
          path,
          token: `upload:${bucket}:${path}`,
          signedUrl: `https://fixture.supabase.co/upload/${path}`,
        },
        error: null,
      }),
      download: async (path: string) => {
        const object = this.objects.get(path);
        return object
          ? { data: new Blob([object.bytes], { type: object.contentType }), error: null }
          : { data: null, error: { message: "not found" } };
      },
      createSignedUrl: async (path: string, seconds: number) => {
        const url = `https://fixture.supabase.co/storage/v1/object/sign/${bucket}/${path}?token=t&expires=${seconds}`;
        this.signedUrls.push(url);
        return { data: { signedUrl: url }, error: null };
      },
      remove: async (paths: string[]) => {
        for (const path of paths) {
          this.objects.delete(path);
          this.removed.push(path);
        }
        return { data: paths.map((name) => ({ name })), error: null };
      },
    }),
  };

  /** What the page's uploadToSignedUrl does. */
  upload(path: string, bytes: Uint8Array) {
    this.objects.set(path, { bytes, contentType: "image/jpeg" });
  }
}

export type GraphCall = {
  method: string;
  path: string;
  body: Record<string, string>;
  auth: string | null;
};
type Handler = (call: GraphCall) => unknown;

/** Graph API responses in the shapes Meta documents. Override any route per test. */
export class FakeGraph {
  calls: GraphCall[] = [];
  statuses = new Map<string, string[]>();
  routes: [RegExp, Handler][] = [];
  next = 1000;
  quota = { used: 3, total: 100 };

  on(method: string, pattern: RegExp, handler: Handler) {
    this.routes.unshift([new RegExp(`^${method} (?:.*?)${pattern.source}`), handler]);
    return this;
  }
  count(method: string, pattern: RegExp) {
    return this.calls.filter((call) => pattern.test(call.path) && call.method === method).length;
  }
  /** Successive status_code answers for a container; the last repeats. */
  status(id: string, ...codes: string[]) {
    this.statuses.set(id, codes);
  }

  constructor() {
    this.on("GET", /\d+\/content_publishing_limit/, () => ({
      data: [
        {
          quota_usage: this.quota.used,
          config: { quota_total: this.quota.total, quota_duration: 86400 },
        },
      ],
    }))
      .on("POST", /\d+\/media$/, () => ({ id: String(this.next++) }))
      .on("POST", /\d+\/media_publish$/, () => ({ id: "17900000000000001" }))
      .on("GET", /\d+\?fields=status_code$/, (call) => {
        const id = call.path.split("?")[0]!;
        const queue = this.statuses.get(id);
        if (!queue) return { status_code: "FINISHED", id };
        return { status_code: queue.length > 1 ? queue.shift() : queue[0], id };
      })
      .on("GET", /\d+\?fields=permalink$/, () => ({
        permalink: "https://www.instagram.com/p/FIXTURE/",
      }));
  }

  fetch = (async (input: unknown, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const path =
      url.hostname === "graph.instagram.com" && /^\/v\d+\.0\//.test(url.pathname)
        ? url.pathname.replace(/^\/v\d+\.0\//, "").replace(/^\//, "") + url.search
        : url.href;
    const body = Object.fromEntries(
      new URLSearchParams(init?.body instanceof URLSearchParams ? init.body : ""),
    );
    const call = {
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

export const graphError = (status: number, code: number, subcode?: number) =>
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
