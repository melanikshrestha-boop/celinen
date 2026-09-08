import { describe, expect, test } from "bun:test";
import {
  OUTBOUND_LIMITS,
  PROSPECT_CSV_FIELDS,
  approvalFingerprint,
  campaignSchema,
  canonicalWebsite,
  composeEmail,
  emptyOutbound,
  evaluateProspect,
  exportProspectCsv,
  findDuplicate,
  normalizeEmail,
  outboundCounters,
  outboundSchema,
  parseProspectCsv,
  prepareDraft,
  prospectInputSchema,
  prospectSchema,
  safeCsvCell,
  transition,
  type OutboundCommand,
  type OutboundWorkspace,
  type ProspectInput,
} from "../src/lib/outbound/model";

const now = "2026-09-08T12:00:00.000Z";
const next = "2026-09-09T12:00:00.000Z";
const input = (patch: Partial<ProspectInput> = {}): ProspectInput =>
  prospectInputSchema.parse({
    name: "Alex Rivera",
    company: "Rivera Photo",
    email: "Alex@example.com",
    website: "https://www.riveraphoto.example/portfolio",
    specialty: "Product photography",
    signal: "Your portfolio includes a ceramic product series.",
    sourceUrl: "https://riveraphoto.example/ceramics",
    observedOn: "2026-09-08",
    fitReason: "you photograph small products",
    notes: "User-entered evidence, not independently verified.",
    ...patch,
  });
function desk(): OutboundWorkspace {
  return transition(
    emptyOutbound(),
    {
      type: "campaign",
      campaign: {
        senderName: "Celine",
        offer: "I'm building FOTO and would value your feedback.",
        cta: "Would you be open to a short conversation?",
        signature: "Celine\nFOTO",
      },
    },
    now,
  );
}
function added(patch: Partial<ProspectInput> = {}): OutboundWorkspace {
  return transition(desk(), { type: "add", id: "p1", input: input(patch) }, now);
}
function drafted(patch: Partial<ProspectInput> = {}): OutboundWorkspace {
  return transition(added(patch), { type: "draft", id: "p1" }, now);
}
function approved(patch: Partial<ProspectInput> = {}): OutboundWorkspace {
  return transition(drafted(patch), { type: "approve", id: "p1" }, now);
}
function contacted(): OutboundWorkspace {
  return transition(approved(), { type: "log-contact", id: "p1", channel: "email" }, now);
}
function csv(rows: string[][]): string {
  return rows.map((row) => row.map((v) => `"${v.replace(/"/g, '""')}"`).join(",")).join("\r\n");
}

