import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Globe,
  Instagram,
  Facebook,
  Sparkles,
} from "lucide-react";
import { Shell } from "@/components/lensos/Shell";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useToolLeaveGuard } from "@/components/workbench/useToolLeaveGuard";
import { useWorkbench } from "@/components/workbench/context";
import {
  getOwnerDeliveryMedia,
  getPrivateDelivery,
  listPrivateDeliveries,
} from "@/lib/delivery/remote.functions";
import { captionDraft, eligibleVersions, type Publication } from "@/lib/business/publishing";
import { StoryShare } from "./StoryShare";
import {
  connectFacebook,
  completeFacebook,
  chooseFacebookPage,
  disconnectFacebook,
} from "@/lib/business/facebook.functions";
import { DEFAULT_SOCIAL_FRAME, type SocialFrame } from "@/lib/social-frame";
import { Slider } from "@/components/ui/slider";
import "./story-sharing.css";
import {
  completeInstagram,
  connectInstagram,
  disconnectInstagram,
  publishEverywhere,
  publishingStatus,
  removePortfolioStory,
  savePublication,
} from "@/lib/business/publishing.functions";
import type { RoomView } from "@/lib/delivery/remote.server";
import "./business.css";

export function PublishDesk() {
  const workbench = useWorkbench();
  const [status, setStatus] = useState<Awaited<ReturnType<typeof publishingStatus>> | null>(null);
  const [rooms, setRooms] = useState<{ id: string; title: string }[]>([]);
  const [room, setRoom] = useState<RoomView | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [media, setMedia] = useState<Record<string, string>>({});
  const [page, setPage] = useState(0);
  const [title, setTitle] = useState("");
  const [story, setStory] = useState("");
  const [genre, setGenre] = useState("brand"),
    [tone, setTone] = useState("minimal");
  const [caption, setCaption] = useState("");
  const [portfolio, setPortfolio] = useState(true),
    [instagram, setInstagram] = useState(false);
  const [instagramStory, setInstagramStory] = useState(false),
    [facebookStory, setFacebookStory] = useState(false);
  const [frame, setFrame] = useState<SocialFrame>(DEFAULT_SOCIAL_FRAME);
  const [permission, setPermission] = useState(false),
    [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saved, setSaved] = useState<Publication | null>(null);
  const operation = useRef<string | null>(null),
    locked = useRef(false),
    generation = useRef(0);
  const callback = useRef(false);
  useToolLeaveGuard(
    busy
      ? "A publishing operation is running. Wait for its result."
      : !saved && (caption || selected.length)
        ? "This publishing draft has unsaved changes."
        : null,
  );
  const refresh = useCallback(async () => {
    const [next, deliveries] = await Promise.all([publishingStatus(), listPrivateDeliveries()]);
    setStatus(next);
    setRooms(deliveries.map((row) => ({ id: row.id, title: row.title })));
    return next;
  }, []);
  useEffect(() => {
    let alive = true;
    void refresh().catch((e) => {
      if (alive) setError(e.message);
    });
    return () => {
      alive = false;
      generation.current++;
    };
  }, [refresh]);
  useEffect(() => {
    const query = new URLSearchParams(window.location.search),
      code = query.get("code"),
      state = query.get("state");
    if (callback.current || (!code && !query.has("error"))) return;
    callback.current = true;
    const facebook = query.get("connector") === "facebook";
    // Remove OAuth secrets from browser history/referrers before any subsequent navigation.
    window.history.replaceState(null, "", "/publish");
    if (query.has("error") || !state) {
      setError(
        `${facebook ? "Facebook" : "Instagram"} connection was cancelled. Nothing was connected.`,
      );
      return;
    }
    setBusy(true);
    void (
      facebook
        ? completeFacebook({ data: { code: code!, state } })
        : completeInstagram({ data: { code: code!, state } })
    )
      .then(() => {
        setNotice(
          facebook
            ? "Facebook connected. Choose the Page you want to publish to."
            : "Instagram connected.",
        );
        return refresh();
      })
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false));
  }, [refresh]);
  async function openRoom(id: string) {
    if (locked.current) return;
    const current = ++generation.current;
    setError("");
    setRoom(null);
    setMedia({});
    setPage(0);
    setSelected([]);
    setSaved(null);
    setCaption("");
    setPermission(false);
    operation.current = null;
    if (!id) return;
    setBusy(true);
    try {
      const next = await getPrivateDelivery({ data: { id } });
      if (current !== generation.current) return;
      setRoom(next);
      setTitle(next.state.title);
      const ids = eligibleVersions(next.state)
        .slice(0, 60)
        .map((v) => v.id);
      if (ids.length) {
        const urls = await getOwnerDeliveryMedia({ data: { id, versionIds: ids, kind: "phone" } });
        if (current === generation.current)
          setMedia(Object.fromEntries(urls.map((row) => [row.versionId, row.url])));
      }
    } catch (e) {
      if (current === generation.current)
        setError(e instanceof Error ? e.message : "Could not open this shoot.");
    } finally {
      if (current === generation.current) setBusy(false);
    }
  }
  useEffect(() => {
    if (!rooms.length || room) return;
    const id = new URLSearchParams(window.location.search).get("gallery");
    if (id && rooms.some((r) => r.id === id)) void openRoom(id);
  }, [rooms]);
  const allPhotos = room ? eligibleVersions(room.state) : [];
  const photos = allPhotos.slice(page * 60, (page + 1) * 60);
  async function changePage(next: number) {
    if (!room || busy || next < 0 || next * 60 >= allPhotos.length) return;
    const current = generation.current;
    setBusy(true);
    setError("");
    try {
      const urls = await getOwnerDeliveryMedia({
        data: {
          id: room.id,
          versionIds: allPhotos.slice(next * 60, (next + 1) * 60).map((v) => v.id),
          kind: "phone",
        },
      });
      if (current === generation.current) {
        setMedia((previous) => ({
          ...previous,
          ...Object.fromEntries(urls.map((row) => [row.versionId, row.url])),
        }));
        setPage(next);
        setNotice("");
      }
    } catch (e) {
      if (current === generation.current)
        setError(e instanceof Error ? e.message : "Could not load photos.");
    } finally {
      if (current === generation.current) setBusy(false);
    }
  }
  function toggle(id: string) {
    if (saved) return;
    if (!selected.includes(id) && selected.length >= 10) {
      setError("Choose up to 10 photos for this publishing batch.");
      return;
    }
    setSelected((previous) =>
      previous.includes(id) ? previous.filter((v) => v !== id) : [...previous, id],
    );
    setPermission(false);
    operation.current = null;
  }
  function reorder(index: number, direction: number) {
    const items = [...selected],
      other = index + direction;
    if (other < 0 || other >= items.length) return;
    [items[index], items[other]] = [items[other]!, items[index]!];
    setSelected(items);
    operation.current = null;
  }
  async function run(id?: string) {
    if (locked.current || (!id && (!room || !permission))) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      const post = id
        ? status?.posts.find((p) => p.id === id)
        : (saved ??
          (await savePublication({
            data: {
              id: operation.current ?? (operation.current = crypto.randomUUID()),
              roomId: room!.id,
              title,
              caption,
              versionIds: selected,
              instagram,
              instagramStory,
              facebookStory,
              ...((instagram || instagramStory || facebookStory) && status?.nativeSocial
                ? { frame }
                : {}),
              portfolio,
              permission: true,
            },
          })));
      if (!post) throw new Error("Refresh the publication list before retrying.");
      if (!id || saved?.id === post.id) setSaved(post);
      setConfirm(false);
      const next = await publishEverywhere({ data: { id: post.id } });
      if (!id || saved?.id === post.id) setSaved(next);
      setNotice("Publication status updated.");
      await refresh();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not publish. Your saved draft is preserved.",
      );
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  async function connectionAction(disconnect = false) {
    setBusy(true);
    setError("");
    try {
      if (disconnect) {
        await disconnectInstagram();
        setInstagram(false);
        setInstagramStory(false);
        setNotice(
          "Disconnected from Celinen. You can also revoke access in Instagram’s Apps and websites settings.",
        );
        await refresh();
      } else {
        const url = await connectInstagram();
        window.location.assign(url);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not connect Instagram.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Shell hideEventHeader>
      <main className="business-desk">
        <header className="business-heading">
          <div>
            <p className="business-eyebrow">After the handoff</p>
            <h1>Good work deserves to be seen.</h1>
            <p>One shoot. Posts, Stories, and your portfolio. Your final say.</p>
          </div>
        </header>
        {error && (
          <div role="alert" className="business-error">
            {error}{" "}
            <button
              onClick={() =>
                void refresh()
                  .then(() => setError(""))
                  .catch((e) => setError(e.message))
              }
            >
              Refresh
            </button>
          </div>
        )}
        {notice && (
          <p role="status" className="business-note">
            {notice}{" "}
            {notice.includes("previews expired") && (
              <button className="underline" onClick={() => void changePage(page)}>
                Refresh previews
              </button>
            )}
          </p>
        )}
        <div className="business-connection">
          <Instagram size={18} />
          <span>{status?.connection?.active ? `@${status.connection.username}` : "Instagram"}</span>
          <button disabled={busy || !status?.configured} onClick={() => void connectionAction()}>
            {status?.connection?.active ? "Reconnect" : "Connect account"}
          </button>
          {status?.connection && (
            <button disabled={busy} onClick={() => void connectionAction(true)}>
              Disconnect
            </button>
          )}
          <span className="business-note">
            {status?.configured
              ? "Feed: Business or Creator · Stories: Business account"
              : "App connection needs setup before posting"}
          </span>
        </div>
        <div className="business-connection">
          <Facebook size={18} />
          <span>Facebook Page Stories</span>
          <button
            disabled={busy || !status?.facebook.configured}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                window.location.assign(await connectFacebook());
              } catch (error) {
                setError(error instanceof Error ? error.message : "Could not connect Facebook.");
              } finally {
                setBusy(false);
              }
            }}
          >
            {status?.facebook.pages.length ? "Reconnect" : "Connect Facebook"}
          </button>
          {!!status?.facebook.pages.length && (
            <>
              <select
                aria-label="Facebook Page"
                value={status.facebook.selected ?? ""}
                disabled={busy}
                onChange={async (event) => {
                  if (!event.target.value) return;
                  setBusy(true);
                  try {
                    await chooseFacebookPage({ data: { id: event.target.value } });
                    await refresh();
                  } catch (error) {
                    setError(error instanceof Error ? error.message : "Could not select Page.");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <option value="">Choose a Page…</option>
                {status.facebook.pages.map((page) => (
                  <option key={page.id} value={page.id}>
                    {page.name}
                  </option>
                ))}
              </select>
              <button
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await disconnectFacebook();
                    setFacebookStory(false);
                    await refresh();
                  } catch (error) {
                    setError(
                      error instanceof Error ? error.message : "Could not disconnect Facebook.",
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Disconnect
              </button>
            </>
          )}
          <span className="business-note">
            {status?.facebook.configured
              ? "Page publishing only · not personal-profile Stories"
              : "App connection needs setup before posting"}
          </span>
        </div>
        {status?.posts.some((p) => p.destinations.portfolio.status === "published") && (
          <p className="mb-6 text-sm">
            <a
              href={status.portfolioUrl}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-4"
            >
              Open your public portfolio ↗
            </a>
          </p>
        )}
        <div className="publish-layout">
          <section className="publish-photos">
            <label className="business-label">
              Delivered shoot
              <select
                value={room?.id ?? ""}
                disabled={busy}
                onChange={(e) => {
                  if (!caption || saved || window.confirm("Discard this unsaved caption?"))
                    void openRoom(e.target.value);
                }}
              >
                <option value="">Choose a shoot…</option>
                {rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.title}
                  </option>
                ))}
              </select>
            </label>
            {!room ? (
              <div className="publish-empty">
                <Globe size={28} strokeWidth={1.2} />
                <h2>From delivered to discovered.</h2>
                <p>
                  Choose a delivered gallery, then select the approved finals you have permission to
                  share.
                </p>
                <button onClick={() => void workbench?.openTool("/deliver?workflow=1")}>
                  Open delivery <ArrowRight size={16} />
                </button>
              </div>
            ) : (
              <>
                <div className="publish-selection-label">
                  <span>{selected.length} / 10 selected</span>
                  <span>Click in posting order</span>
                </div>
                {photos.length ? (
                  <div className="publish-grid">
                    {photos.map((v) => (
                      <button
                        type="button"
                        key={v.id}
                        aria-label={`Select ${v.filename}`}
                        aria-pressed={selected.includes(v.id)}
                        disabled={busy || !!saved}
                        onClick={() => toggle(v.id)}
                      >
                        {media[v.id] ? (
                          <img
                            src={media[v.id]}
                            alt={v.filename}
                            loading="lazy"
                            onError={() =>
                              setNotice(
                                "Image previews expired. Reopen this shoot to refresh them.",
                              )
                            }
                          />
                        ) : (
                          <span>{v.filename}</span>
                        )}
                        {selected.includes(v.id) && <b>{selected.indexOf(v.id) + 1}</b>}
                        <small>{v.filename}</small>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="publish-empty">
                    No approved finals released yet. Finish the handoff in Delivery first.
                  </p>
                )}
                {allPhotos.length > 60 && (
                  <div className="publish-selection-label">
                    <button disabled={busy || page === 0} onClick={() => void changePage(page - 1)}>
                      Previous
                    </button>
                    <span>
                      {page * 60 + 1}–{Math.min((page + 1) * 60, allPhotos.length)} of{" "}
                      {allPhotos.length}
                    </span>
                    <button
                      disabled={busy || (page + 1) * 60 >= allPhotos.length}
                      onClick={() => void changePage(page + 1)}
                    >
                      Next
                    </button>
                  </div>
                )}
                {!!selected.length && (
                  <div className="publish-order" aria-label="Posting order">
                    {selected.map((id, i) => (
                      <div key={id}>
                        <span>{i + 1}</span>
                        <span>{allPhotos.find((v) => v.id === id)?.filename}</span>
                        <button
                          aria-label={`Move photo ${i + 1} earlier`}
                          disabled={busy || !!saved || i === 0}
                          onClick={() => reorder(i, -1)}
                        >
                          <ChevronLeft size={16} />
                        </button>
                        <button
                          aria-label={`Move photo ${i + 1} later`}
                          disabled={busy || !!saved || i === selected.length - 1}
                          onClick={() => reorder(i, 1)}
                        >
                          <ChevronRight size={16} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </section>
          <section className="publish-composer">
            <fieldset disabled={busy || !!saved}>
              <label className="business-label">
                Story title
                <input
                  value={title}
                  maxLength={160}
                  placeholder="Friday night under the lights"
                  onChange={(e) => {
                    setTitle(e.target.value);
                    operation.current = null;
                  }}
                />
              </label>
              <label className="business-label">
                What should people know?
                <textarea
                  rows={2}
                  maxLength={1400}
                  value={story}
                  onChange={(e) => setStory(e.target.value)}
                  placeholder="A few details in your own words. No client information is added automatically."
                />
              </label>
              <div className="publish-draft-tools">
                <select
                  aria-label="Photography genre"
                  value={genre}
                  onChange={(e) => setGenre(e.target.value)}
                >
                  <option value="brand">Brand</option>
                  <option value="sports">Sports</option>
                  <option value="wedding">Wedding</option>
                  <option value="portrait">Portrait</option>
                  <option value="property">Real estate</option>
                </select>
                <select
                  aria-label="Caption tone"
                  value={tone}
                  onChange={(e) => setTone(e.target.value)}
                >
                  <option value="minimal">Minimal</option>
                  <option value="warm">Warm</option>
                  <option value="editorial">Editorial</option>
                </select>
                <button
                  disabled={!title}
                  onClick={() => {
                    if (
                      !caption ||
                      window.confirm("Replace your current caption with a new draft?")
                    ) {
                      setCaption(captionDraft(title, story, genre, tone));
                      operation.current = null;
                    }
                  }}
                >
                  <Sparkles size={15} /> Draft caption
                </button>
              </div>
              <label className="business-label">
                Caption & hashtags
                <textarea
                  rows={7}
                  maxLength={2200}
                  value={caption}
                  onChange={(e) => {
                    setCaption(e.target.value);
                    operation.current = null;
                  }}
                  placeholder="Your voice. A few relevant hashtags. No endless caption-writing session."
                />
              </label>
              <p className="business-note publish-count">
                {caption.length} / 2,200 · editable draft from your details
              </p>
              <div className="publish-destinations">
                <label>
                  <input
                    type="checkbox"
                    checked={portfolio}
                    onChange={(e) => {
                      setPortfolio(e.target.checked);
                      operation.current = null;
                    }}
                  />
                  <Globe size={18} /> Celinen portfolio
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={instagram}
                    disabled={!status?.connection?.active || !status?.configured}
                    onChange={(e) => {
                      setInstagram(e.target.checked);
                      operation.current = null;
                    }}
                  />
                  <Instagram size={18} /> Instagram
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={instagramStory}
                    disabled={
                      !status?.connection?.active || !status?.configured || !status?.nativeSocial
                    }
                    onChange={(event) => {
                      setInstagramStory(event.target.checked);
                      operation.current = null;
                    }}
                  />
                  <Instagram size={18} /> Instagram Story
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={facebookStory}
                    disabled={!status?.facebook.active || !status?.nativeSocial}
                    onChange={(event) => {
                      setFacebookStory(event.target.checked);
                      operation.current = null;
                    }}
                  />
                  <Facebook size={18} /> Facebook Page Story
                </label>
              </div>
              {status && !status.nativeSocial && (
                <p className="business-note">
                  C++ Story preparation is currently available in local Studio. This host needs the
                  native operator deployed before it can frame and publish Stories. Existing feed
                  publishing uses your prepared gallery crop.
                </p>
              )}
              {(instagram || instagramStory || facebookStory) && status?.nativeSocial && (
                <div className="publish-social-frame">
                  <label className="business-label">
                    Feed format
                    <select
                      value={frame.format === "square" ? "square" : "portrait"}
                      onChange={(event) => {
                        setFrame((previous) => ({
                          ...previous,
                          format: event.target.value as "square" | "portrait",
                        }));
                        operation.current = null;
                      }}
                    >
                      <option value="portrait">Portrait · 4:5</option>
                      <option value="square">Square · 1:1</option>
                    </select>
                  </label>
                  <label className="business-label">
                    Framing
                    <select
                      value={frame.mode}
                      onChange={(event) => {
                        setFrame((previous) => ({
                          ...previous,
                          mode: event.target.value as "fit" | "fill",
                          zoom: 1,
                        }));
                        operation.current = null;
                      }}
                    >
                      <option value="fit">Fit whole photo</option>
                      <option value="fill">Fill frame</option>
                    </select>
                  </label>
                  {(["x", "y", "zoom"] as const).map((axis) => (
                    <label className="business-label" key={axis}>
                      {axis === "x"
                        ? "Horizontal position"
                        : axis === "y"
                          ? "Vertical position"
                          : "Zoom"}
                      <Slider
                        aria-label={`Publication ${axis}`}
                        value={[frame[axis]]}
                        min={axis === "zoom" ? 1 : 0}
                        max={axis === "zoom" ? 3 : 1}
                        step={0.01}
                        disabled={axis === "zoom" && frame.mode === "fit"}
                        onValueChange={(values) => {
                          setFrame((previous) => ({ ...previous, [axis]: values[0] }));
                          operation.current = null;
                        }}
                      />
                    </label>
                  ))}
                  <label className="business-label">
                    Frame color
                    <select
                      value={frame.background}
                      onChange={(event) => {
                        setFrame((previous) => ({
                          ...previous,
                          background: event.target.value as "black" | "white",
                        }));
                        operation.current = null;
                      }}
                    >
                      <option value="black">Black</option>
                      <option value="white">White</option>
                    </select>
                  </label>
                  <p className="business-note">
                    C++ prepares separate social copies. Stories use 1080 × 1920 and one photo per
                    publication. Story captions and hashtags are not overlaid; use the downloaded
                    file to add stickers in the social app.
                  </p>
                </div>
              )}
              <label className="publish-permission">
                <input
                  type="checkbox"
                  checked={permission}
                  onChange={(e) => setPermission(e.target.checked)}
                />{" "}
                I have permission to publish these photos publicly, including any client or subject
                permissions required.
              </label>
              <button
                className="business-primary"
                disabled={
                  !room ||
                  !selected.length ||
                  !title.trim() ||
                  (!portfolio && !instagram && !instagramStory && !facebookStory) ||
                  ((instagramStory || facebookStory) && selected.length !== 1) ||
                  !permission ||
                  !status
                }
                onClick={() => setConfirm(true)}
              >
                Review publication <ArrowRight size={17} />
              </button>
            </fieldset>
            {saved && (
              <div className="publish-receipt" role="status">
                <Check size={18} />
                <span>Draft saved. Check each destination below.</span>
                <button
                  disabled={busy}
                  onClick={() => {
                    setSaved(null);
                    setSelected([]);
                    setPermission(false);
                    setCaption("");
                    operation.current = null;
                  }}
                >
                  New publication
                </button>
              </div>
            )}
            <p className="business-note">
              Only selected JPEG copies are shared. RAW originals, private gallery links, client
              notes, and contact details stay private. Public stories can be forwarded and their
              covers cached by messaging apps. Unpublishing stops new access, not copies already
              saved.
            </p>
            <p className="business-note">
              Add your public creator credit and inquiry link in{" "}
              <a href="/network" className="underline">
                your creator profile
              </a>
              .
            </p>
          </section>
        </div>
        {!!status?.posts.length && (
          <section className="publish-history">
            <h2>Publishing history</h2>
            {status.posts.map((p) => (
              <article key={p.id}>
                <div>
                  <strong>{p.title}</strong>
                  <p className="business-note">
                    {new Date(p.createdAt).toLocaleString()} · {p.versionIds.length} photos
                  </p>
                </div>
                <div>
                  {(["portfolio", "instagram", "instagramStory", "facebookStory"] as const)
                    .filter((destination) => p.destinations[destination])
                    .map((destination) => (
                      <div key={destination} className="publish-result">
                        <span>
                          {
                            {
                              portfolio: "Portfolio",
                              instagram: "Instagram",
                              instagramStory: "Instagram Story",
                              facebookStory: "Facebook Story",
                            }[destination]
                          }{" "}
                          · {p.destinations[destination]!.status}
                        </span>
                        {p.destinations[destination]!.url && (
                          <a
                            href={p.destinations[destination]!.url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Open ↗
                          </a>
                        )}
                        <small>{p.destinations[destination]!.note}</small>
                      </div>
                    ))}
                </div>
                <div>
                  {Object.values(p.destinations).some((d) =>
                    ["pending", "preparing", "publishing", "failed", "uncertain"].includes(
                      d.status,
                    ),
                  ) && (
                    <button disabled={busy} onClick={() => void run(p.id)}>
                      {["uncertain", "publishing"].includes(p.destinations.instagram.status)
                        ? "Check outcome"
                        : "Continue / retry"}
                    </button>
                  )}
                  {p.destinations.portfolio.status === "published" && (
                    <StoryShare id={p.id} title={p.title} />
                  )}
                  {p.destinations.portfolio.status === "published" && (
                    <button
                      disabled={busy}
                      onClick={async () => {
                        if (
                          !window.confirm(
                            "Remove this story from your public portfolio? Instagram posts and downloaded copies are not removed.",
                          )
                        )
                          return;
                        setBusy(true);
                        try {
                          await removePortfolioStory({ data: { id: p.id } });
                          await refresh();
                        } catch (e) {
                          setError(e instanceof Error ? e.message : "Could not remove story.");
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      Unpublish portfolio
                    </button>
                  )}
                </div>
              </article>
            ))}
          </section>
        )}
        <Dialog open={confirm} onOpenChange={setConfirm}>
          <DialogContent className="business-confirm">
            <DialogTitle>Publish {selected.length} photos publicly?</DialogTitle>
            <DialogDescription>
              {title} ·{" "}
              {[
                portfolio && "Celinen portfolio",
                instagram && `Instagram @${status?.connection?.username}`,
                instagramStory && `Instagram Story @${status?.connection?.username}`,
                facebookStory &&
                  `Facebook Story · ${status?.facebook.pages.find((page) => page.id === status.facebook.selected)?.name ?? "selected Page"}`,
              ]
                .filter(Boolean)
                .join(" · ")}
              . This is public marketing, separate from your private client gallery.
            </DialogDescription>
            <p className="whitespace-pre-wrap text-sm">{caption || "No caption"}</p>
            <button disabled={busy} className="business-primary" onClick={() => void run()}>
              Publish to selected destinations <ArrowRight size={17} />
            </button>
          </DialogContent>
        </Dialog>
      </main>
    </Shell>
  );
}
