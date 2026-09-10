import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { BrandMark } from "../src/components/marketing/BrandMark";

test("connector marks use official X and Snapchat paths, not fat stand-ins", () => {
  const x = renderToStaticMarkup(<BrandMark id="x" />);
  expect(x).toContain("M14.234 10.162");
  const snap = renderToStaticMarkup(<BrandMark id="snapchat" />);
  expect(snap).toContain("M12.206.793");
  expect(snap).toContain("#FFFC00");
  const threads = renderToStaticMarkup(<BrandMark id="threads" />);
  expect(threads).toContain("M12.186 24");
  const source = readFileSync(new URL("../src/lib/connector-orbit.ts", import.meta.url), "utf8");
  expect(source).toContain("0.12");
});
