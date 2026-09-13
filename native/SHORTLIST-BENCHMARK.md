# Requested-count shortlist: metadata-only benchmark

Run from the repository root:

```sh
make -C native build/lenslabs-shortlist
bun native/tests/shortlist_benchmark.ts
```

Hardware reported by the runtime: Apple M3 Pro, 11 logical CPUs, 18 GiB RAM,
arm64 macOS. Native release build uses the Makefile's `-O3 -DNDEBUG` defaults.

Each dataset has deterministic synthetic measured receipts, groups of 25 frames,
scores cycling from 70 to 99, available sources, and no review flags. Requested
count is one fifth of the input, rounded up. No image files are read.

Each size runs once, followed by five repeat invocations. **Every invocation
launches a fresh native process.** Time includes process launch, protocol input,
native parsing/grouping/selection, JSON output and process exit. It excludes
request construction and response validation. There is no persistent-worker
measurement. OS caches were uncontrolled; “first” does not mean cold-cache.

| Receipts | Target | Groups | First process (ms) | Five-repeat median (ms) | Five-repeat max (ms) |
| --- | --- | --- | --- | --- | --- |
| 337 | 68 | 14 | 4.026 | 2.511 | 2.580 |
| 1,000 | 200 | 40 | 6.156 | 6.215 | 6.338 |
| 10,000 | 2,000 | 400 | 58.872 | 59.898 | 65.226 |

Repeat samples, milliseconds:

- 337: 2.573, 2.486, 2.511, 2.580, 2.400.
- 1,000: 6.215, 6.269, 6.338, 5.870, 6.054.
- 10,000: 58.897, 65.226, 60.880, 58.567, 59.898.

All six outputs per size had identical SHA-256 checksums; the harness also
asserts selected/candidate counts and zero shortfall. It prints the complete
checksums, request sizes, measurements and hardware as JSON for future runs.

This is not photo upload, decoding, RAW processing, persistence, full import,
semantic moment detection or keeper-accuracy evidence. It does not establish
300 RAW/s or any complete-shoot throughput target.
