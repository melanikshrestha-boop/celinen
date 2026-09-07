/** QA-only cancellation regression: no existing project or original media is changed. */
if (!["localhost", "127.0.0.1"].includes(location.hostname)) throw new Error("Local QA only");
const repository = await import("/src/lib/projects/repository.ts");
const id = new URL(location.href).searchParams.get("project");
const read = async () => (await repository.listProjects()).find((p) => p.id === id);
const before = await read();
if (before?.title !== "QA folder chat — September 4") throw new Error("QA shoot only");
const target = document.querySelector("#studio-chat-input");
const leaf = {
  name: "cancelled-qa.jpg",
  isFile: true,
  isDirectory: false,
  file: (success) =>
    success(new File(["must not import"], "cancelled-qa.jpg", { type: "image/jpeg" })),
};
function drop(name, delay) {
  const directory = {
    name,
    isFile: false,
    isDirectory: true,
    createReader() {
      let sent = false;
      return {
        readEntries(success) {
          setTimeout(() => {
            const batch = sent ? [] : [leaf];
            sent = true;
            success(batch);
          }, delay);
        },
      };
    },
  };
  const event = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", {
    value: {
      types: ["Files"],
      files: [],
      items: [{ kind: "file", webkitGetAsEntry: () => directory, getAsFile: () => null }],
    },
  });
  target.dispatchEvent(event);
}
const stop = () =>
  [...document.querySelectorAll("button")].find((b) => b.innerText === "Stop import");
drop("Cancelled first folder", 600);
await new Promise((r) => setTimeout(r, 50));
if (!stop()) throw new Error("First traversal has no Stop import control");
stop().click();
drop("Cancelled second folder", 900);
await new Promise((r) => setTimeout(r, 100));
if (!stop()) throw new Error("Old traversal cleanup hid the new Stop import control");
stop().click();
await new Promise((r) => setTimeout(r, 1200));
const after = await read();
if (before.frames.length !== after.frames.length) throw new Error("Cancelled photos were imported");
if (stop()) throw new Error("Stopped traversal is still shown as active");
return {
  cancelledTwice: true,
  frameCount: after.frames.length,
  unchangedOriginals:
    JSON.stringify(before.frames.map((f) => f.originalBlobId)) ===
    JSON.stringify(after.frames.map((f) => f.originalBlobId)),
};
