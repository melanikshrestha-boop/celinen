import { expect, test } from "bun:test";
import { normalizeBlogComment, validateBlogComment } from "../src/lib/blog-comments";

test("blog notes reject empty or marked-up bodies", () => {
  expect(
    validateBlogComment({ slug: "sports-photographer-genie", name: "Mel", stance: "like", body: "no" }),
  ).toBeTruthy();
  expect(
    validateBlogComment({
      slug: "sports-photographer-genie",
      name: "Mel",
      stance: "improve",
      body: "Need jersey OCR before face models.",
    }),
  ).toBeNull();
  expect(
    validateBlogComment({
      slug: "x",
      name: "Mel",
      stance: "like",
      body: "<script>alert(1)</script> more text",
    }),
  ).toBeTruthy();
});

test("anonymous notes still get a photographer name", () => {
  const comment = normalizeBlogComment(
    {
      slug: "sports-photographer-genie",
      name: "  ",
      stance: "dislike",
      body: "Peak-action detection is the only thing I would pay for this year.",
    },
    "c-test",
    0,
  );
  expect(comment.name).toBe("Photographer");
  expect(comment.likes).toBe(0);
});
