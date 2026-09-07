import { parseXmpSidecar, type Edits } from "@/lib/imaging";

export const ADOBE_PASTE_MAX_CHARS = 128_000;

export interface AdobeSettingsPlan {
  kind: "plan";
  format: "xmp" | "lines";
  name: string;
  summary: string;
  /** Absolute values for the supported subset, not deltas or an automatically applied preset. */
  edits: Partial<Edits>;
  warnings: string[];
}

export interface AdobeSettingsRefusal {
  kind: "refusal";
  reason: string;
  warnings: string[];
}

export type AdobeSettingsPasteResult = AdobeSettingsPlan | AdobeSettingsRefusal | null;
export type AdobeSettingsPastePlan = AdobeSettingsPlan;

const CRS = "http://ns.adobe.com/camera-raw-settings/1.0/";
const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const XMP = "adobe:ns:meta/";
const XML = "http://www.w3.org/XML/1998/namespace";
const NUMBER = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/;
const QNAME = "[A-Za-z_][A-Za-z0-9_.-]*(?::[A-Za-z_][A-Za-z0-9_.-]*)?";
const ATTRIBUTE = new RegExp(`^\\s+(${QNAME})\\s*=\\s*(?:"([^"<]*)"|'([^'<]*)')`);
const OPEN = new RegExp(`^(${QNAME})([\\s\\S]*)$`);
const CLOSE = new RegExp(`^/(${QNAME})\\s*$`);

const SUPPORTED = new Map<string, { label: string; limit: number }>([
  ["Exposure2012", { label: "Exposure", limit: 5 }],
  ["Contrast2012", { label: "Contrast", limit: 100 }],
  ["Highlights2012", { label: "Highlights", limit: 100 }],
  ["Shadows2012", { label: "Shadows", limit: 100 }],
  ["Saturation", { label: "Saturation", limit: 100 }],
]);

const LINE_FIELDS = new Map([
  ["exposure", "Exposure2012"],
  ["exposure2012", "Exposure2012"],
  ["contrast", "Contrast2012"],
  ["contrast2012", "Contrast2012"],
  ["highlights", "Highlights2012"],
  ["highlights2012", "Highlights2012"],
  ["shadows", "Shadows2012"],
  ["shadows2012", "Shadows2012"],
  ["saturation", "Saturation"],
  ["temperature", "Temperature"],
  ["temp", "Temperature"],
  ["tint", "Tint"],
  ["whites", "Whites2012"],
  ["blacks", "Blacks2012"],
  ["texture", "Texture"],
  ["clarity", "Clarity2012"],
  ["dehaze", "Dehaze"],
  ["vibrance", "Vibrance"],
  ["sharpness", "Sharpness"],
  ["sharpening", "Sharpness"],
  ["noise reduction", "LuminanceSmoothing"],
  ["color noise reduction", "ColorNoiseReduction"],
  ["grain", "GrainAmount"],
  ["vignette", "PostCropVignetteAmount"],
  ["profile", "CameraProfile"],
  ["camera profile", "CameraProfile"],
  ["white balance", "WhiteBalance"],
  ["crop", "HasCrop"],
  ["tone curve", "ToneCurve"],
  ["curves", "ToneCurve"],
  ["mask", "Masking"],
  ["masking", "Masking"],
  ["lens corrections", "LensCorrections"],
]);
const TEXT_FIELDS = new Set([
  "CameraProfile",
  "WhiteBalance",
  "HasCrop",
  "ToneCurve",
  "Masking",
  "LensCorrections",
]);
const LINE_LABELS = [...LINE_FIELDS.keys()].sort((a, b) => b.length - a.length).join("|");
const LINE = new RegExp(`^(${LINE_LABELS})(?:\\s*[:=]\\s*|\\s+)(.+)$`, "i");
const LOOKS_LINE = new RegExp(
  `(?:^|\\n)\\s*(?:[-*]\\s+)?(?:${LINE_LABELS})(?:\\s*[:=]|\\s+[+\\-−.\\d]|\\s+(?:NaN|Infinity)\\b)`,
  "i",
);
const BASE_WARNINGS = [
  "This is an approximate browser-rendered look, not Adobe RAW processing or pixel-matched output.",
  "Only the listed global tone settings are staged. Unlisted edits, crops, ratings, picks and metadata stay unchanged.",
];

function refuse(reason: string, warnings: string[] = []): AdobeSettingsRefusal {
  return { kind: "refusal", reason: `${reason} Nothing has been applied.`, warnings };
}

