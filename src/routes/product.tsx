import { createFileRoute, Link } from "@tanstack/react-router";
import { PublicPage } from "@/components/marketing/PublicPage";
import { PublicEntryCta } from "@/components/PublicEntryCta";
import { publicContentHead } from "@/lib/public-content";
import { COMPANY_NAME, LENS_PRODUCTS } from "@/lib/lenslab-products";
import "@/components/marketing/product-catalog.css";

const description = "Celinen and Heavenly.";

export const Route = createFileRoute("/product")({
  head: () => publicContentHead("Products", description, "/product"),
  component: ProductPage,
});

export function ProductPage() {
  return (
    <PublicPage eyebrow={COMPANY_NAME} title="Products">
      <ul className="product-catalog" aria-label="Products">
        {LENS_PRODUCTS.map((product) => (
          <li
            key={product.id}
            className={`product-catalog__item product-catalog__item--${product.id}`}
          >
            <h2>
              <Link to={product.to}>{product.name}</Link>
            </h2>
            <p>{product.kind}</p>
            <PublicEntryCta
              className="marketing-action"
              next={product.next}
              guestLabel={
                <>
                  Open
                  <span aria-hidden="true">→</span>
                </>
              }
              memberLabel={
                <>
                  Open
                  <span aria-hidden="true">→</span>
                </>
              }
            />
          </li>
        ))}
      </ul>
    </PublicPage>
  );
}
