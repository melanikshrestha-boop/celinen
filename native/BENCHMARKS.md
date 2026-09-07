# Native engine measurements — 2026-09-04

These are **three real JPEG fixtures repeated**, not a 3,000-photo shoot, not a RAW benchmark, and not a comparison with Adobe, RapidRAW or the existing browser code.

Environment: Apple M3 Pro, 11 logical CPUs, 18 GiB RAM; Apple clang 15; arm64 C++20 release build (`-O3 -DNDEBUG`). Executable size: 132,832 bytes at this checkpoint. System frameworks are dynamically linked and are not included in that size.

Input originals: [licensed fixtures](../tests/fixtures/photos/README.md), totaling 7,355,315 bytes: 2256×1420 basketball, 4256×2832 basketball, and 3000×4000 oriented volleyball. Analysis edge is 256px.

## Sequential release runs

Compilation and sanitizer tests finished before these three runs. No OS cache flush was attempted; filesystem cache and background machine activity are uncontrolled. `--quiet` disables frame serialization and similarity lookup. Thus these measure decode/analysis/cache processing, **not full interactive culling or UI latency**.

| Configuration | Operations | Actual decodes | Cache hits | Elapsed | Peak RSS |
|---|---:|---:|---:|---:|---:|
| 1 worker, analysis cache off | 300 | 300 | 0 | 4,933.649 ms | 57.234 MiB |
| 4 workers, analysis cache off | 300 | 300 | 0 | 1,362.580 ms | 109.062 MiB |
| 4 workers, analysis cache on | 3,000 | 6 | 2,994 | 43.236 ms | 32.531 MiB |

The uncached four-worker run processed 220.171 operations/s versus 60.807 with one worker, approximately 3.62× throughput for this workload. First result: 22.544 ms versus 27.920 ms. These are within-engine concurrency comparisons—not evidence that choosing C++ alone made the application faster.

The cached row mostly reads previously computed results. Six decodes instead of three are expected here because first requests may overlap before cache insertion; this implementation does not yet deduplicate in-flight decode requests. Do not advertise its cache-hit operation rate as photo-ingest speed.

Commands, from the repository root:

```sh
native/build/lenslabs-native scan tests/fixtures/photos --threads 1 --cache-entries 0 --repeat 100 --quiet
native/build/lenslabs-native scan tests/fixtures/photos --threads 4 --cache-entries 0 --repeat 100 --quiet
native/build/lenslabs-native scan tests/fixtures/photos --threads 4 --cache-entries 1024 --repeat 1000 --quiet
```

## Correctness and safety checks

- 462 kernel checks, 72 native decoder assertions, 172 pipeline checks: **706 passed**, both optimized and AddressSanitizer/UndefinedBehaviorSanitizer builds.
- Exact similarity searches checked against exhaustive Hamming-distance results, including bounded identical-hash candidate queries.
- Cancellation, changed-file identity (including equal-length rewrites with restored mtime), error isolation, worker admission, LRU limits and callback failures tested.
- Actual Ctrl-C CLI run stopped with exit 130 and an explicit partial summary: 742/3,000 operations completed, zero failures. This is a cancellation check, not a timing baseline.
- Native portrait render produced a visually inspected upright 1200×1600 JPEG with sRGB profile. Existing-output retry was refused.
- All three original SHA-256 hashes remained equal to the checked-in fixture provenance. No user photos were used or changed.
- Invalid finite adjustment ranges and repeat limits were refused before attempting input access.

## Still required before performance claims

A fixed, photographer-labeled 3,000+ **unique** sports shoot, mixed supported RAW/JPEG cameras, source and decode-cache state, decode failures, grouping cost, peak memory, first usable image, preview responsiveness, keeper recall and correction time. GPU processing and native-to-chat integration remain separate implementation and benchmark gates.
