import { useEffect, useState } from "react";
import { useAccount } from "./AccountProvider";
import { useWorkbench } from "@/components/workbench/context";
import "./settings-workspace.css";

/** Mounted once per workspace, including while Settings is open. */
export function WorkspacePreferences() {
  const account = useAccount();
  const workbench = useWorkbench();
  const [error, setError] = useState("");
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
      if ((event.metaKey || event.ctrlKey) && event.key === ",") {
        event.preventDefault();
        void workbench?.openTool("/settings");
      }
      if (
        event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        event.code === "Space" &&
        !event.isComposing &&
        !(event.target as HTMLElement)?.closest("input,textarea,[contenteditable=true]")
      ) {
        event.preventDefault();
        try {
          account?.savePreferences({ showPet: !account.preferences.showPet });
          setError("");
        } catch {
          setError("Could not save the pet preference.");
        }
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [account, workbench]);
  return (
    <>
      {account?.preferences.showPet && (
        <button
          className="workspace-pet"
          aria-label="Tuck away pet"
          title="Tuck away pet · Ctrl+Space"
          onClick={() => {
            try {
              account.savePreferences({ showPet: false });
              setError("");
            } catch {
              setError("Could not save the pet preference.");
            }
          }}
        >
          <span aria-hidden="true">{account.preferences.pet === "cat" ? "🐈" : "🐕"}</span>
        </button>
      )}
      {error && (
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