function unsupportedWarning(key: string): string {
  if (/Temperature|WhiteBalance|Tint/.test(key))
    return `${key} is not imported: Adobe white balance/Kelvin cannot be mapped safely to this editor's relative warmth control.`;
  if (/Whites|Blacks/.test(key))
    return `${key} is not imported: independent white/black point controls are not supported.`;
  if (/Mask|Correction|Retouch|Paint|Gradient|Radial|Local/.test(key))
    return `${key} is not imported: masks, local/AI adjustments and corrections are not reproduced.`;
  if (/Crop|Perspective|Upright|Transform|Rotation/.test(key))
    return `${key} is not imported: Adobe framing/geometry is not reproduced; the current crop is unchanged.`;
  if (/Profile|Look|Calibration/.test(key))
    return `${key} is not imported: Adobe profiles, looks and calibration are not reproduced.`;
  if (/Curve/.test(key)) return `${key} is not imported: Adobe tone curves are not reproduced.`;
  if (/^(Exposure|Contrast|Shadows|Brightness)$/.test(key))
    return `${key} is a legacy Adobe process field, not its modern 2012 control; it is not imported.`;
  return `${key} is not supported and will not be imported.`;
}

interface XmlAttribute {
  name: string;
  namespace: string;
  local: string;
  value: string;
}
interface XmlNode {
  name: string;
  namespace: string;
  local: string;
  attributes: XmlAttribute[];
  children: XmlNode[];
  text: string;
  namespaces: Map<string, string>;
}

function attributes(raw: string): [string, string][] {
  const found: [string, string][] = [];
  const seen = new Set<string>();
  while (raw.trim()) {
    const match = ATTRIBUTE.exec(raw);
    if (!match) throw new Error("Malformed XML attributes.");
    const name = match[1]!;
    if (seen.has(name)) throw new Error("Repeated XML attribute.");
    seen.add(name);
    found.push([name, match[2] ?? match[3]!]);
    raw = raw.slice(match[0].length);
  }
  return found;
}

function expanded(name: string, namespaces: Map<string, string>, attribute = false) {
  const parts = name.split(":");
  if (parts.length === 1)
    return { namespace: attribute ? "" : (namespaces.get("") ?? ""), local: name };
  const namespace = namespaces.get(parts[0]!);
  if (!namespace) throw new Error("XML uses an undeclared namespace.");
  return { namespace, local: parts[1]! };
}

/** Small, non-executing XML subset reader: no DTD, entities, CDATA, fetching or DOM insertion. */
function xmlTree(xml: string): XmlNode {
  const stack: XmlNode[] = [];
  let root: XmlNode | undefined;
  let index = 0;
  let count = 0;
  let xmlDeclared = false;
  while (index < xml.length) {
    if (xml[index] !== "<") {
      const end = xml.indexOf("<", index);
      const text = xml.slice(index, end < 0 ? xml.length : end);
      if (stack.length) stack[stack.length - 1]!.text += text;
      else if (text.trim()) throw new Error("Text outside the XML document.");
      index = end < 0 ? xml.length : end;
      continue;
    }
    if (xml.startsWith("<!--", index)) {
      const end = xml.indexOf("-->", index + 4);
      if (end < 0 || xml.slice(index + 4, end).includes("--"))
        throw new Error("Malformed XML comment.");
      index = end + 3;
      continue;
    }
    if (xml.startsWith("<?", index)) {
      const end = xml.indexOf("?>", index + 2);
      const declaration =
        end < 0 ? null : /^(xml|xpacket)(\s[\s\S]*)$/.exec(xml.slice(index + 2, end));
      if (!declaration || stack.length) throw new Error("Unsupported XML processing instruction.");
      const attrs = attributes(declaration[2]!);
      if (declaration[1] === "xml") {
        if (
          xmlDeclared ||
          root ||
          index !== 0 ||
          attrs[0]?.[0] !== "version" ||
          !["1.0", "1.1"].includes(attrs[0]?.[1] ?? "") ||
          attrs.some(
            ([key, value]) =>
              !["version", "encoding", "standalone"].includes(key) ||
              (key === "standalone" && !["yes", "no"].includes(value)),
          )
        )
          throw new Error("Malformed XML declaration.");
        xmlDeclared = true;
      }
      index = end + 2;
      continue;
    }
    if (xml.startsWith("<!", index))
      throw new Error("XML declarations, entities and CDATA are not accepted.");
    let end = index + 1;
    let quote = "";
    for (; end < xml.length; end++) {
      const char = xml[end]!;
      if (quote) {
        if (char === quote) quote = "";
      } else if (char === '"' || char === "'") quote = char;
      else if (char === ">") break;
      else if (char === "<") throw new Error("Malformed XML tag.");
    }
    if (end === xml.length || quote) throw new Error("Unclosed XML tag.");
    let body = xml.slice(index + 1, end);
    index = end + 1;
    if (body.startsWith("/")) {
      const close = CLOSE.exec(body);
      if (!close || stack.pop()?.name !== close[1]) throw new Error("Mismatched XML closing tag.");
      continue;
    }
    const selfClosing = body.endsWith("/");
    if (selfClosing) body = body.slice(0, -1);
    const start = OPEN.exec(body);
    if (!start) throw new Error("Malformed XML element.");
    const attrs = attributes(start[2]!);
    const namespaces = new Map(stack.at(-1)?.namespaces ?? [["xml", XML]]);
    for (const [name, value] of attrs) {
      if (name === "xmlns") namespaces.set("", value);
      else if (name.startsWith("xmlns:")) {
        const prefix = name.slice(6);
        if (prefix === "xmlns" || !value || (prefix === "xml" && value !== XML))
          throw new Error("Invalid XML namespace binding.");
        namespaces.set(prefix, value);
      }
    }
    const node: XmlNode = {
      name: start[1]!,
      ...expanded(start[1]!, namespaces),
      attributes: [],
      children: [],
      text: "",
      namespaces,
    };
    const seen = new Set<string>();
    for (const [name, value] of attrs) {
      if (name === "xmlns" || name.startsWith("xmlns:")) continue;
      const resolved = expanded(name, namespaces, true);
      const key = `${resolved.namespace}|${resolved.local}`;
      if (seen.has(key)) throw new Error("Repeated namespaced XML attribute.");
      seen.add(key);
      node.attributes.push({ name, ...resolved, value });
    }
    if (stack.length) stack.at(-1)!.children.push(node);
    else if (root) throw new Error("Paste one XML settings document at a time.");
    else root = node;
    if (++count > 4000 || stack.length >= 32)
      throw new Error("XML settings structure is too large or deep.");
    if (!selfClosing) stack.push(node);
  }
  if (!root || stack.length) throw new Error("Incomplete XML document.");
  return root;
}

