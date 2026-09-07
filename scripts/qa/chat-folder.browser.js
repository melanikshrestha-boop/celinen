/** Dev-only integration fixture: dispatch a nested folder drop onto the real chat.
 * Run via gstack browse eval in an empty project named QA folder chat — September 4.
 * Real fixture pixels, simulated browser directory handles; not an OS permission test.
 */
if (!["localhost", "127.0.0.1"].includes(location.hostname)) throw new Error("Local QA only");
const repository = await import("/src/lib/projects/repository.ts");
const id = new URL(location.href).searchParams.get("project");
const project = (await repository.listProjects()).find((p) => p.id === id);
if (project?.title !== "QA folder chat — September 4" || project.frames.length)
  throw new Error("Requires the exact empty QA shoot; no existing photos may be replaced");
const names = [
  "basketball-action-usaf-pd.jpg",
  "basketball-hangar-usnavy-pd.jpg",
  "volleyball-portrait-cc0.jpg",
];
const files = await Promise.all(
  names.map(async (name) => {
    const response = await fetch("/tests/fixtures/photos/" + name);
    if (!response.ok || !response.headers.get("content-type")?.startsWith("image/"))
      throw new Error("Photo fixture was not served as an image: " + name);
    return new File([await response.blob()], name, {
      type: "image/jpeg",
      lastModified: 1700000000000,
    });
  }),
);
const leaf = (file) => ({
  name: file.name,
  isFile: true,
  isDirectory: false,
  file: (success) => setTimeout(() => success(file), 5),
});
const directory = (name, entries) => ({
  name,
  isFile: false,
  isDirectory: true,
  createReader() {
    let position = 0;
    return {
      readEntries(success) {
        const batch = entries.slice(position, position + 1);
        position++;
        setTimeout(() => success(batch), 5);
      },
    };
  },
});
const root = directory("QA sports", [
  directory("Court", files.slice(0, 2).map(leaf)),
  directory("Portrait", [leaf(files[2])]),
]);
const transfer = {
  types: ["Files"],
  files: [],
  items: [{ kind: "file", webkitGetAsEntry: () => root, getAsFile: () => null }],
};
const target = document.querySelector("#studio-chat-input");
if (!target) throw new Error("Chat composer not found");
const event = new Event("drop", { bubbles: true, cancelable: true });
Object.defineProperty(event, "dataTransfer", { value: transfer });
target.dispatchEvent(event);
const deadline = performance.now() + 30000;
while (performance.now() < deadline && !document.body.innerText.includes("First pass ready"))
  await new Promise((resolve) => setTimeout(resolve, 100));
const stored = (await repository.listProjects()).find((p) => p.id === id);
return {
  prevented: event.defaultPrevented,
  proposalReady: document.body.innerText.includes("First pass ready"),
  projectId: id,
  storedFrames: stored?.frames.map((f) => ({
    name: f.metadata.name,
    relativePath: f.metadata.relativePath,
    verdict: f.metadata.verdict,
  })),
  text: document.querySelector(".studio-chat-rail")?.innerText,
};
