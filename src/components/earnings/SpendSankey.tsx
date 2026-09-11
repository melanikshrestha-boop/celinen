/** Origin-style allocation: one total splits into verified ledger categories. No demo merchants. */

const BANDS = ["#c9b48a", "#8fa38a", "#7d93b2", "#c4897c", "#9b8bb4", "#6e9aa0"];

export type SpendSlice = { label: string; amountMinor: number };

export function SpendSankey({
  sourceLabel,
  sourceMinor,
  slices,
  money,
}: {
  sourceLabel: string;
  sourceMinor: number;
  slices: readonly SpendSlice[];
  money: (minor: number) => string;
}) {
  const positive = slices.filter((slice) => slice.amountMinor > 0);
  const total = positive.reduce((sum, slice) => sum + slice.amountMinor, 0);
  const height = Math.max(220, 48 + positive.length * 48);
  const leftH = Math.max(72, height - 48);
  const leftY = (height - leftH) / 2;

  if (!positive.length || total <= 0) {
    return <p className="spend-sankey__empty">No recorded allocation in this period.</p>;
  }

  const gap = 8;
  const usable = height - 36 - gap * Math.max(0, positive.length - 1);
  let rightY = 18;
  let used = 0;
  const nodes = positive.map((slice, index) => {
    const h = Math.max(18, (slice.amountMinor / total) * usable);
    const y = rightY;
    const leftTop = leftY + (used / total) * leftH;
    used += slice.amountMinor;
    const leftBottom = leftY + (used / total) * leftH;
    rightY += h + gap;
    return { ...slice, y, h, leftTop, leftBottom, color: BANDS[index % BANDS.length] };
  });

  return (
    <div className="spend-sankey">
      <svg
        viewBox={`0 0 640 ${height}`}
        role="img"
        aria-label={`${sourceLabel} ${money(sourceMinor)} split across ${nodes.length} categories`}
      >
        {nodes.map((node) => {
          const d = `M 168 ${node.leftTop} C 280 ${node.leftTop}, 300 ${node.y}, 412 ${node.y} L 412 ${node.y + node.h} C 300 ${node.y + node.h}, 280 ${node.leftBottom}, 168 ${node.leftBottom} Z`;
          return <path key={node.label} d={d} fill={node.color} opacity="0.55" />;
        })}
        <rect x="24" y={leftY} width="144" height={leftH} rx="16" fill="#1c1915" />
        <text x="96" y={leftY + leftH / 2 - 8} textAnchor="middle" fill="#f4efe6" fontSize="12">
          {sourceLabel}
        </text>
        <text
          x="96"
          y={leftY + leftH / 2 + 14}
          textAnchor="middle"
          fill="#f4efe6"
          fontSize="15"
          fontWeight="650"
        >
          {money(sourceMinor)}
        </text>
        {nodes.map((node) => (
          <g key={node.label}>
            <rect x="412" y={node.y} width="204" height={node.h} rx="12" fill={node.color} />
            <text x="428" y={node.y + Math.min(18, node.h / 2 + 4)} fill="#1c1915" fontSize="12">
              {node.label}
            </text>
            {node.h > 28 ? (
              <text x="428" y={node.y + 32} fill="#1c1915" fontSize="13" fontWeight="650">
                {money(node.amountMinor)}
              </text>
            ) : null}
          </g>
        ))}
      </svg>
      <ul className="spend-sankey__legend">
        {nodes.map((node) => (
          <li key={node.label}>
            <i style={{ background: node.color }} />
            <span>{node.label}</span>
            <strong>{money(node.amountMinor)}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}
