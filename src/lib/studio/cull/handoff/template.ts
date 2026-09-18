/** Rename and folder templates, Photo Mechanic style:
 * `{date}_{seq:4}` → `2026-09-17_0042`, `{yyyy}-{mm}-{dd} {shootName}` → a
 * dated shoot folder.
 *
 * Every token value is cleaned for every filesystem a photographer's drive
 * may be formatted with (APFS, NTFS, exFAT), so a caption-like camera name or
 * shoot name can never create a path separator, a reserved Windows name or a
 * `..` segment. `/` typed in the template itself does make subfolders.
 */

export const TEMPLATE_TOKENS = {
  filename: "Original file name, without extension",
  folder: "Folder the original was in",
  date: "Capture date, YYYY-MM-DD",
  time: "Capture time, HHMMSS",
  yyyy: "Capture year",
  yy: "Capture year, two digits",
  mm: "Capture month, two digits",
  dd: "Capture day, two digits",
  hh: "Capture hour, 24h",
  min: "Capture minute",
  ss: "Capture second",
  seq: "Sequence number; {seq:4} pads to 4 digits",
  camera: "Camera model",
  make: "Camera make",
  serial: "Camera serial number",
  shootName: "Shoot name",
} as const;

export type TemplateToken = keyof typeof TEMPLATE_TOKENS;

export type TemplatePart =
  | { kind: "literal"; text: string }
  | { kind: "token"; token: TemplateToken; pad?: number | undefined };

export class TemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TemplateError";
  }
}

export type TemplateContext = {
  /** The original's file name, with extension. */
  fileName: string;
  /** Path of the original on the card, e.g. `DCIM/100MSDCF/_DSC5098.ARW`. */
  relativePath?: string | undefined;
  captureTimeMs?: number | null | undefined;
  /** "camera_clock" times are the camera's wall clock stored as if UTC. */
  captureTimeBasis?: "utc" | "camera_clock" | undefined;
  /** Used when there is no capture time — normally the file's modified time (local). */
  fallbackTimeMs: number;
  seq?: number | undefined;
  /** The engine's camera identity: `make|model|serial`. */
  cameraKey?: string | undefined;
  shootName?: string | undefined;
};

/** Splits a template into literals and tokens, rejecting unknown tokens and
 * unbalanced braces so a typo is caught when it is typed, not mid-export. */
export function parseTemplate(template: string): TemplatePart[] {
  const parts: TemplatePart[] = [];
  let at = 0;
  let literal = "";
  while (at < template.length) {
    const ch = template[at]!;
    if (ch === "}") throw new TemplateError(`Unexpected "}" at position ${at + 1}.`);
    if (ch !== "{") {
      literal += ch;
      at++;
      continue;
    }
    const end = template.indexOf("}", at);
    if (end < 0) throw new TemplateError(`Unclosed "{" at position ${at + 1}.`);
    const body = template.slice(at + 1, end);
    const match = /^([A-Za-z]+)(?::(\d{1,2}))?$/.exec(body);
    if (!match || !(match[1]! in TEMPLATE_TOKENS))
      throw new TemplateError(`Unknown token {${body}}.`);
    const token = match[1] as TemplateToken;
    if (match[2] !== undefined && token !== "seq")
      throw new TemplateError(`Only {seq} takes a width, not {${body}}.`);
    if (literal) parts.push({ kind: "literal", text: literal });
    literal = "";
    parts.push(
      match[2] !== undefined
        ? { kind: "token", token, pad: Number(match[2]) }
        : { kind: "token", token },
    );
    at = end + 1;
  }
  if (literal) parts.push({ kind: "literal", text: literal });
  return parts;
}

