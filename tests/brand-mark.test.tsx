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
  const lightroom = renderToStaticMarkup(<BrandMark id="lightroom" />);
  expect(lightroom).toContain("M19.75.3H4.25C1.9.3 0 2.2 0 4.55v14.9");
  expect(lightroom).toContain("#31A8FF");
  const photoshop = renderToStaticMarkup(<BrandMark id="photoshop" />);
  expect(photoshop).toContain("M9.85 8.42c-.37-.15-.77-.21-1.18-.2");
  expect(photoshop).toContain("#31A8FF");
  const source = readFileSync(new URL("../src/lib/connector-orbit.ts", import.meta.url), "utf8");
  expect(source).toContain("0.12");
});
