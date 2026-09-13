# Streaming native analysis

This backend-only change replaces `analyze()`'s full grayscale plane with three
rolling rows. It leaves source RGBA, average hashing, mechanical scoring, review
decisions, UI, and delivery approval rules unchanged. Native admission limits
remain conservative; reduced scratch memory does not justify unbounded decodes.

## Measured on the development Mac, 2026-09-12

Baseline: main `1ceac9c`, clang++ C++20 `-O3 -DNDEBUG`, identical deterministic
RGBA input and benchmark harness. Candidate uses the same compiler flags.

| Input | Baseline scratch | Candidate scratch | Baseline warm median | Candidate warm median |
| --- | ---: | ---: | ---: | ---: |
| 256 × 256 | 524,288 bytes | 6,144 bytes | 0.410291 ms | 0.390750 ms |
| 4096 × 4096, trial 1 | 134,217,728 bytes | 98,304 bytes | 118.049 ms | 105.434 ms |
| 4096 × 4096, trial 2 | 134,217,728 bytes | 98,304 bytes | 120.371 ms | 106.016 ms |
| 4096 × 4096, trial 3 | 134,217,728 bytes | 98,304 bytes | 118.874 ms | 105.444 ms |

Large-input warm analysis was approximately 11–12% faster in these trials.
Scratch allocation fell 99.93%, from 128 MiB to 96 KiB. This excludes the
caller-owned RGBA buffer and decoder memory; it is not a process RSS claim.
Hash/sharpness checksums matched in every paired trial.

The large trials each used nine calls (first call excluded from warm median);
the small trial used 1,000. Median uses the upper middle warm sample. First-call
large-input times were baseline 126.045/161.702/133.958 ms and candidate
105.846/104.665/105.352 ms. Inputs were already decoded and resident in memory:
these are **not cold-file, RAW decoding, folder-import, upload, or end-to-end
benchmarks**, and do not establish market-leading speed or sports-action accuracy.

## Reproduce and protect

```sh
make -C native build/analysis-streaming-tests
native/build/analysis-streaming-tests
native/build/analysis-streaming-tests --benchmark 4096 9
native/build/analysis-streaming-tests --benchmark 256 1000
```

For comparison, compile the same harness against baseline `analysis.cpp` in a
separate build directory. Its allocation regressions fail as expected; do not
rebuild that baseline directory with candidate source before comparing.

The test compares statistics exactly against the frozen full-plane oracle over
random, flat, clipping-boundary, minimum-size, extreme-aspect, and non-divisible
inputs, and checks source-byte preservation. Allocation checks include the
16 Mi-pixel limit. Existing core tests cover hashes, scores, flags, malformed
input, and protection of explicit photographer picks. No customer photographs
are used by this harness.

## Delivery boundary

Rebuild the local native worker to use this optimization. A Git push or Lovable
web publication alone does not deploy a C++ service to the hosted website.
This increment does not add athlete identification or semantic action ranking.
