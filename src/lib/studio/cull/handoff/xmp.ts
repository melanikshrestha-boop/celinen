/** XMP sidecars that Lightroom Classic, Lightroom, Capture One, Bridge and
 * Photo Mechanic all read: star rating, colour label, keywords, headline,
 * caption, and Celinen's own verdict so a round trip loses nothing.
 *
 * Writing a new sidecar and merging into an existing one are the same
 * operation — a new sidecar is a merge into an empty packet — so the output a
 * photographer gets never depends on whether a file was there before. A merge
 * rewrites only the properties it was given and keeps every other element and
 * attribute, including develop settings from Lightroom or Capture One.
 */
import type { CullReason, CullVerdict } from "../engine";
import { handoffVerdict, type HandoffFrame } from "./types";
import {
  namespaceOf,
  parseXml,
  scopeFor,
  serializeXml,
  textContent,
  type XmlAttr,
  type XmlDocument,
  type XmlElement,
  type XmlNode,
} from "./xml";

export const NS = {
  x: "adobe:ns:meta/",
  rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
  xmp: "http://ns.adobe.com/xap/1.0/",
  dc: "http://purl.org/dc/elements/1.1/",
  photoshop: "http://ns.adobe.com/photoshop/1.0/",
  celinen: "https://lenslab.dev/ns/celinen/1.0/",
} as const;

type Prefix = keyof typeof NS;

/** Lightroom's default label set. Capture One and Photo Mechanic map the same names. */
export type XmpLabel = "Red" | "Yellow" | "Green" | "Blue" | "Purple";
export const XMP_LABELS: readonly XmpLabel[] = ["Red", "Yellow", "Green", "Blue", "Purple"];

export type CelinenXmp = {
  verdict: CullVerdict;
  decided: boolean;
  reason?: CullReason | null | undefined;
  score?: number | null | undefined;
  group?: number | null | undefined;
  bestOfBurst?: boolean | null | undefined;
  duplicate?: boolean | null | undefined;
};

/**
 * What to write. For every field: `undefined` leaves whatever the packet
 * already has, `null` removes it, and a value replaces it.
 */
export type XmpFields = {
  /** -1 (rejected) or 0..5 stars. */
  rating?: number | null | undefined;
  /** A label name. Lightroom matches it against the active label set by text. */
  label?: string | null | undefined;
  keywords?: readonly string[] | null | undefined;
  headline?: string | null | undefined;
  caption?: string | null | undefined;
  celinen?: CelinenXmp | null | undefined;
  /** ISO 8601. Lightroom Classic compares xmp:MetadataDate to notice that a
   * sidecar changed on disk, so writers should set it. */
  metadataDate?: string | null | undefined;
};

export type XmpWriteOptions = {
  /** "merge" (default) keeps existing keywords and adds new ones; "replace" swaps the list. */
  keywordMode?: "merge" | "replace" | undefined;
  /** Bytes of trailing whitespace inside the packet, so an in-place editor can grow it.
   * Sidecars do not need it; embedded packets conventionally carry ~2KB. */
  padding?: number | undefined;
  /** Parser override: a DOMParser constructor, or null to force the pure parser. */
  domParser?: (new () => { parseFromString(text: string, type: string): Document }) | null;
};

export class XmpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XmpError";
  }
}

const PACKET_ID = "W5M0MpCehiHzreSzNTczkc9d";

function emptyPacket(): string {
  return (
    `<?xpacket begin="\uFEFF" id="${PACKET_ID}"?>\n` +
    `<x:xmpmeta xmlns:x="${NS.x}" x:xmptk="Celinen">\n` +
    ` <rdf:RDF xmlns:rdf="${NS.rdf}">\n` +
    `  <rdf:Description rdf:about=""\n` +
    `    xmlns:xmp="${NS.xmp}"\n` +
    `    xmlns:dc="${NS.dc}"\n` +
    `    xmlns:photoshop="${NS.photoshop}"\n` +
    `    xmlns:celinen="${NS.celinen}">\n` +
    `  </rdf:Description>\n` +
    ` </rdf:RDF>\n` +
    `</x:xmpmeta>\n` +
    `<?xpacket end="w"?>`
  );
}

/** A complete sidecar packet for these fields. */
export function buildXmp(fields: XmpFields, options: XmpWriteOptions = {}): string {
  // The template is known-good, so the pure parser is enough and keeps the
  // output identical in every runtime.
  return mergeXmp(emptyPacket(), fields, { ...options, domParser: null });
}

