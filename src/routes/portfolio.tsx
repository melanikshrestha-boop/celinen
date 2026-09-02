import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Btn, Card, SectionTitle, Shell } from "@/components/lensos/Shell";

export const Route = createFileRoute("/portfolio")({
  head: () => ({
    meta: [
      { title: "Portfolio Builder — LensLabs" },
      {
        name: "description",
        content:
          "Upload your own photos, write about them, and publish a portfolio page in seconds. Local-first, no template jargon.",
      },
      { property: "og:title", content: "Portfolio Builder — LensLabs" },
      {
        property: "og:description",
        content: "Drop photos in, write captions, pick a handle, publish.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Portfolio,
});

interface Item {
  id: string;
  url: string;
  title: string;
  story: string;
}

function Portfolio() {
  const [items, setItems] = useState<Item[]>([]);
  const [handle, setHandle] = useState("");
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [live, setLive] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const urls = useRef<string[]>([]);

  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const add = (files: FileList | null) => {
    if (!files) return;
    const next: Item[] = [];
    Array.from(files)
      .filter((f) => f.type.startsWith("image/"))
      .forEach((f) => {
        const url = URL.createObjectURL(f);
        urls.current.push(url);
        next.push({
          id: `${f.name}-${Math.random().toString(36).slice(2, 7)}`,
          url,
          title: f.name.replace(/\.[^.]+$/, ""),
          story: "",
        });
      });
    setItems((prev) => [...prev, ...next]);
  };

  const patch = (id: string, p: Partial<Item>) =>
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...p } : i)));

  const slug = (handle || name || "your-name")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  return (
    <Shell hideEventHeader>
      <SectionTitle
        kicker="Portfolio"
        title="Your photos, your words, live in seconds."
        sub="Upload what you want to show, write about it, publish. No template gallery jargon."
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_1.25fr]">
        <div className="space-y-4">
          <Card>
            <div className="space-y-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm outline-none focus:border-rust/50"
              />
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="A sentence about the work you make."
                rows={3}
                className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm outline-none focus:border-rust/50"
              />
              <div className="flex items-center gap-2">
                <input
                  value={handle}
                  onChange={(e) => setHandle(e.target.value)}
                  placeholder="handle"
                  className="w-full rounded-lg border border-input bg-card px-3 py-2 font-mono text-sm outline-none focus:border-rust/50"
                />
                <span className="font-mono text-[13px] text-moss">.lens.photo</span>
              </div>
            </div>

            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                add(e.dataTransfer.files);
              }}
              onClick={() => input.current?.click()}
              className="mt-4 cursor-pointer rounded-xl border border-dashed border-input p-8 text-center transition-colors hover:border-rust/50"
            >
              <p className="text-sm">Drop photos here, or click to choose</p>
              <p className="mt-1 font-mono text-[11px] text-moss">
                JPEG / PNG / WebP · stays in your browser
              </p>
              <input
                ref={input}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(e) => add(e.target.files)}
              />
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Btn variant="primary" disabled={!items.length} onClick={() => setLive(true)}>
                Publish
              </Btn>
              {live && (
                <span className="font-mono text-[12px] text-rust">live · {slug}.lens.photo</span>
              )}
            </div>
          </Card>

          {items.map((i) => (
            <Card key={i.id}>
              <div className="flex gap-3">
                <img src={i.url} alt={i.title} className="size-20 rounded-lg object-cover" />
                <div className="flex-1 space-y-2">
                  <input
                    value={i.title}
                    onChange={(e) => patch(i.id, { title: e.target.value })}
                    className="w-full rounded-lg border border-input bg-card px-3 py-1.5 text-sm outline-none"
                  />
                  <textarea
                    value={i.story}
                    onChange={(e) => patch(i.id, { story: e.target.value })}
                    placeholder="Write about this frame."
                    rows={2}
                    className="w-full rounded-lg border border-input bg-card px-3 py-1.5 text-sm outline-none"
                  />
                </div>
                <button
                  onClick={() => setItems((prev) => prev.filter((x) => x.id !== i.id))}
                  className="self-start text-[12px] text-moss hover:text-ink"
                >
                  Remove
                </button>
              </div>
            </Card>
          ))}
        </div>

        <Card className="p-0">
          <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
            <span className="size-2 rounded-full bg-border" />
            <span className="font-mono text-[11px] text-moss">{slug}.lens.photo</span>
          </div>
          <div className="p-8">
            <h2 className="font-display text-4xl font-semibold tracking-tight">
              {name || "Your name"}
            </h2>
            <p className="mt-2 max-w-md text-[15px] text-moss">
              {bio || "A sentence about the work you make."}
            </p>

            {items.length === 0 ? (
              <div className="mt-8 rounded-xl border border-dashed border-input p-10 text-center text-sm text-moss">
                Your photos will appear here as you add them.
              </div>
            ) : (
              <div className="mt-8 space-y-8">
                {items.map((i) => (
                  <figure key={i.id}>
                    <img src={i.url} alt={i.title} className="w-full rounded-xl object-cover" />
                    <figcaption className="mt-2">
                      <p className="font-display text-[16px] font-semibold tracking-tight">{i.title}</p>
                      {i.story && <p className="text-[14px] text-moss">{i.story}</p>}
                    </figcaption>
                  </figure>
                ))}
              </div>
            )}
          </div>
        </Card>
      </div>
    </Shell>
  );
}
