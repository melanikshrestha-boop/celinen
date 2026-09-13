import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SelectionRequestForm } from "../src/components/delivery/SelectionRequestForm";
import {
  newDelivery,
  transition,
  clientState,
  downloadable,
  commandSchema,
  nextAction,
  selectionDeadlinePassed,
  selectionRequest,
  type DeliveryCommand,
  type DeliveryState,
} from "../src/lib/delivery/workflow";

const before = "2026-09-13T12:00:00.000Z";
const deadline = "2026-09-14T12:00:00.000Z";
const after = "2026-09-14T12:00:00.001Z";
const expiry = "2026-10-13T12:00:00.000Z";
const request = { selectionLimit: 2, selectionDeadline: deadline };
function create(selectionDeadline?: string | null) {
  return newDelivery(
    {
      id: crypto.randomUUID(),
      title: "Team",
      clientName: "Client",
      message: "",
      selectionLimit: 2,
      expiresAt: expiry,
      ...(selectionDeadline === undefined ? {} : { selectionDeadline }),
    },
    before,
  );
}
function act(
  state: DeliveryState,
  command: DeliveryCommand | { type: "complete"; versionId: string },
  actor: "owner" | "client" = "owner",
  at = before,
  id = crypto.randomUUID(),
) {
  return transition(state, command, actor, id, JSON.stringify(command), at);
}
function ready() {
  const versionId = crypto.randomUUID(),
    photoId = crypto.randomUUID();
  const variant = { sha256: "a".repeat(64), bytes: 100, width: 1200, height: 800 };
  let state = act(create(deadline), {
    type: "reserve",
    version: {
      id: versionId,
      photoId,
      filename: "goal.jpg",
      source: null,
      variants: { proof: variant, phone: variant, full: variant },
    },
  });
  state = act(state, { type: "complete", versionId });
  state = act(state, { type: "publish", versionIds: [versionId] });
  state = act(state, { type: "pick", photoId, on: true }, "client");
  return { state, versionId, photoId };
}
test("legacy galleries have no deadline; optional deadlines roundtrip without migration", () => {
  expect(create().selectionDeadline).toBeUndefined();
  expect(selectionDeadlinePassed(create(), after)).toBe(false);
  expect(selectionRequest(create())).toEqual({ selectionLimit: 2, selectionDeadline: null });
  expect(clientState(create(deadline)).selectionDeadline).toBe(deadline);
});
test("creation rejects invalid or post-expiry deadlines; extensions require a future cutoff", () => {
  for (const invalid of [before, "not-a-date", "2027-01-01T00:00:00.000Z"]) {
    if (invalid !== before) expect(() => create(invalid)).toThrow();
    expect(() =>
      act(create(), {
        type: "selectionRequest",
        request: { ...request, selectionDeadline: invalid },
      }),
    ).toThrow();
  }
  expect(create(expiry).selectionDeadline).toBe(expiry);
  for (const invalid of [0, 3001, NaN, 1.5])
    expect(
      commandSchema.safeParse({
        type: "selectionRequest",
        request: { ...request, selectionLimit: invalid },
      }).success,
    ).toBe(false);
});
test("a device draft connecting after the cutoff retains its expired request, not a new deadline", () => {
  const state = create(before);
  expect(state.selectionDeadline).toBe(before);
  expect(selectionDeadlinePassed(state, after)).toBe(true);
  expect(state.picks).toEqual([]);
});
test("only the photographer can change a request; picks cannot be silently discarded", () => {
  const { state, photoId } = ready();
  expect(() => act(state, { type: "selectionRequest", request }, "client")).toThrow("photographer");
  const withTwo = { ...state, picks: [photoId, crypto.randomUUID()] };
  expect(() =>
    act(withTwo, { type: "selectionRequest", request: { ...request, selectionLimit: 1 } }),
  ).toThrow("saved picks");
  expect(withTwo.picks).toHaveLength(2);
});
test("the exact deadline rejects picks, unpicks and submit without modifying saved work", () => {
  const { state, photoId } = ready();
  const original = structuredClone(state);
  for (const at of [deadline, after]) {
    expect(selectionDeadlinePassed(state, at)).toBe(true);
    for (const command of [
      { type: "pick" as const, photoId, on: true },
      { type: "pick" as const, photoId, on: false },
      { type: "submit" as const, photoIds: [photoId] },
    ])
      expect(() => act(state, command, "client", at)).toThrow("deadline has passed");
  }
  expect(state).toEqual(original);
  expect(nextAction(state, "client", after)).toContain("extension");
});
test("lost-response retry is idempotent across a deadline but a new submission is rejected", () => {
  const { state, photoId } = ready();
  const id = crypto.randomUUID();
  const command = { type: "submit" as const, photoIds: [photoId] };
  const submitted = act(state, command, "client", before, id);
  expect(act(submitted, command, "client", after, id)).toBe(submitted);
  expect(submitted.submissions).toHaveLength(1);
});
test("deadline does not block feedback, approval, exact-version release or downloads", () => {
  let { state, photoId, versionId } = ready();
  state = act(state, { type: "submit", photoIds: [photoId] }, "client");
  state = act(
    state,
    { type: "comment", versionId, body: "Love this one", revision: false },
    "client",
    after,
  );
  state = act(state, { type: "approve", versionId }, "client", after);
  state = act(state, { type: "release", versionIds: [versionId] }, "owner", after);
  expect(downloadable(state, versionId, after)).toBe(true);
  expect(downloadable(state, versionId, expiry)).toBe(false);
});
test("extending a deadline retains picks and does not reopen an approved submission implicitly", () => {
  const { state, photoId } = ready();
  const extension = {
    type: "selectionRequest" as const,
    request: { selectionLimit: 3, selectionDeadline: expiry },
  };
  const next = act(state, extension, "owner", after);
  expect(next.picks).toEqual(state.picks);
  expect(selectionDeadlinePassed(next, after)).toBe(false);
  const submitted = act(state, { type: "submit", photoIds: [photoId] }, "client");
  expect(() => act(submitted, extension, "owner", after)).toThrow("Reopen submitted");
  const reopened = act(submitted, { type: "reopenSelections" }, "owner", after);
  expect(act(reopened, extension, "owner", after).submissions).toEqual(submitted.submissions);
});
test("clearing a deadline preserves history; malformed persisted deadlines fail closed", () => {
  const { state } = ready();
  const next = act(
    state,
    { type: "selectionRequest", request: { ...request, selectionDeadline: null } },
    "owner",
    after,
  );
  expect(selectionDeadlinePassed(next, after)).toBe(false);
  expect(next.photos).toEqual(state.photos);
  expect(next.events.slice(0, -1)).toEqual(state.events);
  expect(selectionDeadlinePassed({ ...state, selectionDeadline: "corrupt" }, after)).toBe(true);
});
test("request controls state limits, local timezone and absence of reminder emails", () => {
  const html = renderToStaticMarkup(
    <SelectionRequestForm state={create()} busy={false} onDirty={() => {}} save={async () => {}} />,
  );
  for (const text of [
    "Maximum selections",
    "datetime-local",
    "Save selection request",
    "No reminder emails are sent",
  ])
    expect(html).toContain(text);
});
