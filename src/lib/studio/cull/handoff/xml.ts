/** A small, namespace-aware XML tree for editing XMP packets.
 *
 * Merging into a sidecar must keep everything we do not understand — develop
 * settings, crop, history, another app's namespace — byte-for-byte in meaning.
 * So the packet is read into this tree, edited, and written back whole.
 *
 * Parsing uses the browser's DOMParser when there is one (a strict,
 * well-tested parser) and the pure parser below otherwise (bun tests, workers
 * without DOM). Both produce the same tree, and editing and serialising only
 * ever see the tree, so the path that is tested is the path that ships.
 */

export type XmlAttr = {
  /** The qualified name as written, e.g. `xmp:Rating` or `xmlns:dc`. */
  name: string;
  value: string;
};

export type XmlElement = {
  type: "element";
  /** The qualified name as written. */
  name: string;
  attrs: XmlAttr[];
  children: XmlNode[];
};

export type XmlNode =
  | XmlElement
  | { type: "text"; value: string }
  | { type: "cdata"; value: string }
  | { type: "comment"; value: string }
  | { type: "pi"; target: string; data: string }
  | { type: "doctype"; value: string };

export type XmlDocument = { children: XmlNode[] };

export class XmlParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XmlParseError";
  }
}

export const XML_NS = "http://www.w3.org/XML/1998/namespace";
export const XMLNS_NS = "http://www.w3.org/2000/xmlns/";

// ---------------------------------------------------------------------------
// Parsing

type DomParserCtor = new () => { parseFromString(text: string, type: string): Document };

/** Parses with DOMParser when the runtime has one, the pure parser otherwise. */
export function parseXml(text: string, domParser?: DomParserCtor | null): XmlDocument {
  const Parser =
    domParser === undefined
      ? (globalThis as { DOMParser?: DomParserCtor }).DOMParser
      : (domParser ?? undefined);
  if (Parser) return parseWithDom(text, Parser);
  return parseXmlPure(text);
}

function parseWithDom(text: string, Parser: DomParserCtor): XmlDocument {
  const doc = new Parser().parseFromString(text, "application/xml");
  // Browsers report malformed XML as a document containing <parsererror>.
  if (doc.getElementsByTagName("parsererror").length > 0) {
    throw new XmlParseError("The XMP packet is not well-formed XML.");
  }
  const convert = (node: Node): XmlNode | null => {
    switch (node.nodeType) {
      case 1: {
        const element = node as Element;
        const attrs: XmlAttr[] = [];
        for (let i = 0; i < element.attributes.length; i++) {
          const attr = element.attributes[i]!;
          attrs.push({ name: attr.name, value: attr.value });
        }
        return {
          type: "element",
          name: element.tagName,
          attrs,
          children: Array.from(element.childNodes)
            .map(convert)
            .filter((child): child is XmlNode => child !== null),
        };
      }
      case 3:
        return { type: "text", value: node.nodeValue ?? "" };
      case 4:
        return { type: "cdata", value: node.nodeValue ?? "" };
      case 7: {
        const pi = node as ProcessingInstruction;
        return { type: "pi", target: pi.target, data: pi.data };
      }
      case 8:
        return { type: "comment", value: node.nodeValue ?? "" };
      case 10: {
        const doctype = node as DocumentType;
        return { type: "doctype", value: doctype.name };
      }
      default:
        return null;
    }
  };
  const children = Array.from(doc.childNodes)
    .map(convert)
    .filter((child): child is XmlNode => child !== null);
  // DOMParser drops the whitespace between the prolog nodes; that whitespace
  // carries no meaning outside the root element, so nothing is lost.
  return { children };
}

const NAME_START = /[A-Za-z_:\u00C0-\uFFFF]/;
const NAME_CHAR = /[A-Za-z0-9_:.\-\u00B7\u00C0-\uFFFF]/;

/** A strict-enough XML 1.0 parser for XMP: elements, attributes, text,
 * CDATA, comments, processing instructions and a DOCTYPE without an internal
 * subset. Entities beyond the five predefined and character references are
 * rejected rather than guessed at. */
