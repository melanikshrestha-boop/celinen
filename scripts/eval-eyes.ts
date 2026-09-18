/**
 * Measures the cull's eye reading against labelled photographs.
 *
 *   bun scripts/eval-eyes.ts <folder> [--edge 640] [--json report.json]
 *
 * The folder holds `open/`, `closed/` and `unknown/` (a helmet visor, the back
 * of a head, a face too small to judge — anything a photographer could not call
 * either way). Every photograph runs through the shipped engine: the same
 * WebAssembly binary, the same models, the same decode the ingest lanes use.
 *
 * What it prints, and why:
 *  - precision and recall for "closed" at the shipped thresholds. Precision is
 *    the number that matters: a false closed is a frame the photographer paid
 *    for and never sees again, while a missed blink only costs them a look.
 *  - the same numbers across a grid of probability and confidence thresholds,
 *    so a shipped operating point is chosen from evidence, not taste.
 *  - the confusion matrix, including how often an unreadable face is correctly
 *    called unknown rather than closed.
 *  - accuracy by how many pixels of face the original actually carried, which
 *    is what decides whether eyes can be read at all.
 *  - the cost per frame, and what that means for a ten-thousand frame card.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { instantiateCullWasm, type CullEngine, type CullFace } from "../src/lib/studio/cull/engine";
import {
  instantiateIngestWasm,
  type FaceReading,
  type IngestEngine,
} from "../src/lib/studio/cull/ingest-engine";

type Label = "open" | "closed" | "unknown";
const LABELS: readonly Label[] = ["open", "closed", "unknown"];
type State = "open" | "closed" | "uncertain" | "unknown";

const root = new URL("..", import.meta.url).pathname;
const PHOTO = /\.(jpe?g|jpg)$/i;

function args() {
  const [dir, ...rest] = process.argv.slice(2);
  const options = new Map<string, string>();
  for (let i = 0; i < rest.length; i += 2)
    if (rest[i]?.startsWith("--")) options.set(rest[i]!.slice(2), rest[i + 1] ?? "");
  return { dir, edge: Number(options.get("edge") ?? 640), json: options.get("json") };
}

function photographs(dir: string): { path: string; label: Label }[] {
  const out: { path: string; label: Label }[] = [];
  for (const label of LABELS) {
    const folder = join(dir, label);
    let entries: string[] = [];
    try {
      entries = readdirSync(folder);
    } catch {
      continue;
    }
    for (const entry of entries.sort()) {
      const path = join(folder, entry);
      if (PHOTO.test(entry) && statSync(path).isFile()) out.push({ path, label });
    }
  }
  return out;
}

async function engines(): Promise<{ ingest: IngestEngine; cull: CullEngine }> {
  const read = (name: string) => readFileSync(join(root, "src/lib/studio/cull", name));
  const ingest = await instantiateIngestWasm(read("celinen-ingest.wasm"));
  const model = (name: string) => {
    const bytes = read(join("models", name));
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  };
  ingest.loadFaceModels({
    detector: model("face_detection_yunet_2023mar.onnx"),
    landmarks: model("face_landmarks_detector.tflite"),
    blendshapes: model("face_blendshapes.tflite"),
  });
  return { ingest, cull: await instantiateCullWasm(read("celinen-cull.wasm")) };
}

/** The faces of one frame as the engine's rule reads them. */
function toCullFaces(faces: readonly FaceReading[]): CullFace[] {
  return faces.map((face) => ({
    x: face.x,
    y: face.y,
    width: face.width,
    height: face.height,
    sharpness: face.sharpness,
    eyesOpen: null,
    score: face.score,
    closedProbability: face.closedProbability,
    confidence: face.confidence,
  }));
}

type Frame = {
  path: string;
  label: Label;
  faces: CullFace[];
  aspect: number;
  primary: FaceReading | undefined;
  ms: number;
};

function judge(
  cull: CullEngine,
  frame: Frame,
  thresholds?: { closedProbability?: number; minConfidence?: number },
): State {
  if (!frame.faces.length) return "unknown";
  return cull.judgeEyes(frame.faces, frame.aspect, thresholds ?? {}).state;
}

