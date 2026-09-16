import { z } from "zod";

export const OUTBOUND_LIMITS = Object.freeze({
  prospects: 1000,
  csvBytes: 2 * 1024 * 1024,
  activities: 500,
  evidenceDays: 30,
  contactCooldownDays: 7,
});
const line = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    // eslint-disable-next-line no-control-regex -- Reject header injection and non-printable controls in single-line fields.
    .regex(/^[^\u0000-\u001f\u007f]*$/, "Use a single line without control characters.");
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine(
      // eslint-disable-next-line no-control-regex -- Multiline copy permits tab/CR/LF, but never NUL or other control characters.
      (s) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(s),
      "Remove control characters.",
    );
const idSchema = line(100).min(1);
const instantSchema = z.string().datetime({ offset: true });
function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
const dateSchema = z.string().refine(validDate, "Use a real date in YYYY-MM-DD format.");
const maybeDateSchema = z.union([dateSchema, z.literal("")]);
const webSchema = line(2048).refine((value) => {
  if (!value) return true;
  try {
    const url = new URL(value);
    return (
      ["http:", "https:"].includes(url.protocol) && !!url.hostname && !url.username && !url.password
    );
  } catch {
    return false;
  }
}, "Use an http:// or https:// URL without embedded credentials.");

export const campaignSchema = z
  .object({
    senderName: line(100),
    offer: text(2000),
    cta: text(500),
    signature: text(500),
  })
  .strict();
export type Campaign = z.infer<typeof campaignSchema>;

export const prospectInputSchema = z
  .object({
    name: line(200).refine(Boolean, "Add a prospect name."),
    company: line(200).default(""),
    email: z.union([line(254).email(), z.literal("")]).optional(),
    website: webSchema.optional(),
    specialty: line(120).default(""),
    signal: text(2000).default(""),
    sourceUrl: webSchema.default(""),
    observedOn: maybeDateSchema.default(""),
    fitReason: text(1000).default(""),
    notes: text(4000).default(""),
  })
  .strict();
export type ProspectInput = z.infer<typeof prospectInputSchema>;
export const outboundStages = [
  "new",
  "review",
  "approved",
  "contacted",
  "replied",
  "converted",
  "not-now",
  "suppressed",
] as const;
export const prospectStageSchema = z.enum(outboundStages);
export type ProspectStage = z.infer<typeof prospectStageSchema>;
export const activitySchema = z
  .object({
    id: line(120).min(1),
    type: z.enum([
      "created",
      "edited",
      "drafted",
      "approved",
      "composer-opened",
      "contact-logged",
      "reply-logged",
      "conversion-logged",
      "not-now",
      "suppressed",
      "follow-up-set",
      "campaign-changed",
    ]),
    at: instantSchema,
    detail: text(2000),
  })
  .strict();
export type OutboundActivity = z.infer<typeof activitySchema>;
export type ProspectActivity = OutboundActivity;
const prospectObjectSchema = prospectInputSchema
  .extend({
    id: idSchema,
    createdAt: instantSchema,
    updatedAt: instantSchema,
    stage: prospectStageSchema,
    subject: line(200),
    body: text(8000),
    // This is an exact canonical snapshot, not a probabilistic/security hash.
    approvedDigest: z.string().max(65536).optional(),
    contactedAt: instantSchema.optional(),
    followUpOn: dateSchema.optional(),
    activities: z.array(activitySchema).min(1).max(OUTBOUND_LIMITS.activities),
  })
  .strict();