describe("outbound strict local data model", () => {
  test("empty desk has no seeded leads, predicted results, or configured sender", () => {
    const first = emptyOutbound(),
      second = emptyOutbound();
    expect(first.prospects).toEqual([]);
    expect(first.campaign.senderName).toBe("");
    expect(outboundSchema.parse(first)).toEqual(first);
    first.campaign.offer = "Changed";
    expect(second.campaign.offer).not.toBe("Changed");
    expect(outboundCounters(second)).toEqual({
      total: 0,
      approved: 0,
      contacted: 0,
      replied: 0,
      converted: 0,
      suppressed: 0,
      contactRecords: 0,
    });
  });
  test("allows incomplete evidence and no contact channel when adding, never when approving", () => {
    const minimal = prospectInputSchema.parse({ name: "A photographer" });
    const workspace = transition(desk(), { type: "add", id: "p", input: minimal }, now);
    expect(workspace.prospects[0]!.stage).toBe("new");
    const evaluation = evaluateProspect(workspace.prospects[0]!, workspace.campaign, now);
    expect(evaluation.grade).toBe("needs-evidence");
    expect(evaluation.eligible).toBe(false);
    expect(evaluation.reasons.length).toBeGreaterThanOrEqual(5);
    expect(() => transition(workspace, { type: "approve", id: "p" }, now)).toThrow("signal");
  });
  test("rejects unknown keys, control characters, invalid email, and unsafe URLs", () => {
    for (const patch of [
      { madeUpScore: 97 },
      { email: "a@example.com\r\nBcc: x@y.com" },
      { email: "invalid" },
      { name: "Alex\nBcc: x@y.com" },
      { sourceUrl: "javascript:alert(1)" },
      { sourceUrl: "file:///etc/passwd" },
      { website: "data:text/html,test" },
      { website: "https://user:secret@example.com" },
      { notes: "bad\u0000value" },
    ]) {
      expect(prospectInputSchema.safeParse({ ...input(), ...patch }).success).toBe(false);
    }
    expect(campaignSchema.safeParse({ ...desk().campaign, confidence: 0.99 }).success).toBe(false);
    expect(outboundSchema.safeParse({ ...emptyOutbound(), version: 2 }).success).toBe(false);
  });
  test("validates real calendar dates, not just date-looking text", () => {
    for (const observedOn of [
      "2026-02-29",
      "2026-02-30",
      "2026-13-01",
      "2026-00-01",
      "09/08/2026",
      "2026-9-8",
    ])
      expect(prospectInputSchema.safeParse({ ...input(), observedOn }).success).toBe(false);
    expect(input({ observedOn: "2024-02-29" }).observedOn).toBe("2024-02-29");
  });
  test("bounds every free-text field and preserves source input on failure", () => {
    for (const [field, length] of [
      ["name", 201],
      ["company", 201],
      ["specialty", 121],
      ["signal", 2001],
      ["fitReason", 1001],
      ["notes", 4001],
    ] as const)
      expect(
        prospectInputSchema.safeParse({ ...input(), [field]: "a".repeat(length) }).success,
      ).toBe(false);
    const workspace = approved(),
      before = JSON.stringify(workspace);
    expect(() =>
      transition(
        workspace,
        { type: "edit-draft", id: "p1", subject: "a".repeat(201), body: "a" },
        now,
      ),
    ).toThrow();
    expect(JSON.stringify(workspace)).toBe(before);
  });
  test("canonical duplicate checks cover email case and website variants, including suppressed leads", () => {
    expect(normalizeEmail("  Alex@Example.COM ")).toBe("alex@example.com");
    expect(canonicalWebsite("http://WWW.Example.com:80/a?x=1#b")).toBe("example.com");
    const workspace = added();
    expect(
      findDuplicate(workspace.prospects, input({ email: "alex@EXAMPLE.COM", website: "" }))?.id,
    ).toBe("p1");
    expect(
      findDuplicate(
        workspace.prospects,
        input({ email: "elsewhere@example.com", website: "http://riveraphoto.example/about" }),
      )?.id,
    ).toBe("p1");
    const suppressed = transition(workspace, { type: "suppress", id: "p1" }, now);
    expect(() =>
      transition(
        suppressed,
        { type: "add", id: "p2", input: input({ email: "ALEX@example.com" }) },
        now,
      ),
    ).toThrow("already exists");
    expect(findDuplicate(workspace.prospects, input(), "p1")).toBeUndefined();
  });
  test("shared social platforms retain distinct profile identities instead of collapsing photographers", () => {
    for (const host of [
      "instagram.com",
      "facebook.com",
      "x.com",
      "twitter.com",
      "youtube.com",
      "behance.net",
      "threads.net",
      "vimeo.com",
    ]) {
      expect(canonicalWebsite(`https://${host}/alex`)).not.toBe(
        canonicalWebsite(`https://${host}/jordan`),
      );
    }
    expect(canonicalWebsite("https://www.instagram.com/Alex/?utm_source=share")).toBe(
      "instagram.com/alex",
    );
    expect(canonicalWebsite("https://m.instagram.com/alex/reels")).toBe("instagram.com/alex");
    expect(canonicalWebsite("https://twitter.com/Alex")).toBe(
      canonicalWebsite("https://x.com/alex"),
    );
    expect(canonicalWebsite("https://facebook.com/profile.php?id=123")).not.toBe(
      canonicalWebsite("https://facebook.com/profile.php?id=456"),
    );
    expect(canonicalWebsite("https://youtube.com/channel/UC-ONE/videos")).not.toBe(
      canonicalWebsite("https://youtube.com/channel/UC-TWO/videos"),
    );
    expect(canonicalWebsite("https://linkedin.com/in/alex")).not.toBe(
      canonicalWebsite("https://linkedin.com/in/jordan"),
    );
    let workspace = added({ email: "", website: "https://instagram.com/alex" });
    workspace = transition(
      workspace,
      {
        type: "add",
        id: "p2",
        input: input({ email: "", website: "https://instagram.com/jordan" }),
      },
      now,
    );
    expect(workspace.prospects).toHaveLength(2);
    expect(() =>
      transition(
        workspace,
        {
          type: "add",
          id: "p3",
          input: input({ email: "", website: "https://www.instagram.com/ALEX/?hl=en" }),
        },
        now,
      ),
    ).toThrow("already exists");
  });
  test("rejects duplicate edits, corrupt histories, and invented stages", () => {
    const workspace = transition(
      added(),
      {
        type: "add",
        id: "p2",
        input: input({ name: "Jo", email: "jo@example.com", website: "https://jo.example" }),
      },
      now,
    );
    expect(() => transition(workspace, { type: "edit", id: "p2", input: input() }, now)).toThrow(
      "Another prospect",
    );
    for (const patch of [
      { stage: "approved" },
      { stage: "contacted" },
      { stage: "replied" },
      { stage: "converted" },
      { stage: "suppressed" },
      { contactedAt: now },
    ])
      expect(prospectSchema.safeParse({ ...workspace.prospects[0]!, ...patch }).success).toBe(
        false,
      );
    const duplicate = structuredClone(workspace.prospects[0]!);
    duplicate.activities.push(duplicate.activities[0]!);
    expect(prospectSchema.safeParse(duplicate).success).toBe(false);
    expect(() => transition(workspace, { type: "draft", id: "missing" }, now)).toThrow("not found");
    expect(() =>
      transition(workspace, { type: "draft", id: "p1" }, "2025-01-01T00:00:00Z"),
    ).toThrow("cannot precede");
  });
  test("stored contact timestamps must match the latest record and replies cannot precede contact", () => {
    const prospect = contacted().prospects[0]!;
    expect(
      prospectSchema.safeParse({ ...prospect, contactedAt: "2026-09-08T11:59:59Z" }).success,
    ).toBe(false);
    const corrupt = structuredClone(prospect);
    corrupt.activities.splice(corrupt.activities.length - 1, 0, {
      id: "early-reply",
      type: "reply-logged",
      at: now,
      detail: "Invalid history order",
    });
    expect(prospectSchema.safeParse(corrupt).success).toBe(false);
  });
});

