import { z } from "zod";

export const socialFrameSchema = z
  .object({
    format: z.enum(["portrait", "square", "story"]),
    mode: z.enum(["fit", "fill"]),
    x: z.number().finite().min(0).max(1),
    y: z.number().finite().min(0).max(1),
    zoom: z.number().finite().min(1).max(3),
    background: z.enum(["black", "white"]),
  })
  .strict()
  .refine((frame) => frame.mode !== "fit" || frame.zoom === 1, "Fit uses no zoom.");
export type SocialFrame = z.infer<typeof socialFrameSchema>;
export const SOCIAL_FORMATS = {
  portrait: { width: 1080, height: 1350, label: "Instagram post · 4:5" },
  square: { width: 1080, height: 1080, label: "Square post · 1:1" },
  story: { width: 1080, height: 1920, label: "Instagram / Facebook Story · 9:16" },
} as const;
export const DEFAULT_SOCIAL_FRAME: SocialFrame = {
  format: "story",
  mode: "fit",
  x: 0.5,
  y: 0.5,
  zoom: 1,
  background: "black",
};

/** Transport only. Cropping, resampling, compositing and JPEG encoding run in C++. */
export async function prepareSocialFrame(
  source: Blob,
  input: SocialFrame,
  signal?: AbortSignal,
): Promise<Blob> {
  const recipe = socialFrameSchema.parse(input);
  if (!source.size || source.size > 16 * 1024 * 1024)
    throw new Error("Choose a prepared photo under 16 MB.");
  const status = await fetch("/__native/status", {
    headers: { "X-Celinen-Request": "studio" },
    signal: signal ?? null,
  });
  if (!status.ok || !status.headers.get("content-type")?.includes("application/json"))
    throw new Error("The C++ social operator is not available on this host yet.");
  const engine = await status.json();
  if (!engine.socialReady || typeof engine.token !== "string")
    throw new Error("The C++ social operator needs to be built on this host.");
  const response = await fetch("/__native/social-frame", {
    method: "POST",
    signal: signal ?? null,
    body: source,
    headers: {
      "Content-Type": "application/octet-stream",
      "X-Celinen-Request": "studio",
      "X-Celinen-Token": engine.token,
      "X-Celinen-Frame": JSON.stringify(recipe),
    },
  });
  if (!response.ok) {
    const failure = await response.json().catch(() => null);
    throw new Error(
      typeof failure?.error === "string" ? failure.error : "Social preparation failed. Try again.",
    );
  }
  if (
    (response.headers.get("X-Celinen-Engine") ?? response.headers.get("X-LensLabs-Engine")) !== "cpp" ||
    !response.headers.get("content-type")?.includes("image/jpeg")
  )
    throw new Error("The social operator returned an invalid image.");
  const blob = await response.blob();
  if (!blob.size || blob.size > 8 * 1024 * 1024)
    throw new Error("The prepared image exceeds the social upload limit.");
  return blob;
}
