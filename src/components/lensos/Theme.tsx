import { useEffect, useState } from "react";
import { useAccount } from "@/components/account/AccountProvider";
import { THEME_PRESETS } from "@/lib/appearance";

type Mode = "light" | "dark";

export function ThemeToggle({ className }: { className?: string | undefined }) {
  const account = useAccount();
  const [mode, setMode] = useState<Mode>("dark");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (account?.scope) {
      setReady(true);
      return;
    }
    const stored = localStorage.getItem("lenslabs-theme") as Mode | null;
    const initial: Mode = stored ?? "dark";
    setMode(initial);
    document.documentElement.classList.toggle("dark", initial === "dark");
    setReady(true);
  }, [account?.scope]);

  const flip = () => {
    if (account?.scope) {
      try {
        const light = document.documentElement.classList.contains("dark");
        account.savePreferences({
          theme: light ? "light" : "dark",
          appearance: {
            ...account.preferences.appearance,
            preset: light ? "paper" : "lenslabs",
            ...(light ? THEME_PRESETS.paper : THEME_PRESETS.lenslabs),
          },
        });
      } catch {
        /* No unsaved preference is presented as saved. */
      }
      return;
    }
    const next: Mode = mode === "dark" ? "light" : "dark";
    setMode(next);
    localStorage.setItem("lenslabs-theme", next);
    document.documentElement.classList.toggle("dark", next === "dark");
  };

  return (
    <button
      onClick={flip}
      aria-label="Toggle color mode"
      className={
        "grid size-8 place-items-center rounded-lg border border-input text-moss transition-colors hover:text-ink " +
        (className ?? "")
      }
    >
      <span className="font-mono text-[12px]">
        {ready && (account?.scope ? account.preferences.theme !== "light" : mode === "dark")
          ? "☾"
          : "☀"}
      </span>
    </button>
  );
}
