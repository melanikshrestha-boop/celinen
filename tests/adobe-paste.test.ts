import { describe, expect, test } from "bun:test";
import { DEFAULT_EDITS, buildXmpSidecar } from "../src/lib/imaging";
import {
  ADOBE_PASTE_MAX_CHARS,
  parseAdobeSettingsPaste,
  type AdobeSettingsPastePlan,
} from "../src/lib/studio/adobe-paste";

const CRS = "http://ns.adobe.com/camera-raw-settings/1.0/";
const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const description = (attributes: string, children = "") =>
  `<rdf:Description xmlns:rdf="${RDF}" xmlns:crs="${CRS}" ${attributes}>${children}</rdf:Description>`;
const xmp = (attributes: string, children = "") =>
  `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="${RDF}">${description(attributes, children)}</rdf:RDF></x:xmpmeta>`;

function plan(input: string): AdobeSettingsPastePlan {
  const result = parseAdobeSettingsPaste(input);
  expect(result?.kind).toBe("plan");
  if (result?.kind !== "plan") throw new Error(JSON.stringify(result));
  return result;
}

function refusal(input: string) {
  const result = parseAdobeSettingsPaste(input);
  expect(result?.kind).toBe("refusal");
  if (result?.kind !== "refusal") throw new Error(JSON.stringify(result));
  expect(result.reason).toContain("Nothing has been applied");
  expect(result).not.toHaveProperty("edits");
  return result;
}

describe("Adobe paste: explicit global tone plans", () => {
  test("friendly lines are absolute values with existing EV scaling", () => {
    const result = plan("Exposure +0.5\nContrast -10\nHighlights -40\nShadows +20\nSaturation -5");
    expect(result.edits).toEqual({
      exposure: 10,
      contrast: -10,
      highlights: -40,
      shadows: 20,
      saturation: -5,
    });
    expect(result.format).toBe("lines");
    expect(result.summary).toContain("5 supported");
    expect(result.summary).toContain("absolute values");
    expect(result.warnings.join(" ")).toContain("not Adobe RAW processing");
    expect(result.edits).not.toHaveProperty("temp");
    expect(result.edits).not.toHaveProperty("crop");
  });
  test("headers, names, bullets, case, equals, tabs and EV suffix are supported", () => {
    const result = plan(
      "Lightroom Classic settings:\nPreset: Evening match\nBasic:\n- EXPOSURE: +.50 EV\n* contrast = −10\nShadows\t20\n",
    );
    expect(result.name).toBe("Evening match");
    expect(result.edits).toEqual({ exposure: 10, contrast: -10, shadows: 20 });
  });
  test("zero and edge values are kept, absent controls are not reset", () => {
    expect(plan("Exposure 0\nContrast 0\nSaturation 0").edits).toEqual({
      exposure: 0,
      contrast: 0,
      saturation: 0,
    });
    expect(plan("Contrast +12").edits).toEqual({ contrast: 12 });
    expect(plan("Exposure -5\nHighlights -100\nShadows 100").edits).toEqual({
      exposure: -100,
      highlights: -100,
      shadows: 100,
    });
    expect(plan("Exposure 0.000000001").edits.exposure).toBeCloseTo(0.00000002, 12);
  });
  test("attribute-style values work in a full Adobe XMP packet", () => {
    const source = `<?xml version="1.0" encoding="UTF-8"?>\n<?xpacket begin="${String.fromCodePoint(0xfeff)}" id="W5M0MpCehiHzreSzNTczkc9d"?>\n${xmp('crs:Exposure2012="+0.5" crs:Contrast2012="-10" crs:Highlights2012="-40" crs:Shadows2012="20" crs:Saturation="-5"')}\n<?xpacket end="w"?>`;
    const result = plan(source);
    expect(result.format).toBe("xmp");
    expect(result.edits).toEqual({
      exposure: 10,
      contrast: -10,
      highlights: -40,
      shadows: 20,
      saturation: -5,
    });
  });
  test("element-style and single-quoted/self-closing attributes work", () => {
    expect(
      plan(
        description(
          "crs:Contrast2012='-8'",
          "<crs:Exposure2012> +1.25 </crs:Exposure2012><crs:Saturation>-6</crs:Saturation>",
        ),
      ).edits,
    ).toEqual({ exposure: 25, contrast: -8, saturation: -6 });
    expect(
      plan(`<rdf:Description xmlns:rdf='${RDF}' xmlns:crs='${CRS}' crs:Exposure2012='1'/>`).edits,
    ).toEqual({ exposure: 20 });
  });
  test("namespace identity, not the literal crs prefix, identifies Adobe values", () => {
    expect(
      plan(
        `<r:RDF xmlns:r="${RDF}"><r:Description xmlns:raw="${CRS}" raw:Exposure2012="0.5"><raw:Saturation>5</raw:Saturation></r:Description></r:RDF>`,
      ).edits,
    ).toEqual({ exposure: 10, saturation: 5 });
    expect(
      plan(`<Description xmlns="${RDF}" xmlns:crs="${CRS}" crs:Exposure2012="0.5"/>`).edits,
    ).toEqual({ exposure: 10 });
  });
  test("complete XML/text code fences are treated as data", () => {
    expect(plan(`\`\`\`xml\n${xmp('crs:Exposure2012="0.5"')}\n\`\`\``).edits).toEqual({
      exposure: 10,
    });
    expect(plan("```text\nExposure +0.5\n``` ").edits).toEqual({ exposure: 10 });
  });
  test("generated sidecar imports only permitted edits, never Kelvin/rating/pick", () => {
    const result = plan(buildXmpSidecar({ ...DEFAULT_EDITS, exposure: 20, temp: 40 }, "keep", 5));
    expect(result.edits).toEqual({
      exposure: 20,
      contrast: 0,
      highlights: 0,
      shadows: 0,
      saturation: 0,
    });
    expect(result).not.toHaveProperty("rating");
    expect(result).not.toHaveProperty("pick");
    expect(result.warnings.join(" ")).toContain("Kelvin");
  });
});

