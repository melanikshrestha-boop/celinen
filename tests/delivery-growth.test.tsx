import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ClientGalleryHeader,
  ClientGalleryFooter,
} from "../src/components/delivery/ClientGalleryIdentity";
import {
  copyGalleryText,
  invitationGeneration,
  galleryInvitation,
  gallerySignupPath,
  isGalleryAcquisition,
} from "../src/lib/delivery/experience";
import {
  galleryPresentation,
  galleryPresentationSchema,
  sameGalleryPresentation,
} from "../src/lib/delivery/gallery-presentation";
import { clientState, commandSchema, newDelivery, transition } from "../src/lib/delivery/workflow";

const now = "2026-09-06T12:00:00.000Z";
const id = () => crypto.randomUUID();
const draft = () =>
  newDelivery(
    {
      id: id(),
      title: "Friday finals",
      clientName: "United",
      message: "",
      selectionLimit: 12,
      expiresAt: "2026-10-01T12:00:00.000Z",
    },
    now,
  );
const url = `https://gallery.example/review/${id()}#${"a".repeat(43)}`;
const brand = { studioName: "Céline Nova", showLensLabsCredit: false };

describe("permissioned gallery growth", () => {
  test("observed rotation or closure invalidates the cached invitation generation", () => {
    const state = draft();
    expect(invitationGeneration(state)).toBeNull();
    const rotation = id();
    state.events.push({
      id: rotation,
      role: "owner",
      at: now,
      text: "Private invitation replaced; previous link revoked",
    });
    expect(invitationGeneration(state)).toBe(rotation);
    state.events.push({
      id: id(),
      role: "client",
      at: now,
      text: "Private invitation replaced; previous link revoked",
    });
    expect(invitationGeneration(state)).toBe(rotation);
    const next = id();
    state.events.push({
      id: next,
      role: "owner",
      at: now,
      text: "Private invitation replaced; previous link revoked",
    });
    expect(invitationGeneration(state)).not.toBe(rotation);
    const closed = id();
    state.events.push({
      id: closed,
      role: "owner",
      at: now,
      text: "Gallery closed; new access disabled",
    });
    expect(invitationGeneration(state)).toBe(closed);
  });
  test("late clipboard completion cannot claim success for a new gallery", async () => {
    let active = true,
      successes = 0,
      failures = 0;
    let finish!: () => void;
    const pending = copyGalleryText(
      "old invitation",
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
      () => active,
      () => successes++,
      () => failures++,
    );
    active = false;
    finish();
    await pending;
    expect(successes).toBe(0);
    expect(failures).toBe(0);
    active = true;
    await copyGalleryText(
      "current",
      async () => {},
      () => active,
      () => successes++,
      () => failures++,
    );
    expect(successes).toBe(1);
    await copyGalleryText(
      "current",
      async () => {
        throw new Error("denied");
      },
      () => active,
      () => successes++,
      () => failures++,
    );
    expect(failures).toBe(1);
  });
  test("old records retain defaults without migration", () => {
    const state = draft();
    expect(state.presentation).toBeUndefined();
    expect(galleryPresentation(state)).toEqual({ studioName: "", showLensLabsCredit: true });
    expect(sameGalleryPresentation(state, { presentation: galleryPresentation(state) })).toBe(true);
  });
  test("presentation is bounded, Unicode-safe, and not a tracking payload", () => {
    expect(galleryPresentationSchema.parse(brand)).toEqual(brand);
    for (const value of [
      { ...brand, studioName: "x".repeat(101) },
      { ...brand, studioName: "hi\nthere" },
      { ...brand, token: "secret" },
      { ...brand, showLensLabsCredit: "false" },
    ])
      expect(galleryPresentationSchema.safeParse(value).success).toBe(false);
  });
  test("owner-only presentation preserves explicit false in client DTO", () => {
    const state = { ...draft(), status: "live" as const };
    const command = commandSchema.parse({ type: "presentation", presentation: brand });
    expect(() => transition(state, command, "client", id(), "one", now)).toThrow("photographer");
    const next = transition(state, command, "owner", id(), "one", now);
    expect(clientState(next).presentation).toEqual(brand);
    expect(next.photos).toEqual(state.photos);
    expect(state.presentation).toBeUndefined();
  });
  test("receipts remain idempotent and cannot be repurposed", () => {
    const operation = id();
    const command = { type: "presentation" as const, presentation: brand };
    const state = transition(draft(), command, "owner", operation, "same", now);
    expect(transition(state, command, "owner", operation, "same", now)).toBe(state);
    expect(() => transition(state, command, "owner", operation, "different", now)).toThrow(
      "different request",
    );
  });
  test("invitation is specific, truthful and respects credit choice", () => {
    const state = { ...draft(), status: "live" as const, presentation: brand };
    const text = galleryInvitation(state, url, now);
    for (const value of [
      url,
      "Choose up to 12 favourites",
      "No new account needed",
      "Céline Nova",
      "October 1, 2026 (UTC)",
    ])
      expect(text).toContain(value);
    expect(text).not.toContain("Delivered with LensLabs");
    expect(
      galleryInvitation(
        { ...state, presentation: { ...brand, showLensLabsCredit: true } },
        url,
        now,
      ),
    ).toContain("Delivered with LensLabs");
  });
  test("closed, expired and malformed links cannot be called ready", () => {
    expect(() => galleryInvitation(draft(), url, now)).toThrow("publish");
    const live = { ...draft(), status: "live" as const };
    expect(() => galleryInvitation(live, url, "2027-01-01T00:00:00.000Z")).toThrow("publish");
    for (const invalid of [
      "javascript:alert(1)",
      url.replace("https:", "http:"),
      url.replace("#", "?token="),
      url.replace("gallery.example", "user:pw@gallery.example"),
      "https://gallery.example/review/x#abc",
    ])
      expect(() => galleryInvitation(live, invalid, now)).toThrow();
  });
  test("acquisition cannot carry the private gallery capability", () => {
    const destination = new URL(gallerySignupPath, "https://lenslab.dev");
    expect(destination.pathname).toBe("/auth");
    expect(destination.searchParams.get("next")).toBe("/deliver?workflow=1");
    expect(destination.hash).toBe("");
    expect([...destination.searchParams.keys()].sort()).toEqual(["mode", "next", "source"]);
    expect(isGalleryAcquisition("client-gallery")).toBe(true);
    for (const input of [
      null,
      "CLIENT-GALLERY",
      "client-gallery#token",
      { source: "client-gallery" },
    ])
      expect(isGalleryAcquisition(input)).toBe(false);
  });
  test("identity is escaped and credit-off removes attribution and signup", () => {
    const state = { ...draft(), presentation: { ...brand, studioName: "<script>evil()</script>" } };
    const header = renderToStaticMarkup(<ClientGalleryHeader state={state} />);
    expect(header).toContain("&lt;script&gt;");
    expect(header).not.toContain("<script>");
    const footer = renderToStaticMarkup(<ClientGalleryFooter state={state} />);
    expect(footer).not.toContain("LensLabs");
    expect(footer).not.toContain("/auth");
  });
  test("signup follows submitted selection and preview cannot navigate", () => {
    const state = draft();
    expect(renderToStaticMarkup(<ClientGalleryFooter state={state} />)).not.toContain("/auth");
    const operation = id();
    state.submissions.push({ id: operation, at: now, items: [] });
    state.events.push({ id: operation, at: now, role: "client", text: "Selections submitted" });
    const html = renderToStaticMarkup(<ClientGalleryFooter state={state} />);
    expect(html).toContain("/auth?");
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('referrerPolicy="no-referrer"');
    expect(renderToStaticMarkup(<ClientGalleryFooter state={state} preview />)).not.toContain(
      "href=",
    );
  });
});