describe("evidence, approval and grounded drafts", () => {
  test("grades explicit evidence checklist and treats day 30 as fresh, day 31 as stale", () => {
    const workspace = drafted({ observedOn: "2026-08-09" });
    const current = evaluateProspect(workspace.prospects[0]!, workspace.campaign, now);
    expect(current.grade).toBe("ready");
    expect(current.eligible).toBe(true);
    expect(current.approvalCurrent).toBe(false);
    expect(current.canCompose).toBe(false);
    expect(current).not.toHaveProperty("probability");
    expect(current).not.toHaveProperty("score");
    const stale = evaluateProspect(workspace.prospects[0]!, workspace.campaign, next);
    expect(stale.grade).toBe("stale");
    expect(stale.reasons.join(" ")).toContain("older than 30 days");
    expect(stale.eligible).toBe(false);
  });
  test("rejects future observations and revalidates freshness at compose/contact time", () => {
    const future = drafted({ observedOn: "2026-09-09" });
    expect(() => transition(future, { type: "approve", id: "p1" }, now)).toThrow("future");
    const old = approved({ observedOn: "2026-08-09" });
    expect(() => composeEmail(old.prospects[0]!, old.campaign, next)).toThrow("older than 30 days");
    expect(() =>
      transition(old, { type: "log-contact", id: "p1", channel: "email" }, next),
    ).toThrow("older than 30 days");
    expect(outboundCounters(old).contacted).toBe(0);
  });
  test("requires every evidence item, a complete campaign and an actual draft", () => {
    for (const field of ["signal", "sourceUrl", "observedOn", "fitReason"] as const) {
      const workspace = drafted({ [field]: "" });
      expect(() => transition(workspace, { type: "approve", id: "p1" }, now)).toThrow();
    }
    for (const field of ["senderName", "offer", "cta"] as const) {
      const workspace = drafted();
      workspace.campaign[field] = "";
      expect(() => transition(workspace, { type: "approve", id: "p1" }, now)).toThrow(
        "Complete the sender",
      );
    }
    expect(() => transition(added(), { type: "approve", id: "p1" }, now)).toThrow(
      "subject and message",
    );
  });
  test("drafts use supplied facts and offer, with no invented results or product guarantees", () => {
    const prospect = input(),
      campaign = desk().campaign;
    const draft = prepareDraft(prospect, campaign);
    expect(draft.subject).toBe("A question for Rivera Photo");
    for (const fact of [
      prospect.name,
      prospect.signal,
      prospect.fitReason,
      campaign.offer,
      campaign.cta,
      campaign.signature,
    ])
      expect(draft.body).toContain(fact);
    expect(draft.body).not.toMatch(/guarantee|10x|million|save \d|best in|conversion rate/i);
    const minimal = prepareDraft(prospectInputSchema.parse({ name: "Alex" }), campaign);
    expect(minimal.body).not.toContain("I noticed");
    expect(minimal.body).not.toContain("I thought of you");
  });
  test("every prospect input edit invalidates approval, even notes-only changes", () => {
    for (const patch of [
      { name: "Alex R" },
      { company: "Rivera" },
      { email: "new@example.com" },
      { website: "https://new.example" },
      { specialty: "Portrait" },
      { signal: "Different observed fact" },
      { sourceUrl: "https://example.com/source" },
      { observedOn: "2026-09-07" },
      { fitReason: "A revised reason" },
      { notes: "A private note" },
    ]) {
      const workspace = approved();
      const edited = transition(workspace, { type: "edit", id: "p1", input: input(patch) }, now);
      expect(edited.prospects[0]!.approvedDigest).toBeUndefined();
      expect(edited.prospects[0]!.stage).toBe("review");
      expect(() => composeEmail(edited.prospects[0]!, edited.campaign, now)).toThrow("approve");
      expect(workspace.prospects[0]!.stage).toBe("approved");
    }
  });
  test("editing, regenerating, and campaign changes invalidate approvals without dropping drafts/history", () => {
    const workspace = approved(),
      original = JSON.stringify(workspace);
    const edited = transition(
      workspace,
      { type: "edit-draft", id: "p1", subject: "A different subject", body: "A changed message" },
      now,
    );
    expect(edited.prospects[0]!.approvedDigest).toBeUndefined();
    expect(
      transition(workspace, { type: "draft", id: "p1" }, now).prospects[0]!.approvedDigest,
    ).toBeUndefined();
    for (const key of ["senderName", "offer", "cta", "signature"] as const) {
      const changed = transition(
        workspace,
        { type: "campaign", campaign: { ...workspace.campaign, [key]: "Changed" } },
        now,
      );
      expect(changed.prospects[0]!.approvedDigest).toBeUndefined();
      expect(changed.prospects[0]!.body).toBe(workspace.prospects[0]!.body);
      expect(changed.prospects[0]!.activities.length).toBe(
        workspace.prospects[0]!.activities.length + 1,
      );
    }
    expect(JSON.stringify(workspace)).toBe(original);
  });
  test("direct stale recipe/campaign snapshot reuse also fails closed", () => {
    const workspace = approved(),
      prospect = workspace.prospects[0]!;
    expect(prospect.approvedDigest).toBe(approvalFingerprint(prospect, workspace.campaign));
    for (const edited of [
      { ...prospect, body: "changed" },
      { ...prospect, sourceUrl: "https://example.com/new" },
      { ...prospect, email: "new@example.com" },
    ])
      expect(() => composeEmail(edited, workspace.campaign, now)).toThrow("approve");
    expect(() =>
      composeEmail(prospect, { ...workspace.campaign, offer: "Changed offer" }, now),
    ).toThrow("approve");
  });
  test("no-email approval supports manual other-channel contact, never email compose", () => {
    const workspace = approved({ email: "" }),
      prospect = workspace.prospects[0]!;
    expect(evaluateProspect(prospect, workspace.campaign, now).eligible).toBe(true);
    expect(evaluateProspect(prospect, workspace.campaign, now).canCompose).toBe(false);
    expect(() => composeEmail(prospect, workspace.campaign, now)).toThrow("email address");
    expect(() =>
      transition(workspace, { type: "log-contact", id: "p1", channel: "email" }, now),
    ).toThrow("email address");
    expect(
      transition(workspace, { type: "log-contact", id: "p1", channel: "other" }, now).prospects[0]!
        .stage,
    ).toBe("contacted");
  });
});

