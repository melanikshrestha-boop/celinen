import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { LogoMark } from "@/components/lensos/Logo";
import { DeliveryGallery } from "@/components/delivery/DeliveryGallery";
import {
  ClientGalleryHeader,
  ClientGalleryFooter,
} from "@/components/delivery/ClientGalleryIdentity";
import { messageOf, type MediaReader } from "@/components/delivery/presentation";
import {
  changeClientDelivery,
  getClientDeliveryMedia,
  openClientDelivery,
} from "@/lib/delivery/remote.functions";
import type { DeliveryCommand } from "@/lib/delivery/workflow";
import type { RoomView } from "@/lib/delivery/remote.server";
import { invitationGeneration } from "@/lib/delivery/experience";
import { commentDraftScope } from "@/lib/delivery/comment-drafts";

export const Route = createFileRoute("/review/$id")({
  head: () => ({
    meta: [
      { title: "Your private gallery — LensLabs" },
      { name: "robots", content: "noindex, nofollow, noarchive" },
      { name: "referrer", content: "no-referrer" },
      {
        name: "description",
        content: "A private space to select, review, and receive your photographs.",
      },
    ],
  }),
  component: ClientDeliveryRoute,
});
function ClientDeliveryRoute() {
  const { id } = Route.useParams();
  return <ClientDelivery key={id} id={id} />;
}
function ClientDelivery({ id }: { id: string }) {
  const [token, setToken] = useState<string | null>(null);
  const [room, setRoom] = useState<RoomView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const ops = useRef(new Map<string, string>());
  const loadSequence = useRef(0);
  useEffect(
    () => () => {
      loadSequence.current++;
    },
    [],
  );
  useEffect(() => {
    const key = `lenslabs-private-invitation:${id}`;
    let credential = window.location.hash.slice(1);
    try {
      if (/^[A-Za-z0-9_-]{43}$/.test(credential)) sessionStorage.setItem(key, credential);
      else credential = sessionStorage.getItem(key) ?? "";
    } catch {
      /* The current tab can still use the in-memory invitation. */
    }
    // Fragment credentials are not sent in HTTP URLs. Remove them before any subsequent navigation.
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${window.location.search}`,
    );
    setToken(credential);
  }, [id]);
  const refresh = useCallback(async () => {
    const sequence = ++loadSequence.current;
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
      setRoom(null);
      setError(
        "This invitation is unavailable. Open the complete private link your photographer sent you.",
      );
      if (sequence === loadSequence.current) setLoading(false);
      return;
    }
    try {
      const next = await openClientDelivery({ data: { id, token } });
      if (sequence === loadSequence.current) {
        setRoom((old) => (old?.id === next.id && old.revision > next.revision ? old : next));
        setError("");
      }
    } catch (e) {
      if (sequence === loadSequence.current) {
        const message = messageOf(e);
        if (/this link is unavailable/i.test(message)) setRoom(null);
        setError(message);
      }
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, [id, token]);
  useEffect(() => {
    if (token !== null) void refresh();
  }, [token, refresh]);
  useEffect(() => {
    if (!token) return;
    const timer = window.setInterval(() => {
      if (!document.hidden && !busy) void refresh();
    }, 20000);
    const focus = () => {
      if (!busy) void refresh();
    };
    window.addEventListener("focus", focus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", focus);
    };
  }, [token, busy, refresh]);
  const run = async (command: DeliveryCommand, retryOperationId?: string) => {
    if (!room || !token) throw new Error("Open your private invitation first.");
    const key = JSON.stringify(command),
      operationId = retryOperationId ?? ops.current.get(key) ?? crypto.randomUUID();
    ops.current.set(key, operationId);
    setBusy(true);
    try {
      const next = await changeClientDelivery({
        data: { id, token, revision: room.revision, operationId, command },
      });
      setRoom((old) => (old?.id === next.id && old.revision > next.revision ? old : next));
      ops.current.delete(key);
    } catch (e) {
      throw new Error(
        `${messageOf(e)} Your message has not been cleared. Refresh before retrying.`,
      );
    } finally {
      setBusy(false);
    }
  };
  const media: MediaReader = async (versionIds, kind) => {
    if (!token) throw new Error("Invitation unavailable.");
    return getClientDeliveryMedia({ data: { id, token, versionIds, kind } });
  };
  if (loading)
    return (
      <main className="delivery-recovery" aria-live="polite">
        <LogoMark />
        <p>Opening your private gallery…</p>
      </main>
    );
  if (!room)
    return (
      <main className="delivery-recovery">
        <LogoMark />
        <h1>Let’s get you to your photos.</h1>
        <p>
          {error || "This link is unavailable. Ask your photographer for a new private invitation."}
        </p>
        <button className="delivery-primary" onClick={() => void refresh()}>
          Try again
        </button>
      </main>
    );
  const draftScope = commentDraftScope(id, invitationGeneration(room.state));
  return (
    <main className="delivery-client">
      <ClientGalleryHeader state={room.state} />
      {error && (
        <p className="delivery-error" role="alert">
          Could not refresh: {error}. Your unsent comments are still here.
        </p>
      )}
      <DeliveryGallery
        key={draftScope}
        draftScope={draftScope}
        room={room}
        actor="client"
        busy={busy}
        run={run}
        refresh={refresh}
        media={media}
      />
      <ClientGalleryFooter state={room.state} />
    </main>
  );
}
