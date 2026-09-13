/** Positive ledger categories, as a compact bar or ring. Never plot negative shares. */

const BANDS = ["#4d6fff", "#36a994", "#9674d7", "#d36ba6", "#da874e", "#7d8da3"];

export type SpendSlice = { label: string; amountMinor: number };

export function SpendSankey({
  sourceLabel,
  sourceMinor,
  slices,
  money,
  donut = false,
}: {
  sourceLabel: string;
  sourceMinor: number;
  slices: readonly SpendSlice[];
  money: (minor: number) => string;
  donut?: boolean;
}) {
  const positive = slices.filter((slice) => slice.amountMinor > 0);
  const total = positive.reduce((sum, slice) => sum + slice.amountMinor, 0);
  const basisLabel = total === sourceMinor ? sourceLabel : "Positive categories";

  if (!positive.length || total <= 0) {
    return <p className="spend-sankey__empty">No recorded allocation in this period.</p>;
  }

  const nodes = positive.map((slice, index) => ({
    ...slice,
    color: BANDS[index % BANDS.length],
    share: slice.amountMinor / total,
  }));
  let offset = 0;

  return (
    <div className={`spend-sankey${donut ? " spend-sankey--donut" : ""}`}>
      {donut ? (
        <div className="spend-sankey__disk">
          <svg
            viewBox="0 0 200 200"
            role="img"
            aria-label={`${basisLabel} breakdown: ${money(total)} across ${nodes.length} categories`}
          >
            {nodes.map((node) => {
              const start = offset;
              offset += node.share * 100;
              return (
                <circle
                  key={node.label}
                  cx="100"
                  cy="100"
                  r="78"
                  fill="none"
                  stroke={node.color}
                  strokeWidth="16"
                  pathLength="100"
                  strokeDasharray={`${node.share * 100} ${100 - node.share * 100}`}
                  strokeDashoffset={-start}
                  transform="rotate(-90 100 100)"
                >
                  <title>{`${node.label}: ${money(node.amountMinor)}`}</title>
                </circle>
              );
            })}
          </svg>
          <div className="spend-sankey__center">
            <strong>{money(total)}</strong>
            <span>{basisLabel}</span>
          </div>
        </div>
      ) : (
        <div
          className="spend-sankey__bar"
          role="img"
          aria-label={`${basisLabel} ${money(total)} split across ${nodes.length} categories`}
        >
          {nodes.map((node) => (
            <span
              key={node.label}
              style={{ flexGrow: node.amountMinor, background: node.color }}
              title={`${node.label}: ${money(node.amountMinor)}`}
            />
          ))}
        </div>
      )}
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
      {total !== sourceMinor && (
        <p className="spend-sankey__empty">
          Positive categories total {money(total)}. The recorded total is {money(sourceMinor)} after
          refunds or corrections; negative categories cannot be drawn as shares.
        </p>
      )}
    </div>
  );
}