describe("manual-only workflow and permanent suppression", () => {
  test("opening the mail composer never records a contact or delivery", () => {
    const workspace = approved(),
      prospect = workspace.prospects[0]!;
    const mailto = composeEmail(prospect, workspace.campaign, now);
    expect(mailto.startsWith("mailto:alex%40example.com?")).toBe(true);
    const query = new URLSearchParams(mailto.split("?")[1]);
    expect(query.get("subject")).toBe(prospect.subject);
    expect(query.get("body")).toBe(prospect.body);
    const composed = transition(workspace, { type: "compose", id: "p1" }, now);
    expect(composed.prospects[0]!.stage).toBe("approved");
    expect(composed.prospects[0]!.contactedAt).toBeUndefined();
    expect(composed.prospects[0]!.activities.at(-1)!.detail).toContain("not verified");
    expect(outboundCounters(composed).contacted).toBe(0);
  });
  test("manual contact needs current approval and cannot imply server delivery", () => {
    expect(() =>
      transition(drafted(), { type: "log-contact", id: "p1", channel: "email" }, now),
    ).toThrow("approve");
    const workspace = contacted();
    expect(workspace.prospects[0]!.contactedAt).toBe(now);
    expect(workspace.prospects[0]!.activities.at(-1)!.detail).toContain("Delivery is not verified");
    expect(outboundCounters(workspace).contacted).toBe(1);
    expect(outboundCounters(workspace).contactRecords).toBe(1);
  });
  test("seven-day cooldown blocks approval, composer, and manual recontact until the exact boundary", () => {
    const workspace = contacted();
    const before = "2026-09-15T11:59:59.999Z",
      ready = "2026-09-15T12:00:00.000Z";
    for (const at of [now, next, before]) {
      const evaluated = evaluateProspect(workspace.prospects[0]!, workspace.campaign, at);
      expect(evaluated.eligible).toBe(false);
      expect(evaluated.reasons.join(" ")).toContain("Contact cooldown");
      expect(() => composeEmail(workspace.prospects[0]!, workspace.campaign, at)).toThrow(
        "cooldown",
      );
      expect(() => transition(workspace, { type: "approve", id: "p1" }, at)).toThrow("cooldown");
      expect(() =>
        transition(workspace, { type: "log-contact", id: "p1", channel: "other" }, at),
      ).toThrow("cooldown");
    }
    expect(evaluateProspect(workspace.prospects[0]!, workspace.campaign, ready).eligible).toBe(
      true,
    );
    expect(composeEmail(workspace.prospects[0]!, workspace.campaign, ready)).toContain("mailto:");
    const again = transition(workspace, { type: "log-contact", id: "p1", channel: "email" }, ready);
    expect(outboundCounters(again)).toMatchObject({ contacted: 1, contactRecords: 2 });
    expect(again.prospects[0]!.contactedAt).toBe(ready);
    expect(() => composeEmail(again.prospects[0]!, again.campaign, ready)).toThrow("cooldown");
  });
  test("reply and edits never bypass cooldown; conversion permanently blocks prospect outreach", () => {
    let workspace = transition(contacted(), { type: "log-reply", id: "p1" }, next);
    expect(() => composeEmail(workspace.prospects[0]!, workspace.campaign, next)).toThrow(
      "cooldown",
    );
    workspace = transition(
      workspace,
      { type: "edit-draft", id: "p1", subject: "Updated", body: "Updated message" },
      next,
    );
    expect(() => transition(workspace, { type: "approve", id: "p1" }, next)).toThrow("cooldown");
    const week = "2026-09-15T12:00:00Z";
    expect(() => composeEmail(workspace.prospects[0]!, workspace.campaign, week)).toThrow(
      "approve",
    );
    workspace = transition(workspace, { type: "approve", id: "p1" }, week);
    expect(workspace.prospects[0]!.stage).toBe("replied");
    expect(composeEmail(workspace.prospects[0]!, workspace.campaign, week)).toContain("mailto:");
    workspace = transition(workspace, { type: "log-conversion", id: "p1" }, week);
    workspace = transition(workspace, { type: "not-now", id: "p1" }, week);
    workspace = transition(workspace, { type: "draft", id: "p1" }, week);
    expect(evaluateProspect(workspace.prospects[0]!, workspace.campaign, week).eligible).toBe(
      false,
    );
    expect(() => transition(workspace, { type: "approve", id: "p1" }, week)).toThrow(
      "conversion is already recorded",
    );
  });
  test("reply/conversion requires prior contact and counters count only explicit records", () => {
    for (const type of ["log-reply", "log-conversion"] as const)
      expect(() => transition(approved(), { type, id: "p1" }, now)).toThrow("manual contact");
    let workspace = contacted();
    workspace = transition(
      workspace,
      { type: "log-reply", id: "p1", note: "They replied in my mail client." },
      next,
    );
    workspace = transition(
      workspace,
      { type: "log-conversion", id: "p1", note: "They agreed to try it." },
      next,
    );
    expect(outboundCounters(workspace)).toMatchObject({
      contacted: 1,
      replied: 1,
      converted: 1,
      contactRecords: 1,
    });
    expect(workspace.prospects[0]!.activities.at(-1)!.detail).toContain(
      "no payment or revenue is verified",
    );
    expect(() =>
      transition(
        workspace,
        { type: "log-contact", id: "p1", channel: "other" },
        "2026-09-20T12:00:00Z",
      ),
    ).toThrow("conversion is already recorded");
    expect(workspace.prospects[0]!.stage).toBe("converted");
  });
  test("follow-up is a manual date, not an automatic sender, and requires a prior contact", () => {
    expect(() =>
      transition(approved(), { type: "follow-up", id: "p1", date: "2026-09-10" }, now),
    ).toThrow("manual contact");
    let workspace = transition(
      contacted(),
      { type: "follow-up", id: "p1", date: "2026-09-10" },
      now,
    );
    expect(workspace.prospects[0]!.followUpOn).toBe("2026-09-10");
    expect(workspace.prospects[0]!.activities.at(-1)!.detail).toContain(
      "Nothing is scheduled to send",
    );
    expect(() =>
      transition(workspace, { type: "follow-up", id: "p1", date: "2026-09-07" }, now),
    ).toThrow("past");
    workspace = transition(workspace, { type: "follow-up", id: "p1", date: "" }, now);
    expect(workspace.prospects[0]!.followUpOn).toBeUndefined();
  });
  test("not-now clears approval and reminders; explicit draft editing reopens review", () => {
    const paused = transition(contacted(), { type: "not-now", id: "p1" }, now);
    expect(paused.prospects[0]!.approvedDigest).toBeUndefined();
    expect(evaluateProspect(paused.prospects[0]!, paused.campaign, now).eligible).toBe(false);
    expect(() => composeEmail(paused.prospects[0]!, paused.campaign, now)).toThrow("not now");
    expect(transition(paused, { type: "draft", id: "p1" }, now).prospects[0]!.stage).toBe("review");
  });
  test("suppression survives campaign changes, cannot be edited/reapproved/contacted or cleared", () => {
    const workspace = transition(
      contacted(),
      { type: "suppress", id: "p1", note: "Asked for no more contact." },
      now,
    );
    const commands: OutboundCommand[] = [
      { type: "draft", id: "p1" },
      { type: "approve", id: "p1" },
      { type: "compose", id: "p1" },
      { type: "edit", id: "p1", input: input({ email: "new@example.com" }) },
      { type: "edit-draft", id: "p1", subject: "Changed", body: "Changed" },
      { type: "log-contact", id: "p1", channel: "email" },
      { type: "log-reply", id: "p1" },
      { type: "log-conversion", id: "p1" },
      { type: "not-now", id: "p1" },
      { type: "follow-up", id: "p1", date: "2026-09-10" },
    ];
    for (const command of commands)
      expect(() => transition(workspace, command, next)).toThrow("permanent");
    const changed = transition(
      workspace,
      { type: "campaign", campaign: { ...workspace.campaign, offer: "Another offer" } },
      next,
    );
    expect(changed.prospects[0]).toEqual(workspace.prospects[0]);
    expect(evaluateProspect(changed.prospects[0]!, changed.campaign, next).grade).toBe(
      "suppressed",
    );
    expect(outboundCounters(changed)).toMatchObject({ contacted: 1, suppressed: 1 });
    expect(prospectSchema.safeParse({ ...changed.prospects[0]!, stage: "review" }).success).toBe(
      false,
    );
  });
  test("activity history is bounded without silently deleting earlier records", () => {
    let workspace = approved();
    while (workspace.prospects[0]!.activities.length < OUTBOUND_LIMITS.activities)
      workspace = transition(workspace, { type: "compose", id: "p1" }, now);
    const before = JSON.stringify(workspace);
    expect(() => transition(workspace, { type: "compose", id: "p1" }, now)).toThrow(
      "history is full",
    );
    expect(JSON.stringify(workspace)).toBe(before);
    expect(workspace.prospects[0]!.activities[0]!.type).toBe("created");
  });
  test("1,000 changed draft snapshots cannot reuse the approved message", () => {
    const workspace = approved(),
      prospect = workspace.prospects[0]!;
    for (let i = 0; i < 1000; i++) {
      const changed = { ...prospect, body: `${prospect.body}\nRevision ${i}` };
      expect(evaluateProspect(changed, workspace.campaign, now).approvalCurrent).toBe(false);
      expect(() => composeEmail(changed, workspace.campaign, now)).toThrow("approve");
    }
  });
});

