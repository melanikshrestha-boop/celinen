import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  LIGHTROOM_REQUEST_BYTES,
  LightroomRequestError,
  readLightroomPayload,
} from "../src/lib/lightroom-request";

const request = (body: string) =>
  new Request("https://example.invalid/bridge", { method: "POST", body });

describe("bounded Lightroom bridge requests", () => {
  test("normal metadata survives without normalization or changing filenames", async () => {
    const body = {
      workspace: "qa-workspace",
      direction: "to-studio",
      kind: "push",
      frames: [{ file: "Café 📷.ARW", path: "/Photos/Card/Café 📷.ARW", rating: 5, pick: -1 }],
    };
    expect(await readLightroomPayload(request(JSON.stringify(body)))).toEqual(body);
  });

  test("valid 5,000-frame batches fit the budget without truncation", async () => {
    const frames = Array.from({ length: 5000 }, (_, i) => ({
      file: "IMG.ARW",
      path: `/Photos/Card ${i}/IMG.ARW`,
      rating: i % 6,
      pick: -1,
    }));
    expect((await readLightroomPayload(request(JSON.stringify({ frames })))).frames).toEqual(
      frames,
    );
  });

  test("invalid envelopes are rejected before workspace lookup or writes", async () => {
    for (const body of [
      "",
      "null",
      "[]",
      "1",
      "{",
      '{"workspace":42}',
      '{"workspace":null}',
      '{"kind":{}}',
      '{"direction":"typo"}',
    ])
      await expect(readLightroomPayload(request(body))).rejects.toBeInstanceOf(
        LightroomRequestError,
      );
  });

  test("oversized declared bodies are refused without reading them", async () => {
    const req = request("{}");
    req.headers.set("content-length", String(LIGHTROOM_REQUEST_BYTES + 1));
    await expect(readLightroomPayload(req)).rejects.toMatchObject({ status: 413 });
    expect(req.bodyUsed).toBe(false);
  });

  test("streaming budget cannot be bypassed by missing or false content length", async () => {
    for (const declared of [null, "1", "not-a-number"]) {
      let cancelled = false;
      let reads = 0;
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          reads++;
          controller.enqueue(new Uint8Array(1024 * 1024).fill(32));
        },
        cancel() {
          cancelled = true;
        },
      });
      const req = new Request("https://example.invalid/bridge", { method: "POST", body: stream });
      if (declared) req.headers.set("content-length", declared);
      await expect(readLightroomPayload(req)).rejects.toMatchObject({ status: 413 });
      expect(cancelled).toBe(true);
      expect(reads).toBeLessThanOrEqual(10);
      expect(req.body!.locked).toBe(false);
    }
  });

  test("split UTF-8 characters preserve source identity; invalid UTF-8 is not replaced", async () => {
    const bytes = new TextEncoder().encode('{"frames":[{"file":"Café 📷.ARW"}]}');
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
        controller.close();
      },
    });
    const result = await readLightroomPayload(
      new Request("https://example.invalid/bridge", { method: "POST", body: stream }),
    );
    expect(result.frames).toEqual([{ file: "Café 📷.ARW" }]);
    await expect(
      readLightroomPayload(
        new Request("https://example.invalid/bridge", {
          method: "POST",
          body: new Uint8Array([0xff]),
        }),
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  test("endpoint retains token authorization and protocol gate after bounded parsing", () => {
    const source = readFileSync(
      new URL("../src/routes/api/public/lightroom.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain("await readLightroomPayload(request)");
    expect(source).not.toContain("await request.json()");
    expect(source).toContain('if (!workspace) return json({ error: "unauthorized" }, 401)');
    expect(source).toContain('url.searchParams.get("matching") !== LIGHTROOM_MATCHING');
  });
});
