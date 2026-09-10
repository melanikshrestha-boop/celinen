import { useEffect, useRef } from "react";
import { BrandMark } from "@/components/marketing/BrandMark";
import { orbitPose, scaleOrbit, VIEW_H, VIEW_W } from "@/lib/connector-orbit";
import "./marketing-connect.css";

const RINGS: { id: string; label: string; href: string }[][] = [
  [
    { id: "instagram", label: "Instagram", href: "/docs" },
    { id: "tiktok", label: "TikTok", href: "/docs" },
    { id: "youtube", label: "YouTube", href: "/docs" },
    { id: "x", label: "X", href: "/docs" },
    { id: "facebook", label: "Facebook", href: "/docs" },
    { id: "linkedin", label: "LinkedIn", href: "/docs" },
    { id: "pinterest", label: "Pinterest", href: "/docs" },
  ],
  [
    { id: "adobe", label: "Adobe", href: "/adobe" },
    { id: "threads", label: "Threads", href: "/docs" },
    { id: "whatsapp", label: "WhatsApp", href: "/docs" },
    { id: "snapchat", label: "Snapchat", href: "/docs" },
    { id: "bluesky", label: "Bluesky", href: "/docs" },
  ],
  [
    { id: "reddit", label: "Reddit", href: "/docs" },
    { id: "telegram", label: "Telegram", href: "/docs" },
    { id: "discord", label: "Discord", href: "/docs" },
  ],
];

const NODES = RINGS.flatMap((ring, ringIndex) =>
  ring.map((node, index) => ({ ...node, ring: ringIndex as 0 | 1 | 2, index, count: ring.length })),
);

export function IntegrationsSection() {
  const stageRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef<(HTMLAnchorElement | null)[]>([]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    const started = performance.now();
    const paint = (now: number) => {
      const width = stage.clientWidth;
      const scale = scaleOrbit(width);
      const time = reduce ? 0.35 : (now - started) / 1000;
      NODES.forEach((node, i) => {
        const el = nodeRefs.current[i];
        if (!el) return;
        const pose = orbitPose(node.ring, node.index, node.count, time);
        el.style.transform = `translate(-50%, -50%) translate(${pose.x * scale}px, ${pose.y * scale}px)`;
        el.style.opacity = String(pose.opacity);
        el.style.pointerEvents = pose.opacity < 0.12 ? "none" : "auto";
      });
      if (!reduce) frame = requestAnimationFrame(paint);
    };
    frame = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <section
      className="marketing-connect"
      id="connectors"
      aria-labelledby="connectors-heading"
      data-reveal
    >
      <h2 id="connectors-heading">
        Connectors <em>and APIs</em>
      </h2>
      <div ref={stageRef} className="marketing-connect__stage">
        <svg
          className="marketing-connect__arcs"
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id="foto-arc" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#006eaa" stopOpacity="0.08" />
              <stop offset="50%" stopColor="#006eaa" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#006eaa" stopOpacity="0.08" />
            </linearGradient>
          </defs>
          <path d="M 45 450 A 405 405 0 0 1 855 450" stroke="url(#foto-arc)" strokeWidth="1.5" fill="none" />
          <path d="M 162 450 A 288 288 0 0 1 738 450" stroke="url(#foto-arc)" strokeWidth="1.5" fill="none" />
          <path d="M 279 450 A 171 171 0 0 1 621 450" stroke="url(#foto-arc)" strokeWidth="1.5" fill="none" />
        </svg>
        {NODES.map((node, i) => (
          <a
            key={`${node.ring}-${node.id}-${node.index}`}
            ref={(el) => {
              nodeRefs.current[i] = el;
            }}
            href={node.href}
            aria-label={node.label}
            className="marketing-connect__node"
          >
            <BrandMark id={node.id} />
          </a>
        ))}
      </div>
      <a href="/docs" className="marketing-connect__cta">
        API keys
      </a>
    </section>
  );
}
