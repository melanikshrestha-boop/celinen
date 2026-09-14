import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL("../" + path, import.meta.url), "utf8");

test("V2 contract remains unqualified with no deployment, customer authority or export", () => {
  const lock = JSON.parse(read("native/canonical-v2.lock.json"));
  expect(lock.qualified).toBe(false);
  expect(lock.deployment).toEqual({ allowed: false, customer_authority: false, export: false });
});

test("V2 builds are explicit and do not join the existing application or V1 build", () => {
  for (const path of ["native/Makefile", "package.json", "src/server/native-studio-plugin.ts"]) {
    expect(read(path)).not.toMatch(/canonical[_-]v2|canonical-decoder-v2|v2\.mk/);
  }
});

test("both V2 decoder executables rebuild when the pinned contract changes", () => {
  const makefile = read("native/v2.mk");
  for (const name of ["v2-probe", "v2-decoder-tests"]) {
    const rule = makefile.split("\n").find((line) => line.startsWith("$(V2_DIR)/" + name + ":"));
    expect(rule).toBeDefined();
    expect(rule!.split("|")[0]).toContain("canonical-v2.lock.json");
  }
});

test("V2 fixture inputs are pinned and use their own manifest", () => {
  const manifest = JSON.parse(read("tests/fixtures/canonical-v2.json"));
  expect(manifest.fixtures).toHaveLength(5);
  expect(manifest.fixtures.map((f: { format: string }) => f.format)).toContain("arw");
  for (const fixture of manifest.fixtures) {
    expect(fixture.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(fixture.orientation).toBeGreaterThanOrEqual(1);
    expect(fixture.orientation).toBeLessThanOrEqual(8);
  }
  expect(read("tests/canonical-v2-parity.mjs")).not.toContain("tests/fixtures/decoder-parity.json");
});
