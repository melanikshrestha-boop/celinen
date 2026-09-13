# Culling review queue: local verification

The existing Studio interface now has a **Red dots** filter. K keeps, X rejects,
and both advance through the displayed queue. Keep is green, unresolved review
is red, and a saved reject is dark red. Existing decisions are never silently
reset. Thumbnail scores and OS/LR badges are removed.

## Policy boundaries

- Underexposure alone is not a red warning or an automatic rejection.
- Global preview sharpness cannot prove that a whole image is irrecoverably
  blurry: even a sharp subject against a flat background can score poorly.
- Softness, possible blur, highlight clipping, similar frames and existing eye
  warnings stay undecided for review. Automatic culling suggests keeps only.
- Manual/XMP red labels hold undecided photos for review until K/X.
- There is no implemented expression classifier. Green means kept, not a claim
  that the expression, pose or artistic intent was checked.
- Explicit user-approved commands such as rejecting a requested flag category
  remain separate from automatic import policy.
- Originals and camera cards are not changed by a verdict.

## Failures reproduced and repaired

1. Native first-pass kept some soft/highlight-clipped frames that the web policy
   held for review. Native and web policy now agree on those warnings.
2. A manual red label could be promoted to keep by automatic culling. It now
   survives repeated passes until an explicit decision.
3. Radix restored focus to the filter after selection, making K select
   “Keepers” rather than keep the photo. Closing a changed filter now focuses
   the persistent filmstrip; removing a focused red thumbnail retains focus.
4. Studio's owning controller used the read-only compatibility loader, leaving
   its expected revision at zero after reload. It now acknowledges the initial
   owner hydration only. Read-only consumers still cannot rebase a stale writer.
5. The paused-save notice was hidden on desktop in the dashboard shell. It is
   visible there now, and Keep/Reject buttons are disabled while saving is paused.
6. An explicit chat request to open a photo outside the queue could be redirected
   to another photo by the selection guard. Explicit reveal clears the filters;
   ordinary keyboard decisions remain constrained to visible frames.

## Browser evidence

Verified on the running 8085 app in a separate QA Chromium profile, using a new
UUID shoot containing four public fixture copies. No customer shoots were used.

- All photos showed the correct green/red/dark-red dots and no thumbnail scores.
- Choosing Red dots selected the first red frame, not a previously selected keeper.
- K advanced over an intervening keeper to the next red frame.
- X completed the queue without wrapping to another photo. Extra K was a no-op.
- Undo restored the last review frame and its selection.
- After durable save and reload, all four originals had matching SHA-256 bytes;
  the ordered decisions were keep, keep, reject, reject, with no false save conflict.
- Dark mode at 390px had no horizontal overflow. A hard-coded white Studio header
  found during this check now uses the existing black dashboard theme.

These are interaction and persistence checks, not RAW throughput measurements.
A forced browser-process termination or automation reload can bypass normal
pending-save navigation protection; this test waits for durable readback.

The production build and scoped lint pass. Repository-wide type checking still
reports existing errors outside these changes. No new face model, full-resolution
blur proof, camera-card deletion, or throughput claim is included in this change.

## Reproduction

Use a disposable local LAB browser profile. Seed a fresh test shoot with
`tests/cull-review-seed.browser.js` via browser evaluation; it returns its Studio URL.
Choose Red dots, press K then X, check the empty queue, Undo, then X again. Wait
for durable saving before reloading. The public fixture originals must remain
unchanged. Never run destructive cleanup against a customer profile.

Run focused regressions with Bun: cull-review, cull-filmstrip, first-pass,
smart-cull, cull-on-import, studio-owner-hydration, studio-reveal-photo,
cull-view, studio-session-safety, studio-save-boundary, studio-compatibility-save,
studio-commands and studio-command-safety. Native core, streaming, pipeline and
worker suites were also rebuilt and passed.
