import { describe, expect, test } from "bun:test";
import {
  copyFriendInvitation,
  friendInvitation,
  shareFriendInvitation,
} from "../src/lib/friend-invitation";

describe("Invite a friend", () => {
  test("canonical link opens signup, never the sender's shoot or identity", () => {
    const invitation = friendInvitation();
    const url = new URL(invitation.url);
    expect(url.origin).toBe("https://lenslab.dev");
    expect(url.pathname).toBe("/auth");
    expect([...url.searchParams.keys()].sort()).toEqual(["mode", "next"]);
    expect(url.searchParams.get("mode")).toBe("signup");
    expect(url.searchParams.get("next")).toBe("/workspace");
    expect(url.hash).toBe("");
    expect(JSON.stringify(invitation)).not.toContain("Celine");
  });
  test("local lab URLs are never shared with friends", () => {
    for (const origin of [
      "http://localhost:8080",
      "http://127.0.0.1:8085",
      "http://[::1]:8085",
      "https://localhost",
    ])
      expect(friendInvitation(origin).url).toBe(friendInvitation().url);
  });
  test("configured public app origin is preserved", () => {
    expect(new URL(friendInvitation("https://photos.example.com").url).origin).toBe(
      "https://photos.example.com",
    );
  });
  test("origin cannot carry credentials, parameters, private paths or unsafe schemes", () => {
    for (const origin of [
      "javascript:alert(1)",
      "http://evil.test",
      "https://name:secret@evil.test",
      "https://lenslab.dev/?shoot=private",
      "https://lenslab.dev/#token",
      "https://lenslab.dev/workspace",
    ])
      expect(() => friendInvitation(origin)).toThrow();
  });
  test("email is a user-reviewed draft, with no recipient or sender data", () => {
    const invitation = friendInvitation();
    const mail = new URL(invitation.emailHref);
    expect(mail.protocol).toBe("mailto:");
    expect(mail.pathname).toBe("");
    expect([...mail.searchParams.keys()].sort()).toEqual(["body", "subject"]);
    expect(mail.searchParams.get("subject")).toBe(invitation.title);
    expect(mail.searchParams.get("body")).toBe(`${invitation.text}\n\n${invitation.url}`);
  });
  test("copy success only follows actual clipboard resolution", async () => {
    let resolve!: () => void;
    let copied = "";
    const writing = copyFriendInvitation(friendInvitation().url, {
      writeText: (value) => {
        copied = value;
        return new Promise<void>((done) => {
          resolve = done;
        });
      },
    });
    let finished = false;
    void writing.then(() => {
      finished = true;
    });
    await Promise.resolve();
    expect(finished).toBe(false);
    expect(copied).toBe(friendInvitation().url);
    resolve();
    expect(await writing).toBe("copied");
  });
  test("missing, throwing or denied clipboard falls back to manual copy", async () => {
    expect(await copyFriendInvitation("url")).toBe("manual");
    expect(
      await copyFriendInvitation("url", {
        writeText: () => {
          throw new Error("Unavailable");
        },
      }),
    ).toBe("manual");
    expect(
      await copyFriendInvitation("url", {
        writeText: async () => {
          throw new DOMException("Denied", "NotAllowedError");
        },
      }),
    ).toBe("manual");
  });
  test("share payload contains only public allowlisted values", async () => {
    let payload: ShareData | undefined;
    expect(
      await shareFriendInvitation(
        { ...friendInvitation(), secret: "private" } as ReturnType<typeof friendInvitation>,
        async (data) => {
          payload = data;
        },
      ),
    ).toBe("shared");
    expect(payload).toEqual({
      title: friendInvitation().title,
      text: friendInvitation().text,
      url: friendInvitation().url,
    });
  });
  test("share cancellation is not reported as sent or failed", async () => {
    expect(
      await shareFriendInvitation(friendInvitation(), async () => {
        throw new DOMException("Cancelled", "AbortError");
      }),
    ).toBe("cancelled");
  });
  test("unsupported and failed share retain the copy alternative", async () => {
    expect(await shareFriendInvitation(friendInvitation())).toBe("unavailable");
    expect(
      await shareFriendInvitation(friendInvitation(), async () => {
        throw new Error("Blocked");
      }),
    ).toBe("failed");
  });
});