function xmpFields(xml: string): Map<string, string | null> {
  const root = xmlTree(xml);
  const is = (node: XmlNode, namespace: string, local: string) =>
    node.namespace === namespace && node.local === local;
  let descriptions: XmlNode[];
  if (is(root, RDF, "Description")) descriptions = [root];
  else {
    const rdf = is(root, RDF, "RDF")
      ? root
      : is(root, XMP, "xmpmeta") && root.children.length === 1
        ? root.children[0]
        : undefined;
    if (!rdf || !is(rdf, RDF, "RDF"))
      throw new Error("Paste a Camera Raw/Lightroom XMP document, not arbitrary XML.");
    if (rdf.children.some((node) => !is(node, RDF, "Description")))
      throw new Error("Unsupported top-level XMP structure.");
    descriptions = rdf.children;
  }
  const fields = new Map<string, string | null>();
  let settingsDescriptions = 0;
  for (const description of descriptions) {
    const values: [string, string | null][] = description.attributes
      .filter((attr) => attr.namespace === CRS)
      .map((attr) => [attr.local, attr.value]);
    for (const child of description.children) {
      if (child.namespace === CRS)
        values.push([
          child.local,
          child.children.length || child.attributes.length ? null : child.text.trim(),
        ]);
    }
    if (values.length && ++settingsDescriptions > 1)
      throw new Error("Multiple Adobe settings records are ambiguous; paste one recipe.");
    for (const [name, value] of values) {
      if (fields.has(name)) throw new Error(`Repeated Adobe setting: ${name}.`);
      fields.set(name, value);
    }
  }
  return fields;
}

function lineFields(text: string): { fields: Map<string, string | null>; name: string } {
  const fields = new Map<string, string | null>();
  let name = "Adobe settings";
  let named = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().replace(/^[-*]\s+/, "");
    if (!line) continue;
    if (
      /^(?:(?:adobe )?(?:lightroom(?: classic)?|camera raw)(?: settings)?|adobe settings|basic(?: adjustments)?)\s*:?$/i.test(
        line,
      )
    )
      continue;
    const title = /^(?:preset(?: name)?|name)\s*:\s*(.+)$/i.exec(line);
    if (title) {
      if (named || title[1]!.length > 100)
        throw new Error("Use one preset name of at most 100 characters.");
      name = title[1]!.trim();
      named = true;
      continue;
    }
    const match = LINE.exec(line);
    if (!match)
      throw new Error(
        "Use one setting and value per line; mixed instructions or unknown lines are not imported.",
      );
    const key = LINE_FIELDS.get(match[1]!.toLowerCase())!;
    if (fields.has(key)) throw new Error(`Repeated Adobe setting: ${match[1]}.`);
    let value = match[2]!.trim().replace(/^−/, "-");
    if (key === "Exposure2012") value = value.replace(/\s*EV$/i, "").trim();
    if (!TEXT_FIELDS.has(key) && !NUMBER.test(value))
      throw new Error(`${match[1]} needs a finite decimal number, without extra instructions.`);
    fields.set(key, value);
  }
  return { fields, name };
}

