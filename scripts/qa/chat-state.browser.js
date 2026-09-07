/** Read-only verification of the QA project's persisted Adobe edit. */
const repository = await import("/src/lib/projects/repository.ts");
const id = new URL(location.href).searchParams.get("project");
const project = (await repository.listProjects()).find((p) => p.id === id);
if (project?.title !== "QA folder chat — September 4") throw new Error("QA shoot only");
return {
  frames: project.frames.map((f) => ({
    name: f.metadata.name,
    path: f.metadata.relativePath,
    verdict: f.metadata.verdict,
    edits: f.metadata.edits,
    original: f.originalBlobId,
  })),
  versions: project.editVersions.length,
  overflow: document.documentElement.scrollWidth > innerWidth,
  canvas: [...document.querySelectorAll("canvas")].map((c) => ({
    width: c.width,
    height: c.height,
    visible: !!c.getBoundingClientRect().height,
  })),
};
