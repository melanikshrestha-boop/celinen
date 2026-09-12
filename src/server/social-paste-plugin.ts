/** Local paste-post bridge. Loopback only. Secrets are not written to disk. */
import type { IncomingMessage } from "node:http";
import type { Plugin } from "vite";
import { postPasteNetwork } from "../lib/social-paste-post";
import { NativeBridgeError } from "./native-studio-plugin";

const MAX_INPUT = 8_192;

function isLoopback(address?: string | null) {
  return address === "127.0.0.1" || address === "::1" || address === ":ffff:127.0.0.1";
}

function readBody(req: IncomingMessage, signal: AbortSignal) {
  return new Promise<Buffer>((done, fail) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_INPUT) fail(new NativeBridgeError(413, "Post is too large."));
      else chunks.push(chunk);
    });
    req.once("end", () => done(Buffer.concat(chunks)));
    req.once("error", fail);
    signal.addEventListener(
      "abort",
      () => fail(new NativeBridgeError(499, "Post cancelled.")),
      { once: true },
    );
  });
}

export function socialPastePlugin(): Plugin {
  return {
    name: "celinen-local-social-paste",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const path = req.url?.split("?")[0];
        if (path !== "/__social/post") return next();
        const controller = new AbortController();
        req.once("aborted", () => controller.abort());
        res.once("close", () => controller.abort());
        res.setHeader("Cache-Control", "no-store");
        try {
          if (!isLoopback(req.socket.remoteAddress)) throw new NativeBridgeError(403, "Local access only.");
          if (req.method !== "POST") throw new NativeBridgeError(405, "POST required.");
          const packet = JSON.parse((await readBody(req, controller.signal)).toString("utf8")) as {
            secret?: unknown;
            caption?: string;
          };
          const result = await postPasteNetwork({
            secret: packet.secret,
            caption: String(packet.caption ?? ""),
          });
          res.statusCode = result.ok ? 200 : 422;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify(result));
        } catch (error) {
          res.statusCode = error instanceof NativeBridgeError ? error.status : 500;
          res.setHeader("content-type", "application/json");
          res.end(
            JSON.stringify({
              ok: false,
              error: error instanceof Error ? error.message : "Post failed.",
            }),
          );
        }
      });
    },
  };
}
