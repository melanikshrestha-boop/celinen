/** Real JPEG pixels plus one byte-identical copy, not four independent photographs.
 * Simulated folder handles exercise the real chat drop; never replaces a user's shoot.
 */
if (!["localhost", "127.0.0.1"].includes(location.hostname)) throw new Error("Local QA only");
const repository = await import("/src/lib/projects/repository.ts");
const id = new URL(location.href).searchParams.get("project");
const project = await repository.loadProject(id);
if (project.title !== "QA native workflow — September 4" || project.frames.length)
  throw new Error("Requires the exact empty QA project");
const names = [
  "basketball-action-usaf-pd.jpg",
  "basketball-hangar-usnavy-pd.jpg",
  "volleyball-portrait-cc0.jpg",
];
const files = await Promise.all(
  names.map(async (name) => {
    const response = await fetch("/tests/fixtures/photos/" + name);
    if (!response.ok || !response.headers.get("content-type")?.startsWith("image/"))
      throw new Error("Fixture unavailable: " + name);
    return new File([await response.blob()], name, {
      type: "image/jpeg",
      lastModified: 1700000000000,
    });
  }),
);
files.push(
  new File([files[0]], "basketball-action-fixture-copy.jpg", {
    type: "image/jpeg",
    lastModified: 1700000000001,
  }),
);
const leaf = (file) => ({
  name: file.name,
  isFile: true,
  isDirectory: false,
  file: (success) => success(file),
});
const root = {
  name: "Native QA sports",
  isFile: false,
  isDirectory: true,
  createReader() {
    let done = false;
    return {
      readEntries(success) {
        success(done ? [] : files.map(leaf));
        done = true;
      },
    };
  },
};
const transfer = {
  types: ["Files"],
  files: [],
  items: [{ kind: "file", webkitGetAsEntry: () => root, getAsFile: () => null }],
};
const target = document.querySelector("#studio-chat-input");
if (!target) throw new Error("Chat composer missing");
const start = performance.now();
const event = new Event("drop", { bubbles: true, cancelable: true });
Object.defineProperty(event, "dataTransfer", { value: transfer });
target.dispatchEvent(event);
while (performance.now() - start < 30000 && !document.body.innerText.includes("First pass ready"))
  await new Promise((resolve) => setTimeout(resolve, 100));
const proposalElapsedMs = performance.now() - start;
let stored = await repository.loadProject(id);
while (performance.now() - start < 30000 && stored.frames.length !== files.length) {
  await new Promise((resolve) => setTimeout(resolve, 100));
  stored = await repository.loadProject(id);
}
if (stored.frames.length !== files.length) throw new Error("Fixture persistence did not finish");
return {
  elapsedMs: performance.now() - start,
  proposalElapsedMs,
  proposalReady: document.body.innerText.includes("First pass ready"),
  frames: stored.frames.map((f) => ({
    name: f.metadata.name,
    backend: f.metadata.analysisBackend,
    width: f.metadata.width,
    height: f.metadata.height,
    captureTimeBasis: f.metadata.captureTimeBasis,
    verdict: f.metadata.verdict,
  })),
  text: document.body.innerText,
};