describe("bounded CSV import/export", () => {
  test("parses BOM, quoted commas, escaped quotes, multiline notes and CRLF", () => {
    const document = `\uFEFF${csv([[...PROSPECT_CSV_FIELDS], ["Alex", "Studio, Inc.", "alex@example.com", "https://studio.example", "Product", 'A "ceramics" series', "https://studio.example/work", "2026-09-08", "Product work", "First line\nSecond line"]])}`;
    const rows = parseProspectCsv(document);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      company: "Studio, Inc.",
      signal: 'A "ceramics" series',
      notes: "First line\nSecond line",
    });
  });
  test("allows a minimal name-only CSV and ignores exported workflow claims", () => {
    expect(parseProspectCsv("name\nAlex\n")[0]!.name).toBe("Alex");
    const imported = parseProspectCsv(
      csv([
        ["name", "stage", "contactedAt"],
        ["Alex", "converted", now],
      ]),
    );
    const workspace = transition(
      desk(),
      { type: "import", entries: imported.map((p, i) => ({ id: `p${i}`, input: p })) },
      now,
    );
    expect(workspace.prospects[0]!.stage).toBe("new");
    expect(outboundCounters(workspace).converted).toBe(0);
  });
  test("rejects malformed quoting, unknown/duplicate headers, widths and invalid rows", () => {
    for (const document of [
      'name\n"unclosed',
      'name\n"Alex" trailing',
      'name\nAl"ex',
      "name,name\nAlex,Jo",
      "name,unexpected\nAlex,x",
      "email\na@example.com",
      "name,email\nAlex",
      "name,email\nAlex,a,b",
      "name,email\nAlex,bad-email",
    ])
      expect(() => parseProspectCsv(document)).toThrow();
    expect(() => parseProspectCsv("name,email\nAlex,bad-email")).toThrow("CSV row 2");
  });
  test("caps UTF-8 bytes and logical records, not physical multiline rows", () => {
    expect(() => parseProspectCsv(`name\n${"a".repeat(OUTBOUND_LIMITS.csvBytes)}`)).toThrow("2 MB");
    expect(() => parseProspectCsv(`name\n${"🙂".repeat(600000)}`)).toThrow("2 MB");
    const thousand = `name\n${Array.from({ length: 1000 }, (_, i) => `Prospect ${i}`).join("\n")}`;
    expect(parseProspectCsv(thousand)).toHaveLength(1000);
    expect(() => parseProspectCsv(`${thousand}\nExtra`)).toThrow("1,000");
    expect(
      parseProspectCsv(
        csv([
          ["name", "notes"],
          ["Alex", "\n".repeat(1500) + "note"],
        ]),
      ),
    ).toHaveLength(1);
  });
  test("duplicate/cap failures make a whole import atomic", () => {
    const workspace = added(),
      before = JSON.stringify(workspace);
    expect(() =>
      transition(
        workspace,
        {
          type: "import",
          entries: [
            {
              id: "p2",
              input: input({ email: "new@example.com", website: "https://new.example" }),
            },
            { id: "p3", input: input() },
          ],
        },
        now,
      ),
    ).toThrow("already exists");
    expect(JSON.stringify(workspace)).toBe(before);
    const entries = Array.from({ length: 1001 }, (_, i) => ({
      id: `p${i}`,
      input: prospectInputSchema.parse({ name: `Prospect ${i}` }),
    }));
    expect(() => transition(desk(), { type: "import", entries }, now)).toThrow("1,000");
  });
  test("safe exports escape formulas, quotes and newlines without changing stored data", () => {
    for (const value of [
      "=1+1",
      "+SUM(A1)",
      "-1+1",
      "@SUM(A1)",
      "  =SUM(A1)",
      "\tformula",
      "\nformula",
    ])
      expect(safeCsvCell(value).startsWith("\"'")).toBe(true);
    expect(safeCsvCell('A "quote"')).toBe('"A ""quote"""');
    const workspace = added({ notes: '=HYPERLINK("https://example.com")\nsecond line' });
    const before = JSON.stringify(workspace),
      exported = exportProspectCsv(workspace.prospects);
    expect(exported).toContain('"\'=HYPERLINK(""https://example.com"")\nsecond line"');
    expect(JSON.stringify(workspace)).toBe(before);
    const imported = parseProspectCsv(exported);
    expect(imported).toHaveLength(1);
    expect(imported[0]!.notes.startsWith("'")).toBe(true);
  });
});

