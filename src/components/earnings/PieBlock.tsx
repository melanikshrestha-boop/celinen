import { money } from "./money";
import { InteractivePie, type PiePalette, type PieSlice } from "./Pie";

export function PieBlock({
  title,
  slices,
  palette,
  centerTotal,
}: {
  title: string;
  slices: PieSlice[];
  palette: PiePalette;
  centerTotal?: string;
}) {
  const rows = slices.filter((x) => x.amount > 0.0001);
  const total = rows.reduce((s, r) => s + r.amount, 0);

  const hole = centerTotal ?? (total > 0 ? money(total) : "");
  return (
    <InteractivePie
      title={title}
      slices={rows}
      palette={palette}
      {...(hole ? { centerTotal: hole } : {})}
      size={200}
    />
  );
}
