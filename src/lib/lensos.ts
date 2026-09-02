/**
 * LensLabs production data model + seeded mock job.
 * Pick (the cull studio) is treated as already shipped; this models everything around it.
 */

export type FieldSource =
  | "original"
  | "event"
  | "template"
  | "detection"
  | "accepted"
  | "manual";

export type PackageState =
  | "planned"
  | "selecting"
  | "selects ready"
  | "in Lightroom"
  | "edits returning"
  | "metadata check"
  | "export ready"
  | "awaiting approval"
  | "exporting"
  | "uploading"
  | "delivered";

export const PACKAGE_STATES: PackageState[] = [
  "planned",
  "selecting",
  "selects ready",
  "in Lightroom",
  "edits returning",
  "metadata check",
  "export ready",
  "awaiting approval",
  "exporting",
  "uploading",
  "delivered",
];

export type IngestState =
  | "source waiting"
  | "permission needed"
  | "enumerating"
  | "indexing previews"
  | "queue ready"
  | "ingest complete";

export interface Source {
  id: string;
  label: string;
  kind: "card" | "folder" | "drive";
  state: IngestState;
  files: number;
  previews: number;
  duplicates: number;
  unsupported: number;
  lowDisk: boolean;
  verifying: boolean;
}

export interface MetaField {
  value: string;
  source: FieldSource;
}

export interface Suggestion {
  field: string;
  value: string;
  confidence: number;
  status: "open" | "accepted" | "rejected";
}

export interface Pick {
  id: string;
  frame: string;
  packageId: string | null;
  approved: boolean;
  fields: Record<string, MetaField>;
  suggestions: Suggestion[];
}

export interface Package {
  id: string;
  name: string;
  deadline: string;
  target: number;
  requirements: string[];
  preset: string;
  destination: string;
  recipient: string;
  state: PackageState;
}

export interface Receipt {
  id: string;
  packageId: string;
  revision: number;
  at: string;
  recipient: string;
  destination: string;
  files: number;
  preset: string;
}

export interface Money {
  agreedRevenue: number | null;
  invoiced: number | null;
  collected: number | null;
  estimatedCosts: number | null;
  actualCosts: number | null;
  source: "manual" | "imported" | null;
}

export interface EventJob {
  id: string;
  name: string;
  genre: string;
  venue: string;
  start: string;
  clientId: string;
  status: "draft" | "active" | "delivered";
  deadlines: { label: string; at: string }[];
  sources: Source[];
  packages: Package[];
  picks: Pick[];
  pickQueue: { reviewed: number; total: number; selects: number; rejects: number };
  lightroom: { handoff: boolean; returns: number; conflicts: number };
  receipts: Receipt[];
  offline: boolean;
  metrics: { ingested: number; reviewed: number; workMinutes: number };
  money: Money;
  gallery: { link: string | null; pin: string | null; favorites: number };
}

export interface Client {
  id: string;
  name: string;
  org: string;
  contacts: { name: string; email: string }[];
  template: string;
  destination: string;
}

export const CLIENTS: Client[] = [
  {
    id: "c-ridge",
    name: "Ridgeway Athletics",
    org: "Ridgeway University · NCAA D1",
    contacts: [
      { name: "Dana Okoye", email: "dana@ridgewayathletics.edu" },
      { name: "Sports Info Desk", email: "sid@ridgewayathletics.edu" },
    ],
    template: "NCAA / league IPTC",
    destination: "Ridgeway SID — SFTP",
  },
  {
    id: "c-metro",
    name: "Metro Wire",
    org: "Regional news wire",
    contacts: [{ name: "Priya Raman", email: "desk@metrowire.com" }],
    template: "Wire IPTC (strict)",
    destination: "Metro Wire FTP",
  },
  {
    id: "c-northgate",
    name: "Northgate Prep",
    org: "High school athletics",
    contacts: [{ name: "Coach Ellis", email: "ellis@northgateprep.org" }],
    template: "School athletics",
    destination: "Client gallery link",
  },
];

const F = (value: string, source: FieldSource): MetaField => ({ value, source });

