# FOTO sky entry and workspace recovery — 2026-09-09

## Scope

The public landing, authentication, and first-account setup use the owner's latest
bright, playful photography reference: white surfaces, OpenAI Sans, rounded blue
mountain artwork, and soft blue/lime feature illustrations. These styles are scoped
to public entry surfaces. The existing workspace, Develop editor, account settings,
financial calculations, original photos, and library stores are unchanged.

The original Lovable history did not contain the supplied mountain design. This is
a new implementation of that reference, not a claim to have restored an old version.
Existing entry destinations, verified-session checks, profile saves, Google sign-in,
password and email-link handlers, and safe return destinations are retained.

## Workspace blocker and approved backend repair

The signed-in hosted preview saved the account profile successfully, then failed at
`listWorkspaceChats`: the live backend had neither private chat table nor its RPCs.
This was reproduced before changes; it was not an authentication or worker-startup
failure.

With explicit owner approval, the following was installed through the existing
FOTO Lovable Cloud SQL editor as one transaction:

- `0017_private_workspace_chats.sql` lines 1–20: two tables, index, RLS, and grants.
- All of `0020_conversation_controls.sql`: final save and owner-checked delete RPCs.

This folded installation was compared with sequential 0017 then 0020 in isolated
PostgreSQL: table/column/constraint/index/policy/function/ACL definitions matched.
All 62 behavioral/security assertions passed, including broad default-grant denial,
owner isolation, revision conflicts, retained existing records, quotas, and controls.

The live transaction succeeded. Read-only metadata checks verified:

- RLS enabled on both new tables.
- `workspace_chats`: authenticated SELECT only, filtered by `owner_id = auth.uid()`.
- No anonymous access or direct authenticated writes on either table.
- Both RPCs executable by authenticated users, not anonymous users.

The signed-in hosted `/workspace` then opened the real photography chat with its
import buttons and composer, without the previous unavailable error. No QA photos
or conversations were inserted into a customer library. The migration ledger was
not advanced across unapplied siblings. **0022 upload-permissions was not applied**
and still requires separate authorization. Future migration work must reconcile
these manually installed objects instead of blindly replaying 0017/0020.

The UI also now degrades explicitly to an in-memory temporary conversation if
cloud history is unavailable in future. Retry never replaces or implicitly uploads
that conversation. Genuine unsaved-history failures remain blocking and exportable.

## Verification before publication

- Final full regression suite: 2012 passed, 21 skipped, one existing opt-in RAW white-balance
  TODO, zero failures; 370053 assertions. Loopback-dependent checks used isolated
  services, not customer accounts.
- Final focused landing/auth/setup/history/savings checks: 29 passed, 5376 assertions.
- TypeScript, targeted ESLint, production build, and diff whitespace checks passed.
- Actual built Cloudflare worker: `/` and `/auth?mode=signin&next=%2Fearnings` returned
  200 HTML on a cold worker, with outbound access disabled and zero outbound calls.
- Rendered desktop landing/auth and narrow landing/auth checked: scoped sans font,
  white page, local image load, keyboard-accessible controls, and no horizontal
  overflow. Separate isolated origin avoided the customer's local library storage.

Publication requires the existing private connected branch, an explicit Lovable
Publish action, and fresh `lenslab.dev` readback; a Git push alone is not proof.
Google account selection and owner credentials remain owner-only verification.

## Artwork provenance

`public/images/celinen-open-sky.webp` is newly generated artwork, 1672 × 941 pixels,
174072 bytes. It was generated using the image-generation tool on 2026-09-09;
only WebP encoding was performed afterward. It contains no third-party logo or UI.

Generation direction: wide artistic photography-workspace hero; whimsical,
photorealistic sunlit green alpine peaks and snow summits in the bottom 35%; generous
clean cerulean sky in the top 60%; low clouds; joyful natural daytime texture;
no text, UI, logos, watermarks, people, or cameras.

The original PNG is retained in the user's generated-images output. Feature cards
are decorative CSS illustrations, not simulated functioning controls or product
availability claims. No savings math or published financial totals changed.