export const prospectSchema = prospectObjectSchema.superRefine((p, ctx) => {
  const add = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  if (Date.parse(p.createdAt) > Date.parse(p.updatedAt))
    add("Updated time cannot precede creation.");
  if (new Set(p.activities.map((a) => a.id)).size !== p.activities.length)
    add("Activity IDs must be unique.");
  let previous = Date.parse(p.createdAt),
    lastContact: string | undefined;
  for (const activity of p.activities) {
    const at = Date.parse(activity.at);
    if (at < previous || at > Date.parse(p.updatedAt))
      add("Activity times must be ordered within the prospect history.");
    previous = at;
    if (activity.type === "contact-logged") lastContact = activity.at;
    if (["reply-logged", "conversion-logged"].includes(activity.type) && !lastContact)
      add("A reply or conversion cannot precede its manual contact record.");
  }
  const has = (type: OutboundActivity["type"]) => p.activities.some((a) => a.type === type);
  if (p.activities[0]?.type !== "created") add("A prospect must begin with a creation record.");
  if (!!p.contactedAt !== has("contact-logged"))
    add("Contact time must correspond to a manual contact record.");
  if (lastContact !== p.contactedAt)
    add("Contact time must match the latest manual contact record.");
  if (
    p.contactedAt &&
    (Date.parse(p.contactedAt) < Date.parse(p.createdAt) ||
      Date.parse(p.contactedAt) > Date.parse(p.updatedAt))
  )
    add("Contact time must be within the prospect history.");
  if (["contacted", "replied", "converted"].includes(p.stage) && !p.contactedAt)
    add("This stage requires a prior manual contact record.");
  if ((has("reply-logged") || has("conversion-logged")) && !p.contactedAt)
    add("Replies and conversions require prior contact.");
  if (p.stage === "replied" && !has("reply-logged")) add("A replied stage needs a reply record.");
  if (p.stage === "converted" && !has("conversion-logged"))
    add("A converted stage needs a conversion record.");
  if (p.stage === "approved" && !p.approvedDigest)
    add("An approved stage needs an approval snapshot.");
  if (p.approvedDigest && !has("approved")) add("An approval snapshot needs an approval record.");
  if ((p.stage === "suppressed") !== has("suppressed"))
    add("Suppression is permanent in this version.");
  if (p.stage === "suppressed" && (p.approvedDigest || p.followUpOn))
    add("A suppressed prospect cannot retain approval or a follow-up reminder.");
});
export type Prospect = z.infer<typeof prospectSchema>;

export function normalizeEmail(email?: string): string {
  return email?.trim().toLowerCase() ?? "";
}
/** Company sites deduplicate by host; shared social hosts retain profile identity. */
export function canonicalWebsite(website?: string): string {
  if (!website?.trim()) return "";
  const parsed = webSchema.parse(website),
    url = new URL(parsed);
  let host = url.hostname
    .toLowerCase()
    .replace(/^www\./, "")
    .replace(/\.$/, "");
  const aliases: Record<string, string> = {
    "twitter.com": "x.com",
    "m.facebook.com": "facebook.com",
    "m.instagram.com": "instagram.com",
    "m.youtube.com": "youtube.com",
    "threads.net": "threads.com",
  };
  host = aliases[host] ?? host;
  const social = new Set([
    "instagram.com",
    "facebook.com",
    "x.com",
    "youtube.com",
    "behance.net",
    "flickr.com",
    "500px.com",
    "pinterest.com",
    "threads.com",
    "tiktok.com",
    "vimeo.com",
    "linkedin.com",
    "dribbble.com",
  ]);
  const authority = `${host}${url.port ? `:${url.port}` : ""}`;
  if (!social.has(host)) return authority;
  const parts = url.pathname
    .split("/")
    .filter(Boolean)
    .map((part) => {
      try {
        return decodeURIComponent(part);
      } catch {
        return part;
      }
    });
  let profile = parts[0] ?? "";
  if (["instagram.com", "facebook.com", "x.com", "threads.com", "tiktok.com"].includes(host))
    profile = profile.toLowerCase();
  if (host === "facebook.com" && profile === "profile.php")
    profile += `?id=${url.searchParams.get("id") ?? ""}`;
  else if (
    (host === "youtube.com" && ["channel", "c", "user"].includes(profile)) ||
    (host === "linkedin.com" && ["in", "company"].includes(profile)) ||
    (host === "flickr.com" && ["people", "photos"].includes(profile))
  )
    profile += parts[1] ? `/${parts[1]}` : "";
  else if (host === "facebook.com" && profile === "pages")
    profile += `/${parts.slice(1, 3).join("/")}`;
  return profile ? `${authority}/${profile}` : authority;
}
export function findDuplicate(
  prospects: readonly Prospect[],
  input: ProspectInput,
  exceptId?: string,
): Prospect | undefined {
  const email = normalizeEmail(input.email),
    website = canonicalWebsite(input.website);
  return prospects.find(
    (p) =>
      p.id !== exceptId &&
      ((email && normalizeEmail(p.email) === email) ||
        (website && canonicalWebsite(p.website) === website)),
  );
}
export const outboundSchema = z
  .object({
    version: z.literal(1),
    campaign: campaignSchema,
    prospects: z.array(prospectSchema).max(OUTBOUND_LIMITS.prospects),
  })
  .strict()
  .superRefine((workspace, ctx) => {
    const ids = new Set<string>(),
      emails = new Set<string>(),
      websites = new Set<string>();
    for (const prospect of workspace.prospects) {
      const email = normalizeEmail(prospect.email),
        website = canonicalWebsite(prospect.website);
      if (
        ids.has(prospect.id) ||
        (email && emails.has(email)) ||
        (website && websites.has(website))
      )
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Duplicate prospect ID, email or company website.",
        });
      ids.add(prospect.id);
      if (email) emails.add(email);
      if (website) websites.add(website);
    }
  });
