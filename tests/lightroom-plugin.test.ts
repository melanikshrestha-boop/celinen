import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { pluginFiles } from "../src/lib/lightroom-plugin";

const files = pluginFiles(
  "https://example.invalid/api/lightroom",
  "qa-workspace",
  "qa-not-a-real-token",
);
const source = (name: string) => files.find((item) => item.path.endsWith(`/${name}.lua`))!.text;
const lua = process.env["LENSLABS_TEST_LUA"];
const literal = (text: string) => `[====[${text}]====]`;
function execute(code: string): string {
  const result = spawnSync(lua!, ["-"], { input: code, encoding: "utf8", timeout: 15_000 });
  if (result.status !== 0) throw new Error(result.stderr || String(result.error));
  return result.stdout.trim();
}
function pull(
  frames: unknown[],
  photos: { file: string; path: string }[],
  kind = "verdicts-relative-path-v1",
) {
  return JSON.parse(
    execute(`
package.preload['JSON'] = assert(loadstring(${literal(source("JSON"))}))
package.preload['CelinenMatch'] = assert(loadstring(${literal(source("CelinenMatch"))}))
local JSON = require 'JSON'
local state = JSON:decode(${literal(JSON.stringify({ kind, frames }))})
local data = JSON:decode(${literal(JSON.stringify(photos))})
local writes, saved, inLock = 0, 0, false
local messages, result, catalogPhotos = {}, {}, {}
for index, item in ipairs(data) do
  local changes = { file = item.file, path = item.path }
  result[index] = changes
  local photo = {}
  function photo:getFormattedMetadata(key) if key == 'fileName' then return item.file end end
  function photo:getRawMetadata(key) if key == 'path' then return item.path end end
  function photo:setRawMetadata(key, value) assert(inLock) writes = writes + 1 changes[key] = value end
  function photo:setPropertyForPlugin(plugin, key, value) assert(inLock) writes = writes + 1 changes[key] = value end
  function photo:saveMetadata() assert(inLock) saved = saved + 1 end
  catalogPhotos[index] = photo
end
local catalog = {}
function catalog:getAllPhotos() return catalogPhotos end
function catalog:withWriteAccessDo(name, fn) inLock = true fn() inLock = false end
function import(name)
  if name == 'LrApplication' then return { activeCatalog = function() return catalog end } end
  if name == 'LrTasks' then return { startAsyncTask = function(fn) fn() end } end
  if name == 'LrDialogs' then return { message = function(title, text) messages[#messages + 1] = text end, showBezel = function(text) messages[#messages + 1] = text end } end
  error('Unexpected import ' .. name)
end
package.preload['CelinenBridge'] = function() return { get = function() return state end, writeSidecar = function(photo) photo:saveMetadata() end } end
assert(loadstring(${literal(source("CelinenPull"))}))()
print(JSON:encode({ writes = writes, saved = saved, photos = result, messages = messages }))
`),
  ) as { writes: number; saved: number; photos: Record<string, unknown>[]; messages: string[] };
}

test("generated plug-in includes matching module and explicit upgraded protocol", () => {
  expect(source("Info")).toContain("minor = 3");
  expect(source("CelinenBridge")).toContain("matching=relative-path-v1");
  expect(source("CelinenPull")).toContain("Matching.plan(state.frames, catalog:getAllPhotos())");
  expect(source("CelinenPull")).not.toContain("byName[name]");
});

