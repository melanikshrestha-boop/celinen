# Canonical Decoder V2: isolated GitHub handoff

## Scope

Base: origin/main at 1ceac9ccb29091e6569fa140e5d231e1d2f89d52.
Prepared in a fresh worktree, not by merging or cherry-picking the older branch.
Existing local branch codex/native-analysis-streaming at 4f83a06522ffffe1309106b623998016c5823068 and its index/working files remain intact.

This is a source-only experimental foundation. V2 is not a production decoder,
not a hosted service, not a sports model, and not connected to customer decisions.
No deployment, release workflow, gallery publication, model/weight update or
original-photo modification is part of this handoff. All existing application
source, V1 source/headers, native/Makefile, application dependencies, environment
files and existing tests remain byte-identical to the base.
Git blob-hash verification checked 1032 existing source/native/test/dependency
files against origin/main (excluding the one-line V2 build-directory ignore).
The V2 header, four implementation sources and contract lock also match the
reviewed local version byte-for-byte. Existing branch diff/index/status hashes
remain unchanged. No published history was rewritten.

## Exact files included

```text
docs/CANONICAL-DECODER-V2-SPEC.md
docs/CANONICAL-V2-STAGE-AB-2026-09-13.md
docs/CANONICAL-V2-ISOLATED-HANDOFF.md
native/.gitignore
native/Dockerfile.v2-sanitizer-test
native/bootstrap-canonical-v2.sh
native/canonical-v2.lock.json
native/include/lenslabs/canonical_v2.hpp
native/src/canonical_v2/decode.cpp
native/src/canonical_v2/primitives.cpp
native/src/canonical_v2/sha256.cpp
native/src/canonical_v2/source.cpp
native/tests/canonical_v2_decoder_tests.cpp
native/tests/canonical_v2_probe.cpp
native/tests/canonical_v2_tests.cpp
native/v2.mk
tests/canonical-v2-parity.mjs
tests/canonical-v2-isolation.test.ts
tests/fixtures/canonical-v2.json
```

Only V2-specific build-support adaptations were needed when extracting the work:
- Independent checksum-pinned fixture manifest, without V1 gate policy/references.
- Snapshot only V1 files actually present on main; never import older V1 support.
- Standalone local Linux toolchain image with false entrypoint, no V1 binaries.
- Configurable local Docker context and isolated image name.
- Contract lock added as a prerequisite of both decoder executables so incremental
  builds cannot silently retain an old provenance hash. Verified with make's
  forced-prerequisite dry run and a regression assertion.
- Four V2 isolation/build-boundary tests and current handoff documentation.

The V2 decoder source and approved dependency lock are unchanged from the reviewed
local implementation. The profile remains ICC sRGB2014, not the unverified HP profile.
No native dependency binaries, profile binary, RAW fixture files or generated
results are committed; the bootstrap verifies pinned upstream inputs.

## Intentionally excluded

All 13 earlier commits on the existing local branch are excluded, including
2bb48c4's first_pass behavior change. No older commit was merged or cherry-picked.
The paths below are the exact differing tracked/pending non-build files excluded
from the handoff. Where a path already exists on main, its main version stays.

