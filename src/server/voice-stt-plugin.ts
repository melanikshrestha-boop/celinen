/** Local Grok STT bridge. Loopback only. XAI_API_KEY is never written to disk. */
import type { IncomingMessage } from "node:http";
import type { Plugin } from "vite";
import { grokTranscribeWav } from "../lib/voice/grok-stt";
import { NativeBridgeError } from "./native-studio-plugin";

const MAX_INPUT = 2_000_000;

function isLoopback(address?: string | null) {
  return address === "127.0.0.1" || address === "::1" || address === ":ffff:127.0.0.1";
}

function readBody(req: IncomingMessage, signal: AbortSignal) {
  return new Promise<Buffer>((done, fail) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_INPUT) fail(new NativeBridgeError(413, "Audio too large."));
      else chunks.push(chunk);
    });
    req.once("end", () => done(Buffer.concat(chunks)));
    req.once("error", fail);
    signal.addEventListener("abort", () => fail(new NativeBridgeError(499, "Cancelled.")), {
      once: true,
    });
  });
}

export function voiceSttPlugin(): Plugin {
  return {
    name: "celinen-local-voice-stt",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const path = req.url?.split("?")[0];
        if (path !== "/__voice/stt") return next();
        const controller = new AbortController();
        req.once("aborted", () => controller.abort());
        res.once("close", () => controller.abort());
        res.setHeader("Cache-Control", "no-store");
        try {
          if (!isLoopback(req.socket.remoteAddress)) throw new NativeBridgeError(403, "Local access only.");
          if (req.method !== "POST") throw new NativeBridgeError(405, "POST required.");
          const wav = await readBody(req, controller.signal);
          const text = await grokTranscribeWav(new Uint8Array(wav));
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ text }));
        } catch (error) {
          const status = error instanceof NativeBridgeError ? error.status : 500;
          const message = error instanceof Error ? error.message : "Transcription failed";
          res.statusCode = status;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: message }));
        }
      });
    },
  };
}