export type OutboundWorkspace = z.infer<typeof outboundSchema>;
export function emptyOutbound(): OutboundWorkspace {
  return {
    version: 1,
    campaign: {
      senderName: "",
      offer:
        "I'm building Celinen, a local-first photography workspace, and would value your feedback.",
      cta: "Would you be open to a short conversation?",
      signature: "",
    },
    prospects: [],
  };
}
function prospectInput(prospect: Prospect): ProspectInput {
  const {
    name,
    company,
    email,
    website,
    specialty,
    signal,
    sourceUrl,
    observedOn,
    fitReason,
    notes,
  } = prospect;
  return prospectInputSchema.parse({
    name,
    company,
    email,
    website,
    specialty,
    signal,
    sourceUrl,
    observedOn,
    fitReason,
    notes,
  });
}
export function approvalFingerprint(prospect: Prospect, campaign: Campaign): string {
  return JSON.stringify({
    input: prospectInput(prospect),
    campaign: campaignSchema.parse(campaign),
    subject: prospect.subject,
    body: prospect.body,
  });
}
function instant(value: string): string {
  return instantSchema.parse(value);
}
function today(now: string): string {
  return new Date(instant(now)).toISOString().slice(0, 10);
}

export type ProspectEvaluation = {
  grade: "ready" | "needs-evidence" | "stale" | "suppressed";
  eligible: boolean;
  reasons: string[];
  canCompose: boolean;
  approvalCurrent: boolean;
};
/** A checklist, not an AI score, conversion forecast, or independent fact verification. */
export function evaluateProspect(
  prospect: Prospect,
  campaign: Campaign,
  now: string,
): ProspectEvaluation {
  const p = prospectSchema.parse(prospect),
    c = campaignSchema.parse(campaign),
    day = today(now);
  const reasons: string[] = [];
  if (!p.signal) reasons.push("Add an observed signal.");
  if (!p.fitReason) reasons.push("Explain why this prospect fits the offer.");
  if (!p.sourceUrl) reasons.push("Add a source URL for the observed signal.");
  if (!p.observedOn) reasons.push("Add the observation date.");
  const missingEvidence = reasons.length > 0;
  const age = p.observedOn
    ? (Date.parse(`${day}T00:00:00Z`) - Date.parse(`${p.observedOn}T00:00:00Z`)) / 86400000
    : null;
  const stale = age !== null && (age < 0 || age > OUTBOUND_LIMITS.evidenceDays);
  if (age !== null && age < 0) reasons.push("The observation date is in the future.");
  if (age !== null && age > OUTBOUND_LIMITS.evidenceDays)
    reasons.push("Recheck the evidence; it is older than 30 days.");
  if (!c.senderName || !c.offer || !c.cta)
    reasons.push("Complete the sender name, offer and call to action.");
  if (!p.subject || !p.body) reasons.push("Prepare and review a subject and message.");
  if (p.stage === "not-now")
    reasons.push("Marked not now. Edit or regenerate the draft to reopen review.");
  if (p.stage === "suppressed") reasons.push("This prospect is permanently suppressed.");
  if (p.activities.some((a) => a.type === "conversion-logged"))
    reasons.push("A conversion is already recorded. Further prospect outreach is blocked.");
  if (p.contactedAt) {
    const availableAt = Date.parse(p.contactedAt) + OUTBOUND_LIMITS.contactCooldownDays * 86400000;
    if (Date.parse(now) < availableAt)
      reasons.push(
        `Contact cooldown: wait seven days after the last recorded contact, until ${new Date(availableAt).toISOString()}.`,
      );
  }
  const eligible = reasons.length === 0;
  const approvalCurrent = !!p.approvedDigest && p.approvedDigest === approvalFingerprint(p, c);
  return {
    grade:
      p.stage === "suppressed"
        ? "suppressed"
        : missingEvidence
          ? "needs-evidence"
          : stale
            ? "stale"
            : "ready",
    eligible,
    reasons,
    approvalCurrent,
    canCompose: eligible && approvalCurrent && !!normalizeEmail(p.email),
  };
}

