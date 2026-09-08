/** Full pie wedge or donut ring segment (Wonder Finances geometry). */
export function pieSlicePath(
  cx: number,
  cy: number,
  rOuter: number,
  rInner: number,
  a0: number,
  a1: number,
  fullCircle: boolean,
): string {
  if (fullCircle) {
    if (rInner <= 0.5) {
      return `M${cx - rOuter},${cy} a${rOuter},${rOuter} 0 1,0 ${rOuter * 2},0 a${rOuter},${rOuter} 0 1,0 ${-rOuter * 2},0`;
    }
    return [
      `M${cx},${cy - rOuter}`,
      `A${rOuter},${rOuter} 0 1 1 ${cx},${cy + rOuter}`,
      `A${rOuter},${rOuter} 0 1 1 ${cx},${cy - rOuter}`,
      "Z",
      `M${cx},${cy - rInner}`,
      `A${rInner},${rInner} 0 1 0 ${cx},${cy + rInner}`,
      `A${rInner},${rInner} 0 1 0 ${cx},${cy - rInner}`,
      "Z",
    ].join(" ");
  }

  const large = a1 - a0 > Math.PI ? 1 : 0;
  const xo0 = cx + rOuter * Math.cos(a0);
  const yo0 = cy + rOuter * Math.sin(a0);
  const xo1 = cx + rOuter * Math.cos(a1);
  const yo1 = cy + rOuter * Math.sin(a1);
  if (rInner <= 0.5) {
    return `M${cx},${cy} L${xo0.toFixed(2)},${yo0.toFixed(2)} A${rOuter},${rOuter} 0 ${large} 1 ${xo1.toFixed(2)},${yo1.toFixed(2)} Z`;
  }

  const xi0 = cx + rInner * Math.cos(a0);
  const yi0 = cy + rInner * Math.sin(a0);
  const xi1 = cx + rInner * Math.cos(a1);
  const yi1 = cy + rInner * Math.sin(a1);
  return [
    `M${xo0.toFixed(2)},${yo0.toFixed(2)}`,
    `A${rOuter},${rOuter} 0 ${large} 1 ${xo1.toFixed(2)},${yo1.toFixed(2)}`,
    `L${xi1.toFixed(2)},${yi1.toFixed(2)}`,
    `A${rInner},${rInner} 0 ${large} 0 ${xi0.toFixed(2)},${yi0.toFixed(2)}`,
    "Z",
  ].join(" ");
}
