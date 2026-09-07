import { describe, expect, test } from "bun:test";
import type { User, Session } from "@supabase/supabase-js";
import { verifiedPhotographer, verifiedSessionReceiver } from "../src/lib/account-access";
import { studioDatabaseKey, shootTitleSchema } from "../src/lib/studio/shoot-directory";
import { studioWorkbenchBinding, studioBindingHref, studioBindingKey } from "../src/lib/workbench";
import {
  resolveWorkspaceBinding,
  scopeToolHref,
  projectScope,
  tabProjectScope,
} from "../src/lib/workbench-projects";
import { rememberStudioRuntime, restoreStudioRuntime } from "../src/lib/studio/runtime";
import { DEFAULT_EDITS, type Shot } from "../src/lib/imaging";
import { isLocalSingleUserMode } from "../src/lib/app-mode";
const id = () => crypto.randomUUID();
const user = (uid: string) =>
  ({
    id: uid,
    email: "photographer@example.test",
    email_confirmed_at: "2026-09-06",
    is_anonymous: false,
  }) as User;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
describe("verified sign-in only", () => {
  test("switching accounts closes the previous workspace before verification finishes", async () => {
    const a = user(id()),
      b = user(id());
    let verifyB!: (u: User) => void;
    const seen: (User | null)[] = [];
    const receiver = verifiedSessionReceiver(
      async (token) =>
        token === "a"
          ? a
          : new Promise<User>((resolve) => {
              verifyB = resolve;
            }),
      (u) => seen.push(u),
      () => {},
    );
    receiver.receive({ user: a, access_token: "a" } as Session);
    await settle();
    expect(seen.at(-1)?.id).toBe(a.id);
    receiver.receive({ user: b, access_token: "b" } as Session);
    expect(seen.at(-1)).toBe(null);
    await settle();
    verifyB(b);
    await settle();
    expect(seen.at(-1)?.id).toBe(b.id);
  });
  test("localhost, local profile and an email alone are not signed-in identities", () => {
    expect(isLocalSingleUserMode).toBe(false);
    const uid = id();
    expect(verifiedPhotographer(user(uid), uid)).toBe(true);
    expect(verifiedPhotographer({ ...user(uid), email_confirmed_at: undefined }, uid)).toBe(false);
    expect(verifiedPhotographer({ ...user(uid), is_anonymous: true }, uid)).toBe(false);
    expect(verifiedPhotographer(user(uid), id())).toBe(false);
  });
  test("late verification cannot undo logout", async () => {
    const uid = id();
    let done!: (user: User) => void;
    const seen: (User | null)[] = [];
    const receiver = verifiedSessionReceiver(
      () =>
        new Promise((resolve) => {
          done = resolve;
        }),
      (u) => seen.push(u),
      () => {},
    );
    receiver.receive({ user: user(uid), access_token: "test-only" } as Session);
    await Promise.resolve();
    receiver.receive(null);
    done(user(uid));
    await settle();
    expect(seen).toEqual([null]);
  });
  test("failed verification closes access; verified remembered sign-in opens it", async () => {
    const uid = id();
    const seen: (User | null)[] = [];
    let failures = 0;
    const receiver = verifiedSessionReceiver(
      async (token) => (token === "valid" ? user(uid) : null),
      (u) => seen.push(u),
      () => failures++,
    );
    receiver.receive({ user: user(uid), access_token: "invalid" } as Session);
    await settle();
    expect(seen).toEqual([null]);
    expect(failures).toBe(1);
    receiver.receive({ user: user(uid), access_token: "valid" } as Session);
    await settle();
    expect(seen[1]?.id).toBe(uid);
  });
});
describe("independent shoot bindings", () => {
  test("the old shoot keeps its existing conversation and tool scope", () => {
    const binding = studioWorkbenchBinding("/workspace?shoot=legacy", false);
    expect(projectScope(binding)).toBe("current");
    expect(tabProjectScope(scopeToolHref("/deliver", binding))).toBe("current");
  });
  test("new contexts never share the legacy or another owner's database", () => {
    const owner = id(),
      shoot = id();
    expect(studioDatabaseKey("device-local")).toBe("lens-os-local-studio");
    expect(studioDatabaseKey(owner)).not.toBe(studioDatabaseKey(owner, shoot));
    expect(studioDatabaseKey(owner, shoot)).not.toBe(studioDatabaseKey(id(), shoot));
    expect(() => studioDatabaseKey(owner, "../bad")).toThrow();
    expect(shootTitleSchema.parse(" Lunara Glow Shoot ")).toBe("Lunara Glow Shoot");
  });
  test("new chat changes binding; contextual tools retain the precise shoot", () => {
    const a = studioWorkbenchBinding(`/workspace?shoot=${id()}`, false);
    const b = resolveWorkspaceBinding(`/workspace?shoot=${id()}`, a, false);
    expect(studioBindingKey(a)).not.toBe(studioBindingKey(b));
    expect(studioBindingHref(a)).toContain("/studio?shoot=");
    for (const tool of ["/workspace", "/studio", "/deliver?workflow=1", "/mail"]) {
      const href = scopeToolHref(tool, a);
      expect(tabProjectScope(href)).toBe(projectScope(a));
      expect(studioBindingKey(resolveWorkspaceBinding(href, a, false))).toBe(studioBindingKey(a));
    }
  });
  test("ambiguous shoot/project URLs never restore an unrelated editable shoot", () => {
    for (const url of [
      `/workspace?shoot=x`,
      `/workspace?shoot=${id()}&shoot=${id()}`,
      `/studio?shoot=${id()}&project=${id()}`,
    ])
      expect(studioWorkbenchBinding(url, false).kind).toBe("blocked");
  });
  test("runtime originals and Undo return only for matching saved work and owner", () => {
    const frame = {
      id: "a",
      name: "a.jpg",
      verdict: "keep",
      edits: DEFAULT_EDITS,
      file: new File(["original"], "a.jpg"),
      sourceAvailable: true,
    } as Shot;
    const undo = [{ frames: [{ id: "a", verdict: "undecided" }] }];
    const key = studioDatabaseKey(id(), id());
    rememberStudioRuntime(key, [frame], undo);
    const preview = { ...frame, file: new File(["preview"], "a.jpg"), sourceAvailable: false };
    expect(restoreStudioRuntime(key, [preview]).shots[0]?.file).toBe(frame.file);
    expect(restoreStudioRuntime(key, [preview]).undo).toEqual(undo);
    expect(restoreStudioRuntime("other-account", [preview]).undo).toEqual([]);
    expect(restoreStudioRuntime(key, [{ ...preview, verdict: "reject" }]).undo).toEqual([]);
    expect(restoreStudioRuntime(key, [{ ...preview, verdict: "reject" }]).shots[0]?.file).toBe(
      frame.file,
    );
  });
});
