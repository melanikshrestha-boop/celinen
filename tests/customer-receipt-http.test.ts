import { describe, expect, test } from "bun:test";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { connect } from "node:net";
import { resolve } from "node:path";
import { nativeReceiptPlugin } from "../src/server/native-receipt";
import { encodeCustomerReceipt, type CustomerReceipt } from "../src/lib/receipts/protocol";

describe.skipIf(!existsSync(resolve("native/build/lenslabs-receipt")))(
  "actual local receipt bridge",
  () => {
    test("authorizes local requests, bounds payloads and releases the single lane after an abandoned upload", async () => {
      type Handler = (req: IncomingMessage, res: ServerResponse, next: () => void) => Promise<void>;
      let handler: Handler;
      const server = createServer(
        (req, res) =>
          void handler(req, res, () => {
            res.statusCode = 404;
            res.end();
          }),
      );
      (nativeReceiptPlugin().configureServer as (server: unknown) => void)({
        httpServer: server,
        middlewares: {
          use(value: Handler) {
            handler = value;
          },
        },
      });
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("No test address.");
      const origin = `http://127.0.0.1:${address.port}`;
      const packet = Buffer.from(
        encodeCustomerReceipt({
          receiptId: "QA-Receipt-1",
          issuedOn: "2026-09-08",
          paidOn: "2026-09-08",
          studioName: "FOTO Test",
          customerName: "Synthetic Customer",
          shootName: "Synthetic Shoot",
          description: "Synthetic receipt bridge test",
          amountMinor: 12345,
          currency: "USD",
          exponent: 2,
          sourceLabel: "Manually recorded",
        }),
      );
      try {
        expect((await fetch(`${origin}/outside-receipts`)).status).toBe(404);
        expect((await fetch(`${origin}/__receipt/status`)).status).toBe(403);
        const status = await fetch(`${origin}/__receipt/status`, {
          headers: { "x-lenslabs-request": "studio" },
        });
        expect(status.headers.get("cache-control")).toBe("no-store");
        expect(status.headers.get("x-content-type-options")).toBe("nosniff");
        const capability = (await status.json()) as {
          ready: boolean;
          token: string;
          engine: string;
        };
        expect(capability.ready).toBe(true);
        expect(capability.token).toMatch(/^[a-f0-9]{64}$/);
        expect(capability.engine).toBe("cpp-receipt-1");
        const headers = {
          origin,
          "x-lenslabs-request": "studio",
          "x-lenslabs-token": capability.token,
          "content-type": "application/x-foto-receipt",
        };
        for (const patch of [
          { origin: "https://evil.example" },
          { origin: "" },
          { host: `evil.example:${address.port}` },
          { "x-lenslabs-token": "b".repeat(64) },
          { "x-lenslabs-request": "" },
          { "sec-fetch-site": "cross-site" },
        ])
          expect(
            (
              await fetch(`${origin}/__receipt/render`, {
                method: "POST",
                headers: { ...headers, ...patch },
                body: packet,
              })
            ).status,
          ).toBe(403);
        expect(
          (
            await fetch(`${origin}/__receipt/render`, {
              headers: { "x-lenslabs-request": "studio" },
            })
          ).status,
        ).toBe(405);
        expect(
          (
            await fetch(`${origin}/__receipt/render`, {
              method: "POST",
              headers: { ...headers, "content-type": "text/plain" },
              body: packet,
            })
          ).status,
        ).toBe(415);
        expect(
          (
            await fetch(`${origin}/__receipt/render`, {
              method: "POST",
              headers,
              body: Buffer.alloc(8193),
            })
          ).status,
        ).toBe(413);
        const bad = await fetch(`${origin}/__receipt/render`, {
          method: "POST",
          headers,
          body: Buffer.from("Synthetic Customer"),
        });
        expect(bad.status).toBe(400);
        expect(await bad.text()).not.toContain("Synthetic Customer");
        const pending = connect(address.port, "127.0.0.1");
        pending.on("error", () => {});
        try {
          await once(pending, "connect");
          pending.write(
            [
              "POST /__receipt/render HTTP/1.1",
              `Host: 127.0.0.1:${address.port}`,
              ...Object.entries(headers).map(([key, value]) => `${key}: ${value}`),
              `Content-Length: ${packet.length}`,
              "Connection: close",
              "",
              "",
            ].join("\r\n"),
          );
          pending.write(packet.subarray(0, 20));
          await new Promise((done) => setTimeout(done, 10));
          const busy = await fetch(`${origin}/__receipt/render`, {
            method: "POST",
            headers,
            body: packet,
          });
          expect(busy.status).toBe(429);
          await busy.arrayBuffer();
        } finally {
          pending.destroy();
        }
        let response: Response | undefined;
        for (let i = 0; i < 20; i++) {
          response = await fetch(`${origin}/__receipt/render`, {
            method: "POST",
            headers,
            body: packet,
          });
          if (response.status !== 429) break;
          await response.arrayBuffer();
          await new Promise((done) => setTimeout(done, 5));
        }
        expect(response?.status).toBe(200);
        expect(response?.headers.get("cache-control")).toBe("no-store");
        expect(response?.headers.get("cross-origin-resource-policy")).toBe("same-origin");
        const result = (await response!.json()) as CustomerReceipt;
        expect(result.text).toContain("Amount paid: USD 123.45");
        expect(result.html).toContain("Synthetic Customer");
        expect(Object.keys(result).sort()).toEqual(["html", "text"]);
      } finally {
        server.closeAllConnections();
        await new Promise<void>((done) => server.close(() => done()));
      }
    });
  },
);
