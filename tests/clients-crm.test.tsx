import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  CLIENT_STAGES,
  buildWorkspaceClient,
  clientToInput,
  commitClientWorkspace,
  emptyClientInput,
  emptyClientWorkspace,
  upsertWorkspaceClient,
  type WorkspaceClient,
} from "../src/lib/client-workspace";
import {
  clientBoard,
  clientContactHref,
  clientFollowUp,
  clientRelationships,
  filterClients,
  matchesClient,
} from "../src/lib/clients/crm";
import {
  ClientPeople,
  ClientContact,
  ClientFollowUp,
} from "../src/components/clients/ClientPeople";
import { ClientEditor } from "../src/components/clients/ClientEditor";
import { formatDate, money } from "../src/lib/clients/sheet";
import type { LocalInvoiceDraft } from "../src/lib/local-finance-store";

const today = "2026-09-08";
const now = today + "T12:00:00Z";
test("actual CRM title effect settles through context churn and still follows contact/route changes", async () => {
  const child = Bun.spawn(
    [
      process.execPath,
      fileURLToPath(new URL("./clients-title-lifecycle.fixture.ts", import.meta.url)),
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [output, errors, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect(errors).toBe("");
  expect(code).toBe(0);
  expect(JSON.parse(output)).toEqual({ contextChurnRenders: 200, titleWrites: 7, settled: true });
});
function client(id = "client-one", patch: Partial<WorkspaceClient> = {}): WorkspaceClient {
  return {
    id,
    name: "Sam Rivera",
    org: "Rivera Studio",
    email: "sam@example.test",
    phone: "+1 (415) 555-0123",
    source: "Portrait",
    brief: "Warm natural-light session",
    followUpOn: null,
    budgetCents: null,
    stage: "new",
    bookings: [],
    galleryIds: [],
    invoiceIds: [],
    createdAt: now,
    updatedAt: now,
    ...patch,
  };
}
function invoice(id: string, clientId?: string): LocalInvoiceDraft {
  return {
    id,
    ...(clientId ? { clientId } : {}),
    clientName: "Sam Rivera",
    clientEmail: "sam@example.test",
    description: "Portrait draft",
    amountCents: 12345,
    dueDate: today,
    status: "draft",
    createdAt: now,
    updatedAt: now,
  };
}

describe("people-first client CRM preserves authoritative data", () => {
  test("search matches real contact, organization, specialty, notes and formatting-free phone without secrets", () => {
    const row = client();
    for (const query of [
      "SAM",
      "sam@example.test",
      "4155550123",
      "+14155550123",
      "Rivera Studio",
      "natural-light",
      "sam Portrait",
    ])
      expect(matchesClient(row, query)).toBe(true);
    expect(matchesClient(row, "someone@example.test")).toBe(false);
    expect(matchesClient(row, "4821")).toBe(false);
    expect(matchesClient(row, "Atelier", "Atelier")).toBe(true);
    expect(matchesClient(row, "")).toBe(true);
  });
  test("follow-ups use date-only comparisons and separate archived, unscheduled, future and overdue", () => {
    expect(clientFollowUp(client(), today)).toBe("unscheduled");
    expect(clientFollowUp(client("a", { followUpOn: "2026-09-07" }), today)).toBe("overdue");
    expect(clientFollowUp(client("a", { followUpOn: today }), today)).toBe("today");
    expect(clientFollowUp(client("a", { followUpOn: "2026-09-09" }), today)).toBe("upcoming");
    expect(clientFollowUp(client("a", { followUpOn: today, stage: "archived" }), today)).toBe(
      "archived",
    );
    expect(() => clientFollowUp(client(), "2026-02-30")).toThrow();
  });
  test("follow-up view excludes unscheduled and archived and sorts without mutating contacts", () => {
    const rows = [
      client("later", { followUpOn: "2026-12-31" }),
      client("none"),
      client("due", { followUpOn: today }),
      client("archived", { followUpOn: "2020-01-01", stage: "archived" }),
      client("overdue", { followUpOn: "2026-01-01" }),
    ];
    const before = JSON.stringify(rows);
    expect(
      filterClients(rows, { query: "", stage: "all", today, followUps: true }).map((c) => c.id),
    ).toEqual(["overdue", "due", "later"]);
    expect(filterClients(rows, { query: "", stage: "all", today, followUps: false })).toEqual(rows);
    expect(
      filterClients(rows, { query: "Sam", stage: "archived", today, followUps: false }).map(
        (c) => c.id,
      ),
    ).toEqual(["archived"]);
    expect(JSON.stringify(rows)).toBe(before);
  });
  test("board includes new records and every canonical stage exactly once", () => {
    const rows = CLIENT_STAGES.map((stage) => client(stage, { stage }));
    const board = clientBoard(rows);
    expect(board.map((group) => group.stage)).toEqual([...CLIENT_STAGES]);
    expect(board.flatMap((group) => group.clients)).toEqual(rows);
    expect(clientBoard([client()])[0]?.clients[0]?.id).toBe("client-one");
    expect(clientBoard([])).toHaveLength(6);
  });
  test("relationships are explicit, preserve missing IDs, dedupe invoices and refuse conflicting clients", () => {
    const owner = client("owner", {
      galleryIds: ["gallery-one", "missing-gallery"],
      invoiceIds: ["invoice-one", "missing-invoice", "conflict"],
    });
    const gallery = {
      id: "gallery-one",
      title: "Session",
      photoCount: 4,
      message: null,
      downloadsEnabled: false,
      createdAt: now,
      updatedAt: now,
    };
    const rows = [
      invoice("invoice-one", "owner"),
      invoice("same-name-other-client", "other"),
      invoice("same-name-unlinked"),
      invoice("owner-assigned", "owner"),
      invoice("conflict", "other"),
    ];
    const before = JSON.stringify({ owner, rows, gallery });
    const links = clientRelationships(owner, [gallery], rows);
    expect(links.galleries.map((link) => link.id)).toEqual(owner.galleryIds);
    expect(links.galleries[1]?.record).toBeNull();
    expect(links.invoices.map((link) => link.id)).toEqual([
      "invoice-one",
      "missing-invoice",
      "conflict",
      "owner-assigned",
    ]);
    expect(links.invoices[2]).toEqual({ id: "conflict", record: null, conflict: true });
    expect(links.invoices[0]?.record).toBe(rows[0]!);
    expect(JSON.stringify({ owner, rows, gallery })).toBe(before);
  });
  test("contact links are user-launched mail and telephone only; embedded control/header attacks stay plain text", () => {
    expect(clientContactHref("email", "sam@example.test")).toBe("mailto:sam%40example.test");
    expect(clientContactHref("phone", "+1 (415) 555-0123")).toBe("tel:+14155550123");
    for (const value of [
      "sam@example.test\r\nBcc:victim@example.test",
      "sam@example.test\u0000",
      "javascript:alert(1)",
    ])
      expect(clientContactHref("email", value)).toBeNull();
    for (const value of ["https://example.test", "123#456", "123;phone-context=evil", "123\n456"])
      expect(clientContactHref("phone", value)).toBeNull();
    expect(clientContactHref("email", "a?bcc=victim@example.test")).toBe(
      "mailto:a%3Fbcc%3Dvictim%40example.test",
    );
  });
  test("editing core fields retains all IDs, history, related work and cents", () => {
    const previous = client("exact-id", {
      galleryIds: ["g"],
      invoiceIds: ["i"],
      budgetCents: 12345,
      bookings: [
        {
          id: "booking",
          title: "Session",
          date: today,
          location: "Home",
          status: "confirmed",
          createdAt: now,
          updatedAt: now,
        },
      ],
    });
    const result = buildWorkspaceClient(
      { ...clientToInput(previous), phone: "555-0123", followUpOn: "2026-09-09" },
      previous,
      { now: "2026-09-09T12:00:00Z" },
    );
    if (!result.ok) throw new Error(result.error);
    expect(result.value.id).toBe(previous.id);
    expect(result.value.bookings).toEqual(previous.bookings);
    expect(result.value.galleryIds).toEqual(previous.galleryIds);
    expect(result.value.invoiceIds).toEqual(previous.invoiceIds);
    expect(result.value.createdAt).toBe(previous.createdAt);
    expect(result.value.budgetCents).toBe(12345);
    expect(previous.followUpOn).toBeNull();
  });
  test("old form revision fails safely after a different contact changes", async () => {
    let stored = JSON.stringify({
      ...emptyClientWorkspace(),
      clients: [client("one"), client("two")],
    });
    const storage = {
      getItem: () => stored,
      setItem: (_key: string, value: string) => {
        stored = value;
      },
    };
    const locks = {
      request: async <T,>(_name: string, callback: () => T | Promise<T>) => callback(),
    };
    const first = JSON.parse(stored);
    const other = await commitClientWorkspace(
      upsertWorkspaceClient(first, client("two", { org: "New organization" })),
      { storage, locks },
    );
    expect(other.ok).toBe(true);
    const preserved = stored;
    const stale = await commitClientWorkspace(
      upsertWorkspaceClient(first, client("one", { followUpOn: today })),
      { storage, locks },
    );
    expect(stale.ok).toBe(false);
    expect(stored).toBe(preserved);
    expect(JSON.parse(stored).clients).toHaveLength(2);
  });
  test("live client loading contains no seed or automatic commit, and cloud does not read device relationships", () => {
    const source = readFileSync("src/routes/clients.tsx", "utf8");
    const read = source.slice(
      source.indexOf("async function readClients()"),
      source.indexOf("async function readDrafts()"),
    );
    expect(read).not.toContain("ensureSeedClients");
    expect(read).not.toContain("commitClientWorkspace");
    expect(source).not.toContain("ensureSeedClients");
    expect(source).toContain("component: ClientsWorkspace");
    expect(source).not.toContain("LegacyWorkbenchRedirect");
    expect(read).toContain("setState(loaded.state)");
    const drafts = source.slice(
      source.indexOf("async function readDrafts()"),
      source.indexOf("const storage ="),
    );
    expect(drafts.indexOf("if (cloud)")).toBeLessThan(drafts.indexOf("loadLocalFinanceState()"));
    expect(source).toContain("revision,");
  });
  test("legacy date and money display do not shift a day or lose cents", () => {
    expect(formatDate(today)).toBe("Sep 8, 2026");
    expect(formatDate("Oct 3")).toBe("Oct 3");
    expect(money(12345)).toBe("$123.45");
    expect(money(240000)).toBe("$2,400");
    expect(money(null)).toBe("");
  });
});

describe("CRM controls render real contact workflows", () => {
  const callbacks = { onOpen: () => {}, onFollowUp: () => {}, onStage: () => {} };
  test("default compact people table exposes four useful columns, contact links and keyboard buttons", () => {
    const html = renderToStaticMarkup(
      <ClientPeople
        clients={[client("one", { followUpOn: today })]}
        today={today}
        board={false}
        busy={false}
        {...callbacks}
      />,
    );
    expect(html.match(/<th scope=/g)).toHaveLength(4);
    for (const text of [
      "Client",
      "Contact",
      "Stage",
      "Next follow-up",
      "Sam Rivera",
      "Rivera Studio",
      "sam@example.test",
      "+1 (415) 555-0123",
      "Today",
    ])
      expect(html).toContain(text);
    expect(html).toContain('href="mailto:sam%40example.test"');
    expect(html).toContain('href="tel:+14155550123"');
    expect(html).toContain('aria-label="Schedule follow-up with Sam Rivera"');
    expect(html).not.toContain("Paid");
    expect(html).not.toContain("Client pw");
  });
  test("all board columns and actual stage selectors render, including brand-new clients", () => {
    const html = renderToStaticMarkup(
      <ClientPeople clients={[client()]} today={today} board busy {...callbacks} />,
    );
    expect(html.match(/<section /g)).toHaveLength(6);
    expect(html).toContain('aria-label="New clients"');
    expect(html).toContain('aria-label="Stage for Sam Rivera"');
    expect(html).toContain('<option value="new" selected="">New</option>');
    expect(html).toContain('disabled=""');
    expect(html).toContain("Not scheduled");
  });
  test("board stage handler changes only requested real client, not its current record", () => {
    const row = client();
    const called: unknown[] = [];
    const element = ClientPeople({
      clients: [row],
      today,
      board: true,
      busy: false,
      ...callbacks,
      onStage: (...args) => called.push(args),
    });
    const newColumn = element.props.children[0];
    const card = newColumn.props.children[1][0];
    const select = card.props.children.find((child: { type?: string }) => child?.type === "select");
    select.props.onChange({ target: { value: "booked" } });
    expect(called).toEqual([[row, "booked"]]);
    expect(row.stage).toBe("new");
  });
  test("missing contact and archived reminder are honest, not fake communication activity", () => {
    expect(
      renderToStaticMarkup(<ClientContact client={client("none", { phone: "", email: "" })} />),
    ).toContain("No contact details");
    const html = renderToStaticMarkup(
      <ClientFollowUp
        client={client("old", { stage: "archived", followUpOn: "2020-01-01" })}
        today={today}
      />,
    );
    expect(html).toContain("Archived");
    expect(html).not.toContain("Overdue");
  });
  test("new and existing contact forms expose real persisted fields and never send email", () => {
    for (const original of [undefined, client()]) {
      const html = renderToStaticMarkup(
        <ClientEditor
          edit={{ kind: "client", ...(original ? { client: original } : {}), revision: 0 }}
          saving={false}
          onSave={async () => true}
          onCancel={() => {}}
        />,
      );
      for (const text of [
        "Name",
        "Organization",
        "Email",
        "Phone",
        "Next follow-up",
        "Brief / notes",
        "Planning budget (USD)",
      ])
        expect(html).toContain(text);
      expect(html).toContain('type="email"');
      expect(html).toContain('type="tel"');
      expect(html).toContain('type="date"');
      expect(html).not.toContain("Send");
    }
    expect(
      renderToStaticMarkup(
        <ClientEditor
          edit={{ kind: "booking", client: client(), revision: 1 }}
          saving
          onSave={async () => true}
          onCancel={() => {}}
        />,
      ),
    ).toContain('<fieldset disabled="">');
  });
  test("CRM is pitch-black in dark mode with sans typography and neutral readable controls", () => {
    const css = readFileSync("src/components/clients/clients-sheet.css", "utf8");
    const dark = css.match(/\.dark \.clients-sheet \{([^}]+)\}/)?.[1];
    expect(dark).toContain("--n-bg: #000000");
    expect(dark).toContain("--n-text: #ededed");
    expect(css).toContain("font-family: var(--font-sans)");
    expect(css).toContain(":focus-visible");
    expect(css).not.toContain("gradient");
  });
  test("small screens keep the client, contact, stage and follow-up together", () => {
    const css = readFileSync("src/components/clients/clients-sheet.css", "utf8");
    const phone = css.split("@media (max-width: 520px)")[1];
    expect(phone).toContain(
      'grid-template-areas: "person stage" "contact contact" "followup followup"',
    );
    expect(phone).toContain("min-width: 0");
    expect(phone).toContain("overflow-wrap: anywhere");
    expect(phone).not.toContain("display: none");
  });
});
