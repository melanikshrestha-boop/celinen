import { Link } from "@tanstack/react-router";
import { LogoMark } from "@/components/lensos/Logo";
import { CompetitorMark } from "@/components/marketing/CompetitorMark";
import { COMPARE_ENTRIES, compareTally, type CompareEntry } from "@/lib/public-compare";
import { PRODUCT_NAME } from "@/lib/product";

function Card({ item }: { item: CompareEntry }) {
  const tally = compareTally(item.rows);
  return (
    <Link to="/compare/$slug" params={{ slug: item.id }} className="foto-compare__card">
      <div className="foto-compare__vs">
        <LogoMark size={28} />
        {PRODUCT_NAME}
        <em>vs</em>
        <CompetitorMark id={item.mark} />
        {item.name}
      </div>
      <p>{item.blurb}</p>
      <strong>{item.verdict}</strong>
      <span className="foto-compare__meta">
        Read the comparison {tally.us} us · {tally.even} even · {tally.them} them
      </span>
    </Link>
  );
}

export function CompareCards({ limit }: { limit?: number }) {
  const items = limit ? COMPARE_ENTRIES.slice(0, limit) : COMPARE_ENTRIES;
  return (
    <div className="foto-compare__grid">
      {items.map((item) => (
        <Card key={item.id} item={item} />
      ))}
    </div>
  );
}
