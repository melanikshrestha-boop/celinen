import { expect, test } from "bun:test";
import { buildSocialPost, clipCaption, composeAction, isPostIntent } from "../src/lib/social-post";
import { destinationPathFor } from "../src/lib/workspace-routing";

test("drafts a caption without claiming a live post", () => {
  const post = buildSocialPost({ idea: "Game day keepers", tone: "Professional", length: "Medium" });
  expect(post.caption).toContain("Game day keepers");
  expect(post.hashtags.join(" ")).toContain("#gameday");
  const x = composeAction("x", post.caption);
  expect(x.href).toContain("twitter.com/intent/tweet");
  expect(x.copy).toBe(true);
  expect(clipCaption("a".repeat(400), "x").length).toBeLessThanOrEqual(280);
});

test("instagram opens the app with the caption copied", () => {
  const action = composeAction("instagram", "Gallery tonight.");
  expect(action.href).toContain("instagram.com");
  expect(action.copy).toBe(true);
});

test("post intent goes to Social, send gallery still goes to Galleries", () => {
  expect(isPostIntent("What should we post about the sideline set")).toBe(true);
  expect(destinationPathFor("post this to instagram")).toBe("/publish");
  expect(destinationPathFor("send these video clips to the client")).toBe("/deliver");
});