export function prepareDraft(
  input: ProspectInput,
  campaign: Campaign,
): { subject: string; body: string } {
  const p = prospectInputSchema.parse(input),
    c = campaignSchema.parse(campaign);
  const parts = [
    `Hi ${p.name},`,
    p.signal ? `I noticed: ${p.signal}` : "",
    p.fitReason ? `I thought of you because ${p.fitReason}` : "",
    c.offer,
    c.cta,
    c.signature || c.senderName,
  ].filter(Boolean);
  return {
    subject: `A question for ${p.company || p.name}`.slice(0, 200),
    body: text(8000).parse(parts.join("\n\n")),
  };
}
function requireApproved(p: Prospect, campaign: Campaign, now: string, email: boolean): void {
  const result = evaluateProspect(p, campaign, now);
  if (!result.eligible) throw new Error(result.reasons.join(" "));
  if (!result.approvalCurrent)
    throw new Error("Review and approve the current draft before continuing.");
  if (email && !normalizeEmail(p.email))
    throw new Error("Add a valid email address before opening an email draft.");
}
/** Opens a user's mail client only. It neither sends nor confirms delivery. */
export function composeEmail(prospect: Prospect, campaign: Campaign, now: string): string {
  requireApproved(prospect, campaign, now, true);
  return `mailto:${encodeURIComponent(normalizeEmail(prospect.email))}?subject=${encodeURIComponent(prospect.subject)}&body=${encodeURIComponent(prospect.body)}`;
}

export type OutboundCommand =
  | { type: "add"; id: string; input: ProspectInput }
  | { type: "import"; entries: { id: string; input: ProspectInput }[] }
  | { type: "edit"; id: string; input: ProspectInput }
  | { type: "draft" | "approve" | "compose"; id: string }
  | { type: "edit-draft"; id: string; subject: string; body: string }
  | { type: "log-contact"; id: string; channel: "email" | "other"; note?: string }
  | { type: "log-reply" | "log-conversion" | "not-now" | "suppress"; id: string; note?: string }
  | { type: "follow-up"; id: string; date: string }
  | { type: "campaign"; campaign: Campaign };

