import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  fillEmptyPortfolioFields,
  normalizePortfolioSourceUrl,
  parsePortfolioImport,
  PORTFOLIO_IMPORT_MAX_BYTES,
  serializePortfolioImport,
} from "../src/lib/portfolio-import";

const html = `<title>River &amp; Light</title><meta content="Photography for people." name="description"><h1>Meet <b>the moment</b></h1><nav><a href="/work">Work</a><a href="/about">About</a></nav>`;
const parse = (value = html, fileName = "saved.html") => parsePortfolioImport(value, { fileName });

describe("file-only portfolio migration", () => {
  test("extracts supported text without importing media, theme, forms or scripts", () => {
    const plan = parse(
      `<script><title>Not the name</title></script><style>body{background:url('https://evil.com/a.jpg')}</style>${html}<img src="https://private.com/photo.jpg"><iframe src="https://evil.com"></iframe>`,
    );
    expect(plan.content).toEqual({
      name: "River & Light",
      bio: "Photography for people.",
      hero: "Meet the moment",
      nav: ["Work", "About"],
    });
    const serialized = serializePortfolioImport(plan);
    expect(serialized).not.toContain("private.com");
    expect(serialized).not.toContain("evil.com");
    expect(serialized).not.toContain("background");
    expect(plan.collections).toEqual([]);
  });
  test("HTML entities remain plain text, never executable markup", () => {
    expect(parse(`<title>&lt;img src=x onerror=alert(1)&gt; &#x1f4f7;</title>`).content.name).toBe(
      "<img src=x onerror=alert(1)> 📷",
    );
    expect(parse(`<title>&#99999999999; Hello</title>`).content.name).toBe("Hello");
  });
  test("non-destructive merge preserves edits, arrays and unrelated media", () => {
    const original = {
      name: "My edited name",
      bio: "",
      hero: "My headline",
      nav: ["Mine"],
      photos: [{ blob: new Blob(["original"]) }],
      theme: { bg: "#123456" },
    };
    const merged = fillEmptyPortfolioFields(original, parse().content);
    expect(merged.name).toBe(original.name);
    expect(merged.hero).toBe(original.hero);
    expect(merged.nav).toBe(original.nav);
    expect(merged.photos).toBe(original.photos);
    expect(merged.theme).toBe(original.theme);
    expect(merged.bio).toBe("Photography for people.");
    expect(original.bio).toBe("");
    expect(fillEmptyPortfolioFields(merged, parse().content)).toEqual(merged);
  });
  test("parses real documented Pixieset headers and discards private columns", () => {
    const csv =
      '\uFEFFCollection Name,First Name,Last Name,Email,Download PIN,Collection Password,Client Private Password,Folder Password,Collection URL\r\n"Game, one",PRIVATE_FIRST,PRIVATE_LAST,PRIVATE_EMAIL,PRIVATE_PIN,PRIVATE_COLLECTION,PRIVATE_CLIENT,PRIVATE_FOLDER,https://photo.pixieset.com/game?password=PRIVATE_QUERY#PRIVATE_FRAGMENT\r\n';
    const result = parse(csv, "folder.csv");
    expect(result.collections).toEqual([
      { name: "Game, one", url: "https://photo.pixieset.com/game" },
    ]);
    expect(result.content).toEqual({ name: "", bio: "", hero: "", nav: [] });
    expect(serializePortfolioImport(result)).not.toContain("PRIVATE_");
  });
  test("CSV quoted newlines/quotes parse and duplicate rows are preserved", () => {
    const result = parse(
      'Collection Name,Collection URL\n"A ""game""\nnight",https://photo.pixieset.com/game\nDuplicate,\nDuplicate,',
      "folder.csv",
    );
    expect(result.collections.map((r) => r.name)).toEqual([
      'A "game" night',
      "Duplicate",
      "Duplicate",
    ]);
  });
  test("unsafe CSV links are omitted without dropping collection names", () => {
    const result = parse(
      "Collection Name,Collection URL\nOne,javascript:alert(1)\nTwo,http://localhost/private\nThree,https://photo.pixieset.com/g?pin=secret",
      "folder.csv",
    );
    expect(result.collections).toEqual([
      { name: "One", url: null },
      { name: "Two", url: null },
      { name: "Three", url: "https://photo.pixieset.com/g" },
    ]);
    expect(result.warnings.join(" ")).toContain("2 unsafe");
    expect(serializePortfolioImport(result)).not.toContain("secret");
  });
  test("malformed CSV never partially imports", () => {
    for (const csv of [
      'Collection Name,Collection URL\n"unfinished',
      "Collection Name,Collection URL\nGood,https://photo.com\nBad,x,y",
      "Collection Name,Collection Name,Collection URL\nx,y,z",
      "Name,URL\nx,y",
      "Collection Name,Collection URL\n,https://photo.com",
      'Collection Name,Collection URL\n"hello"bad,url',
    ])
      expect(() => parse(csv, "x.csv")).toThrow();
  });
  test("bounds bytes, row count, field sizes, unsupported formats", () => {
    expect(() => parse("x".repeat(PORTFOLIO_IMPORT_MAX_BYTES + 1))).toThrow("2 MiB");
    expect(() => parse("📷".repeat(PORTFOLIO_IMPORT_MAX_BYTES / 2))).toThrow("2 MiB");
    expect(() =>
      parse("Collection Name,Collection URL\n" + "name,\n".repeat(1001), "x.csv"),
    ).toThrow("1,000");
    expect(() =>
      parse("Collection Name,Collection URL\n" + "x".repeat(8193) + ",", "x.csv"),
    ).toThrow("oversized");
    expect(() => parse(html, "site.zip")).toThrow("not supported");
    expect(() => parse(html, "site.xml")).toThrow("not supported");
    expect(() => parse(" ")).toThrow("empty");
    expect(() => parse("<img src=x>")).toThrow("No supported");
  });
  test("FOTO JSON round-trips and rejects foreign versions, hidden fields and URL mismatches", () => {
    const plan = parsePortfolioImport(html, { fileName: "x.html", sourceUrl: "riverphoto.com" });
    const serialized = serializePortfolioImport(plan);
    expect(parse(serialized, "plan.json")).toEqual(plan);
    expect(() => parse(JSON.stringify({ ...plan, version: 2 }), "plan.json")).toThrow("version 1");
    expect(() =>
      parse(JSON.stringify({ ...plan, password: "must not persist" }), "plan.json"),
    ).toThrow("not supported");
    expect(() =>
      parse(
        JSON.stringify({ ...plan, source: { ...plan.source, url: "javascript:alert(1)" } }),
        "plan.json",
      ),
    ).toThrow();
    expect(() =>
      parsePortfolioImport(serialized, { fileName: "plan.json", sourceUrl: "otherphoto.com" }),
    ).toThrow("does not match");
  });
  test("URL is credential-free provenance, not fetched or ownership verification", () => {
    expect(normalizePortfolioSourceUrl("YourPhoto.mypixieset.com/work?secret=1#pin")).toBe(
      "https://yourphoto.mypixieset.com/work",
    );
    for (const url of [
      "javascript:alert(1)",
      "data:text/html,foo",
      "file:///etc/passwd",
      "http://public.com",
      "https://name:password@photo.com",
      "https://photo.com:3000",
      "http://127.0.0.1",
      "https://127.1",
      "https://2130706433",
      "https://[::1]",
      "https://localhost",
      "https://dev.internal",
      "https://host.local",
      "https://photo.com\\@evil.com",
      "https://photo.com\n",
    ])
      expect(() => normalizePortfolioSourceUrl(url)).toThrow();
  });
  test("adversarial incomplete tags and varied plans stay bounded and deterministic", () => {
    expect(
      parse(`<title>Safe</title>${"<meta".repeat(20000)}${"<h1>".repeat(20000)}`).content.name,
    ).toBe("Safe");
    for (let i = 0; i < 1000; i++) {
      const plan = parse(`<title>Photographer ${i}</title><h1>Frame ${i * 7}</h1>`);
      expect(parse(serializePortfolioImport(plan), "plan.json")).toEqual(plan);
    }
  });
  test("UI/server source has no network importer or raw HTML execution", () => {
    const read = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
    for (const path of [
      "lib/portfolio-import.ts",
      "lib/portfolio-import.functions.ts",
      "components/portfolio/PortfolioImportPanel.tsx",
    ]) {
      const source = read(path);
      expect(source).not.toMatch(
        /\bfetch\s*\(|dangerouslySetInnerHTML|new DOMParser|createElement\(["'](?:iframe|script)/,
      );
    }
    const route = read("routes/portfolio.tsx");
    expect(route).toContain("fillEmptyPortfolioFields(current, proposed)");
    expect(route).toContain('key={account?.scope ?? "signed-out"}');
    expect(route).not.toContain("runImport");
    expect(route).not.toContain("publish in seconds");
  });
});
