import { useEffect, useRef, useState } from "react";
import "./marketing-stats.css";

const STATS = [
  { to: 12480, suffix: "+", label: "Photographers" },
  { to: 186420, suffix: "+", label: "Galleries sent" },
  { to: 842600, suffix: "+", label: "Frames picked" },
  { to: 8, suffix: "", label: "Editors connected" },
] as const;

function Count({
  to,
  suffix,
  label,
  delay,
}: {
  to: number;
  suffix: string;
  label: string;
  delay: number;
}) {
  const ref = useRef<HTMLElement>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    const node = ref.current;
    const view = node?.ownerDocument.defaultView;
    if (!node || !view) return;
    const reduce = view.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setN(to);
      return;
    }
    let frame = 0;
    let wait = 0;
    let started = false;
    const run = () => {
      if (started) return;
      started = true;
      wait = view.setTimeout(() => {
        const start = view.performance.now();
        const duration = 2200;
        const tick = (now: number) => {
          const t = Math.min(1, (now - start) / duration);
          const eased = 1 - (1 - t) ** 3;
          setN(Math.round(to * eased));
          if (t < 1) frame = view.requestAnimationFrame(tick);
        };
        frame = view.requestAnimationFrame(tick);
      }, delay);
    };
    const revealed = () => {
      const host = node.closest<HTMLElement>("[data-reveal]");
      return !host || host.dataset["revealState"] === "visible";
    };
    const tryStart = () => {
      if (revealed()) run();
    };
    const host = node.closest<HTMLElement>("[data-reveal]");
    const mutations = host
      ? new view.MutationObserver(tryStart)
      : null;
    mutations?.observe(host!, { attributes: true, attributeFilter: ["data-reveal-state"] });
    const observer = new view.IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        observer.disconnect();
        tryStart();
      },
      { threshold: 0.45, rootMargin: "0px 0px -8% 0px" },
    );
    observer.observe(node);
    tryStart();
    return () => {
      started = true;
      observer.disconnect();
      mutations?.disconnect();
      view.clearTimeout(wait);
      view.cancelAnimationFrame(frame);
    };
  }, [to, delay]);
  return (
    <strong ref={ref} aria-label={`${to.toLocaleString("en-US")}${suffix} ${label}`}>
      {n.toLocaleString("en-US")}
      {suffix}
    </strong>
  );
}

export function MarketingStats() {
  return (
    <section className="marketing-stats" aria-label="FOTO in numbers" data-reveal>
      {STATS.map((stat, index) => (
        <p key={stat.label}>
          <Count to={stat.to} suffix={stat.suffix} delay={index * 160} label={stat.label} />
          <span>{stat.label}</span>
        </p>
      ))}
    </section>
  );
}
