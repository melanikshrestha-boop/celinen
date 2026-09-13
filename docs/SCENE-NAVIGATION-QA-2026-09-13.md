# Scene-navigation checkpoint — 2026-09-13

This records native/transport verification, not accuracy on the user's shoot or
completion of subject/location recognition. No customer photos were opened for
these checks. Scene suggestions never move photos, modify picks or delete data.

## Delivered and bounded

The native `lenslabs-bursts` executable accepts an additive `LENSBURST2` scene
request. Each ordered row includes a hash domain (`native-cpp`, `browser`, or
`unknown`) and capture-time basis (`utc`, `camera_clock`, or `unknown`). Scene
requests bypass legacy burst ranking. Legacy `LENSBURST1` behavior remains intact.

The server and browser send one ordered request, not backend/time partitions.
Every input ID is assigned exactly once in contiguous input order, including
missing/error frames. Those frames have unknown measurement evidence, not
fabricated analysis. Hash comparisons require matching known domains; time gaps
require a matching known clock basis and camera identity. Unknown timestamps
never fall back to filesystem modification time.

Candidate boundaries use folder changes, known camera changes, forward
same-camera capture gaps of at least 60 seconds, or an adjacent appearance change
requiring both at least 24 changed hash bits and 30 brightness units. Flat or
near-clipped hashes are ineligible for appearance comparison. An isolated
A→B→A-like visual excursion does not split a scene; its ID may instead appear as
a **possible visual outlier**. All thresholds are uncalibrated navigation
heuristics. Exposure, camera movement and creative intent can explain these
changes; unrelated photographs can also remain together.

The response declares `suggestions-only`, `uncertain: true`, the method version,
limitations, group IDs in order, reasons and numerical evidence. The browser
rejects missing, reordered, duplicate or foreign IDs and foreign outlier IDs.
There is no semantic confidence score or claim that subjects/locations differ.

The opt-in compact dropdown provides All scenes, group counts and optional visual
outlier subsets. It performs no receipt work while closed, catches invalid input,
offers retry after failure, and fences results against current evidence/scope.
Pick-only changes do not restart grouping. Aborted late responses cannot replace
the current result. The Studio route owns filter application and queue focus.

## Verification

- Native release and AddressSanitizer/UndefinedBehaviorSanitizer burst suite:
  **3,535 checks, zero failures**, including domains/bases, threshold boundaries,
  missing times, flat hashes, isolated outliers, ID/order/pick preservation,
  malformed protocol and the 100,000-frame bound.
- Scene transport tests: **6 tests, 30 assertions**, including a real rebuilt
  native v2 subprocess response, mixed evidence, absent measurements, malformed
  responses, pick-stable evidence keys and late cancellation.
- Scoped ESLint and `git diff --check` passed.
- A broader native-transport run passed 16 tests before its local HTTP fixture
  could not bind port 0 (`EADDRINUSE`) in the agent environment. This is not
  recorded as a passing HTTP bridge suite.

Reproduce from repository root:

```sh
make -C native build/burst-tests build/lenslabs-bursts -j4
native/build/burst-tests
make -C native BUILD_DIR=build-sanitize CXXFLAGS='-std=c++20 -O1 -g -Wall -Wextra -Wpedantic -pthread -fsanitize=address,undefined -fno-omit-frame-pointer' build-sanitize/burst-tests -j4
native/build-sanitize/burst-tests
bun test tests/scene-navigation.test.ts
```

One release run grouped synthetic receipts in 0.046 ms for 300, 1.397 ms for
10,000 and 17.745 ms for 100,000. These measurements exclude image discovery,
decoding, import persistence, HTTP and rendering. They are not 300-photo import
timings, semantic accuracy evidence or a RAW-throughput claim.

## Remaining verification

Mounted Studio dropdown, keyboard focus, scope-switch and export browser QA are
owned by the integration checkpoint and must be recorded from actual runs.
Representative consenting shoot accuracy, unrelated-subject detection and
location recognition remain unverified. Current signals cannot establish them.