export function validateTemplate(template: string): string | null {
  try {
    parseTemplate(template);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

export function templateUses(template: string, token: TemplateToken): boolean {
  return parseTemplate(template).some((part) => part.kind === "token" && part.token === token);
}

/** Camera make, model and serial from the engine's `make|model|serial` key. */
export function cameraParts(cameraKey: string | undefined): {
  make: string;
  model: string;
  serial: string;
} {
  const parts = (cameraKey ?? "").split("|").map((part) => part.trim());
  if (parts.length >= 3)
    return { make: parts[0]!, model: parts[1]!, serial: parts.slice(2).join("|") };
  if (parts.length === 2) return { make: parts[0]!, model: parts[1]!, serial: "" };
  return { make: "", model: parts[0] ?? "", serial: "" };
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

function clockParts(ctx: TemplateContext) {
  const hasCapture = typeof ctx.captureTimeMs === "number" && Number.isFinite(ctx.captureTimeMs);
  const date = new Date(hasCapture ? ctx.captureTimeMs! : ctx.fallbackTimeMs);
  // A camera-clock time is the wall clock the camera showed, stored as UTC
  // fields; reading it in local time would shift a photo's date by the zone.
  const utc = hasCapture && ctx.captureTimeBasis === "camera_clock";
  return {
    year: utc ? date.getUTCFullYear() : date.getFullYear(),
    month: (utc ? date.getUTCMonth() : date.getMonth()) + 1,
    day: utc ? date.getUTCDate() : date.getDate(),
    hour: utc ? date.getUTCHours() : date.getHours(),
    minute: utc ? date.getUTCMinutes() : date.getMinutes(),
    second: utc ? date.getUTCSeconds() : date.getSeconds(),
  };
}

function baseName(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot > 0 ? fileName.slice(0, dot) : fileName;
}

function parentFolder(relativePath: string | undefined): string {
  if (!relativePath) return "";
  const segments = relativePath.split(/[\\/]/).filter(Boolean);
  return segments.length >= 2 ? segments[segments.length - 2]! : "";
}

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

/** Makes one path segment safe on APFS, NTFS and exFAT. May return "". */
export function sanitizeSegment(value: string): string {
  let out = value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    // Windows strips trailing dots and spaces, which would silently merge names.
    .replace(/[. ]+$/, "");
  if (out === "." || out === "..") out = "";
  if (WINDOWS_RESERVED.test(out)) out = `_${out}`;
  // 255 UTF-16 units is the common limit; leave room for an extension and a counter.
  if (out.length > 200) out = out.slice(0, 200).trim();
  return out;
}

/**
 * Renders a template into path segments: every segment but the last is a
 * folder. Token values are sanitised; empty segments are dropped. Throws
 * `TemplateError` when nothing usable remains.
 */
export function renderTemplate(template: string, ctx: TemplateContext): string[] {
  const parts = parseTemplate(template);
  const clock = clockParts(ctx);
  const camera = cameraParts(ctx.cameraKey);
  const value = (token: TemplateToken, width?: number): string => {
    switch (token) {
      case "filename":
        return baseName(ctx.fileName);
      case "folder":
        return parentFolder(ctx.relativePath);
      case "date":
        return `${pad(clock.year, 4)}-${pad(clock.month, 2)}-${pad(clock.day, 2)}`;
      case "time":
        return `${pad(clock.hour, 2)}${pad(clock.minute, 2)}${pad(clock.second, 2)}`;
      case "yyyy":
        return pad(clock.year, 4);
      case "yy":
        return pad(clock.year % 100, 2);
      case "mm":
        return pad(clock.month, 2);
      case "dd":
        return pad(clock.day, 2);
      case "hh":
        return pad(clock.hour, 2);
      case "min":
        return pad(clock.minute, 2);
      case "ss":
        return pad(clock.second, 2);
      case "seq":
        return pad(Math.max(0, Math.floor(ctx.seq ?? 1)), width ?? 1);
      case "camera":
        return camera.model || camera.make;
      case "make":
        return camera.make;
      case "serial":
        return camera.serial;
      case "shootName":
        return ctx.shootName ?? "";
    }
  };

  // Literal "/" splits segments; token values cannot, because they are sanitised first.
  const segments: string[] = [""];
  for (const part of parts) {
    if (part.kind === "literal") {
      const pieces = part.text.split(/[\\/]/);
      segments[segments.length - 1] += pieces[0]!;
      for (const piece of pieces.slice(1)) segments.push(piece);
    } else {
      segments[segments.length - 1] += sanitizeSegment(value(part.token, part.pad)).replace(
        /[\\/]/g,
        "_",
      );
    }
  }
  const cleaned = segments.map(sanitizeSegment).filter(Boolean);
  if (!cleaned.length) throw new TemplateError("The template produced an empty name.");
  return cleaned;
}