describe("unsupported settings are disclosed, not invented or applied", () => {
  test.each(["Temperature 5500", "Temperature +10", "White Balance: As Shot", "Tint +12"])(
    "%s never becomes warmth",
    (field) => {
      const result = plan(`Exposure +0.5\n${field}`);
      expect(result.edits).toEqual({ exposure: 10 });
      expect(result.warnings.join(" ")).toContain("white balance/Kelvin");
    },
  );
  test("XML Kelvin is excluded even when the legacy mapper would convert it", () => {
    const result = plan(xmp('crs:Exposure2012="0.5" crs:Temperature="10000" crs:Tint="20"'));
    expect(result.edits).toEqual({ exposure: 10 });
    for (const label of ["Temperature", "Tint"])
      expect(result.warnings.some((entry) => entry.startsWith(label))).toBe(true);
  });
  test("whites, blacks, profiles, curves and crops have explicit warnings", () => {
    const result = plan(
      "Exposure +0.5\nWhites +30\nBlacks -15\nProfile: Adobe Color\nTone Curve: Strong Contrast\nCrop: 4:5",
    );
    expect(result.edits).toEqual({ exposure: 10 });
    for (const label of ["Whites2012", "Blacks2012", "CameraProfile", "ToneCurve", "HasCrop"])
      expect(result.warnings.some((entry) => entry.startsWith(label))).toBe(true);
  });
  test("nested masks and snapshots never become global exposure or saturation", () => {
    const nested =
      '<crs:MaskGroupBasedCorrections><rdf:Seq><rdf:li crs:Exposure2012="4" crs:LocalExposure="2"/></rdf:Seq></crs:MaskGroupBasedCorrections><crs:Snapshots><rdf:Seq><rdf:li crs:Saturation="80"/></rdf:Seq></crs:Snapshots>';
    const result = plan(xmp('crs:Contrast2012="12"', nested));
    expect(result.edits).toEqual({ contrast: 12 });
    expect(result.warnings.join(" ")).toContain("MaskGroupBasedCorrections");
    expect(result.warnings.join(" ")).toContain("Snapshots");
  });
  test("unknown fields and process versions are disclosed", () => {
    const result = plan(
      xmp('crs:Exposure2012="0.5" crs:ProcessVersion="15.4" crs:FutureAIThing="True"'),
    );
    expect(result.edits).toEqual({ exposure: 10 });
    expect(result.warnings.join(" ")).toContain("ProcessVersion");
    expect(result.warnings.join(" ")).toContain("FutureAIThing");
  });
  test("legacy fields are never mislabeled as their modern 2012 controls", () => {
    const result = plan(
      xmp('crs:Exposure="1" crs:Contrast="20" crs:Shadows="25" crs:Saturation="5"'),
    );
    expect(result.edits).toEqual({ saturation: 5 });
    expect(result.warnings.filter((entry) => entry.includes("legacy Adobe process"))).toHaveLength(
      3,
    );
  });
  test.each(["Temperature 5500", "Whites 20\nBlacks -10", xmp('crs:CameraProfile="Adobe Color"')])(
    "unsupported-only record %# refuses",
    (input) => {
      const result = refusal(input);
      expect(result.warnings.length).toBeGreaterThan(2);
      expect(result.reason).toContain("No supported");
    },
  );
});

