import { useEffect, useState } from "react";
import { useAccount } from "./AccountProvider";
import { useWorkbench } from "@/components/workbench/context";
import { X } from "lucide-react";
import { matchesShortcut, DEFAULT_SHORTCUTS } from "@/lib/shortcuts";
import { RESPONSE_READY, WORKSPACE_NOTIFICATION } from "@/lib/workspace-notifications";
import { CompanionArt } from "./CompanionArt";
import "./settings-workspace.css";
import "./workspace-personalization.css";
import { workspaceLanguage } from "@/lib/workspace-language";
import { useChatHistory } from "@/components/workbench/ChatHistory";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

/** Mounted once per workspace, including while Settings is open. */
export function WorkspacePreferences() {
  const account = useAccount();
  const workbench = useWorkbench();
  const history = useChatHistory();
  const [error, setError] = useState("");
  const [notification, setNotification] = useState(false);
  const [photoJump, setPhotoJump] = useState(false);
  const [photoNumber, setPhotoNumber] = useState("1");
  useEffect(() => {
    const before = document.documentElement.lang;
    document.documentElement.lang = workspaceLanguage(
      account?.preferences.language ?? "en",
      navigator.language,
    );
    return () => {
      document.documentElement.lang = before;
    };
  }, [account?.preferences.language]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const receive = () => {
      setNotification(true);
      clearTimeout(timer);
      timer = setTimeout(() => setNotification(false), 15_000);
    };
    window.addEventListener(WORKSPACE_NOTIFICATION, receive);
    return () => {
      window.removeEventListener(WORKSPACE_NOTIFICATION, receive);
      clearTimeout(timer);
    };
  }, []);
  useEffect(() => {
    if (account?.preferences.completionNotifications === "off") setNotification(false);
  }, [account?.preferences.completionNotifications]);
  useEffect(() => {
    document.documentElement.dataset["pointerCursors"] = String(
      account?.preferences.pointerCursors ?? true,
    );
    return () => {
      delete document.documentElement.dataset["pointerCursors"];
    };
  }, [account?.preferences.pointerCursors]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const bindings = account?.preferences.shortcuts ?? DEFAULT_SHORTCUTS;
      if (matchesShortcut(event, bindings.settings)) {
        event.preventDefault();
        void workbench?.openTool("/settings");
      }
      if (matchesShortcut(event, bindings.projects)) {
        event.preventDefault();
        void workbench?.openTool("/projects");
      }
      if (matchesShortcut(event, bindings.newShoot)) {
        event.preventDefault();
        void workbench?.newShoot?.();
      }
      if (matchesShortcut(event, bindings.pet)) {
        event.preventDefault();
        try {
          account?.savePreferences({ showPet: !account.preferences.showPet });
          setError("");
        } catch {
          setError("Could not save the pet preference.");
        }
      }
      const command = (
        [
          "newChat",
          "temporaryChat",
          "quickChat",
          "archiveChat",
          "standaloneChat",
          "sideChat",
          "unreadChat",
          "newWindow",
          "togglePin",
          "renameChat",
          "focusMain",
          "focusSide",
          "goToPhoto",
        ] as const
      ).find((id) => matchesShortcut(event, bindings[id]));
      if (!command) return;
      event.preventDefault();
      if (
        !history?.ready ||
        history.locked ||
        history.switching ||
        history.pending ||
        history.error
      ) {
        setError("Finish saving or responding before changing this chat.");
        return;
      }
      const focus = () =>
        requestAnimationFrame(() =>
          workbench?.chatTarget?.querySelector<HTMLTextAreaElement>("textarea")?.focus(),
        );
      const active = history.active;
      if (command === "newWindow") {
        if (!active || history.temporary || !history.rows.some((row) => row.id === active.id)) {
          setError("Save a regular conversation before opening it in another window.");
          return;
        }
        const url = new URL("/workspace", location.origin);
        if (workbench?.workspaceProjectId)
          url.searchParams.set("workspaceProject", workbench.workspaceProjectId);
        else
          url.searchParams.set("shoot", active.project === "current" ? "legacy" : active.project);
        url.searchParams.set("chat", active.id);
        window.open(url.href, "_blank", "noopener,noreferrer");
        setError("");
        return;
      }
      void (async () => {
        setError("");
        if (command === "newChat" || command === "temporaryChat") {
          if (await history.select(undefined, command === "temporaryChat")) {
            await workbench?.openTool("/workspace");
            workbench?.closeQuickChat?.();
            focus();
          }
        }
        if (command === "quickChat") await workbench?.openQuickChat?.();
        if (command === "standaloneChat") await workbench?.newShoot?.();
        if (command === "sideChat" || command === "focusSide") {
          await workbench?.showStudio();
          workbench?.closeQuickChat?.();
          focus();
        }
        if (command === "focusMain") {
          await workbench?.openTool("/workspace");
          workbench?.closeQuickChat?.();
          focus();
        }
        if (command === "archiveChat" && active) await history.archive(active.id, true);
        if (command === "togglePin" && active)
          await history.update(active.id, { pinned: !active.pinned });
        if (command === "unreadChat" && active) await history.update(active.id, { unread: true });
        if (command === "renameChat")
          window.dispatchEvent(
            new CustomEvent("lenslabs:chat-dialog", { detail: { action: "rename" } }),
          );
        if (command === "goToPhoto") {
          await workbench?.showStudio();
          setPhotoNumber("1");
          setPhotoJump(true);
        }
      })().catch((error) =>
        setError(error instanceof Error ? error.message : "Could not run this shortcut."),
      );
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [account, workbench, history]);
  return (
    <>
      <Dialog open={photoJump} onOpenChange={setPhotoJump}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Go to photo</DialogTitle>
            <DialogDescription>
              Open a photo by its position in the current shoot. Photos and edits are unchanged.
            </DialogDescription>
          </DialogHeader>
          <form
            className="ll-photo-jump"
            onSubmit={(event) => {
              event.preventDefault();
              let handled = false;
              window.dispatchEvent(
                new CustomEvent("lenslabs:go-to-photo", {
                  detail: {
                    number: Number(photoNumber),
                    respond: (message: string) => {
                      handled = true;
                      setError(message);
                      if (!message) setPhotoJump(false);
                    },
                  },
                }),
              );
              if (!handled) setError("Wait for Studio to load, then try again.");
            }}
          >
            <label>
              Photo number
              <input
                aria-label="Photo number"
                type="number"
                min={1}
                step={1}
                required
                value={photoNumber}
                onChange={(event) => setPhotoNumber(event.target.value)}
              />
            </label>
            <button className="settings-button">Go to photo</button>
            {error && <p role="alert">{error}</p>}
          </form>
        </DialogContent>
      </Dialog>
      {notification && (
        <div className="workspace-notification" role="status">
          <span>{RESPONSE_READY}</span>
          <button aria-label="Dismiss notification" onClick={() => setNotification(false)}>
            <X size={16} />
          </button>
        </div>
      )}
      {account?.preferences.showPet && (
        <div className="workspace-pet" data-position={account.preferences.petPosition}>
          <CompanionArt
            kind={account.preferences.pet}
            image={account.preferences.petImage}
            animate={account.preferences.petAnimation && !account.preferences.reduceMotion}
          />
        </div>
      )}
      {error && !photoJump && (
        <p role="alert" className="account-inline-error">
          {error}
        </p>
      )}
    </>
  );
}

/** Never requests a wake lock at page load or while the tab is hidden. */
// eslint-disable-next-line react-refresh/only-export-components
export function useProcessingWakeLock(enabled: boolean, processing: boolean) {
  useEffect(() => {
    if (!enabled || !processing || !navigator.wakeLock) return;
    let disposed = false;
    let sentinel: WakeLockSentinel | null = null;
    let pending = false;
    const acquire = async () => {
      if (disposed || pending || sentinel || document.visibilityState !== "visible") return;
      pending = true;
      try {
        const lock = await navigator.wakeLock.request("screen");
        if (disposed) {
          await lock.release();
          return;
        }
        sentinel = lock;
        document.documentElement.dataset["processingWakeLock"] = "active";
        lock.addEventListener("release", () => {
          if (sentinel === lock) sentinel = null;
          document.documentElement.dataset["processingWakeLock"] = "released";
        });
      } catch {
        document.documentElement.dataset["processingWakeLock"] = "unavailable";
      } finally {
        pending = false;
      }
    };
    void acquire();
    document.addEventListener("visibilitychange", acquire);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", acquire);
      void sentinel?.release().catch(() => {});
      delete document.documentElement.dataset["processingWakeLock"];
    };
  }, [enabled, processing]);
}
