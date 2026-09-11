import { describe, expect, test } from "bun:test";
import {
  SEED_IDS,
  ensureSeedClients,
  findClient,
  money,
  parseClientCommand,
  toRow,
} from "../src/lib/clients/sheet";
import { emptyClientWorkspace } from "../src/lib/client-workspace";

describe("client sheet commands", () => {
  test("parses lead, open, quiet, gallery, and attach language", () => {
    expect(parseClientCommand("add lead Maya Shah, wedding Oct 3")).toEqual({
      kind: "add",
      name: "Maya Shah",
      type: "Wedding",
      date: "Oct 3",
    });
    expect(parseClientCommand("add lead Priya")).toEqual({ kind: "add", name: "Priya" });
    expect(parseClientCommand("open Amara")).toEqual({ kind: "open", name: "Amara" });
    expect(parseClientCommand("open Studio")).toBeNull();
    expect(parseClientCommand("who is quiet")).toEqual({ kind: "quiet" });
    expect(parseClientCommand("who hasn't opened their gallery")).toEqual({ kind: "unopened" });
    expect(parseClientCommand("attach Maya to a new project")).toEqual({
      kind: "attach",
      name: "Maya",
    });
  });

  test("seeds four named rows without inventing zero dollars", () => {
    const seeded = ensureSeedClients(emptyClientWorkspace());
    const rows = seeded.clients.map(toRow);
    expect(rows.map((row) => row.name)).toEqual([
      "Amara & James",
      "Lunara Glow Beauty Salon",
      "Elise Moreau",
      "Maya Shah",
    ]);
    expect(rows[0]?.id).toBe(SEED_IDS.amara);
    expect(rows[0]?.cover).toContain("amara-james");
    expect(rows[0]?.location).toBe("Napa");
    expect(rows[0]?.date).toBe("2026-05-14");
    expect(rows[0]?.sheetStage).toBe("booked");
    expect(rows[0]?.gallery).toBe("Live");
    expect(rows[0]?.guest).toBe("napa");
    expect(rows[0]?.clientPw).toBe("amara");
    expect(rows[0]?.pin).toBe("4821");
    expect(money(rows[0]!.receivedCents)).toBe("$2,400");
    expect(money(rows[0]!.totalCents)).toBe("$6,000");
    expect(rows[1]?.id).toBe(SEED_IDS.lunara);
    expect(rows[1]?.location).toBe("");
    expect(rows[1]?.cover).toBeNull();
    expect(money(rows[1]!.receivedCents)).toBe("");
    expect(money(rows[3]!.receivedCents)).toBe("");
    expect(findClient(rows, "Amara")?.name).toBe("Amara & James");
    expect(findClient(rows, "Lunara")?.name).toBe("Lunara Glow Beauty Salon");
    expect(rows[0]?.nda).toBe("Signed");
    expect(rows[0]?.gps).toBe("Stripped");
    expect(rows[0]?.download).toBe("Off");
    expect(findClient(rows, "Atelier")?.name).toBe("Elise Moreau");
    expect(rows[2]?.alias).toBe("Atelier");
    expect(rows[2]?.channel).toBe("Signal");
  });

  test("does not duplicate seeds on a second pass", () => {
    const once = ensureSeedClients(emptyClientWorkspace());
    const twice = ensureSeedClients(once);
    expect(twice.clients).toHaveLength(4);
  });
});
