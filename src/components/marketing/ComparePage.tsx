import { Link } from "@tanstack/react-router";
import { CompareCards } from "@/components/marketing/CompareCards";
import { COMPARE_ENTRIES, compareTotals } from "@/lib/public-compare";
import { PRODUCT_NAME } from "@/lib/product";
import "./compare-page.css";

export function ComparePage() {
  const totals = compareTotals();
  return (
    <div className="foto-compare">
      <header className="foto-compare__intro" data-reveal>
        <p className="foto-compare__eyebrow">Comparisons</p>
        <h1>How {PRODUCT_NAME} compares.</h1>
        <p>
          Written the way we would want to read it: every claim about another product checked against
          a page they publish, and the rows where they beat us marked as such.
        </p>
        <div className="foto-compare__actions">
          <Link to="/pricing">See pricing</Link>
          <a href="mailto:hello@lenslab.dev">Talk to us</a>
        </div>
      </header>
      <CompareCards />
      <section className="foto-compare__more" data-reveal>
        <h2>More comparisons coming</h2>
        <p>
          Using something we have not covered? Tell us which, and we will write it up under the same
          rules.
        </p>
        <div className="foto-compare__actions">
          <a href="mailto:hello@lenslab.dev?subject=Comparison%20request">Suggest a comparison →</a>
        </div>
      </section>
      <p className="foto-compare__note" data-reveal>
        How we write these. Every claim about another product is checked against a page they publish,
        and dated. We do not compare against features of ours that have not shipped, and we say
        plainly when the other product is the better choice — across these {COMPARE_ENTRIES.length}{" "}
        comparisons we hand {totals.them} rows to the other product, and every one of them beats us
        on something. Prices move; if you find something out of date, tell us and we will fix it.
        Each product’s logo is its owner’s trademark, shown to identify the product being compared —
        none of these companies are affiliated with {PRODUCT_NAME} or endorse this page.
      </p>
      <section className="foto-compare__try" data-reveal>
        <h2>Or just try it.</h2>
        <p>The whole product. Faster than reading every comparison page here.</p>
        <div className="foto-compare__actions">
          <Link to="/auth" search={{ next: "/dashboard", mode: "signin" }}>
            Get started
          </Link>
          <Link to="/pricing">See pricing</Link>
        </div>
      </section>
    </div>
  );
}
