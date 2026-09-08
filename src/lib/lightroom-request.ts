/** Bound untrusted bridge payloads before parsing or contacting account storage. */
export const LIGHTROOM_REQUEST_BYTES = 8 * 1024 * 1024;

export class LightroomRequestError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 413 = 400,
  ) {
    super(message);
  }
}

export async function readLightroomPayload(request: Request) {
  const declared = request.headers.get("content-length");
  if (declared !== null && /^\d+$/.test(declared) && Number(declared) > LIGHTROOM_REQUEST_BYTES)
    throw new LightroomRequestError(
      "Lightroom batch exceeds 8 MiB. Send a smaller selection.",
      413,
    );
  if (!request.body) throw new LightroomRequestError("invalid json");
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > LIGHTROOM_REQUEST_BYTES)
        throw new LightroomRequestError(
          "Lightroom batch exceeds 8 MiB. Send a smaller selection.",
          413,
        );
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    const body: unknown = JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new LightroomRequestError("invalid payload");
    const payload = body as Record<string, unknown>;
    const { workspace, kind, direction } = payload;
    if (
      (workspace !== undefined && (typeof workspace !== "string" || workspace.length > 128)) ||
      (kind !== undefined && (typeof kind !== "string" || kind.length > 64)) ||
      (direction !== undefined && direction !== "to-studio" && direction !== "to-lightroom")
    )
      throw new LightroomRequestError("invalid bridge metadata");
    return payload as {
      workspace?: string;
      kind?: string;
      direction?: "to-studio" | "to-lightroom";
      frames?: unknown;
    };
  } catch (error) {
    await reader.cancel().catch(() => {});
    if (error instanceof LightroomRequestError) throw error;
    throw new LightroomRequestError("invalid json");
  } finally {
    reader.releaseLock();
  }
}
