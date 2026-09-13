import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsSwitch } from "../src/components/marketing/SettingsSwitch";
import { readFileSync } from "node:fs";

test("settings switch is a sliding on/off control", () => {
  const html = renderToStaticMarkup(
    createElement(SettingsSwitch, {
      checked: false,
      onCheckedChange: () => {},
      label: "Yearly billing",
    }),
  );
  expect(html).toContain('role="switch"');
  expect(html).toContain('aria-checked="false"');
  expect(html).toContain("settings-switch");
  expect(html).toContain("settings-switch__thumb");
  expect(html).toContain("Yearly billing");
  const on = renderToStaticMarkup(
    createElement(SettingsSwitch, {
      checked: true,
      onCheckedChange: () => {},
      label: "Yearly billing",
    }),
  );
  expect(on).toContain('aria-checked="true"');
  const css = readFileSync(
    new URL("../src/components/marketing/settings-switch.css", import.meta.url),
    "utf8",
  );
  expect(css).toContain("border-radius: 50%");
  expect(css).toContain("translate: var(--switch-travel)");
  expect(css).toContain("cubic-bezier(0.34, 1.45, 0.64, 1)");
  expect(css).toContain("grok-knob-pop");
  expect(css).toContain("background: #4d6fff");
  expect(css).toContain("background: #b8b8c0");
  expect(css).toContain("--switch-w: 72px");
  expect(css).not.toContain("background: #111");
});
