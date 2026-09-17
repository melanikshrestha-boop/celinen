import {
  APPLICATION_ORIGIN,
  PRODUCTION_ORIGIN,
  applicationOrigin,
  applicationUrl,
} from "./application-origin";

/** A public product invitation, never a workspace membership or authentication token. */
export function friendInvitation(configuredOrigin = APPLICATION_ORIGIN) {
  const origin = applicationOrigin(configuredOrigin);
  const hostname = new URL(origin).hostname;
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
  const url = applicationUrl(
    "/auth?next=%2Fdashboard&mode=signup",
    local ? PRODUCTION_ORIGIN : origin,
  );
  const title = "Join me on Celinen";
  const text = "Try Celinen for your photography workflow. Create your own account here:";
  return {
    url,
    title,
    text,
    emailHref: `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(`${text}\n\n${url}`)}`,
  };
}

export async function copyFriendInvitation(
  url: string,
  clipboard?: Pick<Clipboard, "writeText">,
): Promise<"copied" | "manual"> {
  try {
    if (!clipboard?.writeText) return "manual";
    await clipboard.writeText(url);
    return "copied";
  } catch {
    return "manual";
  }
}

export async function shareFriendInvitation(
  invitation: Pick<ReturnType<typeof friendInvitation>, "title" | "text" | "url">,
  share?: (data: ShareData) => Promise<void>,
): Promise<"shared" | "cancelled" | "unavailable" | "failed"> {
  if (!share) return "unavailable";
  try {
    // Explicit allowlist: never pass other account, shoot or mail properties to the OS.
    await share({ title: invitation.title, text: invitation.text, url: invitation.url });
    return "shared";
  } catch (error) {
    return error instanceof Error && error.name === "AbortError" ? "cancelled" : "failed";
  }
}
