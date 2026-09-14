# Photographer conversation routing

Local change based on `f21fafe`. Not committed, pushed, or published.

## Confirmed cause

`CullChat` sent all messages through Studio's action parsers first. The safety
filter rejects conditional language such as “tomorrow”, “before”, and “if”, even
in planning questions. The legacy keyword parser also interprets “How do I cull?”
as a cull command. This explains a reproducible command-only interaction; it does
not establish whether the owner's separate live session has a provider, auth, or
history failure.

## Change

- Route questions, brainstorming, planning, drafting, greetings, booking requests,
  and restricted/conditional sentences into a conversation-only path. No photo
  import is required. Recognized conversation can continue during import.
- Do not run local photo, client, or navigation actions in this path. Omit model
  tools. The server also strips supplied tools in conversation mode. The client
  rejects unsolicited tool calls without executing or retaining them in context.
- Keep explicit Studio actions, preview approval, Adobe settings, XMP commands,
  and burst review on their existing paths. Photo actions remain blocked during import.
- Add the server-side photographer assistant policy: brainstorm and plan naturally,
  distinguish suggestions from verified research, never invent a booking or claim
  to see photo pixels. There is no connected venue booking tool here.
- Explain disabled cloud AI, local-only mode, and missing verified sign-in
  separately. Empty AI responses are errors rather than a “done” success message.

This is conservative English-language routing, not a new general intent model.
For example, “Can you cull?” is treated as conversation rather than execution;
“cull this shoot” keeps the existing action behavior.

## Verification

- 32 focused checks pass, including execution of the actual send callback and
  the actual server handler with isolated auth/provider doubles.
- `CELINEN_CHAT_BASELINE=1 bun test tests/photography-assistant.test.ts` loads the
  committed send callback without editing the worktree: 27 pass / 5 fail.
  Failures cover planning, cull explanations, conversation during import,
  rejecting conversational tool calls, and empty-response handling.
- Current full application suite: 2,433 pass / 5 fail / 21 skip / 1 todo.
  The five failures are the same previously documented appearance failures:
  compact-sidebar markers, connector marks, Develop light chrome, default theme,
  and shared typography. No failing tests were hidden or deleted.
- Production build, targeted ESLint, and whitespace checks pass. TypeScript
  remains globally failing on existing diagnostics; none mention changed files.
- No real AI/provider requests, bookings, customer photos, or user histories were
  used in these tests. UI styling, native V1/V2, and culling thresholds are unchanged.

## Live gate

The preceding read-only live check verified `/api/chat` returns 401 without
credentials. That proves the route and anonymous guard exist, not that signed-in
inference or chat persistence works. The signed-in browser automation connection
was unavailable. Do not describe this as a live fix yet.

Before publication, verify the existing hosted `SUPABASE_URL`,
`SUPABASE_PUBLISHABLE_KEY`, and `LOVABLE_API_KEY` configuration without exposing
values, plus the owner's Cloud assistant preference. Do not add a browser AI key.
Test signed-in planning -> reply -> reload/history, an explicit photo proposal,
consent/preferences, and a genuine provider failure. Actual reservations require
a separately authorized booking integration and confirmation of venue, time,
price, and cancellation terms before any submission or payment.