function activity(p: Prospect, type: OutboundActivity["type"], now: string, detail: string): void {
  if (Date.parse(now) < Date.parse(p.updatedAt))
    throw new Error("The operation time cannot precede the latest record.");
  if (p.activities.length >= OUTBOUND_LIMITS.activities)
    throw new Error("This prospect's activity history is full. Existing records were preserved.");
  p.updatedAt = now;
  p.activities.push(
    activitySchema.parse({ id: `${p.id}:${p.activities.length + 1}`, type, at: now, detail }),
  );
}
function invalidate(p: Prospect): void {
  delete p.approvedDigest;
  if (["new", "review", "approved", "not-now"].includes(p.stage)) p.stage = "review";
}
function addProspect(
  workspace: OutboundWorkspace,
  id: string,
  input: ProspectInput,
  now: string,
): void {
  idSchema.parse(id);
  const parsed = prospectInputSchema.parse(input);
  if (workspace.prospects.length >= OUTBOUND_LIMITS.prospects)
    throw new Error("This desk is limited to 1,000 prospects.");
  if (workspace.prospects.some((p) => p.id === id) || findDuplicate(workspace.prospects, parsed))
    throw new Error(
      "A prospect with this ID, email or company website already exists, including suppressed records.",
    );
  workspace.prospects.push(
    prospectSchema.parse({
      ...parsed,
      id,
      createdAt: now,
      updatedAt: now,
      stage: "new",
      subject: "",
      body: "",
      activities: [
        { id: `${id}:1`, type: "created", at: now, detail: "Added locally. No message was sent." },
      ],
    }),
  );
}
/** Validates and clones first; a failed command never partly changes caller state. */
export function transition(
  workspace: OutboundWorkspace,
  command: OutboundCommand,
  now: string,
): OutboundWorkspace {
  const result = outboundSchema.parse(workspace),
    at = instant(now);
  if (command.type === "campaign") {
    const campaign = campaignSchema.parse(command.campaign);
    if (JSON.stringify(campaign) === JSON.stringify(result.campaign)) return result;
    result.campaign = campaign;
    for (const p of result.prospects) {
      // Suppression cannot be cleared or reopened by a campaign change.
      if (p.stage === "suppressed") continue;
      invalidate(p);
      activity(
        p,
        "campaign-changed",
        at,
        "Campaign changed. Review the draft and approve it again.",
      );
    }
  } else if (command.type === "add") {
    addProspect(result, command.id, command.input, at);
  } else if (command.type === "import") {
    if (!command.entries.length || command.entries.length > OUTBOUND_LIMITS.prospects)
      throw new Error("Import between 1 and 1,000 prospects.");
    for (const entry of command.entries) addProspect(result, entry.id, entry.input, at);
  } else {
    const p = result.prospects.find((entry) => entry.id === command.id);
    if (!p) throw new Error("Prospect not found in this desk.");
    if (p.stage === "suppressed")
      throw new Error(
        "Suppression is permanent in this version. This prospect cannot be contacted or restored.",
      );
    const note = "note" in command ? text(1500).parse(command.note ?? "") : "";
    switch (command.type) {
      case "edit": {
        const input = prospectInputSchema.parse(command.input);
        if (findDuplicate(result.prospects, input, p.id))
          throw new Error("Another prospect already uses this email or company website.");
        Object.assign(p, input);
        // Full input replacement also clears removed optional contact fields.
        if (input.email === undefined) delete p.email;
        if (input.website === undefined) delete p.website;
        invalidate(p);
        activity(p, "edited", at, "Prospect details changed. Approval cleared.");
        break;
      }
      case "draft":
        Object.assign(p, prepareDraft(prospectInput(p), result.campaign));
        invalidate(p);
        activity(p, "drafted", at, "Draft prepared from supplied facts only. No message was sent.");
        break;
      case "edit-draft":
        p.subject = line(200).parse(command.subject);
        p.body = text(8000).parse(command.body);
        invalidate(p);
        activity(p, "edited", at, "Draft edited. Approval cleared.");
        break;
      case "approve": {
        const evaluation = evaluateProspect(p, result.campaign, at);
        if (!evaluation.eligible) throw new Error(evaluation.reasons.join(" "));
        p.approvedDigest = approvalFingerprint(p, result.campaign);
        p.stage = !p.contactedAt
          ? "approved"
          : p.activities.some((a) => a.type === "reply-logged")
            ? "replied"
            : "contacted";
        activity(
          p,
          "approved",
          at,
          "Current evidence, campaign and draft approved by the user. No message was sent.",
        );
        break;
      }
      case "compose":
        requireApproved(p, result.campaign, at, true);
        activity(
          p,
          "composer-opened",
          at,
          "Email draft prepared for the user's mail client. Sending and delivery are not verified.",
        );
        break;
      case "log-contact":
        if (!["email", "other"].includes(command.channel))
          throw new Error("Choose an email or other manual contact channel.");
        requireApproved(p, result.campaign, at, command.channel === "email");
        p.contactedAt = at;
        if (!["replied", "converted"].includes(p.stage)) p.stage = "contacted";
        activity(
          p,
          "contact-logged",
          at,
          `User recorded manual ${command.channel} contact. Delivery is not verified.${note ? ` ${note}` : ""}`,
        );
        break;
      case "log-reply":
      case "log-conversion":
        if (!p.contactedAt)
          throw new Error("Record a manual contact before a reply or conversion.");
        if (command.type === "log-reply") {
          if (p.stage !== "converted") p.stage = "replied";
          activity(p, "reply-logged", at, `User recorded a reply.${note ? ` ${note}` : ""}`);
        } else {
          p.stage = "converted";
          activity(
            p,
            "conversion-logged",
            at,
            `User recorded a conversion; no payment or revenue is verified.${note ? ` ${note}` : ""}`,
          );
        }
        break;
      case "not-now":
        p.stage = "not-now";
        delete p.approvedDigest;
        delete p.followUpOn;
        activity(p, "not-now", at, note || "Paused by the user. No further contact is approved.");
        break;
      case "suppress":
        p.stage = "suppressed";
        delete p.approvedDigest;
        delete p.followUpOn;
        activity(p, "suppressed", at, note || "Permanently suppressed from outreach in this desk.");
        break;
      case "follow-up": {
        if (!p.contactedAt)
          throw new Error("Record a manual contact before scheduling a follow-up.");
        if (command.date) {
          const date = dateSchema.parse(command.date);
          if (date < today(at)) throw new Error("A new follow-up date cannot be in the past.");
          p.followUpOn = date;
        } else delete p.followUpOn;
        activity(
          p,
          "follow-up-set",
          at,
          command.date
            ? `Manual reminder set for ${command.date}. Nothing is scheduled to send.`
            : "Manual follow-up reminder cleared.",
        );
        break;
      }
      default:
        throw new Error("Unknown outbound command.");
    }
  }
  return outboundSchema.parse(result);
}

