/** The unlearned prior. What this photographer has actually taught the culler
 * is tested in cull-preferences.test.ts: eye.ts no longer learns anything, so
 * that there is one learned path instead of two writing to the same number. */
import { expect, test } from "bun:test";
import { artfulPrior, photographerQuality, warmthOf } from "../src/lib/studio/cull/eye";
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

test("closed eyes and a missed subject pull the prior down", () => {
  const open = cullReading({ hasFace: true, subjectLuma: 90, acuitySubject: 0.5, acuityBest: 0.52 });
  expect(artfulPrior(cullReading({ ...open, eyesClosed: true }))).toBeLessThan(artfulPrior(open));
  // Focus landed well in front of or behind the subject.
  expect(artfulPrior(cullReading({ ...open, acuityBest: 0.9 }))).toBeLessThan(artfulPrior(open));
});

test("the prior is a multiplier on quality, never a replacement for it", () => {
  const frame = cullReading({ hasFace: true, subjectLuma: 90, acuitySubject: 0.6 });
  // Same frame, two priors: the ordering follows the prior and the range stays 1..99.
  const low = photographerQuality(frame, 0.1);
  const high = photographerQuality(frame, 0.9);
  expect(high).toBeGreaterThan(low);
  expect(low).toBeGreaterThanOrEqual(1);
  expect(high).toBeLessThanOrEqual(99);
});

test("warmth reads the colour signature, not the pixels", () => {
  const warm = cullReading({ color: new Uint8Array([220, 120, 60, 210, 118, 58]) });
  const cool = cullReading({ color: new Uint8Array([60, 120, 220, 58, 118, 210]) });
  expect(warmthOf(warm)).toBeGreaterThan(0);
  expect(warmthOf(cool)).toBeLessThan(0);
  expect(warmthOf(cullReading({ color: new Uint8Array() }))).toBe(0);
});
