import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { pluginFiles } from "../src/lib/lightroom-plugin";

const files = pluginFiles("https://example.invalid/bridge", "qa-workspace", "qa-token-not-real");
const source = (name: string) => files.find((file) => file.path.endsWith(`/${name}.lua`))!.text;
const literal = (text: string) => `[====[${text}]====]`;
const lua = process.env["LENSLABS_TEST_LUA"];
function execute(code: string) {
  const run = spawnSync(lua!, ["-"], {
    input: `package.preload['JSON'] = assert(loadstring(${literal(source("JSON"))}))\nlocal JSON = require 'JSON'\n${code}`,
    encoding: "utf8",
    timeout: 5000,
  });
  if (run.status !== 0) throw new Error(run.stderr || String(run.error));
  return run.stdout.trim();
}
function roundtrip(value: unknown) {
  return JSON.parse(execute(`print(JSON:encode(JSON:decode(${literal(JSON.stringify(value))})))`));
}
function bridge(method: "post" | "get", response: string | null) {
  return JSON.parse(
    execute(`
local response = ${response === null ? "nil" : literal(response)}
local calls = 0
function import(name)
  if name == 'LrHttp' then return {
    post = function(url, body, headers) calls = calls + 1 return response end,
    get = function(url, headers) calls = calls + 1 return response end,
  } end
  return {}
end
package.preload['CelinenConfig'] = function() return { endpoint='https://example.invalid/bridge', workspace='qa-workspace', token='qa-token-not-real' } end
local Bridge = assert(loadstring(${literal(source("CelinenBridge"))}))()
local result, message = Bridge.${method}(${method === "post" ? "{ kind='push', frames={{file='IMG.ARW', path='/Photos/Card/IMG.ARW'}} }" : ""})
print(JSON:encode({ result=result or false, message=message or '', calls=calls }))
`),
  );
}

test("wire module remains packaged with the Lightroom plug-in", () => {
  expect(source("JSON")).toContain("function JSON:decode");
});

