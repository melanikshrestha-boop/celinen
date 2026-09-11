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
  expect(lightroom).toContain("M52.5223 0H11.4777");
  expect(lightroom).toContain("#001E36");
  expect(lightroom).toContain("#31A8FF");
  expect(lightroom).not.toContain("M19.75.3H4.25C1.9.3 0 2.2 0 4.55v14.9");
  const photoshop = renderToStaticMarkup(<BrandMark id="photoshop" />);
  expect(photoshop).toContain("M34.4678 0H7.53225");
  expect(photoshop).toContain("#001E36");
  const tiktok = renderToStaticMarkup(<BrandMark id="tiktok" />);
  expect(tiktok).toContain("#25F4EE");
  expect(tiktok).toContain("#FE2C55");
  const source = readFileSync(new URL("../src/lib/connector-orbit.ts", import.meta.url), "utf8");
  expect(source).toContain("0.12");
});
