import { BrandMark } from "@/components/marketing/BrandMark";

const TILES: Record<string, { bg: string; fg: string; label: string }> = {
  aftershoot: { bg: "#111111", fg: "#FF6A00", label: "A" },
  imagen: { bg: "#0F6B5C", fg: "#fff", label: "Im" },
  pixieset: { bg: "#1AA7A1", fg: "#fff", label: "P" },
  shootproof: { bg: "#E85D04", fg: "#fff", label: "SP" },
  photomechanic: { bg: "#F5C518", fg: "#111", label: "PM" },
  captureone: { bg: "#C2410C", fg: "#fff", label: "C1" },
  cloudspot: { bg: "#2563EB", fg: "#fff", label: "CS" },
  pictime: { bg: "#E11D48", fg: "#fff", label: "PT" },
  smugmug: { bg: "#EA580C", fg: "#fff", label: "SM" },
};

export function CompetitorMark({ id }: { id: string }) {
  if (id === "lightroom") return <BrandMark id="lightroom" />;
  const tile = TILES[id];
  if (!tile) return null;
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill={tile.bg} />
      <text
        x="16"
        y="21"
        textAnchor="middle"
        fill={tile.fg}
        fontSize="11"
        fontWeight="700"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
      >
        {tile.label}
      </text>
    </svg>
  );
}
