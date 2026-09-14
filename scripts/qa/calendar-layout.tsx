// Read-only rendering fixture using the actual calendar component and CSS.
// No account, browser library, calendar storage, or network integration is used.
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { ChevronLeft, ChevronRight } from "lucide-react";
import * as calendar from "../../src/lib/calendar-ics";
import * as store from "../../src/lib/calendar-store";
import { parseShootNote } from "../../src/lib/calendar-assist";
const baseline = process.argv.includes("--baseline");
const root = new URL("../../", import.meta.url).pathname;
function read(path: string) {
  if (!baseline) return readFileSync(`${root}${path}`, "utf8");
  const result = Bun.spawnSync(["git", "show", `HEAD:${path}`], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode) throw new Error("Cannot read committed fixture");
  return new TextDecoder().decode(result.stdout);
}
const source = read("src/components/dashboard/IosCalendar.tsx");
const env = {
  useState: React.useState,
  useEffect: React.useEffect,
  useMemo: React.useMemo,
  useRef: React.useRef,
  jsx: React.createElement,
  Fragment: React.Fragment,
  ...calendar,
  ...store,
  parseShootNote,
  ChevronLeft,
  ChevronRight,
  useAccount: () => null,
  readCalendarState: () => {
    throw new Error("No real storage permitted");
  },
  writeCalendarState: () => {
    throw new Error("No real writes permitted");
  },
};
const code = new Bun.Transpiler({
  loader: "tsx",
  tsconfig: {
    compilerOptions: { jsx: "react", jsxFactory: "jsx", jsxFragmentFactory: "Fragment" },
  },
}).transformSync(
  source.slice(source.indexOf("const VIEWS")).replace(/^export /gm, "") + "\nreturn IosCalendar;",
);
const Calendar = new Function(...Object.keys(env), code)(
  ...Object.values(env),
) as React.ComponentType;
const html = renderToStaticMarkup(<Calendar />);
const css = ["src/components/dashboard/dashboard.css", "src/components/dashboard/ios-calendar.css"]
  .map(read)
  .join("\n");
mkdirSync(`${root}output`, { recursive: true });
const target = `${root}output/calendar-${baseline ? "before" : "after"}.html`;
writeFileSync(
  target,
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0}${css}\n.celinen-dash{width:min(100%,700px)}</style><div class="celinen-dash"><aside></aside><main class="celinen-dash__body is-cal">${html}</main></div>`,
);
console.log(target);