export function parseXmlPure(text: string): XmlDocument {
  let at = 0;
  const root: XmlDocument = { children: [] };
  const stack: { element: XmlElement | null; children: XmlNode[] }[] = [
    { element: null, children: root.children },
  ];
  let sawRoot = false;

  const fail = (message: string): never => {
    throw new XmlParseError(`${message} (at offset ${at}).`);
  };
  const top = () => stack[stack.length - 1]!;

  const readName = (): string => {
    const start = at;
    if (!NAME_START.test(text[at] ?? "")) fail("Expected a name");
    at++;
    while (at < text.length && NAME_CHAR.test(text[at]!)) at++;
    return text.slice(start, at);
  };
  const skipSpace = () => {
    while (at < text.length && /[\s]/.test(text[at]!)) at++;
  };

  while (at < text.length) {
    if (text.startsWith("<!--", at)) {
      const end = text.indexOf("-->", at + 4);
      if (end < 0) fail("Unterminated comment");
      top().children.push({ type: "comment", value: text.slice(at + 4, end) });
      at = end + 3;
    } else if (text.startsWith("<![CDATA[", at)) {
      if (stack.length === 1) fail("CDATA outside the root element");
      const end = text.indexOf("]]>", at + 9);
      if (end < 0) fail("Unterminated CDATA section");
      top().children.push({ type: "cdata", value: text.slice(at + 9, end) });
      at = end + 3;
    } else if (text.startsWith("<!DOCTYPE", at)) {
      if (stack.length > 1 || sawRoot) fail("DOCTYPE after the root element");
      const end = text.indexOf(">", at);
      if (end < 0) fail("Unterminated DOCTYPE");
      const body = text.slice(at + 9, end);
      // An internal subset can declare entities; XMP never needs one.
      if (body.includes("[")) fail("DOCTYPE internal subsets are not supported");
      top().children.push({ type: "doctype", value: body.trim() });
      at = end + 1;
    } else if (text.startsWith("<?", at)) {
      at += 2;
      const target = readName();
      const end = text.indexOf("?>", at);
      if (end < 0) fail("Unterminated processing instruction");
      const data = text.slice(at, end).replace(/^\s+/, "");
      // The XML declaration is dropped, as DOMParser drops it: the packet is
      // always written back as UTF-8, where a stale `encoding=` would lie.
      if (target.toLowerCase() === "xml") {
        if (root.children.length > 0 || stack.length > 1 || sawRoot) {
          fail("XML declaration must come first");
        }
      } else {
        top().children.push({ type: "pi", target, data });
      }
      at = end + 2;
    } else if (text.startsWith("</", at)) {
      at += 2;
      const name = readName();
      skipSpace();
      if (text[at] !== ">") fail("Expected '>'");
      at++;
      const open = top().element;
      if (!open || open.name !== name) fail(`Mismatched closing tag </${name}>`);
      stack.pop();
    } else if (text[at] === "<") {
      at++;
      if (stack.length === 1 && sawRoot) fail("More than one root element");
      const name = readName();
      const element: XmlElement = { type: "element", name, attrs: [], children: [] };
      const seen = new Set<string>();
      for (;;) {
        const before = at;
        skipSpace();
        if (text.startsWith("/>", at)) {
          at += 2;
          top().children.push(element);
          if (stack.length === 1) sawRoot = true;
          break;
        }
        if (text[at] === ">") {
          at++;
          top().children.push(element);
          if (stack.length === 1) sawRoot = true;
          stack.push({ element, children: element.children });
          break;
        }
        if (at === before) fail("Expected whitespace between attributes");
        const attrName = readName();
        skipSpace();
        if (text[at] !== "=") fail("Expected '=' after attribute name");
        at++;
        skipSpace();
        const quote = text[at];
        if (quote !== '"' && quote !== "'") fail("Expected a quoted attribute value");
        const end = text.indexOf(quote!, at + 1);
        if (end < 0) fail("Unterminated attribute value");
        const raw = text.slice(at + 1, end);
        if (raw.includes("<")) fail("'<' in attribute value");
        if (seen.has(attrName)) fail(`Duplicate attribute ${attrName}`);
        seen.add(attrName);
        // Attribute-value normalisation: literal whitespace becomes a space.
        element.attrs.push({
          name: attrName,
          value: decodeEntities(raw.replace(/[\t\n\r]/g, " "), fail),
        });
        at = end + 1;
      }
    } else {
      const next = text.indexOf("<", at);
      const end = next < 0 ? text.length : next;
      const raw = text.slice(at, end);
      if (stack.length === 1) {
        // Outside the root only whitespace (and a leading BOM) is allowed.
        if (raw.replace(/^\uFEFF/, "").trim()) fail("Text outside the root element");
      } else {
        top().children.push({ type: "text", value: decodeEntities(raw, fail) });
      }
      at = end;
    }
  }
  if (stack.length > 1) fail(`Unclosed element <${top().element!.name}>`);
  if (!sawRoot) fail("No root element");
  return root;
}

function decodeEntities(raw: string, fail: (message: string) => never): string {
  if (!raw.includes("&")) return raw;
  return raw.replace(/&([^;]*);|&/g, (match, body: string | undefined) => {
    if (body === undefined) return fail("Bare '&'");
    switch (body) {
      case "lt":
        return "<";
      case "gt":
        return ">";
      case "amp":
        return "&";
      case "quot":
        return '"';
      case "apos":
        return "'";
    }
    const numeric = /^#(?:x([0-9A-Fa-f]+)|([0-9]+))$/.exec(body);
    if (!numeric) return fail(`Unknown entity &${body};`);
    const code = numeric[1] !== undefined ? parseInt(numeric[1], 16) : parseInt(numeric[2]!, 10);
    if (!Number.isFinite(code) || code < 1 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff))
      return fail(`Invalid character reference ${match}`);
    return String.fromCodePoint(code);
  });
}

