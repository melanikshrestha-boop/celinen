import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useAccount } from "@/components/account/AccountProvider";
import { useToolLeaveGuard } from "@/components/workbench/useToolLeaveGuard";
import { Shell } from "@/components/lensos/Shell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  emptyPhotographer,
  photographerSchema,
  inquirySchema,
  type DirectoryEntry,
  type Inquiry,
} from "@/lib/commerce/model";
import {
  findPhotographers,
  getNetwork,
  persistPhotographer,
  respondToRequest,
  sendPhotographerRequest,
} from "@/lib/commerce/functions";
import "./commerce.css";

const defaultAPI = {
  findPhotographers,
  getNetwork,
  persistPhotographer,
  respondToRequest,
  sendPhotographerRequest,
};
type API = typeof defaultAPI;
export function PhotographerDirectory({
  api = defaultAPI,
  onSent,
}: {
  api?: API;
  onSent?: () => void;
}) {
  const account = useAccount();
  const [rows, setRows] = useState<DirectoryEntry[]>([]),
    [query, setQuery] = useState(""),
    [applied, setApplied] = useState("");
  const [page, setPage] = useState(0),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [target, setTarget] = useState<DirectoryEntry | null>(null),
    [kind, setKind] = useState<"booking" | "collaboration">("booking");
  const [message, setMessage] = useState(""),
    [sending, setSending] = useState(false),
    [sendError, setSendError] = useState(""),
    [notice, setNotice] = useState("");
  const generation = useRef(0),
    operation = useRef<string | null>(null),
    locked = useRef(false),
    alive = useRef(true);
  useToolLeaveGuard(
    sending
      ? "A photographer request is being sent. Check its result before leaving."
      : message
        ? "Your photographer request has not been sent."
        : null,
  );
  async function search(term: string, offset: number) {
    const version = ++generation.current;
    setLoading(true);
    setError("");
    try {
      const result = await api.findPhotographers({ data: { query: term, offset } });
      if (alive.current && generation.current === version) {
        setRows(result);
        setPage(offset);
        setApplied(term);
      }
    } catch (e) {
      if (alive.current && generation.current === version)
        setError(e instanceof Error ? e.message : "Search is unavailable.");
    } finally {
      if (alive.current && generation.current === version) setLoading(false);
    }
  }
  useEffect(() => {
    alive.current = true;
    void search("", 0);
    return () => {
      alive.current = false;
    };
    // Search is explicit after mounting; changing the search draft must not send another request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!target || locked.current) return;
    let data: ReturnType<typeof inquirySchema.parse>;
    try {
      data = inquirySchema.parse({
        id: operation.current ?? crypto.randomUUID(),
        recipient: target.owner,
        kind,
        message,
      });
    } catch {
      setSendError("Describe your request in 20–2,000 characters.");
      return;
    }
    operation.current = data.id;
    locked.current = true;
    setSending(true);
    setSendError("");
    try {
      await api.sendPhotographerRequest({
        data: { ...data, expectedOwner: account?.user?.id ?? "" },
      });
      if (alive.current) {
        setMessage("");
        setTarget(null);
        setNotice(
          "Request saved in both inboxes. This is an inquiry, not a confirmed booking. No email was sent.",
        );
        operation.current = null;
        onSent?.();
      }
    } catch (e) {
      if (alive.current)
        setSendError(
          e instanceof Error
            ? e.message
            : "The request could not be confirmed. Check your inbox before retrying.",
        );
    } finally {
      locked.current = false;
      if (alive.current) setSending(false);
    }
  }
  const close = () => {
    if (sending) return;
    if (message && !window.confirm("Discard this unsent request?")) return;
    setTarget(null);
    setMessage("");
    setSendError("");
    operation.current = null;
  };
  return (
    <section>
      <form
        className="commerce-row"
        onSubmit={(e) => {
          e.preventDefault();
          void search(query, 0);
        }}
      >
        <label style={{ flex: 1, margin: 0 }}>
          Find a photographer
          <input
            type="search"
            maxLength={80}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="City, country, specialty or language"
          />
        </label>
        <button className="commerce-primary" disabled={loading} type="submit">
          <Search size={16} />
          <span className="sr-only">Search photographers</span>
        </button>
      </form>
      <p className="commerce-caption">
        Sorted by verified-booking reputation, with review count taken into account. New
        photographers show “No verified reviews,” not an invented score.
      </p>
      {notice && <p role="status">{notice}</p>}
      {loading && <p role="status">Finding photographers…</p>}
      {error && (
        <div role="alert">
          <p>{error}</p>
          <button onClick={() => void search(applied, page)}>Retry search</button>
        </div>
      )}
      {!loading && !error && (
        <>
          <div className="network-list">
            {rows.map((person) => (
              <article className="network-person" key={person.owner}>
                <span className="network-avatar" aria-hidden="true">
                  {Array.from(person.displayName)[0]}
                </span>
                <div>
                  <h3>{person.displayName}</h3>
                  <p>
                    {[person.city, person.country].filter(Boolean).join(", ") ||
                      "Location not listed"}{" "}
                    · {person.specialties.join(" · ")}
                  </p>
                  <p className="network-rating">
                    {person.rating === null
                      ? "No verified reviews yet"
                      : `${person.rating.toFixed(1)} / 5 · ${person.reviewCount} verified booking reviews`}
                  </p>
                  {person.bio && <p>{person.bio}</p>}
                  {person.languages && <p>Languages: {person.languages}</p>}
                  <div className="network-actions">
                    <Link to="/photographer/$ownerId" params={{ ownerId: person.owner }}>
                      Portfolio
                    </Link>
                    {person.owner !== account?.user?.id &&
                      person.available &&
                      (account?.status === "in" ? (
                        <>
                          <button
                            onClick={() => {
                              setTarget(person);
                              setKind("booking");
                              setSendError("");
                            }}
                          >
                            Ask about a shoot
                          </button>
                          <button
                            onClick={() => {
                              setTarget(person);
                              setKind("collaboration");
                              setSendError("");
                            }}
                          >
                            Propose a collaboration
                          </button>
                        </>
                      ) : (
                        <Link to="/auth" search={{ next: "/network" }}>
                          Sign in to get in touch
                        </Link>
                      ))}
                    {!person.available && <span>Not taking requests</span>}
                  </div>
                </div>
              </article>
            ))}
          </div>
          {!rows.length && (
            <p className="commerce-empty">
              {applied
                ? "No matches. Try a different place or specialty."
                : "Be part of the first wave. Photographers appear here only after choosing to publish a profile."}
            </p>
          )}
          <div className="commerce-row">
            <button
              disabled={page === 0}
              onClick={() => void search(applied, Math.max(0, page - 25))}
            >
              Previous
            </button>
            <span>Page {page / 25 + 1}</span>
            <button
              disabled={rows.length < 25 || page >= 10000}
              onClick={() => void search(applied, page + 25)}
            >
              Next
            </button>
          </div>
        </>
      )}
      <Dialog
        open={!!target}
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        <DialogContent
          className="network-dialog"
          onEscapeKeyDown={(e) => {
            if (sending) e.preventDefault();
          }}
          onPointerDownOutside={(e) => e.preventDefault()}
        >
          <DialogTitle>
            {kind === "booking" ? "Ask about a shoot" : "Propose a collaboration"}
          </DialogTitle>
          <DialogDescription>
            To {target?.displayName}. Your display name and message will be shared in their LensLabs
            inbox. No payment or booking is created.
          </DialogDescription>
          <form onSubmit={send} className="commerce-desk">
            <label>
              Your request
              <textarea
                required
                minLength={20}
                maxLength={2000}
                disabled={sending || !!operation.current}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Tell them the idea, location, dates and budget…"
              />
            </label>
            {sendError && <p role="alert">{sendError}</p>}
            {operation.current && !sending && (
              <p className="commerce-caption">
                Retry sends the same request safely. Check Inbox before starting a different
                request.
              </p>
            )}
            <button className="commerce-primary" disabled={sending}>
              {sending ? "Sending…" : operation.current ? "Retry same request" : "Send request"}
            </button>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}

export function PhotographerNetwork({ api = defaultAPI }: { api?: API }) {
  const account = useAccount();
  const [profile, setProfile] = useState(emptyPhotographer),
    [specialties, setSpecialties] = useState("");
  const [revision, setRevision] = useState(0),
    [baseline, setBaseline] = useState("");
  const [incoming, setIncoming] = useState<Inquiry[]>([]),
    [outgoing, setOutgoing] = useState<Inquiry[]>([]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [inboxVersion, setInboxVersion] = useState(0);
  const locked = useRef(false),
    alive = useRef(true),
    profileDraft = {
      ...profile,
      specialties: specialties
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    };
  const dirty = JSON.stringify(profileDraft) !== (baseline || JSON.stringify(emptyPhotographer()));
  useToolLeaveGuard(
    busy
      ? "A network operation is running."
      : dirty
        ? "Your photographer profile has unsaved changes."
        : null,
  );
  async function load(replaceProfile: boolean) {
    if (locked.current) return;
    if (
      replaceProfile &&
      dirty &&
      !window.confirm("Reload your saved profile and discard these unsaved changes?")
    )
      return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await api.getNetwork();
      if (alive.current) {
        setIncoming(result.incoming);
        setOutgoing(result.outgoing);
        if (replaceProfile) {
          const next = result.profile ?? emptyPhotographer();
          setProfile(next);
          setSpecialties(next.specialties.join(", "));
          setRevision(result.revision);
          setBaseline(JSON.stringify(next));
        }
      }
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : "The network is unavailable.");
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  }
  useEffect(() => {
    alive.current = true;
    void load(true);
    return () => {
      alive.current = false;
    };
    // Mount-only profile load; account changes remount and must never overwrite a current draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (inboxVersion) void load(false);
    // A sent request refreshes inboxes only, without refreshing/overwriting the profile draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inboxVersion]);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (locked.current || !baseline) return;
    let parsed: ReturnType<typeof photographerSchema.parse>;
    try {
      parsed = photographerSchema.parse(profileDraft);
    } catch {
      setError("Add your name and 1–10 comma-separated specialties. Check the field lengths.");
      return;
    }
    if (
      parsed.visible &&
      !JSON.parse(baseline).visible &&
      !window.confirm(
        "Publish this profile in the public LensLabs directory? Your private account details and shoots will not be shared.",
      )
    )
      return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await api.persistPhotographer({
        data: { profile: parsed, revision, expectedOwner: account?.user?.id ?? "" },
      });
      if (alive.current) {
        setProfile(result.profile);
        setSpecialties(result.profile.specialties.join(", "));
        setRevision(result.revision);
        setBaseline(JSON.stringify(result.profile));
        setNotice(
          result.profile.visible
            ? "Profile published. Only these profile fields are public."
            : "Profile saved privately. It is not listed in discovery.",
        );
      }
    } catch (e) {
      if (alive.current)
        setError(e instanceof Error ? e.message : "Your profile could not be saved.");
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function respond(id: string, status: "accepted" | "declined" | "withdrawn") {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      await api.respondToRequest({ data: { id, status, expectedOwner: account?.user?.id ?? "" } });
      if (alive.current) {
        setIncoming((list) => list.map((r) => (r.id === id ? { ...r, status } : r)));
        setOutgoing((list) => list.map((r) => (r.id === id ? { ...r, status } : r)));
        setNotice(
          status === "accepted"
            ? "Interest accepted. Agree scope, price and a contract before treating this as booked."
            : `Request ${status}.`,
        );
      }
    } catch (e) {
      if (alive.current)
        setError(e instanceof Error ? e.message : "The request could not be updated.");
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return (
    <Shell hideEventHeader>
      <main className="commerce-desk">
        <header className="commerce-heading">
          <div>
            <p className="commerce-eyebrow">Find your people</p>
            <h1>Photographer network</h1>
            <p>Meet the right eye, wherever the shoot takes you.</p>
          </div>
        </header>
        {error && (
          <div className="commerce-feedback" role="alert">
            <p>{error}</p>
            <button disabled={busy} onClick={() => void load(true)}>
              Reload saved data
            </button>
          </div>
        )}
        {notice && <p role="status">{notice}</p>}
        <Tabs defaultValue="discover">
          <TabsList className="commerce-tabs" aria-label="Network tools">
            <TabsTrigger value="discover">Discover</TabsTrigger>
            <TabsTrigger value="profile">My profile</TabsTrigger>
            <TabsTrigger value="inbox">
              Inbox {incoming.filter((r) => r.status === "pending").length || ""}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="discover" forceMount className="commerce-panel">
            <PhotographerDirectory api={api} onSent={() => setInboxVersion((v) => v + 1)} />
          </TabsContent>
          <TabsContent value="profile" forceMount className="commerce-panel">
            <h2>How the world sees your work.</h2>
            <p>
              Your directory profile is separate from your private account and community membership.
            </p>
            <form className="commerce-form" onSubmit={save}>
              <fieldset disabled={busy}>
                <label>
                  Photographer or studio name
                  <input
                    required
                    maxLength={100}
                    value={profile.displayName}
                    onChange={(e) => setProfile({ ...profile, displayName: e.target.value })}
                    placeholder="Vincent van Gogh"
                  />
                </label>
                <label>
                  About your work
                  <textarea
                    maxLength={1600}
                    value={profile.bio}
                    onChange={(e) => setProfile({ ...profile, bio: e.target.value })}
                    placeholder="What do you notice that others miss?"
                  />
                </label>
                <div className="commerce-fields">
                  <label>
                    City / region
                    <input
                      maxLength={100}
                      value={profile.city}
                      onChange={(e) => setProfile({ ...profile, city: e.target.value })}
                    />
                  </label>
                  <label>
                    Country
                    <input
                      maxLength={100}
                      value={profile.country}
                      onChange={(e) => setProfile({ ...profile, country: e.target.value })}
                    />
                  </label>
                </div>
                <label>
                  Specialties, separated by commas
                  <input
                    required
                    maxLength={600}
                    value={specialties}
                    onChange={(e) => setSpecialties(e.target.value)}
                    placeholder="Sports, weddings, real estate"
                  />
                </label>
                <label>
                  Languages
                  <input
                    maxLength={200}
                    value={profile.languages}
                    onChange={(e) => setProfile({ ...profile, languages: e.target.value })}
                    placeholder="English, नेपाली"
                  />
                </label>
                <label className="commerce-check">
                  <input
                    type="checkbox"
                    checked={profile.available}
                    onChange={(e) => setProfile({ ...profile, available: e.target.checked })}
                  />
                  Accept booking and collaboration inquiries
                </label>
                <label className="commerce-check">
                  <input
                    type="checkbox"
                    checked={profile.visible}
                    onChange={(e) => setProfile({ ...profile, visible: e.target.checked })}
                  />
                  Publish these profile fields in the public photographer directory
                </label>
                <button className="commerce-primary" disabled={!dirty || !baseline}>
                  {busy
                    ? "Saving…"
                    : profile.visible
                      ? "Save public profile"
                      : "Save private profile"}
                </button>
              </fieldset>
            </form>
            <p className="commerce-caption">
              Turning visibility off removes your listing and blocks new requests. Existing
              conversations remain in both inboxes. Private photos, email, account details and
              client records are never imported into this profile.
            </p>
          </TabsContent>
          <TabsContent value="inbox" forceMount className="commerce-panel">
            <div className="commerce-row">
              <h2>Your conversations start here.</h2>
              <button disabled={busy} onClick={() => void load(false)}>
                Refresh inbox
              </button>
            </div>
            <p className="commerce-caption">
              Latest 100 received and 100 sent requests. In-app only; email and push notifications
              are not enabled.
            </p>
            {(
              [
                ["Received", incoming],
                ["Sent", outgoing],
              ] as const
            ).map(([label, list]) => (
              <section key={label}>
                <h3>{label}</h3>
                {!list.length && (
                  <p className="commerce-empty">No {label.toLowerCase()} requests.</p>
                )}
                {list.map((r) => (
                  <article className="network-inquiry" key={r.id}>
                    <h3>{label === "Received" ? r.senderName : r.recipientName}</h3>
                    <small>
                      {r.kind} · {r.status} · {new Date(r.createdAt).toLocaleDateString()}
                    </small>
                    <p>{r.message}</p>
                    {r.status === "pending" && (
                      <div className="network-actions">
                        {label === "Received" ? (
                          <>
                            <button disabled={busy} onClick={() => void respond(r.id, "accepted")}>
                              Accept interest
                            </button>
                            <button disabled={busy} onClick={() => void respond(r.id, "declined")}>
                              Decline
                            </button>
                          </>
                        ) : (
                          <button disabled={busy} onClick={() => void respond(r.id, "withdrawn")}>
                            Withdraw
                          </button>
                        )}
                      </div>
                    )}
                  </article>
                ))}
              </section>
            ))}
          </TabsContent>
        </Tabs>
      </main>
    </Shell>
  );
}
