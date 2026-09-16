import { expect, test } from "bun:test";
import { micErrorMessage } from "../src/lib/voice/mic-capture";

test("mic errors tell the photographer what to do", () => {
  expect(micErrorMessage({ name: "NotAllowedError" })).toBe("Allow the microphone");
  expect(micErrorMessage({ name: "NotFoundError" })).toBe("No microphone");
  expect(micErrorMessage({ name: "NotReadableError" })).toBe("Microphone busy");
  expect(micErrorMessage({ name: "NotSupportedError" })).toBe("Microphone is not available");
  expect(micErrorMessage(new Error("boom"))).toBe("Microphone failed");
});
