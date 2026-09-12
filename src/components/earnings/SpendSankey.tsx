/** Stripe-style split: one bar into verified ledger categories. No boxed nodes. */

const BANDS = ["#4d6fff", "#36a994", "#9674d7", "#d36ba6", "#da874e", "#7d8da3"];

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

  if (!positive.length || total <= 0) {
    return <p className="spend-sankey__empty">No recorded allocation in this period.</p>;
  }

  const nodes = positive.map((slice, index) => ({
    ...slice,
    color: BANDS[index % BANDS.length],
    share: slice.amountMinor / total,
  }));

  return (
    <div className="spend-sankey">
      <div
        className="spend-sankey__bar"
        role="img"
        aria-label={`${sourceLabel} ${money(sourceMinor)} split across ${nodes.length} categories`}
      >
        {nodes.map((node) => (
          <span
            key={node.label}
            style={{ flexGrow: node.amountMinor, background: node.color }}
            title={`${node.label}: ${money(node.amountMinor)}`}
          />
        ))}
      </div>
      <ul className="spend-sankey__legend">
        {nodes.map((node) => (
          <li key={node.label} aria-label={`${node.label}: ${money(node.amountMinor)}`}>
            <i style={{ background: node.color }} />
            <span>{node.label}</span>
            <em>{Math.round(node.share * 100)}%</em>
            <strong>{money(node.amountMinor)}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}