/**
 * Rewrites the given fields inside an existing packet and keeps everything
 * else. Throws `XmpError` when the existing text is not an XMP packet —
 * callers must then leave the file alone rather than replace a sidecar they
 * could not read.
 */
export function mergeXmp(
  existing: string,
  fields: XmpFields,
  options: XmpWriteOptions = {},
): string {
  validateFields(fields);
  let doc: XmlDocument;
  try {
    doc = parseXml(existing.replace(/^\uFEFF/, ""), options.domParser);
  } catch (error) {
    throw new XmpError(
      `The existing XMP could not be read: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const rdf = findRdf(doc);
  if (!rdf) throw new XmpError("The existing XMP has no rdf:RDF element.");

  const descriptions = rdf.element.children
    .filter((child): child is XmlElement => child.type === "element")
    .map((element) => ({ element, scope: scopeFor(element, rdf.scope) }))
    .filter(
      ({ element, scope }) =>
        namespaceOf(element.name, scope, false).uri === NS.rdf &&
        namespaceOf(element.name, scope, false).local === "Description",
    );

  let target = descriptions[0];
  if (!target) {
    const rdfPrefix = namespaceOf(rdf.element.name, rdf.scope, false).prefix;
    const element: XmlElement = {
      type: "element",
      name: `${rdfPrefix ? `${rdfPrefix}:` : ""}Description`,
      attrs: [{ name: `${rdfPrefix ? `${rdfPrefix}:` : ""}about`, value: "" }],
      children: [],
    };
    appendIndented(rdf.element, element, rdf.parentIndent);
    target = { element, scope: scopeFor(element, rdf.scope) };
    descriptions.push(target);
  }

  const siblings = rdf.element.children;
  const edit = new DescriptionEditor(
    target.element,
    target.scope,
    descriptions,
    indentBefore(siblings, siblings.indexOf(target.element)) || `${rdf.parentIndent} `,
  );

  if (fields.rating !== undefined)
    edit.setSimple("xmp", "Rating", fields.rating === null ? null : String(fields.rating));
  if (fields.label !== undefined) edit.setSimple("xmp", "Label", fields.label);
  if (fields.metadataDate !== undefined) edit.setSimple("xmp", "MetadataDate", fields.metadataDate);
  if (fields.headline !== undefined) edit.setSimple("photoshop", "Headline", fields.headline);
  if (fields.caption !== undefined) edit.setAltDefault("dc", "description", fields.caption);
  if (fields.keywords !== undefined)
    edit.setBag("dc", "subject", fields.keywords, options.keywordMode ?? "merge");
  if (fields.celinen !== undefined) {
    const c = fields.celinen;
    const text = (value: unknown) =>
      c === null || value === undefined || value === null ? null : String(value);
    edit.setSimple("celinen", "Verdict", c === null ? null : c.verdict);
    edit.setSimple("celinen", "Decided", c === null ? null : String(c.decided));
    edit.setSimple("celinen", "Reason", c && c.reason && c.reason !== "none" ? c.reason : null);
    edit.setSimple("celinen", "Score", text(c?.score));
    edit.setSimple("celinen", "Group", text(c?.group));
    edit.setSimple("celinen", "BestOfBurst", text(c?.bestOfBurst));
    edit.setSimple("celinen", "Duplicate", text(c?.duplicate));
  }

  let out = serializeXml(doc);
  const padding = Math.max(0, Math.floor(options.padding ?? 0));
  if (padding > 0) {
    const endPi = out.lastIndexOf("<?xpacket end=");
    if (endPi >= 0) out = out.slice(0, endPi) + paddingText(padding) + out.slice(endPi);
  }
  return out;
}

/** Reads the fields this module writes back out of a packet. */
export function readXmp(
  packet: string,
  options: Pick<XmpWriteOptions, "domParser"> = {},
): {
  rating: number | null;
  label: string | null;
  keywords: string[];
  headline: string | null;
  caption: string | null;
  celinen: Partial<Record<string, string>>;
} {
  let doc: XmlDocument;
  try {
    doc = parseXml(packet.replace(/^\uFEFF/, ""), options.domParser);
  } catch (error) {
    throw new XmpError(
      `The XMP could not be read: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const result = {
    rating: null as number | null,
    label: null as string | null,
    keywords: [] as string[],
    headline: null as string | null,
    caption: null as string | null,
    celinen: {} as Partial<Record<string, string>>,
  };
  const rdf = findRdf(doc);
  if (!rdf) return result;
  for (const child of rdf.element.children) {
    if (child.type !== "element") continue;
    const scope = scopeFor(child, rdf.scope);
    const visit = (ns: string | null, local: string, value: () => string, node?: XmlElement) => {
      if (ns === NS.xmp && local === "Rating") {
        const rating = Number(value());
        if (Number.isFinite(rating)) result.rating = rating;
      } else if (ns === NS.xmp && local === "Label") result.label = value();
      else if (ns === NS.photoshop && local === "Headline") result.headline = value();
      else if (ns === NS.celinen) result.celinen[local] = value();
      else if (node && ns === NS.dc && local === "subject")
        result.keywords = listItems(node, scope).map(({ item }) => textContent(item));
      else if (node && ns === NS.dc && local === "description") {
        const items = listItems(node, scope);
        const chosen =
          items.find(({ item }) => langOf(item) === "x-default") ?? items[0] ?? undefined;
        if (chosen) result.caption = textContent(chosen.item);
      }
    };
    for (const attr of child.attrs) {
      const { uri, local } = namespaceOf(attr.name, scope, true);
      visit(uri, local, () => attr.value);
    }
    for (const property of child.children) {
      if (property.type !== "element") continue;
      const { uri, local } = namespaceOf(property.name, scopeFor(property, scope), false);
      visit(uri, local, () => textContent(property), property);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Frame → fields

export type XmpMapping = {
  /** Keeper stars by score, checked top to bottom; first `minScore` met wins. */
  scoreBands: readonly { minScore: number; rating: number }[];
  /** Stars for a keeper with no engine score (decided before the engine ran). */
  keepFallbackRating: number;
  /** -1 is Bridge/Photo Mechanic "rejected". null leaves the rating alone. */
  rejectRating: number | null;
  /** null leaves an undecided frame's rating alone. */
  undecidedRating: number | null;
  labels: {
    keep: string | null;
    reject: string | null;
    undecided: string | null;
    /** Overrides `keep` for the frame the engine picked from its burst. */
    bestOfBurst: string | null;
  };
  /** Writes the celinen: namespace (verdict, reason, score, group). */
  writeCelinen: boolean;
};

export const DEFAULT_XMP_MAPPING: XmpMapping = {
  scoreBands: [
    { minScore: 90, rating: 5 },
    { minScore: 75, rating: 4 },
    { minScore: 55, rating: 3 },
    { minScore: 30, rating: 2 },
    { minScore: 0, rating: 1 },
  ],
  keepFallbackRating: 3,
  rejectRating: -1,
  undecidedRating: null,
  labels: { keep: null, reject: null, undecided: null, bestOfBurst: null },
  writeCelinen: true,
};

export function resolveMapping(mapping?: Partial<XmpMapping>): XmpMapping {
  return {
    ...DEFAULT_XMP_MAPPING,
    ...mapping,
    labels: { ...DEFAULT_XMP_MAPPING.labels, ...mapping?.labels },
  };
}

/** The star rating a frame gets. null means "do not touch the rating". */
export function ratingForFrame(frame: HandoffFrame, mapping?: Partial<XmpMapping>): number | null {
  const map = resolveMapping(mapping);
  const verdict = handoffVerdict(frame);
  // A rejection is a rejection, whatever stars were set before it.
  if (verdict === "reject") return map.rejectRating;
  if (frame.rating !== undefined && Number.isInteger(frame.rating)) {
    return Math.min(5, Math.max(0, frame.rating));
  }
  if (verdict === "undecided") return map.undecidedRating;
  const score = frame.suggestion?.score;
  if (score === undefined) return map.keepFallbackRating;
  const band = map.scoreBands.find((entry) => score >= entry.minScore);
  return band ? band.rating : map.keepFallbackRating;
}

export function frameXmpFields(
  frame: HandoffFrame,
  extras: Pick<XmpFields, "keywords" | "headline" | "caption" | "metadataDate"> = {},
  mapping?: Partial<XmpMapping>,
): XmpFields {
  const map = resolveMapping(mapping);
  const verdict = handoffVerdict(frame);
  const rating = ratingForFrame(frame, map);
  const fields: XmpFields = { ...extras };
  if (rating !== null) fields.rating = rating;

  const anyLabel = Object.values(map.labels).some((label) => label !== null);
  if (anyLabel) {
    // Once labels are in use, a verdict mapped to no label clears a stale one.
    fields.label =
      verdict === "keep" && frame.suggestion?.bestOfGroup && map.labels.bestOfBurst
        ? map.labels.bestOfBurst
        : map.labels[verdict];
  }

  if (map.writeCelinen) {
    const s = frame.suggestion;
    fields.celinen = {
      verdict,
      decided: frame.decided,
      reason: s?.reason ?? null,
      score: s?.score ?? null,
      group: s?.group ?? null,
      bestOfBurst: s ? s.bestOfGroup : null,
      duplicate: s ? s.duplicate : null,
    };
  }
  return fields;
}

// ---------------------------------------------------------------------------
// Sidecar naming

/** Formats Lightroom writes metadata into rather than beside. */
const EMBEDDING_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "jpe",
  "tif",
  "tiff",
  "dng",
  "psd",
  "psb",
  "png",
]);

export const RAW_EXTENSIONS: ReadonlySet<string> = new Set([
  "3fr", "ari", "arw", "bay", "cr2", "cr3", "crw", "cap", "dcr", "dcs", "dng", "drf", "eip", "erf",
  "fff", "gpr", "iiq", "k25", "kdc", "mdc", "mef", "mos", "mrw", "nef", "nrw", "orf", "pef", "ptx",
  "raf", "raw", "rw2", "rwl", "sr2", "srf", "srw", "x3f",
]); // prettier-ignore

export function splitExtension(fileName: string): { base: string; ext: string } {
  const dot = fileName.lastIndexOf(".");
  // A leading dot is a hidden file's name, not an extension.
  if (dot <= 0 || dot === fileName.length - 1) return { base: fileName, ext: "" };
  return { base: fileName.slice(0, dot), ext: fileName.slice(dot + 1) };
}

export type SidecarNameOptions = {
  /** "lightroom" (default): `_DSC5098.ARW` → `_DSC5098.xmp`, which Lightroom,
   * Bridge, Capture One and Photo Mechanic all read. "append":
   * `_DSC5098.ARW.xmp`, the darktable / RawTherapee convention. */
  style?: "lightroom" | "append" | undefined;
  /** Also name a sidecar for JPEG/TIFF/PNG/PSD/DNG. Off by default because
   * Lightroom reads (and writes) XMP embedded in those files and ignores a
   * sidecar beside them. */
  includeEmbedding?: boolean | undefined;
};

/** The sidecar file name for an original, or null when that format carries
 * its metadata inside the file. */
export function sidecarName(fileName: string, options: SidecarNameOptions = {}): string | null {
  const { base, ext } = splitExtension(fileName);
  if (!options.includeEmbedding && EMBEDDING_EXTENSIONS.has(ext.toLowerCase())) return null;
  if (options.style === "append") return `${fileName}.xmp`;
  return `${base}.xmp`;
}

export function isEmbeddingFormat(fileName: string): boolean {
  return EMBEDDING_EXTENSIONS.has(splitExtension(fileName).ext.toLowerCase());
}

export function isJpegName(fileName: string): boolean {
  return ["jpg", "jpeg", "jpe"].includes(splitExtension(fileName).ext.toLowerCase());
}

/** A sidecar is UTF-8 without a byte-order mark, as Adobe writes them. */
export function encodeXmp(packet: string): Uint8Array {
  return new TextEncoder().encode(packet);
}

// ---------------------------------------------------------------------------
// Internals

function validateFields(fields: XmpFields) {
  const { rating } = fields;
  if (
    rating !== undefined &&
    rating !== null &&
    !(Number.isInteger(rating) && rating >= -1 && rating <= 5)
  )
    throw new RangeError(`XMP rating must be an integer from -1 to 5, got ${rating}.`);
  const { metadataDate } = fields;
  if (metadataDate && Number.isNaN(Date.parse(metadataDate)))
    throw new RangeError(`XMP MetadataDate must be an ISO 8601 date, got ${metadataDate}.`);
}

function paddingText(bytes: number): string {
  // XMP convention: lines of 100 spaces.
  const line = " ".repeat(99) + "\n";
  return line.repeat(Math.floor(bytes / 100)) + " ".repeat(bytes % 100);
}

type Located = { element: XmlElement; scope: Map<string, string>; parentIndent: string };

function findRdf(doc: XmlDocument): Located | null {
  const search = (
    nodes: readonly XmlNode[],
    parentScope: Map<string, string>,
    depth: number,
  ): Located | null => {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]!;
      if (node.type !== "element") continue;
      const scope = scopeFor(node, parentScope);
      const { uri, local } = namespaceOf(node.name, scope, false);
      if (uri === NS.rdf && local === "RDF")
        return { element: node, scope, parentIndent: indentBefore(nodes, i) };
      // XMP puts rdf:RDF at the root or directly inside x:xmpmeta.
      if (depth < 2) {
        const found = search(node.children, scope, depth + 1);
        if (found) return found;
      }
    }
    return null;
  };
  return search(doc.children, new Map(), 0);
}

/** The indentation of the line a node starts on, from the whitespace before it. */
function indentBefore(siblings: readonly XmlNode[], index: number): string {
  const previous = siblings[index - 1];
  if (previous?.type !== "text") return "";
  const newline = previous.value.lastIndexOf("\n");
  if (newline < 0) return "";
  const tail = previous.value.slice(newline + 1);
  return /^[ \t]*$/.test(tail) ? tail : "";
}

/** Appends `child` on its own line, one space deeper than `parent`, and puts
 * the parent's end tag back on a line of its own. */
function appendIndented(parent: XmlElement, child: XmlNode, parentIndent: string) {
  const children = parent.children;
  // Only element-only content is reformatted; mixed text is never touched.
  if (children.some((node) => node.type === "text" && /\S/.test(node.value))) {
    children.push(child);
    return;
  }
  while (children.length) {
    const last = children[children.length - 1]!;
    if (last.type !== "text") break;
    children.pop();
  }
  children.push({ type: "text", value: `\n${parentIndent} ` }, child, {
    type: "text",
    value: `\n${parentIndent}`,
  });
}

function element(name: string, attrs: XmlElement["attrs"] = []): XmlElement {
  return { type: "element", name, attrs, children: [] };
}

function langOf(item: XmlElement): string | null {
  for (const attr of item.attrs) if (attr.name === "xml:lang") return attr.value;
  return null;
}

/** The rdf:li items of a Bag/Seq/Alt property, with their container. */
function listItems(
  property: XmlElement,
  scope: Map<string, string>,
): { container: XmlElement; item: XmlElement }[] {
  const inner = scopeFor(property, scope);
  const out: { container: XmlElement; item: XmlElement }[] = [];
  for (const child of property.children) {
    if (child.type !== "element") continue;
    const containerScope = scopeFor(child, inner);
    const { uri, local } = namespaceOf(child.name, containerScope, false);
    if (uri !== NS.rdf || !["Bag", "Seq", "Alt"].includes(local)) continue;
    for (const item of child.children) {
      if (item.type !== "element") continue;
      const itemName = namespaceOf(item.name, scopeFor(item, containerScope), false);
      if (itemName.uri === NS.rdf && itemName.local === "li") out.push({ container: child, item });
    }
  }
  return out;
}

class DescriptionEditor {
  constructor(
    private readonly target: XmlElement,
    private readonly scope: Map<string, string>,
    private readonly all: readonly { element: XmlElement; scope: Map<string, string> }[],
    /** The Description's own indentation; its properties sit one space deeper. */
    private readonly indent: string,
  ) {}

  /** The prefix bound to `uri` on the target, declaring one if needed. */
  private prefixFor(preferred: Prefix): string {
    const uri = NS[preferred];
    for (const [prefix, bound] of this.scope) if (bound === uri && prefix) return prefix;
    let prefix: string = preferred;
    for (let n = 1; this.scope.has(prefix); n++) prefix = `${preferred}${n}`;
    this.target.attrs.push({ name: `xmlns:${prefix}`, value: uri });
    this.scope.set(prefix, uri);
    return prefix;
  }

  private rdfPrefix(): string {
    return this.prefixFor("rdf");
  }

  /** Removes a property's attribute form from every Description, and its
   * element form from every Description except at `keep`. */
  private remove(ns: Prefix, local: string, keep?: XmlElement, keepAttr?: XmlAttr): void {
    const uri = NS[ns];
    for (const { element: description, scope } of this.all) {
      description.attrs = description.attrs.filter((attr) => {
        if (attr === keepAttr) return true;
        const name = namespaceOf(attr.name, scope, true);
        return !(name.uri === uri && name.local === local);
      });
      const kept: XmlNode[] = [];
      for (const child of description.children) {
        if (child.type === "element" && child !== keep) {
          const name = namespaceOf(child.name, scopeFor(child, scope), false);
          if (name.uri === uri && name.local === local) {
            // Also drop the indentation that led up to the removed element.
            const previous = kept[kept.length - 1];
            if (previous?.type === "text" && /^\s*$/.test(previous.value)) kept.pop();
            continue;
          }
        }
        kept.push(child);
      }
      description.children = kept;
    }
  }

  private findElement(
    ns: Prefix,
    local: string,
  ): { element: XmlElement; scope: Map<string, string> } | null {
    const uri = NS[ns];
    for (const { element: description, scope } of this.all) {
      for (const child of description.children) {
        if (child.type !== "element") continue;
        const name = namespaceOf(child.name, scopeFor(child, scope), false);
        if (name.uri === uri && name.local === local) return { element: child, scope };
      }
    }
    return null;
  }

  /**
   * Replaces a structured property's value. An existing element keeps its
   * place (and its own attributes) and has its content rebuilt; a new one is
   * appended to the target Description. Any other copy is removed.
   */
  private placeStructured(
    ns: Prefix,
    local: string,
    container: "Bag" | "Alt",
    items: readonly { value: string; lang?: string | undefined }[],
  ): void {
    const existing = this.findElement(ns, local)?.element;
    this.remove(ns, local, existing);
    const rdf = this.rdfPrefix();
    let property = existing;
    let propertyIndent = `${this.indent} `;
    if (property) {
      const owner = this.all.find(({ element: d }) => d.children.includes(property!))!.element;
      propertyIndent =
        indentBefore(owner.children, owner.children.indexOf(property)) || propertyIndent;
      property.children = [];
    } else {
      property = element(`${this.prefixFor(ns)}:${local}`);
      appendIndented(this.target, property, this.indent);
    }
    const list = element(`${rdf}:${container}`);
    appendIndented(property, list, propertyIndent);
    for (const item of items) {
      const li = element(`${rdf}:li`, item.lang ? [{ name: "xml:lang", value: item.lang }] : []);
      li.children.push({ type: "text", value: item.value });
      appendIndented(list, li, `${propertyIndent} `);
    }
  }

  setSimple(ns: Prefix, local: string, value: string | null): void {
    const uri = NS[ns];
    // An attribute already on the target keeps its position; only its value changes.
    const inPlace =
      value === null
        ? undefined
        : this.target.attrs.find((attr) => {
            const name = namespaceOf(attr.name, this.scope, true);
            return name.uri === uri && name.local === local;
          });
    this.remove(ns, local, undefined, inPlace);
    if (value === null) return;
    if (inPlace) inPlace.value = value;
    else this.target.attrs.push({ name: `${this.prefixFor(ns)}:${local}`, value });
  }

  /** Sets the x-default entry of a language alternative and keeps the other languages. */
  setAltDefault(ns: Prefix, local: string, value: string | null): void {
    if (value === null) {
      this.remove(ns, local);
      return;
    }
    const existing = this.findElement(ns, local);
    const others = existing
      ? listItems(existing.element, existing.scope)
          .map(({ item }) => ({ value: textContent(item), lang: langOf(item) ?? undefined }))
          .filter((item) => item.lang && item.lang !== "x-default")
      : [];
    // Adobe's rule: x-default comes first in an Alt.
    this.placeStructured(ns, local, "Alt", [{ value, lang: "x-default" }, ...others]);
  }

  setBag(
    ns: Prefix,
    local: string,
    values: readonly string[] | null,
    mode: "merge" | "replace",
  ): void {
    if (values === null) {
      this.remove(ns, local);
      return;
    }
    const existing = this.findElement(ns, local);
    const current =
      existing && mode === "merge"
        ? listItems(existing.element, existing.scope).map(({ item }) => textContent(item))
        : [];
    const cleaned = values.map((value) => value.trim()).filter(Boolean);
    const merged = [...new Set([...current, ...cleaned])];
    if (!merged.length) {
      this.remove(ns, local);
      return;
    }
    this.placeStructured(
      ns,
      local,
      "Bag",
      merged.map((value) => ({ value })),
    );
  }
}
