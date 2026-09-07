import { describe, expect, test } from "bun:test";
import {
  CLIENT_WORKSPACE_KEY,
  buildClientBooking,
  buildWorkspaceClient,
  clientToInput,
  commitClientWorkspace,
  emptyClientInput,
  emptyClientWorkspace,
  linkClientDraft,
  invoiceClientKey,
  invoiceClientOptions,
  loadClientWorkspace,
  saveClientWorkspace,
  upsertClientBooking,
  upsertWorkspaceClient,
  type ClientWorkspaceLocks,
  type ClientWorkspaceStorage,
} from "../src/lib/client-workspace";
import { buildLocalInvoiceDraft } from "../src/lib/local-finance-store";

class Storage implements ClientWorkspaceStorage {
  raw: string | null = null;
  writes = 0;
  fail = false;
  getItem(key: string) {
    expect(key).toBe(CLIENT_WORKSPACE_KEY);
    return this.raw;
  }
  setItem(key: string, value: string) {
    expect(key).toBe(CLIENT_WORKSPACE_KEY);
    if (this.fail) throw new Error("Quota exceeded");
    this.raw = value;
    this.writes++;
  }
}
const now = "2026-09-04T12:00:00.000Z";
const input = () => ({
  ...emptyClientInput(),
  name: "  Track Club  ",
  email: "coach@example.com",
  source: "Referral",
  brief: "Fast starts and finish-line emotion",
  budget: "$1,250.25",
  followUpOn: "2026-09-08",
});
function client(id = "client-a") {
  const result = buildWorkspaceClient(input(), undefined, { id, now });
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

describe("client acquisition and booking", () => {
  test("creates an unseeded client with exact cents and optional contact data", () => {
    const row = client();
    expect(row.name).toBe("Track Club");
    expect(row.budgetCents).toBe(125025);
    expect(row.stage).toBe("new");
    expect(row.bookings).toEqual([]);
    expect(clientToInput(row).budget).toBe("1250.25");
    expect(emptyClientWorkspace().clients).toEqual([]);
    expect(
      buildWorkspaceClient({ ...input(), email: "", budget: "", followUpOn: "" }, undefined, {
        id: "b",
        now,
      }).ok,
    ).toBe(true);
  });

  test("rejects impossible dates, malformed email and ambiguous budgets", () => {
    for (const patch of [
      { name: " " },
      { email: "no-at-sign" },
      { followUpOn: "2026-02-30" },
      { budget: "1e3" },
      { budget: "5.005" },
      { budget: "-100" },
    ]) {
      expect(buildWorkspaceClient({ ...input(), ...patch }, undefined, { id: "a", now }).ok).toBe(
        false,
      );
    }
    expect(
      buildClientBooking({ title: "Match", date: "2026-02-30", location: "", status: "requested" })
        .ok,
    ).toBe(false);
  });

  test("confirmation records a booking without claiming an email, invoice or payment", () => {
    const booked = buildClientBooking(
      { title: "  Saturday match ", date: "2026-09-12", location: "Track", status: "confirmed" },
      undefined,
      { id: "booking-1", now },
    );
    if (!booked.ok) throw new Error(booked.error);
    const next = upsertClientBooking(client(), booked.value);
    expect(next.stage).toBe("booked");
    expect(next.bookings[0]?.title).toBe("Saturday match");
    const updated = buildWorkspaceClient(
      { ...clientToInput(next), brief: "Updated creative brief" },
      next,
      { now },
    );
    if (!updated.ok) throw new Error(updated.error);
    expect(updated.value.bookings).toEqual(next.bookings);
    expect(JSON.stringify(next)).not.toContain("sent");
    expect(JSON.stringify(next)).not.toContain("paid");
    expect(JSON.stringify(next)).not.toContain("public");
  });

  test("explicit draft links are idempotent and never modify the draft or another client", () => {
    const original = client();
    const other = client("client-b");
    const linked = linkClientDraft(
      linkClientDraft(original, "gallery", "g-1", true),
      "gallery",
      "g-1",
      true,
    );
    const both = linkClientDraft(linked, "invoice", "i-1", true);
    expect(both.galleryIds).toEqual(["g-1"]);
    expect(both.invoiceIds).toEqual(["i-1"]);
    expect(other.galleryIds).toEqual([]);
    expect(original.galleryIds).toEqual([]);
    expect(linkClientDraft(both, "gallery", "g-1", false).invoiceIds).toEqual(["i-1"]);
    expect(linkClientDraft(both, "gallery", "g-1", false).galleryIds).toEqual([]);
  });
});

describe("client storage safety", () => {
  test("round-trips records and rejects stale writes without dropping another client", () => {
    const storage = new Storage();
    const first = saveClientWorkspace(
      upsertWorkspaceClient(emptyClientWorkspace(), client()),
      storage,
      now,
    );
    if (!first.ok) throw new Error(first.error);
    const tabA = first.state;
    const tabB = structuredClone(first.state);
    expect(
      saveClientWorkspace(upsertWorkspaceClient(tabA, client("client-b")), storage, now).ok,
    ).toBe(true);
    const stale = saveClientWorkspace(
      upsertWorkspaceClient(tabB, client("client-c")),
      storage,
      now,
    );
    expect(stale.ok).toBe(false);
    const read = loadClientWorkspace(storage);
    if (!read.ok) throw new Error(read.error);
    expect(read.state.clients.map((row) => row.id)).toEqual(["client-a", "client-b"]);
    expect(read.state.revision).toBe(2);
  });

  test("corrupt, partial, duplicate and unsupported records are preserved unchanged", () => {
    const valid = upsertWorkspaceClient(emptyClientWorkspace(), client());
    const snapshots = [
      "{broken",
      JSON.stringify({ ...valid, version: 2 }),
      JSON.stringify({ ...valid, clients: [client(), client()] }),
      JSON.stringify({ ...valid, clients: [{ ...client(), budgetCents: 1.5 }] }),
      JSON.stringify({ ...valid, clients: [{ ...client(), bookings: [{ id: "x" }] }] }),
    ];
    for (const raw of snapshots) {
      const storage = new Storage();
      storage.raw = raw;
      expect(loadClientWorkspace(storage).ok).toBe(false);
      expect(saveClientWorkspace(valid, storage, now).ok).toBe(false);
      expect(storage.raw).toBe(raw);
      expect(storage.writes).toBe(0);
    }
  });

  test("writes require a lock and report quota failure without advancing caller revision", async () => {
    const storage = new Storage();
    const state = upsertWorkspaceClient(emptyClientWorkspace(), client());
    expect((await commitClientWorkspace(state, { storage, locks: null, now })).ok).toBe(false);
    expect(storage.writes).toBe(0);
    const locks: ClientWorkspaceLocks = {
      request: async (name, callback) => {
        expect(name).toBe(`${CLIENT_WORKSPACE_KEY}.write`);
        return callback();
      },
    };
    storage.fail = true;
    expect((await commitClientWorkspace(state, { storage, locks, now })).ok).toBe(false);
    expect(state.revision).toBe(0);
    expect(storage.raw).toBeNull();
    storage.fail = false;
    expect((await commitClientWorkspace(state, { storage, locks, now })).ok).toBe(true);
    expect(storage.writes).toBe(1);
  });
});

describe("CRM invoice contacts", () => {
  test("keeps exact CRM IDs separate from legacy name/email options", () => {
    const draft = buildLocalInvoiceDraft(
      {
        clientName: "Track Club",
        clientEmail: "coach@example.com",
        description: "Coverage",
        amount: "1250.25",
        dueDate: "",
      },
      { id: "legacy-invoice", now },
    );
    if (!draft.ok) throw new Error(draft.error);
    const options = invoiceClientOptions([client()], [draft.value]);
    expect(options.map(([key]) => key)).toEqual([
      JSON.stringify(["Track Club", "coach@example.com"]),
      "client:client-a",
    ]);
    expect(options[0]?.[1].clientId).toBeNull();
    expect(options[1]?.[1].clientId).toBe("client-a");
    const selected = {
      clientId: "client-a",
      name: "Original draft client name",
      email: "prior@example.com",
    };
    const current = invoiceClientOptions([client()], [], selected);
    expect(current.find(([key]) => key === invoiceClientKey(selected))?.[1]).toEqual(selected);
  });
});