/**
 * Parse pasted data only. A plan must enter preview/confirmation; this function
 * never changes photos, interprets commands, reads the clipboard, or performs I/O.
 * Callers must stop routing on a refusal rather than reinterpret it as an edit prompt.
 */
export function parseAdobeSettingsPaste(input: string): AdobeSettingsPasteResult {
  if (input.length > ADOBE_PASTE_MAX_CHARS)
    return refuse(
      `Settings paste exceeds ${ADOBE_PASTE_MAX_CHARS.toLocaleString("en-US")} characters.`,
    );
  if (!input.trim()) return null;
  let text = input.trim();
  const looksLikeSettings =
    LOOKS_LINE.test(text) ||
    /^(?:<|```(?:xml|xmp)|(?:adobe )?(?:lightroom|camera raw)\b)/i.test(text) ||
    /crs:|Exposure2012|Contrast2012/.test(text) ||
    /["'](?:Exposure|Contrast|Highlights|Shadows|Saturation|Temperature|Whites|Blacks)["']\s*[:=]/i.test(
      text,
    );
  if (!looksLikeSettings) return null;
  // Reject control characters as data, not a request to match them in user text.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text))
    return refuse("Settings contain invalid control characters.");
  if (text.includes("&") || /<!DOCTYPE|<!ENTITY/i.test(text))
    return refuse("XML entities and entity declarations are not accepted in settings pastes.");
  const fence = /^```(?:xml|xmp|text|plaintext)?\s*\n([\s\S]*?)\n```$/i.exec(text);
  if (fence) text = fence[1]!.trim();
  else if (text.includes("```"))
    return refuse(
      "Paste one complete XML or plain-text settings block, without surrounding instructions.",
    );
  const format = text.startsWith("<") ? "xmp" : "lines";
  try {
    const parsed =
      format === "xmp" ? { fields: xmpFields(text), name: "Adobe XMP settings" } : lineFields(text);
    const mapped: string[] = [];
    const warnings = [...BASE_WARNINGS];
    const unsupported: string[] = [];
    for (const [key, value] of parsed.fields) {
      if (value !== null && /^[+-]?(?:Infinity|NaN)$/i.test(value.trim()))
        throw new Error(`${key} has a nonfinite value.`);
      if (
        value !== null &&
        /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value) &&
        !Number.isFinite(Number(value))
      )
        throw new Error(`${key} has a nonfinite value.`);
      const supported = SUPPORTED.get(key);
      if (!supported) {
        unsupported.push(key);
        continue;
      }
      if (value === null || !NUMBER.test(value))
        throw new Error(`${key} must be one finite decimal value.`);
      const number = Number(value);
      if (!Number.isFinite(number) || Math.abs(number) > supported.limit)
        throw new Error(
          `${supported.label} is outside the supported range -${supported.limit} to +${supported.limit}.`,
        );
      mapped.push(`crs:${key}="${value}"`);
    }
    for (const key of unsupported.slice(0, 30)) warnings.push(unsupportedWarning(key));
    if (unsupported.length > 30)
      warnings.push(
        `${unsupported.length - 30} additional Adobe fields are also unsupported and are not imported.`,
      );
    if (!mapped.length)
      return refuse(
        "No supported global tone settings were found. Use Exposure, Contrast, Highlights, Shadows or Saturation.",
        warnings,
      );
    // Only validated allowlisted fields enter the legacy mapper. In particular,
    // never pass Temperature: its Kelvin conversion is not portable or safe here.
    const edits = parseXmpSidecar(`<rdf:Description ${mapped.join(" ")} />`).edits;
    return {
      kind: "plan",
      format,
      name: parsed.name,
      summary: `Preview ${mapped.length} supported Adobe-style setting${mapped.length === 1 ? "" : "s"} as absolute values; nothing is applied yet.`,
      edits,
      warnings,
    };
  } catch (error) {
    return refuse(
      error instanceof Error ? error.message : "These settings could not be read safely.",
    );
  }
}
