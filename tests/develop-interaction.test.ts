import { expect, it } from "bun:test";
import { DevelopPointerOwnership } from "../src/lib/develop/interaction";

it("accepts only the owning touch and its completed click", () => {
  const gate = new DevelopPointerOwnership();
  expect(gate.down(1)).toBe(true);
  expect(gate.down(2)).toBe(false);
  expect(gate.accepts(2)).toBe(false);
  expect(gate.accepts(1)).toBe(true);
  gate.release(2);
  expect(gate.active).toBe(1);
  expect(gate.click(2)).toBe(false);
  expect(gate.click()).toBe(false);
  gate.release(1);
  expect(gate.click(1)).toBe(true);
});
it("a rejected pointer's late click cannot activate a preset after first touch releases", () => {
  const gate = new DevelopPointerOwnership();
  gate.down(1);
  gate.down(2);
  gate.release(1);
  expect(gate.click(2)).toBe(false);
  expect(gate.click()).toBe(true);
});
it("supports pointer ID reuse, blur and older MouseEvent clicks", () => {
  const gate = new DevelopPointerOwnership();
  gate.down(1);
  gate.down(2);
  gate.blur();
  expect(gate.click(undefined, true)).toBe(false);
  expect(gate.click()).toBe(true);
  expect(gate.down(2)).toBe(true);
  gate.release(2);
  expect(gate.click(2)).toBe(true);
});
