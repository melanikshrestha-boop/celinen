import { createServerFn } from "@tanstack/react-start";
import { postPasteNetwork } from "./social-paste-post";

export const postPasteNetworkFn = createServerFn({ method: "POST" })
  .inputValidator((data: { secret: unknown; caption: string }) => {
    if (!data || typeof data.caption !== "string") throw new Error("Write a caption first.");
    if (data.caption.length > 4_000) throw new Error("Caption is too long.");
    return { secret: data.secret, caption: data.caption };
  })
  .handler(async ({ data }) => postPasteNetwork(data));
