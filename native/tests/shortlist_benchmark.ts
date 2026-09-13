/** Run from repo root: bun native/tests/shortlist_benchmark.ts
 * Synthetic metadata only. Every sample starts a new native process; no persistent
 * worker, photo decode, upload, storage, accuracy or RAW-throughput measurement.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { cpus, totalmem } from "node:os";

const binary = resolve("native/build/lenslabs-shortlist");
const median = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
const records = [];
for (const count of [337, 1000, 10000]) {
  const rows = Array.from({ length: count }, (_, i) => {
    const id = Buffer.from(`synthetic-${i}`).toString("hex");
    const folder = Buffer.from(`group-${Math.floor(i / 25)}`).toString("hex");
    return `${id} aaaaaaaaaaaaaaaa ${70 + (i % 30)} 200 120 0 - ${folder} undecided native-cpp unknown`;
  });
  const target = Math.ceil(count / 5);
  const input = `LENSSHORTLIST1 ${target} ${count}\n${"3\n".repeat(count)}LENSBURST2 ${count}\n${rows.join("\n")}\n`;
  const elapsed: number[] = [];
  let expectedChecksum = "";
  for (let invocation = 0; invocation < 6; invocation++) {
    const start = performance.now();
    const run = spawnSync(binary, { input, encoding: "utf8", maxBuffer: 24 * 1024 * 1024 });
    elapsed.push(performance.now() - start);
    if (run.status !== 0 || run.error)
      throw new Error(`Native benchmark failed: ${run.error ?? run.stderr}`);
    const result = JSON.parse(run.stdout);
    if (
      result.selectedIds.length !== target ||
      result.candidateIds.length !== target ||
      result.shortfall !== 0
    )
      throw new Error("Unexpected shortlist receipt");
    const checksum = createHash("sha256").update(run.stdout).digest("hex");
    if (invocation && checksum !== expectedChecksum)
      throw new Error("Non-deterministic shortlist response");
    expectedChecksum = checksum;
  }
  records.push({
    frames: count,
    target,
    groups: Math.ceil(count / 25),
    requestBytes: Buffer.byteLength(input),
    firstInvocationMs: elapsed[0],
    repeatedInvocationMs: elapsed.slice(1),
    repeatedMedianMs: median(elapsed.slice(1)),
    repeatedMaxMs: Math.max(...elapsed.slice(1)),
    responseSha256: expectedChecksum,
  });
}
console.log(
  JSON.stringify(
    {
      hardware: {
        cpu: cpus()[0]?.model ?? "unavailable",
        logicalCpus: cpus().length,
        memoryBytes: totalmem(),
        architecture: process.arch,
        os: process.platform,
      },
      method:
        "One first invocation plus five repeat new-process launches per size. Timing includes spawn/stdin/stdout/exit, excludes input construction and JSON validation. OS caches uncontrolled; first invocation is not a proven cold-cache run.",
      limitations:
        "Synthetic measured receipts only; no pixels, customer photos, decoder, upload, persistence, selection accuracy or RAW throughput.",
      records,
    },
    null,
    2,
  ),
);
