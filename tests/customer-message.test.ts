import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { customerEmail, customerEmailDraft } from "../src/lib/customer-message";

describe("Customer email recipient identity", () => {
  test("literal percent sequences cannot become recipient delimiters or headers", () => {
    for (const email of [
      "client%2Cother@example.com",
      "client%0D%0ABcc%3Aother@example.com",
      "client%40else@example.com",
      "client%25tag@example.com",
      "client+gallery@example.com",
      "o'brien@example.com",
      "client?draft&value#tag=1@example.com",
      "client@xn--bcher-kva.example",
    ]) {
      const href = customerEmailDraft(email, "Receipt & Gallery", "Private\nMessage");
      const address = href.slice("mailto:".length, href.indexOf("?"));
      expect(decodeURIComponent(address)).toBe(email);
      expect(href.split("?")).toHaveLength(2);
      expect(new URLSearchParams(href.split("?")[1]).get("subject")).toBe("Receipt & Gallery");
      expect(new URLSearchParams(href.split("?")[1]).get("body")).toBe("Private\nMessage");
    }
  });
  test("requires one unquoted email address and rejects ambiguous domains and hidden controls", () => {
    expect(customerEmail("  client+session@example.com  ")).toBe("client+session@example.com");
    for (const email of [
      "client@other@example.com",
      "client@@example.com",
      "client@example.com,other@example.com",
      "Client <client@example.com>",
      '"client"@example.com',
      "client@example..com",
      "client@-example.com",
      "client@example-.com",
      "client@example.com/path",
      "client@example.com:443",
      "client@example%2ecom",
      "client\u0000@example.com",
      "client\u007f@example.com",
      "client\u202e@example.com",
      ".client@example.com",
      "client.@example.com",
      "client..other@example.com",
      `${"x".repeat(65)}@example.com`,
    ])
      expect(() => customerEmailDraft(email, "Receipt", "Paid")).toThrow();
  });
});

test("actual MessageComposer guards deferred SMS handoffs against recipient and message changes", async () => {
  const child = Bun.spawn(
    [
      process.execPath,
      fileURLToPath(new URL("./customer-message-lifecycle.fixture.ts", import.meta.url)),
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [output, errors, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect(errors).toBe("");
  expect(code).toBe(0);
  expect(JSON.parse(output)).toEqual({ passed: 8 });
});
