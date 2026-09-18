import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { embedJpegXmp, readJpegXmp } from "../src/lib/studio/cull/handoff/jpeg-xmp";
import type { HandoffFrame } from "../src/lib/studio/cull/handoff/types";
import { parseXmlPure, XmlParseError } from "../src/lib/studio/cull/handoff/xml";
import {
  buildXmp,
  encodeXmp,
  frameXmpFields,
  mergeXmp,
  ratingForFrame,
  readXmp,
  sidecarName,
  XmpError,
} from "../src/lib/studio/cull/handoff/xmp";

const GOLDEN = `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Celinen">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description
      rdf:about=""
      xmlns:xmp="http://ns.adobe.com/xap/1.0/"
      xmlns:dc="http://purl.org/dc/elements/1.1/"
      xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/"
      xmlns:celinen="https://lenslab.dev/ns/celinen/1.0/"
      xmp:Rating="4"
      xmp:Label="Green"
      xmp:MetadataDate="2026-09-17T18:30:00.000Z"
      photoshop:Headline="Finals, set 3"
      celinen:Verdict="keep"
      celinen:Decided="false"
      celinen:Reason="best-of-burst"
      celinen:Score="81"
      celinen:Group="12"
      celinen:BestOfBurst="true"
      celinen:Duplicate="false">
   <dc:description>
    <rdf:Alt>
     <rdf:li xml:lang="x-default">Spike at the net</rdf:li>
    </rdf:Alt>
   </dc:description>
   <dc:subject>
    <rdf:Bag>
     <rdf:li>volleyball</rdf:li>
     <rdf:li>finals</rdf:li>
    </rdf:Bag>
   </dc:subject>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;

const frame = (overrides: Partial<HandoffFrame> = {}): HandoffFrame => ({
  id: "f1",
  name: "_DSC5098.ARW",
  captureTimeMs: null,
  verdict: "undecided",
  decided: false,
  suggestion: {
    verdict: "keep",
    reason: "best-of-burst",
    score: 81,
    group: 12,
    bestOfGroup: true,
    duplicate: false,
  },
  ...overrides,
});

/** A Lightroom Classic sidecar with develop settings, history and an unusual prefix for xmp. */
const LIGHTROOM_SIDECAR = `<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Adobe XMP Core 7.0-c000 1.000000, 0000/00/00-00:00:00        ">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:xap="http://ns.adobe.com/xap/1.0/"
    xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"
    xmlns:stEvt="http://ns.adobe.com/xap/1.0/sType/ResourceEvent#"
    xmlns:xmpMM="http://ns.adobe.com/xap/1.0/mm/"
    xmlns:dc="http://purl.org/dc/elements/1.1/"
   xap:Rating="2"
   xap:Label="Red"
   crs:Version="16.5"
   crs:Exposure2012="+0.35"
   crs:Temperature="5600">
   <xmpMM:History>
    <rdf:Seq>
     <rdf:li
      stEvt:action="saved"
      stEvt:softwareAgent="Adobe Photoshop Lightroom Classic 13.5 (Macintosh)"/>
    </rdf:Seq>
   </xmpMM:History>
   <crs:ToneCurvePV2012>
    <rdf:Seq>
     <rdf:li>0, 0</rdf:li>
     <rdf:li>255, 255</rdf:li>
    </rdf:Seq>
   </crs:ToneCurvePV2012>
   <dc:subject>
    <rdf:Bag>
     <rdf:li>existing keyword</rdf:li>
    </rdf:Bag>
   </dc:subject>
   <dc:description>
    <rdf:Alt>
     <rdf:li xml:lang="x-default">Old caption</rdf:li>
     <rdf:li xml:lang="fr-FR">Légende</rdf:li>
    </rdf:Alt>
   </dc:description>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