// Portable suite runs without installing a runtime; CI/manual release verification
// supplies LENSLABS_TEST_LUA for actual Lua 5.1 execution, never a real catalog.
describe.skipIf(!lua)("generated Lua against a simulated Lightroom catalog", () => {
  test("every generated Lua module parses", () => {
    for (const file of files.filter((item) => item.path.endsWith(".lua")))
      expect(execute(`assert(loadstring(${literal(file.text)})); print('ok')`)).toBe("ok");
  });
  test("same filenames on different cards update only their matching paths", () => {
    const result = pull(
      [
        { file: "IMG.ARW", relativePath: "Card A/IMG.ARW", verdict: "reject", rating: 5 },
        { file: "IMG.ARW", relativePath: "Card B/IMG.ARW", verdict: "keep", rating: 2 },
      ],
      [
        { file: "IMG.ARW", path: "/Photos/Card B/IMG.ARW" },
        { file: "IMG.ARW", path: "/Photos/Card A/IMG.ARW" },
        { file: "IMG.ARW", path: "/Photos/Card C/IMG.ARW" },
      ],
    );
    expect(result.saved).toBe(2);
    expect(result.photos[0]).toMatchObject({ pickStatus: 1, rating: 2 });
    expect(result.photos[1]).toMatchObject({ pickStatus: -1, rating: 5 });
    expect(result.photos[2]).not.toHaveProperty("pickStatus");
  });
  test("extensions, exact Unicode and Windows separators are preserved", () => {
    const result = pull(
      [
        {
          file: "IMG.ARW",
          relativePath: "Café/IMG.ARW",
          verdict: "keep",
          label: 'Print & "album"',
        },
      ],
      [
        { file: "IMG.JPG", path: "C:\\Photos\\Café\\IMG.JPG" },
        { file: "IMG.ARW", path: "C:\\Photos\\Café\\IMG.ARW" },
      ],
    );
    expect(result.saved).toBe(1);
    expect(result.photos[0]).not.toHaveProperty("pickStatus");
    expect(result.photos[1]).toMatchObject({ pickStatus: 1, label: 'Print & "album"' });
  });
  test("clearing a pick actually clears it in the catalog", () => {
    const result = pull(
      [{ file: "IMG.ARW", relativePath: "Card/IMG.ARW", verdict: "undecided", rating: 0 }],
      [{ file: "IMG.ARW", path: "/Photos/Card/IMG.ARW" }],
    );
    expect(result.photos[0]).toMatchObject({ pickStatus: 0, rating: 0 });
  });
  test("duplicates, virtual copies and missing paths prevent every write, including earlier safe targets", () => {
    const safe = { file: "SAFE.ARW", relativePath: "Card/SAFE.ARW", verdict: "keep" };
    const target = { file: "IMG.ARW", relativePath: "Card/IMG.ARW", verdict: "reject" };
    const safePhoto = { file: "SAFE.ARW", path: "/Photos/Card/SAFE.ARW" };
    const targetPhoto = { file: "IMG.ARW", path: "/Photos/Card/IMG.ARW" };
    for (const photos of [
      [safePhoto],
      [safePhoto, targetPhoto, targetPhoto],
      [safePhoto, { ...targetPhoto, path: "/Other/Card/IMG.ARW" }, targetPhoto],
    ]) {
      const result = pull([safe, target], photos);
      expect(result.writes).toBe(0);
      expect(result.saved).toBe(0);
      expect(result.messages.join(" ")).toContain("Nothing was applied");
    }
    expect(pull([target, target], [targetPhoto]).writes).toBe(0);
  });
  test("loose paths, traversal, wrong cases and invalid metadata are refused", () => {
    for (const patch of [
      { relativePath: "IMG.ARW" },
      { relativePath: "../IMG.ARW" },
      { relativePath: "Card/../IMG.ARW" },
      { relativePath: "card/IMG.ARW" },
      { rating: "5" },
      { rating: 2.5 },
      { verdict: "invalid" },
      { label: {} },
    ]) {
      const result = pull(
        [{ file: "IMG.ARW", relativePath: "Card/IMG.ARW", verdict: "keep", ...patch }],
        [{ file: "IMG.ARW", path: "/Photos/Card/IMG.ARW" }],
      );
      expect(result.writes).toBe(0);
      expect(result.saved).toBe(0);
    }
  });
  test("old queued batches cannot enter the catalog writer", () => {
    const result = pull(
      [{ file: "IMG.ARW", relativePath: "Card/IMG.ARW", verdict: "keep" }],
      [{ file: "IMG.ARW", path: "/Photos/Card/IMG.ARW" }],
      "verdicts",
    );
    expect(result.writes).toBe(0);
    expect(result.messages.join(" ")).toContain("publish again");
  });
  test("null frames are not silently removed and nullable labels cause no catalog label write", () => {
    const target = { file: "IMG.ARW", relativePath: "Card/IMG.ARW", verdict: "keep", label: null };
    const photos = [{ file: "IMG.ARW", path: "/Photos/Card/IMG.ARW" }];
    const valid = pull([target], photos);
    expect(valid.saved).toBe(1);
    expect(valid.photos[0]).not.toHaveProperty("label");
    const invalid = pull([target, null], photos);
    expect(invalid.writes).toBe(0);
    expect(invalid.saved).toBe(0);
  });
  test("5,000 namesakes match once each in a simulated catalog; oversized batches write nothing", () => {
    // This is real generated Lua execution, not a licensed Lightroom integration test.
    const frames = Array.from({ length: 5000 }, (_, index) => ({
      file: "IMG.ARW",
      relativePath: `Shoot/Card ${index}/IMG.ARW`,
      verdict: index % 2 ? "reject" : "keep",
      rating: index % 6,
    }));
    const photos = frames
      .map((frame) => ({ file: frame.file, path: `/Photos/${frame.relativePath}` }))
      .reverse();
    const result = pull(frames, photos);
    expect(result.saved).toBe(5000);
    expect(result.writes).toBe(15000);
    for (let index = 0; index < result.photos.length; index++) {
      const source = 4999 - index;
      expect(result.photos[index]).toMatchObject({
        pickStatus: source % 2 ? -1 : 1,
        rating: source % 6,
      });
    }
    const excessive = pull(
      [...frames, { ...frames[0], relativePath: "Shoot/Extra/IMG.ARW" }],
      photos,
    );
    expect(excessive.writes).toBe(0);
    expect(excessive.saved).toBe(0);
  });
});