```text
.dockerignore
CHANGELOG.md
VERSION
docs/CULL-REVIEW-QA-2026-09-13.md
docs/CULLING-PRESET-QA-2026-09-13.md
docs/DECODER-CORRECTNESS-2026-09-13.md
docs/DECODER-STAGE-ISOLATION-2026-09-13.md
docs/GALLERY-DELIVERY-MILESTONE.md
docs/IMPORT-QUEUE-QA-2026-09-13.md
docs/LINUX-NATIVE-PORT.md
docs/MAIN-BASELINE-QUALIFICATION-2026-09-13.md
docs/MVP-SHORTLIST-QA-2026-09-13.md
docs/SCENE-EXPORT-INTEGRATION-QA-2026-09-13.md
docs/SCENE-NAVIGATION-QA-2026-09-13.md
docs/SPORTS-CULL-ALPHA.md
docs/SPORTS-CULLING.md
docs/adobe-settings.md
native/ANALYSIS-PERFORMANCE.md
native/Dockerfile.linux
native/Dockerfile.linux.dockerignore
native/Makefile
native/README.md
native/SHORTLIST-BENCHMARK.md
native/include/lenslabs/bursts.hpp
native/include/lenslabs/capture_metadata.hpp
native/include/lenslabs/engine.hpp
native/include/lenslabs/pipeline.hpp
native/include/lenslabs/raw_preview_source.hpp
native/include/lenslabs/shortlist.hpp
native/include/lenslabs/sports.hpp
native/src/analysis.cpp
native/src/bursts.cpp
native/src/bursts_main.cpp
native/src/decode_linux.cpp
native/src/decode_mac.cpp
native/src/develop_raw.cpp
native/src/main.cpp
native/src/pipeline.cpp
native/src/shortlist.cpp
native/src/shortlist_main.cpp
native/src/sports.cpp
native/src/sports_watch.cpp
native/src/worker.cpp
native/tests/analysis_streaming_tests.cpp
native/tests/bursts_tests.cpp
native/tests/core_tests.cpp
native/tests/decoder_parity_probe.cpp
native/tests/decoder_stage_probe.cpp
native/tests/decoder_tests.cpp
native/tests/linux_decoder_tests.cpp
native/tests/pipeline_tests.cpp
native/tests/shortlist_benchmark.ts
native/tests/shortlist_tests.cpp
native/tests/sports_benchmark.cpp
native/tests/sports_tests.cpp
native/tests/worker_benchmark.cpp
native/tests/worker_tests.cpp
package.json
src/components/dashboard/AppDashboard.tsx
src/components/dashboard/dashboard.css
src/components/delivery/DeliveryGallery.tsx
src/components/delivery/DeliveryWorkspace.tsx
src/components/delivery/GalleryPresentationForm.tsx
src/components/delivery/NewGalleryFields.tsx
src/components/delivery/SelectionRequestForm.tsx
src/components/delivery/delivery.css
src/components/develop/DevelopPage.tsx
src/components/develop/PresetExchange.tsx
src/components/studio/CullChat.tsx
src/components/studio/Filmstrip.tsx
src/components/studio/SceneNavigation.tsx
src/components/studio/StudioChatDialog.tsx
src/components/studio/StudioFilterMenu.tsx
src/components/workbench/primary-navigation.ts
src/components/workbench/workbench.css
src/lib/delivery.functions.ts
src/lib/delivery/activity.ts
src/lib/delivery/gallery-presentation.ts
src/lib/delivery/outbox.ts
src/lib/delivery/remote.server.ts
src/lib/delivery/workflow.ts
src/lib/develop/adaptive-preset.ts
src/lib/develop/analysis.ts
src/lib/develop/client.ts
src/lib/develop/cull-view.ts
src/lib/develop/export-scope.ts
src/lib/develop/import-session.ts
src/lib/develop/import.ts
src/lib/develop/lightroom-preset.ts
src/lib/develop/preset-package.ts
src/lib/develop/shoot-repository.ts
src/lib/develop/store.ts
src/lib/foto-mcp.ts
src/lib/studio/adobe-paste.ts
src/lib/studio/commands.ts
src/lib/studio/cull-on-import.ts
src/lib/studio/cull-review.ts
src/lib/studio/first-pass.ts
src/lib/studio/native-client.ts
src/lib/studio/scene-navigation.ts
src/lib/studio/shortlist.ts
src/lib/studio/smart-cull.ts
src/lib/studio/workflow-intents.ts
src/routes/dashboard.tsx
src/routes/review.$id.tsx
src/routes/studio.tsx
src/server/native-admission.ts
src/server/native-studio-plugin.ts
src/server/production-auth.ts
tests/adaptive-preset.test.ts
tests/cull-filmstrip.test.ts
tests/cull-on-import.test.ts
tests/cull-review-seed.browser.js
tests/cull-review.test.ts
tests/cull-source-refresh.browser.js
tests/cull-view.test.ts
tests/dashboard-entry.test.ts
tests/dashboard-mobile-layout.test.ts
tests/decoder-stage-isolation.mjs
tests/delivery-design.test.tsx
tests/delivery-empty-workspace.test.ts
tests/delivery-selection-request.test.tsx
tests/delivery-server.test.ts
tests/develop-analysis-durability.test.ts
tests/develop-client.test.ts
tests/develop-export-scope.test.ts
tests/develop-import-analysis-ack.test.ts
tests/develop-import-native-preview.test.ts
tests/develop-import-observer.browser.js
tests/develop-import-observer.test.ts
tests/develop-import-order-store.test.ts
tests/develop-import-order.browser.js
tests/develop-import-ordering.test.ts
tests/develop-notification-origin.test.ts
tests/develop-scene-export-proof.browser.js
tests/first-pass.test.ts
tests/fixtures/decoder-parity.json
tests/fixtures/delivery/design-preview.tsx
tests/fixtures/lightroom-global-look.xmp
tests/lightroom-native-preset.test.ts
tests/linux-decoder-parity.mjs
tests/native-admission-client.test.ts
tests/native-admission.test.ts
tests/native-preview-provenance.test.ts
tests/native-shortlist-protocol.test.ts
tests/native-transport.test.ts
tests/primary-navigation.test.tsx
tests/production-auth.test.ts
tests/scene-navigation-seed.browser.js
tests/scene-navigation.test.ts
tests/smart-cull.test.ts
tests/sports-benchmark.mjs
tests/sports-benchmark.test.mjs
tests/sports-linux.mjs
tests/studio-account-scope.test.ts
tests/studio-chat-access.test.ts
tests/studio-commands.test.ts
tests/studio-compatibility-save.test.ts
tests/studio-export-handoff.test.ts
tests/studio-import-cull-admission.test.ts
tests/studio-import-cull-refresh.test.ts
tests/studio-original-export-fence.test.ts
tests/studio-owner-hydration.test.ts
tests/studio-reveal-photo.test.ts
tests/studio-scene-menu.test.ts
tests/studio-shortlist.browser.js
tests/studio-shortlist.test.ts
tests/workflow-intents.test.ts
```