`;

function xmllintOk(xml: string): boolean | null {
  const probe = spawnSync("xmllint", ["--version"]);
  if (probe.error) return null;
  const dir = mkdtempSync(join(tmpdir(), "celinen-xmp-"));
  const path = join(dir, "packet.xmp");
  writeFileSync(path, xml);
  return spawnSync("xmllint", ["--noout", path]).status === 0;
}

describe("buildXmp", () => {
  test("matches the golden sidecar byte for byte", () => {
    const packet = buildXmp({
      ...frameXmpFields(
        frame(),
        {
          keywords: ["volleyball", "finals"],
          headline: "Finals, set 3",
          caption: "Spike at the net",
          metadataDate: "2026-09-17T18:30:00.000Z",
        },
        { labels: { keep: "Green", reject: null, undecided: null, bestOfBurst: null } },
      ),
    });
    expect(packet).toBe(GOLDEN);
    expect(xmllintOk(packet)).not.toBe(false);
  });

  test("is UTF-8 with no byte-order mark before the packet, and the xpacket BOM inside", () => {
    const bytes = encodeXmp(buildXmp({ rating: 3, caption: "Zoë — 🏐" }));
    expect([...bytes.slice(0, 5)]).toEqual([...new TextEncoder().encode("<?xpa")]);
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain('begin="\uFEFF"');
    expect(readXmp(text).caption).toBe("Zoë — 🏐");
  });

  test("escapes markup in every field and survives a round trip", () => {
    const nasty = `A & B <c> "d" 'e' ]]> \t tab\nline\r\nwindows`;
    const packet = buildXmp({
      rating: 5,
      label: `Purple"><x`,
      keywords: [nasty, "</rdf:li>"],
      headline: nasty,
      caption: nasty,
    });
    expect(packet).not.toContain("<c>");
    expect(packet).toContain('photoshop:Headline="A &amp; B &lt;c&gt; &quot;d&quot;');
    expect(packet).toContain("tab&#xA;line&#xD;&#xA;windows");
    expect(xmllintOk(packet)).not.toBe(false);
    const read = readXmp(packet);
    expect(read.label).toBe(`Purple"><x`);
    expect(read.headline).toBe(nasty);
    expect(read.caption).toBe(nasty);
    expect(read.keywords).toEqual([nasty.trim(), "</rdf:li>"]);
  });

  test("drops characters XML 1.0 cannot carry instead of corrupting the file", () => {
    const packet = buildXmp({ caption: "bell\u0007 nul\u0000 ok" });
    expect(readXmp(packet).caption).toBe("bell nul ok");
  });

  test("rejects ratings outside -1..5", () => {
    expect(() => buildXmp({ rating: 6 })).toThrow(RangeError);
    expect(() => buildXmp({ rating: 2.5 })).toThrow(RangeError);
    expect(() => buildXmp({ rating: -2 })).toThrow(RangeError);
  });

  test("pads for in-place editors when asked", () => {
    const packet = buildXmp({ rating: 1 }, { padding: 2048 });
    expect(packet.length - buildXmp({ rating: 1 }).length).toBe(2048);
    expect(packet.endsWith('<?xpacket end="w"?>')).toBe(true);
  });
});

describe("mergeXmp", () => {
  const merged = mergeXmp(LIGHTROOM_SIDECAR, {
    rating: -1,
    label: null,
    keywords: ["celinen"],
    caption: "New caption",
    celinen: { verdict: "reject", decided: true, reason: "out-of-focus", score: 12 },
  });

  test("keeps develop settings, history and other namespaces", () => {
    for (const kept of [
      'crs:Version="16.5"',
      'crs:Exposure2012="+0.35"',
      'crs:Temperature="5600"',
      "<crs:ToneCurvePV2012>",
      "<rdf:li>255, 255</rdf:li>",
      'stEvt:softwareAgent="Adobe Photoshop Lightroom Classic 13.5 (Macintosh)"',
      'xmlns:xmpMM="http://ns.adobe.com/xap/1.0/mm/"',
      'x:xmptk="Adobe XMP Core 7.0-c000 1.000000, 0000/00/00-00:00:00        "',
    ]) {
      expect(merged).toContain(kept);
    }
    expect(xmllintOk(merged)).not.toBe(false);
  });

  test("rewrites the rating through the file's own prefix, once", () => {
    expect(merged).toContain('xap:Rating="-1"');
    expect(merged).not.toContain("xmp:Rating");
    expect(merged.match(/Rating=/g)).toHaveLength(1);
    expect(merged).not.toContain("Label=");
  });

  test("merges keywords and keeps other caption languages", () => {
    const read = readXmp(merged);
    expect(read.rating).toBe(-1);
    expect(read.keywords).toEqual(["existing keyword", "celinen"]);
    expect(read.caption).toBe("New caption");
    expect(merged).toContain('<rdf:li xml:lang="fr-FR">Légende</rdf:li>');
    expect(read.celinen).toMatchObject({
      Verdict: "reject",
      Decided: "true",
      Reason: "out-of-focus",
      Score: "12",
    });
    expect(read.celinen.Group).toBeUndefined();
  });

  test("keyword replace mode swaps the list", () => {
    const replaced = mergeXmp(
      LIGHTROOM_SIDECAR,
      { keywords: ["only"] },
      { keywordMode: "replace" },
    );
    expect(readXmp(replaced).keywords).toEqual(["only"]);
  });

  test("undefined fields leave the packet's values alone", () => {
    const untouched = mergeXmp(LIGHTROOM_SIDECAR, { headline: "H" });
    const read = readXmp(untouched);
    expect(read.rating).toBe(2);
    expect(read.label).toBe("Red");
    expect(read.caption).toBe("Old caption");
  });

  test("is idempotent", () => {
    const fields = { rating: 3, keywords: ["a"], caption: "c" };
    const once = mergeXmp(LIGHTROOM_SIDECAR, fields);
    expect(mergeXmp(once, fields)).toBe(once);
  });

  test("replaces element-form properties and keeps unknown elements", () => {
    const elementForm = `<?xml version="1.0" encoding="UTF-8"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:pm="http://ns.camerabits.com/photomechanic/1.0/">
   <xmp:Rating>3</xmp:Rating>
   <pm:ColorClass>2</pm:ColorClass>
   <!-- tagged by Photo Mechanic -->
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>`;
    const out = mergeXmp(elementForm, { rating: 5 });
    expect(out).not.toContain("<xmp:Rating>");
    expect(out).toContain('xmp:Rating="5"');
    expect(out).toContain("<pm:ColorClass>2</pm:ColorClass>");
    expect(out).toContain("<!-- tagged by Photo Mechanic -->");
    expect(out).not.toContain("<?xml");
  });

  test("declares a namespace under a free prefix when ours is taken", () => {
    const clash = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:celinen="urn:someone-else" celinen:Verdict="theirs"/></rdf:RDF></x:xmpmeta>`;
    const out = mergeXmp(clash, {
      celinen: { verdict: "keep", decided: true },
    });
    expect(out).toContain('celinen:Verdict="theirs"');
    expect(out).toContain('xmlns:celinen1="https://lenslab.dev/ns/celinen/1.0/"');
    expect(out).toContain('celinen1:Verdict="keep"');
  });

  test("adds a Description when the packet has none", () => {
    const bare = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"></rdf:RDF></x:xmpmeta>`;
    expect(readXmp(mergeXmp(bare, { rating: 4 })).rating).toBe(4);
  });

  test("refuses to replace a sidecar it cannot read", () => {
    expect(() => mergeXmp("<x:xmpmeta><rdf:RDF>", { rating: 1 })).toThrow(XmpError);
    expect(() => mergeXmp("not xml at all", { rating: 1 })).toThrow(XmpError);
    expect(() => mergeXmp("<root/>", { rating: 1 })).toThrow(XmpError);
  });
});

