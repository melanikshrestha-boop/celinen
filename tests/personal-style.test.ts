import { expect, test } from "bun:test";
import {
  PERSONAL_STYLE_KEY,
  clearPersonalStyle,
  loadPersonalStyle,
  recordPersonalStyleSample,
} from "../src/lib/personal-style";
import { DEFAULT_PREFERENCES, preferenceKey } from "../src/lib/account-preferences";

const memory = new Map<string, string>();
const storage = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => {
    memory.set(key, value);
  },
  removeItem: (key: string) => {
    memory.delete(key);
  },
  key: (i: number) => [...memory.keys()][i] ?? null,
  get length() {
    return memory.size;
  },
};
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });

test("personal style stores compact edit numbers, never pixels", () => {
  memory.clear();
  recordPersonalStyleSample(
    { exposure: 0.4, contrast: 12, temperature: -8, saturation: 5 },
    "snapshot",
  );
  const log = loadPersonalStyle();
  expect(log.samples).toHaveLength(1);
  expect(log.samples[0]?.exposure).toBe(0.4);
  expect(JSON.stringify(log)).not.toContain("data:");
  expect(JSON.stringify(log)).not.toContain("blob");
});

test("turning the preference off skips new samples and clear wipes the log", () => {
  memory.clear();
  recordPersonalStyleSample(
    { exposure: 1, contrast: 0, temperature: 0, saturation: 0 },
    "preset",
  );
  expect(loadPersonalStyle().samples).toHaveLength(1);
  memory.set(
    preferenceKey("device-local"),
    JSON.stringify({ ...DEFAULT_PREFERENCES, learnFromYourWork: false }),
  );
  recordPersonalStyleSample(
    { exposure: 2, contrast: 0, temperature: 0, saturation: 0 },
    "preset",
  );
  expect(loadPersonalStyle().samples).toHaveLength(1);
  clearPersonalStyle();
  expect(memory.has(PERSONAL_STYLE_KEY)).toBe(false);
  expect(loadPersonalStyle().samples).toHaveLength(0);
});
