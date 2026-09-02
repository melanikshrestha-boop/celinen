import { useEffect, useState } from "react";

type Mode = "light" | "dark";

export function ThemeToggle({ className }: { className?: string | undefined }) {
  const [mode, setMode] = useState<Mode>("dark");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("lenslabs-theme") as Mode | null;
    const initial: Mode = stored ?? "dark";
    setMode(initial);
    document.documentElement.classList.toggle("dark", initial === "dark");
    setReady(true);
  }, []);


  const flip = () => {
    const next: Mode = mode === "dark" ? "light" : "dark";
    setMode(next);
    localStorage.setItem("lensos-theme", next);
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
      <span className="font-mono text-[12px]">{ready && mode === "dark" ? "☾" : "☀"}</span>
    </button>
  );
}