describe("pure XML parser", () => {
  test("decodes entities, CDATA and character references", () => {
    const doc = parseXmlPure(
      `<a b="x &amp; &#x41;&#66;">t&lt;<![CDATA[<raw>]]><!--c--><?pi data?></a>`,
    );
    const root = doc.children[0]!;
    expect(root.type).toBe("element");
    if (root.type !== "element") return;
    expect(root.attrs[0]!.value).toBe("x & AB");
    expect(root.children.map((c) => c.type)).toEqual(["text", "cdata", "comment", "pi"]);
  });

  test("rejects malformed and entity-declaring documents", () => {
    for (const bad of [
      "<a>",
      "<a></b>",
      "<a b='1' b='2'/>",
      "<a>&unknown;</a>",
      "<a/><b/>",
      '<!DOCTYPE a [<!ENTITY x "boom">]><a>&x;</a>',
      "<a>&</a>",
    ]) {
      expect(() => parseXmlPure(bad)).toThrow(XmlParseError);
    }
  });
});

describe("sidecar naming", () => {
  test("follows Lightroom", () => {
    expect(sidecarName("_DSC5098.ARW")).toBe("_DSC5098.xmp");
    expect(sidecarName("IMG_0001.CR3")).toBe("IMG_0001.xmp");
    expect(sidecarName("game.day.NEF")).toBe("game.day.xmp");
    expect(sidecarName("NOEXT")).toBe("NOEXT.xmp");
  });

  test("gives JPEG, TIFF, PNG and DNG no sidecar unless asked", () => {
    for (const name of ["a.JPG", "a.jpeg", "a.tif", "a.png", "a.dng", "a.psd"]) {
      expect(sidecarName(name)).toBeNull();
    }
    expect(sidecarName("a.JPG", { includeEmbedding: true })).toBe("a.xmp");
  });

  test("supports the append convention", () => {
    expect(sidecarName("_DSC5098.ARW", { style: "append" })).toBe("_DSC5098.ARW.xmp");
  });
});

