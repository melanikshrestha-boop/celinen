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

## Bounded staging and shared capture metadata, 2026-09-13

The CLI scan now feeds decoded images to one analysis consumer through a fixed
ring. An image permit remains held during decoding, queueing, analysis and
receipt delivery. Queue entries do not add image buffers outside the previous
conservative `12 * edge * edge` bytes per admitted image / 256 MiB admission
estimate. ImageIO and LibRaw internal allocations remain additional. With one
admitted image, processing stays fused. With multiple admitted images, the
analysis consumer adds one thread to the requested decoder pool. `--fused`
retains the per-worker decode/analysis path for paired measurements.

The LENS1 worker now reads capture metadata from the decoder's already-open
source and existing properties. For RAW, capture metadata still comes from the
original source, not its embedded JPEG. This removes the separate metadata file
open and ImageIO source parse. Capture-time and camera-key parsing are unchanged.
For previews already at or below 256px, analysis uses the existing RGBA directly
instead of copying it. Larger previews retain the same area-average reduction.

Worker receipts include `preview_origin` from the actual decode path:
`embedded_raw_jpeg` or `raster_decode`. A RAW filename extension alone does not
establish embedded-preview provenance. Source dimensions and analysis dimensions
remain separately reported.

### Measurements and limits

All runs below used only the three public JPEG fixtures in
`tests/fixtures/photos`, with cache disabled for CLI runs. Repetition does not
create a unique shoot. Source OS cache and background machine activity were
uncontrolled. Release builds used Apple clang C++20 `-O3 -DNDEBUG` on the
development Mac. These runs do not measure RAW extraction, browser upload,
IndexedDB persistence, trained inference, keeper quality, or hosted deployment.

Three paired CLI runs, four decoder workers, 256px analysis, 300 operations:

| Trial | Fused elapsed | Staged elapsed | Fused operations/s | Staged operations/s |
| --- | ---: | ---: | ---: | ---: |
| 1 | 1487.646 ms | 1471.828 ms | 201.661 | 203.828 |
| 2 | 1449.825 ms | 1437.983 ms | 206.921 | 208.626 |
| 3 | 1456.879 ms | 1448.679 ms | 205.920 | 207.085 |

This is about a 1% change, not evidence of a material throughput gain. Summed
decode time across lanes was approximately 5.6–5.8 seconds, versus 86–89 ms for
analysis. Decoder work dominates. Staged runs admitted at most four image slots;
the largest observed queue contained two jobs. These counters cover reserved
pipeline image slots, not a process RSS ceiling.

For the real LENS1 worker, the comparison harness compiled the worker from
`4bbe825` against the same current analysis/decoder objects, without requesting
the new shared metadata result. That preserves its separate metadata reread.
The candidate requests the shared metadata. Each trial processed 102 operations
(three fixtures repeated 34 times), sequentially, at a 1280px preview edge.

| Trial | Previous worker median | Shared-metadata median | Previous harness total | Candidate harness total |
| --- | ---: | ---: | ---: | ---: |
| 1 | 48.2615 ms | 45.1129 ms | 5027.78 ms | 4749.29 ms |
| 2 | 48.0432 ms | 45.3016 ms | 4945.93 ms | 5090.15 ms |
| 3 | 47.0758 ms | 44.1950 ms | 4860.19 ms | 4628.20 ms |

Per-request medians fell approximately 6%; whole-run throughput was noisy and
one candidate trial was slower. Every paired content checksum was identical:
`7579495175871510635`. The checksum covers exact JPEG bytes and serialized
analysis, tone and capture fields, excluding timing/provenance additions.
Warm metadata rereading previously took approximately 3 ms on the basketball
fixture; reusing properties took approximately 0.002 ms per JPEG in these trials.

A separate candidate run used a 256px preview edge and 1002 operations (the same
three fixtures repeated 334 times). One worker took 16,767.2 ms, or 59.7595
operations/s, with a 17.6987 ms median worker time and 56 MiB process peak RSS.
Decode totaled 16,038.1 ms, analysis 258.015 ms, and JPEG encoding 348.747 ms.
This remains a repeated-source, single-worker measurement, not a 1002-photo
shoot or evidence for 400 photos/s.

### Run the measurements

Run after compilation and correctness tests finish:

```sh
make -C native build/lenslabs-native build/worker-benchmark
native/build/lenslabs-native scan tests/fixtures/photos --threads 4 --edge 256 --cache-entries 0 --repeat 100 --quiet --fused
native/build/lenslabs-native scan tests/fixtures/photos --threads 4 --edge 256 --cache-entries 0 --repeat 100 --quiet
native/build/worker-benchmark tests/fixtures/photos 34 1280
native/build/worker-benchmark tests/fixtures/photos 334 256
```

`worker-benchmark PATH [repeat 1..1000] [edge 8..2048]` also accepts a complete
unique-fixture directory with repeat `1`, up to 100,000 operations. It retains
one response at a time and runs the actual worker protocol using memory streams.
It excludes process startup, OS pipe transport, browser upload and storage.
Its median includes the first call and selects the upper middle sample.
Missing stage timings from an older comparison worker are explicitly labeled
`stages_available:false`; zero fields in that case are unavailable measurements.

Worker `timings_ms.decode_total` contains the disjoint decoder substages
`source_open`, `raw_extract`, `imageio_decode_resize`, `rgba`, and `metadata`.
Do not add those substages to `decode_total`. ImageIO combines decode, orientation
and thumbnail resize in one API call, so a separate JPEG-only timing is not
claimed. `analysis_resize`, `analysis`, and `jpeg_encode` follow decoding.
CLI `stage_sum_ms` sums operation times across concurrent lanes; those sums are
not sequential wall-clock phases and can exceed total elapsed time.

Full release and AddressSanitizer/UndefinedBehaviorSanitizer native suites passed.
Coverage includes bounded queue admission, decoder/downstream overlap, exact
fused/staged result association, cancellation, callback failures, source-change
refusal, cached timing reset, capture parsing, disguised extensions and response
framing. The optional CC0 RAW corpus was unavailable and skipped. New RAW-origin
assertions will run when that explicitly configured corpus is present. No
customer photographs were used or changed.
