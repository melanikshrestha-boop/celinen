import { createFileRoute, Link } from "@tanstack/react-router";
import { PublicPage } from "@/components/marketing/PublicPage";
import { publicContentHead } from "@/lib/public-content";
import "@/components/marketing/public-editorial.css";

const description = "Bring your photographs, editing decisions, and client work into one shoot.";

export const Route = createFileRoute("/product")({
  head: () => publicContentHead("Your photography, in context", description, "/product"),
  component: ProductPage,
});

export function ProductPage() {
  return (
    <PublicPage eyebrow="Product" title="A home for the whole shoot." description={description}>
      <div className="public-editorial public-editorial--wide">
        <section id="why-foto" className="public-editorial__purpose" data-reveal>
          <h2>Keep the whole shoot in view.</h2>
          <p>
            Making photographs is only part of a photographer’s day. FOTO brings the work around
            them into view too: choosing a set, developing an edit, and keeping the client’s next
            step clear. You stay in charge of the creative decisions.
          </p>
        </section>
        <div className="public-editorial__features">
          <section data-reveal>
            <span className="public-editorial__label">Bring it in</span>
            <h2>Start with your originals.</h2>
            <p>
              Import files or a folder into a shoot. Found photos, ready previews, and confirmed
              saves are separate states, so you can see what has actually finished.
            </p>
            <p>Your original bytes stay separate from your editing decisions.</p>
          </section>
          <section data-reveal>
            <span className="public-editorial__label">Find the photographs</span>
            <h2>Choose, then refine.</h2>
            <p>
              Review a contact sheet, mark picks, and open the same shoot in Develop. Keep your
              selection and edit history attached to the photograph as you work.
            </p>
          </section>
          <section data-reveal>
            <span className="public-editorial__label">Make it yours</span>
            <h2>Shape tone, color, and feeling.</h2>
            <p>
              Develop includes tone controls, curves, color grading, crop, grain, presets, and
              undoable history. Review the export proof before delivering the finished image.
            </p>
            <p>
              Native image processing requires the local engine. It is not supplied by the hosted
              website alone; support also depends on the source format and device.
            </p>
          </section>
          <section data-reveal>
            <span className="public-editorial__label">Keep the context</span>
            <h2>The people belong with the shoot.</h2>
            <p>
              Keep contacts and shoot details near your work. Gallery, social, and Earnings surfaces
              help organize the next steps without making a sent link or an invoice look like a
              confirmed payment.
            </p>
            <p>
              Publishing, messaging, and payments need their respective connected services. Check
              the connection and delivery status before relying on them.
            </p>
          </section>
        </div>
        <aside
          id="your-work"
          className="public-editorial__note"
          aria-labelledby="product-availability"
          data-reveal
        >
          <h2 id="product-availability">Clear about what is ready.</h2>
          <p>
            FOTO is actively developing. Experimental removal is labeled as such; a complete
            Lightroom replacement, high-bit-depth color workflow, and bulk RAW speed guarantee are
            not promised. A preview is not a backup, and a saved local library is not a cloud copy
            of your originals.
          </p>
          <Link to="/changelog">
            See what changed <span aria-hidden="true">↗</span>
          </Link>
        </aside>
      </div>
    </PublicPage>
  );
}
