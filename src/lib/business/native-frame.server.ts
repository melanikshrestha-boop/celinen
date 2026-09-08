import { mkdtemp, open, unlink, rmdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { runNativeSocial } from "../../server/native-social";
import type { SocialFrame } from "../social-frame";
let occupied = false;
/** Authenticated server adapter; the image operator itself is C++. No remote source URLs. */
export async function nativePublicationFrame(source: Blob, frame: SocialFrame) {
  if (process.platform !== "darwin")
    throw new Error(
      "This host does not have the C++ social operator. Use local Studio preparation until the native service is deployed.",
    );
  if (occupied) throw new Error("Social preparation is busy. Retry shortly.");
  if (!source.size || source.size > 8 * 1024 * 1024)
    throw new Error("Invalid prepared source size.");
  occupied = true;
  let directory: string | undefined, path: string | undefined;
  try {
    directory = await mkdtemp(join(tmpdir(), "lenslabs-publication-frame-"));
    path = join(directory, "source");
    const file = await open(path, "wx", 0o600);
    try {
      await file.writeFile(new Uint8Array(await source.arrayBuffer()));
    } finally {
      await file.close();
    }
    const result = await runNativeSocial(
      resolve("native/build/lenslabs-social"),
      path,
      frame,
      AbortSignal.timeout(30000),
    );
    return new Blob([new Uint8Array(result)], { type: "image/jpeg" });
  } finally {
    if (path) await unlink(path).catch(() => {});
    if (directory) await rmdir(directory).catch(() => {});
    occupied = false;
  }
}
