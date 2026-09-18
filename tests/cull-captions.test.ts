import { describe, expect, test } from "bun:test";
import {
  expandCaption,
  formatCodeReplacements,
  mergeCodeTables,
  parseCodeReplacements,
  rosterCodes,
} from "../src/lib/studio/cull/captions";

const pm =
  "u23\tJa'Kobi Lane\tWR\r\nu7\tMiller Moss\tQB\n\nbad line\nu23\tJa'Kobi Lane\tWide receiver\n";

describe("Photo Mechanic code replacements", () => {
  test("parses tabs, CRLF, blank lines; reports and skips bad lines; last definition wins", () => {
    const { table, issues } = parseCodeReplacements(`\uFEFF${pm}`);
    expect(table.codes.get("u7")).toEqual(["Miller Moss", "QB"]);
    expect(table.codes.get("u23")).toEqual(["Ja'Kobi Lane", "Wide receiver"]);
    expect(issues.map((issue) => issue.line)).toEqual([4, 5]);
  });

  test("expands default and numbered columns, case-insensitively as a fallback", () => {
    const { table } = parseCodeReplacements(pm);
    expect(expandCaption("\\u23\\ (\\u23#2\\) catches a pass from \\U7\\", table).text).toBe(
      "Ja'Kobi Lane (Wide receiver) catches a pass from Miller Moss",
    );
  });

  test("unknown codes and stray delimiters stay visible", () => {
    const { table } = parseCodeReplacements(pm);
    const result = expandCaption("gain of 5\\ yards by \\u23\\ and \\u99\\ at C:\\path", table);
    expect(result.text).toBe("gain of 5\\ yards by Ja'Kobi Lane and \\u99\\ at C:\\path");
    expect(result.unknown).toEqual(["u99"]);
    expect(expandCaption("\\u23#9\\", table).text).toBe("\\u23#9\\");
  });

  test("custom delimiter", () => {
    const { table } = parseCodeReplacements(pm);
    expect(expandCaption("=u7= scrambles", table, "=").text).toBe("Miller Moss scrambles");
    expect(() => expandCaption("x", table, "")).toThrow();
  });

  test("round-trips through the file format", () => {
    const { table } = parseCodeReplacements(pm);
    const again = parseCodeReplacements(formatCodeReplacements(table)).table;
    expect([...again.codes]).toEqual([...table.codes]);
  });
});

describe("roster CSV", () => {
  test("builds prefixed codes with a header and quoted names", () => {
    const csv =
      'number,name,position,team\n23,"Lane, Ja\'Kobi",WR,USC\n7,Miller Moss,QB,USC\nxx,Nobody\n';
    const { table, issues } = rosterCodes(csv, "u");
    expect(table.codes.get("u23")).toEqual(["Lane, Ja'Kobi", "Lane, Ja'Kobi (WR)", "USC", "WR"]);
    expect(issues).toEqual([{ line: 4, message: '"xx" is not a jersey number.' }]);
    const both = mergeCodeTables(table, rosterCodes("7,Dante Moore,QB,Oregon", "o").table);
    expect(expandCaption("\\o7\\ sacked by \\u7#3\\", both).text).toBe("Dante Moore sacked by USC");
  });
});
