import { definePlugin } from "nitro";

/** Nitro owns the Worker `scheduled` export. This hook is what actually fires due posts. */
export default definePlugin((nitroApp) => {
  nitroApp.hooks.hook("cloudflare:scheduled", () =>
    import("../lib/business/schedule.server").then((mod) => mod.tickDuePosts()),
  );
});