export function outboundCounters(workspace: OutboundWorkspace): {
  total: number;
  approved: number;
  contacted: number;
  replied: number;
  converted: number;
  suppressed: number;
  contactRecords: number;
} {
  const { prospects } = outboundSchema.parse(workspace);
  const count = (type: OutboundActivity["type"]) =>
    prospects.filter((p) => p.activities.some((a) => a.type === type)).length;
  return {
    total: prospects.length,
    approved: prospects.filter((p) => p.stage === "approved").length,
    contacted: count("contact-logged"),
    replied: count("reply-logged"),
    converted: count("conversion-logged"),
    suppressed: count("suppressed"),
    contactRecords: prospects.reduce(
      (sum, p) => sum + p.activities.filter((a) => a.type === "contact-logged").length,
      0,
    ),
  };
}

export const PROSPECT_CSV_FIELDS = [
  "name",
  "company",
  "email",
  "website",
  "specialty",
  "signal",
  "sourceUrl",
  "observedOn",
  "fitReason",
  "notes",
] as const;
const exportFields = [
  ...PROSPECT_CSV_FIELDS,
  "stage",
  "subject",
  "body",
  "contactedAt",
  "followUpOn",
] as const;
/** RFC4180-style quoted cells, including escaped quotes/newlines. Workflow columns are deliberately never imported as approval/contact proof. */
export function parseProspectCsv(source: string): ProspectInput[] {
  if (
    source.length > OUTBOUND_LIMITS.csvBytes ||
    new TextEncoder().encode(source).length > OUTBOUND_LIMITS.csvBytes
  )
    throw new Error("CSV must be 2 MB or smaller.");
  source = source.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false,
    closed = false;
  const field = () => {
    row.push(cell);
    cell = "";
    closed = false;
    if (row.length > exportFields.length) throw new Error("CSV has too many columns.");
  };
  const record = () => {
    field();
    if (row.some((value) => value.trim())) rows.push(row);
    row = [];
    if (rows.length > OUTBOUND_LIMITS.prospects + 1)
      throw new Error("CSV may contain at most 1,000 prospects.");
  };
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]!;
    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else cell += ch;
      continue;
    }
    if (ch === ",") {
      field();
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && source[i + 1] === "\n") i++;
      record();
      continue;
    }
    if (closed) throw new Error("Unexpected text after a quoted CSV cell.");
    if (ch === '"') {
      if (cell) throw new Error("A CSV quote must begin at the start of a cell.");
      quoted = true;
    } else cell += ch;
  }
  if (quoted) throw new Error("CSV contains an unclosed quoted cell.");
  if (cell || row.length || closed) record();
  const header = rows.shift()?.map((value) => value.trim());
  if (!header?.includes("name")) throw new Error("CSV needs a name column.");
  if (
    new Set(header).size !== header.length ||
    header.some((key) => !exportFields.includes(key as (typeof exportFields)[number]))
  )
    throw new Error("CSV has duplicate or unknown column names. Use the supplied template.");
  return rows.map((values, index) => {
    if (values.length !== header.length)
      throw new Error(`CSV row ${index + 2} has the wrong number of columns.`);
    const input = Object.fromEntries(
      header.flatMap((key, column) =>
        PROSPECT_CSV_FIELDS.includes(key as (typeof PROSPECT_CSV_FIELDS)[number])
          ? [[key, values[column]]]
          : [],
      ),
    );
    const parsed = prospectInputSchema.safeParse(input);
    if (!parsed.success)
      throw new Error(
        `CSV row ${index + 2}: ${parsed.error.issues[0]?.message ?? "Invalid prospect."}`,
      );
    return parsed.data;
  });
}
export function safeCsvCell(value: string): string {
  const safe = /^[\s]*[=+\-@]/.test(value) || /^[\t\r\n]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}
export function exportProspectCsv(prospects: readonly Prospect[]): string {
  const parsed = z.array(prospectSchema).max(OUTBOUND_LIMITS.prospects).parse(prospects);
  return [
    exportFields.map(safeCsvCell).join(","),
    ...parsed.map((p) => exportFields.map((key) => safeCsvCell(p[key] ?? "")).join(",")),
  ].join("\r\n");
}
