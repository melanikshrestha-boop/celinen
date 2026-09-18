import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { InstagramComposer, type InstagramCandidate } from "@/components/social/InstagramComposer";
import { InstagramAccount } from "@/components/social/InstagramAccount";
import "@/styles.css";
import "@/components/dashboard/social-accounts.css";
import { qa } from "./fixture";
import volleyball from "../../../tests/fixtures/photos/volleyball-portrait-cc0.jpg";
import delivery from "../../../tests/fixtures/delivery/delivery-proof-usaf-pd.jpg";
import sports from "../../../public/images/blog/sports-genie.jpg";

const sources = [
  { id: "a", name: "volleyball-portrait.jpg", url: volleyball },
  { id: "b", name: "flyover.jpg", url: delivery },
  { id: "c", name: "sideline.jpg", url: sports },
];

function Surface() {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"composer" | "account">("composer");
  const candidates = useMemo<InstagramCandidate[]>(
    () =>
      sources.map((source) => {
        const load = () => fetch(source.url).then((response) => response.blob());
        return { id: source.id, name: source.name, thumbnail: load, preview: load, source: load };
      }),
    [],
  );
  return (
    <>
      <nav aria-label="QA controls" style={{ display: "flex", gap: 16, padding: 12, fontSize: 13 }}>
        <span>Synthetic Instagram QA fixture</span>
        <button onClick={() => (setView("composer"), setOpen(true))}>Open composer</button>
        <button onClick={() => setView("account")}>Social accounts card</button>
        <button onClick={() => (qa.failPublish = !qa.failPublish)}>Toggle publish limit</button>
      </nav>
      {view === "composer" ? (
        <div className="cull-workspace" style={{ height: "80dvh" }}>
          <InstagramComposer
            open={open}
            onOpenChange={setOpen}
            origin="cull"
            candidates={candidates}
            initial={["a"]}
          />
        </div>
      ) : (
        <div className="social-post" style={{ minHeight: "80dvh" }}>
          <div className="social-post__stage">
            <InstagramAccount />
          </div>
        </div>
      )}
    </>
  );
}
createRoot(document.getElementById("root")!).render(<Surface />);