function makePicks(): Pick[] {
  const rows: { frame: string; jersey: string; approved: boolean; caption: string }[] = [
    { frame: "RDG_4412.NEF", jersey: "12", approved: true, caption: "Fourth-quarter drive" },
    { frame: "RDG_4418.NEF", jersey: "12", approved: true, caption: "Fourth-quarter drive" },
    { frame: "RDG_4460.NEF", jersey: "27", approved: false, caption: "" },
    { frame: "RDG_4471.NEF", jersey: "27", approved: false, caption: "Goal line stand" },
    { frame: "RDG_4502.NEF", jersey: "3", approved: true, caption: "Sideline celebration" },
    { frame: "RDG_4517.NEF", jersey: "3", approved: false, caption: "" },
    { frame: "RDG_4530.NEF", jersey: "44", approved: false, caption: "Bench reaction" },
    { frame: "RDG_4548.NEF", jersey: "44", approved: false, caption: "" },
    { frame: "RDG_4571.NEF", jersey: "8", approved: true, caption: "Kick return" },
    { frame: "RDG_4590.NEF", jersey: "8", approved: false, caption: "" },
    { frame: "RDG_4611.NEF", jersey: "21", approved: false, caption: "" },
    { frame: "RDG_4633.NEF", jersey: "21", approved: false, caption: "Post-game handshake" },
  ];
  return rows.map((r, i) => ({
    id: `p-${i}`,
    frame: r.frame,
    packageId: i < 6 ? "pkg-night" : i < 9 ? "pkg-league" : null,
    approved: r.approved,
    fields: {
      caption: F(r.caption, r.caption ? "manual" : "original"),
      headline: F("Ridgeway vs. Corbin Valley", "event"),
      iptc: F("Sports / American Football", "template"),
      copyright: F("© 2026 M. Laurent", "event"),
      keywords: F("ridgeway, football, ncaa, night game", "template"),
      player: F(`#${r.jersey}`, i % 3 === 0 ? "detection" : "accepted"),
      segment: F(i < 6 ? "Q4" : "Post-game", "manual"),
    },
    suggestions:
      i % 4 === 0
        ? [{ field: "player", value: `#${r.jersey} — R. Adeyemi`, confidence: 0.82, status: "open" }]
        : [],
  }));
}

