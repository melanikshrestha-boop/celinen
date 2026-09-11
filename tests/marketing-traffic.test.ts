import { expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { consentCookie, consentFromCookie } from "../src/lib/marketing-consent";
import { recordMarketingVisit } from "../src/lib/marketing-traffic";
import { handleTrafficPost } from "../src/routes/api/public/traffic";

test("consent cookie round-trips and ignores other cookies", () => {
  expect(consentFromCookie(null)).toBeNull();
  expect(consentFromCookie("theme=dark")).toBeNull();
  expect(consentFromCookie(consentCookie("accepted"))).toBe("accepted");
  expect(consentFromCookie(`a=1; ${consentCookie("rejected")}`)).toBe("rejected");
});

test("visits are recorded only after Accept", async () => {
  const dir = await mkdtemp(join(tmpdir(), "foto-traffic-"));
  process.env["FOTO_TRAFFIC_LOG"] = join(dir, "events.jsonl");
  const rejected = await recordMarketingVisit({
    cookie: consentCookie("rejected"),
    path: "/pricing",
    referrer: "https://example.com",
  });
  expect(rejected).toEqual({ recorded: false });
  const missing = await recordMarketingVisit({ cookie: null, path: "/pricing" });
  expect(missing).toEqual({ recorded: false });
  const accepted = await recordMarketingVisit({
    cookie: consentCookie("accepted"),
    path: "/pricing",
    referrer: "https://foto.test/",
  });
  expect(accepted).toEqual({ recorded: true });
  const log = await readFile(process.env["FOTO_TRAFFIC_LOG"], "utf8");
  expect(log).toContain('"/pricing"');
  expect(log).toContain("https://foto.test/");
  expect(log.split("\n").filter(Boolean)).toHaveLength(1);
});

test("traffic POST handler refuses rejected cookies", async () => {
  const dir = await mkdtemp(join(tmpdir(), "foto-traffic-"));
  process.env["FOTO_TRAFFIC_LOG"] = join(dir, "events.jsonl");
  const deny = await handleTrafficPost(
    new Request("http://foto.test/api/public/traffic", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: consentCookie("rejected") },
      body: JSON.stringify({ path: "/pricing" }),
    }),
  );
  expect((await deny.json()).recorded).toBe(false);
  const allow = await handleTrafficPost(
    new Request("http://foto.test/api/public/traffic", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: consentCookie("accepted") },
      body: JSON.stringify({ path: "/" }),
    }),
  );
  expect((await allow.json()).recorded).toBe(true);
});
