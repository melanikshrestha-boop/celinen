import { expect, test } from "bun:test";
import {
  applyTaste,
  artfulPrior,
  featuresFromReading,
  rememberDecision,
  tasteKeep,
  type EyeMemory,
} from "../src/lib/studio/cull/eye";
import { cullReading } from "./cull-review.fixture";

test("a night portrait with a face is not punished as too dark", () => {
  const night = cullReading({
    hasFace: true,
    subjectLuma: 58,
    acuitySubject: 0.42,
    acuityBest: 0.48,
  });
  const empty = cullReading({
    hasFace: false,
    subjectLuma: 180,
    acuitySubject: 0.8,
    texture: 0.03,
  });
  expect(artfulPrior(night)).toBeGreaterThan(artfulPrior(empty));
  expect(artfulPrior(night)).toBeGreaterThan(0.55);
});

test("keep/reject history pulls later scores toward what this photographer kept", () => {
  let memory: EyeMemory = { samples: [] };
  const kept = cullReading({
    hasFace: true,
    subjectLuma: 62,
    acuitySubject: 0.4,
    quality: 55,
  });
  const dumped = cullReading({
    hasFace: false,
    subjectLuma: 200,
    acuitySubject: 0.85,
    quality: 90,
  });
  for (let i = 0; i < 6; i++) {
    memory = rememberDecision(memory, kept, "keep");
    memory = rememberDecision(memory, dumped, "reject");
  }
  expect(tasteKeep(kept, memory)).toBeGreaterThan(tasteKeep(dumped, memory));
  expect(applyTaste(kept, memory).quality).toBeGreaterThan(applyTaste(dumped, memory).quality);
});

test("features never include pixels", () => {
  const keys = Object.keys(featuresFromReading(cullReading()));
  expect(keys.some((key) => /blob|pixel|rgba|file/i.test(key))).toBe(false);
});
