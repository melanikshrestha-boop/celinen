import { Link } from "@tanstack/react-router";
import { LogoMark } from "@/components/lensos/Logo";
import { CompetitorMark } from "@/components/marketing/CompetitorMark";
import { COMPARE_ENTRIES, compareTally, type CompareEntry } from "@/lib/public-compare";
import { PRODUCT_NAME } from "@/lib/product";
import "./compare-page.css";

export function CompareDetail({ item }: { item: CompareEntry }) {
  const tally = compareTally(item.rows);
  const others = COMPARE_ENTRIES.filter((entry) => entry.id !== item.id).slice(0, 8);
  return (
    <article className="foto-compare-detail">
      <p className="foto-compare__eyebrow">Comparison</p>
      <div className="foto-compare-detail__vs">
        <LogoMark size={36} />
        vs
        <CompetitorMark id={item.mark} />
      </div>
      <h1>
        {PRODUCT_NAME} vs {item.name}
      </h1>
      <p className="foto-compare-detail__lede">{item.blurb}</p>
      <div className="foto-compare-detail__actions">
        <Link to="/auth" search={{ next: "/dashboard", mode: "signin" }}>
          Try {PRODUCT_NAME} free
        </Link>
        <Link to="/compare">All comparisons</Link>
      </div>
      <div className="foto-compare-detail__score">
        <span>{tally.us} rows to {PRODUCT_NAME}</span>
        <span>{tally.even} about even</span>
        <span>
          {tally.them} to {item.name}
        </span>
      </div>
      <p className="foto-compare-detail__lede">{item.lede}</p>
      <h2>Where each one is stronger.</h2>
      <p className="foto-compare-detail__lede">
        Every claim in the {item.name} column comes from a page they publish, {item.checked}. Rows
        where they are ahead are marked as such.
      </p>
      <table className="foto-compare-detail__table">
        <thead>
          <tr>
            <th>{PRODUCT_NAME}</th>
            <th>{item.name}</th>
          </tr>
        </thead>
        <tbody>
          {item.rows.map((row) => (
            <tr key={row.us} className={`is-${row.win}`}>
              <td>{row.us}</td>
              <td>{row.them}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="foto-compare-detail__sources">{item.sources}</p>
      <div className="foto-compare-detail__choose">
        <div>
          <h2>Choose {PRODUCT_NAME} if</h2>
          <ul>
            {item.chooseUs.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
        <div>
          <h2>Choose {item.name} if</h2>
          <ul>
            {item.chooseThem.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      </div>
      <p className="foto-compare-detail__lede">
        We would rather tell you this now than have you find out after migrating a year of work.
      </p>
      <section className="foto-compare__more">
        <h2>Other comparisons</h2>
        <div className="foto-compare__grid">
          {others.map((entry) => (
            <Link
              key={entry.id}
              to="/compare/$slug"
              params={{ slug: entry.id }}
              className="foto-compare__card"
            >
              <div className="foto-compare__vs">
                <LogoMark size={28} />
                vs
                <CompetitorMark id={entry.mark} />
              </div>
              <strong>
                {PRODUCT_NAME} vs {entry.name}
              </strong>
              <p>{entry.blurb}</p>
            </Link>
          ))}
        </div>
      </section>
      <section className="foto-compare__try">
        <h2>Switching from {item.name}?</h2>
        <p>Import the card. Pick. Send tonight.</p>
        <div className="foto-compare__actions">
          <Link to="/auth" search={{ next: "/dashboard", mode: "signin" }}>
            Get started
          </Link>
          <Link to="/pricing">See pricing</Link>
        </div>
      </section>
    </article>
  );
}
