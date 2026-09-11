import { useEffect, useState } from "react";
import {
  formatLivePhotographers,
  LIVE_TICK_MS,
  livePhotographers,
} from "@/lib/public-integrations";

export function LivePhotographers() {
  const [count, setCount] = useState(() => livePhotographers());
  useEffect(() => {
    const id = window.setInterval(() => setCount((n) => n + 1), LIVE_TICK_MS);
    return () => window.clearInterval(id);
  }, []);
  return (
    <p className="marketing-live" aria-live="polite">
      <span className="marketing-live__dot" aria-hidden="true" />
      <strong>LIVE</strong>
      <span className="marketing-live__rule" aria-hidden="true">
        |
      </span>
      {formatLivePhotographers(count)} photographers
    </p>
  );
}