function counts(frames: readonly Frame[], states: readonly State[]) {
  // Closed is the only call that costs a frame, so it is the one scored.
  let truePositive = 0,
    falsePositive = 0,
    falseNegative = 0;
  for (let i = 0; i < frames.length; i++) {
    const called = states[i] === "closed";
    const isClosed = frames[i]!.label === "closed";
    if (called && isClosed) truePositive++;
    else if (called) falsePositive++;
    else if (isClosed) falseNegative++;
  }
  const precision =
    truePositive + falsePositive ? truePositive / (truePositive + falsePositive) : 1;
  const recall = truePositive + falseNegative ? truePositive / (truePositive + falseNegative) : 1;
  return { truePositive, falsePositive, falseNegative, precision, recall };
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const bucketOf = (pixels: number) =>
  pixels < 60 ? "<60px" : pixels < 100 ? "60-100px" : pixels < 200 ? "100-200px" : "200px+";

async function main() {
  const { dir, edge, json } = args();
  if (!dir) {
    console.error(
      "usage: bun scripts/eval-eyes.ts <folder with open/ closed/ unknown/> [--edge 640] [--json out.json]",
    );
    process.exit(2);
  }
  const files = photographs(dir);
  if (!files.length) {
    console.error(`No photographs under ${dir}/{open,closed,unknown}.`);
    process.exit(2);
  }
  const { ingest, cull } = await engines();

  const frames: Frame[] = [];
  const failures: { path: string; error: string }[] = [];
  for (const { path, label } of files) {
    const bytes = new Uint8Array(readFileSync(path));
    const started = performance.now();
    try {
      const result = ingest.read(bytes, { measureEdge: edge });
      const faces = result.faces ?? [];
      frames.push({
        path,
        label,
        faces: toCullFaces(faces),
        aspect: result.frame.width / result.frame.height,
        primary: faces.find((face) => face.primary),
        ms: performance.now() - started,
      });
    } catch (error) {
      failures.push({ path, error: error instanceof Error ? error.message : String(error) });
    }
  }

  const shipped = frames.map((frame) => judge(cull, frame));
  const score = counts(frames, shipped);
  const byLabel = new Map<Label, Map<State, number>>();
  frames.forEach((frame, i) => {
    const row = byLabel.get(frame.label) ?? new Map<State, number>();
    row.set(shipped[i]!, (row.get(shipped[i]!) ?? 0) + 1);
    byLabel.set(frame.label, row);
  });

  console.log(
    `\n${frames.length} photographs from ${dir} (${failures.length} unreadable), working edge ${edge}px`,
  );
  for (const label of LABELS) {
    const total = frames.filter((frame) => frame.label === label).length;
    if (!total) continue;
    const row = byLabel.get(label) ?? new Map();
    const parts = (["closed", "uncertain", "open", "unknown"] as State[])
      .map((state) => `${state} ${row.get(state) ?? 0}`)
      .join(", ");
    console.log(`  labelled ${label.padEnd(8)} (${String(total).padStart(4)}): ${parts}`);
  }
  console.log(
    `\nAt the shipped thresholds: precision ${pct(score.precision)}, recall ${pct(score.recall)} ` +
      `(${score.truePositive} caught, ${score.falsePositive} false rejects, ${score.falseNegative} missed)`,
  );

  console.log("\nThresholds (probability x confidence): precision / recall / false rejects");
  const probabilities = [0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9];
  const confidences = [0.3, 0.5, 0.6, 0.7, 0.8, 0.9];
  console.log(`      ${confidences.map((c) => `c>=${c.toFixed(2)}`.padStart(18)).join("")}`);
  const sweep: Record<
    string,
    Record<string, { precision: number; recall: number; falsePositive: number }>
  > = {};
  for (const p of probabilities) {
    const cells: string[] = [];
    sweep[p.toFixed(2)] = {};
    for (const c of confidences) {
      const states = frames.map((frame) =>
        judge(cull, frame, { closedProbability: p, minConfidence: c }),
      );
      const row = counts(frames, states);
      sweep[p.toFixed(2)]![c.toFixed(2)] = {
        precision: row.precision,
        recall: row.recall,
        falsePositive: row.falsePositive,
      };
      cells.push(`${pct(row.precision)} / ${pct(row.recall)} / ${row.falsePositive}`.padStart(18));
    }
    console.log(`p>=${p.toFixed(2)}${cells.join("")}`);
  }

  console.log("\nBy how many pixels of face the original carried (primary face):");
  const buckets = new Map<
    string,
    { total: number; judged: number; correct: number; falseClosed: number }
  >();
  frames.forEach((frame, i) => {
    const bucket = frame.primary ? bucketOf(frame.primary.pixels) : "no face";
    const row = buckets.get(bucket) ?? { total: 0, judged: 0, correct: 0, falseClosed: 0 };
    row.total++;
    if (frame.primary?.judged) row.judged++;
    const state = shipped[i]!;
    if (frame.label === "closed" && state === "closed") row.correct++;
    if (frame.label === "open" && state === "open") row.correct++;
    if (frame.label === "unknown" && (state === "unknown" || state === "uncertain")) row.correct++;
    if (frame.label !== "closed" && state === "closed") row.falseClosed++;
    buckets.set(bucket, row);
  });
  for (const [bucket, row] of [...buckets].sort())
    console.log(
      `  ${bucket.padEnd(9)} frames ${String(row.total).padStart(4)}, eyes read ${String(row.judged).padStart(4)}, ` +
        `called right ${pct(row.correct / row.total)}, false rejects ${row.falseClosed}`,
    );

  const times = frames.map((frame) => frame.ms).sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)] ?? 0;
  const cores = typeof navigator === "undefined" ? 8 : navigator.hardwareConcurrency || 8;
  const lanes = Math.max(2, Math.min(12, cores - 1));
  console.log(
    `\nCost: median ${median.toFixed(1)} ms a frame in this runtime; ` +
      `a 10,000 frame card on ${lanes} lanes is about ${((median * 10000) / lanes / 1000).toFixed(0)} s.`,
  );
  if (failures.length) {
    console.log("\nUnreadable:");
    for (const failure of failures.slice(0, 10)) console.log(`  ${failure.path}: ${failure.error}`);
  }

  if (json) {
    writeFileSync(
      json,
      JSON.stringify(
        {
          folder: dir,
          edge,
          frames: frames.map((frame, i) => ({
            path: frame.path,
            label: frame.label,
            state: shipped[i],
            ms: frame.ms,
            primary: frame.primary ?? null,
          })),
          shipped: score,
          sweep,
        },
        null,
        2,
      ),
    );
    console.log(`\nWrote ${json}`);
  }
  ingest.release();
}

await main();
