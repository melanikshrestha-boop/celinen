import { expect, test } from "bun:test";
import { healthResponse, versionResponse } from "../src/lib/build-version";
import { readBuildInfo } from "../scripts/build-info";

test("version endpoint returns only the three public fields and disables caching", async () => {
  const info = { git_sha: "a".repeat(40), build_time: "2026-09-14T12:00:00.000Z", app_version: "0.1.0.0", secret: "must-not-escape" };
  const response = versionResponse(info);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({ git_sha: info.git_sha, build_time: info.build_time, app_version: info.app_version });
});

test("missing or malformed build identity never claims a version", async () => {
  const valid = { git_sha: "a".repeat(40), build_time: "2026-09-14T12:00:00.000Z", app_version: "0.1.0.0" };
  for (const info of [undefined, { ...valid, git_sha: "main" }, { ...valid, app_version: "secret" }, { ...valid, build_time: "not-a-date" }]) {
    const response = versionResponse(info);
    expect(response.status).toBe(503);
    expect(await response.text()).toBe("");
  }
});

test("health reports the running build and is never cached", async () => {
  const info = { git_sha: "a".repeat(40), build_time: "2026-09-14T12:00:00.000Z", app_version: "0.1.0.0", secret: "must-not-escape" };
  const response = healthResponse(info);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({ ok: true, git_sha: info.git_sha, build_time: info.build_time });
  const unknown = healthResponse({ ...info, git_sha: "main" });
  expect(unknown.status).toBe(503);
  expect(unknown.headers.get("cache-control")).toBe("no-store");
  expect(await unknown.json()).toEqual({ ok: false });
});

test("build info comes from this Git checkout and contains no environment fields", () => {
  const info = readBuildInfo(new URL("../", import.meta.url).pathname);
  expect(info.git_sha).toMatch(/^[a-f0-9]{40}$/);
  expect(info.app_version).toBe("0.1.0.0");
  expect(Object.keys(info).sort()).toEqual(["app_version", "build_time", "git_sha"]);
  expect(Number.isFinite(Date.parse(info.build_time))).toBe(true);
});