describe("frame mapping", () => {
  test("rejects are -1 whatever stars they had", () => {
    expect(ratingForFrame(frame({ decided: true, verdict: "reject", rating: 4 }))).toBe(-1);
  });

  test("keepers take score bands, a photographer's stars win", () => {
    const keep = (score: number) =>
      frame({ suggestion: { ...frame().suggestion!, score, verdict: "keep" } });
    expect(ratingForFrame(keep(95))).toBe(5);
    expect(ratingForFrame(keep(80))).toBe(4);
    expect(ratingForFrame(keep(60))).toBe(3);
    expect(ratingForFrame(keep(31))).toBe(2);
    expect(ratingForFrame(keep(3))).toBe(1);
    expect(ratingForFrame({ ...keep(95), rating: 2 })).toBe(2);
    expect(ratingForFrame(frame({ suggestion: undefined, decided: true, verdict: "keep" }))).toBe(
      3,
    );
  });

  test("undecided frames leave the rating alone by default", () => {
    const undecided = frame({ suggestion: undefined });
    expect(ratingForFrame(undecided)).toBeNull();
    expect(frameXmpFields(undecided).rating).toBeUndefined();
    expect(ratingForFrame(undecided, { undecidedRating: 0 })).toBe(0);
  });

  test("labels are opt-in, and once on, a verdict without one clears a stale label", () => {
    expect(frameXmpFields(frame()).label).toBeUndefined();
    const labels = { keep: "Green", reject: null, undecided: null, bestOfBurst: "Purple" };
    expect(frameXmpFields(frame(), {}, { labels }).label).toBe("Purple");
    expect(
      frameXmpFields(frame({ decided: true, verdict: "reject" }), {}, { labels }).label,
    ).toBeNull();
  });

  test("the photographer's decision is recorded as theirs", () => {
    const fields = frameXmpFields(frame({ decided: true, verdict: "reject" }));
    expect(fields.celinen).toMatchObject({ verdict: "reject", decided: true, score: 81 });
    expect(frameXmpFields(frame(), {}, { writeCelinen: false }).celinen).toBeUndefined();
  });
});

/** SOI, JFIF APP0, a DQT stub, SOS and a few scan bytes, EOI. */
function tinyJpeg(): Uint8Array {
  const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0];
  const dqt = [0xff, 0xdb, 0x00, 0x04, 0x00, 0x01];
  const sos = [0xff, 0xda, 0x00, 0x04, 0x01, 0x00, 0x12, 0x34, 0x56];
  return new Uint8Array([0xff, 0xd8, ...app0, ...dqt, ...sos, 0xff, 0xd9]);
}

describe("JPEG embedding", () => {
  test("inserts XMP after JFIF and leaves the image data byte-identical", async () => {
    const original = tinyJpeg();
    const blob = new Blob([original as BlobPart], { type: "image/jpeg" });
    expect(await readJpegXmp(blob)).toBeNull();
    const embedded = await embedJpegXmp(blob, () => buildXmp({ rating: 4 }));
    const bytes = new Uint8Array(await embedded.arrayBuffer());
    expect([bytes[20], bytes[21]]).toEqual([0xff, 0xe1]);
    // Everything after the new segment is the original from DQT on.
    const tail = original.slice(20);
    expect([...bytes.slice(bytes.length - tail.length)]).toEqual([...tail]);
    expect(readXmp((await readJpegXmp(embedded))!).rating).toBe(4);
  });

  test("replaces an existing packet in place, merging into it", async () => {
    const first = await embedJpegXmp(new Blob([tinyJpeg() as BlobPart]), () =>
      buildXmp({ rating: 2, keywords: ["kept"] }),
    );
    const second = await embedJpegXmp(first, (existing) =>
      mergeXmp(existing!, { rating: 5, keywords: ["added"] }),
    );
    const bytes = new Uint8Array(await second.arrayBuffer());
    const header = new TextEncoder().encode("http://ns.adobe.com/xap/1.0/\0");
    let count = 0;
    for (let i = 0; i + header.length < bytes.length; i++) {
      if (header.every((b, j) => bytes[i + j] === b)) count++;
    }
    expect(count).toBe(1);
    const read = readXmp((await readJpegXmp(second))!);
    expect(read.rating).toBe(5);
    expect(read.keywords).toEqual(["kept", "added"]);
  });

  test("a real camera JPEG still decodes after embedding", async () => {
    const path = new URL("fixtures/photos/volleyball-portrait-cc0.jpg", import.meta.url);
    const source = new Uint8Array(readFileSync(path));
    const embedded = await embedJpegXmp(new Blob([source as BlobPart]), (existing) =>
      existing ? mergeXmp(existing, { rating: 3 }) : buildXmp({ rating: 3 }, { padding: 2048 }),
    );
    const out = new Uint8Array(await embedded.arrayBuffer());
    expect(readXmp((await readJpegXmp(new Blob([out as BlobPart])))!).rating).toBe(3);
    const sips = spawnSync("sips", ["--version"]);
    if (sips.error) return; // macOS-only decoder check
    const dir = mkdtempSync(join(tmpdir(), "celinen-jpeg-"));
    const file = join(dir, "embedded.jpg");
    writeFileSync(file, out);
    const result = spawnSync("sips", ["-g", "pixelWidth", file], { encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/pixelWidth: \d+/);
  });

  test("refuses a file that is not a JPEG", async () => {
    await expect(embedJpegXmp(new Blob(["GIF89a"]), () => "")).rejects.toThrow("Not a JPEG");
  });
});
