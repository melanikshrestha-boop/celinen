import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Filmstrip } from "../../../src/components/studio/Filmstrip";
import { DEFAULT_EDITS, type Shot } from "../../../src/lib/imaging";
import fixture from "../../../tests/fixtures/delivery/delivery-proof-usaf-pd.jpg?url";
import "../../../src/styles.css";

const base = (id: string, name: string): Shot => ({
  id,
  file: new File([], name),
  name,
  isRaw: false,
  previewUrl: null,
  width: 0,
  height: 0,
  sizeMb: 0,
  sharpness: 0,
  brightness: 0,
  clippedHighlights: 0,
  clippedShadows: 0,
  hash: "",
  score: 0,
  flags: [],
  verdict: "undecided",
  edits: { ...DEFAULT_EDITS },
});

const shots: Shot[] = [
  { ...base("unreadable", "DSC6973.ARW"), isRaw: true, error: "Unsupported embedded preview" },
  { ...base("pending", "IMG_1002.JPG") },
  { ...base("offline", "IMG_1003.JPG"), sourceAvailable: false },
  {
    ...base("ready", "IMG_1004.JPG"),
    previewUrl: fixture,
    width: 1200,
    height: 755,
    score: 82,
  },
];

export function App() {
  const [selected, setSelected] = useState("ready");
  return (
    <main className="min-h-screen bg-paper p-4 text-ink">
      <p className="font-mono text-[10px] uppercase tracking-wider text-moss">
        Local QA · synthetic frame states
      </p>
      <div className="mt-5 h-[230px] max-w-[358px]">
        <Filmstrip shots={shots} selectedId={selected} onSelect={setSelected} />
      </div>
      <p className="mt-5 text-sm" role="status">
        Selected: {shots.find((shot) => shot.id === selected)?.name}
      </p>
    </main>
  );
}

const root = createRoot(document.getElementById("root")!);
root.render(<App />);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