Local generated directories native/build-baseline/ and
native/build-shortlist-sanitize-mvp/ are also excluded and preserved in place.
The unrelated admission fix in src/server/native-studio-plugin.ts and
 tests/native-transport.test.ts stays on the original branch. Environment files,
including .env.development, are not staged or changed.

## Safety boundaries

- Control defaults disabled; the test probe requires --experimental-v2.
- qualified, deployment allowed, customer authority and export remain false.
- No application/V1 Makefile or route references V2. No production flag wiring.
- verify_source uses a read-only regular-file descriptor and full-content snapshot
  verification; the probe emits JSON receipts only. No pixels/XMP/export writes.
- Tests write only private scratch fixtures/results; approved source SHA-256 values
  and protected V1 source hashes are checked before/after.
- V1 identical-input control: brightness=128, sharpness=0, score=20, blur=true.
  Baseline returns reject; fresh isolated build returns reject. The excluded older
  branch returns undecided. The V1 implementation is not modified to obtain this.

## Verification

| Check | Clean origin/main | Isolated V2 |
|---|---|---|
| Full Bun suite | 2339 pass, 21 skip, 1 todo, 5 fail | 2343 pass, 21 skip, 1 todo, same 5 fail |
| Full application build | Passed in baseline comparison | PASS, client/server |
| Existing V1 native suites | PASS | PASS, same counts below |
| V1 JPEG plus approved Sony RAW fixtures | 153 assertions pass | 153 assertions pass |
| Identical-input first_pass control | reject | reject |
| V2 primitives | Not present | 38 pass |
| V2 decoder cases | Not present | 14 pass |
| Bounded V2 malformed-prefix mutations | Not present | 10000 typed errors, zero partial outputs |
| V2 ThreadSanitizer primitives | Not present | 38 pass |
| V2 normal Mac/Linux ARM64 | Not present | 17/17 cases; 130/130 stage matches |
| Fully instrumented V2 Mac/Linux ARM64 | Not present | 17/17 cases; 130/130 stage matches; no reported ASan/UBSan findings |

Five unchanged appearance failures, accepted by the owner for this source handoff:
sidebar-presentation compact row; brand-mark connector paths; develop-preview
light/dark chrome; shoot-tabs-appearance default theme; typography fallback.
No expectations, skips or existing tests were altered.

The first isolated full run had 2341 pass and 7 fail: the same five appearance
failures plus the known social export busy 429 and a subsequent analyze HTTP 400.
Both transport failures reproduced together on clean main with the same external
test-only 250ms social cleanup delay (19 pass, 2 fail). The social path sends its
JPEG before clearing its busy flag; a premature busy rejection leaves an upload
body unread, allowing the following pooled request to fail. No V2 code is in
that path. The final ordinary full run, after dependency compilation finished,
has only the five appearance failures. This is not a claim to fix the race.
All attempts are retained; no retry/skip was added to the project test suite.

V1 native counts on the isolated build: core 472, JPEG decoder 97, pipeline 180,
worker 337, burst 3499, people 37, social 27615, Develop 442188, reference 29,
crop 45, receipt 2211, gallery 12, settings 6, calendar 6. These are the main
implementation's tests, not the larger counts from the excluded branch.