test("1,000 varied deterministic workflow cases preserve evidence, approval, cooldown, suppression and CSV boundaries", () => {
  const dayMs = 86400000,
    week = "2026-09-15T12:00:00.000Z";
  let freshCases = 0,
    staleCases = 0,
    contactCases = 0;
  for (let i = 0; i < 1000; i++) {
    const age = i % 41,
      hasEmail = i % 5 !== 0;
    const facts = input({
      name: `Photographer ${i}`,
      company: `Studio ${i}, "Independent"`,
      email: hasEmail ? `photographer${i}@example.com` : "",
      website: `https://instagram.com/photographer${i}/`,
      specialty: ["Product", "Portrait", "Real estate", "Wedding"][i % 4]!,
      observedOn: new Date(Date.parse(now) - age * dayMs).toISOString().slice(0, 10),
      notes: `Case ${i}\nEntered by the user`,
    });
    let workspace = transition(desk(), { type: "add", id: `p${i}`, input: facts }, now);
    const id = `p${i}`;
    workspace = transition(workspace, { type: "draft", id }, now);
    expect(() => composeEmail(workspace.prospects[0]!, workspace.campaign, now)).toThrow();
    const evidence = evaluateProspect(workspace.prospects[0]!, workspace.campaign, now);
    expect(evidence.eligible).toBe(age <= 30);
    if (age <= 30) {
      freshCases++;
      workspace = transition(workspace, { type: "approve", id }, now);
      expect(evaluateProspect(workspace.prospects[0]!, workspace.campaign, now).canCompose).toBe(
        hasEmail,
      );
      if (hasEmail) {
        workspace = transition(workspace, { type: "compose", id }, now);
        expect(outboundCounters(workspace).contacted).toBe(0);
      }
      workspace = transition(
        workspace,
        { type: "edit", id, input: { ...facts, notes: `${facts.notes}\nReviewed` } },
        now,
      );
      expect(workspace.prospects[0]!.approvedDigest).toBeUndefined();
      expect(() => composeEmail(workspace.prospects[0]!, workspace.campaign, now)).toThrow(
        "approve",
      );
      workspace = transition(workspace, { type: "approve", id }, now);
      workspace = transition(
        workspace,
        { type: "log-contact", id, channel: hasEmail ? "email" : "other" },
        now,
      );
      contactCases++;
      expect(outboundCounters(workspace).contacted).toBe(1);
      expect(
        evaluateProspect(workspace.prospects[0]!, workspace.campaign, next).reasons.join(" "),
      ).toContain("cooldown");
      if (i % 4 === 0) workspace = transition(workspace, { type: "log-reply", id }, next);
      if (i % 7 === 0) {
        workspace = transition(workspace, { type: "log-conversion", id }, week);
        expect(() => transition(workspace, { type: "approve", id }, week)).toThrow("conversion");
      } else {
        expect(evaluateProspect(workspace.prospects[0]!, workspace.campaign, week).eligible).toBe(
          age <= 23,
        );
        if (age <= 23) {
          workspace = transition(
            workspace,
            { type: "log-contact", id, channel: hasEmail ? "email" : "other" },
            week,
          );
          expect(outboundCounters(workspace).contactRecords).toBe(2);
        }
      }
    } else {
      staleCases++;
      expect(evidence.grade).toBe("stale");
      expect(() => transition(workspace, { type: "approve", id }, now)).toThrow(
        "older than 30 days",
      );
      expect(outboundCounters(workspace).contacted).toBe(0);
    }
    if (i % 3 === 0) {
      workspace = transition(workspace, { type: "suppress", id }, week);
      expect(() => transition(workspace, { type: "draft", id }, week)).toThrow("permanent");
      expect(() =>
        transition(workspace, { type: "add", id: `${id}-again`, input: facts }, week),
      ).toThrow("already exists");
    }
    if (i % 5 === 0) {
      workspace = transition(
        workspace,
        { type: "campaign", campaign: { ...workspace.campaign, cta: `Revised invitation ${i}` } },
        week,
      );
      expect(workspace.prospects[0]!.approvedDigest).toBeUndefined();
    }
    const exported = parseProspectCsv(exportProspectCsv(workspace.prospects));
    expect(exported[0]!.name).toBe(facts.name);
    expect(exported[0]!.company).toBe(facts.company);
    expect(exported[0]!.sourceUrl).toBe(facts.sourceUrl);
    expect(exported[0]).not.toHaveProperty("stage");
    expect(outboundSchema.parse(workspace)).toEqual(workspace);
  }
  expect({ freshCases, staleCases, contactCases }).toEqual({
    freshCases: 760,
    staleCases: 240,
    contactCases: 760,
  });
});
