import type { AccountPreferences } from "./account-preferences";

export const WORKSPACE_NOTIFICATION = "lenslabs:response-ready";
export const RESPONSE_READY = "A response is ready to review in your chat.";

export function shouldNotify(
  mode: AccountPreferences["completionNotifications"],
  focused: boolean,
) {
  return mode === "always" || (mode === "unfocused" && !focused);
}

/** Called only after a live chat turn settles, never when restoring saved history.
 * Deliberately excludes filenames, client names, prompts and response content.
 * OS permission is requested only by the explicit Settings button.
 */
export function notifyResponseReady(preferences: AccountPreferences) {
  if (typeof window === "undefined") return "off";
  if (
    !shouldNotify(
      preferences.completionNotifications,
      document.visibilityState === "visible" && document.hasFocus(),
    )
  )
    return "off";
  if (
    preferences.desktopNotifications &&
    "Notification" in window &&
    Notification.permission === "granted"
  ) {
    try {
      const notification = new Notification("LensLabs", {
        body: RESPONSE_READY,
        tag: "lenslabs-response-ready",
        silent: true,
      });
      setTimeout(() => notification.close(), 15_000);
      return "desktop";
    } catch {
      // Browsers may expose Notification but reject its constructor (e.g. mobile).
    }
  }
  window.dispatchEvent(new Event(WORKSPACE_NOTIFICATION));
  return "in-app";
}