// ---------------------------------------------------------------------------
// Serialising

/** Escapes character data. `>` is escaped too so `]]>` can never appear. */
export function escapeText(value: string): string {
  return stripInvalidXmlChars(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\r/g, "&#xD;"); // a literal CR would be normalised away on read
}

/** Escapes an attribute value for double quotes. Tabs and newlines become
 * character references so a parser's normalisation cannot flatten them. */
export function escapeAttr(value: string): string {
  return stripInvalidXmlChars(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\t/g, "&#x9;")
    .replace(/\n/g, "&#xA;")
    .replace(/\r/g, "&#xD;");
}

/** XML 1.0 cannot carry most control characters or lone surrogates, even as
 * references. A caption pasted from somewhere odd must not make the whole
 * sidecar unreadable, so those characters are dropped. */
export function stripInvalidXmlChars(value: string): string {
  return value.replace(
    // eslint-disable-next-line no-control-regex
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
    "",
  );
}

export function serializeXml(doc: XmlDocument): string {
  let out = "";
  const write = (node: XmlNode, indent: string) => {
    switch (node.type) {
      case "element": {
        out += `<${node.name}`;
        // Adobe's layout: a long attribute list gets one attribute per line.
        const separator = node.attrs.length > 2 ? `\n${indent}    ` : " ";
        for (const attr of node.attrs)
          out += `${separator}${attr.name}="${escapeAttr(attr.value)}"`;
        if (!node.children.length) {
          out += "/>";
          return;
        }
        out += ">";
        let childIndent = `${indent} `;
        for (const child of node.children) {
          if (child.type === "text") {
            const newline = child.value.lastIndexOf("\n");
            if (newline >= 0 && /^[ \t]*$/.test(child.value.slice(newline + 1)))
              childIndent = child.value.slice(newline + 1);
          }
          write(child, childIndent);
        }
        out += `</${node.name}>`;
        return;
      }
      case "text":
        out += escapeText(node.value);
        return;
      case "cdata":
        // A CDATA section cannot contain its own terminator; split it.
        out += `<![CDATA[${node.value.replace(/]]>/g, "]]]]><![CDATA[>")}]]>`;
        return;
      case "comment":
        out += `<!--${node.value}-->`;
        return;
      case "pi":
        out += `<?${node.target}${node.data ? ` ${node.data}` : ""}?>`;
        return;
      case "doctype":
        out += `<!DOCTYPE ${node.value}>`;
        return;
    }
  };
  doc.children.forEach((child, index) => {
    // Keep prolog nodes on their own lines, as every XMP writer does.
    if (index > 0 && child.type !== "text") {
      const previous = doc.children[index - 1]!;
      if (previous.type !== "text") out += "\n";
    }
    write(child, "");
  });
  return out;
}

// ---------------------------------------------------------------------------
// Namespaces

/** Resolves a qualified name against the declarations in scope. */
export function namespaceOf(
  qualifiedName: string,
  scope: ReadonlyMap<string, string>,
  isAttribute: boolean,
): { uri: string | null; local: string; prefix: string | null } {
  const colon = qualifiedName.indexOf(":");
  if (colon < 0) {
    // Unprefixed attributes are in no namespace; unprefixed elements take the default.
    return {
      uri: isAttribute ? null : (scope.get("") ?? null),
      local: qualifiedName,
      prefix: null,
    };
  }
  const prefix = qualifiedName.slice(0, colon);
  const local = qualifiedName.slice(colon + 1);
  if (prefix === "xml") return { uri: XML_NS, local, prefix };
  if (prefix === "xmlns") return { uri: XMLNS_NS, local, prefix };
  return { uri: scope.get(prefix) ?? null, local, prefix };
}

/** The namespace declarations in scope inside `element`, given its parent's. */
export function scopeFor(
  element: XmlElement,
  parent: ReadonlyMap<string, string>,
): Map<string, string> {
  let scope: Map<string, string> | null = null;
  for (const attr of element.attrs) {
    if (attr.name === "xmlns" || attr.name.startsWith("xmlns:")) {
      scope ??= new Map(parent);
      scope.set(attr.name === "xmlns" ? "" : attr.name.slice(6), attr.value);
    }
  }
  return scope ?? new Map(parent);
}

export function textContent(node: XmlNode): string {
  switch (node.type) {
    case "text":
    case "cdata":
      return node.value;
    case "element":
      return node.children.map(textContent).join("");
    default:
      return "";
  }
}
