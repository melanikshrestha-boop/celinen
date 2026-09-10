import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkspaceHome } from "../src/components/workbench/WorkspaceHome";
import { WorkbenchContext, type WorkbenchContextValue } from "../src/components/workbench/context";
import { workbenchTab } from "../src/lib/workbench";

const workbench = {
  chatTarget: null,
  studioVisible: false,
  activeTool: "/workspace",
  storageScope: "local",
  workspaceProjectId: null,
  setToolTitle: () => {},
  openWorkspaceRequest: async () => false,
  openTool: async () => true,
  showStudio: async () => false,
} satisfies WorkbenchContextValue;

test("workspace home is a light welcome with real FOTO destinations", () => {
  const html = renderToStaticMarkup(
    <WorkbenchContext.Provider value={workbench}>
      <WorkspaceHome />
    </WorkbenchContext.Provider>,
  );
  expect(html).toContain("foto-home");
  expect(html).toContain("Let’s make");
  expect(html).toContain("something worth sending.");
  expect(html).toContain("Import a shoot");
  expect(html).toContain("Pick the keepers");
  expect(html).toContain("Send a gallery");
  expect(html).toContain(">Tools<");
  expect(html).toContain("Library");
  expect(html).toContain("Adobe");
  expect(html.match(/class="foto-home__card"/g)).toHaveLength(3);
  expect(html).not.toContain("viral");
  expect(html).not.toContain("Clip your first");
  expect(html).not.toContain("Refer");
  expect(html).not.toContain("13840");
  expect(html).not.toContain("Agent 1");
});

test("Home is not a workbench tab so shoot chat stays the conversation surface", () => {
  expect(workbenchTab("/workspace")).toBeNull();
  expect(workbenchTab("/workspace?shoot=legacy")).toBeNull();
  expect(workbenchTab("/shoots")).not.toBeNull();
});