export const SEED_EVENTS: EventJob[] = [
  {
    id: "e-ridgeway",
    name: "Ridgeway vs. Corbin Valley",
    genre: "Football · NCAA",
    venue: "Halden Field",
    start: "Tonight · 19:05",
    clientId: "c-ridge",
    status: "active",
    deadlines: [
      { label: "Same-night wire set", at: "Tonight 23:30" },
      { label: "League full gallery", at: "Thu 12:00" },
    ],
    offline: true,
    sources: [
      {
        id: "s-1",
        label: "CFexpress A · Slot 1",
        kind: "card",
        state: "ingest complete",
        files: 812,
        previews: 812,
        duplicates: 14,
        unsupported: 0,
        lowDisk: false,
        verifying: false,
      },
      {
        id: "s-2",
        label: "Backup SSD · /halden-b",
        kind: "drive",
        state: "queue ready",
        files: 486,
        previews: 486,
        duplicates: 3,
        unsupported: 2,
        lowDisk: true,
        verifying: true,
      },
    ],
    packages: [
      {
        id: "pkg-night",
        name: "Same-night wire set",
        deadline: "Tonight 23:30",
        target: 12,
        requirements: ["Caption required", "Copyright required", "Jersey verified"],
        preset: "JPEG 4000px q90 sRGB",
        destination: "Metro Wire FTP",
        recipient: "Priya Raman",
        state: "selects ready",
      },
      {
        id: "pkg-league",
        name: "League full gallery",
        deadline: "Thu 12:00",
        target: 120,
        requirements: ["Caption required", "Keywords required"],
        preset: "JPEG 3000px q85 sRGB",
        destination: "Ridgeway SID — SFTP",
        recipient: "Dana Okoye",
        state: "selecting",
      },
    ],
    picks: makePicks(),
    pickQueue: { reviewed: 1128, total: 1298, selects: 146, rejects: 982 },
    lightroom: { handoff: false, returns: 0, conflicts: 0 },
    receipts: [],
    metrics: { ingested: 1298, reviewed: 1128, workMinutes: 194 },
    money: {
      agreedRevenue: null,
      invoiced: null,
      collected: null,
      estimatedCosts: 240,
      actualCosts: null,
      source: "manual",
    },
    gallery: { link: null, pin: null, favorites: 0 },
  },
  {
    id: "e-northgate",
    name: "Northgate Prep · Senior Night",
    genre: "Basketball · High school",
    venue: "Northgate Gym",
    start: "Fri · 18:30",
    clientId: "c-northgate",
    status: "draft",
    deadlines: [{ label: "Gallery link", at: "Sat 20:00" }],
    offline: false,
    sources: [],
    packages: [],
    picks: [],
    pickQueue: { reviewed: 0, total: 0, selects: 0, rejects: 0 },
    lightroom: { handoff: false, returns: 0, conflicts: 0 },
    receipts: [],
    metrics: { ingested: 0, reviewed: 0, workMinutes: 0 },
    money: {
      agreedRevenue: null,
      invoiced: null,
      collected: null,
      estimatedCosts: null,
      actualCosts: null,
      source: null,
    },
    gallery: { link: null, pin: null, favorites: 0 },
  },
  {
    id: "e-invitational",
    name: "Halden Track Invitational",
    genre: "Track · Regional",
    venue: "Halden Oval",
    start: "Aug 22 · 09:00",
    clientId: "c-metro",
    status: "delivered",
    deadlines: [{ label: "Wire set", at: "Delivered Aug 22" }],
    offline: false,
    sources: [
      {
        id: "s-old",
        label: "CFexpress B",
        kind: "card",
        state: "ingest complete",
        files: 640,
        previews: 640,
        duplicates: 8,
        unsupported: 0,
        lowDisk: false,
        verifying: false,
      },
    ],
    packages: [
      {
        id: "pkg-track",
        name: "Wire set",
        deadline: "Aug 22 18:00",
        target: 20,
        requirements: ["Caption required"],
        preset: "JPEG 4000px q90 sRGB",
        destination: "Metro Wire FTP",
        recipient: "Priya Raman",
        state: "delivered",
      },
    ],
    picks: [],
    pickQueue: { reviewed: 640, total: 640, selects: 61, rejects: 579 },
    lightroom: { handoff: true, returns: 61, conflicts: 0 },
    receipts: [
      {
        id: "r-1",
        packageId: "pkg-track",
        revision: 1,
        at: "Aug 22 · 17:12",
        recipient: "Priya Raman",
        destination: "Metro Wire FTP",
        files: 20,
        preset: "JPEG 4000px q90 sRGB",
      },
    ],
    metrics: { ingested: 640, reviewed: 640, workMinutes: 322 },
    money: {
      agreedRevenue: 1450,
      invoiced: 1450,
      collected: 1450,
      estimatedCosts: 180,
      actualCosts: 212,
      source: "manual",
    },
    gallery: { link: "lens.link/halden-track", pin: null, favorites: 9 },
  },
];

export const METADATA_FIELDS: { key: string; label: string }[] = [
  { key: "caption", label: "Caption" },
  { key: "headline", label: "Headline" },
  { key: "iptc", label: "IPTC category" },
  { key: "copyright", label: "Copyright" },
  { key: "keywords", label: "Keywords" },
  { key: "player", label: "Player / jersey" },
  { key: "segment", label: "Chapter / segment" },
];

export const SOURCE_LABELS: Record<FieldSource, string> = {
  original: "from original",
  event: "from event",
  template: "from template",
  detection: "detected",
  accepted: "accepted suggestion",
  manual: "manual",
};

export function clientOf(clients: Client[], id: string) {
  return clients.find((c) => c.id === id);
}

export function packageFill(event: EventJob, pkg: Package) {
  return event.picks.filter((p) => p.packageId === pkg.id).length;
}
