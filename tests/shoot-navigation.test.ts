import { describe, expect, it } from "bun:test";
import { newProject } from "../src/lib/projects/model";
import type { RecentShoot } from "../src/lib/studio/shoot-directory";
import { canonicalShootBinding, explicitWorkspaceBinding } from "../src/lib/workbench-projects";
import {
  parseShootKey,
  shootAssistantHref,
  shootContextHref,
  shootPhotoCountLabel,
  shootWorkspaceHref,
  shootSummaryDetail,
  shootUpdatedLabel,
  shootsInNext24Hours,
  summarizeShoots,
  SHOOT_TABS,
  type ShootSummary,
} from "../src/components/shoots/navigation";

const id = "eeaf3000-1111-4222-8333-000000000013";
const saved = (overrides: Partial<RecentShoot> = {}): RecentShoot => ({
  id,
  title: "Raw-Photos",
  named: true,
  count: 337,
  updatedAt: 1_789_000_000_000,
  recoveredFromDevice: false,
  recoveryPending: false,
  ...overrides,
});
describe("Shoots navigation reads existing identities", () => {
  it("keeps directory and local Project IDs distinct even when the UUID matches", () => {
    const project = newProject({
      title: "Team album",
      genre: "sports",
      brief: "",
      clientId: null,
      bookingId: null,
      invoiceIds: [],
      galleryIds: [],
    });
    project.id = id;
    const input = saved();
    const prior = JSON.stringify([input, project]);
    const rows = summarizeShoots([input], [project]);
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.key)).size).toBe(2);
    expect(rows.find((row) => row.kind === "shoot")?.photoCount).toBe(337);
    expect(rows.find((row) => row.kind === "project")?.genre).toBe("sports");
    expect(JSON.stringify([input, project])).toBe(prior);
  });
  it("never turns a title, genre, or modified date into sport, kickoff, or a stage", () => {
    const [row] = summarizeShoots([saved({ title: "USC football tonight 7pm" })], []);
    expect(row!.sport).toBeNull();
    expect(row!.kickoffAt).toBeNull();
    expect(shootsInNext24Hours([row!], row!.updatedAt)).toEqual([]);
    expect(shootSummaryDetail(row!)).toContain("337 Cull photos · Updated");
  });
  it("does not mistake a zero Cull count for an empty Develop library", () => {
    const [empty] = summarizeShoots([saved({ count: 0 })], []);
    expect(shootSummaryDetail(empty!)).toBe(shootUpdatedLabel(empty!.updatedAt));
    expect(shootSummaryDetail(empty!)).not.toContain("0 photos");
    expect(shootPhotoCountLabel("shoot", 0)).toBeNull();
    expect(shootPhotoCountLabel("shoot", 1)).toBe("1 Cull photo");
    expect(shootPhotoCountLabel("shoot", 337)).toBe("337 Cull photos");
    expect(shootPhotoCountLabel("project", 0)).toBe("0 photos");
    expect(shootPhotoCountLabel("project", 2)).toBe("2 photos");
  });
  it("retains recovery-pending records without rewriting their IDs", () => {
    const [row] = summarizeShoots([saved({ recoveryPending: true })], []);
    expect(row!.recoveryPending).toBe(true);
    expect(row!.key).toBe(id);
  });
  it("provides exactly the six requested module labels and routes", () => {
    expect(SHOOT_TABS).toEqual(["overview", "cull", "develop", "gallery", "social", "smart-file"]);
    expect(shootWorkspaceHref(id)).toBe(`/shoots/${id}`);
    expect(shootWorkspaceHref(`project:${id}`, "develop")).toBe(`/shoots/project%3A${id}/develop`);
    expect(shootAssistantHref(id)).toBe(`/workspace?shoot=${id}`);
    expect(shootAssistantHref(`project:${id}`)).toBe(`/workspace?workspaceProject=${id}`);
    expect(shootAssistantHref("legacy")).toBe("/workspace?shoot=legacy");
  });
  it("rejects invalid and ambiguous keys instead of choosing a different library", () => {
    for (const key of [
      "project:legacy",
      "",
      "../../workspace",
      "https://evil.invalid",
      `${id}?shoot=legacy`,
    ]) {
      expect(parseShootKey(key)).toBeNull();
      expect(() => shootAssistantHref(key)).toThrow();
    }
  });
  it("keeps same-shoot source queries and fragments across every workflow tab", () => {
    const key = `project:${id}`;
    const query = `?project=${id}&deliveryFrame=frame%2F1&deliveryVersion=version%2B2&view=proof#selected`;
    const current = `${shootWorkspaceHref(key, "gallery")}${query}`;
    for (const tab of SHOOT_TABS) {
      expect(shootContextHref(key, tab, current)).toBe(`${shootWorkspaceHref(key, tab)}${query}`);
      expect(canonicalShootBinding(shootContextHref(key, tab, current), true)).toEqual(
        canonicalShootBinding(current, true),
      );
    }
  });
  it("never carries another shoot's handoff or fragment into a target", () => {
    const current = `${shootWorkspaceHref(`project:${id}`)}?workspaceProject=${id}&workspaceFrame=one&workspaceVersion=two#proof`;
    expect(shootContextHref(id, "cull", current)).toBe(shootWorkspaceHref(id, "cull"));
    expect(shootAssistantHref(id, current)).toBe(`/workspace?shoot=${id}`);
    expect(shootContextHref(id, "overview", "/library?shoot=legacy#other")).toBe(
      shootWorkspaceHref(id),
    );
  });
  it("keeps direct and workspace-prefixed version handoffs in the saved assistant", () => {
    const key = `project:${id}`;
    for (const query of [
      `?project=${id}&deliveryFrame=%22123%22&deliveryVersion=%22456%22&deliveryHandoff=${id}`,
      `?workspaceProject=${id}&workspaceFrame=%22123%22&workspaceVersion=%22456%22&workspaceHandoff=${id}`,
    ]) {
      const current = `${shootWorkspaceHref(key)}${query}&view=proof#selected`;
      const assistant = shootAssistantHref(key, current);
      expect(explicitWorkspaceBinding(assistant, true)).toEqual(
        canonicalShootBinding(current, true),
      );
      expect(new URL(assistant, "https://workspace.invalid").hash).toBe("#selected");
      expect(new URL(assistant, "https://workspace.invalid").searchParams.get("view")).toBe(
        "proof",
      );
      expect(assistant).not.toContain("deliveryFrame=");
    }
    expect(shootAssistantHref(id, `${shootWorkspaceHref(id)}?view=proof#selected`)).toBe(
      `/workspace?view=proof&shoot=${id}#selected`,
    );
  });
  it("does not silently repair conflicting matching-source links", () => {
    const key = `project:${id}`;
    for (const query of [
      `?project=${id}&workspaceProject=${id}`,
      `?project=${id}&deliveryFrame=one&deliveryVersion=two&deliveryVersion=three`,
      "?shoot=legacy",
    ]) {
      const current = `${shootWorkspaceHref(key)}${query}#proof`;
      const next = shootContextHref(key, "cull", current);
      expect(next).toEndWith(`${query}#proof`);
      expect(canonicalShootBinding(next, true)?.kind).toBe("blocked");
      expect(() => shootAssistantHref(key, current)).toThrow();
    }
  });
  it("uses a real kickoff timestamp and a half-open next-24-hours window only", () => {
    const [base] = summarizeShoots([saved()], []);
    const now = 1_000_000;
    const rows: ShootSummary[] = [-1, 0, 1, 24 * 60 * 60 * 1000 - 1, 24 * 60 * 60 * 1000].map(
      (offset) => ({ ...base!, key: String(offset), kickoffAt: now + offset }),
    );
    rows.push({ ...base!, key: "unknown", kickoffAt: null });
    expect(shootsInNext24Hours(rows, now).map((row) => row.key)).toEqual(["0", "1", "86399999"]);
  });
  it("sorts recency without deleting or modifying any records", () => {
    const records = Array.from({ length: 12 }, (_, index) =>
      saved({ id: `eeaf3000-1111-4222-8333-${String(index).padStart(12, "0")}`, updatedAt: index }),
    );
    const before = JSON.stringify(records);
    const rows = summarizeShoots(records, []);
    expect(rows).toHaveLength(12);
    expect(rows.slice(0, 8)).toHaveLength(8);
    expect(rows.map((row) => row.updatedAt)).toEqual([11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
    expect(JSON.stringify(records)).toBe(before);
  });
  it("labels invalid dates honestly rather than crashing a hub", () => {
    expect(shootUpdatedLabel(Infinity)).toBe("Update date unavailable");
    expect(shootUpdatedLabel(NaN)).toBe("Update date unavailable");
    expect(shootUpdatedLabel(0)).toStartWith("Updated ");
  });
});