Local evidence (not uploaded photo data):
- /tmp/celinen-isolated-baseline-full.log
- /tmp/celinen-isolated-full.log and /tmp/celinen-isolated-full-final.log
- /tmp/celinen-isolated-baseline-busy.log
- /tmp/celinen-isolated-build.log and /tmp/celinen-isolated-build-final.log
- /tmp/celinen-isolated-v1-native.log and /tmp/celinen-isolated-v1-raw.log
- /tmp/celinen-isolated-v2-units.log and /tmp/celinen-isolated-v2-tsan.log
- /tmp/celinen-isolated-v2-parity.log
- /tmp/celinen-isolated-v2-instrumented-parity.log

Normal parity report:
/var/folders/4d/pz7_vbhj5cl30r9sl7jdjq1c0000gn/T/celinen-v2-parity-wNPGQR/run.json.

Fully instrumented parity report:
/var/folders/4d/pz7_vbhj5cl30r9sl7jdjq1c0000gn/T/celinen-v2-parity-FDswo6/run.json.
Both reports have zero mismatches/failures, all original/scratch input and seven
protected-file hashes preserved, qualified=false and deploymentAllowed=false.
All three dependencies were independently rebuilt under ASan/UBSan on both
targets; this is not an instrumented wrapper around uninstrumented libraries.
Both runners intentionally exit 2 because full release qualification is pending.

Credential scan: zero high-severity findings. Its 19 pattern warnings were
individually checked: libjpeg version 3.1.4.1 mistaken for an IPv4 address and
the mutation generator's integer 1013904223 mistaken for a phone number.
Neither is a credential or personal data. Environment files are unchanged.

## Reproduction from a fresh checkout

Application/V1 checks use the existing commands (no release command):

```sh
bun install --frozen-lockfile
sh native/bootstrap-libraw.sh
make -C native -j4 all test
bun test
bun run build
```

V2 requires Clang, make and CMake 3.31.8. On Mac, use the CMake.app binary
from the official cmake-3.31.8-macos-universal.tar.gz archive (SHA-256
 d1449f969c54d5c00886d5b643340d493dfb3c81cb39ee29b35453395c11ebf7).
Set CMAKE to that executable when running the bootstrap.

```sh
sh native/bootstrap-canonical-v2.sh
make -C native -f v2.mk all test decoder-test
V2_SANITIZE=1 sh native/bootstrap-canonical-v2.sh
```

Download the official Linux ARM64 CMake archive. The runner independently checks
its SHA-256 609735983e3bdf24b6ab379d918458d64196fe72b98226f62dd5e9fe7b2997cc
before any extraction. It is a build tool, not the decoder contract.

```sh
curl --fail --location --max-time 120 \
  https://github.com/Kitware/CMake/releases/download/v3.31.8/cmake-3.31.8-linux-aarch64.tar.gz \
  -o native/build-v2/downloads/cmake-linux.tar.gz
# stdin Dockerfile: zero repository context, even with the legacy Docker builder.
docker --context colima-celinen-linux build -t celinen-v2-isolated:verification - < native/Dockerfile.v2-sanitizer-test
node tests/canonical-v2-parity.mjs --raw-root /absolute/approved-raw-fixtures
UBSAN_OPTIONS=halt_on_error=1 node tests/canonical-v2-parity.mjs --raw-root /absolute/approved-raw-fixtures --instrumented
```

Use --docker-context NAME if your local ARM64 VM has another context name.
The runner expects an existing local Linux ARM64 Docker VM. It does not create
cloud infrastructure or fetch photo fixtures. See tests/fixtures/canonical-v2.json
for two required licensed/checksum-pinned ARW inputs; existing JPEG provenance is
in tests/fixtures/photos/README.md. Do not substitute customer libraries.

Exit 2 means the executed subset passes but full qualification remains blocked;
exit 1 is an execution/mismatch failure. Neither is a production release pass.
The local container has no network, non-root UID, read-only root, bounded tmpfs,
CPU/memory/PID limits and no ports. It is a disposable test process, not staging.

## Remaining gates

Physical Linux x86-64; broader cameras/ICC/parser coverage; full decoder
concurrency/TSan; operational authenticated shadow service; manually labeled
sports corpus; and throughput/quality benchmarks remain unqualified.
No claim of V1/Linux parity or customer-safe deployment is made.

Review noted an unproven malformed-entropy error-path concern around automatic
RGB state across libjpeg setjmp/longjmp. Existing bounded prefix mutations are
not exhaustive post-allocation entropy coverage. Treat this as follow-up review
before any service accepts untrusted uploads; no crash or sanitizer finding is
claimed from that concern. The library remains disconnected and disabled.
