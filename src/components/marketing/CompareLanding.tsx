import { Link } from "@tanstack/react-router";
import { CompareCards } from "@/components/marketing/CompareCards";
import { PRODUCT_NAME } from "@/lib/product";
import "./compare-page.css";

export function CompareLanding() {
  return (
    <section className="foto-compare-landing" aria-labelledby="compare-heading" data-reveal>
      <p className="foto-compare__eyebrow">Comparisons</p>
      <h2 id="compare-heading">How {PRODUCT_NAME} compares.</h2>
      <p>
        Written the way we would want to read it: every claim about another product checked against a
        page they publish, and the rows where they beat us marked as such.
      </p>
      <CompareCards />
      <div className="foto-compare__actions">
        <Link to="/compare">All comparisons</Link>
        <Link to="/pricing">See pricing</Link>
      </div>
    </section>
  );
}
