import { useState } from "react";
import { createRoot } from "react-dom/client";
import { createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { PublicStory } from "@/components/business/PublicStory";
import { PhotographerDirectory } from "@/components/commerce/PhotographerNetwork";
import { qa } from "./fixture";
import { emptyPhotographer } from "@/lib/commerce/model";
import "@/styles.css";
import photo from "../../../tests/fixtures/delivery/delivery-proof-usaf-pd.jpg";
const id = "73713bbc-125a-44d8-ae7d-195345ee0987";
const person = {
  ...emptyPhotographer(),
  owner: "174b50d4-6b85-42be-9d91-5cf129f10be2",
  displayName: "Céline & Co",
  specialties: ["Editorial"],
  available: true,
  visible: true,
};
function Surface() {
  const [mode, setMode] = useState("story"),
    [long, setLong] = useState(false);
  return (
    <>
      <nav
        aria-label="QA controls"
        style={{ display: "flex", flexWrap: "wrap", gap: 20, padding: 12, fontSize: 14 }}
      >
        <span>Synthetic QA fixture</span>
        <button onClick={() => setMode("story")}>Story fixture</button>
        <button
          onClick={() => {
            qa.signedIn = false;
            setMode("signed-out");
          }}
        >
          Recipient signed out
        </button>
        <button
          onClick={() => {
            qa.signedIn = true;
            setMode("signed-in");
          }}
        >
          Recipient signed in
        </button>
        <button onClick={() => setLong(!long)}>Long title</button>
        <button onClick={() => document.documentElement.classList.toggle("dark")}>Theme</button>
      </nav>
      {mode === "story" ? (
        <PublicStory
          postId={id}
          story={{
            title: long ? "夜の物語".repeat(40) : "A moment above it all",
            caption: "A public story, ready to pass on.",
            images: [photo],
            portfolioUrl: `/photographer/${person.owner}`,
            creator: person,
          }}
        />
      ) : (
        <div className="commerce-desk">
          <PhotographerDirectory key={mode} featured={person} />
        </div>
      )}
    </>
  );
}
const router = createRouter({ routeTree: createRootRoute({ component: Surface }) });
createRoot(document.getElementById("root")!).render(<RouterProvider router={router} />);
