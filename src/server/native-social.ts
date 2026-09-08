import { spawn } from "node:child_process";
import { socialFrameSchema, type SocialFrame } from "../lib/social-frame";

export function socialArguments(source: string, input: SocialFrame) {
  const value = socialFrameSchema.parse(input);
  return [
    source,
    value.format,
    value.mode,
    String(value.x),
    String(value.y),
    String(value.zoom),
    value.background,
  ];
}
export function runNativeSocial(
  binary: string,
  source: string,
  input: SocialFrame,
  signal: AbortSignal,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error("Social preparation cancelled."));
    const child = spawn(binary, socialArguments(source, input), {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks: Buffer[] = [];
    let bytes = 0,
      settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      if (error) {
        child.kill("SIGKILL");
        reject(error);
      } else resolve(Buffer.concat(chunks));
    };
    const abort = () => finish(new Error("Social preparation cancelled."));
    const timer = setTimeout(() => finish(new Error("C++ social preparation timed out.")), 30000);
    signal.addEventListener("abort", abort, { once: true });
    child.stderr.on("data", () => {});
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 8 * 1024 * 1024) finish(new Error("Social image exceeds 8 MB."));
      else chunks.push(chunk);
    });
    child.once("error", () => finish(new Error("C++ social operator could not start.")));
    child.once("close", (code) =>
      finish(
        code === 0 && bytes > 3 && chunks[0]?.[0] === 255 && chunks[0]?.[1] === 216
          ? undefined
          : new Error("C++ social operator rejected the image."),
      ),
    );
  });
}