describe.skipIf(!lua)("generated Lua JSON and bridge acknowledgments", () => {
  test("null array entries and empty arrays retain their exact positions and types", () => {
    expect(roundtrip([null, { label: null }, null, [], {}, false, 0])).toEqual([
      null,
      { label: null },
      null,
      [],
      {},
      false,
      0,
    ]);
  });
  test("timestamps, numbers and control escapes roundtrip without rounding or mutation", () => {
    const value = {
      at: 1788792001123,
      file: "Café 📷.ARW",
      caption: 'quote " slash \\ tab\t newline\n\u0000\b\f',
      zero: 0,
      exposure: 0.123456789012345,
    };
    expect(roundtrip(value)).toEqual(value);
  });
  test("escaped Unicode including surrogate pairs is decoded to exact UTF-8", () => {
    expect(
      JSON.parse(
        execute(
          `print(JSON:encode(JSON:decode(${literal(String.raw`"Caf\u00e9 \ud83d\udcf7.ARW"`)})))`,
        ),
      ),
    ).toBe("Café 📷.ARW");
  });
  test("malformed responses reject promptly rather than return partial objects or loop", () => {
    const invalid = [
      "",
      "{",
      "[",
      '{"a":',
      '{"a" 1}',
      '{"a":1,}',
      "[1,]",
      "[1 2]",
      '"unfinished',
      '"bad\\q"',
      '"\\ud800"',
      '"\\udc00"',
      '"\\uXXXX"',
      "01",
      "1.",
      "1e",
      "NaN",
      "1e9999",
      "true false",
      '{"a":1,"a":2}',
      "[null,]",
    ];
    execute(`local cases = JSON:decode(${literal(JSON.stringify(invalid))})
for _, text in ipairs(cases) do
  debug.sethook(function() error('test instruction budget exceeded') end, '', 100000)
  local ok, err = pcall(function() return JSON:decode(text) end)
  debug.sethook()
  assert(not ok, 'Accepted malformed input: ' .. text)
  assert(not tostring(err):find('test instruction budget'), 'Parser did not terminate: ' .. text)
end
print('ok')`);
  });
  test("only a full, same-workspace receipt confirms a push", () => {
    const success = { ok: true, received: 1, workspace: "qa-workspace", at: 1788792001123 };
    expect(bridge("post", JSON.stringify(success))).toMatchObject({ result: true, calls: 1 });
    for (const value of [
      { error: "unauthorized" },
      { ...success, received: 0 },
      { ...success, workspace: "different" },
      { ...success, ok: "true" },
      { ...success, at: 0 },
      [],
    ])
      expect(bridge("post", JSON.stringify(value))).toMatchObject({ result: false, calls: 1 });
    for (const value of [null, "<html>502</html>", '{"ok":'])
      expect(bridge("post", value)).toMatchObject({ result: false, calls: 1 });
  });
  test("malformed or error reads cannot masquerade as an empty valid queue", () => {
    for (const value of [
      null,
      "<html>error</html>",
      '{"kind":',
      '{"error":"unauthorized"}',
      "[]",
      "null",
    ])
      expect(bridge("get", value)).toMatchObject({ result: false });
  });
  test("valid empty and folder-matched queues survive; cross-workspace queues do not", () => {
    const empty = {
      kind: "empty",
      frames: [],
      workspace: "qa-workspace",
      direction: "to-lightroom",
      at: 0,
    };
    expect(bridge("get", JSON.stringify(empty)).result).toEqual(empty);
    const queued = {
      ...empty,
      kind: "verdicts-relative-path-v1",
      at: 1788792001123,
      frames: [{ file: "IMG.ARW", relativePath: "Card/IMG.ARW", verdict: "keep", label: null }],
    };
    expect(bridge("get", JSON.stringify(queued)).result).toEqual(queued);
    for (const patch of [
      { workspace: "other" },
      { direction: "to-studio" },
      { frames: {} },
      { kind: "verdicts" },
    ])
      expect(bridge("get", JSON.stringify({ ...queued, ...patch })).result).toBe(false);
  });
  test("byte, nesting, value and cycle limits bound decoding and encoding", () => {
    expect(
      execute(`
local function refused(fn) local ok = pcall(fn) assert(not ok) end
refused(function() JSON:decode(string.rep(' ', 8388609)) end)
refused(function() JSON:decode(string.rep('[', 66) .. '0' .. string.rep(']', 66)) end)
refused(function() JSON:decode('[' .. string.rep('0,', 250000) .. '0]') end)
refused(function() JSON:decode('"' .. string.char(255) .. '"') end)
refused(function() JSON:decode('"' .. string.char(192, 175) .. '"') end)
refused(function() JSON:decode('"' .. string.char(237, 160, 128) .. '"') end)
refused(function() JSON:encode(math.huge) end)
refused(function() JSON:encode(0/0) end)
refused(function() JSON:encode(string.rep('x', 8388609)) end)
refused(function() JSON:encode(string.char(255)) end)
local cycle = {} cycle.self = cycle
refused(function() JSON:encode(cycle) end)
refused(function() JSON:encode({ [1]='a', extra='b' }) end)
print('ok')`),
    ).toBe("ok");
  });
  test("600 deterministic nested fixtures roundtrip through actual Lua", () => {
    const fixtures = Array.from({ length: 600 }, (_, i) => ({
      name: `Été 📷/${i}/IMG_${i}.ARW`,
      at: 1788792001123 + i,
      exposure: i / 127,
      label: i % 2 ? null : "Blue",
      data: [[], {}, null, i % 2 === 0, '"\\\r\n\t\b\f\u0000', i === 0 ? 0 : -i, { rating: i % 6 }],
    }));
    expect(roundtrip(fixtures)).toEqual(fixtures);
  });
  test("start/stop isolates watch generations and rejected pushes never report success", () => {
    expect(
      execute(`
local messages, tasks = {}, {}
local response = '{"error":"unauthorized"}'
function import(name)
  if name == 'LrHttp' then return { post=function() return response end } end
  if name == 'LrTasks' then return { startAsyncTask=function(fn) tasks[#tasks+1]=fn end, sleep=function() error('Must stop before sleeping after a failed push') end } end
  if name == 'LrDialogs' then return { showBezel=function(s) messages[#messages+1]=s end, message=function(_,s) messages[#messages+1]=s end } end
  if name == 'LrApplication' then return { activeCatalog=function() return {
    getTargetPhotos=function() return {{}} end,
    withWriteAccessDo=function(_,_,fn) fn() end,
  } end } end
  return {}
end
package.preload['CelinenConfig'] = function() return { endpoint='https://example.invalid', workspace='qa-workspace', token='qa-only' } end
package.preload['CelinenBridge'] = assert(loadstring(${literal(source("CelinenBridge"))}))
local Bridge = require 'CelinenBridge'
Bridge.readPhoto = function() return { file='IMG.ARW', path='/Photos/Card/IMG.ARW' } end
Bridge.writeSidecar = function() end
local run1 = Bridge.startWatch()
assert(run1.active and Bridge.startWatch() == nil)
Bridge.stopWatch()
assert(not run1.active)
local run2 = Bridge.startWatch()
Bridge.stopWatch(run1)
assert(run2.active)
Bridge.stopWatch(run2)
assert(loadstring(${literal(source("CelinenPush"))}))() tasks[#tasks]()
local pushMessage = table.concat(messages, ' ')
assert(pushMessage:find('not confirmed') and not pushMessage:find('bridge received'))
messages = {}
assert(loadstring(${literal(source("CelinenWatch"))}))() tasks[#tasks]()
assert(table.concat(messages, ' '):find('Live sync paused'))
assert(Bridge.liveRun == nil)
Bridge.startWatch()
assert(loadstring(${literal(source("CelinenStop"))}))()
assert(Bridge.liveRun == nil)
messages = {}
response = '{"ok":true,"received":1,"workspace":"qa-workspace","at":1788792001123}'
assert(loadstring(${literal(source("CelinenPush"))}))() tasks[#tasks]()
assert(table.concat(messages, ' '):find('bridge received 1 frames'))
print('ok')`),
    ).toBe("ok");
  });
});
