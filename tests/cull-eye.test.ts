import { expect, test } from "bun:test";
import {
  applyTaste,
  artfulPrior,
  featuresFromReading,
  photographerQuality,
  rememberDecision,
  sceneContext,
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

test("two keeps and two rejects are enough for taste to move", () => {
  let memory: EyeMemory = { samples: [] };
  const kept = cullReading({ hasFace: true, subjectLuma: 55, acuitySubject: 0.4, quality: 48 });
  const dumped = cullReading({ hasFace: false, subjectLuma: 210, acuitySubject: 0.88, quality: 92 });
  for (let i = 0; i < 2; i++) {
    memory = rememberDecision(memory, kept, "keep");
    memory = rememberDecision(memory, dumped, "reject");
  }
  expect(tasteKeep(kept, memory)).toBeGreaterThan(tasteKeep(dumped, memory));
});

test("night-portrait taste transfers to another night face, not a bright empty frame", () => {
  let memory: EyeMemory = { samples: [] };
  const nightKeep = cullReading({
    hasFace: true,
    subjectLuma: 50,
    acuitySubject: 0.38,
    quality: 44,
  });
  const wall = cullReading({ hasFace: false, subjectLuma: 200, acuitySubject: 0.9, quality: 94 });
  for (let i = 0; i < 5; i++) {
    memory = rememberDecision(memory, nightKeep, "keep");
    memory = rememberDecision(memory, wall, "reject");
  }
  const otherNight = cullReading({
    hasFace: true,
    subjectLuma: 62,
    acuitySubject: 0.41,
    quality: 50,
    subjectX: 0.38,
  });
  expect(sceneContext(featuresFromReading(otherNight))).toBe("night-portrait");
  expect(tasteKeep(otherNight, memory)).toBeGreaterThan(tasteKeep(wall, memory));
  expect(applyTaste(otherNight, memory).quality).toBeGreaterThan(applyTaste(wall, memory).quality);
});

test("a night face outranks a sharp empty frame before any history", () => {
  const night = cullReading({
    hasFace: true,
    subjectLuma: 52,
    acuitySubject: 0.4,
    acuityBest: 0.48,
    quality: 28,
  });
  const empty = cullReading({
    hasFace: false,
    subjectLuma: 190,
    acuitySubject: 0.86,
    texture: 0.04,
    quality: 90,
  });
  expect(photographerQuality(night, artfulPrior(night))).toBeGreaterThan(
    photographerQuality(empty, artfulPrior(empty)),
  );
});
