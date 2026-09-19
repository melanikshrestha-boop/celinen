/** Recorded-shape fakes for the social connector tests, in the style of
 * instagram-fixtures.ts: an in-memory Supabase (rows, filters the scheduler
 * uses, private storage with ranged reads) and a network that answers each
 * provider the way its documentation says it does. Nothing touches the network.
 */
import { createHash } from "node:crypto";

type Row = Record<string, unknown> & { id?: string; owner_id?: string };

const read = (row: Row, key: string): unknown => {
  const [column, ...path] = key.split(/->>?/);
  let value: unknown = row[column!];
  for (const part of path) value = (value as Record<string, unknown> | undefined)?.[part];
  return value;
};
const text = (value: unknown) => (value === null || value === undefined ? null : String(value));

export class FakeSocialDatabase {
  now: () => number = () => Date.now();
  tables = new Map<string, Row[]>();
  objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  removed: string[] = [];
  signedUrls: string[] = [];
  uploadTickets: string[] = [];
  buckets: Record<
    string,
    { public: boolean; file_size_limit: number; allowed_mime_types: string[] }
  > = {
    "publishing-media-v1": {
      public: false,
      file_size_limit: 8388608,
      allowed_mime_types: ["image/jpeg"],
    },
    "publishing-video-v1": {
      public: false,
      file_size_limit: 1073741824,
      allowed_mime_types: ["video/mp4", "video/quicktime"],
    },
  };
  /** Number of times a conditional update claimed a row; lets a test observe lease contention. */
  claims = 0;

  rows(table: string) {
    if (!this.tables.has(table)) this.tables.set(table, []);
    return this.tables.get(table)!;
  }

