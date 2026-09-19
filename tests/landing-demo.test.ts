import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LandingDemo } from "../src/components/marketing/LandingDemo";
import { LANDING_DEMO, landingDemoPauseAt } from "../src/lib/landing-demo";

test("landing examples are photography sessions, not Latch or Grok Bot", () => {
  expect(LANDING_DEMO.length).toBeGreaterThanOrEqual(4);
  const names = LANDING_DEMO.map((session) => session.name).join(" ");
  expect(names).toContain("Saturday wedding");
  expect(names).toContain("Varsity game");
  expect(names.toLowerCase()).not.toContain("latch");
  expect(names).not.toContain("Chief");
  for (const session of LANDING_DEMO) {
    expect(session.messages[0]?.role).toBe("assistant");
    expect(landingDemoPauseAt(session)).toBeGreaterThan(0);
    const body = session.messages.map((message) => message.text).join(" ");
    expect(body.toLowerCase()).not.toContain("latch");
  }
});

test("demo window renders the first shoot and a clickable next line", () => {
  const html = renderToStaticMarkup(createElement(LandingDemo));
  expect(html).toContain('class="marketing-demo"');
  expect(html).toContain("Saturday wedding");
  expect(html).toContain("Varsity game");
  expect(html).toContain("send the sneak peek");
  expect(html).toContain("48 keepers from 1,412");
  expect(html).not.toContain("Latch");
  expect(html).not.toContain("<img");
  expect(html).toContain('aria-label="Celinen example"');
});
