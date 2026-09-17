import { BrandMark } from "@/components/marketing/BrandMark";

/** Marks are the files those companies publish (favicon / app icon / Simple Icons path). Not letter tiles. */
const FILES: Record<string, string> = {
  aftershoot: "/images/compare/aftershoot.webp",
  imagen: "/images/compare/imagen.png",
  pixieset: "/images/compare/pixieset.png",
  shootproof: "/images/compare/shootproof.svg",
  photomechanic: "/images/compare/photomechanic.png",
  captureone: "/images/compare/capture-one.png",
  cloudspot: "/images/compare/cloudspot.png",
  pictime: "/images/compare/pic-time.png",
  smugmug: "/images/compare/smugmug.svg",
};

export function CompetitorMark({ id }: { id: string }) {
  if (id === "lightroom") return <BrandMark id="lightroom" />;
  const src = FILES[id];
  if (!src) return null;
  return <img className="celinen-compare__logo" src={src} alt="" width={32} height={32} />;
}