  from(table: string) {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- builder closures outlive the call
    const db = this;
    const filters: ((row: Row) => boolean)[] = [];
    let mode: "select" | "insert" | "update" | "delete" | "upsert" = "select";
    let payload: Record<string, unknown> | Record<string, unknown>[] | null = null;
    let conflict: string[] = [];
    let head = false;
    let limit = Infinity;
    let order: { key: string; ascending: boolean } | null = null;
    let returning = false;
    const run = () => {
      const rows = db.rows(table);
      if (mode === "insert") {
        const list = Array.isArray(payload) ? payload : [payload];
        for (const item of list) {
          const row = structuredClone(item) as Row;
          if (row.id !== undefined && rows.some((existing) => existing.id === row.id))
            return { data: null, error: { message: "duplicate key" } };
        }
        for (const item of list)
          rows.push({
            revision: 0,
            lease: null,
            lease_until: null,
            created_at: new Date(db.now()).toISOString(),
            ...structuredClone(item),
          } as Row);
        return { data: null, error: null };
      }
      if (mode === "upsert") {
        const row = structuredClone(payload) as Row;
        const keys = conflict.length ? conflict : ["owner_id"];
        const index = rows.findIndex((existing) => keys.every((key) => existing[key] === row[key]));
        if (index >= 0) rows[index] = { ...rows[index]!, ...row } as Row;
        else rows.push({ created_at: new Date(db.now()).toISOString(), ...row } as Row);
        return { data: null, error: null };
      }
      let matched = rows.filter((row) => filters.every((filter) => filter(row)));
      if (order)
        matched = [...matched].sort((a, b) => {
          const x = text(read(a, order!.key)) ?? "",
            y = text(read(b, order!.key)) ?? "";
          return (x < y ? -1 : x > y ? 1 : 0) * (order!.ascending ? 1 : -1);
        });
      matched = matched.slice(0, limit);
      if (mode === "update") {
        if (
          matched.length &&
          "lease" in (payload as Record<string, unknown>) &&
          (payload as Record<string, unknown>)["lease"]
        )
          db.claims++;
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
      insert: (row: Record<string, unknown> | Record<string, unknown>[]) => (
        (mode = "insert"),
        (payload = row),
        builder
      ),
      upsert: (row: Record<string, unknown>, options?: { onConflict?: string }) => {
        mode = "upsert";
        payload = row;
        conflict = options?.onConflict
          ? options.onConflict.split(",").map((key) => key.trim())
          : [];
        return builder;
      },
      update: (patch: Record<string, unknown>) => ((mode = "update"), (payload = patch), builder),
      delete: () => ((mode = "delete"), builder),
      eq: (key: string, value: unknown) => (
        filters.push((row) => text(read(row, key)) === text(value)),
        builder
      ),
      neq: (key: string, value: unknown) => (
        filters.push((row) => text(read(row, key)) !== text(value)),
        builder
      ),
      is: (key: string, value: null) => (
        filters.push((row) => (read(row, key) ?? null) === value),
        builder
      ),
      in: (key: string, values: unknown[]) => (
        filters.push((row) => values.map(text).includes(text(read(row, key)))),
        builder
      ),
      lt: (key: string, value: string) => (
        filters.push((row) => (text(read(row, key)) ?? "") < value),
        builder
      ),
      lte: (key: string, value: string) => (
        filters.push((row) => (text(read(row, key)) ?? "￿") <= value),
        builder
      ),
      gt: (key: string, value: string) => (
        filters.push((row) => (text(read(row, key)) ?? "") > value),
        builder
      ),
      not: (key: string, operator: string, value: unknown) => {
        if (operator !== "is" || value !== null) throw new Error("fixture: only not(is null)");
        filters.push((row) => (read(row, key) ?? null) !== null);
        return builder;
      },
      or: (expression: string) => {
        // Lease claims: `<col>.is.null,<col>_until.lt.<iso>` for lease or refresh_lease.
        const column = expression.startsWith("refresh_lease") ? "refresh_lease" : "lease";
        const until = expression.split(`${column}_until.lt.`)[1]!;
        filters.push((row) => row[column] == null || String(row[`${column}_until`]) < until);
        return builder;
      },
      order: (key: string, options?: { ascending?: boolean }) => (
        (order = { key, ascending: options?.ascending !== false }),
        builder
      ),
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
    getBucket: async (name: string) =>
      this.buckets[name]
        ? { data: this.buckets[name], error: null }
        : { data: null, error: { message: "no bucket" } },
    from: (bucket: string) => ({
      createSignedUploadUrl: async (path: string) => {
        this.uploadTickets.push(`${bucket}/${path}`);
        return {
          data: {
            path,
            token: `upload:${bucket}:${path}`,
            signedUrl: `https://fixture.supabase.co/upload/${path}`,
          },
          error: null,
        };
      },
      upload: async (path: string, bytes: Uint8Array, options?: { contentType?: string }) => {
        const allowed = this.buckets[bucket]?.allowed_mime_types ?? [];
        if (options?.contentType && allowed.length && !allowed.includes(options.contentType))
          return { data: null, error: { message: "mime type not allowed" } };
        this.objects.set(`${bucket}/${path}`, {
          bytes,
          contentType: options?.contentType ?? "application/octet-stream",
        });
        return { data: { path }, error: null };
      },
      download: async (path: string) => {
        const object = this.objects.get(`${bucket}/${path}`);
        return object
          ? {
              data: new Blob([object.bytes as unknown as BlobPart], { type: object.contentType }),
              error: null,
            }
          : { data: null, error: { message: "not found" } };
      },
      info: async (path: string) => {
        const object = this.objects.get(`${bucket}/${path}`);
        return object
          ? {
              data: { size: object.bytes.byteLength, contentType: object.contentType },
              error: null,
            }
          : { data: null, error: { message: "not found" } };
      },
      createSignedUrl: async (path: string, seconds: number) => {
        const url = `https://fixture.supabase.co/storage/v1/object/sign/${bucket}/${path}?token=t&expires=${seconds}`;
        this.signedUrls.push(url);
        return { data: { signedUrl: url }, error: null };
      },
      remove: async (paths: string[]) => {
        for (const path of paths) {
          this.objects.delete(`${bucket}/${path}`);
          this.removed.push(`${bucket}/${path}`);
        }
        return { data: paths.map((name) => ({ name })), error: null };
      },
    }),
  };

  /** What the page's uploadToSignedUrl does. */
  upload(bucket: string, path: string, bytes: Uint8Array, contentType = "image/jpeg") {
    this.objects.set(`${bucket}/${path}`, { bytes, contentType });
  }
  /** Ranged read, as the Worker does against Supabase's storage API. */
  readRange = async (bucket: string, path: string, start: number, end: number) => {
    const object = this.objects.get(`${bucket}/${path}`);
    if (!object) throw new Error("fixture: no object");
    return object.bytes.subarray(start, end + 1);
  };
  objectInfo = async (bucket: string, path: string) => {
    const object = this.objects.get(`${bucket}/${path}`);
    return object ? { size: object.bytes.byteLength, contentType: object.contentType } : null;
  };
}

export type NetCall = {
  method: string;
  url: string;
  path: string;
  headers: Headers;
  body: string;
  form: Record<string, string>;
  json: Record<string, unknown>;
};
type Handler = (call: NetCall) => unknown;

/** Every provider's answers, in the shapes their docs show. Override per test with `on`. */
export class FakeNetwork {
  calls: NetCall[] = [];
  routes: [RegExp, Handler][] = [];
  next = 5000;

  on(method: string, pattern: RegExp, handler: Handler) {
    this.routes.unshift([new RegExp(`^${method} (?:.*?)${pattern.source}`), handler]);
    return this;
  }
  count(method: string, pattern: RegExp) {
    return this.calls.filter((call) => call.method === method && pattern.test(call.url)).length;
  }
  find(method: string, pattern: RegExp) {
    return this.calls.find((call) => call.method === method && pattern.test(call.url)) ?? null;
  }

  fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input instanceof URL ? input.href : input);
    const method = init?.method ?? "GET";
    let body = "";
    let form: Record<string, string> = {};
    let json: Record<string, unknown> = {};
    if (init?.body instanceof URLSearchParams) {
      body = init.body.toString();
      form = Object.fromEntries(init.body);
    } else if (typeof init?.body === "string") {
      body = init.body;
      try {
        json = JSON.parse(body) as Record<string, unknown>;
      } catch {
        json = {};
      }
    } else if (init?.body instanceof FormData) {
      form = Object.fromEntries(
        [...init.body.entries()].map(([key, value]) => [
          key,
          typeof value === "string" ? value : `blob:${value.size}`,
        ]),
      );
    } else if (init?.body) {
      const bytes = init.body as Uint8Array;
      body = `bytes:${bytes.byteLength ?? 0}`;
    }
    const call: NetCall = {
      method,
      url,
      path: new URL(url).pathname,
      headers: new Headers(init?.headers),
      body,
      form,
      json,
    };
    this.calls.push(call);
    for (const [pattern, handler] of this.routes) {
      if (!pattern.test(`${method} ${url}`)) continue;
      const result = handler(call);
      if (result instanceof Response) return result;
      if (result instanceof Error) throw result;
      return Response.json(result);
    }
    return Response.json(
      { error: { message: "fixture: unknown route", code: 100 } },
      { status: 400 },
    );
  }) as typeof fetch;

  constructor() {
    // Threads
    this.on("POST", /graph\.threads\.net\/oauth\/access_token/, () => ({
      access_token: "th-short",
      user_id: "17841400000000099",
    }))
      .on("GET", /graph\.threads\.net\/access_token\?/, () => ({
        access_token: "th-long",
        token_type: "bearer",
        expires_in: 5184000,
      }))
      .on("GET", /graph\.threads\.net\/refresh_access_token/, () => ({
        access_token: "th-long-2",
        expires_in: 5184000,
      }))
      .on("GET", /graph\.threads\.net\/v1\.0\/me\?/, () => ({
        id: "17841400000000099",
        username: "sideline.threads",
      }))
      .on("GET", /graph\.threads\.net\/v1\.0\/\d+\/threads_publishing_limit/, () => ({
        data: [{ quota_usage: 3, config: { quota_total: 250, quota_duration: 86400 } }],
      }))
      .on("POST", /graph\.threads\.net\/v1\.0\/\d+\/threads$/, () => ({ id: String(this.next++) }))
      .on("GET", /graph\.threads\.net\/v1\.0\/\d+\?fields=status/, () => ({ status: "FINISHED" }))
      .on("POST", /graph\.threads\.net\/v1\.0\/\d+\/threads_publish/, () => ({
        id: "18000000000000001",
      }))
      .on("GET", /graph\.threads\.net\/v1\.0\/\d+\?fields=permalink/, () => ({
        permalink: "https://www.threads.net/@sideline.threads/post/FIX",
      }));
    // LinkedIn
    this.on("POST", /linkedin\.com\/oauth\/v2\/accessToken/, (call) =>
      call.form["grant_type"] === "refresh_token"
        ? {
            access_token: "li-token-2",
            expires_in: 5184000,
            refresh_token: "li-refresh-2",
            refresh_token_expires_in: 31536000,
          }
        : {
            access_token: "li-token",
            expires_in: 5184000,
            scope: "openid,profile,w_member_social",
          },
    )
      .on("GET", /api\.linkedin\.com\/v2\/userinfo/, () => ({
        sub: "AbCdEf123",
        name: "Melani S.",
      }))
      .on("POST", /api\.linkedin\.com\/rest\/images\?action=initializeUpload/, () => ({
        value: {
          uploadUrl: "https://www.linkedin.com/dms-uploads/fixture",
          image: `urn:li:image:C${this.next++}`,
        },
      }))
      .on(
        "PUT",
        /linkedin\.com\/dms-uploads/,
        () => new Response(null, { status: 201, headers: { etag: `"e${this.next++}"` } }),
      )
      .on(
        "POST",
        /api\.linkedin\.com\/rest\/posts$/,
        () =>
          new Response(null, {
            status: 201,
            headers: { "x-restli-id": "urn:li:share:7000000000000000001" },
          }),
      );
    // X
    this.on("POST", /api\.x\.com\/2\/oauth2\/token/, (call) =>
      call.form["grant_type"] === "refresh_token"
        ? {
            token_type: "bearer",
            expires_in: 7200,
            access_token: `x-token-${this.next++}`,
            refresh_token: `x-refresh-${this.next++}`,
            scope: "tweet.read tweet.write users.read offline.access media.write",
          }
        : {
            token_type: "bearer",
            expires_in: 7200,
            access_token: "x-token",
            refresh_token: "x-refresh",
            scope: "tweet.read tweet.write users.read offline.access media.write",
          },
    )
      .on("GET", /api\.x\.com\/2\/users\/me/, () => ({
        data: { id: "1234567890", name: "Sideline", username: "sideline" },
      }))
      .on("POST", /api\.x\.com\/2\/media\/upload\/initialize/, () => ({
        data: { id: String(this.next++), media_key: "3_1", expires_after_secs: 86400 },
      }))
      .on(
        "POST",
        /api\.x\.com\/2\/media\/upload\/\d+\/append/,
        () => new Response(null, { status: 204 }),
      )
      .on("POST", /api\.x\.com\/2\/media\/upload\/\d+\/finalize/, () => ({
        data: { id: "1", media_key: "3_1" },
      }))
      .on("POST", /api\.x\.com\/2\/tweets$/, () =>
        Response.json(
          { data: { id: "1700000000000000001", text: "x" } },
          {
            status: 201,
            headers: {
              "x-user-limit-24hour-limit": "17",
              "x-user-limit-24hour-remaining": "16",
              "x-user-limit-24hour-reset": String(Math.floor(Date.now() / 1000) + 86400),
            },
          },
        ),
      );
    // TikTok
    this.on("POST", /open\.tiktokapis\.com\/v2\/oauth\/token/, (call) =>
      call.form["grant_type"] === "refresh_token"
        ? {
            access_token: "tt-token-2",
            expires_in: 86400,
            open_id: "open-id-1",
            refresh_expires_in: 31536000,
            refresh_token: "tt-refresh-2",
            scope: "user.info.basic,video.publish,video.upload",
            token_type: "Bearer",
          }
        : {
            access_token: "tt-token",
            expires_in: 86400,
            open_id: "open-id-1",
            refresh_expires_in: 31536000,
            refresh_token: "tt-refresh",
            scope: "user.info.basic,video.publish,video.upload",
            token_type: "Bearer",
          },
    )
      .on("GET", /open\.tiktokapis\.com\/v2\/user\/info/, () => ({
        data: { user: { open_id: "open-id-1", display_name: "Sideline" } },
        error: { code: "ok", message: "" },
      }))
      .on("POST", /open\.tiktokapis\.com\/v2\/post\/publish\/creator_info\/query/, () => ({
        data: {
          creator_nickname: "Sideline",
          privacy_level_options: ["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "SELF_ONLY"],
          comment_disabled: false,
          duet_disabled: false,
          stitch_disabled: false,
          max_video_post_duration_sec: 600,
        },
        error: { code: "ok", message: "" },
      }))
      .on("POST", /open\.tiktokapis\.com\/v2\/post\/publish\/video\/init/, () => ({
        data: {
          publish_id: "v_pub_url~v2.123",
          upload_url: "https://open-upload.tiktokapis.com/video/?upload_id=1",
        },
        error: { code: "ok", message: "" },
      }))
      .on("POST", /open\.tiktokapis\.com\/v2\/post\/publish\/content\/init/, () => ({
        data: { publish_id: "p_pub_url~v2.456" },
        error: { code: "ok", message: "" },
      }))
      .on("PUT", /open-upload\.tiktokapis\.com\/video/, (call) => {
        // 206 while chunks remain, 201 when the last byte lands.
        const range = /bytes (\d+)-(\d+)\/(\d+)/.exec(call.headers.get("content-range") ?? "");
        const done = range && Number(range[2]) + 1 === Number(range[3]);
        return new Response(null, { status: done ? 201 : 206 });
      })
      // Raw text on purpose: the post id is a 64-bit integer that JSON.stringify would round.
      .on(
        "POST",
        /open\.tiktokapis\.com\/v2\/post\/publish\/status\/fetch/,
        () =>
          new Response(
            '{"data":{"status":"PUBLISH_COMPLETE","publicaly_available_post_id":[7300000000000000001]},"error":{"code":"ok","message":""}}',
            { headers: { "content-type": "application/json" } },
          ),
      );
    // YouTube / Google
    this.on("POST", /oauth2\.googleapis\.com\/token/, (call) =>
      call.form["grant_type"] === "refresh_token"
        ? {
            access_token: "yt-token-2",
            expires_in: 3599,
            scope:
              "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly",
            token_type: "Bearer",
          }
        : {
            access_token: "yt-token",
            expires_in: 3599,
            refresh_token: "yt-refresh",
            scope:
              "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly",
            token_type: "Bearer",
          },
    )
      .on("GET", /youtube\/v3\/channels/, () => ({
        items: [{ id: "UCfixture000000000000001", snippet: { title: "Sideline Studio" } }],
      }))
      .on(
        "POST",
        /upload\/youtube\/v3\/videos\?uploadType=resumable/,
        () =>
          new Response(null, {
            status: 200,
            headers: {
              location:
                "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=fixture",
            },
          }),
      )
      .on("PUT", /upload\/youtube\/v3\/videos\?uploadType=resumable&upload_id=fixture/, (call) => {
        const range = /bytes (\d+)-(\d+)\/(\d+)/.exec(call.headers.get("content-range") ?? "");
        if (!range) return new Response(null, { status: 308, headers: { range: "bytes=0-0" } });
        const [, , end, total] = range;
        if (call.headers.get("content-length") === "0") return new Response(null, { status: 308 });
        return Number(end) + 1 >= Number(total)
          ? Response.json({ id: "dQw4w9WgXcQ" })
          : new Response(null, { status: 308, headers: { range: `bytes=0-${end}` } });
      });
    // Facebook Page
    this.on("POST", /graph\.facebook\.com\/v\d+\.0\/\d+\/photos/, (call) => ({
      id: String(this.next++),
      ...(call.form["published"] === "true" ? { post_id: "100000000000001_200000000000001" } : {}),
    }))
      .on("POST", /graph\.facebook\.com\/v\d+\.0\/\d+\/feed/, () => ({
        id: "100000000000001_200000000000002",
      }))
      .on("POST", /graph\.facebook\.com\/v\d+\.0\/\d+\/photo_stories/, () => ({
        success: true,
        post_id: "100000000000001_300000000000001",
      }))
      .on("POST", /graph-video\.facebook\.com\/v\d+\.0\/\d+\/videos/, () => ({
        id: "400000000000001",
      }));
    // Instagram
    this.on("GET", /graph\.instagram\.com\/v\d+\.0\/\d+\/content_publishing_limit/, () => ({
      data: [{ quota_usage: 1, config: { quota_total: 100, quota_duration: 86400 } }],
    }))
      .on("POST", /graph\.instagram\.com\/v\d+\.0\/\d+\/media$/, () => ({
        id: String(this.next++),
      }))
      .on("GET", /graph\.instagram\.com\/v\d+\.0\/\d+\?fields=status_code/, () => ({
        status_code: "FINISHED",
      }))
      .on("POST", /graph\.instagram\.com\/v\d+\.0\/\d+\/media_publish/, () => ({
        id: "17900000000000001",
      }))
      .on("GET", /graph\.instagram\.com\/v\d+\.0\/\d+\?fields=permalink/, () => ({
        permalink: "https://www.instagram.com/p/FIXTURE/",
      }));
  }
}

