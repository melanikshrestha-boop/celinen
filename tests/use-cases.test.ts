import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ACC_TEAMS,
  BIG12_TEAMS,
  BIG_TEN_TEAMS,
  FOOTBALL_CONFERENCES,
  SEC_TEAMS,
  USE_CASES,
} from "../src/components/marketing/UseCasesMenu";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("use cases", () => {
  test("college football is first with a USC mark and a conference flyout", () => {
    expect(USE_CASES[0]?.id).toBe("college-football");
    expect(USE_CASES.map((item) => item.id)).not.toContain("high-school");
    expect(USE_CASES.map((item) => item.title)).toEqual([
      "College football",
      "Sports photography",
      "Wedding photography",
    ]);
    expect(USE_CASES.map((item) => item.id)).not.toContain("soccer");
    expect(USE_CASES.map((item) => item.id)).not.toContain("graduation");
    expect(USE_CASES[0]?.title).toBe("College football");
    expect(USE_CASES[0]?.mark).toBe("usc");
    expect(FOOTBALL_CONFERENCES.map((item) => item.title)).toEqual([
      "Big Ten",
      "SEC",
      "ACC",
      "Big 12",
    ]);
    const menu = readFileSync(
      new URL("../src/components/marketing/UseCasesMenu.tsx", import.meta.url),
      "utf8",
    );
    expect(menu).toContain("marketing-nav-branch");
    expect(menu).not.toContain("DropdownMenuPortal");
    expect(menu).not.toContain("avoidCollisions={false}");
    expect(menu).toContain("marketing-nav-feature--flyout");
    expect(USE_CASES.some((item) => item.title.includes("Wedding"))).toBe(true);
  });

  test("every Power Four conference lists all 2026 football schools with official marks", () => {
    expect(BIG_TEN_TEAMS).toHaveLength(18);
    expect(SEC_TEAMS).toHaveLength(16);
    expect(ACC_TEAMS).toHaveLength(17);
    expect(BIG12_TEAMS).toHaveLength(16);
    expect(FOOTBALL_CONFERENCES.every((conference) => "teams" in conference)).toBe(true);

    const catalog = readFileSync(
      new URL("../src/components/marketing/college-football.ts", import.meta.url),
      "utf8",
    );
    expect(catalog).toContain("/images/schools/bigten/");
    expect(catalog).toContain("/images/schools/sec/");
    expect(catalog).toContain("/images/schools/acc/");
    expect(catalog).toContain("/images/schools/big12/");

    const marks = readFileSync(
      new URL("../src/components/marketing/UseCaseMark.tsx", import.meta.url),
      "utf8",
    );
    expect(marks).not.toContain("#990000");
    expect(marks).not.toContain("Palatino");
    expect(marks).not.toMatch(/>\s*S\s*</);

    const bigTen = join(root, "public/images/schools/bigten");
    for (const team of BIG_TEN_TEAMS) {
      const file = join(bigTen, `${team.id}.svg`);
      expect(existsSync(file)).toBe(true);
      expect(readFileSync(file, "utf8")).toContain("<svg");
    }
    expect(readFileSync(join(bigTen, "conference.svg"), "utf8")).toContain('fill="#0088CE"');

    for (const [dir, teams] of [
      ["sec", SEC_TEAMS],
      ["acc", ACC_TEAMS],
      ["big12", BIG12_TEAMS],
    ] as const) {
      for (const team of teams) {
        expect(existsSync(join(root, `public/images/schools/${dir}/${team.id}.png`))).toBe(true);
      }
    }
  });

  test("FAQ says you connect socials and post feed, Stories, and highlights together", () => {
    const page = readFileSync(
      new URL("../src/components/marketing/UseCasesPage.tsx", import.meta.url),
      "utf8",
    );
    const home = readFileSync(
      new URL("../src/components/marketing/HomePricing.tsx", import.meta.url),
      "utf8",
    );
    for (const source of [page, home]) {
      expect(source).toContain("Connect your socials");
      expect(source).toContain("Stories");
      expect(source).toContain("highlights");
    }
    expect(page).not.toContain("Twitch Clip");
    expect(page).not.toContain("viral clips");
  });
});