describe("malformed or ambiguous data never falls through to edit commands", () => {
  test.each([
    "Exposure +0.5\nexport all keepers",
    "Exposure +0.5 and send to my client",
    "Exposure +0.5\nUnknownSlider 20",
    "Exposure: +0.5; Contrast: 20",
    "Exposure: 1,5",
    "Exposure: 1.2.3",
    "Exposure: 1e2",
    "Exposure: NaN",
    "Exposure: Infinity",
    "Exposure: -Infinity",
    "Exposure: +0.5\nWhites: NaN",
    "Exposure +0.5\nTemperature: Infinity",
    "Exposure +0.5\nExposure2012 +0.5",
    "Exposure +0.5\nPreset: first\nName: second",
    "Exposure +0.5\nName: " + "a".repeat(101),
    '{"Exposure":0.5,"Contrast":20}',
    's = { id = "Adobe Lightroom", Exposure2012 = 0.5 }',
    "```javascript\nExposure: 0.5\n```",
    "```xml\n<broken>",
    "Exposure +0.5\n```text\nContrast 20\n```",
    "Exposure +0.5\u0000",
  ])("unsafe or mixed record %#", (input) => {
    refusal(input);
  });

  test.each([
    "Exposure 5.01",
    "Exposure -5.01",
    "Contrast 101",
    "Highlights -101",
    "Shadows 101",
    "Saturation -101",
  ])("out-of-range %s refuses, without clamping", (input) => {
    refusal(input);
  });

  test.each([
    '<rdf:Description xmlns:rdf="wrong" xmlns:crs="also-wrong" crs:Exposure2012="0.5"/>',
    `<rdf:Description xmlns:rdf="${RDF}" crs:Exposure2012="0.5"/>`,
    xmp('crs:Exposure2012="0.5"').replace("</rdf:Description>", "</rdf:Wrong>"),
    xmp('crs:Exposure2012="0.5"').replace("</x:xmpmeta>", ""),
    xmp('crs:Exposure2012="0.5"') + xmp('crs:Exposure2012="1"'),
    xmp('crs:Exposure2012="0.5" crs:Exposure2012="1"'),
    xmp('crs:Exposure2012="0.5"', "<crs:Exposure2012>0.5</crs:Exposure2012>"),
    xmp('crs:Exposure2012="nope" crs:Contrast2012="20"'),
    xmp('crs:Exposure2012="Infinity"'),
    xmp('crs:Exposure2012="0.5" crs:Temperature="1e999"'),
    xmp('crs:Exposure2012="0.5" crs:Temperature="' + "9".repeat(400) + '"'),
    xmp(
      'crs:Exposure2012="0.5"',
      "<crs:Saturation><rdf:Seq><rdf:li>20</rdf:li></rdf:Seq></crs:Saturation>",
    ),
    xmp("", '<crs:Exposure2012 rdf:resource="0.5">0.5</crs:Exposure2012>'),
    description('crs:Exposure2012="0.5"crs:Contrast2012="20"'),
    description("crs:Exposure2012=0.5"),
    description('crs:Exposure2012="0.5'),
    '<!DOCTYPE x [<!ENTITY secret SYSTEM "file:///etc/passwd">]>' + xmp('crs:Exposure2012="0.5"'),
    xmp('crs:Exposure2012="&#49;"'),
    xmp('crs:Exposure2012="0.5" crs:CameraProfile="B&amp;W"'),
    xmp('crs:Exposure2012="0.5"', "<![CDATA[ignored]]>"),
    '<?xml nonsense="1"?>' + xmp('crs:Exposure2012="0.5"'),
    xmp('crs:Exposure2012="0.5"') + '<?xml version="1.0"?>',
    '<?script run="anything"?>' + xmp('crs:Exposure2012="0.5"'),
  ])("malformed or unsafe XML %#", (input) => {
    refusal(input);
  });

  test("settings from multiple top-level records cannot merge across images", () => {
    refusal(
      `<rdf:RDF xmlns:rdf="${RDF}">${description('crs:Exposure2012="0.5"')}${description('crs:Contrast2012="20"')}</rdf:RDF>`,
    );
  });
  test("prefix aliases cannot hide duplicate expanded attribute names", () => {
    refusal(description(`xmlns:raw="${CRS}" crs:Exposure2012="0.5" raw:Exposure2012="0.5"`));
  });
  test("massive, deep or broad structures refuse", () => {
    expect(refusal("Exposure +0.5\n" + " ".repeat(ADOBE_PASTE_MAX_CHARS)).reason).toContain(
      "characters",
    );
    refusal(xmp('crs:Exposure2012="0.5"', "<crs:Mask>".repeat(40) + "</crs:Mask>".repeat(40)));
    refusal(xmp('crs:Exposure2012="0.5"', "<crs:Mask/>".repeat(4001)));
  });
  test.each([
    "",
    "  ",
    "brighten this",
    "make these warmer but keep them natural",
    "reject blur",
    "show my keepers",
    "export the selected photo",
    "What is exposure?",
    "I normally use Lightroom",
  ])("ordinary chat remains outside parser: %s", (input) => {
    expect(parseAdobeSettingsPaste(input)).toBeNull();
  });
  test("returned edits are independent mutable values; parsing does not apply them", () => {
    const a = plan("Exposure +0.5");
    a.edits.exposure = 100;
    expect(plan("Exposure +0.5").edits).toEqual({ exposure: 10 });
    expect(DEFAULT_EDITS.exposure).toBe(0);
  });
});