export const metaError = (status: number, code: number, subcode?: number) =>
  Response.json(
    {
      error: {
        message: "upstream detail",
        type: "OAuthException",
        code,
        ...(subcode ? { error_subcode: subcode } : {}),
      },
    },
    { status },
  );

/** A minimal but real MP4: ftyp, a tiny mdat, then moov with mvhd (duration) and one video trak (tkhd size). */
export function fixtureMp4(
  options: {
    durationMs?: number;
    width?: number;
    height?: number;
    mdatBytes?: number;
    moovFirst?: boolean;
  } = {},
) {
  const {
    durationMs = 5000,
    width = 1080,
    height = 1920,
    mdatBytes = 64,
    moovFirst = false,
  } = options;
  const box = (type: string, ...parts: Uint8Array[]) => {
    const size = 8 + parts.reduce((sum, part) => sum + part.byteLength, 0);
    const out = new Uint8Array(size);
    new DataView(out.buffer).setUint32(0, size);
    out.set(new TextEncoder().encode(type), 4);
    let at = 8;
    for (const part of parts) {
      out.set(part, at);
      at += part.byteLength;
    }
    return out;
  };
  const u32 = (...values: number[]) => {
    const out = new Uint8Array(values.length * 4);
    values.forEach((value, index) => new DataView(out.buffer).setUint32(index * 4, value >>> 0));
    return out;
  };
  const timescale = 1000;
  const mvhd = box("mvhd", u32(0, 0, 0, timescale, durationMs), new Uint8Array(80));
  // tkhd v0: version/flags, creation, modification, track_id, reserved, duration, reserved(8), layer/alt, volume/res, matrix(36), width, height
  const matrix = u32(0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000);
  const tkhd = box(
    "tkhd",
    u32(0x00000007, 0, 0, 1, 0, durationMs, 0, 0, 0, 0),
    matrix,
    u32(width << 16, height << 16),
  );
  const trak = box("trak", tkhd);
  const moov = box("moov", mvhd, trak);
  const ftyp = box(
    "ftyp",
    new TextEncoder().encode("isom"),
    u32(0x200),
    new TextEncoder().encode("isomiso2mp41"),
  );
  const mdat = box("mdat", new Uint8Array(mdatBytes).fill(0xab));
  const parts = moovFirst ? [ftyp, moov, mdat] : [ftyp, mdat, moov];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.byteLength;
  }
  return out;
}

export const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
